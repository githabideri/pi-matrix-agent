import { loadConfig } from "./config.js";
import { SimpleInferenceBackend } from "./inference.js";
import { MatrixTransport } from "./matrix.js";
import { SessionRegistry } from "./sessions.js";
import type { IncomingMessage } from "./types.js";
import { routeMessage } from "./router.js";

async function main() {
  console.log("Starting pi-matrix-agent...");

  const config = loadConfig();
  console.log(`Connected to: ${config.homeserverUrl}`);
  console.log(`Allowed rooms: ${config.allowedRoomIds.join(", ")}`);
  console.log(`Allowed users: ${config.allowedUserIds.join(", ")}`);

  // Create simple inference backend
  const inferenceBackend = new SimpleInferenceBackend({
    baseUrl: config.inferenceBaseUrl,
    model: config.inferenceModel,
    apiKey: config.inferenceApiKey,
    maxTokens: config.inferenceMaxTokens,
  });

  // Create session registry for reset functionality
  // Factory not needed - we just use drop() to clear session dirs
  const sessionRegistry = new SessionRegistry<any>(
    async () => ({}),
    config.sessionBaseDir
  );

  // Create Matrix transport
  const transport = new MatrixTransport(
    config.homeserverUrl,
    config.accessToken,
    config.allowedRoomIds,
    config.botUserId,
    config.storageFile
  );

  // Set up message handler
  transport.onMessage(async (msg: IncomingMessage) => {
    try {
      await routeMessage(msg, {
        config: {
          allowedRoomIds: config.allowedRoomIds,
          allowedUserIds: config.allowedUserIds,
          agent: inferenceBackend,
          sink: transport,
        },
        sessionRegistry,
      });
    } catch (error) {
      console.error(`Error routing message:`, error);
    }
  });

  // Start
  await transport.start();

  console.log("pi-matrix-agent running");

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await transport.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("Shutting down...");
    await transport.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
