import * as fs from "node:fs";
import { join } from "node:path";
import type { RoomModelState, RoomModelsStore } from "./types.js";

/**
 * RoomModelManager manages per-room desired model state.
 *
 * This enables true room-persistent model control across:
 * - Service restarts
 * - Same-room session resume
 * - !reset commands
 *
 * The desired model is stored in a separate file (room-models.json) alongside
 * the agent's settings.json, ensuring it's bot-local and not mixed with CLI Pi config.
 */
export class RoomModelManager {
  private readonly storePath: string;
  private readonly agentDir: string;
  private store: RoomModelsStore;
  private globalDefault: string | undefined;

  constructor(agentDir: string) {
    this.agentDir = agentDir;
    this.storePath = join(agentDir, "room-models.json");
    this.store = { rooms: {} };
    this.globalDefault = undefined;

    // Load store from disk on construction
    this.load();
  }

  /**
   * Load the room models store from disk.
   * Handles missing, malformed, and corrupt files gracefully.
   */
  private load(): void {
    // Load room models store
    try {
      if (!fs.existsSync(this.storePath)) {
        console.log("[RoomModelManager] No room-models.json found, using empty store");
      } else {
        const content = fs.readFileSync(this.storePath, "utf-8");
        const parsed = JSON.parse(content);

        // Validate structure
        if (typeof parsed !== "object" || parsed === null) {
          throw new Error("Invalid store format: not an object");
        }

        if (typeof parsed.rooms !== "object" || parsed.rooms === null) {
          throw new Error("Invalid store format: missing 'rooms' object");
        }

        // Validate each room entry
        const validRooms: Record<string, RoomModelState> = {};
        for (const [roomId, state] of Object.entries(parsed.rooms)) {
          if (
            typeof state === "object" &&
            state !== null &&
            typeof (state as any).desiredModel === "string" &&
            typeof (state as any).updatedAt === "string"
          ) {
            validRooms[roomId] = state as RoomModelState;
          } else {
            console.warn(`[RoomModelManager] Invalid entry for room ${roomId}, skipping`);
          }
        }

        this.store = { rooms: validRooms };
        console.log(`[RoomModelManager] Loaded ${Object.keys(this.store.rooms).length} room model overrides`);
      }
    } catch (error: any) {
      console.error(`[RoomModelManager] Error loading room-models.json: ${error.message}`);
      console.log("[RoomModelManager] Using empty store as fallback");
      this.store = { rooms: {} };
    }

    // Always load global default from settings.json (independent of room-models.json)
    this.refreshGlobalDefault();
  }

  /**
   * Refresh the global default model from settings.json.
   * This is called on each read to ensure the global default is never stale.
   * It resets this.globalDefault to undefined before reading to ensure a fresh read.
   */
  private refreshGlobalDefault(): void {
    // Reset to undefined before reading to ensure we always get a fresh value
    this.globalDefault = undefined;

    try {
      const settingsPath = join(this.agentDir, "settings.json");

      if (!fs.existsSync(settingsPath)) {
        console.log("[RoomModelManager] No settings.json found, global default undefined");
        return;
      }

      const settingsContent = fs.readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(settingsContent);

      if (settings.defaultProvider && settings.defaultModel) {
        // Extract profile from provider name (e.g., "llama-cpp-qwen36" -> "qwen36")
        const provider = settings.defaultProvider;
        if (provider.includes("qwen27")) {
          this.globalDefault = "qwen27";
        } else if (provider.includes("qwen36")) {
          this.globalDefault = "qwen36";
        }
      }

      if (this.globalDefault) {
        console.log(`[RoomModelManager] Global default model: ${this.globalDefault}`);
      } else {
        console.log("[RoomModelManager] No global default model configured in settings.json");
      }
    } catch (error: any) {
      console.error(`[RoomModelManager] Error loading settings.json: ${error.message}`);
    }
  }

  /**
   * Get the bot-wide global default model profile.
   * Refreshes from settings.json on each read to avoid serving stale data.
   */
  getGlobalDefault(): string | undefined {
    // Refresh global default on each read to ensure it's never stale
    this.refreshGlobalDefault();
    return this.globalDefault;
  }

  /**
   * Resolve the desired model for a room.
   * Returns the room-specific desired model if set, otherwise the global default.
   * The global default is refreshed on each read to avoid serving stale data.
   */
  resolveDesiredModel(roomId: string): string | undefined {
    // First check for room-specific desired model (higher priority)
    const roomState = this.store.rooms[roomId];
    if (roomState?.desiredModel) {
      return roomState.desiredModel;
    }

    // Fall back to global default, refreshing it first to ensure it's not stale
    this.refreshGlobalDefault();
    return this.globalDefault;
  }

  /**
   * Save the room models store to disk atomically.
   */
  private save(): void {
    try {
      // Write to temp file first, then rename (atomic on most filesystems)
      const tempPath = `${this.storePath}.tmp.${process.pid}`;
      fs.writeFileSync(tempPath, JSON.stringify(this.store, null, 2), "utf-8");
      fs.renameSync(tempPath, this.storePath);

      console.log("[RoomModelManager] Saved room-models.json");
    } catch (error: any) {
      console.error(`[RoomModelManager] Error saving room-models.json: ${error.message}`);
    }
  }

  /**
   * Get the desired model for a room.
   * Returns undefined if no room-specific desired model is set.
   */
  getDesiredModel(roomId: string): RoomModelState | undefined {
    return this.store.rooms[roomId];
  }

  /**
   * Set the desired model for a room.
   * This is the persistent per-room override.
   */
  setDesiredModel(roomId: string, desiredModel: string, resolvedModelId?: string): void {
    this.store.rooms[roomId] = {
      desiredModel,
      resolvedModelId,
      updatedAt: new Date().toISOString(),
    };
    this.save();
  }

  /**
   * Clear the desired model for a room.
   * After clearing, the room will fall back to the global default.
   */
  clearDesiredModel(roomId: string): RoomModelState | undefined {
    const previous = this.store.rooms[roomId];
    if (previous) {
      delete this.store.rooms[roomId];
      this.save();
    }
    return previous;
  }

  /**
   * Get all room IDs that have desired model overrides.
   * This is the source of truth for "rooms worth rehydrating".
   */
  getRoomIdsWithOverrides(): string[] {
    return Object.keys(this.store.rooms);
  }

  /**
   * Get the internal store (for testing and advanced operations).
   * WARNING: Do not modify directly - use setDesiredModel/clearDesiredModel.
   */
  getStore(): RoomModelsStore {
    return this.store;
  }
}
