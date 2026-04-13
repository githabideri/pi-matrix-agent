/**
 * Transcript item types matching src/transcript.ts
 */
export type TranscriptItemKind = "user_message" | "assistant_message" | "tool_start" | "tool_end" | "thinking";

export interface TranscriptItem {
  kind: TranscriptItemKind;
  id: string;
  timestamp: string;
}

export interface UserMessageItem extends TranscriptItem {
  kind: "user_message";
  text: string;
}

export interface AssistantMessageItem extends TranscriptItem {
  kind: "assistant_message";
  text: string;
  thinking?: string;
}

export interface ToolStartItem extends TranscriptItem {
  kind: "tool_start";
  toolName: string;
  toolCallId?: string;
}

export interface ToolEndItem extends TranscriptItem {
  kind: "tool_end";
  toolName: string;
  toolCallId?: string;
  success: boolean;
  result?: string;
}

export interface ThinkingItem extends TranscriptItem {
  kind: "thinking";
  text: string;
}

export type AnyTranscriptItem = UserMessageItem | AssistantMessageItem | ToolStartItem | ToolEndItem | ThinkingItem;

export interface TranscriptResponse {
  sessionId: string;
  roomKey?: string;
  roomId?: string;
  sessionFile?: string;
  relativeSessionPath?: string;
  items: AnyTranscriptItem[];
}

/**
 * Live room response from /api/live/rooms/:roomKey
 */
export interface LiveRoomResponse {
  roomId: string;
  roomKey: string;
  sessionId?: string;
  relativeSessionPath?: string;
  model?: string;
  workingDirectory?: string;
  isProcessing: boolean;
  isStreaming: boolean;
  processingStartedAt?: string;
  lastEventAt?: string;
}

/**
 * Context manifest response from /api/live/rooms/:roomKey/context
 */
export interface ContextManifestResponse {
  resourceLoaderType: string;
  toolNames: string[];
  contextSources: {
    type: string;
    path: string;
    relativePath: string;
    description?: string;
  }[];
  generatedAt: string;
}

/**
 * Archive session response from /api/archive/rooms/:roomKey/sessions
 */
export interface ArchiveSession {
  sessionId: string;
  relativeSessionPath: string;
  firstMessage?: string;
}

/**
 * SSE Event Types (Normalized WebUI Schema)
 *
 * The new normalized event schema:
 * - session_connected: SSE connection established
 * - turn_start: user prompt received (maps from legacy run_start)
 * - message_update: text/thinking content delta (maps from legacy text_delta)
 * - tool_start: tool execution begins
 * - tool_end: tool execution completes
 * - turn_end: response complete (maps from legacy run_end)
 * - state_change: processing state changes
 *
 * Legacy compatibility: old event names are still supported for backwards compatibility
 */

/**
 * SSE event types (new normalized schema)
 */
export type SSEEventType =
  | "session_connected"
  | "turn_start"
  | "message_update"
  | "tool_start"
  | "tool_end"
  | "turn_end"
  | "state_change"
  | "error"
  // Legacy compatibility
  | "run_start"
  | "run_end"
  | "text_delta";

/**
 * Common event metadata
 */
interface BaseSSEEvent {
  type: SSEEventType;
  timestamp: string;
  roomId?: string;
  roomKey?: string;
}

/**
 * SSE event for session_connected
 */
export interface SessionConnectedEvent extends BaseSSEEvent {
  type: "session_connected";
  sessionId?: string;
}

/**
 * SSE event for turn_start (maps from legacy run_start)
 */
export interface TurnStartEvent extends BaseSSEEvent {
  type: "turn_start";
  turnId: string;
  sessionId: string;
  promptPreview?: string;
}

/**
 * SSE event for message_update (maps from legacy text_delta)
 */
export interface MessageUpdateEvent extends BaseSSEEvent {
  type: "message_update";
  turnId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: TextDeltaContent | ThinkingDeltaContent;
}

/**
 * Text content delta
 */
export interface TextDeltaContent {
  type: "text_delta";
  delta: string;
}

/**
 * Thinking content delta
 */
export interface ThinkingDeltaContent {
  type: "thinking_delta";
  delta: string;
}

/**
 * SSE event for tool_start
 */
export interface ToolStartEvent extends BaseSSEEvent {
  type: "tool_start";
  toolCallId: string;
  turnId: string;
  sessionId: string;
  toolName: string;
  arguments?: string;
}

/**
 * SSE event for tool_end
 */
export interface ToolEndEvent extends BaseSSEEvent {
  type: "tool_end";
  toolCallId: string;
  turnId: string;
  sessionId: string;
  toolName: string;
  success: boolean;
  result?: string;
  error?: string;
}

/**
 * SSE event for turn_end (maps from legacy run_end)
 */
export interface TurnEndEvent extends BaseSSEEvent {
  type: "turn_end";
  turnId: string;
  sessionId: string;
  success: boolean;
}

/**
 * SSE event for state_change
 */
export interface StateChangeEvent extends BaseSSEEvent {
  type: "state_change";
  sessionId: string;
  changeType: "processing_start" | "processing_end" | "model_change" | "thinking_level_change" | "session_reset";
  state?: {
    isProcessing?: boolean;
    model?: string;
    thinkingLevel?: string;
  };
}

/**
 * SSE event for error
 */
export interface ErrorEvent extends BaseSSEEvent {
  type: "error";
  message: string;
  code?: string;
}

/**
 * Legacy SSE events for backwards compatibility
 */
export interface RunStartEvent {
  type: "run_start";
  timestamp: string;
}

export interface RunEndEvent {
  type: "run_end";
  timestamp: string;
}

export interface TextDeltaEvent {
  type: "text_delta";
  delta: string;
  timestamp: string;
}

/**
 * Union type for all SSE events - new normalized schema + legacy compatibility
 */
export type SSEEvent =
  | SessionConnectedEvent
  | TurnStartEvent
  | MessageUpdateEvent
  | ToolStartEvent
  | ToolEndEvent
  | TurnEndEvent
  | StateChangeEvent
  | ErrorEvent
  // Legacy compatibility
  | RunStartEvent
  | RunEndEvent
  | TextDeltaEvent;

/**
 * Check if an event is a message update with text content
 */
export function isTextDelta(event: SSEEvent): event is MessageUpdateEvent {
  return event.type === "message_update" && (event as MessageUpdateEvent).content.type === "text_delta";
}

/**
 * Check if an event is a legacy text_delta event
 */
export function isLegacyTextDelta(event: SSEEvent): event is TextDeltaEvent {
  return event.type === "text_delta";
}

/**
 * Extract text delta from any event type (handles both new and legacy formats)
 */
export function getTextDelta(event: SSEEvent): string | null {
  if (event.type === "message_update" && (event as MessageUpdateEvent).content.type === "text_delta") {
    return (event as MessageUpdateEvent).content.delta;
  }
  if (event.type === "text_delta") {
    return (event as TextDeltaEvent).delta;
  }
  return null;
}
