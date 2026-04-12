import express, { Express, Request, Response } from "express";
import { Server } from "http";
import { PiSessionBackend } from "./pi-backend.js";
import { buildContextManifest, manifestToResponse } from "./context-manifest.js";
import { parseSessionMetadata, getRelativeSessionPath } from "./room-state.js";
import { routeLive } from "./routes/live.js";
import { routeArchive } from "./routes/archive.js";

export interface ControlServerOptions {
  port?: number;
  host?: string;
}

export class ControlServer {
  private app: Express;
  private server?: Server;
  private piBackend: PiSessionBackend;
  private workingDirectory: string;
  private sessionBaseDir: string;
  private port: number;
  private host: string;

  constructor(
    piBackend: PiSessionBackend,
    workingDirectory: string,
    sessionBaseDir: string,
    options?: ControlServerOptions
  ) {
    this.piBackend = piBackend;
    this.workingDirectory = workingDirectory;
    this.sessionBaseDir = sessionBaseDir;
    this.port = options?.port ?? 9000;
    this.host = options?.host ?? "127.0.0.1";

    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // JSON parsing middleware
    this.app.use(express.json());

    // Health check
    this.app.get("/", (_req: Request, res: Response) => {
      res.json({ status: "ok", service: "pi-matrix-agent-control" });
    });

    // Live room routes
    this.app.use("/api/live/rooms", routeLive(this.piBackend, this.workingDirectory));

    // Archive routes
    this.app.use("/api/archive/rooms", routeArchive(this.piBackend, this.sessionBaseDir));

    // Simple static file serving for UI (placeholder)
    this.app.get("/room/:roomKey", (req: Request, res: Response) => {
      const roomKey = req.params.roomKey;
      const roomState = this.piBackend.getSessionByKey(roomKey);
      
      if (!roomState) {
        return res.status(404).json({ error: "Room not found" });
      }

      res.json({
        message: "UI endpoint placeholder",
        roomKey,
        roomId: roomState.roomId,
        sessionId: roomState.sessionId,
        isProcessing: roomState.isProcessing,
      });
    });

    this.app.get("/room/:roomKey/context", async (req: Request, res: Response) => {
      const roomKey = req.params.roomKey;
      const roomState = this.piBackend.getSessionByKey(roomKey);

      if (!roomState) {
        return res.status(404).json({ error: "Room not found" });
      }

      try {
        const manifest = await buildContextManifest(roomState, this.workingDirectory);
        res.json(manifestToResponse(manifest));
      } catch (error) {
        console.error("Error building context manifest:", error);
        res.status(500).json({ error: "Failed to build context manifest" });
      }
    });

    this.app.get("/room/:roomKey/archive", async (req: Request, res: Response) => {
      const roomKey = req.params.roomKey;
      const roomId = this.piBackend.getRoomIdByKey(roomKey);

      if (!roomId) {
        return res.status(404).json({ error: "Room not found" });
      }

      try {
        const archived = await this.piBackend.getArchivedSessionsForRoom(roomId);
        res.json(archived);
      } catch (error) {
        console.error("Error listing archived sessions:", error);
        res.status(500).json({ error: "Failed to list archived sessions" });
      }
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, this.host, () => {
        console.log(`[ControlServer] Listening on http://${this.host}:${this.port}`);
        resolve();
      }).on("error", (error: Error) => {
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log("[ControlServer] Stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.port;
  }

  getHost(): string {
    return this.host;
  }
}
