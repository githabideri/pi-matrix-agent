import { marked } from "marked";
import { MatrixClient, SimpleFsStorageProvider } from "matrix-bot-sdk";
import sanitizeHtml from "sanitize-html";
import { probeMedia } from "./media-probe.js";
import type { IncomingMessage, MediaSendOptions, ReplySink } from "./types.js";

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

/**
 * Type guard that checks if a Matrix message type is accepted (text or notice).
 * Only `m.text` and `m.notice` are passed to the router.
 */
const MAX_MEDIA_SIZE = 10 * 1024 * 1024; // 10 MB (Synapse default)

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

  async sendMedia(roomId: string, _eventId: string, mediaSource: string, options?: MediaSendOptions): Promise<void> {
    let mxcUri: string | undefined;
    let buffer: Buffer;
    let contentType = "application/octet-stream";

    // Step 1: Get the media data
    if (mediaSource.startsWith("mxc://")) {
      // Already uploaded — download from homeserver to get metadata
      const downloadResult = await this.client.downloadContent(mediaSource);
      buffer = downloadResult.data;
      contentType = downloadResult.contentType;
      mxcUri = mediaSource;
    } else if (mediaSource.startsWith("http://") || mediaSource.startsWith("https://")) {
      // Remote URL
      const response = await fetch(mediaSource);
      if (!response.ok) {
        await this.reply(
          roomId,
          _eventId,
          `❌ Failed to send media: URL returned ${response.status} ${response.statusText}`,
        );
        return;
      }
      buffer = Buffer.from(await response.arrayBuffer());
      contentType = response.headers.get("content-type") || "application/octet-stream";
    } else if (mediaSource.startsWith("file://")) {
      // file:// URI → local file path
      const localPath = new URL(mediaSource).pathname;
      const fs = await import("node:fs");
      if (!fs.existsSync(localPath)) {
        await this.reply(roomId, _eventId, `❌ Failed to send media: File not found: ${localPath}`);
        return;
      }
      buffer = fs.readFileSync(localPath);
    } else if (mediaSource.startsWith("/")) {
      // Local file path
      const fs = await import("node:fs");
      if (!fs.existsSync(mediaSource)) {
        await this.reply(roomId, _eventId, `❌ Failed to send media: File not found: ${mediaSource}`);
        return;
      }
      buffer = fs.readFileSync(mediaSource);
    } else {
      await this.reply(
        roomId,
        _eventId,
        `❌ Failed to send media: Invalid media source (expected URL, local path, or mxc:// URI)`,
      );
      return;
    }

    // Step 2: Enforce size limit
    if (buffer.length > MAX_MEDIA_SIZE) {
      const sizeMB = (buffer.length / (1024 * 1024)).toFixed(1);
      await this.reply(roomId, _eventId, `❌ Failed to send media: File too large (${sizeMB} MB, limit is 10 MB)`);
      return;
    }

    // Step 3: Probe metadata
    let probeInfo: Awaited<ReturnType<typeof probeMedia>>;
    try {
      probeInfo = await probeMedia(buffer);
    } catch (err: any) {
      await this.reply(roomId, _eventId, `❌ Failed to send media: Could not determine file type (${err.message})`);
      return;
    }

    // Use probed mimetype, or fall back to content-type header
    contentType = probeInfo.mimetype || contentType;

    // Step 4: Upload if we don't have an mxc:// URI yet
    if (!mxcUri) {
      const filename = options?.filename || this.guessFilename(mediaSource, contentType);
      try {
        mxcUri = await this.client.uploadContent(buffer, contentType, filename);
      } catch (err: any) {
        await this.reply(roomId, _eventId, `❌ Failed to send media: Upload rejected by server (${err.message})`);
        return;
      }
    }

    // Step 5: Determine message type
    const msgtype = options?.msgtype || this.mapTypeToMsgtype(probeInfo.type);

    // Step 6: Build and send the media event
    const caption = options?.caption || `${probeInfo.type} media`;
    const filename = options?.filename || this.guessFilename(mediaSource, contentType);

    const baseContent: Record<string, unknown> = {
      msgtype: msgtype,
      body: caption,
      filename: filename,
      url: mxcUri,
    };

    // Build info block
    const info: Record<string, unknown> = {
      mimetype: contentType,
      size: buffer.length,
    };

    if (probeInfo.width) info.w = probeInfo.width;
    if (probeInfo.height) info.h = probeInfo.height;
    if (options?.duration) {
      info.duration = options.duration;
    } else if (probeInfo.duration) {
      info.duration = probeInfo.duration;
    }

    baseContent.info = info;

    try {
      await this.client.sendMessage(roomId, baseContent);
    } catch (err: any) {
      await this.reply(roomId, _eventId, `❌ Failed to send media: Could not send message (${err.message})`);
    }
  }

  private guessFilename(source: string, mime: string): string {
    if (source.startsWith("http")) {
      // Extract filename from URL path
      try {
        const url = new URL(source);
        const pathParts = url.pathname.split("/");
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart?.includes(".")) {
          return lastPart;
        }
      } catch {
        // URL parsing failed
      }
    }
    // Fallback: use extension from MIME type
    const ext = this.mimeToExtension(mime);
    return `media.${ext}`;
  }

  private mimeToExtension(mime: string): string {
    const map: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/bmp": "bmp",
      "image/tiff": "tiff",
      "image/svg+xml": "svg",
      "image/x-icon": "ico",
      "image/avif": "avif",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "video/ogg": "ogv",
      "video/quicktime": "mov",
      "video/x-matroska": "mkv",
      "audio/mpeg": "mp3",
      "audio/flac": "flac",
      "audio/ogg": "oga",
      "audio/wav": "wav",
      "audio/m4a": "m4a",
      "audio/opus": "opus",
    };
    return map[mime] || "bin";
  }

  private mapTypeToMsgtype(type: "image" | "video" | "audio"): "m.image" | "m.video" | "m.audio" {
    const map: Record<"image" | "video" | "audio", "m.image" | "m.video" | "m.audio"> = {
      image: "m.image",
      video: "m.video",
      audio: "m.audio",
    };
    return map[type];
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
