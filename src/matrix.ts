import { marked } from "marked";
import { MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import sanitizeHtml from "sanitize-html";
import type { IncomingMessage, ReplySink } from "./types.js";

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

/**
 * Type guard that checks if a Matrix message type is accepted (text or notice).
 * Only `m.text` and `m.notice` are passed to the router.
 */
export function isAcceptedMatrixMsgType(msgtype: unknown): msgtype is "m.text" | "m.notice" {
  return msgtype === "m.text" || msgtype === "m.notice";
}

/**
 * Extract the text body from an incoming Matrix event.
 * Returns null if the event is not a valid text message.
 *
 * Requirements:
 * - msgtype must be "m.text" or "m.notice"
 * - body must be a non-empty string (after trimming)
 */
export function extractIncomingTextBody(event: any): string | null {
  const msgtype = event?.content?.msgtype;
  if (!isAcceptedMatrixMsgType(msgtype)) {
    return null;
  }

  const body = event?.content?.body;
  if (typeof body !== "string") {
    return null;
  }

  if (body.trim() === "") {
    return null;
  }

  return body;
}

export class MatrixTransport implements ReplySink {
  private client: MatrixClient;
  private allowedRoomIds: string[];
  private storagePath: string;
  private messageHandler?: MessageHandler;
  private userId: string;

  constructor(
    homeserverUrl: string,
    accessToken: string,
    allowedRoomIds: string[],
    userId: string,
    storagePath: string = ".matrix-storage",
  ) {
    this.allowedRoomIds = allowedRoomIds;
    this.storagePath = storagePath;
    this.userId = userId;

    // Create client with storage provider
    const storage = new SimpleFsStorageProvider(this.storagePath);
    this.client = new MatrixClient(homeserverUrl, accessToken, storage);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Set typing indicator for a room.
   * Matrix typing events timeout after ~28 seconds, so for long operations
   * the caller should call this periodically or use startTypingLoop.
   */
  async setTyping(roomId: string, typing: boolean): Promise<void> {
    try {
      if (typing) {
        await this.client.setTyping(roomId, true, 0);
      } else {
        await this.client.setTyping(roomId, false, 0);
      }
    } catch (error) {
      // Typing events are best-effort
      console.debug(`[MatrixTransport] Error setting typing for ${roomId}:`, error);
    }
  }

  /**
   * Start a typing feedback loop that refreshes typing indicator periodically.
   * Call setTyping(false) to stop the loop.
   */
  startTypingLoop(roomId: string): NodeJS.Timeout {
    // Set typing immediately
    this.setTyping(roomId, true);

    // Refresh every 20 seconds (Matrix timeout is ~28 seconds)
    const interval = setInterval(() => {
      this.setTyping(roomId, true).catch((err) => {
        console.debug(`[MatrixTransport] Error refreshing typing for ${roomId}:`, err);
      });
    }, 20000);

    return interval;
  }

  /**
   * Stop typing feedback loop and explicitly send typing=false.
   * This ensures the typing indicator is turned off immediately after reply or error,
   * not only when the homeserver timeout expires.
   */
  stopTypingLoop(roomId: string, interval: NodeJS.Timeout): void {
    // Explicitly send typing=false to turn off the indicator immediately
    this.setTyping(roomId, false).catch((err) => {
      console.debug(`[MatrixTransport] Error clearing typing for ${roomId}:`, err);
    });
    // Then clear the interval
    clearInterval(interval);
  }

  async start(): Promise<void> {
    console.log(`Bot user ID: ${this.userId}`);

    // Set up listeners BEFORE starting
    this.client.on("room.message", async (roomId: string, event: any) => {
      // Safe preview: slice if string, otherwise use placeholder
      const body = event.content?.body;
      const preview = typeof body === "string" ? body.slice(0, 50) : "[non-text event]";
      console.log(`[MatrixTransport] Received message in ${roomId} from ${event.sender}: ${preview}`);
      // Filter to allowed rooms only
      if (!this.allowedRoomIds.includes(roomId)) {
        console.log(`[MatrixTransport] Ignoring - room not allowed`);
        return;
      }

      // Ignore our own messages to prevent loops
      if (event.sender === this.userId) {
        return;
      }

      // Extract and validate the text body
      const textBody = extractIncomingTextBody(event);
      if (textBody === null) {
        console.debug(`[MatrixTransport] Ignoring non-text or empty message`);
        return;
      }

      const msg: IncomingMessage = {
        roomId: roomId,
        eventId: event.event_id,
        sender: event.sender,
        body: textBody,
      };

      // Call the message handler
      if (this.messageHandler) {
        try {
          await this.messageHandler(msg);
        } catch (error) {
          console.error(`Error handling message in room ${roomId}:`, error);
        }
      }
    });

    // Start syncing
    await this.client.start();
    console.log("Matrix bot started");
  }

  async reply(roomId: string, _eventId: string, text: string, options?: { webUI?: boolean }): Promise<void> {
    // For now, just send as a new message
    // TODO: Implement proper threaded reply later

    // WebUI-mirrored prompts can stay simple
    if (options?.webUI) {
      await this.client.sendMessage(roomId, {
        msgtype: "m.text",
        body: text,
      });
      return;
    }

    // For assistant replies, send rich formatting
    // Keep plain-text body, add formatted_body with basic HTML
    const formattedBody = this.toSafeHtml(text);

    await this.client.sendMessage(roomId, {
      msgtype: "m.text",
      body: text,
      format: "org.matrix.custom.html" as const,
      formatted_body: formattedBody,
    });
  }

  /**
   * Convert markdown to safe HTML for Matrix formatted_body.
   * Uses marked for GFM parsing and sanitize-html for XSS protection.
   *
   * Supports: h1-h6, paragraphs, lists (bullet/numbered), code blocks,
   * inline code, emphasis, strong, links, tables, blockquotes.
   */
  private toSafeHtml(text: string): string {
    // Parse markdown with GFM support
    const rawHtml = marked.parse(text, {
      async: false,
      breaks: true, // Convert line breaks to <br>
      gfm: true, // GitHub Flavored Markdown
    }) as string;

    // Sanitize HTML for Matrix formatted_body
    // Matrix supports a limited set of safe HTML tags
    const sanitizedHtml = sanitizeHtml(rawHtml, {
      allowedTags: [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "br",
        "ul",
        "ol",
        "li",
        "pre",
        "code",
        "strong",
        "em",
        "code",
        "a",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "blockquote",
      ],
      allowedAttributes: {
        a: ["href"],
      },
      disallowedTagsMode: "discard", // Remove disallowed tags but keep content
    });

    return sanitizedHtml;
  }

  async stop(): Promise<void> {
    console.log("[MatrixTransport] Stopping Matrix client...");
    try {
      // Stop the Matrix client - this stops syncing
      // This is async and should complete within a few seconds
      await this.client.stop();
      console.log("[MatrixTransport] Matrix client stopped");
    } catch (error) {
      console.error("[MatrixTransport] Error stopping Matrix client:", error);
      // Don't re-throw - we want to continue shutdown even if this fails
    }
  }
}
