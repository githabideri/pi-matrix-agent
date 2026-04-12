import express, { Express, Request, Response } from "express";
import { Server } from "http";
import { PiSessionBackend } from "./pi-backend.js";
import { buildContextManifest, manifestToResponse } from "./context-manifest.js";
import { parseSessionMetadata, getRelativeSessionPath } from "./room-state.js";
import { routeLive } from "./routes/live.js";
import { routeArchive } from "./routes/archive.js";
import { routeWebUI } from "./routes/webui.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    
    // Set up EJS template engine
    this.app.set("view engine", "ejs");
    this.app.set("views", path.join(__dirname, "../views"));
    
    // Serve static files
    this.app.use("/static", express.static(path.join(__dirname, "../public")));
    
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // JSON parsing middleware
    this.app.use(express.json());

    // Health check
    this.app.get("/", (_req: Request, res: Response) => {
      res.json({ status: "ok", service: "pi-matrix-agent-control" });
    });

    // Live room routes (JSON API)
    this.app.use("/api/live/rooms", routeLive(this.piBackend, this.workingDirectory));

    // Archive routes (JSON API)
    this.app.use("/api/archive/rooms", routeArchive(this.piBackend, this.sessionBaseDir));

    // WebUI routes (HTML pages - EJS fallback)
    console.log("[ControlServer] Mounting WebUI routes at /room");
    this.app.use("/room", routeWebUI(this.piBackend, this.workingDirectory, this.sessionBaseDir));

    // Preview frontend routes (/app/room/:roomKey)
    console.log("[ControlServer] Mounting preview frontend at /app/room");
    
    // Serve built frontend assets
    const frontendDistPath = path.join(__dirname, "../frontend/operator-ui/dist");
    this.app.use("/app", express.static(frontendDistPath));
    
    // Preview room page
    this.app.get("/app/room/:roomKey", (req: Request, res: Response) => {
      const roomKey = req.params.roomKey;
      // Inject roomKey into the page
      let html = "<html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'><title>Room: " + roomKey + "</title></head><body><div id='app'></div><script>\nwindow.ROOM_KEY = \"" + roomKey + "\";</script><script type='module' src='/app/assets/index-BppihHQ8.js'></script></body></html>";
      res.type("html").send(html);
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
