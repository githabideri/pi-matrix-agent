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
  baseState: AdapterState;
  computedState: AdapterState | null;
  resolve: ((state: AdapterState) => void) | null;
  rafId: number | null;
}

/**
 * Create a batched event processor that coalesces SSE events.
 * 
 * Events are buffered and processed together at the next requestAnimationFrame,
 * reducing the number of store updates during high-frequency streaming.
 */
export function createBatchedEventProcessor(
  initialState: AdapterState,
  onStateUpdate: (state: AdapterState) => void
): {
  processEvent: (event: WebUIEvent) => void;
  flush: () => Promise<AdapterState>;
  clear: () => void;
  getState: () => AdapterState;
} {
  const buffer: BatchedStateBuffer = {
    pendingEvents: [],
    baseState: initialState,
    computedState: null,
    resolve: null,
    rafId: null,
  };

  const scheduleUpdate = () => {
    if (buffer.rafId !== null) return; // Already scheduled
    
    buffer.rafId = requestAnimationFrame(() => {
      buffer.rafId = null;
      
      if (buffer.pendingEvents.length === 0) return;
      
      // Process all pending events in sequence
      let newState = buffer.baseState;
      for (const event of buffer.pendingEvents) {
        newState = processEvent(newState, event);
      }
      
      // Update base state
      buffer.baseState = newState;
      buffer.computedState = newState;
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
          // No pending events, resolve immediately
          resolve(buffer.baseState);
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
      return buffer.computedState || buffer.baseState;
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
