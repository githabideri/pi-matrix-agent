export type IncomingMessage = {
  roomId: string;
  eventId: string;
  sender: string;
  body: string;
};

export type ParsedCommand =
  | { kind: "command_help" }
  | { kind: "command_ping" }
  | { kind: "command_status" }
  | { kind: "command_reset" }
  | { kind: "command_session" }
  | { kind: "command_control" }
  | { kind: "command_model_status" }
  | { kind: "command_model_switch"; profile: string }
  | { kind: "command_model_clear" }
  | { kind: "chat_prompt"; prompt: string };

export interface AgentBackend {
  prompt(roomId: string, text: string): Promise<string>;
}

export interface ModelStatus {
  active: boolean;
  model?: string;
  thinkingLevel?: string;
  sessionId?: string;
  sessionFile?: string;
  isProcessing?: boolean;

  // Phase 2: Per-room desired model state
  desiredModel?: string;
  desiredResolvedModelId?: string;
  globalDefault?: string;
  modelMismatch?: boolean;
}

export interface ModelSwitchResult {
  success: boolean;
  message: string;
  requestedProfile: string;
  resolvedModel?: string;
  activeModel?: string;
}

export interface ModelClearResult {
  success: boolean;
  message: string;
  previousDesiredModel?: string;
}

// Room info for control URL generation
export interface RoomInfo {
  roomKey: string;
}

// Phase 2: Per-room desired model state types
export interface RoomModelState {
  desiredModel: string; // Profile name (e.g., "qwen27", "qwen36")
  resolvedModelId?: string; // Resolved model ID
  updatedAt: string; // ISO timestamp
}

export interface RoomModelsStore {
  rooms: Record<string, RoomModelState>;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface InferenceConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxTokens?: number;
}

export interface ReplySink {
  reply(roomId: string, eventId: string, text: string): Promise<void>;
}

export interface RouterConfig {
  allowedRoomIds: string[];
  allowedUserIds: string[];
  agent: AgentBackend;
  sink: ReplySink;
}

// ============================================================================
// Control Plane Response Types
// ============================================================================

/**
 * Live room list item (GET /api/live/rooms)
 */
export interface LiveRoomListItem {
  roomId: string;
  roomKey: string;
  sessionId?: string;
  relativeSessionPath?: string;
  isProcessing: boolean;
  processingStartedAt?: string;
}

/**
 * Live room detail (GET /api/live/rooms/:roomKey)
 */
export interface LiveRoomDetail {
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
  desiredModel?: string;
  desiredResolvedModelId?: string;
}

/**
 * Context response (GET /api/live/rooms/:roomKey/context)
 */
export interface ContextResponse {
  roomId: string;
  roomKey: string;
  sessionId?: string;
  relativeSessionPath?: string;
  workingDirectory: string;
  model?: string;
  thinkingLevel?: string;
  isProcessing: boolean;
  isStreaming?: boolean;
  processingStartedAt?: string;
  toolNames: string[];
  resourceLoaderType: string;
  contextSources: unknown[];
  generatedAt: string;
  snapshotAt?: string;
}

/**
 * Accepted prompt response (POST /api/live/rooms/:roomKey/prompt)
 */
export interface AcceptedPromptResponse {
  accepted: true;
  roomKey: string;
  roomId: string;
  sessionId?: string;
  timestamp: string;
}

/**
 * Archive session list item (GET /api/archive/rooms/:roomKey/sessions)
 */
export interface ArchiveSessionListItem {
  sessionId: string;
  relativeSessionPath: string;
  firstMessage: string;
}

/**
 * Archive session metadata response (GET /api/archive/rooms/:roomKey/sessions/:sessionId)
 */
export interface ArchiveSessionMetadataResponse {
  sessionId?: string;
  relativeSessionPath: string;
  firstMessage: string;
  isLive: false;
}

// ============================================================================
// Backend Internal Types
// ============================================================================

/**
 * Settings object as stored in settings.json.
 */
export interface SettingsJson {
  globalDefault?: string;
  [key: string]: any;
}

/**
 * Internal session info for archived sessions.
 */
export interface InternalSessionInfo {
  path: string;
  id: string;
  firstMessage: string;
}
