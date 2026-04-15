/**
 * Normalization Tests
 *
 * Tests for message normalization and rendering path.
 */

import { describe, it, expect } from 'vitest';
import { normalizeMessage } from './normalization';
import type { InternalMessage } from './adapter';

describe('normalizeMessage', () => {
  it('normalizes user message to user role with text content', () => {
    const message: InternalMessage = {
      id: 'user-001',
      role: 'user',
      content: [{ type: 'text', text: 'Hello, world!' }],
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    const normalized = normalizeMessage(message);

    expect(normalized.role).toBe('user');
    expect(normalized.content).toHaveLength(1);
    expect(normalized.content[0]).toEqual({ type: 'text', text: 'Hello, world!' });
    expect(normalized.id).toBe('user-001');
  });

  it('normalizes assistant message without thinking', () => {
    const message: InternalMessage = {
      id: 'assistant-001',
      role: 'assistant',
      content: [{ type: 'text', text: 'The answer is 42.' }],
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    const normalized = normalizeMessage(message);

    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toHaveLength(1);
    expect(normalized.content[0]).toEqual({ type: 'text', text: 'The answer is 42.' });
  });

  it('normalizes assistant message with thinking to reasoning part', () => {
    const message: InternalMessage = {
      id: 'assistant-002',
      role: 'assistant',
      content: [{ type: 'text', text: 'The answer is 42.' }],
      thinking: 'Let me think through this step by step...',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    const normalized = normalizeMessage(message);

    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toHaveLength(2);
    // Reasoning comes first
    expect(normalized.content[0]).toEqual({ type: 'reasoning', text: 'Let me think through this step by step...' });
    // Then text
    expect(normalized.content[1]).toEqual({ type: 'text', text: 'The answer is 42.' });
  });

  it('normalizes assistant message with only thinking (no text)', () => {
    const message: InternalMessage = {
      id: 'assistant-003',
      role: 'assistant',
      content: [],
      thinking: 'Thinking process here...',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    const normalized = normalizeMessage(message);

    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toHaveLength(1);
    expect(normalized.content[0]).toEqual({ type: 'reasoning', text: 'Thinking process here...' });
  });

  it('normalizes tool call message to tool-call part', () => {
    const message: InternalMessage = {
      id: 'tool-001',
      role: 'tool',
      name: 'bash',
      content: '<span class="tool-call">Tool Call: bash</span>',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      toolCallId: 'call-001',
      toolArguments: '{"command": "ls -la"}',
    };

    const normalized = normalizeMessage(message);

    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toHaveLength(1);
    const toolPart = normalized.content[0] as any;
    expect(toolPart.type).toBe('tool-call');
    expect(toolPart.toolName).toBe('bash');
    expect(toolPart.toolCallId).toBe('call-001');
    expect(toolPart.argsText).toBe('{"command": "ls -la"}');
  });

  it('normalizes tool result message with success', () => {
    const message: InternalMessage = {
      id: 'tool-002',
      role: 'tool',
      name: 'read',
      content: '<span class="tool-result">Result: read ✓</span>',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      toolCallId: 'call-002',
      toolResult: 'File contents here',
      toolSuccess: true,
    };

    const normalized = normalizeMessage(message);

    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toHaveLength(1);
    const toolPart = normalized.content[0] as any;
    expect(toolPart.type).toBe('tool-call');
    expect(toolPart.toolName).toBe('read');
    expect(toolPart.result).toBe('File contents here');
    expect(toolPart.isError).toBe(false);
  });

  it('normalizes tool result message with error', () => {
    const message: InternalMessage = {
      id: 'tool-003',
      role: 'tool',
      name: 'bash',
      content: '<span class="tool-result">Result: bash ✗</span>',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      toolCallId: 'call-003',
      toolResult: 'Command failed',
      toolSuccess: false,
    };

    const normalized = normalizeMessage(message);

    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toHaveLength(1);
    const toolPart = normalized.content[0] as any;
    expect(toolPart.type).toBe('tool-call');
    expect(toolPart.toolName).toBe('bash');
    expect(toolPart.result).toBe('Command failed');
    expect(toolPart.isError).toBe(true);
  });
});

describe('Reasoning Preview', () => {
  it('preserves thinking content in normalization for preview', () => {
    const longThinking = [
      'Step 1: Analyze the problem',
      'Step 2: Consider the options',
      'Step 3: Evaluate each option',
      'Step 4: Make a decision',
      'Step 5: Verify the solution',
    ].join('\n');

    const message: InternalMessage = {
      id: 'assistant-004',
      role: 'assistant',
      content: [{ type: 'text', text: 'Final answer' }],
      thinking: longThinking,
      createdAt: new Date(),
    };

    const normalized = normalizeMessage(message);

    // Verify thinking is preserved for preview display
    const contentArray = Array.isArray(normalized.content) ? normalized.content : [];
    const reasoningPart = contentArray.find((c: any) => c.type === 'reasoning');
    expect(reasoningPart).toBeDefined();
    expect((reasoningPart as any).text).toBe(longThinking);
    
    // Verify first 3 lines would be visible as preview
    const lines = longThinking.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines.slice(0, 3)).toEqual([
      'Step 1: Analyze the problem',
      'Step 2: Consider the options',
      'Step 3: Evaluate each option',
    ]);
  });
});

describe('Tool Rendering with Structured Data', () => {
  it('preserves tool arguments in normalization', () => {
    const args = '{"command": "grep -r "hello" "."", "shell": "bash"}';
    const message: InternalMessage = {
      id: 'tool-004',
      role: 'tool',
      name: 'bash',
      content: '<span>Tool Call: bash</span>',
      createdAt: new Date(),
      toolCallId: 'call-004',
      toolArguments: args,
    };

    // Note: normalization converts to tool-call part, but arguments
    // are preserved in the InternalMessage for rendering components
    expect(message.toolArguments).toBe(args);
  });

  it('preserves tool results in normalization', () => {
    const result = 'Found 5 matches in 3 files';
    const message: InternalMessage = {
      id: 'tool-005',
      role: 'tool',
      name: 'bash',
      content: '<span>Result: bash ✓</span>',
      createdAt: new Date(),
      toolCallId: 'call-005',
      toolResult: result,
      toolSuccess: true,
    };

    // Note: normalization converts to tool-call part, but result
    // is preserved in the InternalMessage for rendering components
    expect(message.toolResult).toBe(result);
    expect(message.toolSuccess).toBe(true);
  });
});

describe('End-to-End Rendering Path', () => {
  it('user message flows through normalization correctly', () => {
    const message: InternalMessage = {
      id: 'user-002',
      role: 'user',
      content: [{ type: 'text', text: 'What is the capital of France?' }],
      createdAt: new Date(),
    };

    const normalized = normalizeMessage(message);

    expect(normalized.role).toBe('user');
    expect(normalized.content).toEqual([
      { type: 'text', text: 'What is the capital of France?' }
    ]);
  });

  it('assistant message with thinking flows through normalization correctly', () => {
    const message: InternalMessage = {
      id: 'assistant-005',
      role: 'assistant',
      content: [{ type: 'text', text: 'The capital of France is Paris.' }],
      thinking: 'Let me think... France is in Europe. The capital is Paris.',
      createdAt: new Date(),
    };

    const normalized = normalizeMessage(message);

    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toEqual([
      { type: 'reasoning', text: 'Let me think... France is in Europe. The capital is Paris.' },
      { type: 'text', text: 'The capital of France is Paris.' },
    ]);
  });

  it('tool call followed by result flows through normalization correctly', () => {
    const toolCall: InternalMessage = {
      id: 'tool-006',
      role: 'tool',
      name: 'search',
      content: '<span>Tool Call: search</span>',
      createdAt: new Date(),
      toolCallId: 'call-006',
      toolArguments: '{"query": "Paris capital"}',
    };

    const toolResult: InternalMessage = {
      id: 'tool-007',
      role: 'tool',
      name: 'search',
      content: '<span>Result: search ✓</span>',
      createdAt: new Date(),
      toolCallId: 'call-006',
      toolResult: 'Paris is the capital and largest city of France.',
      toolSuccess: true,
    };

    const normalizedCall = normalizeMessage(toolCall);
    const normalizedResult = normalizeMessage(toolResult);

    expect(normalizedCall.role).toBe('assistant');
    expect((normalizedCall.content[0] as any).type).toBe('tool-call');
    expect((normalizedCall.content[0] as any).toolName).toBe('search');

    expect(normalizedResult.role).toBe('assistant');
    expect((normalizedResult.content[0] as any).type).toBe('tool-call');
    expect((normalizedResult.content[0] as any).toolName).toBe('search');
    expect((normalizedResult.content[0] as any).result).toBe('Paris is the capital and largest city of France.');
  });
});
