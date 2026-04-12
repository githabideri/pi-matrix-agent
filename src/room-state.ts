import type { AgentSession } from "@mariozechner/pi-coding-agent";

/**
 * Live room state tracks the active session and processing state for each Matrix room.
 */
export interface LiveRoomState {
  roomId: string;
  roomKey: string;
  session: AgentSession;
  sessionId?: string;
  sessionFile?: string;
  isProcessing: boolean;
  processingStartedAt?: Date;
  lastEventAt?: Date;
  typingTimeout?: NodeJS.Timeout;
}

/**
 * Session metadata extracted from a session file.
 */
export interface SessionMetadata {
  sessionId: string;
  sessionFile: string;
  relativePath: string;
  isLive: boolean;
  timestamp?: Date;
  firstMessage?: string;
}

/**
 * Manages live room state including processing guards and typing feedback.
 */
export class RoomStateManager {
  private live = new Map<string, LiveRoomState>();

  /**
   * Get the hashed room key for a Matrix room ID.
   */
  static hashRoomId(roomId: string): string {
    let hash = 0;
    for (let i = 0; i < roomId.length; i++) {
      const char = roomId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Get or create live room state.
   */
  getOrCreate(roomId: string, session: AgentSession, sessionFile?: string): LiveRoomState {
    const existing = this.live.get(roomId);
    if (existing) {
      return existing;
    }

    const roomKey = RoomStateManager.hashRoomId(roomId);
    const state: LiveRoomState = {
      roomId,
      roomKey,
      session,
      sessionId: session.sessionId,
      sessionFile,
      isProcessing: false,
    };

    this.live.set(roomId, state);
    return state;
  }

  /**
   * Get or create live room state (alias for backwards compatibility).
   */
  getOrCreateSession(roomId: string, session: AgentSession, sessionFile?: string): LiveRoomState {
    return this.getOrCreate(roomId, session, sessionFile);
  }

  /**
   * Get live room state by room ID.
   */
  get(roomId: string): LiveRoomState | undefined {
    return this.live.get(roomId);
  }

  /**
   * Get live room state by room key.
   */
  getByKey(roomKey: string): LiveRoomState | undefined {
    for (const state of this.live.values()) {
      if (state.roomKey === roomKey) {
        return state;
      }
    }
    return undefined;
  }

  /**
   * List all live rooms.
   */
  listLive(): LiveRoomState[] {
    return Array.from(this.live.values());
  }

  /**
   * Update session file path (may be updated after first prompt).
   */
  updateSessionFile(roomId: string, sessionFile?: string): void {
    const state = this.live.get(roomId);
    if (state) {
      state.sessionFile = sessionFile;
      state.sessionId = state.session.sessionId;
    }
  }

  /**
   * Check if room is currently processing.
   */
  isProcessing(roomId: string): boolean {
    const state = this.live.get(roomId);
    return state?.isProcessing ?? false;
  }

  /**
   * Set processing state for a room.
   */
  setProcessing(roomId: string, processing: boolean): void {
    const state = this.live.get(roomId);
    if (state) {
      state.isProcessing = processing;
      state.processingStartedAt = processing ? new Date() : undefined;
      state.lastEventAt = new Date();
    }
  }

  /**
   * Clear processing state and typing timeout.
   */
  clearProcessing(roomId: string): void {
    const state = this.live.get(roomId);
    if (state) {
      state.isProcessing = false;
      state.processingStartedAt = undefined;
      if (state.typingTimeout) {
        clearTimeout(state.typingTimeout);
        state.typingTimeout = undefined;
      }
    }
  }

  /**
   * Dispose of a room's state.
   */
  dispose(roomId: string): void {
    const state = this.live.get(roomId);
    if (state) {
      // Clear typing timeout
      if (state.typingTimeout) {
        clearTimeout(state.typingTimeout);
      }
      // Dispose session
      state.session.dispose();
      this.live.delete(roomId);
    }
  }

  /**
   * Remove room state without disposing session (for reset).
   */
  remove(roomId: string): LiveRoomState | undefined {
    const state = this.live.get(roomId);
    if (state) {
      if (state.typingTimeout) {
        clearTimeout(state.typingTimeout);
      }
      this.live.delete(roomId);
    }
    return state;
  }

  /**
   * Dispose all room states.
   */
  disposeAll(): void {
    for (const state of this.live.values()) {
      if (state.typingTimeout) {
        clearTimeout(state.typingTimeout);
      }
      state.session.dispose();
    }
    this.live.clear();
  }

  /**
   * Get the room ID for a given room key.
   */
  getRoomIdByKey(roomKey: string): string | undefined {
    for (const [roomId, state] of this.live.entries()) {
      if (state.roomKey === roomKey) {
        return roomId;
      }
    }
    return undefined;
  }
}

/**
 * Extract relative path from session file.
 */
export function getRelativeSessionPath(sessionFile: string, baseDir: string): string {
  if (!sessionFile) return "";
  const relative = sessionFile.replace(baseDir, "");
  return relative.startsWith("/") ? relative.slice(1) : relative;
}

/**
 * Extract session ID from session filename.
 * Format: 2026-04-12T14-03-14-490Z_7291b0ac-c908-48c1-814d-796a4f00cc63.jsonl
 */
export function extractSessionIdFromFilename(filename: string): string {
  const parts = filename.replace(".jsonl", "").split("_");
  return parts.length > 1 ? parts[1] : filename;
}

/**
 * Parse session metadata from a JSONL file.
 */
export async function parseSessionMetadata(
  sessionFile: string,
  baseDir: string
): Promise<SessionMetadata> {
  const fs = await import("fs/promises");
  const path = await import("path");

  const filename = path.basename(sessionFile);
  const sessionId = extractSessionIdFromFilename(filename);
  const relativePath = getRelativeSessionPath(sessionFile, baseDir);

  // Try to read first message
  let firstMessage = "";
  try {
    const content = await fs.readFile(sessionFile, "utf-8");
    const lines = content.trim().split("\n");
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role === "user" && entry.content) {
          firstMessage = Array.isArray(entry.content)
            ? entry.content.map((c: any) => c.text || c).join(" ")
            : String(entry.content);
          firstMessage = firstMessage.slice(0, 100);
          break;
        }
      } catch {
        // Skip invalid lines
      }
    }
  } catch {
    // File might not exist or be readable
  }

  return {
    sessionId,
    sessionFile,
    relativePath,
    isLive: false, // Will be updated by caller
    firstMessage,
  };
}
