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
 * SSE event types
 */
export type SSEEventType = "run_start" | "run_end" | "text_delta" | "tool_start" | "tool_end" | "state_change";

export interface SSEEvent {
  type: SSEEventType;
  data: any;
}
