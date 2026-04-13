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
        items.push({
          kind: "assistant_message",
          id: messageId,
          text: item.text,
          timestamp,
        });
      }
    } else if (item.type === "thinking" && item.thinking && includeThinking) {
      items.push({
        kind: "thinking",
        id: `${messageId}-thinking`,
        text: item.thinking,
        timestamp,
      });
    }
  }

  return items;
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
