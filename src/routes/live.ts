import { Router, Request, Response } from "express";
import { PiSessionBackend } from "../pi-backend.js";
import { buildContextManifest, manifestToResponse } from "../context-manifest.js";
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
    const roomState = piBackend.getSessionByKey(roomKey);

    if (!roomState) {
      return res.status(404).json({ error: "Room not found" });
    }

    try {
      const manifest = await buildContextManifest(roomState, workingDirectory);
      const response = manifestToResponse(manifest);
      // Add extra fields for room details
      response.processingStartedAt = roomState.processingStartedAt?.toISOString();
      res.json(response);
    } catch (error) {
      console.error(`Error getting room details for ${roomKey}:`, error);
      res.status(500).json({ error: "Failed to get room details" });
    }
  });

  // GET /api/live/rooms/:roomKey/context - Get context manifest
  router.get("/:roomKey/context", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const roomState = piBackend.getSessionByKey(roomKey);

    if (!roomState) {
      return res.status(404).json({ error: "Room not found" });
    }

    try {
      const manifest = await buildContextManifest(roomState, workingDirectory);
      res.json(manifestToResponse(manifest));
    } catch (error) {
      console.error(`Error building context manifest for ${roomKey}:`, error);
      res.status(500).json({ error: "Failed to build context manifest" });
    }
  });

  // GET /api/live/rooms/:roomKey/transcript - Get live session transcript
  router.get("/:roomKey/transcript", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const roomState = piBackend.getSessionByKey(roomKey);

    if (!roomState) {
      return res.status(404).json({ error: "Room not found" });
    }

    try {
      const transcript = await buildLiveTranscript(
        roomState.sessionId || "",
        roomState.sessionFile,
        { baseDir: workingDirectory }
      );

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
