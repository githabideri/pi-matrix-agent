import express, { type Express, type Request, type Response } from "express";
import type { Server } from "http";
import path from "path";
import { fileURLToPath } from "url";
import type { PiSessionBackend } from "./pi-backend.js";
import { routeArchive } from "./routes/archive.js";
import { routeLive } from "./routes/live.js";
import { routeWebUI } from "./routes/webui.js";

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
    options?: ControlServerOptions,
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

    // Preview room page - MUST come BEFORE static middleware
    this.app.get("/app/room/:roomKey", async (req: Request, res: Response) => {
      const roomKey = req.params.roomKey;

      // Read the built index.html and inject roomKey
      const fs = await import("fs/promises");
      const indexPath = path.join(__dirname, "../frontend/operator-ui/dist/index.html");

      try {
        let html = await fs.readFile(indexPath, "utf-8");

        // Fix asset paths - change /assets/ to /app/assets/ since we serve from /app
        html = html.replace(/\/assets\//g, "/app/assets/");

        // Inject roomKey before the closing head tag
        html = html.replace("</head>", `<script>window.ROOM_KEY = "${roomKey}";</script></head>`);

        // Update title
        html = html.replace(/<title>.*?<\/title>/, `<title>Room: ${roomKey}</title>`);

        res.type("html").send(html);
      } catch (error) {
        console.error("Error serving preview page:", error);
        res.status(500).send("Error loading preview page");
      }
    });

    // Serve built frontend assets - comes AFTER room route
    const frontendDistPath = path.join(__dirname, "../frontend/operator-ui/dist");
    this.app.use("/app", express.static(frontendDistPath));

    // Assistant UI Spike routes (/spike)
    console.log("[ControlServer] Mounting assistant-ui spike at /spike");

    const spikeDistPath = path.join(__dirname, "../frontend/assistant-ui-spike/dist");

    // Serve spike index.html with room key from query param
    this.app.get("/spike", async (_req: Request, res: Response) => {
      const fs = await import("fs/promises");
      const indexPath = path.join(spikeDistPath, "index.html");

      try {
        let html = await fs.readFile(indexPath, "utf-8");

        // Fix asset paths
        html = html.replace(/\/assets\//g, "/spike/assets/");

        // Update title
        html = html.replace(/<title>.*?<\/title>/, `<title>Assistant UI Spike</title>`);

        res.type("html").send(html);
      } catch (error) {
        console.error("Error serving spike page:", error);
        res.status(500).send("Error loading spike page");
      }
    });

    // Serve spike assets
    this.app.use("/spike", express.static(spikeDistPath));
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app
        .listen(this.port, this.host, () => {
          console.log(`[ControlServer] Listening on http://${this.host}:${this.port}`);
          resolve();
        })
        .on("error", (error: Error) => {
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
