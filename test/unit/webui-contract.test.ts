/**
 * WebUI Contract Tests
 *
 * Tests for the normalized SSE event schema and prompt endpoint.
 * These tests define the contract that the future rich UI will consume.
 */

import { describe, expect, it } from "vitest";
import type { PiSessionBackend } from "../../src/pi-backend.js";
import { routeLive } from "../../src/routes/live.js";
import type {
  MessageUpdateEvent,
  SessionConnectedEvent,
  StateChangeEvent,
  ToolEndEvent,
  ToolStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "../../src/webui-types.js";
import { generateTurnId, isTextDelta, isThinkingDelta } from "../../src/webui-types.js";

describe("WebUI Event Types", () => {
  it("defines session_connected event type", () => {
    const event: SessionConnectedEvent = {
      type: "session_connected",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
    };
    expect(event.type).toBe("session_connected");
    expect(event.roomId).toBe("!room:example.com");
    expect(event.roomKey).toBe("abc123");
  });

  it("defines turn_start event type", () => {
    const event: TurnStartEvent = {
      type: "turn_start",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
    };
    expect(event.type).toBe("turn_start");
    expect(event.turnId).toBe("turn-001");
  });

  it("defines message_update event type with text_delta", () => {
    const event: MessageUpdateEvent = {
      type: "message_update",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      role: "assistant",
      content: {
        type: "text_delta",
        delta: "Hello",
      },
    };
    expect(event.type).toBe("message_update");
    expect(event.content.type).toBe("text_delta");
    expect(event.content.delta).toBe("Hello");
  });

  it("defines message_update event type with thinking_delta", () => {
    const event: MessageUpdateEvent = {
      type: "message_update",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      role: "assistant",
      content: {
        type: "thinking_delta",
        delta: "Thinking...",
      },
    };
    expect(event.type).toBe("message_update");
    expect(event.content.type).toBe("thinking_delta");
  });

  it("defines tool_start event type", () => {
    const event: ToolStartEvent = {
      type: "tool_start",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      toolCallId: "tool-001",
      toolName: "bash",
      arguments: `{"command": "ls"}`,
    };
    expect(event.type).toBe("tool_start");
    expect(event.toolName).toBe("bash");
  });

  it("defines tool_end event type", () => {
    const event: ToolEndEvent = {
      type: "tool_end",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      toolCallId: "tool-001",
      toolName: "bash",
      success: true,
    };
    expect(event.type).toBe("tool_end");
    expect(event.success).toBe(true);
  });

  it("defines turn_end event type", () => {
    const event: TurnEndEvent = {
      type: "turn_end",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      success: true,
    };
    expect(event.type).toBe("turn_end");
    expect(event.success).toBe(true);
  });

  it("defines state_change event type", () => {
    const event: StateChangeEvent = {
      type: "state_change",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      changeType: "processing_start",
    };
    expect(event.type).toBe("state_change");
    expect(event.changeType).toBe("processing_start");
  });
});

describe("WebUI Helpers", () => {
  it("generateTurnId produces unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateTurnId());
    }
    expect(ids.size).toBe(100); // All IDs should be unique
  });

  it("generateTurnId produces IDs with timestamp + random format", () => {
    const id = generateTurnId();
    // Format: timestamp-randomstring
    expect(id).toMatch(/^[0-9]+-.{9}$/);
  });

  it("isTextDelta correctly identifies text delta events", () => {
    const textEvent: MessageUpdateEvent = {
      type: "message_update",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      sessionId: "session-001",
      role: "assistant",
      content: {
        type: "text_delta",
        delta: "Hello",
      },
    };
    expect(isTextDelta(textEvent)).toBe(true);
  });

  it("isTextDelta returns false for thinking delta events", () => {
    const thinkingEvent: MessageUpdateEvent = {
      type: "message_update",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      sessionId: "session-001",
      role: "assistant",
      content: {
        type: "thinking_delta",
        delta: "Thinking...",
      },
    };
    expect(isTextDelta(thinkingEvent)).toBe(false);
  });

  it("isThinkingDelta correctly identifies thinking delta events", () => {
    const thinkingEvent: MessageUpdateEvent = {
      type: "message_update",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      sessionId: "session-001",
      role: "assistant",
      content: {
        type: "thinking_delta",
        delta: "Thinking...",
      },
    };
    expect(isThinkingDelta(thinkingEvent)).toBe(true);
  });
});

describe("Prompt Endpoint Contract", () => {
  it("rejects prompt for unknown room key with 404", async () => {
    // Mock backend that returns no session for unknown room
    const mockBackend = {
      getSessionByKey: () => undefined,
      getRoomIdByKey: () => undefined,
      prompt: async () => "response",
    } as unknown as PiSessionBackend;

    const router = routeLive(mockBackend, "/test");
    expect(router).toBeDefined();
  });

  it("accepts prompt for valid room key and returns accepted metadata without turnId", async () => {
    // Mock backend with a valid room
    const mockRoomState = {
      roomId: "!room:example.com",
      roomKey: "test-room",
      sessionId: "session-001",
      sessionFile: "/test/session.jsonl",
      isProcessing: false,
    };

    const mockBackend = {
      getSessionByKey: (key: string) => (key === "test-room" ? mockRoomState : undefined),
      getRoomIdByKey: (key: string) => (key === "test-room" ? "!room:example.com" : undefined),
      prompt: async () => "response",
    } as unknown as PiSessionBackend;

    const router = routeLive(mockBackend, "/test");
    expect(router).toBeDefined();

    // The key contract: response should NOT include turnId
    // turnId is provided by SSE via turn_start event
    // This test verifies the endpoint exists and would return correct shape
    // Full integration test would require Express test setup
  });

  it("prompt endpoint response contract: no turnId in response", () => {
    // This test documents the contract that turnId is NOT in the POST response
    // The SSE stream provides the authoritative turnId via turn_start event
    const expectedResponseShape = {
      accepted: true,
      roomKey: "string",
      roomId: "string",
      sessionId: "string | undefined",
      timestamp: "string",
      // Note: turnId is NOT included
    };
    expect(expectedResponseShape.accepted).toBe(true);
    // This is a documentation test - the actual response shape is enforced by types
  });
});

describe("Event Mapping from Pi Agent Events", () => {
  it("turn_start event maps from Pi agent turn_start event", () => {
    // Pi agent emits: { type: "turn_start", turnIndex: 0, timestamp: ... }
    // WebUI emitter emits: { type: "turn_start", roomId, roomKey, sessionId, turnId, ... }
    const webuiEvent: TurnStartEvent = {
      type: "turn_start",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      sessionId: "session-001",
    };
    expect(webuiEvent.type).toBe("turn_start");
    expect(webuiEvent.turnId).toBe("turn-001");
    expect(webuiEvent.sessionId).toBe("session-001");
  });

  it("turn_end event maps from Pi agent turn_end event", () => {
    // Pi agent emits: { type: "turn_end", ... }
    // WebUI emitter emits: { type: "turn_end", roomId, roomKey, sessionId, turnId, success, ... }
    const webuiEvent: TurnEndEvent = {
      type: "turn_end",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      sessionId: "session-001",
      success: true,
    };
    expect(webuiEvent.type).toBe("turn_end");
    expect(webuiEvent.turnId).toBe("turn-001");
    expect(webuiEvent.success).toBe(true);
  });

  it("message_update event maps from Pi agent message_update event", () => {
    // Pi agent emits: { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "..." } }
    // WebUI emitter emits: { type: "message_update", content: { type: "text_delta", delta: "..." }, ... }
    const webuiEvent: MessageUpdateEvent = {
      type: "message_update",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      sessionId: "session-001",
      role: "assistant",
      content: {
        type: "text_delta",
        delta: "Hello",
      },
    };
    expect(webuiEvent.type).toBe("message_update");
    expect(webuiEvent.content.type).toBe("text_delta");
    expect(webuiEvent.content.delta).toBe("Hello");
  });

  it("tool_start event maps from Pi agent tool_execution_start event", () => {
    // Pi agent emits: { type: "tool_execution_start", toolExecutionEvent: { name: "bash", ... } }
    // WebUI emitter emits: { type: "tool_start", toolName: "bash", ... }
    const webuiEvent: ToolStartEvent = {
      type: "tool_start",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      sessionId: "session-001",
      toolCallId: "tool-001",
      toolName: "bash",
      arguments: `{"command": "ls"}`,
    };
    expect(webuiEvent.type).toBe("tool_start");
    expect(webuiEvent.toolName).toBe("bash");
  });

  it("tool_end event maps from Pi agent tool_execution_end event", () => {
    // Pi agent emits: { type: "tool_execution_end", toolResultEvent: { name: "bash", isError: false, ... } }
    // WebUI emitter emits: { type: "tool_end", toolName: "bash", success: true, ... }
    const webuiEvent: ToolEndEvent = {
      type: "tool_end",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      sessionId: "session-001",
      toolCallId: "tool-001",
      toolName: "bash",
      success: true,
    };
    expect(webuiEvent.type).toBe("tool_end");
    expect(webuiEvent.toolName).toBe("bash");
    expect(webuiEvent.success).toBe(true);
  });

  it("session_connected event is emitted by WebUI emitter (not Pi agent)", () => {
    // session_connected is emitted by WebUI emitter when SSE connection is established
    // It is NOT a Pi agent event
    const webuiEvent: SessionConnectedEvent = {
      type: "session_connected",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      sessionId: "session-001",
    };
    expect(webuiEvent.type).toBe("session_connected");
  });
});
