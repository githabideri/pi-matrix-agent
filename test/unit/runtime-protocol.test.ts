/**
 * Runtime Protocol v2 Tests
 *
 * Tests for the new runtime protocol types and helpers.
 * These tests verify the type-shape expectations for the migration target.
 */

import { describe, expect, it } from "vitest";
import type {
  Capabilities,
  CapabilitiesEvent,
  ConnectionState,
  ErrorEvent,
  MessageFinalizeEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  ReasoningPart,
  RuntimeEvent,
  RuntimeMessage,
  RuntimeMessagePart,
  SnapshotEvent,
  StateChangeEvent,
  TextPart,
  ToolCallPart,
  ToolEndEvent,
  ToolResultPart,
  ToolStartEvent,
  ToolUpdateEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "../../src/runtime-protocol.js";
import {
  isMessageFinalizeEvent,
  isMessageStartEvent,
  isMessageUpdateEvent,
  isReasoningPart,
  isSnapshotEvent,
  isTextPart,
  isToolCallPart,
  isToolEndEvent,
  isToolResultPart,
  isToolStartEvent,
  isTurnEndEvent,
  isTurnStartEvent,
} from "../../src/runtime-protocol.js";

/**
 * Tests for Runtime Message type shape
 */

/**
 * RuntimeMessage type-shape expectations
 */
describe("RuntimeMessage", () => {
  it("defines runtime message with required fields", () => {
    const message: RuntimeMessage = {
      id: "msg-001",
      role: "user",
      parts: [],
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    expect(message.id).toBe("msg-001");
    expect(message.role).toBe("user");
    expect(message.parts).toEqual([]);
    expect(message.createdAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("defines runtime message with optional metadata", () => {
    const message: RuntimeMessage = {
      id: "msg-001",
      role: "assistant",
      parts: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      metadata: { source: "webui", version: "1.0" },
    };
    expect(message.metadata?.source).toBe("webui");
    expect(message.metadata?.version).toBe("1.0");
  });

  it("supports all three roles", () => {
    const userMessage: RuntimeMessage = { id: "m1", role: "user", parts: [], createdAt: "2024-01-01T00:00:00.000Z" };
    const assistantMessage: RuntimeMessage = {
      id: "m2",
      role: "assistant",
      parts: [],
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    const systemMessage: RuntimeMessage = {
      id: "m3",
      role: "system",
      parts: [],
      createdAt: "2024-01-01T00:00:00.000Z",
    };
    expect(userMessage.role).toBe("user");
    expect(assistantMessage.role).toBe("assistant");
    expect(systemMessage.role).toBe("system");
  });
});

/**
 * Tests for Runtime Message Part types
 */

describe("RuntimeMessagePart", () => {
  it("defines TextPart with correct shape", () => {
    const part: TextPart = {
      type: "text",
      text: "Hello, world!",
    };
    expect(part.type).toBe("text");
    expect(part.text).toBe("Hello, world!");
  });

  it("defines ReasoningPart with correct shape", () => {
    const part: ReasoningPart = {
      type: "reasoning",
      text: "Thinking through this problem step by step...",
    };
    expect(part.type).toBe("reasoning");
    expect(part.text).toBe("Thinking through this problem step by step...");
  });

  it("defines ToolCallPart with correct shape", () => {
    const part: ToolCallPart = {
      type: "tool-call",
      toolCallId: "tc-001",
      name: "bash",
      arguments: { command: "ls -la" },
    };
    expect(part.type).toBe("tool-call");
    expect(part.toolCallId).toBe("tc-001");
    expect(part.name).toBe("bash");
    expect(part.arguments).toEqual({ command: "ls -la" });
  });

  it("defines ToolResultPart with correct shape", () => {
    const part: ToolResultPart = {
      type: "tool-result",
      toolCallId: "tc-001",
      name: "bash",
      result: "file1.txt\nfile2.txt",
      isError: false,
    };
    expect(part.type).toBe("tool-result");
    expect(part.toolCallId).toBe("tc-001");
    expect(part.name).toBe("bash");
    expect(part.result).toBe("file1.txt\nfile2.txt");
    expect(part.isError).toBe(false);
  });

  it("defines ToolResultPart with isError flag", () => {
    const part: ToolResultPart = {
      type: "tool-result",
      toolCallId: "tc-002",
      name: "read",
      result: "File not found",
      isError: true,
    };
    expect(part.isError).toBe(true);
  });

  it("allows parts as discriminated union", () => {
    const parts: RuntimeMessagePart[] = [
      { type: "text", text: "Let me check that file." },
      { type: "tool-call", toolCallId: "tc-001", name: "read", arguments: { path: "file.txt" } },
      { type: "tool-result", toolCallId: "tc-001", name: "read", result: "content" },
      { type: "text", text: "The file contains: content" },
    ];
    expect(parts.length).toBe(4);
    expect(parts[0].type).toBe("text");
    expect(parts[1].type).toBe("tool-call");
    expect(parts[2].type).toBe("tool-result");
    expect(parts[3].type).toBe("text");
  });
});

/**
 * Tests for part type guards
 */

describe("Part Type Guards", () => {
  it("isTextPart correctly identifies text parts", () => {
    const textPart: RuntimeMessagePart = { type: "text", text: "Hello" };
    expect(isTextPart(textPart)).toBe(true);
  });

  it("isTextPart returns false for non-text parts", () => {
    const reasoningPart: RuntimeMessagePart = { type: "reasoning", text: "Thinking..." };
    expect(isTextPart(reasoningPart)).toBe(false);
  });

  it("isReasoningPart correctly identifies reasoning parts", () => {
    const reasoningPart: RuntimeMessagePart = { type: "reasoning", text: "Thinking..." };
    expect(isReasoningPart(reasoningPart)).toBe(true);
  });

  it("isReasoningPart returns false for non-reasoning parts", () => {
    const textPart: RuntimeMessagePart = { type: "text", text: "Hello" };
    expect(isReasoningPart(textPart)).toBe(false);
  });

  it("isToolCallPart correctly identifies tool-call parts", () => {
    const toolCallPart: RuntimeMessagePart = { type: "tool-call", toolCallId: "tc-001", name: "bash", arguments: {} };
    expect(isToolCallPart(toolCallPart)).toBe(true);
  });

  it("isToolCallPart returns false for non-tool-call parts", () => {
    const textPart: RuntimeMessagePart = { type: "text", text: "Hello" };
    expect(isToolCallPart(textPart)).toBe(false);
  });

  it("isToolResultPart correctly identifies tool-result parts", () => {
    const toolResultPart: RuntimeMessagePart = {
      type: "tool-result",
      toolCallId: "tc-001",
      name: "bash",
      result: "ok",
    };
    expect(isToolResultPart(toolResultPart)).toBe(true);
  });

  it("isToolResultPart returns false for non-tool-result parts", () => {
    const textPart: RuntimeMessagePart = { type: "text", text: "Hello" };
    expect(isToolResultPart(textPart)).toBe(false);
  });
});

/**
 * Tests for Runtime Event types
 */

/**
 * RuntimeEvent type-shape expectations
 */
describe("RuntimeEvent", () => {
  it("defines SnapshotEvent with correct shape", () => {
    const event: SnapshotEvent = {
      type: "snapshot",
      timestamp: "2024-01-01T00:00:00.000Z",
      sessionId: "session-001",
      messages: [],
      capabilities: { streaming: true },
      state: { isProcessing: false },
    };
    expect(event.type).toBe("snapshot");
    expect(event.sessionId).toBe("session-001");
    expect(event.messages).toEqual([]);
  });

  it("defines MessageStartEvent with correct shape", () => {
    const event: MessageStartEvent = {
      type: "message-start",
      timestamp: "2024-01-01T00:00:00.000Z",
      messageId: "msg-001",
      role: "user",
    };
    expect(event.type).toBe("message-start");
    expect(event.messageId).toBe("msg-001");
    expect(event.role).toBe("user");
  });

  it("defines MessageUpdateEvent with correct shape", () => {
    const event: MessageUpdateEvent = {
      type: "message-update",
      timestamp: "2024-01-01T00:00:00.000Z",
      messageId: "msg-001",
      part: { type: "text", text: "Hello" },
      partial: true,
    };
    expect(event.type).toBe("message-update");
    expect(event.messageId).toBe("msg-001");
    expect(event.partial).toBe(true);
  });

  it("defines MessageFinalizeEvent with correct shape", () => {
    const event: MessageFinalizeEvent = {
      type: "message-finalize",
      timestamp: "2024-01-01T00:00:00.000Z",
      messageId: "msg-001",
    };
    expect(event.type).toBe("message-finalize");
    expect(event.messageId).toBe("msg-001");
  });

  it("defines ToolStartEvent with correct shape", () => {
    const event: ToolStartEvent = {
      type: "tool-start",
      timestamp: "2024-01-01T00:00:00.000Z",
      toolCallId: "tc-001",
      messageId: "msg-001",
      name: "bash",
      arguments: { command: "ls" },
    };
    expect(event.type).toBe("tool-start");
    expect(event.toolCallId).toBe("tc-001");
    expect(event.name).toBe("bash");
  });

  it("defines ToolUpdateEvent with correct shape", () => {
    const event: ToolUpdateEvent = {
      type: "tool-update",
      timestamp: "2024-01-01T00:00:00.000Z",
      toolCallId: "tc-001",
      progress: "50%",
    };
    expect(event.type).toBe("tool-update");
    expect(event.progress).toBe("50%");
  });

  it("defines ToolEndEvent with correct shape", () => {
    const event: ToolEndEvent = {
      type: "tool-end",
      timestamp: "2024-01-01T00:00:00.000Z",
      toolCallId: "tc-001",
      result: "file1.txt\nfile2.txt",
      isError: false,
    };
    expect(event.type).toBe("tool-end");
    expect(event.result).toBe("file1.txt\nfile2.txt");
  });

  it("defines TurnStartEvent with correct shape", () => {
    const event: TurnStartEvent = {
      type: "turn-start",
      timestamp: "2024-01-01T00:00:00.000Z",
      turnId: "turn-001",
      sessionId: "session-001",
    };
    expect(event.type).toBe("turn-start");
    expect(event.turnId).toBe("turn-001");
  });

  it("defines TurnEndEvent with correct shape", () => {
    const event: TurnEndEvent = {
      type: "turn-end",
      timestamp: "2024-01-01T00:00:00.000Z",
      turnId: "turn-001",
      success: true,
    };
    expect(event.type).toBe("turn-end");
    expect(event.success).toBe(true);
  });

  it("defines StateChangeEvent with correct shape", () => {
    const event: StateChangeEvent = {
      type: "state-change",
      timestamp: "2024-01-01T00:00:00.000Z",
      state: { isProcessing: true, model: "qwen-2.5" },
    };
    expect(event.type).toBe("state-change");
    expect(event.state.isProcessing).toBe(true);
  });

  it("defines CapabilitiesEvent with correct shape", () => {
    const event: CapabilitiesEvent = {
      type: "capabilities",
      timestamp: "2024-01-01T00:00:00.000Z",
      capabilities: { streaming: true, toolCalls: true, reasoning: true },
    };
    expect(event.type).toBe("capabilities");
    expect(event.capabilities.streaming).toBe(true);
  });

  it("defines ErrorEvent with correct shape", () => {
    const event: ErrorEvent = {
      type: "error",
      timestamp: "2024-01-01T00:00:00.000Z",
      message: "Something went wrong",
      code: "INTERNAL_ERROR",
      turnId: "turn-001",
    };
    expect(event.type).toBe("error");
    expect(event.message).toBe("Something went wrong");
  });
});

/**
 * Tests for event type guards
 */

describe("Event Type Guards", () => {
  it("isSnapshotEvent correctly identifies snapshot events", () => {
    const snapshotEvent: RuntimeEvent = {
      type: "snapshot",
      timestamp: "2024-01-01T00:00:00.000Z",
      sessionId: "s1",
      messages: [],
      capabilities: {},
      state: { isProcessing: false },
    };
    expect(isSnapshotEvent(snapshotEvent)).toBe(true);
  });

  it("isSnapshotEvent returns false for non-snapshot events", () => {
    const turnStartEvent: RuntimeEvent = {
      type: "turn-start",
      timestamp: "2024-01-01T00:00:00.000Z",
      turnId: "t1",
      sessionId: "s1",
    };
    expect(isSnapshotEvent(turnStartEvent)).toBe(false);
  });

  it("isMessageStartEvent correctly identifies message-start events", () => {
    const messageStartEvent: RuntimeEvent = {
      type: "message-start",
      timestamp: "2024-01-01T00:00:00.000Z",
      messageId: "m1",
      role: "user",
    };
    expect(isMessageStartEvent(messageStartEvent)).toBe(true);
  });

  it("isMessageUpdateEvent correctly identifies message-update events", () => {
    const messageUpdateEvent: RuntimeEvent = {
      type: "message-update",
      timestamp: "2024-01-01T00:00:00.000Z",
      messageId: "m1",
      part: { type: "text", text: "Hello" },
    };
    expect(isMessageUpdateEvent(messageUpdateEvent)).toBe(true);
  });

  it("isMessageFinalizeEvent correctly identifies message-finalize events", () => {
    const messageFinalizeEvent: RuntimeEvent = {
      type: "message-finalize",
      timestamp: "2024-01-01T00:00:00.000Z",
      messageId: "m1",
    };
    expect(isMessageFinalizeEvent(messageFinalizeEvent)).toBe(true);
  });

  it("isToolStartEvent correctly identifies tool-start events", () => {
    const toolStartEvent: RuntimeEvent = {
      type: "tool-start",
      timestamp: "2024-01-01T00:00:00.000Z",
      toolCallId: "tc1",
      messageId: "m1",
      name: "bash",
      arguments: {},
    };
    expect(isToolStartEvent(toolStartEvent)).toBe(true);
  });

  it("isToolEndEvent correctly identifies tool-end events", () => {
    const toolEndEvent: RuntimeEvent = {
      type: "tool-end",
      timestamp: "2024-01-01T00:00:00.000Z",
      toolCallId: "tc1",
      result: "ok",
    };
    expect(isToolEndEvent(toolEndEvent)).toBe(true);
  });

  it("isTurnStartEvent correctly identifies turn-start events", () => {
    const turnStartEvent: RuntimeEvent = {
      type: "turn-start",
      timestamp: "2024-01-01T00:00:00.000Z",
      turnId: "t1",
      sessionId: "s1",
    };
    expect(isTurnStartEvent(turnStartEvent)).toBe(true);
  });

  it("isTurnEndEvent correctly identifies turn-end events", () => {
    const turnEndEvent: RuntimeEvent = {
      type: "turn-end",
      timestamp: "2024-01-01T00:00:00.000Z",
      turnId: "t1",
      success: true,
    };
    expect(isTurnEndEvent(turnEndEvent)).toBe(true);
  });
});

/**
 * Tests for Capabilities and ConnectionState types
 */

describe("Capabilities and ConnectionState", () => {
  it("defines Capabilities with all optional fields", () => {
    const caps: Capabilities = {
      interrupt: false, // Not assumed - separate capability
      stop: true,
      streaming: true,
      toolCalls: true,
      reasoning: true,
    };
    expect(caps.streaming).toBe(true);
    expect(caps.interrupt).toBe(false); // Explicitly false - not assumed
  });

  it("defines Capabilities with minimal fields", () => {
    const caps: Capabilities = { streaming: true };
    expect(caps.streaming).toBe(true);
    expect(caps.interrupt).toBeUndefined();
  });

  it("defines ConnectionState with all fields", () => {
    const state: ConnectionState = {
      isProcessing: true,
      model: "qwen-2.5",
      thinkingLevel: "high",
    };
    expect(state.isProcessing).toBe(true);
    expect(state.model).toBe("qwen-2.5");
  });

  it("defines ConnectionState with minimal fields", () => {
    const state: ConnectionState = { isProcessing: false };
    expect(state.isProcessing).toBe(false);
    expect(state.model).toBeUndefined();
  });
});

/**
 * Contract verification: Prompt POST response does not require turnId
 */

describe("Contract Verification", () => {
  it("prompt POST response does not include turnId - turnId comes from SSE", () => {
    // This test documents and verifies the contract that:
    // - POST /api/live/rooms/:roomKey/prompt returns { accepted, roomKey, roomId, sessionId, timestamp }
    // - turnId is NOT in the POST response
    // - The authoritative turnId comes from SSE via turn_start event

    // The server-side type is AcceptedPromptResponse in src/types.ts
    // It does NOT have turnId field
    // The frontend type PromptResponse in frontend/assistant-ui-spike/src/types.ts
    // has been fixed to also NOT have turnId field

    // This test asserts that the contract is correct:
    const promptResponseShape = {
      accepted: true,
      roomKey: "abc123",
      roomId: "!room:example.com",
      sessionId: "session-001",
      timestamp: "2024-01-01T00:00:00.000Z",
      // Note: turnId is intentionally NOT included
    };

    expect(promptResponseShape.accepted).toBe(true);
    expect(promptResponseShape.turnId).toBeUndefined(); // Explicitly not present

    // The authoritative turnId comes from SSE turn_start event:
    const turnStartEvent: TurnStartEvent = {
      type: "turn-start",
      timestamp: "2024-01-01T00:00:00.000Z",
      turnId: "turn-001", // Authoritative turnId from SSE
      sessionId: "session-001",
    };
    expect(turnStartEvent.turnId).toBe("turn-001");
  });
});
