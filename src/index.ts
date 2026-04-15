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
        modelSwitcher: piBackend, // Enable model switching
        controlUrl: controlPublicUrl, // Use public URL for !control command
        startTypingLoop: (roomId) => transport.startTypingLoop(roomId),
        stopTypingLoop: (interval) => transport.stopTypingLoop(interval),
        isRoomProcessing: (roomId) => piBackend.checkProcessingGuard(roomId) !== null,
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

  // Graceful shutdown handler
  let shuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      console.log(`[SHUTDOWN] Already shutting down, ignoring ${signal}`);
      return;
    }
    shuttingDown = true;

    console.log(`[SHUTDOWN] Received ${signal}, starting graceful shutdown...`);

    // Set a hard timeout for the entire shutdown process (15 seconds total)
    const shutdownTimeout = setTimeout(() => {
      console.error("[SHUTDOWN] Hard timeout reached - forcing exit");
      process.exit(1);
    }, 15000);

    try {
      // Stage 1: Stop accepting new Matrix messages by stopping the client
      console.log("[SHUTDOWN] Stage 1: Stopping Matrix client...");
      const stopMatrixPromise = transport.stop();
      // Wait up to 5 seconds for Matrix client to stop
      await Promise.race([
        stopMatrixPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Matrix client stop timeout")), 5000)),
      ]);
      console.log("[SHUTDOWN] Stage 1: Matrix client stopped");
    } catch (error: any) {
      console.error("[SHUTDOWN] Error or timeout stopping Matrix client:", error.message);
    }

    try {
      // Stage 2: Close HTTP server and drain connections
      console.log("[SHUTDOWN] Stage 2: Closing HTTP control server...");
      const stopServerPromise = controlServer.stop();
      // Wait up to 5 seconds for HTTP server to close
      await Promise.race([
        stopServerPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("HTTP server close timeout")), 5000)),
      ]);
      console.log("[SHUTDOWN] Stage 2: HTTP control server closed");
    } catch (error: any) {
      console.error("[SHUTDOWN] Error or timeout closing HTTP server:", error.message);
    }

    try {
      // Stage 3: Dispose backend (clears all room state, sessions, timeouts)
      console.log("[SHUTDOWN] Stage 3: Disposing Pi backend...");
      const disposeBackendPromise = piBackend.dispose();
      // Wait up to 3 seconds for backend disposal
      await Promise.race([
        disposeBackendPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Backend disposal timeout")), 3000)),
      ]);
      console.log("[SHUTDOWN] Stage 3: Pi backend disposed");
    } catch (error: any) {
      console.error("[SHUTDOWN] Error or timeout disposing backend:", error.message);
    }

    clearTimeout(shutdownTimeout);
    console.log("[SHUTDOWN] Graceful shutdown completed successfully");

    // Exit with success code
    process.exit(0);
  }

  // Signal handlers
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
