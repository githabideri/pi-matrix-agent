/**
 * Transcript parsing and normalization utilities.
 *
 * Converts pi session JSONL files into a normalized transcript format
 * suitable for UI rendering.
 */

/**
 * Normalized transcript item types.
 */
export type TranscriptItemKind = "user_message" | "assistant_message" | "tool_start" | "tool_end" | "thinking";

/**
 * Base transcript item interface.
 */
interface BaseTranscriptItem {
  kind: TranscriptItemKind;
  id: string;
  timestamp: string;
}

/**
 * User message item.
 */
export interface UserMessageItem extends BaseTranscriptItem {
  kind: "user_message";
  text: string;
}

/**
 * Assistant message item.
 */
export interface AssistantMessageItem extends BaseTranscriptItem {
  kind: "assistant_message";
  text: string;
  thinking?: string;
}

/**
 * Tool start item.
 */
export interface ToolStartItem extends BaseTranscriptItem {
  kind: "tool_start";
  toolName: string;
  toolCallId?: string;
  arguments?: string;
}

/**
 * Tool end item.
 */
export interface ToolEndItem extends BaseTranscriptItem {
  kind: "tool_end";
  toolName: string;
  toolCallId?: string;
  success: boolean;
  result?: string;
}

/**
 * Thinking item (for reasoning content).
 */
export interface ThinkingItem extends BaseTranscriptItem {
  kind: "thinking";
  text: string;
}

/**
 * Union type for all transcript items.
 */
export type TranscriptItem = UserMessageItem | AssistantMessageItem | ToolStartItem | ToolEndItem | ThinkingItem;

/**
 * Full transcript response.
 */
export interface TranscriptResponse {
  roomId?: string;
  roomKey?: string;
  sessionId: string;
  sessionFile?: string;
  relativeSessionPath?: string;
  items: TranscriptItem[];
}

/**
 * Parse a JSONL session file into a normalized transcript.
 */
export async function parseSessionFile(
  sessionFile: string,
  options?: {
    includeThinking?: boolean;
    baseDir?: string;
  },
): Promise<TranscriptResponse> {
  const fs = await import("fs/promises");
  const _path = await import("path");

  const includeThinking = options?.includeThinking ?? true;
  const baseDir = options?.baseDir;

  const content = await fs.readFile(sessionFile, "utf-8");
  const lines = content.trim().split("\n");

  let sessionId = "";
  const items: TranscriptItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line);

      // Extract session ID from header
      if (entry.type === "session") {
        sessionId = entry.id || "";
        continue;
      }

      // Skip model/thinking level changes
      if (entry.type === "model_change" || entry.type === "thinking_level_change") {
        continue;
      }

      // Parse messages
      if (entry.type === "message" && entry.message) {
        const msg = entry.message;
        const msgItems = parseMessage(msg, entry.id, entry.timestamp, includeThinking);
        items.push(...msgItems);
      }
    } catch (err) {
      // Skip invalid lines
      console.warn(`Warning: Skipping invalid JSONL line ${i + 1}:`, err);
    }
  }

  const response: TranscriptResponse = {
    sessionId,
    items,
  };

  if (baseDir) {
    response.relativeSessionPath = getRelativePath(sessionFile, baseDir);
  }

  return response;
}

/**
 * Parse a message object into transcript items.
 */
function parseMessage(message: any, messageId: string, timestamp: string, includeThinking: boolean): TranscriptItem[] {
  const items: TranscriptItem[] = [] as TranscriptItem[];

  if (!message.content) return items;

  const content = Array.isArray(message.content) ? message.content : [message.content];

  for (const item of content) {
    if (item.type === "text" && item.text) {
      // User or assistant message
      if (message.role === "user") {
        items.push({
          kind: "user_message",
          id: messageId,
          text: item.text,
          timestamp,
        });
      } else if (message.role === "assistant") {
        // Filter out leaked "thought" prefix from model output
        const filteredText = filterLeakedThoughtText(item.text);
        items.push({
          kind: "assistant_message",
          id: messageId,
          text: filteredText,
          timestamp,
        });
      }
    } else if (item.type === "toolCall" && item.name) {
      // Extract tool call as separate item
      items.push({
        kind: "tool_start",
        id: item.id || `${messageId}-tool-${items.length}`,
        toolName: item.name,
        toolCallId: item.id,
        arguments: item.arguments ? JSON.stringify(item.arguments) : undefined,
        timestamp,
      });
    } else if (item.type === "thinking" && item.thinking && includeThinking) {
      items.push({
        kind: "thinking",
        id: `${messageId}-thinking`,
        text: item.thinking,
        timestamp,
      });
    }
  }

  // Handle toolResult role messages
  if (message.role === "toolResult" && message.toolCallId) {
    items.push({
      kind: "tool_end",
      id: `${messageId}-result`,
      toolName: message.toolName || "unknown",
      toolCallId: message.toolCallId,
      success: !message.isError,
      result: message.content?.[0]?.text || undefined,
      timestamp,
    });
  }

  return items;
}

/**
 * Filter leaked "thought" prefix and <channel|> markers from model output.
 * These are internal model tokens that should not appear in the final output.
 */
function filterLeakedThoughtText(text: string): string {
  // Remove "thought\n" prefix (case insensitive)
  let filtered = text.replace(/^thought\n?/i, "");

  // Remove <channel|> markers and anything before the first newline after them
  filtered = filtered.replace(/<channel\|>/g, "");

  // Trim leading whitespace that may result from removals
  filtered = filtered.trimStart();

  return filtered;
}

/**
 * Get relative path from base directory.
 */
export function getRelativePath(sessionFile: string, baseDir: string): string {
  const relative = sessionFile.replace(baseDir, "");
  return relative.startsWith("/") ? relative.slice(1) : relative;
}

/**
 * Build a transcript from live session state using the session's message history.
 * This is used for live rooms where we can access the session object directly.
 */
export async function buildLiveTranscript(
  sessionId: string,
  sessionFile?: string,
  options?: {
    baseDir?: string;
    includeThinking?: boolean;
  },
): Promise<TranscriptResponse> {
  // If we have a session file, parse it
  if (sessionFile) {
    return parseSessionFile(sessionFile, options);
  }

  // Fallback: empty transcript
  return {
    sessionId,
    items: [],
  };
}

/**
 * Live turn buffer types (imported from room-state for transcript reconstruction).
 * These are declared here to avoid circular imports.
 *
 * Note: The buffer now maintains an ordered `items` list for event-order preservation,
 * plus legacy accumulation fields for backwards compatibility.
 */
interface LiveTurnBufferForTranscript {
  isActive: boolean;
  turnId?: string;
  turnStartedAt?: string;
  /** Ordered list of live transcript items in event sequence (authoritative for reconstruction) */
  items: Array<{
    kind: "user_message" | "assistant_message" | "tool_start" | "tool_end" | "thinking";
    id: string;
    timestamp: string;
    text?: string;
    toolName?: string;
    toolCallId?: string;
    arguments?: string;
    success?: boolean;
    result?: string;
    error?: string;
  }>;
  /** Legacy convenience fields for backwards compatibility */
  assistantText: string;
  thinkingText: string;
  userPrompt?: string;
  userMessageTimestamp?: string;
  assistantMessageTimestamp?: string;
  thinkingTimestamp?: string;
  toolStarts: Array<{
    id: string;
    timestamp: string;
    toolName: string;
    toolCallId?: string;
    arguments?: string;
  }>;
  toolEnds: Array<{
    id: string;
    timestamp: string;
    toolName: string;
    toolCallId?: string;
    success: boolean;
    result?: string;
    error?: string;
  }>;
}

/**
 * Convert a live turn buffer into transcript items.
 * This enables transcript reconstruction during processing (reload scenario).
 *
 * Emits items in the order events occurred (from the ordered `items` list),
 * preserving accurate event sequence for reload reconstruction.
 */
export function liveTurnBufferToTranscriptItems(buffer: LiveTurnBufferForTranscript | undefined): TranscriptItem[] {
  if (!buffer?.isActive) {
    return [];
  }

  // Use the ordered items list as the authoritative source
  if (buffer.items && buffer.items.length > 0) {
    return buffer.items.map((item) => {
      switch (item.kind) {
        case "user_message":
          return {
            kind: "user_message" as const,
            id: item.id,
            text: item.text || "",
            timestamp: item.timestamp,
          };
        case "assistant_message":
          return {
            kind: "assistant_message" as const,
            id: item.id,
            text: item.text || "",
            timestamp: item.timestamp,
          };
        case "thinking":
          return {
            kind: "thinking" as const,
            id: item.id,
            text: item.text || "",
            timestamp: item.timestamp,
          };
        case "tool_start":
          return {
            kind: "tool_start" as const,
            id: item.id,
            toolName: item.toolName || "unknown",
            toolCallId: item.toolCallId,
            arguments: item.arguments,
            timestamp: item.timestamp,
          };
        case "tool_end":
          return {
            kind: "tool_end" as const,
            id: item.id,
            toolName: item.toolName || "unknown",
            toolCallId: item.toolCallId,
            success: item.success ?? false,
            result: item.result,
            timestamp: item.timestamp,
          };
        default:
          // Should not happen - all kinds are covered
          return {
            kind: "assistant_message" as const,
            id: item.id,
            text: item.text || "",
            timestamp: item.timestamp,
          };
      }
    });
  }

  // Fallback: reconstruct from legacy accumulation fields (for backwards compatibility)
  // This preserves old behavior if items list is empty
  const items: TranscriptItem[] = [];

  if (buffer.userPrompt) {
    items.push({
      kind: "user_message",
      id: `live-user-${buffer.turnId}`,
      text: buffer.userPrompt,
      timestamp: buffer.userMessageTimestamp || buffer.turnStartedAt || new Date().toISOString(),
    });
  }

  if (buffer.thinkingText) {
    items.push({
      kind: "thinking",
      id: `live-thinking-${buffer.turnId}`,
      text: buffer.thinkingText,
      timestamp: buffer.thinkingTimestamp || buffer.turnStartedAt || new Date().toISOString(),
    });
  }

  if (buffer.assistantText) {
    items.push({
      kind: "assistant_message",
      id: `live-assistant-${buffer.turnId}`,
      text: buffer.assistantText,
      timestamp: buffer.assistantMessageTimestamp || buffer.turnStartedAt || new Date().toISOString(),
    });
  }

  for (const toolStart of buffer.toolStarts) {
    items.push({
      kind: "tool_start",
      id: toolStart.id,
      toolName: toolStart.toolName,
      toolCallId: toolStart.toolCallId,
      arguments: toolStart.arguments,
      timestamp: toolStart.timestamp,
    });
  }

  for (const toolEnd of buffer.toolEnds) {
    items.push({
      kind: "tool_end",
      id: toolEnd.id,
      toolName: toolEnd.toolName,
      toolCallId: toolEnd.toolCallId,
      success: toolEnd.success,
      result: toolEnd.result,
      timestamp: toolEnd.timestamp,
    });
  }

  return items;
}

/**
 * Merge persisted transcript items with live current-turn items.
 * Handles deduplication to avoid duplicate user prompt items.
 *
 * DEDUPE LOGIC:
 * - Finds the last persisted user_message
 * - If it matches the live user_message text (fuzzy), removes ONLY that specific item
 * - Preserves all other persisted items including any that come after the duplicate
 */
export function mergeTranscriptItems(persistedItems: TranscriptItem[], liveItems: TranscriptItem[]): TranscriptItem[] {
  // If no live items, return persisted items
  if (liveItems.length === 0) {
    return persistedItems;
  }

  // If no persisted items, return live items
  if (persistedItems.length === 0) {
    return liveItems;
  }

  // Find the last persisted user_message (candidate for deduplication)
  let persistedUserMessageIndex = -1;
  for (let i = persistedItems.length - 1; i >= 0; i--) {
    if (persistedItems[i].kind === "user_message") {
      persistedUserMessageIndex = i;
      break;
    }
  }

  // Get the live user message
  const liveUserMessage = liveItems.find(
    (item): item is Extract<TranscriptItem, { kind: "user_message" }> => item.kind === "user_message",
  );

  let mergedItems: TranscriptItem[];

  if (persistedUserMessageIndex >= 0 && liveUserMessage) {
    const persistedUserMessage = persistedItems[persistedUserMessageIndex] as Extract<
      TranscriptItem,
      { kind: "user_message" }
    >;

    // Check if they have the same text (potential duplicate)
    // Use a fuzzy comparison for robustness
    const persistedText = persistedUserMessage.text.trim();
    const liveText = liveUserMessage.text.trim();

    // If texts match or one contains the other, consider them duplicates
    const isDuplicate =
      persistedText === liveText || persistedText.startsWith(liveText) || liveText.startsWith(persistedText);

    if (isDuplicate) {
      // Remove ONLY the specific duplicated user_message at the found index
      // NOT the last element - the duplicate could be followed by other items
      mergedItems = [
        ...persistedItems.slice(0, persistedUserMessageIndex),
        ...persistedItems.slice(persistedUserMessageIndex + 1),
      ];
    } else {
      mergedItems = [...persistedItems];
    }
  } else {
    mergedItems = [...persistedItems];
  }

  // Append live items
  mergedItems.push(...liveItems);

  return mergedItems;
}
