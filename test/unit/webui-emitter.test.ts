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

  it("emits session_connected event on start", async () => {
    await emitter.start(mockSession as AgentSession);

    // Now emits session_connected followed by transcript_snapshot
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[0].type).toBe("session_connected");
    expect(emittedEvents[0].roomId).toBe("!test:example.com");
    expect(emittedEvents[0].roomKey).toBe("test-room-key");
    expect(emittedEvents[0].sessionId).toBe("test-session-123");
  });

  it("handles turn_start event with string content", async () => {
    await emitter.start(mockSession as AgentSession);

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

  it("handles turn_start event with array content (text parts)", async () => {
    await emitter.start(mockSession as AgentSession);

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

  it("handles turn_start event with array content containing non-text parts", async () => {
    await emitter.start(mockSession as AgentSession);

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

  it("handles turn_start event with undefined content", async () => {
    await emitter.start(mockSession as AgentSession);

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

  it("handles message_start event with string content", async () => {
    await emitter.start(mockSession as AgentSession);

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

  it("handles message_start event with array content", async () => {
    await emitter.start(mockSession as AgentSession);

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

  it("handles message_start event for assistant role (no user_message emitted)", async () => {
    await emitter.start(mockSession as AgentSession);

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

  it("handles message_update with text_delta", async () => {
    await emitter.start(mockSession as AgentSession);

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

  it("handles message_update with thinking_delta", async () => {
    await emitter.start(mockSession as AgentSession);

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

  it("truncates promptPreview to 50 characters", async () => {
    await emitter.start(mockSession as AgentSession);

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

  it("regression: promptPreview is always a string, never an array", async () => {
    // Regression test for the bug where promptPreview was emitted as an array
    // instead of a string, causing frontend adapter to fail

    await emitter.start(mockSession as AgentSession);

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

describe("WebUIEmitter - Transcript Snapshot", () => {
  let emitter: WebUIEmitter;
  let mockSession: Partial<AgentSession>;
  let emittedEvents: any[];

  beforeEach(() => {
    emittedEvents = [];

    mockSession = {
      sessionId: "test-session-123",
      subscribe: vi.fn((_callback: any) => {
        return () => {};
      }),
    };
  });

  it("emits session_connected followed by transcript_snapshot on start", async () => {
    emitter = new WebUIEmitter({
      roomId: "!test:example.com",
      roomKey: "test-room-key",
      sessionId: "test-session-123",
      sessionFile: undefined,
      isProcessing: false,
    });

    emitter.onEvent((event) => {
      emittedEvents.push(event);
    });

    await emitter.start(mockSession as AgentSession);

    // Should have emitted session_connected first
    expect(emittedEvents[0].type).toBe("session_connected");
    expect(emittedEvents[0].roomId).toBe("!test:example.com");

    // Should have emitted transcript_snapshot second
    expect(emittedEvents[1].type).toBe("transcript_snapshot");
    expect(emittedEvents[1].roomId).toBe("!test:example.com");
    expect(emittedEvents[1].sessionId).toBe("test-session-123");
  });

  it("snapshot contains correct metadata", async () => {
    emitter = new WebUIEmitter({
      roomId: "!test:example.com",
      roomKey: "test-room-key",
      sessionId: "test-session-123",
      sessionFile: undefined,
      isProcessing: false,
    });

    emitter.onEvent((event) => {
      emittedEvents.push(event);
    });

    await emitter.start(mockSession as AgentSession);

    const snapshot = emittedEvents.find((e: any) => e.type === "transcript_snapshot");
    expect(snapshot).toBeDefined();
    expect(snapshot.roomId).toBe("!test:example.com");
    expect(snapshot.roomKey).toBe("test-room-key");
    expect(snapshot.sessionId).toBe("test-session-123");
    expect(snapshot.isProcessing).toBe(false);
    expect(snapshot.items).toEqual([]); // No session file, empty items
    expect(snapshot.generatedAt).toBeDefined();
  });

  it("snapshot includes isProcessing flag", async () => {
    emitter = new WebUIEmitter({
      roomId: "!test:example.com",
      roomKey: "test-room-key",
      sessionId: "test-session-123",
      sessionFile: undefined,
      isProcessing: true,
    });

    emitter.onEvent((event) => {
      emittedEvents.push(event);
    });

    await emitter.start(mockSession as AgentSession);

    const snapshot = emittedEvents.find((e: any) => e.type === "transcript_snapshot");
    expect(snapshot.isProcessing).toBe(true);
  });

  it("snapshot includes relativeSessionPath when sessionFile is provided", async () => {
    // Create a temp directory and session file for this test
    const fs = await import("fs/promises");
    const tmpDir = await fs.mkdtemp("/tmp/test-");
    const sessionFile = `${tmpDir}/room-abc/test.jsonl`;
    const workingDirectory = tmpDir;

    // Create a minimal session file
    await fs.mkdir(`${tmpDir}/room-abc`, { recursive: true });
    await fs.writeFile(sessionFile, `${JSON.stringify({ type: "session", id: "test-session-123" })}\n`);

    try {
      // Create a fresh emitter for this test with session file
      const testEmitter = new WebUIEmitter({
        roomId: "!test:example.com",
        roomKey: "test-room-key",
        sessionId: "test-session-123",
        sessionFile,
        workingDirectory,
        isProcessing: false,
      });

      // Capture events for this test
      const testEvents: any[] = [];
      testEmitter.onEvent((event) => {
        testEvents.push(event);
      });

      await testEmitter.start(mockSession as AgentSession);

      const snapshot = testEvents.find((e: any) => e.type === "transcript_snapshot");
      expect(snapshot).toBeDefined();
      expect(snapshot.relativeSessionPath).toBe("room-abc/test.jsonl");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
