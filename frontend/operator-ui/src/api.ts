/**
 * API client for the control server.
 *
 * All endpoints are relative - the base URL is determined by the page.
 */

import type {
  ArchiveSession,
  ContextManifestResponse,
  LiveRoomResponse,
  SSEEvent,
  TranscriptResponse,
} from "./types.js";

const API_BASE = "/api";

/**
 * Prompt submission response
 */
export interface PromptSubmitResponse {
  accepted: boolean;
  roomKey: string;
  roomId: string;
  sessionId: string | undefined;
  turnId: string;
  timestamp: string;
}

/**
 * Get live room details.
 */
export async function getLiveRoom(roomKey: string): Promise<LiveRoomResponse> {
  const res = await fetch(`${API_BASE}/live/rooms/${roomKey}`);
  if (!res.ok) {
    throw new Error(`Failed to get live room: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Get context manifest for a live room.
 */
export async function getContextManifest(roomKey: string): Promise<ContextManifestResponse> {
  const res = await fetch(`${API_BASE}/live/rooms/${roomKey}/context`);
  if (!res.ok) {
    throw new Error(`Failed to get context manifest: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Get live transcript for a room.
 */
export async function getLiveTranscript(roomKey: string): Promise<TranscriptResponse> {
  const res = await fetch(`${API_BASE}/live/rooms/${roomKey}/transcript`);
  if (!res.ok) {
    throw new Error(`Failed to get transcript: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Submit a prompt to the live room session.
 * Non-blocking: returns quickly with accepted/started metadata.
 * Actual output comes through SSE events and transcript.
 */
export async function submitPrompt(roomKey: string, text: string): Promise<PromptSubmitResponse> {
  const res = await fetch(`${API_BASE}/live/rooms/${roomKey}/prompt`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`Failed to submit prompt: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Get archived sessions for a room.
 */
export async function getArchiveSessions(roomKey: string): Promise<ArchiveSession[]> {
  const res = await fetch(`${API_BASE}/archive/rooms/${roomKey}/sessions`);
  if (!res.ok) {
    throw new Error(`Failed to get archive sessions: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/**
 * Connect to SSE event stream for a room.
 * Returns an EventSource that can be used to listen for events.
 */
export function connectEvents(roomKey: string): EventSource {
  const es = new EventSource(`${API_BASE}/live/rooms/${roomKey}/events`);

  es.onerror = (event) => {
    console.error(`SSE error for room ${roomKey}:`, event);
  };

  return es;
}

/**
 * Parse SSE event data.
 */
export function parseSEEvent(data: string): SSEEvent | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}
