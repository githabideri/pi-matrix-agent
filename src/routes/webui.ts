import { type Request, type Response, Router } from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { buildContextManifest, manifestToResponse } from "../context-manifest.js";
import type { PiSessionBackend } from "../pi-backend.js";
import { parseSessionMetadata } from "../room-state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function routeWebUI(piBackend: PiSessionBackend, workingDirectory: string, sessionBaseDir: string) {
  console.log("[WebUI] Creating router");
  const router = Router();

  // GET /:roomKey - Main room page
  router.get("/:roomKey", async (req: Request, res: Response) => {
    console.log(`[WebUI] Room page request for: ${req.params.roomKey}`);
    const roomKey = req.params.roomKey;
    const roomState = piBackend.getSessionByKey(roomKey);

    if (!roomState) {
      return res.render("room", {
        roomKey,
        roomId: "Unknown",
        error: "Room not found",
      });
    }

    try {
      const manifest = await buildContextManifest(roomState, workingDirectory);
      const data = manifestToResponse(manifest);

      res.render("room", {
        roomKey,
        roomId: roomState.roomId,
        sessionId: data.sessionId || "--",
        model: data.model || "--",
        workingDirectory: data.workingDirectory || "--",
        isProcessing: data.isProcessing || false,
        isStreaming: data.isStreaming || false,
        relativeSessionPath: data.relativeSessionPath || "--",
        toolNames: data.toolNames || [],
        resourceLoaderType: data.resourceLoaderType || "--",
        contextSources: data.contextSources || [],
        generatedAt: data.generatedAt || new Date().toISOString(),
        error: undefined,
      });
    } catch (error) {
      console.error(`Error rendering room page for ${roomKey}:`, error);
      res.render("room", {
        roomKey,
        roomId: roomState.roomId,
        error: "Failed to load room data",
      });
    }
  });

  // GET /:roomKey/context - Context manifest page
  router.get("/:roomKey/context", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const roomState = piBackend.getSessionByKey(roomKey);

    if (!roomState) {
      return res.render("context", {
        roomKey,
        roomId: "Unknown",
        error: "Room not found",
      });
    }

    try {
      const manifest = await buildContextManifest(roomState, workingDirectory);
      const data = manifestToResponse(manifest);

      res.render("context", {
        roomKey,
        roomId: roomState.roomId,
        sessionId: data.sessionId || "--",
        relativeSessionPath: data.relativeSessionPath || "--",
        workingDirectory: data.workingDirectory || "--",
        model: data.model || "--",
        isProcessing: data.isProcessing || false,
        isStreaming: data.isStreaming || false,
        resourceLoaderType: data.resourceLoaderType || "--",
        toolNames: data.toolNames || [],
        contextSources: data.contextSources || [],
        generatedAt: data.generatedAt || new Date().toISOString(),
        manifest: data,
        error: undefined,
      });
    } catch (error) {
      console.error(`Error rendering context page for ${roomKey}:`, error);
      res.render("context", {
        roomKey,
        roomId: roomState.roomId,
        error: "Failed to load context",
      });
    }
  });

  // GET /:roomKey/archive - Archive list page
  router.get("/:roomKey/archive", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const roomId = piBackend.getRoomIdByKey(roomKey);

    if (!roomId) {
      return res.render("archive-list", {
        roomKey,
        roomId: "Unknown",
        archives: [],
        error: "Room not found",
      });
    }

    try {
      const archives = await piBackend.getArchivedSessionsForRoom(roomId);

      res.render("archive-list", {
        roomKey,
        roomId,
        archives,
        error: undefined,
      });
    } catch (error) {
      console.error(`Error rendering archive list for ${roomKey}:`, error);
      res.render("archive-list", {
        roomKey,
        roomId,
        archives: [],
        error: "Failed to load archive",
      });
    }
  });

  // GET /:roomKey/archive/:sessionId - Archive view page
  router.get("/:roomKey/archive/:sessionId", async (req: Request, res: Response) => {
    const roomKey = req.params.roomKey;
    const sessionId = req.params.sessionId;
    const roomId = piBackend.getRoomIdByKey(roomKey);

    if (!roomId) {
      return res.render("archive-view", {
        sessionId,
        roomKey,
        error: "Room not found",
      });
    }

    try {
      const archives = await piBackend.getArchivedSessionsForRoom(roomId);
      const archive = archives.find((a: any) => a.sessionId === sessionId);

      if (!archive) {
        return res.render("archive-view", {
          sessionId,
          roomKey,
          error: "Archive not found",
        });
      }

      // Find the session file for this session ID
      const sessionFile = await findSessionFileBySessionId(roomId, sessionId, sessionBaseDir);

      if (!sessionFile) {
        return res.render("archive-view", {
          sessionId,
          roomKey,
          error: "Archive file not found",
        });
      }

      // Read the session file
      let rawContent = "";
      const transcriptLines: Array<{ type: string; content: string; name?: string }> = [];

      try {
        rawContent = await fs.readFile(sessionFile, "utf-8");

        // Parse JSONL into transcript lines
        const lines = rawContent.trim().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const event = JSON.parse(line);

            if (event.type === "user_message") {
              transcriptLines.push({
                type: "user",
                content: event.content || event.text || "[no content]",
              });
            } else if (event.type === "assistant_message") {
              transcriptLines.push({
                type: "assistant",
                content: event.content || event.text || "[no content]",
              });
            } else if (event.type === "tool_result") {
              transcriptLines.push({
                type: "tool",
                name: event.name || "unknown",
                content: String(event.result || ""),
              });
            } else if (event.type === "tool_execution") {
              transcriptLines.push({
                type: "tool",
                name: event.name || "unknown",
                content: `[execution: ${JSON.stringify(event.arguments || {})}]`,
              });
            }
          } catch (_e) {
            // Skip invalid JSON lines
          }
        }
      } catch (e) {
        console.error(`Error reading session file for ${sessionId}:`, e);
      }

      // Get file stats for size
      let fileSize = 0;
      try {
        const stats = await fs.stat(sessionFile);
        fileSize = stats.size;
      } catch {}

      // Get metadata
      const _metadata = await parseSessionMetadata(sessionFile, sessionBaseDir);

      res.render("archive-view", {
        sessionId,
        roomKey,
        metadata: {
          roomId,
          sessionId,
          timestamp: "--",
          size: fileSize,
          messageCount: transcriptLines.length,
        },
        rawContent: rawContent.substring(0, 50000), // Limit to 50KB
        transcriptLines,
        error: undefined,
      });
    } catch (error) {
      console.error(`Error rendering archive view for ${sessionId}:`, error);
      res.render("archive-view", {
        sessionId,
        roomKey,
        error: "Failed to load archive",
      });
    }
  });

  return router;
}

/**
 * Find session file by session ID within a room's directory.
 */
async function findSessionFileBySessionId(
  roomId: string,
  sessionId: string,
  sessionBaseDir: string,
): Promise<string | null> {
  // Hash room ID to get room directory
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) {
    const char = roomId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const roomKey = Math.abs(hash).toString(16);
  const roomSessionDir = path.join(sessionBaseDir, `room-${roomKey}`);

  try {
    const entries = await fs.readdir(roomSessionDir);

    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) {
        const fileId = entry.split("_")[1]?.split(".")[0] || "";
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
