import { loadConfig, getControlPort, getControlHost, getControlPublicUrl } from "./config.js";
import { PiSessionBackend } from "./pi-backend.js";
import { MatrixTransport } from "./matrix.js";
import { ControlServer } from "./control-server.js";
import type { IncomingMessage } from "./types.js";
import { routeMessage } from "./router.js";

// Global crash handlers for diagnosis
process.on("unhandledRejection", (reason, promise) => {
  console.error("=== UNHANDLED REJECTION ===");
  console.error("Reason:", reason);
  console.error("Promise:", promise);
  console.error("Stack:", reason instanceof Error ? reason.stack : "N/A");
});

process.on("uncaughtException", (error) => {
  console.error("=== UNCAUGHT EXCEPTION ===");
  console.error("Error:", error);
  console.error("Stack:", error.stack);
});

async function main() {
  console.log("Starting pi-matrix-agent...");

  const config = loadConfig();
  console.log(`Connected to: ${config.homeserverUrl}`);
  console.log(`Allowed rooms: ${config.allowedRoomIds.join(", ")}`);
  console.log(`Allowed users: ${config.allowedUserIds.join(", ")}`);
  console.log(`Session base dir: ${config.sessionBaseDir}`);

  // Create pi session backend (stateful, per-room sessions)
  const piBackend = new PiSessionBackend({
    sessionBaseDir: config.sessionBaseDir,
    cwd: config.workingDirectory || process.cwd(),
  });

  // Create Matrix transport
  const transport = new MatrixTransport(
    config.homeserverUrl,
    config.accessToken,
    config.allowedRoomIds,
    config.botUserId,
    config.storageFile
  );

  // Create control server
  const controlPort = getControlPort();
  const controlHost = getControlHost();
  const controlServer = new ControlServer(
    piBackend,
    config.workingDirectory || process.cwd(),
    config.sessionBaseDir,
    { port: controlPort, host: controlHost }
  );

  const controlUrl = `http://${controlHost}:${controlPort}`;
  const controlPublicUrl = getControlPublicUrl(config);
  console.log(`Control server URL: ${controlUrl}`);
  console.log(`Control public URL: ${controlPublicUrl}`);

  // Set up message handler
  transport.onMessage(async (msg: IncomingMessage) => {
    try {
      await routeMessage(msg, {
        config: {
          allowedRoomIds: config.allowedRoomIds,
          allowedUserIds: config.allowedUserIds,
          agent: piBackend,
          sink: transport,
        },
        sessionRegistry: piBackend,
        controlUrl: controlPublicUrl, // Use public URL for !control command
        startTypingLoop: (roomId) => transport.startTypingLoop(roomId),
        stopTypingLoop: (interval) => transport.stopTypingLoop(interval),
      });
    } catch (error) {
      console.error(`Error routing message:`, error);
    }
  });

  // Start control server first
  await controlServer.start();

  // Start Matrix transport
  await transport.start();

  console.log("pi-matrix-agent running");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await piBackend.dispose();
    await controlServer.stop();
    await transport.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("Shutting down...");
    await piBackend.dispose();
    await controlServer.stop();
    await transport.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
