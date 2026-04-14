import { loadRuntimeConfig, printRuntimeConfig, validateRuntime } from "./config.js";
import { ControlServer } from "./control-server.js";
import { MatrixTransport } from "./matrix.js";
import { PiSessionBackend } from "./pi-backend.js";
import { routeMessage } from "./router.js";
import type { IncomingMessage } from "./types.js";

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

  // Load full runtime configuration
  const runtime = loadRuntimeConfig();
  const config = runtime.config;

  // Validate runtime prerequisites
  validateRuntime(config);

  // Print effective runtime config
  printRuntimeConfig(config, runtime.controlPort, runtime.controlHost, runtime.controlPublicUrl);

  // Create pi session backend (stateful, per-room sessions)
  const piBackend = new PiSessionBackend({
    sessionBaseDir: config.sessionBaseDir,
    cwd: config.workingDirectory || process.cwd(),
    agentDir: config.agentDir,
  });

  // Create Matrix transport
  const transport = new MatrixTransport(
    config.homeserverUrl,
    config.accessToken,
    config.allowedRoomIds,
    config.botUserId,
    config.storageFile,
  );

  // Create control server (pass matrix transport for web UI → Matrix sync)
  const controlServer = new ControlServer(
    piBackend,
    config.workingDirectory || process.cwd(),
    config.sessionBaseDir,
    {
      port: runtime.controlPort,
      host: runtime.controlHost,
    },
    transport, // Pass matrix transport for syncing web UI messages
  );

  const controlPublicUrl = runtime.controlPublicUrl;

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

  // Start Matrix transport (unless disabled for smoke tests)
  if (process.env.ENABLE_MATRIX !== "false") {
    await transport.start();
  } else {
    console.log("[Control-only mode] Matrix transport disabled");
  }

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
