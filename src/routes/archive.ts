import { type Request, type Response, Router } from "express";
import type { PiSessionBackend } from "../pi-backend.js";
import { extractSessionIdFromFilename, parseSessionMetadata, RoomStateManager } from "../room-state.js";
import { parseSessionFile } from "../transcript.js";
import type { ArchiveSessionListItem, ArchiveSessionMetadataResponse, InternalSessionInfo } from "../types.js";

// Validation patterns
const ROOM_KEY_PATTERN = /^[0-9a-f]+$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Validates that roomKey contains only lowercase hexadecimal characters.
 */
export function isValidRoomKey(roomKey: string): boolean {
  return typeof roomKey === "string" && ROOM_KEY_PATTERN.test(roomKey);
}

/**
 * Validates that sessionId contains only safe alphanumeric and limited special characters.
 */
export function isValidSessionId(sessionId: string): boolean {
  return typeof sessionId === "string" && SESSION_ID_PATTERN.test(sessionId);
}

/**
 * Resolves and validates a room session directory path.
 *
 * - Validates roomKey format
 * - Resolves sessionBaseDir to absolute path
 * - Resolves room-${roomKey} underneath it
 * - Verifies the resolved path stays inside the base dir (path traversal protection)
 *
 * @throws {Error} if roomKey is invalid or path escapes base dir
 */
export async function resolveRoomSessionDir(sessionBaseDir: string, roomKey: string): Promise<string> {
  if (!isValidRoomKey(roomKey)) {
    throw new Error(`Invalid room key: ${roomKey}`);
  }

  const path = await import("path");

  // Resolve base dir to absolute path
  const resolvedBaseDir = path.resolve(sessionBaseDir);

  // Construct the room session directory path
  const roomSessionDir = path.join(resolvedBaseDir, `room-${roomKey}`);

  // Resolve to absolute and verify it stays inside base dir
  const resolvedRoomDir = path.resolve(roomSessionDir);

  if (!resolvedRoomDir.startsWith(resolvedBaseDir + path.sep) && resolvedRoomDir !== resolvedBaseDir) {
    throw new Error(`Path traversal detected: ${resolvedRoomDir} escapes ${resolvedBaseDir}`);
  }

  return resolvedRoomDir;
}

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

    // Validate roomKey before any file I/O
    if (!isValidRoomKey(roomKey)) {
      return res.status(400).json({ error: "Invalid room key" });
    }

    // First try to find the room in live rooms
    const roomId = piBackend.getRoomIdByKey(roomKey);
    console.log(`[ARCHIVE] roomId from live rooms: ${roomId}`);

    try {
      let archived: InternalSessionInfo[] = [];

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
      const result: ArchiveSessionListItem[] = archived.map((session) => ({
        sessionId: session.id,
        relativeSessionPath: getRelativePath(session.path, sessionBaseDir),
        firstMessage: session.firstMessage,
      }));

      res.json(result);
    } catch (error: unknown) {
      console.error(`Error listing archived sessions for ${roomKey}:`, error);
      res.status(500).json({ error: "Failed to list archived sessions" });
    }
  });

  // GET /api/archive/rooms/:roomKey/sessions/:sessionId - Get metadata for one archived session
  router.get("/:roomKey/sessions/:sessionId", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const sessionId = req.params.sessionId;

    // Validate roomKey before any file I/O
    if (!isValidRoomKey(roomKey)) {
      return res.status(400).json({ error: "Invalid room key" });
    }

    // Validate sessionId before any file I/O
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    try {
      // Find the session file directly in the room directory
      const sessionFile = await findSessionFileInRoomDir(roomKey, sessionId, sessionBaseDir);

      if (!sessionFile) {
        return res.status(404).json({ error: "Session not found" });
      }

      const metadata = await parseSessionMetadata(sessionFile, sessionBaseDir);
      metadata.isLive = false;

      const response: ArchiveSessionMetadataResponse = {
        sessionId: metadata.sessionId,
        relativeSessionPath: metadata.relativePath,
        firstMessage: metadata.firstMessage || "",
        isLive: false,
      };

      res.json(response);
    } catch (error: unknown) {
      console.error(`Error getting archived session metadata for ${roomKey}/${sessionId}:`, error);
      res.status(500).json({ error: "Failed to get session metadata" });
    }
  });

  // GET /api/archive/rooms/:roomKey/sessions/:sessionId/transcript - Get transcript
  router.get("/:roomKey/sessions/:sessionId/transcript", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const sessionId = req.params.sessionId;

    // Validate roomKey before any file I/O
    if (!isValidRoomKey(roomKey)) {
      return res.status(400).json({ error: "Invalid room key" });
    }

    // Validate sessionId before any file I/O
    if (!isValidSessionId(sessionId)) {
      return res.status(400).json({ error: "Invalid session id" });
    }

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

  try {
    // Use resolveRoomSessionDir for validation and path traversal protection
    const roomSessionDir = await resolveRoomSessionDir(sessionBaseDir, roomKey);

    const entries = await fs.readdir(roomSessionDir);

    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) {
        const fileId = extractSessionIdFromFilename(entry);
        if (fileId === sessionId || entry.startsWith(`${sessionId}_`)) {
          return `${roomSessionDir}/${entry}`;
        }
      }
    }
  } catch {
    // Directory might not exist or invalid roomKey
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
async function findArchivedSessionsInRoomDir(roomKey: string, sessionBaseDir: string): Promise<InternalSessionInfo[]> {
  const fs = await import("fs/promises");
  const results: InternalSessionInfo[] = [];

  try {
    // Use resolveRoomSessionDir for validation and path traversal protection
    const roomSessionDir = await resolveRoomSessionDir(sessionBaseDir, roomKey);

    const entries = await fs.readdir(roomSessionDir);

    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) {
        const sessionFile = `${roomSessionDir}/${entry}`;
        try {
          const metadata = await parseSessionMetadata(sessionFile, sessionBaseDir);
          results.push({
            id: metadata.sessionId,
            path: sessionFile,
            firstMessage: metadata.firstMessage || "",
          });
        } catch {
          // Skip invalid files
        }
      }
    }
  } catch {
    // Directory might not exist or invalid roomKey
  }

  return results;
}
