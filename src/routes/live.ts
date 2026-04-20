import { type Request, type Response, Router } from "express";
import type { MatrixTransport } from "../matrix.js";
import type { PiSessionBackend } from "../pi-backend.js";
import { getRelativeSessionPath } from "../room-state.js";
import {
  buildLiveTranscript,
  liveTurnBufferToTranscriptItems,
  mergeTranscriptItems,
  type TranscriptItem,
} from "../transcript.js";
import type { AcceptedPromptResponse, ContextResponse, LiveRoomDetail, LiveRoomListItem } from "../types.js";
import { attachEmitterToSSE, WebUIEmitter } from "../webui-emitter.js";

export function routeLive(
  piBackend: PiSessionBackend,
  workingDirectory: string,
  matrixTransport?: MatrixTransport, // Optional: for syncing web UI messages to Matrix
) {
  const router = Router();

  // GET /api/live/rooms - List all live rooms
  router.get("/", (_req: Request, res: Response): void => {
    const liveRooms = piBackend.listLiveRooms();
    const result: LiveRoomListItem[] = liveRooms.map((room) => ({
      roomId: room.roomId,
      roomKey: room.roomKey,
      sessionId: room.sessionId,
      relativeSessionPath: room.sessionFile ? getRelativeSessionPath(room.sessionFile, workingDirectory) : undefined,
      isProcessing: room.isProcessing,
      processingStartedAt: room.processingStartedAt?.toISOString(),
    }));
    res.json(result);
  });

  // GET /api/live/rooms/:roomKey - Get details for one live room
  router.get("/:roomKey", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    console.log(`[LIVE] Getting room details for ${roomKey}`);
    let roomState = piBackend.getSessionByKey(roomKey);

    // Check if this is a persisted room (has desired model but not live)
    const roomId = piBackend.getRoomIdByRoomKey(roomKey);
    const isPersistedRoom = roomId && !roomState;

    // Rehydrate managed room on demand for control-plane access
    if (isPersistedRoom && roomId) {
      console.log(`[LIVE] Rehydrating managed room ${roomKey} (${roomId}) on demand`);
      try {
        await piBackend.getOrCreateSession(roomId);
        roomState = piBackend.getSessionByKey(roomKey);
        if (!roomState) {
          console.error(`[LIVE] Failed to rehydrate room ${roomKey}`);
          return res.status(500).json({ error: "Failed to rehydrate room" });
        }
        console.log(`[LIVE] Room ${roomKey} rehydrated successfully`);
      } catch (error: any) {
        console.error(`[LIVE] Error rehydrating room ${roomKey}:`, error);
        return res.status(500).json({ error: "Failed to rehydrate room" });
      }
    }

    if (!roomState) {
      console.log(`[LIVE] Room ${roomKey} not found`);
      return res.status(404).json({ error: "Room not found" });
    }

    console.log(`[LIVE] Room state found: isProcessing=${roomState.isProcessing}, snapshot=${!!roomState.snapshot}`);

    try {
      console.log(`[LIVE] Building response object...`);
      // Build response directly from room state, no async calls
      const response: LiveRoomDetail = {
        roomId: roomState.roomId,
        roomKey: roomKey,
        sessionId: roomState.sessionId,
        relativeSessionPath: roomState.sessionFile
          ? getRelativeSessionPath(roomState.sessionFile, workingDirectory)
          : undefined,
        isProcessing: roomState.isProcessing,
        processingStartedAt: roomState.processingStartedAt?.toISOString(),
      };

      // Add snapshot data if available
      if (roomState.snapshot) {
        response.model = roomState.snapshot.model;
        response.thinkingLevel = roomState.snapshot.thinkingLevel;
        response.toolNames = roomState.snapshot.toolNames;
        response.snapshotAt = roomState.snapshot.snapshotAt.toISOString();
      }

      // Add desired model info from persisted state
      const desiredModel = piBackend.getDesiredModelForRoom(roomState.roomId);
      if (desiredModel) {
        response.desiredModel = desiredModel.desiredModel;
        response.desiredResolvedModelId = desiredModel.resolvedModelId;
      }

      console.log(`[LIVE] Response object built, sending JSON...`);
      console.log(`[LIVE] Response:`, JSON.stringify(response, null, 2));
      res.json(response);
      console.log(`[LIVE] res.json() called`);
    } catch (error: unknown) {
      console.error(`[LIVE] Error getting room details for ${roomKey}:`, error);
      res.status(500).json({ error: "Failed to get room details" });
    }
  });

  // GET /api/live/rooms/:roomKey/context - Get context manifest
  router.get("/:roomKey/context", (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const roomState = piBackend.getSessionByKey(roomKey);

    if (!roomState) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Build response directly from snapshot (no async operations)
    const response: ContextResponse = {
      roomId: roomState.roomId,
      roomKey: roomState.roomKey,
      sessionId: roomState.sessionId,
      relativeSessionPath: roomState.sessionFile
        ? getRelativeSessionPath(roomState.sessionFile, workingDirectory)
        : undefined,
      workingDirectory: workingDirectory,
      model: roomState.snapshot?.model,
      thinkingLevel: roomState.snapshot?.thinkingLevel,
      isProcessing: roomState.isProcessing,
      isStreaming: roomState.isProcessing ? true : undefined,
      processingStartedAt: roomState.processingStartedAt?.toISOString(),
      toolNames: roomState.snapshot?.toolNames || ["read", "bash", "edit", "write"],
      resourceLoaderType: "DefaultResourceLoader",
      contextSources: [], // Skip file reads - not critical for control plane
      generatedAt: new Date().toISOString(),
      snapshotAt: roomState.snapshot?.snapshotAt?.toISOString(),
    };

    res.json(response);
  });

  // GET /api/live/rooms/:roomKey/transcript - Get live session transcript
  router.get("/:roomKey/transcript", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const roomState = piBackend.getSessionByKey(roomKey);

    if (!roomState) {
      return res.status(404).json({ error: "Room not found" });
    }

    try {
      let persistedItems: TranscriptItem[] = [];
      let liveItems: TranscriptItem[] = [];

      // Case 1: Room is processing - return persisted + live items
      if (roomState.isProcessing) {
        // Get persisted transcript from session file (if exists)
        if (roomState.sessionFile) {
          try {
            const persistedTranscript = await buildLiveTranscript(roomState.sessionId || "", roomState.sessionFile, {
              baseDir: workingDirectory,
            });
            persistedItems = persistedTranscript.items;
          } catch (err) {
            console.warn(`Warning: Could not read persisted transcript for ${roomKey}:`, err);
            // Continue with empty persisted items
          }
        }

        // Get live current-turn items from the buffer
        const liveTurnBuffer = piBackend.getRoomStateManager().getLiveTurnBuffer(roomState.roomId);
        liveItems = liveTurnBufferToTranscriptItems(liveTurnBuffer);

        // Merge persisted and live items with deduplication
        const mergedItems = mergeTranscriptItems(persistedItems, liveItems);

        return res.json({
          roomId: roomState.roomId,
          roomKey: roomKey,
          sessionId: roomState.sessionId,
          sessionFile: roomState.sessionFile,
          relativeSessionPath: roomState.sessionFile
            ? getRelativeSessionPath(roomState.sessionFile, workingDirectory)
            : undefined,
          items: mergedItems,
          isProcessing: true,
        });
      }

      // Case 2: Room is not processing - return persisted transcript only
      const transcript = await buildLiveTranscript(roomState.sessionId || "", roomState.sessionFile, {
        baseDir: workingDirectory,
      });

      // Add room context
      transcript.roomId = roomState.roomId;
      transcript.roomKey = roomKey;
      transcript.sessionFile = roomState.sessionFile;

      res.json(transcript);
    } catch (error) {
      console.error(`Error getting transcript for ${roomKey}:`, error);
      res.status(500).json({ error: "Failed to get transcript" });
    }
  });

  // POST /api/live/rooms/:roomKey/prompt - Submit prompt to live session
  // Non-blocking: returns quickly with accepted metadata
  // Actual output comes through SSE events and transcript
  // Note: turnId is NOT in response - SSE provides authoritative turnId via turn_start event
  router.post("/:roomKey/prompt", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const roomState = piBackend.getSessionByKey(roomKey);

    if (!roomState) {
      console.log(`[PROMPT] Room ${roomKey} not found`);
      return res.status(404).json({ error: "Room not found" });
    }

    const { text } = req.body;

    if (!text || typeof text !== "string") {
      console.log(`[PROMPT] Invalid request body for room ${roomKey}`);
      return res.status(400).json({ error: "Missing or invalid 'text' field" });
    }

    const roomId = roomState.roomId;

    // Preflight busy check: reject if room is already processing
    if (roomState.isProcessing) {
      console.log(`[PROMPT] Room ${roomKey} is already processing, rejecting with 409`);
      return res.status(409).json({
        error: "Room is currently processing another request",
        retryAfter: 5, // Suggested retry delay in seconds
      });
    }

    console.log(`[PROMPT] Accepted prompt for room ${roomKey}, text: "${text.slice(0, 50)}..."`);

    // Mirror the prompt to Matrix with [WebUI] prefix
    // Loop prevention: bot ignores its own messages (event.sender === this.userId)
    if (matrixTransport) {
      try {
        const mirroredPrompt = `[WebUI] ${text}`;
        await matrixTransport.reply(roomId, "", mirroredPrompt, { webUI: true });
        console.log(`[PROMPT] Mirrored prompt to Matrix room ${roomId}`);
      } catch (error) {
        console.warn(`[PROMPT] Failed to mirror prompt to Matrix:`, error);
        // Don't fail the request - Matrix mirroring is best-effort
      }
    }

    // Fire-and-forget: submit prompt without waiting for completion
    // The SSE stream will deliver the actual response
    piBackend
      .prompt(roomId, text)
      .then((response) => {
        console.log(`[PROMPT] Completed for room ${roomKey}, response length: ${response.length}`);
        // Mirror the final assistant response to Matrix with rich formatting
        if (matrixTransport && response) {
          matrixTransport
            .reply(roomId, "", response)
            .catch((err) => console.warn(`[PROMPT] Failed to mirror response to Matrix:`, err));
        }
      })
      .catch((error) => {
        console.error(`[PROMPT] Error for room ${roomKey}:`, error);
        // Mirror error to Matrix (plain text, prefixed with [WebUI])
        if (matrixTransport) {
          const errorMsg = `[WebUI] Error: ${error instanceof Error ? error.message : String(error)}`;
          matrixTransport
            .reply(roomId, "", errorMsg, { webUI: true })
            .catch((err) => console.warn(`[PROMPT] Failed to mirror error to Matrix:`, err));
        }
      });

    // Return immediately with accepted metadata (no turnId - SSE provides authoritative turnId)
    const response: AcceptedPromptResponse = {
      accepted: true,
      roomKey,
      roomId,
      sessionId: roomState.sessionId,
      timestamp: new Date().toISOString(),
    };
    res.json(response);
  });

  // POST /api/live/rooms/:roomKey/reset - Reset live session
  router.post("/:roomKey/reset", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const roomId = piBackend.getRoomIdByKey(roomKey);

    if (!roomId) {
      return res.status(404).json({ error: "Room not found" });
    }

    try {
      await piBackend.reset(roomId);
      res.json({ message: "Session reset successful", roomKey });
    } catch (error) {
      console.error(`Error resetting session for ${roomKey}:`, error);
      res.status(500).json({ error: "Failed to reset session" });
    }
  });

  // GET /api/live/rooms/:roomKey/events - SSE event stream (normalized WebUI events)
  router.get("/:roomKey/events", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    let roomState = piBackend.getSessionByKey(roomKey);

    // Check if this is a persisted room (has desired model but not live)
    const roomId = piBackend.getRoomIdByRoomKey(roomKey);
    const isPersistedRoom = roomId && !roomState;

    if (!roomState && !isPersistedRoom) {
      console.log(`[SSE] Room ${roomKey} not found`);
      return res.status(404).json({ error: "Room not found" });
    }

    // Lazily hydrate persisted room on first SSE connection
    if (isPersistedRoom && roomId) {
      console.log(`[SSE] Lazily hydrating persisted room ${roomKey} (${roomId})`);
      try {
        await piBackend.getOrCreateSession(roomId);
        roomState = piBackend.getSessionByKey(roomKey);
        if (!roomState) {
          console.error(`[SSE] Failed to hydrate room ${roomKey}`);
          return res.status(500).json({ error: "Failed to hydrate room" });
        }
        console.log(`[SSE] Room ${roomKey} hydrated successfully`);
      } catch (error) {
        console.error(`[SSE] Error hydrating room ${roomKey}:`, error);
        return res.status(500).json({ error: "Failed to hydrate room" });
      }
    }

    // Get live turn buffer for snapshot generation
    const liveTurnBuffer = piBackend.getRoomStateManager().getLiveTurnBuffer(roomState!.roomId);

    // Create WebUI emitter for this room with snapshot context
    const emitter = new WebUIEmitter({
      roomId: roomState!.roomId,
      roomKey: roomKey,
      sessionId: roomState!.sessionId || "",
      sessionFile: roomState!.sessionFile,
      workingDirectory: workingDirectory,
      isProcessing: roomState!.isProcessing,
      liveTurnBuffer,
    });

    // Attach emitter to SSE response
    const cleanup = attachEmitterToSSE(res, emitter);

    // Start emitting events (includes initial snapshot)
    await emitter.start(roomState!.session);

    // Cleanup on client disconnect
    req.on("close", () => {
      console.log(`[SSE] Client disconnected for room ${roomKey}`);
      cleanup();
    });
  });

  return router;
}
