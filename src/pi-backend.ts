import * as fs from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@mariozechner/pi-coding-agent";
import { RoomModelManager } from "./room-model-manager.js";
import { type LiveRoomState, RoomStateManager } from "./room-state.js";
import type { ModelClearResult, ModelStatus, ModelSwitchResult } from "./types.js";

export interface PiSessionBackendOptions {
  sessionBaseDir: string;
  cwd?: string;
  agentDir: string;
}

export class PiSessionBackend {
  private sessionBaseDir: string;
  private cwd: string;
  private agentDir: string;
  private roomStateManager: RoomStateManager;
  private roomModelManager: RoomModelManager;

  // Serialization mutex for critical sections (session bind, model reconcile, global default restore)
  // This prevents race conditions where one room could observe another room's temporary settings.json mutation
  private _serializationLock: { locked: boolean; waiters: Array<() => void> } = { locked: false, waiters: [] };

  private async _acquireMutex(): Promise<() => void> {
    // Wait for current lock to be released
    while (this._serializationLock.locked) {
      await new Promise<void>((resolve) => {
        this._serializationLock.waiters.push(resolve);
      });
    }
    this._serializationLock.locked = true;
    return () => {
      this._serializationLock.locked = false;
      // Wake up one waiter
      const waiter = this._serializationLock.waiters.shift();
      if (waiter) waiter();
    };
  }

  constructor(options: PiSessionBackendOptions) {
    this.sessionBaseDir = options.sessionBaseDir;
    this.cwd = options.cwd ?? process.cwd();
    this.agentDir = options.agentDir;
    this.roomStateManager = new RoomStateManager();
    this.roomModelManager = new RoomModelManager(this.agentDir);

    console.log(`[PiSessionBackend] Using dedicated agentDir: ${this.agentDir}`);

    // Recovery: Clear any stuck processing states on startup
    // This handles the case where the bot crashed while processing
    console.log(`[PiSessionBackend] Clearing any stuck processing states on startup...`);
    this.roomStateManager.clearAllProcessing();
  }

  private hashRoomId(roomId: string): string {
    // Use a simple hash to create a unique identifier for each room
    let hash = 0;
    for (let i = 0; i < roomId.length; i++) {
      const char = roomId.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  private getRoomSessionDir(roomId: string): string {
    // Each room gets its own subdirectory for session persistence
    const hash = this.hashRoomId(roomId);
    return `${this.sessionBaseDir}/room-${hash}`;
  }

  async getOrCreateSession(roomId: string): Promise<AgentSession> {
    console.log(`[PiSessionBackend] getOrCreateSession() for room ${roomId}`);

    // Check if session already exists in cache
    const existingState = this.roomStateManager.get(roomId);
    if (existingState) {
      console.log(`[PiSessionBackend] Found existing session ${existingState.sessionId} for room ${roomId}`);
      return existingState.session;
    }

    // Get this room's session directory
    const roomSessionDir = this.getRoomSessionDir(roomId);

    // Create session manager for this room's session directory
    // Use continueRecent to resume existing session or create new one
    const sessionManager = SessionManager.continueRecent(this.cwd, roomSessionDir);

    // Set up auth storage and model registry with dedicated agentDir
    const authPath = join(this.agentDir, "auth.json");
    const modelsPath = join(this.agentDir, "models.json");
    const authStorage = AuthStorage.create(authPath);
    const modelRegistry = ModelRegistry.create(authStorage, modelsPath);

    // Create the agent session with explicit agentDir
    const { session, modelFallbackMessage } = await createAgentSession({
      sessionManager,
      authStorage,
      modelRegistry,
      cwd: this.cwd,
      agentDir: this.agentDir,
    });

    if (modelFallbackMessage) {
      console.log(`[PiSessionBackend] Model fallback for room ${roomId}: ${modelFallbackMessage}`);
    }

    console.log(`[PiSessionBackend] Created session for room ${roomId} in ${roomSessionDir}: ${session.sessionFile}`);

    // Store in room state manager
    const roomState = this.roomStateManager.getOrCreateSession(roomId, session, session.sessionFile);

    // Set up event hooks to update snapshot (non-blocking)
    this.setupEventHooks(roomId, session);

    // Update snapshot with model info (safe, non-blocking)
    this.updateSnapshotFromSession(roomState, session);

    // Phase 2: Apply desired room model if it differs from active model
    // Acquire serialization mutex to prevent race conditions with other rooms
    const releaseMutex = await this._acquireMutex();
    try {
      await this.applyDesiredRoomModelIfDifferent(roomId, session);
    } finally {
      releaseMutex();
    }

    return session;
  }

  /**
   * Set up event hooks for a session to update snapshot.
   * These hooks update cached state without blocking API responses.
   */
  private setupEventHooks(roomId: string, session: AgentSession): void {
    session.subscribe((event) => {
      const roomState = this.roomStateManager.get(roomId);
      if (!roomState) return;

      // Update snapshot when inference completes
      if (event.type === "agent_end" || event.type === "turn_end") {
        this.updateSnapshotFromSession(roomState, session);
      }
    });
  }

  /**
   * Update snapshot from session state.
   * Only reads non-blocking properties.
   */
  private updateSnapshotFromSession(roomState: LiveRoomState, session: AgentSession): void {
    try {
      // Extract model info safely
      let model: string | undefined;
      let thinkingLevel: string | undefined;

      if (session.model) {
        model = session.model.id || session.model.name || "unknown";
      }
      if (session.thinkingLevel) {
        thinkingLevel = session.thinkingLevel;
      }

      // Update snapshot
      this.roomStateManager.updateSnapshot(roomState.roomId, {
        model,
        thinkingLevel,
      });
    } catch {
      // Silently ignore - snapshot will use stale/default values
    }
  }

  /**
   * Phase 2: Apply desired room model if it differs from active model.
   * This is called after session creation/resume and after !reset.
   */
  private async applyDesiredRoomModelIfDifferent(roomId: string, session: any): Promise<void> {
    const desiredModelProfile = this.roomModelManager.resolveDesiredModel(roomId);

    if (!desiredModelProfile) {
      return; // No desired model to apply
    }

    // Get current active model
    const activeModel = session.model?.id || session.model?.name;

    // Find the target model for the desired profile
    const targetModel = this.findModelByProfile(desiredModelProfile);
    if (!targetModel) {
      console.warn(`[PiSessionBackend] Desired model profile "${desiredModelProfile}" not found for room ${roomId}`);
      return;
    }

    // Check if auth is configured
    const modelRegistry = session.modelRegistry;
    if (!modelRegistry.hasConfiguredAuth(targetModel)) {
      console.warn(`[PiSessionBackend] No auth configured for desired model ${targetModel.provider} in room ${roomId}`);
      return;
    }

    // Check if active model already matches desired
    if (activeModel === targetModel.id) {
      return; // Already on desired model
    }

    // Apply desired model with global default preservation
    console.log(`[PiSessionBackend] Applying desired model "${desiredModelProfile}" to room ${roomId}`);
    try {
      // Use the safe helper that preserves global default
      await this.applyModelWithGlobalDefaultRestore(session, targetModel);

      // Update snapshot
      const roomState = this.roomStateManager.get(roomId);
      if (roomState) {
        this.updateSnapshotFromSession(roomState, session);
      }

      console.log(`[PiSessionBackend] Applied desired model to room ${roomId}`);
    } catch (error: any) {
      console.error(`[PiSessionBackend] Error applying desired model for room ${roomId}:`, error);
    }
  }

  /**
   * Check if room is already processing. Returns error message if so.
   */
  checkProcessingGuard(roomId: string): string | null {
    if (this.roomStateManager.isProcessing(roomId)) {
      return "Already working on the previous request.";
    }
    return null;
  }

  /**
   * Set processing state for a room.
   */
  setProcessing(roomId: string, processing: boolean): void {
    this.roomStateManager.setProcessing(roomId, processing);
  }

  /**
   * Clear processing state for a room.
   */
  clearProcessing(roomId: string): void {
    this.roomStateManager.clearProcessing(roomId);
  }

  /**
   * Track in-flight prompts for each room.
   * Used to ensure cleanup happens exactly once when the underlying prompt settles,
   * even if our timeout fires first.
   * NOTE: The SDK does NOT support real in-flight prompt cancellation.
   * The prompt() method returns Promise<void> with no way to cancel once started.
   */
  private inFlightPrompts = new Map<string, { promptPromise: Promise<void>; resolveCleanup: () => void }>();

  async prompt(roomId: string, text: string): Promise<string> {
    console.log(`[PiSessionBackend] prompt() called for room ${roomId}, text: "${text.slice(0, 50)}..."`);

    // Single-flight guard: reject if already processing
    const guardError = this.checkProcessingGuard(roomId);
    if (guardError) {
      console.log(`[PiSessionBackend] Guard blocked prompt for room ${roomId}`);
      return guardError;
    }

    const session = await this.getOrCreateSession(roomId);
    console.log(`[PiSessionBackend] Got session ${session.sessionId} for room ${roomId}`);
    this.roomStateManager.setProcessing(roomId, true);

    // Timeout protection: 5 minutes
    // This is a SAFETY NET for when inference hangs, not for slow responses
    const timeoutMs = 5 * 60 * 1000; // 5 minutes
    let timeoutId: NodeJS.Timeout | null = null;

    // Collect the response text
    let responseText = "";

    // Subscribe to events to capture the response
    // NOTE: unsubscribe is defined in outer scope to ensure cleanup on all paths
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update") {
        if (event.assistantMessageEvent.type === "text_delta") {
          responseText += event.assistantMessageEvent.delta;
        }
      }
    });

    // Track cleanup resolution
    let cleanupResolved = false;
    const resolveCleanup = () => {
      if (!cleanupResolved) {
        cleanupResolved = true;
        // Clear timeout if still pending
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        // ALWAYS clear processing state - this is critical for recovery
        this.roomStateManager.clearProcessing(roomId);
        console.log(`[PiSessionBackend] Cleared processing state for room ${roomId}`);
      }
    };

    try {
      // Send the prompt with timeout protection
      const promptPromise = session.prompt(text);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          console.error(`[PiSessionBackend] TIMEOUT: Prompt for room ${roomId} exceeded ${timeoutMs / 60000} minutes`);
          reject(
            new Error(`Prompt timeout after ${timeoutMs / 60000} minutes. The inference backend may be unresponsive.`),
          );
        }, timeoutMs);
      });

      // Track in-flight prompt for cleanup
      // NOTE: The SDK does NOT support real in-flight prompt cancellation.
      // We must keep the room guarded as busy until the underlying prompt settles.
      this.inFlightPrompts.set(roomId, { promptPromise, resolveCleanup });

      try {
        await Promise.race([promptPromise, timeoutPromise]);

        // Normal completion path
        console.log(
          `[PiSessionBackend] Prompt completed normally for room ${roomId}, response length: ${responseText.length}`,
        );
        return responseText;
      } catch (error) {
        // Timeout or other error path
        // Do NOT clear processing yet - the underlying prompt may still be running
        // It will be cleared when the promptPromise settles (see finally below)
        console.error(`[PiSessionBackend] Prompt failed for room ${roomId}:`, error);
        throw error;
      }
    } finally {
      // Update session file path (may have been created/updated)
      this.roomStateManager.updateSessionFile(roomId, session.sessionFile);

      // Clean up subscription
      unsubscribe();

      // If the underlying prompt is still running (timeout case), attach a finally handler
      // to ensure cleanup happens exactly once when it settles.
      // NOTE: The SDK does NOT support real in-flight prompt cancellation.
      if (this.inFlightPrompts.has(roomId)) {
        const inFlight = this.inFlightPrompts.get(roomId)!;
        // Remove from tracking - we'll handle cleanup via the attached finally
        this.inFlightPrompts.delete(roomId);

        // Attach finally to ensure cleanup when the underlying prompt settles
        // We use a catch to prevent unhandled promise rejections, then resolve cleanup
        inFlight.promptPromise
          .then(() => {
            console.log(`[PiSessionBackend] Underlying prompt settled (success) for room ${roomId}`);
          })
          .catch((err) => {
            console.log(`[PiSessionBackend] Underlying prompt settled (error) for room ${roomId}:`, err);
          })
          .finally(resolveCleanup);
      }
    }
  }

  /**
   * Reset the live session for a room.
   * This creates a new session while preserving the old one as archive.
   * This is the normal user-facing reset operation.
   */
  async reset(roomId: string): Promise<void> {
    console.log(`[PiSessionBackend] Resetting session for room ${roomId}`);

    try {
      // Step 1: Get old room state
      const oldState = this.roomStateManager.get(roomId);

      // Step 2: If there's an old session, clean it up properly
      if (oldState) {
        console.log(`[PiSessionBackend] Found old session ${oldState.sessionId}, cleaning up...`);

        // Clear typing timeout
        if (oldState.typingTimeout) {
          clearTimeout(oldState.typingTimeout);
        }

        // Clear processing state
        oldState.isProcessing = false;
        oldState.processingStartedAt = undefined;

        // Dispose the old session (this closes it but preserves the file)
        try {
          await oldState.session.dispose();
          console.log(`[PiSessionBackend] Disposed old session`);
        } catch (disposeErr) {
          console.warn(`[PiSessionBackend] Warning disposing old session:`, disposeErr);
        }
      }

      // Step 3: Remove old state from the map
      this.roomStateManager.remove(roomId);

      // Step 4: Get this room's session directory
      const roomSessionDir = this.getRoomSessionDir(roomId);

      // Step 5: Create a NEW session in the same room directory
      // Use SessionManager.create to explicitly create a new session
      const sessionManager = SessionManager.create(this.cwd, roomSessionDir);

      // Step 6: Set up auth storage and model registry with dedicated agentDir
      const authPath = join(this.agentDir, "auth.json");
      const modelsPath = join(this.agentDir, "models.json");
      const authStorage = AuthStorage.create(authPath);
      const modelRegistry = ModelRegistry.create(authStorage, modelsPath);

      // Step 7: Create the new agent session with explicit agentDir
      const { session, modelFallbackMessage } = await createAgentSession({
        sessionManager,
        authStorage,
        modelRegistry,
        cwd: this.cwd,
        agentDir: this.agentDir,
      });

      if (modelFallbackMessage) {
        console.log(`[PiSessionBackend] Model fallback for room ${roomId}: ${modelFallbackMessage}`);
      }

      console.log(`[PiSessionBackend] Created new session for room ${roomId}: ${session.sessionFile}`);

      // Step 8: Store new session in room state manager
      const _newRoomState = this.roomStateManager.getOrCreateSession(roomId, session, session.sessionFile);

      // Phase 2: Apply desired room model if it differs from active model
      // Acquire serialization mutex to prevent race conditions with other rooms
      const releaseMutex = await this._acquireMutex();
      try {
        await this.applyDesiredRoomModelIfDifferent(roomId, session);
      } finally {
        releaseMutex();
      }

      console.log(`[PiSessionBackend] Reset complete for room ${roomId}`);
    } catch (error) {
      console.error(`[PiSessionBackend] Error resetting session for room ${roomId}:`, error);
      throw error; // Re-throw so router can catch and reply
    }
  }

  /**
   * Purge all sessions for a room.
   * This is a dangerous admin-only operation that deletes everything.
   * This is not the same as normal reset.
   */
  async purge(roomId: string): Promise<void> {
    // Dispose room state
    this.roomStateManager.dispose(roomId);

    // Remove the room's session directory (clears all session files for this room)
    const roomSessionDir = this.getRoomSessionDir(roomId);
    try {
      const fs = await import("fs/promises");
      await fs.rm(roomSessionDir, { recursive: true, force: true });
      console.log(`[PiSessionBackend] Purged session directory: ${roomSessionDir}`);
    } catch (error) {
      console.error(`[PiSessionBackend] Error purging session directory:`, error);
    }
  }

  async getSessionInfo(roomId: string): Promise<{ active: boolean; sessionFile?: string } | null> {
    const state = this.roomStateManager.get(roomId);
    if (state) {
      return {
        active: true,
        sessionFile: state.sessionFile,
      };
    }
    return null;
  }

  async listSessions(): Promise<Array<{ roomId: string; sessionFile?: string; active: boolean }>> {
    const result: Array<{ roomId: string; sessionFile?: string; active: boolean }> = [];
    const fs = await import("fs/promises");

    // Get all cached (active) sessions
    for (const state of this.roomStateManager.listLive()) {
      result.push({
        roomId: state.roomId,
        sessionFile: state.sessionFile,
        active: true,
      });
    }

    // Get active session paths for comparison
    const activePaths = new Set<string>();
    for (const state of this.roomStateManager.listLive()) {
      if (state.sessionFile) {
        activePaths.add(state.sessionFile);
      }
    }

    // Scan sessionBaseDir for all session files (including archived ones)
    try {
      const entries = await fs.readdir(this.sessionBaseDir, { recursive: false });

      for (const entry of entries) {
        const entryPath = `${this.sessionBaseDir}/${entry}`;
        const stat = await fs.stat(entryPath);

        if (stat.isDirectory() && entry.startsWith("room-")) {
          // This is a room session directory - list its contents
          const roomEntries = await fs.readdir(entryPath);
          for (const roomEntry of roomEntries) {
            if (roomEntry.endsWith(".jsonl")) {
              const sessionPath = `${entryPath}/${roomEntry}`;
              if (!activePaths.has(sessionPath)) {
                result.push({
                  roomId: "archived",
                  sessionFile: sessionPath,
                  active: false,
                });
              }
            }
          }
        } else if (stat.isFile() && entry.endsWith(".jsonl")) {
          // Session file directly in sessionBaseDir
          const sessionPath = entryPath;
          if (!activePaths.has(sessionPath)) {
            result.push({
              roomId: "archived",
              sessionFile: sessionPath,
              active: false,
            });
          }
        }
      }
    } catch (error) {
      console.error(`[PiSessionBackend] Error scanning session directory:`, error);
    }

    return result;
  }

  async getArchivedSessions(): Promise<Array<{ path: string; id: string; firstMessage: string }>> {
    const fs = await import("fs/promises");

    // Get active session paths for comparison
    const activePaths = new Set<string>();
    for (const state of this.roomStateManager.listLive()) {
      if (state.sessionFile) {
        activePaths.add(state.sessionFile);
      }
    }

    const archived: Array<{ path: string; id: string; firstMessage: string }> = [];

    // Scan sessionBaseDir for all session files
    try {
      const entries = await fs.readdir(this.sessionBaseDir, { recursive: false });

      for (const entry of entries) {
        const entryPath = `${this.sessionBaseDir}/${entry}`;
        const stat = await fs.stat(entryPath);

        if (stat.isDirectory() && entry.startsWith("room-")) {
          // This is a room session directory - list its contents
          const roomEntries = await fs.readdir(entryPath);
          for (const roomEntry of roomEntries) {
            if (roomEntry.endsWith(".jsonl")) {
              const sessionPath = `${entryPath}/${roomEntry}`;
              if (!activePaths.has(sessionPath)) {
                // Parse session info from file
                const content = await fs.readFile(sessionPath, "utf-8");
                const lines = content.trim().split("\n");
                let firstMessage = "";
                let sessionId = sessionPath.split("/").pop() || "";

                for (const line of lines) {
                  try {
                    const entry = JSON.parse(line);
                    if (entry.id) sessionId = entry.id;
                    if (entry.content && entry.role === "user" && !firstMessage) {
                      firstMessage = Array.isArray(entry.content)
                        ? entry.content.map((c: any) => c.text || c).join(" ")
                        : entry.content;
                      break;
                    }
                  } catch {}
                }

                archived.push({
                  path: sessionPath,
                  id: sessionId,
                  firstMessage: firstMessage.slice(0, 100),
                });
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`[PiSessionBackend] Error scanning session directory:`, error);
    }

    return archived;
  }

  /**
   * Get archived sessions for a specific room.
   * These are session files in the room's directory that are not currently live.
   */
  async getArchivedSessionsForRoom(roomId: string): Promise<Array<{ path: string; id: string; firstMessage: string }>> {
    const roomSessionDir = this.getRoomSessionDir(roomId);
    const fs = await import("fs/promises");

    // Get the current live session file for this room
    const liveState = this.roomStateManager.get(roomId);
    const liveSessionFile = liveState?.sessionFile;

    const archived: Array<{ path: string; id: string; firstMessage: string }> = [];

    // List all session files in the room directory
    try {
      const entries = await fs.readdir(roomSessionDir);

      for (const entry of entries) {
        if (entry.endsWith(".jsonl")) {
          const sessionPath = `${roomSessionDir}/${entry}`;

          // Skip if this is the current live session
          if (sessionPath === liveSessionFile) {
            continue;
          }

          // Parse session info from file
          const content = await fs.readFile(sessionPath, "utf-8");
          const lines = content.trim().split("\n");
          let firstMessage = "";
          let sessionId = entry.split("_")[1] || entry;

          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.id) sessionId = parsed.id;
              if (parsed.content && parsed.role === "user" && !firstMessage) {
                firstMessage = Array.isArray(parsed.content)
                  ? parsed.content.map((c: any) => c.text || c).join(" ")
                  : parsed.content;
                break;
              }
            } catch {}
          }

          archived.push({
            path: sessionPath,
            id: sessionId,
            firstMessage: firstMessage.slice(0, 100),
          });
        }
      }
    } catch (_error) {
      // Directory might not exist yet
      console.log(`[PiSessionBackend] No archived sessions for room ${roomId}`);
    }

    return archived;
  }

  async openArchivedSession(path: string): Promise<AgentSession> {
    const authPath = join(this.agentDir, "auth.json");
    const modelsPath = join(this.agentDir, "models.json");
    const authStorage = AuthStorage.create(authPath);
    const modelRegistry = ModelRegistry.create(authStorage, modelsPath);

    const { session } = await createAgentSession({
      sessionManager: SessionManager.open(path),
      authStorage,
      modelRegistry,
      cwd: this.cwd,
      agentDir: this.agentDir,
    });

    return session;
  }

  /**
   * Get live room info for control API.
   */
  getLiveRoomInfo(roomId: string): LiveRoomState | undefined {
    return this.roomStateManager.get(roomId);
  }

  /**
   * List all live rooms.
   */
  listLiveRooms(): LiveRoomState[] {
    return this.roomStateManager.listLive();
  }

  /**
   * Get the room state manager for external access (control server).
   */
  getRoomStateManager(): RoomStateManager {
    return this.roomStateManager;
  }

  /**
   * Get session by room key.
   */
  getSessionByKey(roomKey: string): LiveRoomState | undefined {
    return this.roomStateManager.getByKey(roomKey);
  }

  /**
   * Get room ID by room key.
   */
  getRoomIdByKey(roomKey: string): string | undefined {
    return this.roomStateManager.getRoomIdByKey(roomKey);
  }

  private _getModelRegistryForCurrentSession(): any {
    // Get model registry from first available session
    for (const state of this.roomStateManager.listLive()) {
      // Access the session's modelRegistry
      const session: any = state.session;
      if (session.modelRegistry) {
        return session.modelRegistry;
      }
    }
    return null;
  }

  /**
   * Get the model for a given profile by scanning available models.
   */
  private findModelByProfile(profile: string): any {
    const modelRegistry = this._getModelRegistryForCurrentSession();
    if (!modelRegistry) {
      return null;
    }

    // Get all available models
    const models: any[] = modelRegistry.models || [];

    // Profile name to provider prefix mapping
    const profileToProviderPrefix: Record<string, string> = {
      qwen27: "llama-cpp-qwen27",
      qwen36: "llama-cpp-qwen36",
    };

    const providerPrefix = profileToProviderPrefix[profile];
    if (!providerPrefix) {
      return null;
    }

    // Find model with matching provider
    const model = models.find((m) => m.provider === providerPrefix);
    return model || null;
  }

  /**
   * Read settings.json from agent directory.
   * Used to preserve/restore global default during room-level model switches.
   */
  /**
   * Read current global default settings from settings.json.
   * Returns null on error.
   */
  private readSettings(): any {
    try {
      const settingsPath = join(this.agentDir, "settings.json");
      const content = fs.readFileSync(settingsPath, "utf-8");
      return JSON.parse(content);
    } catch (error: any) {
      console.error(`[PiSessionBackend] Error reading settings.json: ${error.message}`);
      return null;
    }
  }

  /**
   * Write settings to agent directory.
   * Logs error but does not throw.
   */
  private writeSettings(settings: any): void {
    try {
      const settingsPath = join(this.agentDir, "settings.json");
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
    } catch (error: any) {
      console.error(`[PiSessionBackend] Error writing settings.json: ${error.message}`);
    }
  }

  /**
   * Apply a model to a session while preserving the global default.
   *
   * This helper prevents global default contamination by:
   * 1. Reading the current global default from settings.json
   * 2. Applying the target model via session.setModel()
   * 3. Restoring the original global default in a finally block
   *
   * @param session The agent session to apply the model to
   * @param targetModel The target model object from the model registry
   * @returns The active model ID after applying
   * @throws If setModel fails, the global default is still restored
   */
  private async applyModelWithGlobalDefaultRestore(session: any, targetModel: any): Promise<string> {
    // Read original global default
    const originalSettings = this.readSettings();

    try {
      // Apply the target model (this mutates settings.json as a side effect)
      await session.setModel(targetModel);
      return session.model?.id || session.model?.name || "unknown";
    } finally {
      // Always restore the original global default, even if setModel threw
      if (originalSettings) {
        this.writeSettings(originalSettings);
      }
    }
  }

  /**
   * Get model status for a room.
   * Reports the ACTIVE runtime model from the session/snapshot, not from settings.json.
   *
   * PHASE 2: Also reports desired model, global default, and mismatch status.
   */
  async getModelStatus(roomId: string): Promise<ModelStatus | null> {
    const roomState = this.roomStateManager.get(roomId);

    if (!roomState) {
      return null;
    }

    // Get model info from runtime session (NOT from settings)
    let model: string | undefined;
    let thinkingLevel: string | undefined;

    try {
      if (roomState.session.model) {
        model = roomState.session.model.id || roomState.session.model.name || "unknown";
      }
      if (roomState.session.thinkingLevel) {
        thinkingLevel = roomState.session.thinkingLevel;
      }
    } catch {
      // Fallback to snapshot if session access fails
      model = roomState.snapshot?.model;
      thinkingLevel = roomState.snapshot?.thinkingLevel;
    }

    // Phase 2: Get desired model info
    const desiredModelState = this.roomModelManager.getDesiredModel(roomId);
    const globalDefault = this.roomModelManager.getGlobalDefault();

    // Determine if active model mismatches desired
    let modelMismatch = false;
    if (desiredModelState?.resolvedModelId && model) {
      modelMismatch = model !== desiredModelState.resolvedModelId;
    }

    return {
      active: true,
      model,
      thinkingLevel,
      sessionId: roomState.sessionId,
      sessionFile: roomState.sessionFile,
      isProcessing: roomState.isProcessing,
      // Phase 2 additions
      desiredModel: desiredModelState?.desiredModel,
      desiredResolvedModelId: desiredModelState?.resolvedModelId,
      globalDefault,
      modelMismatch,
    };
  }

  /**
   * Switch model for a room.
   * Uses SDK session.setModel() API and persists desired model per room.
   *
   * PHASE 2 BEHAVIOR:
   * - Live-room switch: Works correctly. The active room's model changes immediately.
   * - No restart needed: The bot continues running without interruption.
   * - No session wipe needed: Existing conversation history is preserved.
   * - Room-persistent: Desired model is stored in room-models.json.
   * - Survives restart: New/resumed sessions will re-apply desired model.
   * - Survives !reset: New session after reset will use desired model.
   * - Does not contaminate global default: Room override is independent of settings.json.
   */
  async switchModel(roomId: string, requestedProfile: string): Promise<ModelSwitchResult> {
    const roomState = this.roomStateManager.get(roomId);

    if (!roomState) {
      throw new Error(`No active session for room ${roomId}`);
    }

    // Guard: reject if room is processing
    if (roomState.isProcessing) {
      throw new Error(
        `Cannot switch model while a turn is in progress; try again once idle. Room ${roomId} is currently processing.`,
      );
    }

    const session: any = roomState.session;

    // Find the target model
    const targetModel = this.findModelByProfile(requestedProfile);

    if (!targetModel) {
      return {
        success: false,
        message: `Unknown profile "${requestedProfile}". Available profiles: qwen27, qwen36 (aliases: q27, q36)`,
        requestedProfile,
      };
    }

    // Check if auth is configured
    const modelRegistry = session.modelRegistry;
    if (!modelRegistry.hasConfiguredAuth(targetModel)) {
      return {
        success: false,
        message: `No API key configured for model ${targetModel.provider}/${targetModel.id}`,
        requestedProfile,
      };
    }

    try {
      // Acquire serialization mutex for the model switch operation
      const releaseMutex = await this._acquireMutex();
      try {
        // Get current active model for status message
        const previousActiveModel = session.model?.id || session.model?.name || "previous";

        // Use the safe helper that preserves global default (with finally block)
        const activeModel = await this.applyModelWithGlobalDefaultRestore(session, targetModel);

        // Phase 2: Persist desired model per room (independent of global default)
        this.roomModelManager.setDesiredModel(roomId, requestedProfile, targetModel.id);

        // Update snapshot immediately
        this.updateSnapshotFromSession(roomState, session);

        console.log(
          `[PiSessionBackend] Model switched for room ${roomId}: ${previousActiveModel} -> ${activeModel} (desired: ${requestedProfile})`,
        );

        return {
          success: true,
          message: `Model switched from "${previousActiveModel}" to "${activeModel}"`,
          requestedProfile,
          resolvedModel: targetModel.id,
          activeModel,
        };
      } finally {
        releaseMutex();
      }
    } catch (error: any) {
      console.error(`[PiSessionBackend] Error switching model for room ${roomId}:`, error);
      return {
        success: false,
        message: `Failed to switch model: ${error.message}`,
        requestedProfile,
      };
    }
  }

  /**
   * Clear the desired model override for a room.
   * After clearing, the room will fall back to the global default.
   *
   * If the room is live and idle, the active session is immediately switched
   * back to the global default model.
   */
  async clearDesiredModel(roomId: string): Promise<ModelClearResult> {
    const previous = this.roomModelManager.clearDesiredModel(roomId);

    // Get the room state to check if it's live and idle
    const roomState = this.roomStateManager.get(roomId);

    if (previous) {
      console.log(`[PiSessionBackend] Cleared desired model for room ${roomId}: ${previous.desiredModel}`);

      // If room is live and idle, immediately switch back to global default
      let switchedToDefault = false;
      if (roomState && !roomState.isProcessing) {
        const globalDefault = this.roomModelManager.getGlobalDefault();
        if (globalDefault) {
          try {
            console.log(`[PiSessionBackend] Switching room ${roomId} back to global default: ${globalDefault}`);
            // Find the target model for the global default profile
            const targetModel = this.findModelByProfile(globalDefault);
            if (targetModel) {
              const modelRegistry = roomState.session.modelRegistry;
              if (modelRegistry.hasConfiguredAuth(targetModel)) {
                // Acquire serialization mutex for the model switch operation
                const releaseMutex = await this._acquireMutex();
                try {
                  await this.applyModelWithGlobalDefaultRestore(roomState.session, targetModel);
                  // Update snapshot immediately
                  this.updateSnapshotFromSession(roomState, roomState.session);
                  switchedToDefault = true;
                  console.log(`[PiSessionBackend] Switched room ${roomId} back to global default`);
                } finally {
                  releaseMutex();
                }
              } else {
                console.warn(`[PiSessionBackend] No auth configured for global default model ${globalDefault}`);
              }
            } else {
              console.warn(`[PiSessionBackend] Could not find model for global default profile ${globalDefault}`);
            }
          } catch (error: any) {
            console.error(`[PiSessionBackend] Error switching room ${roomId} back to global default:`, error);
          }
        }
      }

      return {
        success: true,
        message: switchedToDefault
          ? `Desired model cleared for this room. Switched back to global default model.`
          : `Desired model cleared for this room. The global default will apply on next rehydrate/reset/new session.`,
        previousDesiredModel: previous.desiredModel,
      };
    } else {
      return {
        success: true,
        message: `No room-specific desired model was set. Already using global default.`,
      };
    }
  }

  /**
   * Get all room IDs that have desired model overrides.
   * This is the source of truth for "rooms worth rehydrating".
   */
  getRoomsWithDesiredModel(): string[] {
    return this.roomModelManager.getRoomIdsWithOverrides();
  }

  /**
   * Get the desired model for a room (from persisted state).
   * This works even if the room is not currently live.
   */
  getDesiredModelForRoom(roomId: string): any {
    return this.roomModelManager.getDesiredModel(roomId);
  }

  /**
   * Check if a room has a persisted desired model override.
   * This is used to determine if a room should be rehydrated.
   */
  hasDesiredModelOverride(roomId: string): boolean {
    return this.roomModelManager.getDesiredModel(roomId) !== undefined;
  }

  /**
   * Get live room info for control API, with support for roomKey lookup.
   * Returns undefined if room is not live.
   */
  getLiveRoomInfoByRoomKey(roomKey: string): LiveRoomState | undefined {
    return this.roomStateManager.getByKey(roomKey);
  }

  /**
   * Check if a roomKey corresponds to a room with persisted desired model.
   * This requires scanning all room-model overrides since we only have roomId->roomKey mapping.
   * TODO: Consider maintaining a roomKey->roomId mapping in room-models.json for efficiency.
   */
  hasPersistedRoomByRoomKey(roomKey: string): boolean {
    // Hash the roomKey to see if it matches any roomId's hash
    // This is a workaround since we don't persist roomKey->roomId mapping
    // A proper fix would be to store both mappings
    const roomIds = this.getRoomsWithDesiredModel();
    for (const roomId of roomIds) {
      if (RoomStateManager.hashRoomId(roomId) === roomKey) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the roomId for a roomKey by scanning live rooms and persisted room-models.
   * Returns undefined if the roomKey is not found.
   */
  getRoomIdByRoomKey(roomKey: string): string | undefined {
    // First check live rooms
    const liveRoomId = this.roomStateManager.getRoomIdByKey(roomKey);
    if (liveRoomId) {
      return liveRoomId;
    }

    // Check persisted room-models (rooms with desired model overrides)
    const roomIds = this.getRoomsWithDesiredModel();
    for (const roomId of roomIds) {
      if (RoomStateManager.hashRoomId(roomId) === roomKey) {
        return roomId;
      }
    }

    return undefined;
  }

  /**
   * Get model status for a room, with optional rehydration of managed rooms.
   *
   * This is the canonical status getter that should be used by both:
   * - Matrix `!m -s` command
   * - HTTP control-plane status routes
   *
   * If `rehydrateIfManaged` is true and the room is not live but has a persisted
   * desired model override, the room will be rehydrated (session created/resumed)
   * so that status can be reported.
   *
   * @param roomId The Matrix room ID
   * @param options Options for status retrieval
   * @param options.rehydrateIfManaged If true, rehydrate managed rooms on demand
   * @returns ModelStatus or null if room doesn't exist and can't be rehydrated
   */
  async getModelStatusOrRehydrate(
    roomId: string,
    options?: { rehydrateIfManaged?: boolean },
  ): Promise<ModelStatus | null> {
    // First try to get live room status
    const liveStatus = await this.getModelStatus(roomId);
    if (liveStatus) {
      return liveStatus;
    }

    // Room is not live - check if it has persisted desired model
    const desiredModelState = this.roomModelManager.getDesiredModel(roomId);
    if (!desiredModelState) {
      return null; // Not a managed room, truly doesn't exist
    }

    // This is a managed room with persisted desired model
    // If rehydration is enabled, rehydrate the room
    if (options?.rehydrateIfManaged !== false) {
      console.log(`[PiSessionBackend] Rehydrating managed room ${roomId} on demand for status query`);
      try {
        await this.getOrCreateSession(roomId);
        // Now return the live status
        return await this.getModelStatus(roomId);
      } catch (error: any) {
        console.error(`[PiSessionBackend] Error rehydrating room ${roomId}:`, error.message);
        // Return partial status even on rehydration failure
      }
    }

    // Return partial status for persisted room (not rehydrated or rehydration failed)
    return {
      active: false, // Not currently live
      model: undefined, // No active model
      thinkingLevel: undefined,
      sessionId: undefined,
      sessionFile: undefined,
      isProcessing: false,
      desiredModel: desiredModelState.desiredModel,
      desiredResolvedModelId: desiredModelState.resolvedModelId,
      globalDefault: this.roomModelManager.getGlobalDefault(),
      modelMismatch: false, // Can't determine without active model
    } as ModelStatus;
  }

  async dispose(): Promise<void> {
    // Clean up any remaining in-flight prompts
    // These will have their finally handlers called when they settle
    for (const [roomId, inFlight] of this.inFlightPrompts.entries()) {
      console.log(`[PiSessionBackend] Disposing with in-flight prompt for room ${roomId}`);
      // Ensure cleanup happens when the prompt settles
      inFlight.promptPromise.finally(inFlight.resolveCleanup);
    }
    this.inFlightPrompts.clear();

    this.roomStateManager.disposeAll();
  }
}
