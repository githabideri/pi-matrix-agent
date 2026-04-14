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

// Phase 2: Per-room desired model state types
export interface RoomModelState {
  desiredModel: string; // Profile name (e.g., "qwen27", "gemma4")
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
