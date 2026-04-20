/**
 * WebUI SSE Event Emitter
 *
 * Wraps a Pi agent session and emits normalized WebUI events.
 * Converts Pi agent/core events to the WebUI event schema.
 *
 * Design:
 * - Emits events in real-time as they occur
 * - Maintains turn state for proper event sequencing
 * - Can be attached to HTTP response streams for SSE
 * - Handles cleanup on disconnect
 * - Emits an initial transcript snapshot on connect for rehydration
 */

import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { Response } from "express";
import type { LiveTurnBuffer } from "./room-state.js";
import { buildAuthoritativeTranscript } from "./transcript.js";
import type { TranscriptSnapshotItem, WebUIEvent } from "./webui-types.js";
import { generateTurnId } from "./webui-types.js";

export interface WebUIEmitterOptions {
  /** Matrix room ID */
  roomId: string;

  /** Hashed room key */
  roomKey: string;

  /** Current session ID */
  sessionId: string;

  /** Session file path (if available) */
  sessionFile?: string;

  /** Base directory for resolving relative paths */
  workingDirectory?: string;

  /** Whether the room is currently processing */
  isProcessing?: boolean;

  /** Live turn buffer for in-flight content */
  liveTurnBuffer?: LiveTurnBuffer;
}

export class WebUIEmitter {
  private roomId: string;
  private _roomKey: string;
  private sessionId: string;
  private sessionFile?: string;
  private workingDirectory?: string;
  private isProcessing?: boolean;
  private liveTurnBuffer?: LiveTurnBuffer;

  /** Public getter for roomKey (used by attachEmitterToSSE) */
  get roomKey(): string {
    return this._roomKey;
  }

  // State tracking
  private currentTurnId?: string;

  // Subscription
  private unsubscribe?: () => void;
  private eventListeners: Array<(event: WebUIEvent) => void> = [];

  constructor(options: WebUIEmitterOptions) {
    this.roomId = options.roomId;
    this._roomKey = options.roomKey;
    this.sessionId = options.sessionId;
    this.sessionFile = options.sessionFile;
    this.workingDirectory = options.workingDirectory;
    this.isProcessing = options.isProcessing ?? false;
    this.liveTurnBuffer = options.liveTurnBuffer;
  }

  /**
   * Add an event listener.
   */
  onEvent(listener: (event: WebUIEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const idx = this.eventListeners.indexOf(listener);
      if (idx >= 0) {
        this.eventListeners.splice(idx, 1);
      }
    };
  }

  /**
   * Start emitting events from the session.
   * Emits session_connected followed by transcript_snapshot for rehydration.
   */
  async start(session: AgentSession): Promise<void> {
    // Clear any previous state
    this.clearState();

    // Subscribe to session events
    this.unsubscribe = session.subscribe((event) => {
      this.handleAgentEvent(event);
    });

    // Emit session_connected event
    this.emit({
      type: "session_connected",
      roomId: this.roomId,
      roomKey: this._roomKey,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
    });

    // Emit transcript snapshot for immediate rehydration
    await this.emitTranscriptSnapshot();
  }

  /**
   * Emit the initial transcript snapshot event.
   * This provides a backend-authoritative snapshot of the room's current state.
   */
  private async emitTranscriptSnapshot(): Promise<void> {
    try {
      // Use the canonical builder for authoritative transcript
      const items = await buildAuthoritativeTranscript(
        this.sessionId,
        this.sessionFile,
        this.liveTurnBuffer,
        this.isProcessing ?? false,
        { baseDir: this.workingDirectory },
      );

      // Build relative session path
      let relativeSessionPath: string | undefined;
      if (this.sessionFile && this.workingDirectory) {
        relativeSessionPath = this.sessionFile.replace(this.workingDirectory, "");
        if (relativeSessionPath.startsWith("/")) {
          relativeSessionPath = relativeSessionPath.slice(1);
        }
      }

      // Emit the snapshot event
      this.emit({
        type: "transcript_snapshot",
        roomId: this.roomId,
        roomKey: this._roomKey,
        sessionId: this.sessionId,
        relativeSessionPath,
        isProcessing: this.isProcessing ?? false,
        items: items as TranscriptSnapshotItem[],
        generatedAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`[WebUIEmitter] Error generating transcript snapshot:`, error);
      // Don't crash the SSE connection - emit an error event instead
      this.emit({
        type: "error",
        roomId: this.roomId,
        roomKey: this._roomKey,
        sessionId: this.sessionId,
        message: "Failed to generate transcript snapshot",
        code: "SNAPSHOT_ERROR",
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Stop emitting events.
   */
  stop(): void {
    // Unsubscribe
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    // Clear state
    this.clearState();
  }

  /**
   * Handle Pi agent events and convert to WebUI events.
   */
  private handleAgentEvent(event: any): void {
    switch (event.type) {
      case "turn_start":
        this.handleTurnStart(event);
        break;

      case "message_start":
        this.handleMessageStart(event);
        break;

      case "turn_end":
        this.handleTurnEnd(event);
        break;

      case "message_update":
        this.handleMessageUpdate(event);
        break;

      case "tool_execution_start":
        this.handleToolStart(event);
        break;

      case "tool_execution_end":
        this.handleToolEnd(event);
        break;
    }
  }

  private handleTurnStart(event: any): void {
    this.currentTurnId = generateTurnId();

    // Extract prompt preview from user message content if available
    // Content can be a string or an array of content parts
    let promptPreview: string | undefined;
    if (event.userMessage?.content) {
      if (typeof event.userMessage.content === "string") {
        promptPreview = event.userMessage.content.slice(0, 50);
      } else if (Array.isArray(event.userMessage.content)) {
        // Extract text from content parts
        const textParts = event.userMessage.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text)
          .join("");
        promptPreview = textParts.slice(0, 50);
      }
    }

    this.emit({
      type: "turn_start",
      roomId: this.roomId,
      roomKey: this._roomKey,
      sessionId: this.sessionId,
      turnId: this.currentTurnId!,
      promptPreview,
      timestamp: new Date().toISOString(),
    });
  }

  private handleMessageStart(event: any): void {
    // Handle user message start - emit prompt content if available
    // This captures user messages that weren't included in turn_start
    const message = event.message;
    if (message?.role === "user" && message.content) {
      // Extract text from content - can be string or array of content parts
      let promptPreview: string;
      if (typeof message.content === "string") {
        promptPreview = message.content.slice(0, 50);
      } else if (Array.isArray(message.content)) {
        // Extract text from content parts
        const textParts = message.content
          .filter((part: any) => part.type === "text")
          .map((part: any) => part.text)
          .join("");
        promptPreview = textParts.slice(0, 50);
      } else {
        return; // Unknown content format
      }

      // Emit a user_message event with the prompt content
      this.emit({
        type: "user_message",
        roomId: this.roomId,
        roomKey: this._roomKey,
        sessionId: this.sessionId,
        turnId: this.currentTurnId!,
        promptPreview,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private handleTurnEnd(event: any): void {
    const turnId = this.currentTurnId;

    this.emit({
      type: "turn_end",
      roomId: this.roomId,
      roomKey: this._roomKey,
      sessionId: this.sessionId,
      turnId: turnId!,
      success: !event.error,
      timestamp: new Date().toISOString(),
    });

    // Clear turn state
    this.currentTurnId = undefined;
  }

  private handleMessageUpdate(event: any): void {
    const assistantMessageEvent = event.assistantMessageEvent;
    if (!assistantMessageEvent) return;

    switch (assistantMessageEvent.type) {
      case "text_delta":
        this.emit({
          type: "message_update",
          roomId: this.roomId,
          roomKey: this._roomKey,
          sessionId: this.sessionId,
          turnId: this.currentTurnId!,
          role: "assistant",
          content: {
            type: "text_delta",
            delta: assistantMessageEvent.delta,
          },
          timestamp: new Date().toISOString(),
        });
        break;

      case "thinking_delta":
        this.emit({
          type: "message_update",
          roomId: this.roomId,
          roomKey: this._roomKey,
          sessionId: this.sessionId,
          turnId: this.currentTurnId!,
          role: "assistant",
          content: {
            type: "thinking_delta",
            delta: assistantMessageEvent.delta,
          },
          timestamp: new Date().toISOString(),
        });
        break;
    }
  }

  private handleToolStart(event: any): void {
    const toolExecutionEvent = event.toolExecutionEvent;
    if (!toolExecutionEvent) return;

    this.emit({
      type: "tool_start",
      roomId: this.roomId,
      roomKey: this._roomKey,
      sessionId: this.sessionId,
      toolCallId: toolExecutionEvent.toolCallId || generateTurnId(),
      turnId: this.currentTurnId!,
      toolName: toolExecutionEvent.name,
      arguments: JSON.stringify(toolExecutionEvent.arguments),
      timestamp: new Date().toISOString(),
    });
  }

  private handleToolEnd(event: any): void {
    const toolResultEvent = event.toolResultEvent;
    if (!toolResultEvent) return;

    this.emit({
      type: "tool_end",
      roomId: this.roomId,
      roomKey: this._roomKey,
      sessionId: this.sessionId,
      toolCallId: toolResultEvent.toolCallId || generateTurnId(),
      turnId: this.currentTurnId!,
      toolName: toolResultEvent.name,
      success: !toolResultEvent.isError,
      result: String(toolResultEvent.result || "").slice(0, 500),
      error: toolResultEvent.isError ? String(toolResultEvent.error) : undefined,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Clear all tracked state.
   */
  private clearState(): void {
    this.currentTurnId = undefined;
  }

  /**
   * Emit an event to all listeners.
   */
  private emit(event: WebUIEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[WebUIEmitter] Error in event listener:", err);
      }
    }
  }
}

/**
 * Create an SSE response handler that streams WebUI events.
 */
export function attachEmitterToSSE(res: Response, emitter: WebUIEmitter): () => void {
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Track cleanup
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    emitter.stop();
    res.end();
  };

  // Handle client disconnect
  res.on("close", cleanup);

  // Set up event handler
  emitter.onEvent((event: WebUIEvent) => {
    try {
      // Write event to SSE stream
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (err) {
      console.error(`[SSE] Error writing event:`, err);
      cleanup();
    }
  });

  return cleanup;
}
