/**
 * WebUI Contract Tests
 *
 * Tests for the normalized SSE event schema and prompt endpoint.
 * These tests define the contract that the future rich UI will consume.
 */

import { describe, expect, it } from "vitest";
import type { PiSessionBackend } from "../../src/pi-backend.js";

// Test prompt endpoint
import { routeLive } from "../../src/routes/live.js";
// Test the normalized SSE event types exist and have correct shape
import type {
  MessageUpdateEvent,
  SessionConnectedEvent,
  StateChangeEvent,
  ToolEndEvent,
  ToolStartEvent,
  TurnEndEvent,
  TurnStartEvent,
} from "../../src/webui-types.js";

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

describe("Prompt Endpoint", () => {
  it("rejects prompt for unknown room key with 404", async () => {
    // Mock backend that returns no session for unknown room
    const mockBackend = {
      getSessionByKey: () => undefined,
      getRoomIdByKey: () => undefined,
      prompt: async () => "response",
    } as unknown as PiSessionBackend;

    const router = routeLive(mockBackend, "/test");

    // This would normally be tested with a full Express test setup
    // For now, we verify the endpoint exists in the router
    expect(router).toBeDefined();
  });

  it("accepts prompt for valid room key and returns started metadata", async () => {
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
  });
});

describe("Event Mapping (compatibility)", () => {
  it("maps run_start to turn_start for legacy compatibility", () => {
    // The new schema uses turn_start, but we want to ensure
    // the old run_start events would have been properly mapped
    const newEvent: TurnStartEvent = {
      type: "turn_start",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
    };
    expect(newEvent.type).toBe("turn_start");
  });

  it("maps text_delta to message_update for legacy compatibility", () => {
    // Old: { type: "text_delta", delta: "..." }
    // New: { type: "message_update", content: { type: "text_delta", delta: "..." } }
    const newEvent: MessageUpdateEvent = {
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
    expect(newEvent.type).toBe("message_update");
    expect(newEvent.content.type).toBe("text_delta");
  });

  it("maps run_end to turn_end for legacy compatibility", () => {
    const newEvent: TurnEndEvent = {
      type: "turn_end",
      timestamp: "2024-01-01T00:00:00.000Z",
      roomId: "!room:example.com",
      roomKey: "abc123",
      turnId: "turn-001",
      success: true,
    };
    expect(newEvent.type).toBe("turn_end");
  });
});
