import { type Request, type Response, Router } from "express";
import type { PiSessionBackend } from "../pi-backend.js";
import { extractSessionIdFromFilename, parseSessionMetadata, RoomStateManager } from "../room-state.js";
import { parseSessionFile } from "../transcript.js";

export function routeArchive(piBackend: PiSessionBackend, sessionBaseDir: string) {
  const router = Router();

  // Debug endpoint
  router.get("/debug", (_req: Request, res: Response) => {
    console.log("[ARCHIVE] Debug endpoint hit!");
    res.json({ ok: true, sessionBaseDir });
  });

  // GET /api/archive/rooms/:roomKey/sessions - List archived sessions for a room
  router.get("/:roomKey/sessions", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    console.log(`[ARCHIVE] Listing sessions for roomKey: ${roomKey}`);

    // First try to find the room in live rooms
    const roomId = piBackend.getRoomIdByKey(roomKey);
    console.log(`[ARCHIVE] roomId from live rooms: ${roomId}`);

    try {
      let archived: any[] = [];

      if (roomId) {
        // Room is live, use existing method
        console.log(`[ARCHIVE] Room is live, calling getArchivedSessionsForRoom`);
        archived = await piBackend.getArchivedSessionsForRoom(roomId);
      } else {
        // Room might be archived - search in the room directory directly
        console.log(`[ARCHIVE] Room not live, searching directory directly`);
        archived = await findArchivedSessionsInRoomDir(roomKey, sessionBaseDir);
      }
      console.log(`[ARCHIVE] Found ${archived.length} archived sessions`);

      // Format response
      const result = archived.map((session) => ({
        sessionId: session.id,
        relativeSessionPath: getRelativePath(session.path, sessionBaseDir),
        firstMessage: session.firstMessage,
      }));

      res.json(result);
    } catch (error) {
      console.error(`Error listing archived sessions for ${roomKey}:`, error);
      res.status(500).json({ error: "Failed to list archived sessions" });
    }
  });

  // GET /api/archive/rooms/:roomKey/sessions/:sessionId - Get metadata for one archived session
  router.get("/:roomKey/sessions/:sessionId", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const sessionId = req.params.sessionId;

    try {
      // Find the session file directly in the room directory
      const sessionFile = await findSessionFileInRoomDir(roomKey, sessionId, sessionBaseDir);

      if (!sessionFile) {
        return res.status(404).json({ error: "Session not found" });
      }

      const metadata = await parseSessionMetadata(sessionFile, sessionBaseDir);
      metadata.isLive = false;

      res.json({
        sessionId: metadata.sessionId,
        relativeSessionPath: metadata.relativePath,
        firstMessage: metadata.firstMessage,
        isLive: false,
      });
    } catch (error) {
      console.error(`Error getting archived session metadata for ${roomKey}/${sessionId}:`, error);
      res.status(500).json({ error: "Failed to get session metadata" });
    }
  });

  // GET /api/archive/rooms/:roomKey/sessions/:sessionId/transcript - Get transcript
  router.get("/:roomKey/sessions/:sessionId/transcript", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const sessionId = req.params.sessionId;

    try {
      // Find the session file directly in the room directory
      const sessionFile = await findSessionFileInRoomDir(roomKey, sessionId, sessionBaseDir);

      if (!sessionFile) {
        return res.status(404).json({ error: "Session not found" });
      }

      // Use the new normalized transcript parser
      const transcript = await parseSessionFile(sessionFile, { baseDir: sessionBaseDir });

      // Add room context
      transcript.roomKey = roomKey;
      transcript.sessionFile = sessionFile;

      res.json(transcript);
    } catch (error) {
      console.error(`Error getting transcript for ${roomKey}/${sessionId}:`, error);
      res.status(500).json({ error: "Failed to get transcript" });
    }
  });

  // Catch-all for debugging
  router.use("/", (req: Request, res: Response) => {
    console.log(`[ARCHIVE] Catch-all hit: ${req.method} ${req.path}`);
    res.status(404).json({ error: "Not found in archive router", path: req.path });
  });

  return router;
}

/**
 * Get relative path from sessionBaseDir.
 */
function getRelativePath(sessionFile: string, baseDir: string): string {
  const relative = sessionFile.replace(baseDir, "");
  return relative.startsWith("/") ? relative.slice(1) : relative;
}

/**
 * Find session file by session ID within a room's directory (given roomKey).
 */
async function findSessionFileInRoomDir(
  roomKey: string,
  sessionId: string,
  sessionBaseDir: string,
): Promise<string | null> {
  const fs = await import("fs/promises");
  const path = await import("path");

  const roomSessionDir = path.join(sessionBaseDir, `room-${roomKey}`);

  try {
    const entries = await fs.readdir(roomSessionDir);

    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) {
        const fileId = extractSessionIdFromFilename(entry);
        if (fileId === sessionId || entry.startsWith(`${sessionId}_`)) {
          return path.join(roomSessionDir, entry);
        }
      }
    }
  } catch {
    // Directory might not exist
  }

  return null;
}

/**
 * Find session file by session ID within a room's directory (given roomId).
 * Kept for backwards compatibility with live room lookups.
 */
async function _findSessionFileBySessionId(
  roomId: string,
  sessionId: string,
  sessionBaseDir: string,
): Promise<string | null> {
  const roomKey = RoomStateManager.hashRoomId(roomId);
  return findSessionFileInRoomDir(roomKey, sessionId, sessionBaseDir);
}

/**
 * Find archived sessions in a room directory.
 */
async function findArchivedSessionsInRoomDir(roomKey: string, sessionBaseDir: string): Promise<any[]> {
  const fs = await import("fs/promises");
  const path = await import("path");

  const roomSessionDir = path.join(sessionBaseDir, `room-${roomKey}`);
  const results: any[] = [];

  try {
    const entries = await fs.readdir(roomSessionDir);

    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) {
        const sessionFile = path.join(roomSessionDir, entry);
        try {
          const metadata = await parseSessionMetadata(sessionFile, sessionBaseDir);
          results.push({
            id: metadata.sessionId,
            path: sessionFile,
            firstMessage: metadata.firstMessage,
          });
        } catch {
          // Skip invalid files
        }
      }
    }
  } catch {
    // Directory might not exist
  }

  return results;
}
