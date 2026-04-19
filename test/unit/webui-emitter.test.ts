/**
 * WebUIEmitter Unit Tests
 *
 * Tests for the WebUIEmitter class that converts Pi agent events to WebUI events.
 */

import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebUIEmitter } from "../../src/webui-emitter.js";

describe("WebUIEmitter", () => {
  let emitter: WebUIEmitter;
  let mockSession: Partial<AgentSession>;
  let emittedEvents: any[];

  beforeEach(() => {
    emittedEvents = [];

    mockSession = {
      sessionId: "test-session-123",
      subscribe: vi.fn((_callback: any) => {
        // Return unsubscribe function
        return () => {};
      }),
    };

    emitter = new WebUIEmitter({
      roomId: "!test:example.com",
      roomKey: "test-room-key",
      sessionId: "test-session-123",
    });

    // Capture emitted events
    emitter.onEvent((event) => {
      emittedEvents.push(event);
    });
  });

  it("emits session_connected event on start", () => {
    emitter.start(mockSession as AgentSession);

    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe("session_connected");
    expect(emittedEvents[0].roomId).toBe("!test:example.com");
    expect(emittedEvents[0].roomKey).toBe("test-room-key");
    expect(emittedEvents[0].sessionId).toBe("test-session-123");
  });

  it("handles turn_start event with string content", () => {
    emitter.start(mockSession as AgentSession);

    // Simulate turn_start event with string content
    (mockSession.subscribe as ReturnType<typeof vi.fn>)(mockSession.subscribe!.mock.calls[0][0]);

    const turnStartEvent = {
      type: "turn_start",
      userMessage: {
        content: "Hello, this is a test prompt",
      },
    };

    // Find and call the subscriber
    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(turnStartEvent);

    // Should have emitted session_connected + turn_start
    const turnStart = emittedEvents.find((e) => e.type === "turn_start");
    expect(turnStart).toBeDefined();
    expect(turnStart!.promptPreview).toBe("Hello, this is a test prompt");
    expect(typeof turnStart!.promptPreview).toBe("string");
  });

  it("handles turn_start event with array content (text parts)", () => {
    emitter.start(mockSession as AgentSession);

    const turnStartEvent = {
      type: "turn_start",
      userMessage: {
        content: [
          { type: "text", text: "Hello, " },
          { type: "text", text: "this is a " },
          { type: "text", text: "test prompt" },
        ],
      },
    };

    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(turnStartEvent);

    const turnStart = emittedEvents.find((e) => e.type === "turn_start");
    expect(turnStart).toBeDefined();
    // Should concatenate text parts into a single string
    expect(turnStart!.promptPreview).toBe("Hello, this is a test prompt");
    expect(typeof turnStart!.promptPreview).toBe("string");
  });

  it("handles turn_start event with array content containing non-text parts", () => {
    emitter.start(mockSession as AgentSession);

    const turnStartEvent = {
      type: "turn_start",
      userMessage: {
        content: [
          { type: "text", text: "Hello, " },
          { type: "image", source: "..." }, // Non-text part should be ignored
          { type: "text", text: "test" },
        ],
      },
    };

    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(turnStartEvent);

    const turnStart = emittedEvents.find((e) => e.type === "turn_start");
    expect(turnStart).toBeDefined();
    // Should only extract text parts
    expect(turnStart!.promptPreview).toBe("Hello, test");
    expect(typeof turnStart!.promptPreview).toBe("string");
  });

  it("handles turn_start event with undefined content", () => {
    emitter.start(mockSession as AgentSession);

    const turnStartEvent = {
      type: "turn_start",
      userMessage: {
        content: undefined,
      },
    };

    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(turnStartEvent);

    const turnStart = emittedEvents.find((e) => e.type === "turn_start");
    expect(turnStart).toBeDefined();
    expect(turnStart!.promptPreview).toBeUndefined();
  });

  it("handles message_start event with string content", () => {
    emitter.start(mockSession as AgentSession);

    const messageStartEvent = {
      type: "message_start",
      message: {
        role: "user",
        content: "User message content",
      },
    };

    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(messageStartEvent);

    const userMessage = emittedEvents.find((e) => e.type === "user_message");
    expect(userMessage).toBeDefined();
    expect(userMessage!.promptPreview).toBe("User message content");
    expect(typeof userMessage!.promptPreview).toBe("string");
  });

  it("handles message_start event with array content", () => {
    emitter.start(mockSession as AgentSession);

    const messageStartEvent = {
      type: "message_start",
      message: {
        role: "user",
        content: [
          { type: "text", text: "Part 1" },
          { type: "text", text: " Part 2" },
        ],
      },
    };

    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(messageStartEvent);

    const userMessage = emittedEvents.find((e) => e.type === "user_message");
    expect(userMessage).toBeDefined();
    expect(userMessage!.promptPreview).toBe("Part 1 Part 2");
    expect(typeof userMessage!.promptPreview).toBe("string");
  });

  it("handles message_start event for assistant role (no user_message emitted)", () => {
    emitter.start(mockSession as AgentSession);

    const messageStartEvent = {
      type: "message_start",
      message: {
        role: "assistant",
        content: "Assistant message",
      },
    };

    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(messageStartEvent);

    // Should not emit user_message for assistant messages
    const userMessage = emittedEvents.find((e) => e.type === "user_message");
    expect(userMessage).toBeUndefined();
  });

  it("handles message_update with text_delta", () => {
    emitter.start(mockSession as AgentSession);

    // First emit turn_start to set currentTurnId
    const turnStartEvent = {
      type: "turn_start",
      userMessage: { content: "Test prompt" },
    };
    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(turnStartEvent);

    // Then emit message_update
    const messageUpdateEvent = {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        delta: "Hello, world!",
      },
    };
    subscriber(messageUpdateEvent);

    const messageUpdate = emittedEvents.find((e) => e.type === "message_update" && e.content.type === "text_delta");
    expect(messageUpdate).toBeDefined();
    expect(messageUpdate!.content.delta).toBe("Hello, world!");
  });

  it("handles message_update with thinking_delta", () => {
    emitter.start(mockSession as AgentSession);

    // First emit turn_start to set currentTurnId
    const turnStartEvent = {
      type: "turn_start",
      userMessage: { content: "Test prompt" },
    };
    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(turnStartEvent);

    // Then emit message_update
    const messageUpdateEvent = {
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "Thinking through the problem...",
      },
    };
    subscriber(messageUpdateEvent);

    const messageUpdate = emittedEvents.find((e) => e.type === "message_update" && e.content.type === "thinking_delta");
    expect(messageUpdate).toBeDefined();
    expect(messageUpdate!.content.delta).toBe("Thinking through the problem...");
  });

  it("truncates promptPreview to 50 characters", () => {
    emitter.start(mockSession as AgentSession);

    const longPrompt = "A".repeat(100);
    const turnStartEvent = {
      type: "turn_start",
      userMessage: { content: longPrompt },
    };

    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(turnStartEvent);

    const turnStart = emittedEvents.find((e) => e.type === "turn_start");
    expect(turnStart!.promptPreview).toBe("A".repeat(50));
  });

  it("regression: promptPreview is always a string, never an array", () => {
    // Regression test for the bug where promptPreview was emitted as an array
    // instead of a string, causing frontend adapter to fail

    emitter.start(mockSession as AgentSession);

    // Test with array content (the bug scenario)
    const turnStartEvent = {
      type: "turn_start",
      userMessage: {
        content: [
          { type: "text", text: "Hello, " },
          { type: "text", text: "world!" },
        ],
      },
    };

    const subscriber = mockSession.subscribe!.mock.calls[0][0];
    subscriber(turnStartEvent);

    const turnStart = emittedEvents.find((e) => e.type === "turn_start");
    expect(turnStart).toBeDefined();

    // The critical assertion: promptPreview must be a string
    expect(typeof turnStart!.promptPreview).toBe("string");
    expect(Array.isArray(turnStart!.promptPreview)).toBe(false);

    // Should be able to call string methods without error
    expect(turnStart!.promptPreview.startsWith("Hello")).toBe(true);
    expect(turnStart!.promptPreview.includes("world")).toBe(true);
  });
});
