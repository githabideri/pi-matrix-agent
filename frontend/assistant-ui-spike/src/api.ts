/**
 * API Client
 *
 * Functions to interact with the pi-matrix-agent control server.
 */

import type {
  LiveRoom,
  TranscriptResponse,
  PromptResponse,
  WebUIEvent,
  InterruptResponse,
} from './types';

const API_BASE = '/api';

/**
 * Fetch live room details.
 */
export async function getLiveRoom(roomKey: string): Promise<LiveRoom> {
  const response = await fetch(`${API_BASE}/live/rooms/${roomKey}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch room: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch transcript for a live room.
 */
export async function getTranscript(roomKey: string): Promise<TranscriptResponse> {
  const response = await fetch(`${API_BASE}/live/rooms/${roomKey}/transcript`);
  if (!response.ok) {
    throw new Error(`Failed to fetch transcript: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Submit a prompt to a live room.
 */
export async function submitPrompt(
  roomKey: string,
  text: string
): Promise<PromptResponse> {
  const response = await fetch(`${API_BASE}/live/rooms/${roomKey}/prompt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw new Error(`Failed to submit prompt: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Interrupt the current in-flight prompt for a live room.
 */
export async function interruptRoom(roomKey: string): Promise<InterruptResponse> {
  const response = await fetch(`${API_BASE}/live/rooms/${roomKey}/interrupt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to interrupt: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create an event source for SSE stream.
 * Returns a function to close the connection.
 */
export function createEventStream(
  roomKey: string,
  onEvent: (event: WebUIEvent) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}/live/rooms/${roomKey}/events`);

  eventSource.onmessage = (event) => {
    try {
      const webUIEvent: WebUIEvent = JSON.parse(event.data);
      onEvent(webUIEvent);
    } catch (error) {
      console.error('Failed to parse SSE event:', error);
    }
  };

  eventSource.onerror = (error) => {
    console.error('SSE connection error:', error);
  };

  // Return cleanup function
  return () => {
    eventSource.close();
  };
}
