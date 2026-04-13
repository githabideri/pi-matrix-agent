import type { LiveRoomState } from "./room-state.js";

/**
 * Context source describes a single source of context/instructions.
 */
export interface ContextSource {
  kind: "file" | "skill" | "extension" | "prompt" | "system" | "setting";
  label: string;
  path?: string;
  description?: string;
}

/**
 * Context manifest describes all context sources and configuration for a live session.
 */
export interface ContextManifest {
  // Basic identifiers
  roomId: string;
  roomKey: string;
  sessionId: string | undefined;
  sessionFile: string | undefined;
  relativeSessionPath: string | undefined;

  // Runtime configuration
  workingDirectory: string;
  model: string | undefined;
  thinkingLevel: string | undefined;

  // Processing state
  isProcessing: boolean;
  isStreaming: boolean | undefined;
  processingStartedAt: Date | undefined;

  // Tools
  toolNames: string[];

  // Resource loader info
  resourceLoaderType: string | "unavailable";

  // Context sources
  contextSources: ContextSource[];

  // Metadata
  generatedAt: Date;
  snapshotAt?: Date; // When snapshot was last updated
}

/**
 * Build context manifest for a live room.
 */
export async function buildContextManifest(
  roomState: LiveRoomState,
  workingDirectory: string,
): Promise<ContextManifest> {
  console.log(`[CONTEXT] buildContextManifest called for ${roomState.roomKey}, isProcessing=${roomState.isProcessing}`);
  console.log(`[CONTEXT] snapshot exists: ${!!roomState.snapshot}`);

  // Use cached snapshot for non-blocking response
  // Snapshot is updated by event hooks, never touches session during request
  const snapshot = roomState.snapshot;

  const model = snapshot?.model;
  const thinkingLevel = snapshot?.thinkingLevel;
  const toolNames = snapshot?.toolNames || ["read", "bash", "edit", "write"];

  // isStreaming is derived from processing state, not session
  const isStreaming = roomState.isProcessing ? true : undefined;

  console.log(`[CONTEXT] snapshot data: model=${model}, tools=${toolNames.join(",")}`);

  // Build context sources
  const contextSources: ContextSource[] = [];

  // Add AGENTS.md if it exists
  try {
    const fs = await import("fs/promises");
    const agentsMdPath = `${workingDirectory}/AGENTS.md`;
    try {
      await fs.access(agentsMdPath);
      contextSources.push({
        kind: "file",
        label: "AGENTS.md",
        path: agentsMdPath,
        description: "Project context file",
      });
    } catch {
      // File doesn't exist
    }
  } catch {
    // FS unavailable
  }

  // Add .pi/agent files if they exist
  try {
    const fs = await import("fs/promises");
    const path = await import("path");
    const piDir = path.join(workingDirectory, ".pi");
    try {
      await fs.access(piDir);
      // Check for agents.md in .pi directory
      const piAgentsPath = path.join(piDir, "agents.md");
      try {
        await fs.access(piAgentsPath);
        contextSources.push({
          kind: "file",
          label: ".pi/agents.md",
          path: piAgentsPath,
          description: "Project-local agent configuration",
        });
      } catch {
        // Doesn't exist
      }
    } catch {
      // .pi directory doesn't exist
    }
  } catch {
    // FS/path unavailable
  }

  // Note: Skills, extensions, and prompt templates are loaded by the SDK
  // but not easily accessible from the public API. We mark them as unavailable.
  // The SDK does load them and include them in the system prompt.

  // Build relative session path
  let relativeSessionPath: string | undefined;
  if (roomState.sessionFile) {
    // Extract relative path from session file
    const parts = roomState.sessionFile.split("/");
    // Get last two parts (room-XXXX/filename)
    if (parts.length >= 2) {
      relativeSessionPath = `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
  }

  return {
    roomId: roomState.roomId,
    roomKey: roomState.roomKey,
    sessionId: roomState.sessionId,
    sessionFile: roomState.sessionFile,
    relativeSessionPath,
    workingDirectory,
    model,
    thinkingLevel,
    isProcessing: roomState.isProcessing,
    isStreaming,
    processingStartedAt: roomState.processingStartedAt,
    toolNames,
    resourceLoaderType: "DefaultResourceLoader", // SDK default
    contextSources,
    generatedAt: new Date(),
    snapshotAt: snapshot?.snapshotAt, // When snapshot was last updated
  };
}

/**
 * Simplified context manifest for API responses.
 */
export interface ContextManifestResponse {
  roomId: string;
  roomKey: string;
  sessionId: string | undefined;
  relativeSessionPath: string | undefined;
  workingDirectory: string;
  model: string | undefined;
  thinkingLevel: string | undefined;
  isProcessing: boolean;
  isStreaming: boolean | undefined;
  processingStartedAt: string | undefined;
  toolNames: string[];
  resourceLoaderType: string | "unavailable";
  contextSources: ContextSource[];
  generatedAt: string;
  snapshotAt?: string; // When snapshot was last updated
}

/**
 * Convert context manifest to API response format.
 */
export function manifestToResponse(manifest: ContextManifest): ContextManifestResponse {
  return {
    roomId: manifest.roomId,
    roomKey: manifest.roomKey,
    sessionId: manifest.sessionId,
    relativeSessionPath: manifest.relativeSessionPath,
    workingDirectory: manifest.workingDirectory,
    model: manifest.model,
    thinkingLevel: manifest.thinkingLevel,
    isProcessing: manifest.isProcessing,
    isStreaming: manifest.isStreaming,
    processingStartedAt: manifest.processingStartedAt?.toISOString(),
    toolNames: manifest.toolNames,
    resourceLoaderType: manifest.resourceLoaderType,
    contextSources: manifest.contextSources,
    generatedAt: manifest.generatedAt.toISOString(),
    snapshotAt: manifest.snapshotAt?.toISOString(),
  };
}
