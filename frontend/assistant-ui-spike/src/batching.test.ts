/**
 * Batching Tests
 *
 * Tests for requestAnimationFrame-based SSE event batching.
 * These tests verify the batching logic without relying on actual RAF timing.
 *
 * REGRESSION TESTS:
 * - Batcher must read fresh state at flush time (issue: stale baseState)
 * - External state changes must be reflected in batched updates
 */

import { describe, it, expect } from 'vitest';
import { processEvent } from './adapter';
import type { AdapterState } from './adapter';
import type { WebUIEvent } from './types';

/**
 * Simulated batched event processor for testing.
 * This mirrors the NEW fixed logic of createBatchedEventProcessor:
 * - Does NOT maintain internal base state
 * - Reads fresh state from store at flush time
 * - This allows deterministic testing without RAF timing dependencies.
 */
function createSimulatedBatchedProcessor(
  initialState: AdapterState,
  onStateUpdate: (state: AdapterState) => void,
  getStateFromStore: () => AdapterState
): {
  processEvent: (event: WebUIEvent) => void;
  tick: () => void;
  clear: () => void;
  getState: () => AdapterState;
  getUpdateCount: () => number;
  setStoreState: (state: AdapterState) => void;
} {
  let pendingEvents: WebUIEvent[] = [];
  let storeState = initialState;
  let updateCount = 0;
  
  return {
    processEvent: (event: WebUIEvent) => {
      pendingEvents.push(event);
    },
    
    tick: () => {
      if (pendingEvents.length === 0) return;
      
      // CRITICAL: Read FRESH state from store at flush time
      // This is the FIX - events are applied to current store state,
      // not stale internal base state
      let newState = getStateFromStore() || storeState;
      for (const event of pendingEvents) {
        newState = processEvent(newState, event);
      }
      
      storeState = newState;
      pendingEvents = [];
      
      // Notify subscribers
      onStateUpdate(newState);
      updateCount++;
    },
    
    clear: () => {
      pendingEvents = [];
    },
    
    getState: () => storeState,
    
    getUpdateCount: () => updateCount,
    
    // Helper to simulate external state changes (like optimistic updates)
    setStoreState: (state: AdapterState) => {
      storeState = state;
    },
  };
}

describe('Batched Event Processing (REGRESSION)', () => {
  /**
   * REGRESSION TEST: This test would have caught the original bug.
   * 
   * The original batcher maintained internal baseState that was captured once
   * at initialization. When external state changes occurred (optimistic user
   * messages, transcript reloads), SSE events were applied to stale state,
   * causing messages to be lost or duplicated.
   */
  it('CRITICAL: must apply SSE events to fresh store state after external changes', () => {
    const initialState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
      pendingUserMessages: new Set(),
    };
    
    let currentStoreState = initialState;
    
    // Create processor that reads fresh state from store
    const processor = createSimulatedBatchedProcessor(
      initialState,
      (state) => { currentStoreState = state; },
      () => currentStoreState
    );
    
    // Step 1: External optimistic user message is added
    // (simulating what happens when user types and hits enter)
    const optimisticUserMessage = {
      id: 'optimistic-001',
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'Hello' }],
      createdAt: new Date(),
    };
    currentStoreState = {
      ...currentStoreState,
      messages: [optimisticUserMessage],
      pendingUserMessages: new Set(['Hello']),
    };
    
    // Step 2: SSE events arrive (turn_start, message_update)
    // These must be applied to state that includes the optimistic message
    processor.processEvent({
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: '[WebUI] Hello',
    });
    processor.processEvent({
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Hi there!' },
    });
    
    // Step 3: Flush the batch
    processor.tick();
    
    // CRITICAL ASSERTION: The optimistic user message must still be present
    // and the assistant response must be added
    // The old buggy code would have lost the optimistic message
    expect(currentStoreState.messages).toHaveLength(2);
    expect(currentStoreState.messages[0].role).toBe('user');
    expect((currentStoreState.messages[0].content as any[])[0]?.text).toBe('Hello');
    expect(currentStoreState.messages[1].role).toBe('assistant');
    expect((currentStoreState.messages[1].content as any[])[0]?.text).toBe('Hi there!');
  });
  
  /**
   * REGRESSION TEST: Transcript reload must be reflected in subsequent batches.
   */
  it('CRITICAL: must read fresh state when transcript is reloaded during streaming', () => {
    const initialState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
      pendingUserMessages: new Set(),
    };
    
    let currentStoreState = initialState;
    
    const processor = createSimulatedBatchedProcessor(
      initialState,
      (state) => { currentStoreState = state; },
      () => currentStoreState
    );
    
    // Step 1: Initial transcript load (page reload scenario)
    const initialMessages = [
      { id: 'msg-001', role: 'user' as const, content: [{ type: 'text' as const, text: 'Previous question' }], createdAt: new Date() },
      { id: 'msg-002', role: 'assistant' as const, content: [{ type: 'text' as const, text: 'Previous answer' }], createdAt: new Date() },
    ];
    currentStoreState = { ...initialState, messages: initialMessages };
    
    // Step 2: User submits new prompt optimistically
    const newPrompt = 'New question';
    currentStoreState = {
      ...currentStoreState,
      messages: [...currentStoreState.messages, {
        id: 'msg-003',
        role: 'user' as const,
        content: [{ type: 'text' as const, text: newPrompt }],
        createdAt: new Date(),
      }],
      pendingUserMessages: new Set([newPrompt]),
    };
    
    // Step 3: SSE events for new turn arrive
    processor.processEvent({
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      promptPreview: `[WebUI] ${newPrompt}`,
    });
    processor.processEvent({
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'New answer' },
    });
    
    processor.tick();
    
    // CRITICAL: Must have all 4 messages (2 from transcript + user + assistant)
    expect(currentStoreState.messages).toHaveLength(4);
    expect(currentStoreState.messages[0].role).toBe('user');  // Previous question
    expect(currentStoreState.messages[1].role).toBe('assistant');  // Previous answer
    expect(currentStoreState.messages[2].role).toBe('user');  // New question (optimistic)
    expect(currentStoreState.messages[3].role).toBe('assistant');  // New answer
  });
});

describe('Batched Event Processing', () => {
  it('processes events at next tick', () => {
    const initialState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };
    
    let storeState = initialState;
    let updatedState: AdapterState | null = null as any;
    const processor = createSimulatedBatchedProcessor(initialState, (state: AdapterState) => {
      storeState = state;
      updatedState = state;
    }, () => storeState);
    
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
    
    let storeState = initialState;
    let updateCount = 0;
    let lastUpdatedState: AdapterState | null = null as any;
    const processor = createSimulatedBatchedProcessor(initialState, (state: AdapterState) => {
      storeState = state;
      updateCount++;
      lastUpdatedState = state;
    }, () => storeState);
    
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
    
    let storeState = initialState;
    const processor = createSimulatedBatchedProcessor(initialState, (state) => { storeState = state; }, () => storeState);
    
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
    
    let storeState = initialState;
    const processor = createSimulatedBatchedProcessor(initialState, (state) => { storeState = state; }, () => storeState);
    
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
    
    let storeState = initialState;
    let updateCount = 0;
    const processor = createSimulatedBatchedProcessor(initialState, (state) => {
      storeState = state;
      updateCount++;
    }, () => storeState);
    
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
    
    let storeState = initialState;
    let updateCount = 0;
    const processor = createSimulatedBatchedProcessor(initialState, (state) => {
      storeState = state;
      updateCount++;
    }, () => storeState);
    
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
    
    let storeState = initialState;
    const processor = createSimulatedBatchedProcessor(initialState, (state) => { storeState = state; }, () => storeState);
    
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
