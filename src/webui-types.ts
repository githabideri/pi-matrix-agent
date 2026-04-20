/**
 * WebUI Event Types
 *
 * Defines the normalized SSE event schema for the Pi-style server-backed WebUI.
 *
 * Design Principles:
 * - Server remains authoritative for all session state
 * - Events are explicit, stable, and consumable without brittle heuristics
 * - Follows Pi agent/core semantics (turn/message/tool lifecycle)
 * - Includes room/session identifiers for proper tracking
 * - Browser never owns sessions, config, providers, or state
 *
 * Phase 1 Event Set:
 * - session_connected: SSE connection established
 * - turn_start: user prompt received
 * - message_update: text/thinking content delta
 * - tool_start: tool execution begins
 * - tool_end: tool execution completes
 * - turn_end: response complete
 * - state_change: processing state changes
 *
 * Legacy Compatibility:
 * - run_start -> turn_start
 * - text_delta -> message_update (content.type = "text_delta")
 * - run_end -> turn_end
 */

/**
 * Common event metadata included in all events.
 */
export interface EventMetadata {
  /** Event type identifier */
  type: string;

  /** ISO 8601 timestamp when event was emitted */
  timestamp: string;

  /** Matrix room ID */
  roomId: string;

  /** Hashed room key for UI identification */
  roomKey: string;
}

/**
 * Emitted when SSE connection is established.
 */
export interface SessionConnectedEvent extends EventMetadata {
  type: "session_connected";

  /** Session ID (optional, may not be known yet) */
  sessionId?: string;
}

/**
 * Emitted immediately after session_connected on SSE connect/reconnect.
 * Contains a backend-authoritative snapshot of the room's current state.
 * Includes both persisted transcript and any in-flight live-turn content.
 */
export interface TranscriptSnapshotEvent extends EventMetadata {
  type: "transcript_snapshot";

  /** Session ID */
  sessionId: string;

  /** Relative path to session file if available */
  relativeSessionPath?: string;

  /** Whether the room is currently processing a turn */
  isProcessing: boolean;

  /** Current transcript items (persisted + live in-flight) */
  items: TranscriptSnapshotItem[];

  /** When this snapshot was generated */
  generatedAt: string;
}

/**
 * Emitted when a new turn begins (user prompt received).
 * Maps from legacy `run_start`.
 */
export interface TurnStartEvent extends EventMetadata {
  type: "turn_start";

  /** Unique turn ID for this request/response cycle */
  turnId: string;

  /** Session ID this turn belongs to */
  sessionId: string;

  /** User prompt text (truncated for privacy) */
  promptPreview?: string;
}

/**
 * Emitted when a user message is received (for Matrix-originated messages
 * where promptPreview wasn't available in turn_start).
 */
export interface UserMessageEvent extends EventMetadata {
  type: "user_message";

  /** Unique turn ID for this request/response cycle */
  turnId: string;

  /** Session ID this turn belongs to */
  sessionId: string;

  /** User prompt text (truncated for privacy) */
  promptPreview: string;
}

/**
 * Emitted when content is appended to a message.
 * Maps from legacy `text_delta`.
 */
export interface MessageUpdateEvent extends EventMetadata {
  type: "message_update";

  /** Unique turn ID */
  turnId: string;

  /** Session ID */
  sessionId: string;

  /** Message role */
  role: "user" | "assistant";

  /** Content delta */
  content: TextDeltaContent | ThinkingDeltaContent;
}

/**
 * Text content delta.
 */
export interface TextDeltaContent {
  type: "text_delta";
  delta: string;
}

/**
 * Thinking content delta.
 */
export interface ThinkingDeltaContent {
  type: "thinking_delta";
  delta: string;
}

/**
 * Emitted when a tool execution begins.
 */
export interface ToolStartEvent extends EventMetadata {
  type: "tool_start";

  /** Unique tool call ID */
  toolCallId: string;

  /** Turn ID */
  turnId: string;

  /** Session ID */
  sessionId: string;

  /** Tool name */
  toolName: string;

  /** Tool arguments (stringified) */
  arguments?: string;
}

/**
 * Emitted when a tool execution completes.
 */
export interface ToolEndEvent extends EventMetadata {
  type: "tool_end";

  /** Unique tool call ID */
  toolCallId: string;

  /** Turn ID */
  turnId: string;

  /** Session ID */
  sessionId: string;

  /** Tool name */
  toolName: string;

  /** Whether execution succeeded */
  success: boolean;

  /** Tool result (stringified, truncated) */
  result?: string;

  /** Error message if failed */
  error?: string;
}

/**
 * Emitted when a turn completes.
 * Maps from legacy `run_end`.
 */
export interface TurnEndEvent extends EventMetadata {
  type: "turn_end";

  /** Unique turn ID */
  turnId: string;

  /** Session ID */
  sessionId: string;

  /** Whether the turn completed successfully */
  success: boolean;
}

/**
 * Emitted when room/session state changes.
 */
export interface StateChangeEvent extends EventMetadata {
  type: "state_change";

  /** Session ID */
  sessionId: string;

  /** Type of state change */
  changeType: "processing_start" | "processing_end" | "model_change" | "thinking_level_change" | "session_reset";

  /** New state values */
  state?: {
    isProcessing?: boolean;
    model?: string;
    thinkingLevel?: string;
  };
}

/**
 * Error event.
 */
export interface ErrorEvent extends EventMetadata {
  type: "error";

  /** Session ID */
  sessionId?: string;

  /** Error message */
  message: string;

  /** Error code */
  code?: string;
}

/**
 * Union type for all WebUI events.
 */
export type WebUIEvent =
  | SessionConnectedEvent
  | TranscriptSnapshotEvent
  | TurnStartEvent
  | UserMessageEvent
  | MessageUpdateEvent
  | ToolStartEvent
  | ToolEndEvent
  | TurnEndEvent
  | StateChangeEvent
  | ErrorEvent;

/**
 * Generate a unique ID for turns.
 * Uses timestamp + random component for uniqueness.
 */
export function generateTurnId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Serialize an event to SSE format.
 */
export function serializeEvent(event: WebUIEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse an SSE data string into an event.
 */
export function parseEvent(data: string): WebUIEvent | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Check if an event is a message update with text content.
 */
export function isTextDelta(event: WebUIEvent): event is MessageUpdateEvent {
  return event.type === "message_update" && event.content.type === "text_delta";
}

/**
 * Check if an event is a message update with thinking content.
 */
export function isThinkingDelta(event: WebUIEvent): event is MessageUpdateEvent {
  return event.type === "message_update" && event.content.type === "thinking_delta";
}

/**
 * Check if an event is a transcript snapshot.
 */
export function isTranscriptSnapshot(event: WebUIEvent): event is TranscriptSnapshotEvent {
  return event.type === "transcript_snapshot";
}

/**
 * Transcript snapshot item types.
 */
export type TranscriptSnapshotItemKind = "user_message" | "assistant_message" | "tool_start" | "tool_end" | "thinking";

/**
 * Base transcript snapshot item.
 */
export interface BaseTranscriptSnapshotItem {
  kind: TranscriptSnapshotItemKind;
  id: string;
  timestamp: string;
}

/**
 * User message snapshot item.
 */
export interface UserMessageSnapshotItem extends BaseTranscriptSnapshotItem {
  kind: "user_message";
  text: string;
}

/**
 * Assistant message snapshot item.
 */
export interface AssistantMessageSnapshotItem extends BaseTranscriptSnapshotItem {
  kind: "assistant_message";
  text: string;
  thinking?: string;
}

/**
 * Tool start snapshot item.
 */
export interface ToolStartSnapshotItem extends BaseTranscriptSnapshotItem {
  kind: "tool_start";
  toolName: string;
  toolCallId?: string;
  arguments?: string;
}

/**
 * Tool end snapshot item.
 */
export interface ToolEndSnapshotItem extends BaseTranscriptSnapshotItem {
  kind: "tool_end";
  toolName: string;
  toolCallId?: string;
  success: boolean;
  result?: string;
}

/**
 * Thinking snapshot item.
 */
export interface ThinkingSnapshotItem extends BaseTranscriptSnapshotItem {
  kind: "thinking";
  text: string;
}

/**
 * Union type for transcript snapshot items.
 */
export type TranscriptSnapshotItem =
  | UserMessageSnapshotItem
  | AssistantMessageSnapshotItem
  | ToolStartSnapshotItem
  | ToolEndSnapshotItem
  | ThinkingSnapshotItem;
