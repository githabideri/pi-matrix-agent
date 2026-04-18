/**
 * Adapter Tests
 *
 * Tests for the transcript-to-message conversion and SSE event processing.
 */

import { describe, it, expect } from 'vitest';
import {
  transcriptItemToMessage,
  transcriptToMessages,
  processEvent,
  appendTextToMessage,
  createStreamingMessage,
  extractTextFromMessage,
} from './adapter';
import type {
  TranscriptItem,
  UserMessageItem,
  AssistantMessageItem,
  ToolStartItem,
  ToolEndItem,
  ThinkingItem,
  WebUIEvent,
} from './types';
import type { AdapterState, InternalMessage } from './adapter';

describe('transcriptItemToMessage', () => {
  it('converts user_message to user message', () => {
    const item: UserMessageItem = {
      kind: 'user_message',
      id: 'msg-001',
      timestamp: '2024-01-01T00:00:00.000Z',
      text: 'Hello, world!',
    };

    const message = transcriptItemToMessage(item);

    expect(message.role).toBe('user');
    expect(message.content).toEqual([
      { type: 'text', text: 'Hello, world!' },
    ]);
    expect(message.createdAt).toEqual(new Date('2024-01-01T00:00:00.000Z'));
  });

  it('converts assistant_message to assistant message', () => {
    const item: AssistantMessageItem = {
      kind: 'assistant_message',
      id: 'msg-002',
      timestamp: '2024-01-01T00:00:00.000Z',
      text: 'Hi there!',
    };

    const message = transcriptItemToMessage(item);

    expect(message.role).toBe('assistant');
    expect(message.content).toEqual([
      { type: 'text', text: 'Hi there!' },
    ]);
  });

  it('converts assistant_message with thinking', () => {
    const item: AssistantMessageItem = {
      kind: 'assistant_message',
      id: 'msg-003',
      timestamp: '2024-01-01T00:00:00.000Z',
      text: 'The answer is 42.',
      thinking: 'Let me think about this...',
    };

    const message = transcriptItemToMessage(item);

    expect(message.role).toBe('assistant');
    expect(message.content).toHaveLength(1);
    expect(message.content[0]).toEqual({ type: 'text', text: 'The answer is 42.' });
    expect(message.thinking).toBe('Let me think about this...');
  });

  it('converts tool_start to tool message', () => {
    const item: ToolStartItem = {
      kind: 'tool_start',
      id: 'tool-001',
      timestamp: '2024-01-01T00:00:00.000Z',
      toolName: 'bash',
      toolCallId: 'call-001',
    };

    const message = transcriptItemToMessage(item);

    expect(message.role).toBe('tool');
    expect(message.name).toBe('bash');
    expect(message.content).toContain('Tool Call');
    expect(message.content).toContain('bash');
  });

  it('converts tool_end to tool result message', () => {
    const item: ToolEndItem = {
      kind: 'tool_end',
      id: 'tool-002',
      timestamp: '2024-01-01T00:00:00.000Z',
      toolName: 'read',
      toolCallId: 'call-002',
      success: true,
      result: 'File contents here',
    };

    const message = transcriptItemToMessage(item);

    expect(message.role).toBe('tool');
    expect(message.name).toBe('read');
    expect(message.content).toContain('Result');
    expect(message.content).toContain('read');
  });

  it('converts thinking item', () => {
    const item: ThinkingItem = {
      kind: 'thinking',
      id: 'think-001',
      timestamp: '2024-01-01T00:00:00.000Z',
      text: 'This is my reasoning process',
    };

    const message = transcriptItemToMessage(item);

    expect(message.role).toBe('assistant');
    expect(message.content).toEqual([]);
    expect(message.thinking).toBe('This is my reasoning process');
  });
});

describe('transcriptToMessages', () => {
  it('converts multiple items', () => {
    const items: TranscriptItem[] = [
      {
        kind: 'user_message',
        id: 'msg-001',
        timestamp: '2024-01-01T00:00:00.000Z',
        text: 'Hello',
      },
      {
        kind: 'assistant_message',
        id: 'msg-002',
        timestamp: '2024-01-01T00:00:01.000Z',
        text: 'Hi!',
      },
    ];

    const messages = transcriptToMessages(items);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].role).toBe('assistant');
  });
});

describe('processEvent', () => {
  const baseState: AdapterState = {
    roomKey: 'test-room',
    sessionId: 'session-001',
    messages: [],
    isProcessing: false,
    activeToolCalls: new Map(),
  };

  it('handles session_connected event', () => {
    const event: WebUIEvent = {
      type: 'session_connected',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      sessionId: 'new-session-id',
    };

    const newState = processEvent(baseState, event);

    expect(newState.sessionId).toBe('new-session-id');
  });

  it('handles turn_start event with prompt preview', () => {
    const event: WebUIEvent = {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Hello, how are you?',
    };

    const newState = processEvent(baseState, event);

    expect(newState.isProcessing).toBe(true);
    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0].role).toBe('user');
    expect((newState.messages[0].content[0] as any).text).toBe('Hello, how are you?');
  });

  it('handles message_update event (text_delta)', () => {
    const event: WebUIEvent = {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Hello' },
    };

    const newState = processEvent(baseState, event);

    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0].role).toBe('assistant');
    expect((newState.messages[0].content[0] as any).text).toBe('Hello');
  });

  it('handles tool_start event', () => {
    const event: WebUIEvent = {
      type: 'tool_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      toolCallId: 'call-001',
      toolName: 'bash',
      arguments: '{"command": "ls"}',
    };

    const newState = processEvent(baseState, event);

    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0].role).toBe('tool');
    expect(newState.messages[0].name).toBe('bash');
    expect(newState.activeToolCalls.has('call-001')).toBe(true);
  });

  it('handles tool_end event', () => {
    const stateWithTool: AdapterState = {
      ...baseState,
      activeToolCalls: new Map([['call-001', { toolName: 'bash' }]]),
    };

    const event: WebUIEvent = {
      type: 'tool_end',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      toolCallId: 'call-001',
      toolName: 'bash',
      success: true,
      result: 'file1.txt\nfile2.txt',
    };

    const newState = processEvent(stateWithTool, event);

    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0].role).toBe('tool');
    expect(newState.activeToolCalls.has('call-001')).toBe(false);
  });

  it('handles turn_end event', () => {
    const processingState: AdapterState = {
      ...baseState,
      isProcessing: true,
    };

    const event: WebUIEvent = {
      type: 'turn_end',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      success: true,
    };

    const newState = processEvent(processingState, event);

    expect(newState.isProcessing).toBe(false);
  });

  it('handles state_change processing_start', () => {
    const event: WebUIEvent = {
      type: 'state_change',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      sessionId: 'session-001',
      changeType: 'processing_start',
    };

    const newState = processEvent(baseState, event);

    expect(newState.isProcessing).toBe(true);
  });

  it('handles state_change processing_end', () => {
    const processingState: AdapterState = {
      ...baseState,
      isProcessing: true,
    };

    const event: WebUIEvent = {
      type: 'state_change',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      sessionId: 'session-001',
      changeType: 'processing_end',
    };

    const newState = processEvent(processingState, event);

    expect(newState.isProcessing).toBe(false);
  });

  it('handles error event', () => {
    const event: WebUIEvent = {
      type: 'error',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      message: 'Something went wrong',
      code: 'E_TIMEOUT',
    };

    const newState = processEvent(baseState, event);

    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0].role).toBe('assistant');
    expect((newState.messages[0].content[0] as any).text).toContain('Error:');
    expect(newState.isProcessing).toBe(false);
  });
});

describe('appendTextToMessage', () => {
  it('appends text to existing message', () => {
    const message: InternalMessage = {
      id: 'msg-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: new Date(),
    };

    const updated = appendTextToMessage(message, ' world');

    expect((updated.content[0] as any).text).toBe('Hello world');
  });
});

describe('createStreamingMessage', () => {
  it('creates a new assistant message', () => {
    const message = createStreamingMessage('assistant', 'Hello');

    expect(message.role).toBe('assistant');
    expect((message.content[0] as any).text).toBe('Hello');
    expect(message.id).toBeDefined();
  });
});

describe('extractTextFromMessage', () => {
  it('extracts text from string content', () => {
    const message = {
      content: 'Hello world',
    };

    expect(extractTextFromMessage(message as any)).toBe('Hello world');
  });

  it('extracts text from array content', () => {
    const message = {
      content: [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' world' },
      ],
    };

    expect(extractTextFromMessage(message as any)).toBe('Hello world');
  });
});

describe('Streaming - No Duplicate Messages', () => {
  it('accumulates text_delta to existing assistant message without creating duplicates', () => {
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [
        {
          id: 'assistant-001',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          createdAt: new Date(),
        },
      ],
      isProcessing: true,
      activeToolCalls: new Map(),
    };

    // Apply multiple text_delta events
    const event1: WebUIEvent = {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: ' world' },
    };

    const state1 = processEvent(state, event1);
    expect(state1.messages).toHaveLength(1); // Still only one message
    expect((state1.messages[0].content[0] as any).text).toBe('Hello world');

    const event2: WebUIEvent = {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: '!' },
    };

    const state2 = processEvent(state1, event2);
    expect(state2.messages).toHaveLength(1); // Still only one message
    expect((state2.messages[0].content[0] as any).text).toBe('Hello world!');
  });

  it('accumulates thinking_delta to existing assistant message without creating duplicates', () => {
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [
        {
          id: 'assistant-001',
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          thinking: 'Step 1',
          createdAt: new Date(),
        },
      ],
      isProcessing: true,
      activeToolCalls: new Map(),
    };

    const event: WebUIEvent = {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'thinking_delta', delta: '\nStep 2' },
    };

    const newState = processEvent(state, event);
    expect(newState.messages).toHaveLength(1); // Still only one message
    expect(newState.messages[0].thinking).toBe('Step 1\nStep 2');
  });
});

describe('Tool Data Preservation', () => {
  it('tool_start event preserves arguments in InternalMessage', () => {
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    const event: WebUIEvent = {
      type: 'tool_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      toolCallId: 'call-001',
      toolName: 'bash',
      arguments: '{"command": "grep -r \\"hello\\" .""}',
    };

    const newState = processEvent(state, event);
    expect(newState.messages).toHaveLength(1);
    const toolMessage = newState.messages[0] as InternalMessage;
    expect(toolMessage.toolCallId).toBe('call-001');
    expect(toolMessage.toolArguments).toBe('{"command": "grep -r \\"hello\\" .""}');
    expect(toolMessage.toolResult).toBeUndefined();
  });

  it('tool_end event preserves result and success in InternalMessage', () => {
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map([['call-001', { toolName: 'bash' }]]),
    };

    const event: WebUIEvent = {
      type: 'tool_end',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      toolCallId: 'call-001',
      toolName: 'bash',
      success: true,
      result: 'Found 5 matches in 3 files',
    };

    const newState = processEvent(state, event);
    expect(newState.messages).toHaveLength(1);
    const toolMessage = newState.messages[0] as InternalMessage;
    expect(toolMessage.toolCallId).toBe('call-001');
    expect(toolMessage.toolResult).toBe('Found 5 matches in 3 files');
    expect(toolMessage.toolSuccess).toBe(true);
  });

  it('transcript tool_start item preserves arguments', () => {
    const item: ToolStartItem = {
      kind: 'tool_start',
      id: 'tool-001',
      timestamp: '2024-01-01T00:00:00.000Z',
      toolName: 'read',
      toolCallId: 'call-001',
      arguments: '{"path": "README.md"}',
    };

    const message = transcriptItemToMessage(item);
    expect(message.toolCallId).toBe('call-001');
    expect(message.toolArguments).toBe('{"path": "README.md"}');
  });

  it('transcript tool_end item preserves result and success', () => {
    const item: ToolEndItem = {
      kind: 'tool_end',
      id: 'tool-002',
      timestamp: '2024-01-01T00:00:00.000Z',
      toolName: 'read',
      toolCallId: 'call-002',
      success: false,
      result: 'File not found: README.md',
    };

    const message = transcriptItemToMessage(item);
    expect(message.toolCallId).toBe('call-002');
    expect(message.toolResult).toBe('File not found: README.md');
    expect(message.toolSuccess).toBe(false);
  });
});

describe('Reasoning Preview', () => {
  it('preserves thinking content for preview display', () => {
    const longThinking = [
      'Step 1: Analyze the problem',
      'Step 2: Consider the options',
      'Step 3: Evaluate each option',
      'Step 4: Make a decision',
      'Step 5: Verify the solution',
    ].join('\n');

    const item: AssistantMessageItem = {
      kind: 'assistant_message',
      id: 'msg-003',
      timestamp: '2024-01-01T00:00:00.000Z',
      text: 'The answer is 42.',
      thinking: longThinking,
    };

    const message = transcriptItemToMessage(item);

    // Verify thinking is preserved
    expect(message.thinking).toBe(longThinking);

    // Verify first 3 lines would be visible as preview
    const lines = longThinking.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines.slice(0, 3)).toEqual([
      'Step 1: Analyze the problem',
      'Step 2: Consider the options',
      'Step 3: Evaluate each option',
    ]);
  });

  it('thinking_delta accumulates correctly for streaming preview', () => {
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: true,
      activeToolCalls: new Map(),
    };

    // First thinking delta
    const event1: WebUIEvent = {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'thinking_delta', delta: 'Step 1: Analyze' },
    };

    const state1 = processEvent(state, event1);
    expect(state1.messages).toHaveLength(1);
    expect(state1.messages[0].thinking).toBe('Step 1: Analyze');

    // Second thinking delta
    const event2: WebUIEvent = {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'thinking_delta', delta: '\nStep 2: Consider' },
    };

    const state2 = processEvent(state1, event2);
    expect(state2.messages).toHaveLength(1); // Still only one message
    expect(state2.messages[0].thinking).toBe('Step 1: Analyze\nStep 2: Consider');
  });
});

describe('User Message Event (Matrix-originated)', () => {
  it('adds user message from user_message event', () => {
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    const event: WebUIEvent = {
      type: 'user_message',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Hello from Matrix!',
    };

    const newState = processEvent(state, event);

    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0].role).toBe('user');
    expect((newState.messages[0].content[0] as any).text).toBe('Hello from Matrix!');
  });

  it('does not duplicate user message if already in messages list', () => {
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [
        {
          id: 'msg-001',
          role: 'user',
          content: [{ type: 'text', text: 'Hello from Matrix!' }],
          createdAt: new Date(),
        },
      ],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    const event: WebUIEvent = {
      type: 'user_message',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Hello from Matrix!',
    };

    const newState = processEvent(state, event);

    expect(newState.messages).toHaveLength(1); // No duplicate
    expect((newState.messages[0].content[0] as any).text).toBe('Hello from Matrix!');
  });

  it('strips [WebUI] prefix for pendingUserMessages comparison', () => {
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
      pendingUserMessages: new Set(['Test message']),
    };

    const event: WebUIEvent = {
      type: 'user_message',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: '[WebUI] Test message',
    };

    const newState = processEvent(state, event);

    expect(newState.messages).toHaveLength(0); // No duplicate
  });
});

describe('Pending Message Cleanup', () => {
  it('clears pending message from set when turn_start arrives after optimistic update', () => {
    // Initial state with optimistic user message (trimmed text, no [WebUI] prefix)
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [
        {
          id: 'optimistic-001',
          role: 'user',
          content: [{ type: 'text', text: 'Hello, world!' }],
          createdAt: new Date(),
        },
      ],
      isProcessing: false,
      activeToolCalls: new Map(),
      pendingUserMessages: new Set(['Hello, world!', 'Another pending message']),
    };

    // turn_start event arrives with [WebUI] prefixed promptPreview
    const event: WebUIEvent = {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: '[WebUI] Hello, world!',
    };

    const newState = processEvent(state, event);

    // Pending message should be cleared after reconciliation
    expect(newState.pendingUserMessages?.has('Hello, world!')).toBe(false);
    // Other pending messages should still be there
    expect(newState.pendingUserMessages?.has('Another pending message')).toBe(true);
  });

  it('clears pending message from set when user_message arrives after optimistic update', () => {
    // Initial state with optimistic user message (trimmed text, no [WebUI] prefix)
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [
        {
          id: 'optimistic-001',
          role: 'user',
          content: [{ type: 'text', text: 'Hello from Matrix!' }],
          createdAt: new Date(),
        },
      ],
      isProcessing: false,
      activeToolCalls: new Map(),
      pendingUserMessages: new Set(['Hello from Matrix!']),
    };

    // user_message event arrives (Matrix-originated, no [WebUI] prefix)
    const event: WebUIEvent = {
      type: 'user_message',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Hello from Matrix!',
    };

    const newState = processEvent(state, event);

    // Pending message should be cleared after reconciliation
    expect(newState.pendingUserMessages?.has('Hello from Matrix!')).toBe(false);
  });
});

describe('Repeated Identical Prompts', () => {
  it('allows repeated identical prompts in separate turns', () => {
    // First turn: optimistic update + turn_start
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [
        // Optimistic user message for first turn
        {
          id: 'optimistic-001',
          role: 'user',
          content: [{ type: 'text', text: 'Hello' }],
          createdAt: new Date(),
        },
      ],
      isProcessing: false,
      activeToolCalls: new Map(),
      pendingUserMessages: new Set(['Hello']),
    };

    // First turn_start arrives
    const event1: WebUIEvent = {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: '[WebUI] Hello',
    };

    state = processEvent(state, event1);
    
    // First turn_end clears isProcessing
    const endEvent1: WebUIEvent = {
      type: 'turn_end',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      success: true,
    };
    state = processEvent(state, endEvent1);

    // Second turn: same prompt, different turn
    // Optimistic update adds the message again
    state.messages.push({
      id: 'optimistic-002',
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: new Date(),
    });
    state.pendingUserMessages = new Set(['Hello']);

    // Second turn_start arrives with same prompt
    const event2: WebUIEvent = {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      promptPreview: '[WebUI] Hello',
    };

    state = processEvent(state, event2);

    // Should have two user messages (one from each turn)
    expect(state.messages.filter(m => m.role === 'user')).toHaveLength(2);
    // Pending message should be cleared after reconciliation
    expect(state.pendingUserMessages?.has('Hello')).toBe(false);
  });
});

describe('Optimistic User Message Deduplication', () => {
  it('does not duplicate user message when turn_start arrives after optimistic update', () => {
    // Initial state with optimistic user message (trimmed text, no [WebUI] prefix)
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [
        {
          id: 'optimistic-001',
          role: 'user',
          content: [{ type: 'text', text: 'Hello, world!' }],
          createdAt: new Date(),
        },
      ],
      isProcessing: false,
      activeToolCalls: new Map(),
      pendingUserMessages: new Set(['Hello, world!']),
    };

    // turn_start event arrives with [WebUI] prefixed promptPreview
    const event: WebUIEvent = {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: '[WebUI] Hello, world!',
    };

    const newState = processEvent(state, event);

    // Should still have only one user message (no duplicate)
    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0].role).toBe('user');
    expect((newState.messages[0].content[0] as any).text).toBe('Hello, world!');
    expect(newState.isProcessing).toBe(true);
    // Pending message should be cleared after reconciliation
    expect(newState.pendingUserMessages?.has('Hello, world!')).toBe(false);
  });

  it('adds user message when turn_start arrives without prior optimistic update', () => {
    // Initial state without optimistic message (Matrix-originated message)
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // turn_start event arrives
    const event: WebUIEvent = {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Hello from Matrix!',
    };

    const newState = processEvent(state, event);

    // Should add the user message
    expect(newState.messages).toHaveLength(1);
    expect(newState.messages[0].role).toBe('user');
    expect((newState.messages[0].content[0] as any).text).toBe('Hello from Matrix!');
    expect(newState.isProcessing).toBe(true);
  });

  it('strips [WebUI] prefix for pendingUserMessages comparison', () => {
    // Initial state with pending message (trimmed text)
    const state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
      pendingUserMessages: new Set(['Test message']),
    };

    // turn_start event with [WebUI] prefix
    const event: WebUIEvent = {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: '[WebUI] Test message',
    };

    const newState = processEvent(state, event);

    // Should not add duplicate - prefix should be stripped for comparison
    expect(newState.messages).toHaveLength(0);
    expect(newState.isProcessing).toBe(true);
  });
});

describe('Canonical Rendering Path', () => {
  it('InternalMessage contains all data needed for rendering without HTML parsing', () => {
    // Tool call message
    const toolCall: InternalMessage = {
      id: 'tool-001',
      role: 'tool',
      name: 'bash',
      content: 'legacy html string',
      createdAt: new Date(),
      toolCallId: 'call-001',
      toolArguments: '{"command": "ls -la"}',
    };

    // Tool result message
    const toolResult: InternalMessage = {
      id: 'tool-002',
      role: 'tool',
      name: 'bash',
      content: 'legacy html string',
      createdAt: new Date(),
      toolCallId: 'call-001',
      toolResult: 'file1.txt\nfile2.txt',
      toolSuccess: true,
    };

    // Assistant message with thinking
    const assistant: InternalMessage = {
      id: 'assistant-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'The answer is 42.' }],
      thinking: 'Let me think through this...',
      createdAt: new Date(),
    };

    // Verify all structured data is present
    expect(toolCall.toolCallId).toBe('call-001');
    expect(toolCall.toolArguments).toBe('{"command": "ls -la"}');
    expect(toolCall.toolResult).toBeUndefined();

    expect(toolResult.toolCallId).toBe('call-001');
    expect(toolResult.toolResult).toBe('file1.txt\nfile2.txt');
    expect(toolResult.toolSuccess).toBe(true);

    expect(assistant.thinking).toBe('Let me think through this...');
  });
});

describe('Turn-Bound Streaming - Live Rendering Fix', () => {
  it('second turn creates a fresh assistant message instead of appending to first', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // === Turn 1 ===
    // turn_start
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'First question',
    });
    expect(state.messages).toHaveLength(1); // User message
    expect(state.messages[0].role).toBe('user');

    // message_update (text_delta)
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Answer to first question' },
    });
    expect(state.messages).toHaveLength(2); // User + Assistant
    expect(state.messages[1].role).toBe('assistant');
    expect(state.currentAssistantMessageId).toBe(state.messages[1].id);

    // turn_end
    state = processEvent(state, {
      type: 'turn_end',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      success: true,
    });
    expect(state.messages).toHaveLength(2); // Still 2 messages
    expect(state.currentAssistantMessageId).toBeUndefined(); // Cleared

    // === Turn 2 ===
    // turn_start
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:03.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      promptPreview: 'Second question',
    });
    expect(state.messages).toHaveLength(3); // User + Assistant + New User
    expect(state.messages[2].role).toBe('user');
    expect(state.currentAssistantMessageId).toBeUndefined(); // Cleared by turn_start

    // message_update (text_delta) - MUST create new assistant message
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:04.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Answer to second question' },
    });
    
    // CRITICAL: Should have 4 messages (not 3 with appended content)
    expect(state.messages).toHaveLength(4);
    expect(state.messages[3].role).toBe('assistant');
    
    // Verify first assistant message was NOT modified
    const firstAssistantText = (state.messages[1].content as any[])[0]?.text || '';
    expect(firstAssistantText).toBe('Answer to first question');
    
    // Verify second assistant message has its own content
    const secondAssistantText = (state.messages[3].content as any[])[0]?.text || '';
    expect(secondAssistantText).toBe('Answer to second question');
    
    // Verify currentAssistantMessageId points to the new message
    expect(state.currentAssistantMessageId).toBe(state.messages[3].id);
  });

  it('thinking_delta followed by text_delta creates correct assistant message with both', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // turn_start
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Question with thinking',
    });

    // thinking_delta
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'thinking_delta', delta: 'Let me think through this step by step.' },
    });
    expect(state.messages).toHaveLength(2); // User + Assistant (with thinking)
    expect(state.messages[1].thinking).toBe('Let me think through this step by step.');
    expect(state.messages[1].role).toBe('assistant');

    // text_delta - should append to same assistant message
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'The answer is 42.' },
    });
    
    expect(state.messages).toHaveLength(2); // Still 2 messages
    expect(state.messages[1].thinking).toBe('Let me think through this step by step.');
    expect((state.messages[1].content as any[])[0]?.text).toBe('The answer is 42.');
  });

  it('tool_start and tool_end appear live in correct order during streaming', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // turn_start + user message
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Run ls command',
    });

    // Assistant starts responding
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'I will run the ls command for you.' },
    });

    // tool_start
    state = processEvent(state, {
      type: 'tool_start',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      toolCallId: 'call-001',
      toolName: 'bash',
      arguments: '{"command": "ls -la"}',
    });

    // tool_end
    state = processEvent(state, {
      type: 'tool_end',
      timestamp: '2024-01-01T00:00:03.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      toolCallId: 'call-001',
      toolName: 'bash',
      success: true,
      result: 'file1.txt\nfile2.txt',
    });

    // Continue assistant response after tool - appends to SAME assistant message
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:04.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: '\n\nThe directory contains 2 files.' },
    });

    // Verify message order: user, assistant, tool_start, tool_end
    // The continuation text is appended to the assistant message, not a new message
    expect(state.messages).toHaveLength(4);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[2].role).toBe('tool'); // tool_start
    expect(state.messages[3].role).toBe('tool'); // tool_end
    
    // Verify assistant message contains both parts of text
    const assistantText = (state.messages[1].content as any[])[0]?.text || '';
    expect(assistantText).toContain('I will run the ls command');
    expect(assistantText).toContain('The directory contains 2 files');
    
    // Verify tool_start has correct data
    expect((state.messages[2] as any).name).toBe('bash');
    expect((state.messages[2] as any).toolArguments).toBe('{"command": "ls -la"}');
    
    // Verify tool_end has correct data
    expect((state.messages[3] as any).name).toBe('bash');
    expect((state.messages[3] as any).toolResult).toBe('file1.txt\nfile2.txt');
    expect((state.messages[3] as any).toolSuccess).toBe(true);
  });

  it('message ordering: user -> assistant thinking -> assistant text -> tool -> assistant continuation', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // turn_start
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Complex question',
    });

    // thinking_delta
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'thinking_delta', delta: 'Analyzing the problem...' },
    });

    // text_delta
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Let me check the files.' },
    });

    // tool_start
    state = processEvent(state, {
      type: 'tool_start',
      timestamp: '2024-01-01T00:00:03.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      toolCallId: 'call-001',
      toolName: 'read',
      arguments: '{"path": "file.txt"}',
    });

    // tool_end
    state = processEvent(state, {
      type: 'tool_end',
      timestamp: '2024-01-01T00:00:04.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      toolCallId: 'call-001',
      toolName: 'read',
      success: true,
      result: 'File contents',
    });

    // text_delta continuation - appends to SAME assistant message
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:05.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: '\n\nBased on the file contents, the answer is...'},
    });

    // Verify order: user, assistant, tool_start, tool_end
    // The continuation is appended to the first assistant message
    expect(state.messages).toHaveLength(4);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[1].thinking).toBe('Analyzing the problem...');
    const assistantText = (state.messages[1].content as any[])[0]?.text || '';
    expect(assistantText).toContain('Let me check the files');
    expect(assistantText).toContain('Based on the file contents');
    expect(state.messages[2].role).toBe('tool');
    expect(state.messages[3].role).toBe('tool');
  });

  it('turn_end clears currentAssistantMessageId without corrupting message boundaries', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // Turn 1
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Question 1',
    });
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Answer 1' },
    });
    const firstAssistantId = state.messages[1].id;

    state = processEvent(state, {
      type: 'turn_end',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      success: true,
    });

    // Verify turn_end cleared currentAssistantMessageId
    expect(state.currentAssistantMessageId).toBeUndefined();
    // Verify message still exists and is correct
    expect(state.messages[1].id).toBe(firstAssistantId);
    expect((state.messages[1].content as any[])[0]?.text).toBe('Answer 1');
    expect(state.messages[1].isStreaming).toBe(false);

    // Turn 2 - verify fresh start
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:03.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      promptPreview: 'Question 2',
    });
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:04.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Answer 2' },
    });

    // Verify new assistant message created (not appended to old)
    // Messages: user1, assistant1, user2, assistant2
    expect(state.messages).toHaveLength(4);
    expect((state.messages[3].content as any[])[0]?.text).toBe('Answer 2');
    expect((state.messages[1].content as any[])[0]?.text).toBe('Answer 1'); // Unchanged
  });

  it('multiple text_delta events in same turn accumulate to same assistant message', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // turn_start
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Question',
    });

    // First text_delta
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Hello' },
    });
    const assistantId = state.messages[1].id;

    // Second text_delta
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: ' world' },
    });

    // Third text_delta
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:03.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: '!' },
    });

    // Verify all deltas accumulated to same message
    expect(state.messages).toHaveLength(2); // Only user + one assistant
    expect(state.messages[1].id).toBe(assistantId); // Same message ID
    expect((state.messages[1].content as any[])[0]?.text).toBe('Hello world!');
  });
});

describe('User Message Positioning', () => {
  it('user message appears above assistant response for same turn', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // turn_start adds user message
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Hello',
    });
    
    // message_update adds assistant message
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Hi there!' },
    });

    // Verify order: user first, then assistant
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[1].role).toBe('assistant');
  });

  it('second user message appears above second assistant response', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // Turn 1
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'First message',
    });
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'First response' },
    });

    // Turn 2
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      promptPreview: 'Second message',
    });
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:03.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Second response' },
    });

    // Verify order: user1, assistant1, user2, assistant2
    // Messages: user1, assistant1, user2, assistant2
    expect(state.messages).toHaveLength(4);
    expect(state.messages[0].role).toBe('user');
    expect(state.messages[1].role).toBe('assistant');
    expect(state.messages[2].role).toBe('user');
    expect(state.messages[3].role).toBe('assistant');
    
    // Verify user2 is above assistant2 (by timestamp)
    expect(state.messages[2].createdAt.getTime()).toBeLessThan(state.messages[3].createdAt.getTime());
  });
});

describe('currentAssistantMessageId State Tracking', () => {
  it('is set when first assistant message created in a turn', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Question',
    });

    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Answer' },
    });

    expect(state.currentAssistantMessageId).toBeDefined();
    expect(state.messages.find(m => m.id === state.currentAssistantMessageId)).toBeTruthy();
  });

  it('is cleared on turn_start for new turn', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // Turn 1
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Q1',
    });
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'A1' },
    });

    // Turn 2 starts - currentAssistantMessageId should be cleared
    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      promptPreview: 'Q2',
    });

    expect(state.currentAssistantMessageId).toBeUndefined();
  });

  it('is cleared on turn_end', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    state = processEvent(state, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'Question',
    });
    state = processEvent(state, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Answer' },
    });

    state = processEvent(state, {
      type: 'turn_end',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      success: true,
    });

    expect(state.currentAssistantMessageId).toBeUndefined();
  });

  it('is cleared on user_message event', () => {
    let state: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
      currentAssistantMessageId: 'assistant-001',
    };

    state = processEvent(state, {
      type: 'user_message',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'New user message',
    });

    expect(state.currentAssistantMessageId).toBeUndefined();
  });
});

describe('Live View vs Reload Consistency', () => {
  it('live view message order matches what transcript would produce', () => {
    // Simulate live view
    let liveState: AdapterState = {
      roomKey: 'test-room',
      sessionId: 'session-001',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
    };

    // Turn 1 live
    liveState = processEvent(liveState, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:00.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      promptPreview: 'First question',
    });
    liveState = processEvent(liveState, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:01.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'First answer' },
    });
    liveState = processEvent(liveState, {
      type: 'turn_end',
      timestamp: '2024-01-01T00:00:02.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-001',
      sessionId: 'session-001',
      success: true,
    });

    // Turn 2 live
    liveState = processEvent(liveState, {
      type: 'turn_start',
      timestamp: '2024-01-01T00:00:03.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      promptPreview: 'Second question',
    });
    liveState = processEvent(liveState, {
      type: 'message_update',
      timestamp: '2024-01-01T00:00:04.000Z',
      roomId: '!room:example.com',
      roomKey: 'test-room',
      turnId: 'turn-002',
      sessionId: 'session-001',
      role: 'assistant',
      content: { type: 'text_delta', delta: 'Second answer' },
    });

    // Live view should have: user1, assistant1, user2, assistant2
    // Messages: user1, assistant1, user2, assistant2
    expect(liveState.messages).toHaveLength(4);
    expect(liveState.messages[0].role).toBe('user');
    expect(liveState.messages[1].role).toBe('assistant');
    expect(liveState.messages[2].role).toBe('user');
    expect(liveState.messages[3].role).toBe('assistant');

    // Verify this matches what transcriptToMessages would produce
    const transcriptItems = [
      { kind: 'user_message' as const, id: 'u1', timestamp: '2024-01-01T00:00:00.000Z', text: 'First question' },
      { kind: 'assistant_message' as const, id: 'a1', timestamp: '2024-01-01T00:00:01.000Z', text: 'First answer' },
      { kind: 'user_message' as const, id: 'u2', timestamp: '2024-01-01T00:00:03.000Z', text: 'Second question' },
      { kind: 'assistant_message' as const, id: 'a2', timestamp: '2024-01-01T00:00:04.000Z', text: 'Second answer' },
    ];
    const transcriptMessages = transcriptToMessages(transcriptItems);

    expect(transcriptMessages).toHaveLength(4);
    expect(transcriptMessages[0].role).toBe('user');
    expect(transcriptMessages[1].role).toBe('assistant');
    expect(transcriptMessages[2].role).toBe('user');
    expect(transcriptMessages[3].role).toBe('assistant');
  });
});

export {};




