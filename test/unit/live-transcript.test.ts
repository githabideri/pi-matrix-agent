import { describe, expect, it } from "vitest";
import { createEmptyLiveTurnBuffer, type LiveTurnBuffer } from "../../src/room-state.js";
import { liveTurnBufferToTranscriptItems, mergeTranscriptItems, type TranscriptItem } from "../../src/transcript.js";

/**
 * Tests for live current-turn transcript buffer functionality.
 *
 * This tests the core Milestone 2 feature: backend-owned live turn tracking
 * that enables transcript reconstruction during processing (reload scenario).
 */

describe("Live turn buffer creation", () => {
  it("creates an empty buffer with correct defaults", () => {
    const buffer = createEmptyLiveTurnBuffer();

    expect(buffer.isActive).toBe(false);
    expect(buffer.turnId).toBeUndefined();
    expect(buffer.turnStartedAt).toBeUndefined();
    expect(buffer.userPrompt).toBeUndefined();
    expect(buffer.userMessageTimestamp).toBeUndefined();
    expect(buffer.assistantText).toBe("");
    expect(buffer.assistantMessageTimestamp).toBeUndefined();
    expect(buffer.thinkingText).toBe("");
    expect(buffer.thinkingTimestamp).toBeUndefined();
    expect(buffer.toolStarts).toEqual([]);
    expect(buffer.toolEnds).toEqual([]);
  });
});

describe("liveTurnBufferToTranscriptItems", () => {
  it("returns empty array for undefined buffer", () => {
    const items = liveTurnBufferToTranscriptItems(undefined);
    expect(items).toEqual([]);
  });

  it("returns empty array for inactive buffer", () => {
    const buffer = createEmptyLiveTurnBuffer();
    buffer.isActive = false;
    buffer.assistantText = "some text";

    const items = liveTurnBufferToTranscriptItems(buffer);
    expect(items).toEqual([]);
  });

  it("converts user prompt to user_message item", () => {
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-123",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      userPrompt: "Hello, world!",
      userMessageTimestamp: "2024-01-01T00:00:01.000Z",
    };

    const items = liveTurnBufferToTranscriptItems(buffer);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      kind: "user_message",
      id: "live-user-turn-123",
      text: "Hello, world!",
      timestamp: "2024-01-01T00:00:01.000Z",
    });
  });

  it("converts assistant text to assistant_message item", () => {
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-123",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      assistantText: "Hi there!",
      assistantMessageTimestamp: "2024-01-01T00:00:02.000Z",
    };

    const items = liveTurnBufferToTranscriptItems(buffer);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      kind: "assistant_message",
      id: "live-assistant-turn-123",
      text: "Hi there!",
      timestamp: "2024-01-01T00:00:02.000Z",
    });
  });

  it("converts thinking text to thinking item", () => {
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-123",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      thinkingText: "Let me think about this...",
      thinkingTimestamp: "2024-01-01T00:00:01.500Z",
    };

    const items = liveTurnBufferToTranscriptItems(buffer);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      kind: "thinking",
      id: "live-thinking-turn-123",
      text: "Let me think about this...",
      timestamp: "2024-01-01T00:00:01.500Z",
    });
  });

  it("converts tool starts and ends to tool_start/tool_end items", () => {
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-123",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      toolStarts: [
        {
          id: "tool-start-tc1",
          timestamp: "2024-01-01T00:00:03.000Z",
          toolName: "bash",
          toolCallId: "tc1",
          arguments: '{"command": "ls -la"}',
        },
      ],
      toolEnds: [
        {
          id: "tool-end-tc1",
          timestamp: "2024-01-01T00:00:04.000Z",
          toolName: "bash",
          toolCallId: "tc1",
          success: true,
          result: "total 100\n-rw-r--r-- 1 root root 1024 Jan 1 00:00 file.txt",
        },
      ],
    };

    const items = liveTurnBufferToTranscriptItems(buffer);

    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("tool_start");
    expect(items[0].toolName).toBe("bash");
    expect(items[1].kind).toBe("tool_end");
    expect(items[1].success).toBe(true);
  });

  it("converts complete turn with all content types", () => {
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-456",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      userPrompt: "What files are in the current directory?",
      userMessageTimestamp: "2024-01-01T00:00:00.100Z",
      thinkingText: "I need to use the bash tool to list files.",
      thinkingTimestamp: "2024-01-01T00:00:00.500Z",
      assistantText: "Let me check the current directory for you.",
      assistantMessageTimestamp: "2024-01-01T00:00:01.000Z",
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

    // Should have: user_message, thinking, assistant_message, tool_start, tool_end
    expect(items).toHaveLength(5);
    expect(items[0].kind).toBe("user_message");
    expect(items[1].kind).toBe("thinking");
    expect(items[2].kind).toBe("assistant_message");
    expect(items[3].kind).toBe("tool_start");
    expect(items[4].kind).toBe("tool_end");
  });

  it("handles partial turn with only user prompt", () => {
    // Simulates immediate reload after submitting prompt but before any response
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-789",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      userPrompt: "Just submitted this prompt",
      userMessageTimestamp: "2024-01-01T00:00:00.100Z",
    };

    const items = liveTurnBufferToTranscriptItems(buffer);

    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("user_message");
    expect(items[0].text).toBe("Just submitted this prompt");
  });

  it("handles partial turn with user prompt and partial assistant text", () => {
    // Simulates reload mid-response
    const buffer: LiveTurnBuffer = {
      ...createEmptyLiveTurnBuffer(),
      isActive: true,
      turnId: "turn-abc",
      turnStartedAt: "2024-01-01T00:00:00.000Z",
      userPrompt: "Tell me a story",
      userMessageTimestamp: "2024-01-01T00:00:00.100Z",
      assistantText: "Once upon a time, in a land far away...",
      assistantMessageTimestamp: "2024-01-01T00:00:01.000Z",
    };

    const items = liveTurnBufferToTranscriptItems(buffer);

    expect(items).toHaveLength(2);
    expect(items[0].kind).toBe("user_message");
    expect(items[1].kind).toBe("assistant_message");
    expect(items[1].text).toBe("Once upon a time, in a land far away...");
  });
});

describe("mergeTranscriptItems", () => {
  it("returns persisted items when no live items", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "Hi!", timestamp: "2024-01-01T00:00:01.000Z" },
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

  it("appends live items to persisted items", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "Hi!", timestamp: "2024-01-01T00:00:01.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "How are you?", timestamp: "2024-01-01T00:00:02.000Z" },
    ];

    const result = mergeTranscriptItems(persisted, live);

    expect(result).toHaveLength(3);
    expect(result[0].id).toBe("p1");
    expect(result[1].id).toBe("p2");
    expect(result[2].id).toBe("l1");
  });

  it("deduplicates user message when persisted ends with same prompt", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "Hi!", timestamp: "2024-01-01T00:00:01.000Z" },
      { kind: "user_message", id: "p3", text: "Current prompt", timestamp: "2024-01-01T00:00:02.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "Current prompt", timestamp: "2024-01-01T00:00:02.100Z" },
      { kind: "assistant_message", id: "l2", text: "Partial response", timestamp: "2024-01-01T00:00:03.000Z" },
    ];

    const result = mergeTranscriptItems(persisted, live);

    // Should NOT have duplicate user_message for "Current prompt"
    expect(result).toHaveLength(4); // p1, p2, l1, l2 (p3 was removed)
    expect(result.filter((i) => i.kind === "user_message")).toHaveLength(2); // Only 2 user messages
  });

  it("does not deduplicate when prompts are different", () => {
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "Hi!", timestamp: "2024-01-01T00:00:01.000Z" },
      { kind: "user_message", id: "p3", text: "Old prompt", timestamp: "2024-01-01T00:00:02.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "New prompt", timestamp: "2024-01-01T00:00:03.000Z" },
    ];

    const result = mergeTranscriptItems(persisted, live);

    // Should keep both user messages since they're different
    expect(result).toHaveLength(4);
    expect(result.filter((i) => i.kind === "user_message")).toHaveLength(3); // 3 user messages
  });

  it("handles deduplication with fuzzy matching (substring)", () => {
    // Simulates case where persisted has truncated preview but live has full prompt
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "user_message", id: "p2", text: "Current", timestamp: "2024-01-01T00:00:02.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "Current prompt text", timestamp: "2024-01-01T00:00:02.100Z" },
    ];

    const result = mergeTranscriptItems(persisted, live);

    // Should deduplicate since "Current" is substring of "Current prompt text"
    expect(result.filter((i) => i.kind === "user_message")).toHaveLength(2); // Only 2 user messages
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

    expect(result).toHaveLength(4); // p1, l1, t1, t2 (no dedup since prompts differ)
    expect(result.filter((i) => i.kind === "tool_start")).toHaveLength(1);
    expect(result.filter((i) => i.kind === "tool_end")).toHaveLength(1);
  });
});

describe("Reload during processing scenario", () => {
  it("simulates reload with prior conversation + current in-flight turn", () => {
    // Simulate persisted transcript with prior conversation
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "What's the weather?", timestamp: "2024-01-01T00:00:00.000Z" },
      { kind: "assistant_message", id: "p2", text: "It's sunny!", timestamp: "2024-01-01T00:00:01.000Z" },
    ];

    // Simulate live buffer with current in-flight turn
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
    // User just submitted a prompt and reloaded before any response
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
    // User reloaded while a tool is executing
    const persisted: TranscriptItem[] = [
      { kind: "user_message", id: "p1", text: "Hello", timestamp: "2024-01-01T00:00:00.000Z" },
    ];
    const live: TranscriptItem[] = [
      { kind: "user_message", id: "l1", text: "Run this command", timestamp: "2024-01-01T00:00:10.000Z" },
      { kind: "assistant_message", id: "l2", text: "Sure, running it now", timestamp: "2024-01-01T00:00:10.500Z" },
      { kind: "tool_start", id: "t1", toolName: "bash", toolCallId: "tc1", timestamp: "2024-01-01T00:00:11.000Z" },
      // Tool end not yet received - still executing
    ];

    const merged = mergeTranscriptItems(persisted, live);

    expect(merged).toHaveLength(4);
    expect(merged[3].kind).toBe("tool_start");
    expect(merged[3].toolName).toBe("bash");
    // No tool_end yet
    expect(merged.some((i) => i.kind === "tool_end")).toBe(false);
  });
});
