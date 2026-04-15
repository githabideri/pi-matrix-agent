import { MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import type { IncomingMessage, ReplySink } from "./types.js";

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

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
   * Stop typing feedback loop.
   */
  stopTypingLoop(interval: NodeJS.Timeout): void {
    clearInterval(interval);
  }

  async start(): Promise<void> {
    console.log(`Bot user ID: ${this.userId}`);

    // Set up listeners BEFORE starting
    this.client.on("room.message", async (roomId: string, event: any) => {
      console.log(
        `[MatrixTransport] Received message in ${roomId} from ${event.sender}: ${event.content?.body?.slice(0, 50)}`,
      );
      // Filter to allowed rooms only
      if (!this.allowedRoomIds.includes(roomId)) {
        console.log(`[MatrixTransport] Ignoring - room not allowed`);
        return;
      }

      // Ignore our own messages to prevent loops
      if (event.sender === this.userId) {
        return;
      }

      const msg: IncomingMessage = {
        roomId: roomId,
        eventId: event.event_id,
        sender: event.sender,
        body: event.content?.body || "",
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
   * Convert plain text to safe HTML for Matrix formatted_body.
   * Basic conversion: newlines to <br>, code blocks preserved.
   * Not a full markdown renderer - just makes common patterns readable.
   */
  private toSafeHtml(text: string): string {
    // Escape HTML entities first
    let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Convert code blocks (```code```) to <pre><code></code></pre>
    html = html.replace(/```([\s\S]*?)```/g, (_match, code) => {
      return `<pre><code>${code.trim()}</code></pre>`;
    });

    // Convert inline code (`code`) to <code></code>
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Convert headers
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

    // Convert bold (**text**)
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    // Convert italic (*text*)
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

    // Convert links [text](url)
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Convert paragraphs (double newlines)
    html = html.replace(/\n\n/g, "</p><p>");

    // Convert single newlines to breaks
    html = html.replace(/\n/g, "<br>");

    // Wrap in paragraph tags
    html = `<p>${html}</p>`;

    return html;
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
