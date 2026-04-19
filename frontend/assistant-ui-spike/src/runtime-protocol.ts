/**
 * Runtime Protocol v2 Types (Frontend)
 *
 * This module mirrors the server-side runtime protocol types for the Pi WebUI/runtime migration.
 * These types are **additive** and do not replace existing WebUI types.
 *
 * ## Design Principles
 *
 * - **Server-authoritative**: All state originates from the server
 * - **Canonical shapes**: Well-defined types for messages, parts, and events
 * - **Additive migration**: Existing code continues to work while new protocol layers on top
 *
 * ## Runtime Message Model
 *
 * A runtime message represents a single turn of communication.
 *
 * ```typescript
 * interface RuntimeMessage {
 *   id: string;           // Server-generated unique ID
 *   role: "user" | "assistant" | "system";
 *   parts: RuntimeMessagePart[];  // Ordered parts
 *   createdAt: string;    // ISO 8601 timestamp
 *   metadata?: { [key: string]: unknown };  // Optional metadata
 * }
 * ```
 *
 * ## Runtime Message Parts
 *
 * A message part represents a single unit of content within a message.
 *
 * ```typescript
 * type RuntimeMessagePart =
 *   | TextPart
 *   | ReasoningPart
 *   | ToolCallPart
 *   | ToolResultPart;
 *
 * interface TextPart { type: "text"; text: string; }
 * interface ReasoningPart { type: "reasoning"; text: string; }
 * interface ToolCallPart { type: "tool-call"; toolCallId: string; name: string; arguments: unknown; }
 * interface ToolResultPart { type: "tool-result"; toolCallId: string; name: string; result: string; isError?: boolean; }
 * ```
 *
 * ## Runtime Events
 *
 * SSE stream events that describe state changes.
 *
 * ```typescript
 * type RuntimeEvent =
 *   | SnapshotEvent
 *   | MessageStartEvent
 *   | MessageUpdateEvent
 *   | MessageFinalizeEvent
 *   | ToolStartEvent
 *   | ToolUpdateEvent
 *   | ToolEndEvent
 *   | TurnStartEvent
 *   | TurnEndEvent
 *   | StateChangeEvent
 *   | CapabilitiesEvent
 *   | ErrorEvent;
 * ```
 *
 * ## Migration Notes
 *
 * **Current state does NOT match this protocol yet.**
 *
 * - Transcript returns `TranscriptItem[]`, not `RuntimeMessage[]`
 * - Events use WebUI schema, not runtime event schema
 * - No snapshot event on connection
 * - No message-start/update/finalize events
 * - Parts are flat kinds, not nested discriminated union
 *
 * See `docs/runtime-protocol-v2.md` for full migration strategy.
 */

/**
 * Runtime Message Role
 */
export type RuntimeMessageRole = "user" | "assistant" | "system";

/**
 * Runtime Message
 *
 * Represents a single turn of communication.
 * Server-generated ID, ordered parts, creation timestamp.
 */
export interface RuntimeMessage {
  /** Server-generated unique message ID */
  id: string;

  /** Message role */
  role: RuntimeMessageRole;

  /** Ordered parts within the message */
  parts: RuntimeMessagePart[];

  /** ISO 8601 creation timestamp */
  createdAt: string;

  /** Optional metadata */
  metadata?: {
    [key: string]: unknown;
  };
}

/**
 * Runtime Message Part Types
 */
export type RuntimeMessagePart =
  | TextPart
  | ReasoningPart
  | ToolCallPart
  | ToolResultPart;

/**
 * Text content part
 */
export interface TextPart {
  type: "text";
  text: string;
}

/**
 * Reasoning/thinking content part
 */
export interface ReasoningPart {
  type: "reasoning";
  text: string;
}

/**
 * Tool call part
 */
export interface ToolCallPart {
  type: "tool-call";
  toolCallId: string;  // Server-generated tool call ID
  name: string;        // Tool name
  arguments: unknown;  // Tool arguments (structured object)
}

/**
 * Tool result part
 */
export interface ToolResultPart {
  type: "tool-result";
  toolCallId: string;  // References the tool call
  name: string;        // Tool name
  result: string;      // Result text
  isError?: boolean;   // Whether this is an error result
}

/**
 * Runtime Event Types
 *
 * SSE stream events that describe state changes.
 * These are the target event types for the migration.
 */
export type RuntimeEvent =
  | SnapshotEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageFinalizeEvent
  | ToolStartEvent
  | ToolUpdateEvent
  | ToolEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | StateChangeEvent
  | CapabilitiesEvent
  | ErrorEvent;

/**
 * Common event metadata
 */
export interface EventMetadata {
  type: string;
  timestamp: string;
}

/**
 * Snapshot Event
 *
 * Emitted when SSE connection opens, providing initial state.
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface SnapshotEvent extends EventMetadata {
  type: "snapshot";
  sessionId: string;
  messages: RuntimeMessage[];  // Historical messages
  capabilities: Capabilities;  // Available capabilities
  state: ConnectionState;      // Current connection state
}

/**
 * Message Start Event
 *
 * Emitted when a new message begins.
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface MessageStartEvent extends EventMetadata {
  type: "message-start";
  messageId: string;
  role: RuntimeMessageRole;
}

/**
 * Message Update Event
 *
 * Emitted when a message is updated (part appended/modified).
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface MessageUpdateEvent extends EventMetadata {
  type: "message-update";
  messageId: string;
  part: RuntimeMessagePart;  // New or updated part
  partial?: boolean;          // true if content is incomplete
}

/**
 * Message Finalize Event
 *
 * Emitted when a message is complete.
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface MessageFinalizeEvent extends EventMetadata {
  type: "message-finalize";
  messageId: string;
}

/**
 * Tool Start Event
 *
 * Emitted when a tool call begins.
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface ToolStartEvent extends EventMetadata {
  type: "tool-start";
  toolCallId: string;
  messageId: string;    // Parent message
  name: string;
  arguments: unknown;
}

/**
 * Tool Update Event
 *
 * Emitted when a tool call is updated (progress/streaming).
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface ToolUpdateEvent extends EventMetadata {
  type: "tool-update";
  toolCallId: string;
  progress?: string;    // Progress indicator
}

/**
 * Tool End Event
 *
 * Emitted when a tool call completes.
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface ToolEndEvent extends EventMetadata {
  type: "tool-end";
  toolCallId: string;
  result: string;
  isError?: boolean;
}

/**
 * Turn Start Event
 *
 * Emitted when a turn begins.
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface TurnStartEvent extends EventMetadata {
  type: "turn-start";
  turnId: string;
  sessionId: string;
}

/**
 * Turn End Event
 *
 * Emitted when a turn ends.
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface TurnEndEvent extends EventMetadata {
  type: "turn-end";
  turnId: string;
  success: boolean;
  error?: string;
}

/**
 * State Change Event
 *
 * Emitted when connection state changes.
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface StateChangeEvent extends EventMetadata {
  type: "state-change";
  state: ConnectionState;
}

/**
 * Capabilities Event
 *
 * Emitted when capabilities change.
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface CapabilitiesEvent extends EventMetadata {
  type: "capabilities";
  capabilities: Capabilities;
}

/**
 * Error Event
 *
 * Emitted when an error occurs.
 * NOT YET IMPLEMENTED - this is a target event type.
 */
export interface ErrorEvent extends EventMetadata {
  type: "error";
  message: string;
  code?: string;
  turnId?: string;    // Associated turn if applicable
}

/**
 * Connection State
 *
 * Describes the current state of the connection.
 */
export interface ConnectionState {
  isProcessing: boolean;
  model?: string;
  thinkingLevel?: string;
}

/**
 * Capabilities
 *
 * Describes what the runtime supports.
 *
 * Note: interrupt is a separate capability and is NOT assumed.
 */
export interface Capabilities {
  interrupt?: boolean;    // Can interrupt ongoing turns?
  stop?: boolean;         // Can stop ongoing turns?
  streaming?: boolean;    // Does streaming work?
  toolCalls?: boolean;    // Are tool calls supported?
  reasoning?: boolean;    // Is reasoning/thinking supported?
}

/**
 * Type Guards
 *
 * Helper functions for discriminating message parts and events.
 */

/**
 * Check if a part is a text part
 */
export function isTextPart(part: RuntimeMessagePart): part is TextPart {
  return part.type === "text";
}

/**
 * Check if a part is a reasoning part
 */
export function isReasoningPart(part: RuntimeMessagePart): part is ReasoningPart {
  return part.type === "reasoning";
}

/**
 * Check if a part is a tool call part
 */
export function isToolCallPart(part: RuntimeMessagePart): part is ToolCallPart {
  return part.type === "tool-call";
}

/**
 * Check if a part is a tool result part
 */
export function isToolResultPart(part: RuntimeMessagePart): part is ToolResultPart {
  return part.type === "tool-result";
}

/**
 * Check if an event is a snapshot event
 */
export function isSnapshotEvent(event: RuntimeEvent): event is SnapshotEvent {
  return event.type === "snapshot";
}

/**
 * Check if an event is a message start event
 */
export function isMessageStartEvent(event: RuntimeEvent): event is MessageStartEvent {
  return event.type === "message-start";
}

/**
 * Check if an event is a message update event
 */
export function isMessageUpdateEvent(event: RuntimeEvent): event is MessageUpdateEvent {
  return event.type === "message-update";
}

/**
 * Check if an event is a message finalize event
 */
export function isMessageFinalizeEvent(event: RuntimeEvent): event is MessageFinalizeEvent {
  return event.type === "message-finalize";
}

/**
 * Check if an event is a tool start event
 */
export function isToolStartEvent(event: RuntimeEvent): event is ToolStartEvent {
  return event.type === "tool-start";
}

/**
 * Check if an event is a tool end event
 */
export function isToolEndEvent(event: RuntimeEvent): event is ToolEndEvent {
  return event.type === "tool-end";
}

/**
 * Check if an event is a turn start event
 */
export function isTurnStartEvent(event: RuntimeEvent): event is TurnStartEvent {
  return event.type === "turn-start";
}

/**
 * Check if an event is a turn end event
 */
export function isTurnEndEvent(event: RuntimeEvent): event is TurnEndEvent {
  return event.type === "turn-end";
}
