/**
 * Stream Update Batching
 *
 * Provides requestAnimationFrame-based batching for SSE event processing.
 * Reduces render thrashing during high-frequency streaming updates.
 */

import type { WebUIEvent } from './types';
import type { AdapterState } from './adapter';
import { processEvent } from './adapter';

/**
 * Buffered state for batched updates.
 */
interface BatchedStateBuffer {
  pendingEvents: WebUIEvent[];
  resolve: ((state: AdapterState) => void) | null;
  rafId: number | null;
}

/**
 * Create a batched event processor that coalesces SSE events.
 * 
 * Events are buffered and processed together at the next requestAnimationFrame,
 * reducing the number of store updates during high-frequency streaming.
 * 
 * Key design: Does NOT maintain internal base state. At flush time, reads
 * current store state to ensure events are applied to fresh state that
 * includes any external updates (optimistic messages, transcript reloads, etc.)
 */
export function createBatchedEventProcessor(
  _initialState: AdapterState,
  onStateUpdate: (state: AdapterState) => void,
  getStateFromStore: () => AdapterState
): {
  processEvent: (event: WebUIEvent) => void;
  flush: () => Promise<AdapterState>;
  clear: () => void;
  getState: () => AdapterState;
} {
  const buffer: BatchedStateBuffer = {
    pendingEvents: [],
    resolve: null,
    rafId: null,
  };

  const scheduleUpdate = () => {
    if (buffer.rafId !== null) return; // Already scheduled
    
    buffer.rafId = requestAnimationFrame(() => {
      buffer.rafId = null;
      
      if (buffer.pendingEvents.length === 0) return;
      
      // CRITICAL: Read FRESH state from store at flush time
      // This ensures events are applied to current state including any
      // external updates (optimistic messages, transcript reloads, etc.)
      let newState = getStateFromStore();
      for (const event of buffer.pendingEvents) {
        newState = processEvent(newState, event);
      }
      
      buffer.pendingEvents = [];
      
      // Notify subscribers
      onStateUpdate(newState);
      
      // Resolve any pending flush
      if (buffer.resolve) {
        const resolver = buffer.resolve;
        buffer.resolve = null;
        resolver(newState);
      }
    });
  };

  return {
    processEvent: (event: WebUIEvent) => {
      buffer.pendingEvents.push(event);
      scheduleUpdate();
    },
    
    flush: (): Promise<AdapterState> => {
      return new Promise<AdapterState>((resolve) => {
        buffer.resolve = resolve;
        if (buffer.pendingEvents.length === 0) {
          // No pending events, resolve with current store state
          resolve(getStateFromStore());
        }
        // Otherwise, will resolve in scheduleUpdate
      });
    },
    
    clear: () => {
      buffer.pendingEvents = [];
      if (buffer.rafId !== null) {
        cancelAnimationFrame(buffer.rafId);
        buffer.rafId = null;
      }
    },
    
    getState: (): AdapterState => {
      // Delegate to store - we don't maintain internal state
      return getStateFromStore();
    },
  };
}

/**
 * Simple debounce utility for throttling updates.
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      func(...args);
    }, wait);
  };
}
