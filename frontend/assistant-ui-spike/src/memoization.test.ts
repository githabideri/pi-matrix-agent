/**
 * Memoization Tests
 *
 * Tests for component memoization logic and content version calculation.
 * These tests verify that components properly detect when props haven't changed.
 */

import { describe, it, expect } from 'vitest';
import type { InternalMessage } from './adapter';

/**
 * Simulate MessageContent's memo comparison logic.
 */
function messageContentShouldUpdate(
  prevMsg: InternalMessage,
  nextMsg: InternalMessage,
  prevIsStreaming: boolean,
  nextIsStreaming: boolean
): boolean {
  const sameRole = prevMsg.role === nextMsg.role;
  const sameId = prevMsg.id === nextMsg.id;
  
  if (!sameRole || !sameId) return true;
  
  // Check content equality
  const getFlatContent = (m: InternalMessage) => {
    if (typeof m.content === 'string') return m.content;
    return m.content.map(c => c.text).join('');
  };
  const sameContent = getFlatContent(prevMsg) === getFlatContent(nextMsg);
  const sameThinking = prevMsg.thinking === nextMsg.thinking;
  const sameStreaming = prevIsStreaming === nextIsStreaming;
  
  // Tool-specific checks
  if (prevMsg.role === 'tool') {
    return !sameStreaming ||
           (prevMsg.toolCallId !== nextMsg.toolCallId) ||
           (prevMsg.toolResult !== nextMsg.toolResult) ||
           (prevMsg.toolArguments !== nextMsg.toolArguments) ||
           (prevMsg.toolSuccess !== nextMsg.toolSuccess);
  }
  
  return !sameContent || !sameThinking || !sameStreaming;
}

/**
 * Calculate content version for scroll tracking.
 * This mirrors the logic in ChatInterface.tsx.
 */
function calculateContentVersion(messages: InternalMessage[]): number {
  let version = 0;
  for (const msg of messages) {
    // Count text content length
    if (typeof msg.content === 'string') {
      version += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          version += (part.text?.length || 0);
        }
      }
    }
    // Count thinking content length
    version += (msg.thinking?.length || 0);
    // Count tool result/arguments length
    version += (msg.toolResult?.length || 0);
    version += (msg.toolArguments?.length || 0);
  }
  return version;
}

describe('MessageContent Memoization', () => {
  it('skips update when message content unchanged', () => {
    const message: InternalMessage = {
      id: 'msg-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello world' }],
      createdAt: new Date(),
    };
    
    expect(messageContentShouldUpdate(message, message, false, false)).toBe(false);
  });
  
  it('updates when text content changes', () => {
    const prev: InternalMessage = {
      id: 'msg-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: new Date(),
    };
    const next: InternalMessage = {
      id: 'msg-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello world' }],
      createdAt: new Date(),
    };
    
    expect(messageContentShouldUpdate(prev, next, false, false)).toBe(true);
  });
  
  it('updates when thinking content changes', () => {
    const prev: InternalMessage = {
      id: 'msg-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'Answer' }],
      thinking: 'Thinking...',
      createdAt: new Date(),
    };
    const next: InternalMessage = {
      id: 'msg-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'Answer' }],
      thinking: 'Thinking more...',
      createdAt: new Date(),
    };
    
    expect(messageContentShouldUpdate(prev, next, false, false)).toBe(true);
  });
  
  it('updates when streaming state changes', () => {
    const message: InternalMessage = {
      id: 'msg-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: new Date(),
    };
    
    expect(messageContentShouldUpdate(message, message, false, true)).toBe(true);
    expect(messageContentShouldUpdate(message, message, true, false)).toBe(true);
  });
  
  it('updates when message ID changes', () => {
    const prev: InternalMessage = {
      id: 'msg-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: new Date(),
    };
    const next: InternalMessage = {
      id: 'msg-002',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: new Date(),
    };
    
    expect(messageContentShouldUpdate(prev, next, false, false)).toBe(true);
  });
  
  it('handles user messages correctly', () => {
    const message: InternalMessage = {
      id: 'msg-001',
      role: 'user',
      content: [{ type: 'text', text: 'User message' }],
      createdAt: new Date(),
    };
    
    expect(messageContentShouldUpdate(message, message, false, false)).toBe(false);
  });
  
  it('handles tool call messages', () => {
    const message: InternalMessage = {
      id: 'tool-001',
      role: 'tool',
      name: 'bash',
      content: 'tool call',
      createdAt: new Date(),
      toolCallId: 'call-001',
      toolArguments: '{"command": "ls"}',
    };
    
    expect(messageContentShouldUpdate(message, message, false, false)).toBe(false);
  });
  
  it('handles tool result messages', () => {
    const message: InternalMessage = {
      id: 'tool-002',
      role: 'tool',
      name: 'bash',
      content: 'tool result',
      createdAt: new Date(),
      toolCallId: 'call-001',
      toolResult: 'file1.txt\nfile2.txt',
      toolSuccess: true,
    };
    
    expect(messageContentShouldUpdate(message, message, false, false)).toBe(false);
  });
  
  it('updates tool message when arguments change', () => {
    const prev: InternalMessage = {
      id: 'tool-001',
      role: 'tool',
      name: 'bash',
      content: 'tool call',
      createdAt: new Date(),
      toolCallId: 'call-001',
      toolArguments: '{"command": "ls"}',
    };
    const next: InternalMessage = {
      id: 'tool-001',
      role: 'tool',
      name: 'bash',
      content: 'tool call',
      createdAt: new Date(),
      toolCallId: 'call-001',
      toolArguments: '{"command": "grep"}',
    };
    
    expect(messageContentShouldUpdate(prev, next, false, false)).toBe(true);
  });
});

describe('Content Version Calculation', () => {
  it('calculates version for empty message list', () => {
    expect(calculateContentVersion([])).toBe(0);
  });
  
  it('calculates version for single user message', () => {
    const messages: InternalMessage[] = [{
      id: 'msg-001',
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
      createdAt: new Date(),
    }];
    
    expect(calculateContentVersion(messages)).toBe(5); // 'Hello'.length
  });
  
  it('calculates version for assistant message with thinking', () => {
    const messages: InternalMessage[] = [{
      id: 'msg-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'Answer' }],
      thinking: 'Thinking...',
      createdAt: new Date(),
    }];
    
    expect(calculateContentVersion(messages)).toBe(6 + 11); // 'Answer'.length + 'Thinking...'.length
  });
  
  it('changes when text content grows during streaming', () => {
    const baseMessages: InternalMessage[] = [{
      id: 'msg-001',
      role: 'user',
      content: [{ type: 'text', text: 'Prompt' }],
      createdAt: new Date(),
    }];
    
    const version1 = calculateContentVersion([...baseMessages, {
      id: 'msg-002',
      role: 'assistant',
      content: [{ type: 'text', text: 'H' }],
      createdAt: new Date(),
    }]);
    
    const version2 = calculateContentVersion([...baseMessages, {
      id: 'msg-002',
      role: 'assistant',
      content: [{ type: 'text', text: 'He' }],
      createdAt: new Date(),
    }]);
    
    const version3 = calculateContentVersion([...baseMessages, {
      id: 'msg-002',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hel' }],
      createdAt: new Date(),
    }]);
    
    expect(version1).toBeLessThan(version2);
    expect(version2).toBeLessThan(version3);
  });
  
  it('changes when thinking grows during streaming', () => {
    const baseMessages: InternalMessage[] = [{
      id: 'msg-001',
      role: 'user',
      content: [{ type: 'text', text: 'Prompt' }],
      createdAt: new Date(),
    }];
    
    const version1 = calculateContentVersion([...baseMessages, {
      id: 'msg-002',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      thinking: 'S',
      createdAt: new Date(),
    }]);
    
    const version2 = calculateContentVersion([...baseMessages, {
      id: 'msg-002',
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      thinking: 'St',
      createdAt: new Date(),
    }]);
    
    expect(version1).toBeLessThan(version2);
  });
  
  it('handles multiple messages', () => {
    const messages: InternalMessage[] = [
      {
        id: 'msg-001',
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        createdAt: new Date(),
      },
      {
        id: 'msg-002',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi' }],
        thinking: 'Thinking',
        createdAt: new Date(),
      },
    ];
    
    expect(calculateContentVersion(messages)).toBe(5 + 2 + 8); // 5 + 2 + 8 = 15
  });
  
  it('handles tool messages', () => {
    const messages: InternalMessage[] = [
      {
        id: 'tool-001',
        role: 'tool',
        name: 'bash',
        content: 'tool',
        createdAt: new Date(),
        toolCallId: 'call-001',
        toolArguments: '{"command": "ls"}',
      },
    ];
    
    // Content length (4) + arguments length (17) = 21
    // Note: "tool" is 4 chars, arguments is 17 chars
    expect(calculateContentVersion(messages)).toBe(21);
  });
  
  it('handles tool result messages', () => {
    const messages: InternalMessage[] = [
      {
        id: 'tool-002',
        role: 'tool',
        name: 'bash',
        content: 'result',
        createdAt: new Date(),
        toolCallId: 'call-001',
        toolResult: 'file1.txt',
        toolSuccess: true,
      },
    ];
    
    // Content length (6) + result length (9) = 15
    expect(calculateContentVersion(messages)).toBe(6 + 9);
  });
  
  it('handles string content format', () => {
    const messages: InternalMessage[] = [{
      id: 'msg-001',
      role: 'user',
      content: 'String content',
      createdAt: new Date(),
    }];
    
    expect(calculateContentVersion(messages)).toBe(14); // 'String content'.length
  });
  
  it('handles complex conversation state', () => {
    const messages: InternalMessage[] = [
      // Turn 1
      {
        id: 'msg-001',
        role: 'user',
        content: [{ type: 'text', text: 'First prompt' }],
        createdAt: new Date(),
      },
      {
        id: 'msg-002',
        role: 'assistant',
        content: [{ type: 'text', text: 'First answer' }],
        thinking: 'First thinking',
        createdAt: new Date(),
      },
      // Turn 2
      {
        id: 'msg-003',
        role: 'user',
        content: [{ type: 'text', text: 'Second prompt' }],
        createdAt: new Date(),
      },
      {
        id: 'msg-004',
        role: 'assistant',
        content: [{ type: 'text', text: 'Second answer' }],
        thinking: 'Second thinking',
        createdAt: new Date(),
      },
    ];
    
    const version = calculateContentVersion(messages);
    expect(version).toBe(12 + 12 + 14 + 13 + 13 + 15); // Sum of all content lengths
  });
});
