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
