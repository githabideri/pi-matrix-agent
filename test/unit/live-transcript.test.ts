import { describe, expect, it } from "vitest";
import { createEmptyLiveTurnBuffer, type LiveTurnBuffer } from "../../src/room-state.js";
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
