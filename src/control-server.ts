import { timingSafeEqual } from "crypto";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Server } from "http";
import type { Socket } from "net";
import path from "path";
import { fileURLToPath } from "url";
import type { MatrixTransport } from "./matrix.js";
import type { PiSessionBackend } from "./pi-backend.js";
import { routeArchive } from "./routes/archive.js";
import { routeLive } from "./routes/live.js";
import { routeWebUI } from "./routes/webui.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ControlServerOptions {
  port?: number;
  host?: string;
  auth?: { username: string; password: string };
}

export class ControlServer {
  private app: Express;
  private server?: Server;
  private piBackend: PiSessionBackend;
  private workingDirectory: string;
  private sessionBaseDir: string;
  private port: number;
  private host: string;
  private auth?: { username: string; password: string };
  private matrixTransport?: MatrixTransport;
  private activeConnections: Set<Socket> = new Set(); // Track active HTTP connections for graceful shutdown

  constructor(
    piBackend: PiSessionBackend,
    workingDirectory: string,
    sessionBaseDir: string,
    options?: ControlServerOptions,
    matrixTransport?: MatrixTransport, // Optional: for syncing web UI messages to Matrix
  ) {
    this.piBackend = piBackend;
    this.workingDirectory = workingDirectory;
    this.sessionBaseDir = sessionBaseDir;
    this.port = options?.port ?? 9000;
    this.host = options?.host ?? "127.0.0.1";
    this.auth = options?.auth;
    this.matrixTransport = matrixTransport;

    this.app = express();

    // Set up EJS template engine
    this.app.set("view engine", "ejs");
    this.app.set("views", path.join(__dirname, "../views"));

    // Track active connections for graceful shutdown
    this.app.use((req, _res, next) => {
      const socket = req.socket;
      if (socket) {
        this.activeConnections.add(socket);
        socket.on("close", () => this.activeConnections.delete(socket));
      }
      next();
    });

    // Set up authentication middleware for protected routes
    if (this.auth) {
      console.log("[ControlServer] Authentication enabled for protected routes");
    } else {
      console.log("[ControlServer] Authentication disabled");
    }

    // Serve static files with auth protection
    this.app.use("/static", this.requireAuth(), express.static(path.join(__dirname, "../public")));

    this.setupRoutes();
  }

  private setupRoutes(): void {
    // JSON parsing middleware
    this.app.use(express.json());

    // Health check (open, no auth required)
    this.app.get("/", (_req: Request, res: Response) => {
      res.json({ status: "ok", service: "pi-matrix-agent-control" });
    });

    // Live room routes (JSON API) - protected
    this.app.use(
      "/api/live/rooms",
      this.requireAuth(),
      routeLive(this.piBackend, this.workingDirectory, this.matrixTransport),
    );

    // Archive routes (JSON API) - protected
    this.app.use("/api/archive/rooms", this.requireAuth(), routeArchive(this.piBackend, this.sessionBaseDir));

    // WebUI routes (HTML pages - EJS fallback) - protected
    console.log("[ControlServer] Mounting WebUI routes at /room");
    this.app.use("/room", this.requireAuth(), routeWebUI(this.piBackend, this.workingDirectory, this.sessionBaseDir));

    // Preview frontend routes (/app/room/:roomKey) - protected
    console.log("[ControlServer] Mounting preview frontend at /app/room");

    // Preview room page - MUST come BEFORE static middleware
    this.app.get("/app/room/:roomKey", this.requireAuth(), async (req: Request, res: Response) => {
      const roomKey = req.params.roomKey;

      // Read the built index.html and inject roomKey
      const fs = await import("fs/promises");
      const indexPath = path.join(__dirname, "../frontend/operator-ui/dist/index.html");

      try {
        let html = await fs.readFile(indexPath, "utf-8");

        // Fix asset paths - change /assets/ to /app/assets/ since we serve from /app
        html = html.replace(/\/assets\//g, "/app/assets/");

        // Inject roomKey before the closing head tag - use JSON.stringify for JS-safe encoding
        // This prevents XSS by properly escaping special characters like quotes, backslashes, etc.
        const escapedRoomKey = JSON.stringify(roomKey);
        html = html.replace("</head>", `<script>window.ROOM_KEY = ${escapedRoomKey};</script></head>`);

        // Update title - HTML-escape to prevent XSS
        const htmlEscapedRoomKey = roomKey
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#x27;");
        html = html.replace(/<title>.*?<\/title>/, `<title>Room: ${htmlEscapedRoomKey}</title>`);

        res.type("html").send(html);
      } catch (error) {
        console.error("Error serving preview page:", error);
        res.status(500).send("Error loading preview page");
      }
    });

    // Serve built frontend assets - comes AFTER room route - protected
    const frontendDistPath = path.join(__dirname, "../frontend/operator-ui/dist");
    this.app.use("/app", this.requireAuth(), express.static(frontendDistPath));

    // Assistant UI Spike routes (/spike) - protected
    console.log("[ControlServer] Mounting assistant-ui spike at /spike");

    const spikeDistPath = path.join(__dirname, "../frontend/assistant-ui-spike/dist");

    // Serve spike index.html with room key from query param - protected
    this.app.get("/spike", this.requireAuth(), async (_req: Request, res: Response) => {
      const fs = await import("fs/promises");
      const indexPath = path.join(spikeDistPath, "index.html");

      try {
        let html = await fs.readFile(indexPath, "utf-8");

        // Fix asset paths
        html = html.replace(/\/assets\//g, "/spike/assets/");

        // Update title
        html = html.replace(/<title>.*?<\/title>/, `<title>Assistant UI Spike</title>`);

        // Inject build info for version marker
        const buildInfoScript = `<script>window.BUILD_INFO = { commit: "${process.env.GIT_COMMIT || "unknown"}", time: "${process.env.BUILD_TIME || new Date().toISOString()}" };</script>`;
        html = html.replace("</head>", `${buildInfoScript}</head>`);

        res.type("html").send(html);
      } catch (error) {
        console.error("Error serving spike page:", error);
        res.status(500).send("Error loading spike page");
      }
    });

    // Serve spike assets - protected
    this.app.use("/spike", this.requireAuth(), express.static(spikeDistPath));
  }

  /**
   * Constant-time string comparison to prevent timing attacks.
   */
  private constantTimeEqual(a: string, b: string): boolean {
    try {
      const bufA = Buffer.from(a, "utf-8");
      const bufB = Buffer.from(b, "utf-8");
      return timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }

  /**
   * Basic Auth middleware factory.
   * If auth is not configured, allows request through.
   * Otherwise requires valid Authorization: Basic header.
   */
  private requireAuth(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      // If auth is not configured, allow through
      if (!this.auth) {
        return next();
      }

      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Basic ")) {
        res.setHeader("WWW-Authenticate", 'Basic realm="pi-matrix-agent-control"');
        return res.status(401).json({ error: "Authentication required" });
      }

      // Decode Base64 safely
      const encoded = authHeader.substring(6); // Remove "Basic " prefix
      let decoded: string;
      try {
        decoded = Buffer.from(encoded, "base64").toString("utf-8");
      } catch {
        res.setHeader("WWW-Authenticate", 'Basic realm="pi-matrix-agent-control"');
        return res.status(401).json({ error: "Invalid authorization header" });
      }

      // Parse username:password
      const colonIndex = decoded.indexOf(":");
      if (colonIndex === -1) {
        res.setHeader("WWW-Authenticate", 'Basic realm="pi-matrix-agent-control"');
        return res.status(401).json({ error: "Invalid authorization header" });
      }

      const username = decoded.substring(0, colonIndex);
      const password = decoded.substring(colonIndex + 1);

      // Constant-time comparison
      if (
        !this.constantTimeEqual(username, this.auth.username) ||
        !this.constantTimeEqual(password, this.auth.password)
      ) {
        res.setHeader("WWW-Authenticate", 'Basic realm="pi-matrix-agent-control"');
        return res.status(401).json({ error: "Invalid credentials" });
      }

      next();
    };
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
    return new Promise((resolve, _reject) => {
      if (!this.server) {
        console.log("[ControlServer] No server to stop");
        resolve();
        return;
      }

      console.log("[ControlServer] Closing HTTP server...");

      // First, close all active connections explicitly
      const connectionCount = this.activeConnections.size;
      if (connectionCount > 0) {
        console.log(`[ControlServer] Closing ${connectionCount} active connection(s)...`);
        for (const socket of this.activeConnections) {
          try {
            socket.destroy();
          } catch (err) {
            console.debug(`[ControlServer] Error destroying connection:`, err);
          }
        }
        this.activeConnections.clear();
      }

      // Then close the server
      this.server.close((err) => {
        if (err) {
          console.error("[ControlServer] Error closing server:", err);
          // Don't reject - we still want to clean up
        }
        console.log("[ControlServer] HTTP server closed");
        this.server = undefined;
        resolve();
      });

      // Timeout after 5 seconds to prevent indefinite hangs
      // This is a safety net - if connections don't close, we force exit
      const timeout = setTimeout(() => {
        console.warn("[ControlServer] Server close timed out after 5s, forcing close");
        this.server = undefined;
        resolve();
      }, 5000);

      // Listen for unexpected errors during close
      this.server.once("error", (err) => {
        clearTimeout(timeout);
        console.error("[ControlServer] Server error during close:", err);
        this.server = undefined;
        resolve();
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  getHost(): string {
    return this.host;
  }
}
