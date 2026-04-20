import type { AgentSession } from "@mariozechner/pi-coding-agent";

/**
 * Cached snapshot of room state for non-blocking API responses.
 * Updated by event hooks, never touches session directly.
 */
export interface RoomSnapshot {
  model?: string;
  thinkingLevel?: string;
  toolNames: string[];
  snapshotAt: Date;
}

/**
 * Live turn state buffer for the current in-flight turn.
 * This is backend-owned state that tracks the live turn for transcript reconstruction.
 * Used to support reload during processing - the transcript endpoint can reconstruct
 * the current in-flight turn from this buffer.
 *
 * DESIGN: Maintains both accumulation fields (for convenience) AND an ordered list
 * of transcript-like items (for correct event ordering on reload).
 *
 * The ordered `items` list preserves the sequence events occurred, enabling
 * accurate transcript reconstruction. Accumulation fields (`assistantText`, etc.)
 * are kept for backwards compatibility and convenience but are derived from
 * or synchronized with the ordered items.
 *
 * SEGMENT TRACKING:
 * Assistant and thinking output are treated as segments, not a single forever-open item.
 * When tool activity occurs, the current assistant/thinking segment is "closed" and
 * subsequent deltas create new items. This preserves the real event ordering.
 */
export interface LiveTurnBuffer {
  /** Whether a turn is currently active */
  isActive: boolean;
  /** Current turn ID */
  turnId?: string;
  /** Turn start timestamp */
  turnStartedAt?: string;
  /**
   * Ordered list of live transcript items in event sequence.
   * This is the authoritative source for transcript reconstruction.
   * Each item can be updated in-place (e.g., assistant text deltas append to existing item).
   */
  items: LiveTranscriptItem[];
  /**
   * Convenience field: accumulated assistant text for current turn.
   * Derived from items but kept for backwards compatibility.
   */
  assistantText: string;
  /** Convenience field: accumulated thinking text for current turn. */
  thinkingText: string;
  /** User prompt text for current turn (populated at turn start) */
  userPrompt?: string;
  /** User message timestamp */
  userMessageTimestamp?: string;
  /** Assistant message timestamp (legacy, for backwards compatibility) */
  assistantMessageTimestamp?: string;
  /** Thinking message timestamp (legacy, for backwards compatibility) */
  thinkingTimestamp?: string;
  /** Live tool start items (legacy bucket, for backwards compatibility) */
  toolStarts: LiveToolStartItem[];
  /** Live tool end items (legacy bucket, for backwards compatibility) */
  toolEnds: LiveToolEndItem[];
  /**
   * ID of the currently open assistant segment.
   * When set, assistant text deltas append to this item.
   * Cleared when tool activity occurs, causing new deltas to create new items.
   */
  currentAssistantItemId?: string;
  /**
   * ID of the currently open thinking segment.
   * When set, thinking text deltas append to this item.
   * Cleared when tool activity occurs, causing new deltas to create new items.
   */
  currentThinkingItemId?: string;
}

/**
 * A live transcript item in the ordered list.
 * Similar to TranscriptItem but with some differences for live accumulation.
 */
export interface LiveTranscriptItem {
  kind: "user_message" | "assistant_message" | "tool_start" | "tool_end" | "thinking";
  id: string;
  timestamp: string;
  text?: string; // For user_message, assistant_message, thinking
  toolName?: string; // For tool_start, tool_end
  toolCallId?: string; // For tool_start, tool_end
  arguments?: string; // For tool_start
  success?: boolean; // For tool_end
  result?: string; // For tool_end
  error?: string; // For tool_end
}

/**
 * Live tool start item in the buffer.
 */
export interface LiveToolStartItem {
  id: string;
  timestamp: string;
  toolName: string;
  toolCallId?: string;
  arguments?: string;
}

/**
 * Live tool end item in the buffer.
 */
export interface LiveToolEndItem {
  id: string;
  timestamp: string;
  toolName: string;
  toolCallId?: string;
  success: boolean;
  result?: string;
  error?: string;
}

/**
 * Initialize an empty live turn buffer.
 */
export function createEmptyLiveTurnBuffer(): LiveTurnBuffer {
  return {
    isActive: false,
    turnId: undefined,
    turnStartedAt: undefined,
    items: [],
    assistantText: "",
    thinkingText: "",
    userPrompt: undefined,
    userMessageTimestamp: undefined,
    assistantMessageTimestamp: undefined,
    thinkingTimestamp: undefined,
    toolStarts: [],
    toolEnds: [],
    currentAssistantItemId: undefined,
    currentThinkingItemId: undefined,
  };
}

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
  snapshot?: RoomSnapshot; // Cached snapshot for non-blocking responses
  liveTurnBuffer?: LiveTurnBuffer; // Live current-turn buffer for transcript reconstruction
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
      hash = (hash << 5) - hash + char;
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
      snapshot: {
        model: undefined,
        thinkingLevel: undefined,
        toolNames: ["read", "bash", "edit", "write"], // Default tools
        snapshotAt: new Date(),
      },
      liveTurnBuffer: createEmptyLiveTurnBuffer(),
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
   * Clear processing state for ALL rooms.
   * Used for recovery on startup (when bot crashed while processing).
   */
  clearAllProcessing(): void {
    let cleared = 0;
    for (const state of this.live.values()) {
      if (state.isProcessing) {
        console.log(`[RoomStateManager] Clearing stuck processing state for room ${state.roomId}`);
        state.isProcessing = false;
        state.processingStartedAt = undefined;
        if (state.typingTimeout) {
          clearTimeout(state.typingTimeout);
          state.typingTimeout = undefined;
        }
        cleared++;
      }
    }
    if (cleared > 0) {
      console.log(`[RoomStateManager] Cleared ${cleared} stuck processing state(s) on startup`);
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

  /**
   * Update snapshot for a room (called from event hooks).
   * This is safe to call even during processing since it doesn't block.
   */
  updateSnapshot(roomId: string, updates: Partial<RoomSnapshot>): void {
    const state = this.live.get(roomId);
    if (state?.snapshot) {
      Object.assign(state.snapshot, updates, { snapshotAt: new Date() });
    }
  }

  /**
   * Reset the live turn buffer for a room (called on turn_start).
   * Clears all state including open segment tracking.
   */
  resetLiveTurnBuffer(roomId: string): void {
    const state = this.live.get(roomId);
    if (state) {
      const buffer = createEmptyLiveTurnBuffer();
      // Explicitly ensure segment tracking is cleared
      buffer.currentAssistantItemId = undefined;
      buffer.currentThinkingItemId = undefined;
      state.liveTurnBuffer = buffer;
    }
  }

  /**
   * Update the live turn buffer with turn start info.
   * @param eventTimestamp The original event timestamp, if available
   */
  updateLiveTurnStart(roomId: string, turnId: string, userPrompt?: string, eventTimestamp?: string): void {
    const state = this.live.get(roomId);
    if (state?.liveTurnBuffer) {
      state.liveTurnBuffer.isActive = true;
      state.liveTurnBuffer.turnId = turnId;
      state.liveTurnBuffer.turnStartedAt = eventTimestamp || new Date().toISOString();
      if (userPrompt) {
        state.liveTurnBuffer.userPrompt = userPrompt;
        const ts = eventTimestamp || new Date().toISOString();
        state.liveTurnBuffer.userMessageTimestamp = ts;
        // Add user_message item to ordered list
        state.liveTurnBuffer.items.push({
          kind: "user_message",
          id: `live-user-${turnId}`,
          timestamp: ts,
          text: userPrompt,
        });
      }
    }
  }

  /**
   * Append assistant text to the live turn buffer.
   * Appends to the currently open assistant segment if one exists,
   * otherwise creates a new assistant_message item.
   * Tool activity closes the current segment, causing subsequent deltas to create new items.
   * @param eventTimestamp The original event timestamp, if available
   */
  appendAssistantText(roomId: string, delta: string, eventTimestamp?: string): void {
    const state = this.live.get(roomId);
    if (!state?.liveTurnBuffer) return;

    const buffer = state.liveTurnBuffer;
    const ts = eventTimestamp || new Date().toISOString();

    // Check if there's an open assistant segment to append to
    if (buffer.currentAssistantItemId) {
      // Find and append to the open segment
      const existingItem = buffer.items.find(
        (item) => item.kind === "assistant_message" && item.id === buffer.currentAssistantItemId,
      );
      if (existingItem) {
        existingItem.text = (existingItem.text || "") + delta;
      } else {
        // Segment ID exists but item not found - create new segment
        this._createAssistantSegment(buffer, delta, ts);
      }
    } else {
      // No open segment - create a new one
      this._createAssistantSegment(buffer, delta, ts);
    }

    // Update convenience field
    buffer.assistantText += delta;
  }

  /**
   * Create a new assistant segment item and mark it as the current open segment.
   */
  private _createAssistantSegment(buffer: LiveTurnBuffer, text: string, timestamp: string): void {
    const id = `live-assistant-${buffer.turnId || Date.now()}-${Date.now()}`;
    buffer.items.push({
      kind: "assistant_message",
      id,
      timestamp,
      text,
    });
    // Mark this as the currently open assistant segment
    buffer.currentAssistantItemId = id;
    // Set legacy timestamp on first delta
    if (!buffer.assistantMessageTimestamp) {
      buffer.assistantMessageTimestamp = timestamp;
    }
  }

  /**
   * Append thinking text to the live turn buffer.
   * Appends to the currently open thinking segment if one exists,
   * otherwise creates a new thinking item.
   * Tool activity closes the current segment, causing subsequent deltas to create new items.
   * @param eventTimestamp The original event timestamp, if available
   */
  appendThinkingText(roomId: string, delta: string, eventTimestamp?: string): void {
    const state = this.live.get(roomId);
    if (!state?.liveTurnBuffer) return;

    const buffer = state.liveTurnBuffer;
    const ts = eventTimestamp || new Date().toISOString();

    // Check if there's an open thinking segment to append to
    if (buffer.currentThinkingItemId) {
      // Find and append to the open segment
      const existingItem = buffer.items.find(
        (item) => item.kind === "thinking" && item.id === buffer.currentThinkingItemId,
      );
      if (existingItem) {
        existingItem.text = (existingItem.text || "") + delta;
      } else {
        // Segment ID exists but item not found - create new segment
        this._createThinkingSegment(buffer, delta, ts);
      }
    } else {
      // No open segment - create a new one
      this._createThinkingSegment(buffer, delta, ts);
    }

    // Update convenience field
    buffer.thinkingText += delta;
  }

  /**
   * Create a new thinking segment item and mark it as the current open segment.
   */
  private _createThinkingSegment(buffer: LiveTurnBuffer, text: string, timestamp: string): void {
    const id = `live-thinking-${buffer.turnId || Date.now()}-${Date.now()}`;
    buffer.items.push({
      kind: "thinking",
      id,
      timestamp,
      text,
    });
    // Mark this as the currently open thinking segment
    buffer.currentThinkingItemId = id;
    // Set legacy timestamp on first delta
    if (!buffer.thinkingTimestamp) {
      buffer.thinkingTimestamp = timestamp;
    }
  }

  /**
   * Add a tool start item to the live turn buffer.
   * Adds to both the ordered items list and the legacy toolStarts bucket.
   * Closes any open assistant/thinking segments so subsequent deltas create new items.
   * @param eventTimestamp The original event timestamp, if available
   */
  addToolStart(roomId: string, toolCallId: string, toolName: string, toolArgs?: string, eventTimestamp?: string): void {
    const state = this.live.get(roomId);
    if (state?.liveTurnBuffer) {
      const buffer = state.liveTurnBuffer;
      const ts = eventTimestamp || new Date().toISOString();
      const id = `tool-start-${toolCallId}`;

      // Close any open assistant/thinking segments
      buffer.currentAssistantItemId = undefined;
      buffer.currentThinkingItemId = undefined;

      // Add to ordered items list
      buffer.items.push({
        kind: "tool_start",
        id,
        timestamp: ts,
        toolName,
        toolCallId,
        arguments: toolArgs,
      });

      // Also add to legacy bucket for backwards compatibility
      buffer.toolStarts.push({
        id,
        timestamp: ts,
        toolName,
        toolCallId,
        arguments: toolArgs,
      });
    }
  }

  /**
   * Add a tool end item to the live turn buffer.
   * Adds to both the ordered items list and the legacy toolEnds bucket.
   * Keeps assistant/thinking segments closed - subsequent deltas will create new items.
   * @param eventTimestamp The original event timestamp, if available
   */
  addToolEnd(
    roomId: string,
    toolCallId: string,
    toolName: string,
    success: boolean,
    result?: string,
    error?: string,
    eventTimestamp?: string,
  ): void {
    const state = this.live.get(roomId);
    if (state?.liveTurnBuffer) {
      const buffer = state.liveTurnBuffer;
      const ts = eventTimestamp || new Date().toISOString();
      const id = `tool-end-${toolCallId}`;

      // Keep segments closed - subsequent deltas will create new items
      buffer.currentAssistantItemId = undefined;
      buffer.currentThinkingItemId = undefined;

      // Add to ordered items list
      buffer.items.push({
        kind: "tool_end",
        id,
        timestamp: ts,
        toolName,
        toolCallId,
        success,
        result,
        error,
      });

      // Also add to legacy bucket for backwards compatibility
      buffer.toolEnds.push({
        id,
        timestamp: ts,
        toolName,
        toolCallId,
        success,
        result,
        error,
      });
    }
  }

  /**
   * Mark the live turn buffer as inactive (called on turn_end).
   */
  endLiveTurn(roomId: string): void {
    const state = this.live.get(roomId);
    if (state?.liveTurnBuffer) {
      state.liveTurnBuffer.isActive = false;
    }
  }

  /**
   * Get the live turn buffer for a room.
   */
  getLiveTurnBuffer(roomId: string): LiveTurnBuffer | undefined {
    const state = this.live.get(roomId);
    return state?.liveTurnBuffer;
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
export async function parseSessionMetadata(sessionFile: string, baseDir: string): Promise<SessionMetadata> {
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
