import { join } from "node:path";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@mariozechner/pi-coding-agent";
import { type LiveRoomState, RoomStateManager } from "./room-state.js";

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

  constructor(options: PiSessionBackendOptions) {
    this.sessionBaseDir = options.sessionBaseDir;
    this.cwd = options.cwd ?? process.cwd();
    this.agentDir = options.agentDir;
    this.roomStateManager = new RoomStateManager();

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

    try {
      // Collect the response text
      let responseText = "";

      // Subscribe to events to capture the response
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "message_update") {
          if (event.assistantMessageEvent.type === "text_delta") {
            responseText += event.assistantMessageEvent.delta;
          }
        }
      });

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

      await Promise.race([promptPromise, timeoutPromise]);

      // Clear timeout if it hasn't fired
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      // Update session file path (may have been created/updated)
      this.roomStateManager.updateSessionFile(roomId, session.sessionFile);

      // Clean up subscription
      unsubscribe();

      console.log(`[PiSessionBackend] Prompt completed for room ${roomId}, response length: ${responseText.length}`);
      return responseText;
    } catch (error) {
      console.error(`[PiSessionBackend] Error during prompt for room ${roomId}:`, error);
      // Re-throw so router can handle the error
      throw error;
    } finally {
      // Clear timeout if still pending
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      // ALWAYS clear processing state - this is critical for recovery
      this.roomStateManager.clearProcessing(roomId);
      console.log(`[PiSessionBackend] Cleared processing state for room ${roomId}`);
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
      this.roomStateManager.getOrCreateSession(roomId, session, session.sessionFile);

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

  async dispose(): Promise<void> {
    this.roomStateManager.disposeAll();
  }
}
