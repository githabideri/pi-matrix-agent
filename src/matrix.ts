import { MatrixClient, SimpleFsStorageProvider, AutojoinRoomsMixin } from "matrix-bot-sdk";
import type { IncomingMessage, ReplySink } from "./types.js";

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;
export type TypingHook = (roomId: string, typing: boolean) => Promise<void>;

export class MatrixTransport implements ReplySink {
  private client: MatrixClient;
  private allowedRoomIds: string[];
  private storagePath: string;
  private messageHandler?: MessageHandler;
  private userId: string;
  private typingHook?: TypingHook;

  constructor(
    homeserverUrl: string,
    accessToken: string,
    allowedRoomIds: string[],
    userId: string,
    storagePath: string = ".matrix-storage"
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
   * Set a hook for typing feedback.
   */
  onTyping(hook: TypingHook): void {
    this.typingHook = hook;
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
      // Filter to allowed rooms only
      if (!this.allowedRoomIds.includes(roomId)) {
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

  async reply(
    roomId: string,
    _eventId: string,
    text: string
  ): Promise<void> {
    // For now, just send as a new message
    // TODO: Implement proper threaded reply later
    await this.client.sendMessage(roomId, {
      msgtype: "m.text",
      body: text,
    });
  }

  async stop(): Promise<void> {
    await this.client.stop();
  }
}
