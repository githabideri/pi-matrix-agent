import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyLiveTurnBuffer, type LiveTurnBuffer, RoomStateManager } from "../../src/room-state.js";
import { liveTurnBufferToTranscriptItems, mergeTranscriptItems, type TranscriptItem } from "../../src/transcript.js";

/**
 * Tests for live current-turn transcript buffer functionality.
 *
 * Milestone 2.1 correctness pass:
 * - Event ordering preservation
 * - Deduplication correctness
 * - Timestamp fidelity
 */

describe("Live turn buffer creation", () => {
  it("creates an empty buffer with correct defaults", () => {
    const buffer = createEmptyLiveTurnBuffer();

    expect(buffer.isActive).toBe(false);
    expect(buffer.turnId).toBeUndefined();
    expect(buffer.turnStartedAt).toBeUndefined();
    expect(buffer.items).toEqual([]);
    expect(buffer.assistantText).toBe("");
    expect(buffer.thinkingText).toBe("");
    expect(buffer.userPrompt).toBeUndefined();
    expect(buffer.toolStarts).toEqual([]);
    expect(buffer.toolEnds).toEqual([]);
  });
});

describe("liveTurnBufferToTranscriptItems - Event Ordering", () => {
  it("preserves event order: user -> assistant -> tool_start -> tool_end -> assistant continuation", () => {
    // Simulate a turn where assistant text, then tool, then more assistant text
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-123",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      userPrompt: "What files are here?",
      userMessageTimestamp: "2024-01-01T00:00:00.100Z",
      assistantText: "Let me check\n\nHere are the files:",
      thinkingText: "I need to list files",
      assistantMessageTimestamp: "2024-01-01T00:00:01.000Z",
      thinkingTimestamp: "2024-01-01T00:00:00.500Z",
      // Ordered items list (authoritative for event order)
      items: [
        {
          kind: "user_message",
          id: "live-user-turn-123",
          timestamp: "2024-01-01T00:00:00.100Z",
          text: "What files are here?",
        },
        {
          kind: "thinking",
          id: "live-thinking-turn-123",
          timestamp: "2024-01-01T00:00:00.500Z",
          text: "I need to list files",
        },
        {
          kind: "assistant_message",
          id: "live-assistant-turn-123",
          timestamp: "2024-01-01T00:00:01.000Z",
          text: "Let me check",
        },
        {
          kind: "tool_start",
          id: "tool-start-tc1",
          timestamp: "2024-01-01T00:00:02.000Z",
          toolName: "bash",
          toolCallId: "tc1",
          arguments: '{"command": "ls -la"}',
        },
        {
          kind: "tool_end",
          id: "tool-end-tc1",
          timestamp: "2024-01-01T00:00:03.000Z",
          toolName: "bash",
          toolCallId: "tc1",
          success: true,
          result: "total 100",
        },
        {
          kind: "assistant_message",
          id: "live-assistant-turn-123-cont",
          timestamp: "2024-01-01T00:00:04.000Z",
          text: "\n\nHere are the files:",
        },
      ],
      toolStarts: [
        {
          id: "tool-start-tc1",
          timestamp: "2024-01-01T00:00:02.000Z",
          toolName: "bash",
          toolCallId: "tc1",
          arguments: '{"command": "ls -la"}',
        },
      ],
      toolEnds: [
        {
          id: "tool-end-tc1",
          timestamp: "2024-01-01T00:00:03.000Z",
          toolName: "bash",
          toolCallId: "tc1",
          success: true,
          result: "total 100",
        },
      ],
    };

    const items = liveTurnBufferToTranscriptItems(buffer);

    // Should preserve exact event order from items list
    expect(items).toHaveLength(6);
    expect(items[0].kind).toBe("user_message");
    expect(items[1].kind).toBe("thinking");
    expect(items[2].kind).toBe("assistant_message");
    expect(items[2].text).toBe("Let me check");
    expect(items[3].kind).toBe("tool_start");
    expect(items[4].kind).toBe("tool_end");
    expect(items[5].kind).toBe("assistant_message");
    expect(items[5].text).toBe("\n\nHere are the files:");
  });

  it("preserves order: assistant -> tool_start -> tool_end without thinking", () => {
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-456",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      userPrompt: "Run ls",
      userMessageTimestamp: "2024-01-01T00:00:00.100Z",
      assistantText: "Running ls",
      assistantMessageTimestamp: "2024-01-01T00:00:01.000Z",
      items: [
        {
          kind: "user_message",
          id: "live-user-turn-456",
          timestamp: "2024-01-01T00:00:00.100Z",
          text: "Run ls",
        },
        {
          kind: "assistant_message",
          id: "live-assistant-turn-456",
          timestamp: "2024-01-01T00:00:01.000Z",
          text: "Running ls",
        },
        {
          kind: "tool_start",
          id: "tool-start-tc1",
          timestamp: "2024-01-01T00:00:02.000Z",
          toolName: "bash",
          toolCallId: "tc1",
        },
        {
          kind: "tool_end",
          id: "tool-end-tc1",
          timestamp: "2024-01-01T00:00:03.000Z",
          toolName: "bash",
          toolCallId: "tc1",
          success: true,
        },
      ],
      toolStarts: [],
      toolEnds: [],
    };

    const items = liveTurnBufferToTranscriptItems(buffer);

    expect(items).toHaveLength(4);
    expect(items[0].kind).toBe("user_message");
    expect(items[1].kind).toBe("assistant_message");
    expect(items[2].kind).toBe("tool_start");
    expect(items[3].kind).toBe("tool_end");
  });

  it("returns empty array for undefined buffer", () => {
    const items = liveTurnBufferToTranscriptItems(undefined);
    expect(items).toEqual([]);
  });

  it("returns empty array for inactive buffer", () => {
    const buffer = createEmptyLiveTurnBuffer();
    buffer.isActive = false;
    buffer.items = [{ kind: "user_message", id: "1", timestamp: "2024-01-01T00:00:00.000Z", text: "test" }];

    const items = liveTurnBufferToTranscriptItems(buffer);
    expect(items).toEqual([]);
  });

  it("uses original event timestamps when present", () => {
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-ts",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      userPrompt: "Test",
      userMessageTimestamp: "2024-01-01T00:00:00.100Z",
      items: [
        {
          kind: "user_message",
          id: "live-user-turn-ts",
          timestamp: "2024-01-01T00:00:00.100Z",
          text: "Test",
        },
        {
          kind: "assistant_message",
          id: "live-assistant-turn-ts",
          timestamp: "2024-01-01T00:00:01.500Z",
          text: "Response",
        },
      ],
      assistantText: "Response",
      thinkingText: "",
      toolStarts: [],
      toolEnds: [],
    };

    const items = liveTurnBufferToTranscriptItems(buffer);

    expect(items[0].timestamp).toBe("2024-01-01T00:00:00.100Z");
    expect(items[1].timestamp).toBe("2024-01-01T00:00:01.500Z");
  });
});

describe("mergeTranscriptItems - Deduplication Correctness", () => {
  it("removes only the actual duplicated user message, not the last element", () => {
    // Scenario: Last persisted item is assistant_message, but user_message before it is duplicate
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "Hi!", timestamp: "2024-01-01T00:00:01.000Z" },
      { kind: "user_message", id: "p3", text: "Current prompt", timestamp: "2024-01-01T00:00:02.000Z" },
      { kind: "assistant_message", id: "p4", text: "Partial response", timestamp: "2024-01-01T00:00:03.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "Current prompt", timestamp: "2024-01-01T00:00:02.100Z" },
      { kind: "assistant_message", id: "l2", text: "More response", timestamp: "2024-01-01T00:00:04.000Z" },
    ];

    const result = mergeTranscriptItems(persisted, live);

    // Should remove p3 (the duplicate user_message), but keep p4 (assistant after it)
    expect(result).toHaveLength(5); // p1, p2, p4, l1, l2
    expect(result.map((i) => i.id)).toEqual(["p1", "p2", "p4", "l1", "l2"]);
    expect(result.filter((i) => i.kind === "user_message")).toHaveLength(2); // p1, l1
  });

  it("handles duplicate where last persisted item is tool_end", () => {
    // Scenario: Last persisted item is tool_end, user_message is earlier
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "Hi!", timestamp: "2024-01-01T00:00:01.000Z" },
      { kind: "user_message", id: "p3", text: "Run ls", timestamp: "2024-01-01T00:00:02.000Z" },
      { kind: "tool_start", id: "p4", toolName: "bash", timestamp: "2024-01-01T00:00:03.000Z" },
      { kind: "tool_end", id: "p5", toolName: "bash", success: true, timestamp: "2024-01-01T00:00:04.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "Run ls", timestamp: "2024-01-01T00:00:02.100Z" },
      { kind: "assistant_message", id: "l2", text: "Here are files", timestamp: "2024-01-01T00:00:05.000Z" },
    ];

    const result = mergeTranscriptItems(persisted, live);

    // Should remove p3 (duplicate user_message), keep p4, p5 (tool items after it)
    expect(result).toHaveLength(6); // p1, p2, p4, p5, l1, l2
    expect(result.map((i) => i.id)).toEqual(["p1", "p2", "p4", "p5", "l1", "l2"]);
    // Verify tool items are preserved
    expect(result.some((i) => i.id === "p4" && i.kind === "tool_start")).toBe(true);
    expect(result.some((i) => i.id === "p5" && i.kind === "tool_end")).toBe(true);
  });

  it("does not deduplicate when prompts are different", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "Hi!", timestamp: "2024-01-01T00:00:01.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "Different prompt", timestamp: "2024-01-01T00:00:02.000Z" },
    ];

    const result = mergeTranscriptItems(persisted, live);

    expect(result).toHaveLength(3);
    expect(result.filter((i) => i.kind === "user_message")).toHaveLength(2); // Both preserved
  });

  it("handles deduplication with fuzzy matching (substring)", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "user_message", id: "p2", text: "Current", timestamp: "2024-01-01T00:00:02.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "Current prompt text", timestamp: "2024-01-01T00:00:02.100Z" },
    ];

    const result = mergeTranscriptItems(persisted, live);

    // Should deduplicate since "Current" is substring of "Current prompt text"
    expect(result.filter((i) => i.kind === "user_message")).toHaveLength(2); // p1, l1
    expect(result.map((i) => i.id)).toEqual(["p1", "l1"]);
  });

  it("returns persisted items when no live items", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
    ];

    const result = mergeTranscriptItems(persisted, []);

    expect(result).toEqual(persisted);
  });

  it("returns live items when no persisted items", () => {
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "New prompt", timestamp: "2024-01-01T00:00:02.000Z" },
    ];

    const result = mergeTranscriptItems([], live);

    expect(result).toEqual(live);
  });
});

describe("mergeTranscriptItems - Event Order Preservation", () => {
  it("preserves historical order AND live event order", () => {
    // Prior conversation
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "What's the weather?", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "It's sunny!", timestamp: "2024-01-01T00:00:01.000Z" },
    ];

    // Current live turn with interleaved events
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "List files", timestamp: "2024-01-01T00:00:10.000Z" },
      { kind: "assistant_message", id: "l2", text: "Sure", timestamp: "2024-01-01T00:00:11.000Z" },
      { kind: "tool_start", id: "l3", toolName: "bash", timestamp: "2024-01-01T00:00:12.000Z" },
      { kind: "tool_end", id: "l4", toolName: "bash", success: true, timestamp: "2024-01-01T00:00:13.000Z" },
      { kind: "assistant_message", id: "l5", text: "Here they are", timestamp: "2024-01-01T00:00:14.000Z" },
    ];

    const merged = mergeTranscriptItems(persisted, live);

    // Verify historical order preserved
    expect(merged[0].id).toBe("p1");
    expect(merged[1].id).toBe("p2");

    // Verify live event order preserved (including interleaving)
    expect(merged[2].id).toBe("l1"); // user
    expect(merged[3].id).toBe("l2"); // assistant
    expect(merged[4].id).toBe("l3"); // tool_start
    expect(merged[5].id).toBe("l4"); // tool_end
    expect(merged[6].id).toBe("l5"); // assistant continuation
  });

  it("preserves tool items from live buffer", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "Run ls", timestamp: "2024-01-01T00:00:01.000Z" },
      { kind: "tool_start", id: "t1", toolName: "bash", timestamp: "2024-01-01T00:00:02.000Z" },
      { kind: "tool_end", id: "t2", toolName: "bash", success: true, timestamp: "2024-01-01T00:00:03.000Z" },
    ];

    const result = mergeTranscriptItems(persisted, live);

    expect(result).toHaveLength(4);
    expect(result.filter((i) => i.kind === "tool_start")).toHaveLength(1);
    expect(result.filter((i) => i.kind === "tool_end")).toHaveLength(1);
  });
});

describe("Reload during processing scenarios", () => {
  it("simulates reload with prior conversation + current in-flight turn", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "What's the weather?", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "It's sunny!", timestamp: "2024-01-01T00:00:01.000Z" },
    ];

    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "What files are here?", timestamp: "2024-01-01T00:00:10.000Z" },
      { kind: "thinking", id: "l2", text: "I need to use bash to list files.", timestamp: "2024-01-01T00:00:10.500Z" },
      { kind: "assistant_message", id: "l3", text: "Let me check", timestamp: "2024-01-01T00:00:11.000Z" },
    ];

    const merged = mergeTranscriptItems(persisted, live);

    // Verify prior conversation is preserved
    expect(merged.some((i) => i.text === "What's the weather?")).toBe(true);
    expect(merged.some((i) => i.text === "It's sunny!" && i.kind === "assistant_message")).toBe(true);

    // Verify current in-flight turn is included
    expect(merged.some((i) => i.text === "What files are here?")).toBe(true);
    expect(merged.some((i) => i.text === "I need to use bash to list files." && i.kind === "thinking")).toBe(true);
    expect(merged.some((i) => i.text === "Let me check" && i.kind === "assistant_message")).toBe(true);

    // Verify correct order
    expect(merged[0].text).toBe("What's the weather?");
    expect(merged[1].text).toBe("It's sunny!");
    expect(merged[2].text).toBe("What files are here?");
  });

  it("handles reload immediately after prompt submission (only user message in live)", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Previous question", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "Previous answer", timestamp: "2024-01-01T00:00:01.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "New question", timestamp: "2024-01-01T00:00:10.000Z" },
    ];

    const merged = mergeTranscriptItems(persisted, live);

    expect(merged).toHaveLength(3);
    expect(merged[2].kind).toBe("user_message");
    expect(merged[2].text).toBe("New question");
  });

  it("handles reload mid-tool execution", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "Run this command", timestamp: "2024-01-01T00:00:10.000Z" },
      { kind: "assistant_message", id: "l2", text: "Sure, running it now", timestamp: "2024-01-01T00:00:10.500Z" },
      { kind: "tool_start", id: "t1", toolName: "bash", toolCallId: "tc1", timestamp: "2024-01-01T00:00:11.000Z" },
    ];

    const merged = mergeTranscriptItems(persisted, live);

    expect(merged).toHaveLength(4);
    expect(merged[3].kind).toBe("tool_start");
    expect(merged[3].toolName).toBe("bash");
    expect(merged.some((i) => i.kind === "tool_end")).toBe(false);
  });
});

describe("Timestamp fidelity", () => {
  it("live items preserve original event timestamps", () => {
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-ts",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      userPrompt: "Test prompt",
      userMessageTimestamp: "2024-01-01T00:00:00.123Z",
      items: [
        {
          kind: "user_message",
          id: "live-user-turn-ts",
          timestamp: "2024-01-01T00:00:00.123Z",
          text: "Test prompt",
        },
        {
          kind: "assistant_message",
          id: "live-assistant-turn-ts",
          timestamp: "2024-01-01T00:00:01.456Z",
          text: "Response",
        },
        {
          kind: "tool_start",
          id: "tool-start-tc1",
          timestamp: "2024-01-01T00:00:02.789Z",
          toolName: "bash",
          toolCallId: "tc1",
        },
      ],
      assistantText: "Response",
      thinkingText: "",
      toolStarts: [],
      toolEnds: [],
    };

    const items = liveTurnBufferToTranscriptItems(buffer);

    // All timestamps should be preserved exactly
    expect(items[0].timestamp).toBe("2024-01-01T00:00:00.123Z");
    expect(items[1].timestamp).toBe("2024-01-01T00:00:01.456Z");
    expect(items[2].timestamp).toBe("2024-01-01T00:00:02.789Z");
  });
});

describe("Live turn buffer mutation path - Ordered segments", () => {
  let roomStateManager: RoomStateManager;
  const testRoomId = "!test:example.com";

  beforeEach(() => {
    roomStateManager = new RoomStateManager();
    // Create a mock session and room state
    const mockSession = {
      sessionId: "test-session-id",
      dispose: () => {},
    } as any;
    roomStateManager.getOrCreate(testRoomId, mockSession);
  });

  describe("A. Assistant continuation after tools", () => {
    it("creates separate assistant segments before and after tool activity", () => {
      // Reset/start turn with user prompt
      roomStateManager.resetLiveTurnBuffer(testRoomId);
      roomStateManager.updateLiveTurnStart(testRoomId, "turn-1", "What files are here?");

      // Assistant text delta "Let me check"
      roomStateManager.appendAssistantText(testRoomId, "Let me check");

      // tool_start
      roomStateManager.addToolStart(testRoomId, "tc1", "bash", '{"command": "ls"}');

      // tool_end
      roomStateManager.addToolEnd(testRoomId, "tc1", "bash", true, "file1.txt\nfile2.txt");

      // Assistant text delta "Here are the files"
      roomStateManager.appendAssistantText(testRoomId, "Here are the files");

      // Get the buffer and verify
      const buffer = roomStateManager.getLiveTurnBuffer(testRoomId);
      expect(buffer).toBeDefined();

      const items = buffer!.items;

      // Expected ordered live items:
      // 0: user_message
      // 1: assistant_message "Let me check"
      // 2: tool_start
      // 3: tool_end
      // 4: assistant_message "Here are the files"
      expect(items).toHaveLength(5);

      expect(items[0].kind).toBe("user_message");
      expect(items[0].text).toBe("What files are here?");

      expect(items[1].kind).toBe("assistant_message");
      expect(items[1].text).toBe("Let me check");

      expect(items[2].kind).toBe("tool_start");
      expect(items[2].toolName).toBe("bash");

      expect(items[3].kind).toBe("tool_end");
      expect(items[3].success).toBe(true);

      expect(items[4].kind).toBe("assistant_message");
      expect(items[4].text).toBe("Here are the files");

      // Verify they are separate items, not merged
      const assistantItems = items.filter((i) => i.kind === "assistant_message");
      expect(assistantItems).toHaveLength(2);
      expect(assistantItems[0].text).toBe("Let me check");
      expect(assistantItems[1].text).toBe("Here are the files");
    });
  });

  describe("B. Thinking continuation after tools", () => {
    it("creates separate thinking segments before and after tool activity", () => {
      // Reset/start turn with user prompt
      roomStateManager.resetLiveTurnBuffer(testRoomId);
      roomStateManager.updateLiveTurnStart(testRoomId, "turn-2", "Analyze this");

      // Thinking delta "I need to think"
      roomStateManager.appendThinkingText(testRoomId, "I need to think");

      // tool_start
      roomStateManager.addToolStart(testRoomId, "tc1", "read", '{"path": "file.txt"}');

      // tool_end
      roomStateManager.addToolEnd(testRoomId, "tc1", "read", true, "content");

      // Thinking delta "Now I understand"
      roomStateManager.appendThinkingText(testRoomId, "Now I understand");

      // Get the buffer and verify
      const buffer = roomStateManager.getLiveTurnBuffer(testRoomId);
      expect(buffer).toBeDefined();

      const items = buffer!.items;

      // Expected ordered live items:
      // 0: user_message
      // 1: thinking "I need to think"
      // 2: tool_start
      // 3: tool_end
      // 4: thinking "Now I understand"
      expect(items).toHaveLength(5);

      expect(items[0].kind).toBe("user_message");

      expect(items[1].kind).toBe("thinking");
      expect(items[1].text).toBe("I need to think");

      expect(items[2].kind).toBe("tool_start");

      expect(items[3].kind).toBe("tool_end");

      expect(items[4].kind).toBe("thinking");
      expect(items[4].text).toBe("Now I understand");

      // Verify they are separate items, not merged
      const thinkingItems = items.filter((i) => i.kind === "thinking");
      expect(thinkingItems).toHaveLength(2);
      expect(thinkingItems[0].text).toBe("I need to think");
      expect(thinkingItems[1].text).toBe("Now I understand");
    });
  });

  describe("C. Consecutive assistant deltas before any tool", () => {
    it("accumulates consecutive deltas into a single assistant segment", () => {
      // Reset/start turn
      roomStateManager.resetLiveTurnBuffer(testRoomId);
      roomStateManager.updateLiveTurnStart(testRoomId, "turn-3", "Hello");

      // Assistant delta "Hello"
      roomStateManager.appendAssistantText(testRoomId, "Hello");

      // Assistant delta " world"
      roomStateManager.appendAssistantText(testRoomId, " world");

      // Get the buffer and verify
      const buffer = roomStateManager.getLiveTurnBuffer(testRoomId);
      expect(buffer).toBeDefined();

      const items = buffer!.items;

      // Expected: single assistant_message item with "Hello world"
      expect(items).toHaveLength(2); // user_message + assistant_message

      expect(items[0].kind).toBe("user_message");

      expect(items[1].kind).toBe("assistant_message");
      expect(items[1].text).toBe("Hello world");

      // Verify only one assistant item exists
      const assistantItems = items.filter((i) => i.kind === "assistant_message");
      expect(assistantItems).toHaveLength(1);
      expect(assistantItems[0].text).toBe("Hello world");
    });
  });

  describe("D. Transcript helper on mutated buffer", () => {
    it("preserves order when converting mutated buffer to transcript items", () => {
      // Build buffer through room-state mutation methods
      roomStateManager.resetLiveTurnBuffer(testRoomId);
      roomStateManager.updateLiveTurnStart(testRoomId, "turn-4", "List files");
      roomStateManager.appendAssistantText(testRoomId, "Sure");
      roomStateManager.addToolStart(testRoomId, "tc1", "bash", '{"command": "ls"}');
      roomStateManager.addToolEnd(testRoomId, "tc1", "bash", true, "file1.txt");
      roomStateManager.appendAssistantText(testRoomId, "Here they are");

      // Convert to transcript items
      const buffer = roomStateManager.getLiveTurnBuffer(testRoomId);
      const transcriptItems = liveTurnBufferToTranscriptItems(buffer);

      // Verify order is preserved
      expect(transcriptItems).toHaveLength(5);
      expect(transcriptItems[0].kind).toBe("user_message");
      expect(transcriptItems[1].kind).toBe("assistant_message");
      expect(transcriptItems[1].text).toBe("Sure");
      expect(transcriptItems[2].kind).toBe("tool_start");
      expect(transcriptItems[3].kind).toBe("tool_end");
      expect(transcriptItems[4].kind).toBe("assistant_message");
      expect(transcriptItems[4].text).toBe("Here they are");
    });
  });

  describe("E. Complex interleaved sequence", () => {
    it("handles multiple tool calls with assistant text interspersed", () => {
      // Reset/start turn
      roomStateManager.resetLiveTurnBuffer(testRoomId);
      roomStateManager.updateLiveTurnStart(testRoomId, "turn-5", "Complex task");

      // Assistant introduces
      roomStateManager.appendAssistantText(testRoomId, "I'll help with that. ");

      // First tool
      roomStateManager.addToolStart(testRoomId, "tc1", "read", '{"path": "a.txt"}');
      roomStateManager.addToolEnd(testRoomId, "tc1", "read", true, "content A");

      // Assistant commentary
      roomStateManager.appendAssistantText(testRoomId, "First file done. ");

      // Second tool
      roomStateManager.addToolStart(testRoomId, "tc2", "read", '{"path": "b.txt"}');
      roomStateManager.addToolEnd(testRoomId, "tc2", "read", true, "content B");

      // Assistant concludes
      roomStateManager.appendAssistantText(testRoomId, "Both files processed.");

      // Get the buffer and verify
      const buffer = roomStateManager.getLiveTurnBuffer(testRoomId);
      expect(buffer).toBeDefined();

      const items = buffer!.items;

      // Expected ordered live items:
      // 0: user_message
      // 1: assistant_message "I'll help with that. "
      // 2: tool_start (tc1)
      // 3: tool_end (tc1)
      // 4: assistant_message "First file done. "
      // 5: tool_start (tc2)
      // 6: tool_end (tc2)
      // 7: assistant_message "Both files processed."
      expect(items).toHaveLength(8);

      // Verify assistant segments are separate
      const assistantItems = items.filter((i) => i.kind === "assistant_message");
      expect(assistantItems).toHaveLength(3);
      expect(assistantItems[0].text).toBe("I'll help with that. ");
      expect(assistantItems[1].text).toBe("First file done. ");
      expect(assistantItems[2].text).toBe("Both files processed.");

      // Verify interleaving is correct
      expect(items[1].kind).toBe("assistant_message");
      expect(items[2].kind).toBe("tool_start");
      expect(items[3].kind).toBe("tool_end");
      expect(items[4].kind).toBe("assistant_message");
      expect(items[5].kind).toBe("tool_start");
      expect(items[6].kind).toBe("tool_end");
      expect(items[7].kind).toBe("assistant_message");
    });
  });

  describe("F. Segment tracking state", () => {
    it("correctly tracks and clears currentAssistantItemId", () => {
      // Reset/start turn
      roomStateManager.resetLiveTurnBuffer(testRoomId);

      // Initially no open segment
      let buffer = roomStateManager.getLiveTurnBuffer(testRoomId);
      expect(buffer?.currentAssistantItemId).toBeUndefined();

      // After assistant text, segment is open
      roomStateManager.appendAssistantText(testRoomId, "Hello");
      buffer = roomStateManager.getLiveTurnBuffer(testRoomId);
      expect(buffer?.currentAssistantItemId).toBeDefined();

      // After tool_start, segment is closed
      roomStateManager.addToolStart(testRoomId, "tc1", "bash", "{}");
      buffer = roomStateManager.getLiveTurnBuffer(testRoomId);
      expect(buffer?.currentAssistantItemId).toBeUndefined();

      // After new assistant text, segment is open again
      roomStateManager.appendAssistantText(testRoomId, "World");
      buffer = roomStateManager.getLiveTurnBuffer(testRoomId);
      expect(buffer?.currentAssistantItemId).toBeDefined();

      // Verify there are now TWO assistant items (segment was closed, new one created)
      const assistantItems = buffer!.items.filter((i) => i.kind === "assistant_message");
      expect(assistantItems).toHaveLength(2);

      // After tool_end, segment remains closed
      roomStateManager.addToolEnd(testRoomId, "tc1", "bash", true, "result");
      buffer = roomStateManager.getLiveTurnBuffer(testRoomId);
      expect(buffer?.currentAssistantItemId).toBeUndefined();
    });
  });
});

describe("buildAuthoritativeTranscript helper", () => {
  it("returns empty array when no session file and not processing", async () => {
    const { buildAuthoritativeTranscript } = await import("../../src/transcript.js");

    const items = await buildAuthoritativeTranscript("test-session", undefined, undefined, false, { baseDir: "/test" });

    expect(items).toEqual([]);
  });

  it("returns persisted items only when not processing", async () => {
    const { buildAuthoritativeTranscript } = await import("../../src/transcript.js");

    // Create a temp session file
    const fs = await import("fs/promises");
    const tmpDir = await fs.mkdtemp("/tmp/test-");
    const sessionFile = `${tmpDir}/test.jsonl`;

    const sessionContent = [
      JSON.stringify({ type: "session", id: "test-session" }),
      JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-01T00:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "Hello" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "msg-002",
        timestamp: "2024-01-01T00:00:01.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "Hi there!" }] },
      }),
    ].join("\n");

    await fs.writeFile(sessionFile, sessionContent);

    try {
      const items = await buildAuthoritativeTranscript("test-session", sessionFile, undefined, false, {
        baseDir: tmpDir,
      });

      expect(items).toHaveLength(2);
      expect(items[0].kind).toBe("user_message");
      expect(items[0].text).toBe("Hello");
      expect(items[1].kind).toBe("assistant_message");
      expect(items[1].text).toBe("Hi there!");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("merges persisted and live items when processing", async () => {
    const { buildAuthoritativeTranscript } = await import("../../src/transcript.js");
    const { createEmptyLiveTurnBuffer } = await import("../../src/room-state.js");

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _createEmptyLiveTurnBuffer = createEmptyLiveTurnBuffer;

    // Create a temp session file with prior conversation
    const fs = await import("fs/promises");
    const tmpDir = await fs.mkdtemp("/tmp/test-");
    const sessionFile = `${tmpDir}/test.jsonl`;

    const sessionContent = [
      JSON.stringify({ type: "session", id: "test-session" }),
      JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-01T00:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "Previous question" }] },
      }),
      JSON.stringify({
        type: "message",
        id: "msg-002",
        timestamp: "2024-01-01T00:00:01.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "Previous answer" }] },
      }),
    ].join("\n");

    await fs.writeFile(sessionFile, sessionContent);

    try {
      // Create a live turn buffer with current in-flight turn
      const liveBuffer: LiveTurnBuffer = {
        ...createEmptyLiveTurnBuffer(),
        isActive: true,
        turnId: "turn-live",
        turnStartedAt: "2024-01-01T00:00:10.000Z",
        userPrompt: "Current prompt",
        userMessageTimestamp: "2024-01-01T00:00:10.100Z",
        assistantText: "Processing...",
        assistantMessageTimestamp: "2024-01-01T00:00:11.000Z",
        thinkingText: "",
        items: [
          {
            kind: "user_message",
            id: "live-user-turn-live",
            timestamp: "2024-01-01T00:00:10.100Z",
            text: "Current prompt",
          },
          {
            kind: "assistant_message",
            id: "live-assistant-turn-live",
            timestamp: "2024-01-01T00:00:11.000Z",
            text: "Processing...",
          },
        ],
        toolStarts: [],
        toolEnds: [],
      };

      const items = await buildAuthoritativeTranscript(
        "test-session",
        sessionFile,
        liveBuffer,
        true, // isProcessing
        { baseDir: tmpDir },
      );

      // Should have prior conversation + current live turn (with deduplication)
      expect(items).toHaveLength(4); // prev user, prev assistant, live user, live assistant
      expect(items[0].kind).toBe("user_message");
      expect(items[0].text).toBe("Previous question");
      expect(items[1].kind).toBe("assistant_message");
      expect(items[1].text).toBe("Previous answer");
      expect(items[2].kind).toBe("user_message");
      expect(items[2].text).toBe("Current prompt");
      expect(items[3].kind).toBe("assistant_message");
      expect(items[3].text).toBe("Processing...");
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles live items with tool_start and tool_end", async () => {
    const { buildAuthoritativeTranscript } = await import("../../src/transcript.js");
    const { createEmptyLiveTurnBuffer } = await import("../../src/room-state.js");

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _createEmptyLiveTurnBuffer = createEmptyLiveTurnBuffer;

    const fs = await import("fs/promises");
    const tmpDir = await fs.mkdtemp("/tmp/test-");
    const sessionFile = `${tmpDir}/test.jsonl`;

    const sessionContent = [
      JSON.stringify({ type: "session", id: "test-session" }),
      JSON.stringify({
        type: "message",
        id: "msg-001",
        timestamp: "2024-01-01T00:00:00.000Z",
        message: { role: "user", content: [{ type: "text", text: "Hello" }] },
      }),
    ].join("\n");

    await fs.writeFile(sessionFile, sessionContent);

    try {
      const liveBuffer: LiveTurnBuffer = {
        ...createEmptyLiveTurnBuffer(),
        isActive: true,
        turnId: "turn-tools",
        turnStartedAt: "2024-01-01T00:00:10.000Z",
        userPrompt: "Run ls",
        userMessageTimestamp: "2024-01-01T00:00:10.100Z",
        assistantText: "Sure",
        assistantMessageTimestamp: "2024-01-01T00:00:11.000Z",
        thinkingText: "",
        items: [
          {
            kind: "user_message",
            id: "live-user-turn-tools",
            timestamp: "2024-01-01T00:00:10.100Z",
            text: "Run ls",
          },
          {
            kind: "assistant_message",
            id: "live-assistant-turn-tools",
            timestamp: "2024-01-01T00:00:11.000Z",
            text: "Sure",
          },
          {
            kind: "tool_start",
            id: "tool-start-tc1",
            timestamp: "2024-01-01T00:00:12.000Z",
            toolName: "bash",
            toolCallId: "tc1",
            arguments: '{"command": "ls"}',
          },
          {
            kind: "tool_end",
            id: "tool-end-tc1",
            timestamp: "2024-01-01T00:00:13.000Z",
            toolName: "bash",
            toolCallId: "tc1",
            success: true,
            result: "file1.txt\nfile2.txt",
          },
        ],
        toolStarts: [],
        toolEnds: [],
      };

      const items = await buildAuthoritativeTranscript("test-session", sessionFile, liveBuffer, true, {
        baseDir: tmpDir,
      });

      // Should have persisted + live items including tools
      // 1 persisted user + 4 live items (user, assistant, tool_start, tool_end) = 5 total
      expect(items).toHaveLength(5);
      expect(items[0].kind).toBe("user_message");
      expect(items[0].text).toBe("Hello");
      expect(items[3].kind).toBe("tool_start");
      expect(items[3].toolName).toBe("bash");
      expect(items[4].kind).toBe("tool_end");
      expect(items[4].success).toBe(true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Live transcript route - Merged output ordering", () => {
  it("returns merged persisted + live items in correct order during processing", () => {
    // Simulate persisted items from prior conversation
    const persistedItems: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Previous question", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "Previous answer", timestamp: "2024-01-01T00:00:01.000Z" },
    ];

    // Simulate live buffer with current turn (built through mutation path)
    const roomStateManager = new RoomStateManager();
    const testRoomId = "!test:example.com";

    // Create a mock session and room state
    const mockSession = {
      sessionId: "test-session-id",
      dispose: () => {},
    } as any;
    roomStateManager.getOrCreate(testRoomId, mockSession);

    roomStateManager.resetLiveTurnBuffer(testRoomId);
    roomStateManager.updateLiveTurnStart(testRoomId, "turn-live", "Current prompt");
    roomStateManager.appendAssistantText(testRoomId, "Processing...");
    roomStateManager.addToolStart(testRoomId, "tc1", "bash", '{"command": "ls"}');
    roomStateManager.addToolEnd(testRoomId, "tc1", "bash", true, "file1.txt");
    roomStateManager.appendAssistantText(testRoomId, "Done.");

    const liveBuffer = roomStateManager.getLiveTurnBuffer(testRoomId);
    const liveItems = liveTurnBufferToTranscriptItems(liveBuffer);

    // Merge persisted and live items
    const merged = mergeTranscriptItems(persistedItems, liveItems);

    // Verify the merged output:
    // 0: user_message "Previous question" (persisted)
    // 1: assistant_message "Previous answer" (persisted)
    // 2: user_message "Current prompt" (live, duplicate of p3 removed)
    // 3: assistant_message "Processing..." (live)
    // 4: tool_start (live)
    // 5: tool_end (live)
    // 6: assistant_message "Done." (live)
    expect(merged).toHaveLength(7);

    // Persisted items preserved
    expect(merged[0].kind).toBe("user_message");
    expect(merged[0].text).toBe("Previous question");
    expect(merged[1].kind).toBe("assistant_message");
    expect(merged[1].text).toBe("Previous answer");

    // Live items appended in correct order
    expect(merged[2].kind).toBe("user_message");
    expect(merged[2].text).toBe("Current prompt");
    expect(merged[3].kind).toBe("assistant_message");
    expect(merged[3].text).toBe("Processing...");
    expect(merged[4].kind).toBe("tool_start");
    expect(merged[5].kind).toBe("tool_end");
    expect(merged[6].kind).toBe("assistant_message");
    expect(merged[6].text).toBe("Done.");

    // Verify the two assistant messages from the live turn are separate
    const liveAssistantItems = merged.filter((i, idx) => idx >= 2 && i.kind === "assistant_message");
    expect(liveAssistantItems).toHaveLength(2);
    expect(liveAssistantItems[0].text).toBe("Processing...");
    expect(liveAssistantItems[1].text).toBe("Done.");
  });
});
