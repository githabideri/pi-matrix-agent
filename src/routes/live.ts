import { type Request, type Response, Router } from "express";
import type { PiSessionBackend } from "../pi-backend.js";
import { getRelativeSessionPath } from "../room-state.js";
import { buildLiveTranscript } from "../transcript.js";

export function routeLive(piBackend: PiSessionBackend, workingDirectory: string) {
  const router = Router();

  // GET /api/live/rooms - List all live rooms
  router.get("/", (_req: Request, res: Response) => {
    const liveRooms = piBackend.listLiveRooms();
    const result = liveRooms.map((room) => ({
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
    const roomState = piBackend.getSessionByKey(roomKey);

    if (!roomState) {
      console.log(`[LIVE] Room ${roomKey} not found`);
      return res.status(404).json({ error: "Room not found" });
    }

    console.log(`[LIVE] Room state found: isProcessing=${roomState.isProcessing}, snapshot=${!!roomState.snapshot}`);

    try {
      console.log(`[LIVE] Building response object...`);
      // Build response directly from room state, no async calls
      const response: any = {
        roomId: roomState.roomId,
        roomKey: roomState.roomKey,
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

      console.log(`[LIVE] Response object built, sending JSON...`);
      console.log(`[LIVE] Response:`, JSON.stringify(response, null, 2));
      res.json(response);
      console.log(`[LIVE] res.json() called`);
    } catch (error: any) {
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
    const response: any = {
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

    // If processing, return minimal response immediately
    if (roomState.isProcessing) {
      return res.json({
        roomId: roomState.roomId,
        roomKey: roomKey,
        sessionId: roomState.sessionId,
        sessionFile: roomState.sessionFile,
        relativeSessionPath: roomState.sessionFile
          ? getRelativeSessionPath(roomState.sessionFile, workingDirectory)
          : undefined,
        items: [], // Empty while processing - file may be locked
        isProcessing: true,
      });
    }

    try {
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

  // GET /api/live/rooms/:roomKey/events - SSE event stream
  router.get("/:roomKey/events", (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const roomState = piBackend.getSessionByKey(roomKey);

    if (!roomState) {
      return res.status(404).json({ error: "Room not found" });
    }

    // Set up SSE response
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Send initial connection event
    res.write(`event: connected\ndata: {"roomKey": "${roomKey}", "timestamp": "${new Date().toISOString()}"}\n\n`);

    // Subscribe to session events
    const unsubscribe = roomState.session.subscribe((event) => {
      // Filter and format events for SSE
      let eventData: any;

      switch (event.type) {
        case "message_start":
          eventData = { type: "run_start", timestamp: new Date().toISOString() };
          break;
        case "message_update":
          if (event.assistantMessageEvent.type === "text_delta") {
            eventData = {
              type: "text_delta",
              delta: event.assistantMessageEvent.delta,
              timestamp: new Date().toISOString(),
            };
          }
          break;
        case "tool_execution_start":
          eventData = {
            type: "tool_start",
            toolName: (event as any).toolExecutionEvent?.name,
            toolCallId: (event as any).toolExecutionEvent?.toolCallId,
            timestamp: new Date().toISOString(),
          };
          break;
        case "tool_execution_end":
          eventData = {
            type: "tool_end",
            toolName: (event as any).toolResultEvent?.name,
            toolCallId: (event as any).toolResultEvent?.toolCallId,
            success: !(event as any).toolResultEvent?.isError,
            timestamp: new Date().toISOString(),
          };
          break;
        case "message_end":
          eventData = { type: "run_end", timestamp: new Date().toISOString() };
          break;
        default:
          // Pass through other events with sanitized data
          eventData = {
            type: event.type,
            timestamp: new Date().toISOString(),
          };
      }

      if (eventData) {
        try {
          res.write(`data: ${JSON.stringify(eventData)}\n\n`);
        } catch (err) {
          console.error("Error writing SSE event:", err);
        }
      }
    });

    // Cleanup on client disconnect
    req.on("close", () => {
      console.log(`[SSE] Client disconnected for room ${roomKey}`);
      unsubscribe();
    });

    console.log(`[SSE] Client connected for room ${roomKey}`);
  });

  return router;
}
