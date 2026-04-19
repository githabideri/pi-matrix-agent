/**
 * Batching Tests
 *
 * Tests for requestAnimationFrame-based SSE event batching.
 * These tests verify the batching logic without relying on actual RAF timing.
 */

import { describe, it, expect } from 'vitest';
import { processEvent } from './adapter';
import type { AdapterState } from './adapter';
import type { WebUIEvent } from './types';

/**
 * Simulated batched event processor for testing.
 * This mirrors the logic of createBatchedEventProcessor but allows
 * deterministic testing without RAF timing dependencies.
 */
function createSimulatedBatchedProcessor(
  initialState: AdapterState,
  onStateUpdate: (state: AdapterState) => void
): {
  processEvent: (event: WebUIEvent) => void;
  tick: () => void;
  clear: () => void;
  getState: () => AdapterState;
  getUpdateCount: () => number;
} {
  let pendingEvents: WebUIEvent[] = [];
  let baseState = initialState;
  let updateCount = 0;
  
  return {
    processEvent: (event: WebUIEvent) => {
      pendingEvents.push(event);
    },
    
    tick: () => {
      if (pendingEvents.length === 0) return;
      
      // Process all pending events in sequence
      let newState = baseState;
      for (const event of pendingEvents) {
        newState = processEvent(newState, event);
      }
      
      // Update base state
      baseState = newState;
      pendingEvents = [];
      
      // Notify subscribers
      onStateUpdate(newState);
      updateCount++;
    },
    
    clear: () => {
      pendingEvents = [];
    },
    
    getState: () => baseState,
    
    getUpdateCount: () => updateCount,
  };
}

describe('Batched Event Processing', () => {
  it('processes events at next tick', () => {
    const initialState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };
    
    let updatedState: AdapterState | null = null as any;
    const processor = createSimulatedBatchedProcessor(initialState, (state: AdapterState) => {
      updatedState = state;
    });
    
    // Add an event
    const event: WebUIEvent = {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Test message',
    };
    
    processor.processEvent(event);
    
    // State should not be updated yet (waiting for tick)
    expect(updatedState).toBeNull();
    
    // Tick
    processor.tick();
    
    // State should now be updated
    expect(updatedState).not.toBeNull();
    expect(updatedState?.messages).toHaveLength(1);
    expect(updatedState?.messages[0].role).toBe('user');
  });
  
  it('batches multiple events into single state update', () => {
    const initialState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };
    
    let updateCount = 0;
    let lastUpdatedState: AdapterState | null = null as any;
    const processor = createSimulatedBatchedProcessor(initialState, (state: AdapterState) => {
      updateCount++;
      lastUpdatedState = state;
    });
    
    // Add multiple events
    const events: WebUIEvent[] = [
      {
        type: 'turn_start',
        timestamp: '2024-01-01T00:00:00.000Z',
        roomId: '!room:example.com',
        roomKey: 'test-room',
        turnId: 'turn-001',
        sessionId: 'session-001',
        promptPreview: 'Test message',
      },
      {
        type: 'message_update',
        timestamp: '2024-01-01T00:00:01.000Z',
        roomId: '!room:example.com',
        roomKey: 'test-room',
        turnId: 'turn-001',
        sessionId: 'session-001',
        role: 'assistant',
        content: { type: 'text_delta', delta: 'Hello' },
      },
      {
        type: 'message_update',
        timestamp: '2024-01-01T00:00:02.000Z',
        roomId: '!room:example.com',
        roomKey: 'test-room',
        turnId: 'turn-001',
        sessionId: 'session-001',
        role: 'assistant',
        content: { type: 'text_delta', delta: ' world' },
      },
    ];
    
    events.forEach(event => processor.processEvent(event));
    
    // No updates yet
    expect(updateCount).toBe(0);
    
    // Tick
    processor.tick();
    
    // Should have exactly ONE update with all events processed
    expect(updateCount).toBe(1);
    expect(lastUpdatedState?.messages).toHaveLength(2); // User + Assistant
    expect((lastUpdatedState?.messages[1].content as any[])[0]?.text).toBe('Hello world');
  });
  
  it('processes events in order', () => {
    const initialState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };
    
    const processor = createSimulatedBatchedProcessor(initialState, () => {});
    
    // Add events that must be processed in order
    processor.processEvent({
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Test',
    });
    
    processor.processEvent({
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'A' },
    });
    
    processor.processEvent({
      type: 'message_update',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'B' },
    });
    
    processor.tick();
    
    // Verify events processed in order
    expect(processor.getState().messages[1].role).toBe('assistant');
    expect((processor.getState().messages[1].content as any[])[0]?.text).toBe('AB');
  });
  
  it('getState returns current processed state', () => {
    const initialState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };
    
    const processor = createSimulatedBatchedProcessor(initialState, () => {});
    
    // Initially returns base state
    expect(processor.getState().messages).toHaveLength(0);
    
    // Add event
    processor.processEvent({
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Test',
    });
    
    processor.tick();
    
    // After tick, returns updated state
    expect(processor.getState().messages).toHaveLength(1);
  });
  
  it('clear removes pending events', () => {
    const initialState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };
    
    let updateCount = 0;
    const processor = createSimulatedBatchedProcessor(initialState, () => {
      updateCount++;
    });
    
    // Add event
    processor.processEvent({
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Test',
    });
    
    // Clear before tick
    processor.clear();
    
    // Tick - should not trigger update
    processor.tick();
    
    expect(updateCount).toBe(0);
    expect(processor.getState().messages).toHaveLength(0);
  });
  
  it('multiple ticks process batches separately', () => {
    const initialState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };
    
    let updateCount = 0;
    const processor = createSimulatedBatchedProcessor(initialState, () => {
      updateCount++;
    });
    
    // First batch
    processor.processEvent({
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Test 1',
    });
    
    processor.tick();
    expect(updateCount).toBe(1);
    
    // Second batch
    processor.processEvent({
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      promptPreview: 'Test 2',
    });
    
    processor.tick();
    expect(updateCount).toBe(2);
    
    // Should have 2 user messages
    expect(processor.getState().messages).toHaveLength(2);
  });
  
  it('preserves turn-boundary behavior through batching', () => {
    const initialState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };
    
    const processor = createSimulatedBatchedProcessor(initialState, () => {});
    
    // Turn 1 events
    processor.processEvent({
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Question 1',
    });
    processor.processEvent({
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Answer 1' },
    });
    
    // Turn 2 events
    processor.processEvent({
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      promptPreview: 'Question 2',
    });
    processor.processEvent({
      type: 'message_update',
      timestamp: '2024-01-01T00:00:03.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Answer 2' },
    });
    
    // Process all in one batch
    processor.tick();
    
    // Should have 4 messages: user1, assistant1, user2, assistant2
    expect(processor.getState().messages).toHaveLength(4);
    
    // Verify turn boundaries preserved
    expect((processor.getState().messages[1].content as any[])[0]?.text).toBe('Answer 1');
    expect((processor.getState().messages[3].content as any[])[0]?.text).toBe('Answer 2');
  });
});
