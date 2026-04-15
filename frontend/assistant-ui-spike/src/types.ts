/**
 * Server API Types
 *
 * These types mirror the server-side API contracts.
 */

/**
 * Live room data from GET /api/live/rooms/:roomKey
 */
export interface LiveRoom {
  roomId: string;
  roomKey: string;
  sessionId?: string;
  relativeSessionPath?: string;
  isProcessing: boolean;
  processingStartedAt?: string;
  model?: string;
  thinkingLevel?: string;
  toolNames?: string[];
  snapshotAt?: string;
}

/**
 * Transcript response from GET /api/live/rooms/:roomKey/transcript
 */
export interface TranscriptResponse {
  roomId?: string;
  roomKey?: string;
  sessionId: string;
  sessionFile?: string;
  relativeSessionPath?: string;
  items: TranscriptItem[];
}

/**
 * Transcript item types.
 */
export type TranscriptItemKind = 'user_message' | 'assistant_message' | 'tool_start' | 'tool_end' | 'thinking';

/**
 * Base transcript item.
 */
export interface BaseTranscriptItem {
  kind: TranscriptItemKind;
  id: string;
  timestamp: string;
}

/**
 * User message item.
 */
export interface UserMessageItem extends BaseTranscriptItem {
  kind: 'user_message';
  text: string;
}

/**
 * Assistant message item.
 */
export interface AssistantMessageItem extends BaseTranscriptItem {
  kind: 'assistant_message';
  text: string;
  thinking?: string;
}

/**
 * Tool start item.
 */
export interface ToolStartItem extends BaseTranscriptItem {
  kind: 'tool_start';
  toolName: string;
  toolCallId?: string;
  arguments?: string;
}

/**
 * Tool end item.
 */
export interface ToolEndItem extends BaseTranscriptItem {
  kind: 'tool_end';
  toolName: string;
  toolCallId?: string;
  success: boolean;
  result?: string;
}

/**
 * Thinking item.
 */
export interface ThinkingItem extends BaseTranscriptItem {
  kind: 'thinking';
  text: string;
}

/**
 * Union type for transcript items.
 */
export type TranscriptItem =
  | UserMessageItem
  | AssistantMessageItem
  | ToolStartItem
  | ToolEndItem
  | ThinkingItem;

/**
 * Prompt submission response from POST /api/live/rooms/:roomKey/prompt
 */
export interface PromptResponse {
  accepted: boolean;
  roomKey: string;
  roomId: string;
  sessionId: string;
  turnId: string;
  timestamp: string;
}

/**
 * SSE Event Types (normalized WebUI events)
 */
export type WebUIEvent =
  | SessionConnectedEvent
  | TurnStartEvent
  | UserMessageEvent
  | MessageUpdateEvent
  | ToolStartEvent
  | ToolEndEvent
  | TurnEndEvent
  | StateChangeEvent
  | ErrorEvent;

/**
 * Base event metadata.
 */
export interface EventMetadata {
  type: string;
  timestamp: string;
  roomId: string;
  roomKey: string;
}

/**
 * Session connected event.
 */
export interface SessionConnectedEvent extends EventMetadata {
  type: 'session_connected';
  sessionId?: string;
}

/**
 * Turn start event.
 */
export interface TurnStartEvent extends EventMetadata {
  type: 'turn_start';
  turnId: string;
  sessionId: string;
  promptPreview?: string;
}

/**
 * User message event (for Matrix-originated messages where promptPreview wasn't in turn_start).
 */
export interface UserMessageEvent extends EventMetadata {
  type: 'user_message';
  turnId: string;
  sessionId: string;
  promptPreview: string;
}

/**
 * Message update event.
 */
export interface MessageUpdateEvent extends EventMetadata {
  type: 'message_update';
  turnId: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: TextDeltaContent | ThinkingDeltaContent;
}

/**
 * Text content delta.
 */
export interface TextDeltaContent {
  type: 'text_delta';
  delta: string;
}

/**
 * Thinking content delta.
 */
export interface ThinkingDeltaContent {
  type: 'thinking_delta';
  delta: string;
}

/**
 * Tool start event.
 */
export interface ToolStartEvent extends EventMetadata {
  type: 'tool_start';
  toolCallId: string;
  turnId: string;
  sessionId: string;
  toolName: string;
  arguments?: string;
}

/**
 * Tool end event.
 */
export interface ToolEndEvent extends EventMetadata {
  type: 'tool_end';
  toolCallId: string;
  turnId: string;
  sessionId: string;
  toolName: string;
  success: boolean;
  result?: string;
  error?: string;
}

/**
 * Turn end event.
 */
export interface TurnEndEvent extends EventMetadata {
  type: 'turn_end';
  turnId: string;
  sessionId: string;
  success: boolean;
}

/**
 * State change event.
 */
export interface StateChangeEvent extends EventMetadata {
  type: 'state_change';
  sessionId: string;
  changeType:
    | 'processing_start'
    | 'processing_end'
    | 'model_change'
    | 'thinking_level_change'
    | 'session_reset';
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
  type: 'error';
  message: string;
  code?: string;
}
