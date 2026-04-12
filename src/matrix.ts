import { MatrixClient, SimpleFsStorageProvider, AutojoinRoomsMixin } from "matrix-bot-sdk";
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
