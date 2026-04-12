import { Router, Request, Response } from "express";
import { PiSessionBackend } from "../pi-backend.js";
import { parseSessionMetadata, extractSessionIdFromFilename } from "../room-state.js";
import { RoomStateManager } from "../room-state.js";

export function routeArchive(piBackend: PiSessionBackend, sessionBaseDir: string) {
  const router = Router();

  // GET /api/archive/rooms/:roomKey/sessions - List archived sessions for a room
  router.get("/:roomKey/sessions", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const roomId = piBackend.getRoomIdByKey(roomKey);

    if (!roomId) {
      return res.status(404).json({ error: "Room not found" });
    }

    try {
      // Get archived sessions
      const archived = await piBackend.getArchivedSessionsForRoom(roomId);

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
    const roomId = piBackend.getRoomIdByKey(roomKey);

    if (!roomId) {
      return res.status(404).json({ error: "Room not found" });
    }

    try {
      // Find the session file for this session ID
      const sessionFile = await findSessionFileBySessionId(roomId, sessionId, sessionBaseDir);

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
    const roomId = piBackend.getRoomIdByKey(roomKey);

    if (!roomId) {
      return res.status(404).json({ error: "Room not found" });
    }

    try {
      const sessionFile = await findSessionFileBySessionId(roomId, sessionId, sessionBaseDir);

      if (!sessionFile) {
        return res.status(404).json({ error: "Session not found" });
      }

      const fs = await import("fs/promises");
      const content = await fs.readFile(sessionFile, "utf-8");
      const lines = content.trim().split("\n");

      const messages: Array<{ role: string; content: string; timestamp?: string }> = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          
          // Session header
          if (entry.type === "session") {
            continue;
          }

          // Model/thinking level changes
          if (entry.type === "model_change" || entry.type === "thinking_level_change") {
            continue;
          }

          // Messages
          if (entry.type === "message" && entry.message) {
            const msg = entry.message;
            const content = extractMessageContent(msg.content);
            messages.push({
              role: msg.role,
              content,
              timestamp: entry.timestamp,
            });
          }
        } catch {
          // Skip invalid lines
        }
      }

      res.json({
        sessionId,
        messageCount: messages.length,
        messages,
      });
    } catch (error) {
      console.error(`Error getting transcript for ${roomKey}/${sessionId}:`, error);
      res.status(500).json({ error: "Failed to get transcript" });
    }
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
 * Find session file by session ID within a room's directory.
 */
async function findSessionFileBySessionId(
  roomId: string,
  sessionId: string,
  sessionBaseDir: string
): Promise<string | null> {
  const fs = await import("fs/promises");
  const path = await import("path");

  // Hash room ID to get room directory
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) {
    const char = roomId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const roomKey = Math.abs(hash).toString(16);
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
 * Extract content text from message content array.
 */
function extractMessageContent(content: any): string {
  if (!content) return "";
  
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item: any) => {
      if (item.type === "text") return item.text || "";
      if (item.type === "thinking") return `[thinking: ${item.thinking || "..."}]`;
      if (item.type === "toolCall") return `[tool_call: ${item.name}]`;
      if (item.type === "toolResult") return `[tool_result: ${item.name}]`;
      return String(item);
    }).join("\n");
  }

  return String(content);
}
