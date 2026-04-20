/**
 * WebUI Event Broadcaster
 *
 * A simple pub-sub mechanism for emitting events to all connected SSE clients.
 * Used for events that need to be broadcast outside the normal session event flow,
 * such as interrupt completion or room state changes.
 */

import type { WebUIEvent } from "./webui-types.js";

/**
 * Broadcaster for a single room.
 */
class RoomBroadcaster {
  private listeners: Set<(event: WebUIEvent) => void> = new Set();

  /**
   * Add an event listener.
   */
  onEvent(listener: (event: WebUIEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners.
   */
  emit(event: WebUIEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error("[WebUIBroadcaster] Error in event listener:", err);
      }
    }
  }

  /**
   * Clear all listeners.
   */
  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Global broadcaster manager.
 */
class BroadcasterManager {
  private roomBroadcasters = new Map<string, RoomBroadcaster>();

  /**
   * Get or create a broadcaster for a room.
   */
  get(roomKey: string): RoomBroadcaster {
    if (!this.roomBroadcasters.has(roomKey)) {
      this.roomBroadcasters.set(roomKey, new RoomBroadcaster());
    }
    return this.roomBroadcasters.get(roomKey)!;
  }

  /**
   * Remove a room's broadcaster.
   */
  remove(roomKey: string): void {
    const broadcaster = this.roomBroadcasters.get(roomKey);
    if (broadcaster) {
      broadcaster.clear();
      this.roomBroadcasters.delete(roomKey);
    }
  }
}

// Singleton instance
export const broadcasterManager = new BroadcasterManager();
