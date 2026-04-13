/**
 * Assistant UI Adapter
 *
 * Converts server-side transcript and SSE events into assistant-ui format.
 * This is the core of the ExternalStoreRuntime integration.
 *
 * Design:
 * - Server remains authoritative for all state
 * - This adapter maintains a synchronized view model
 * - Messages are converted from server transcript
 * - SSE events incrementally update the view model
 */

import type {
  TranscriptItem,
  TranscriptItemKind,
  WebUIEvent,
} from './types';

/**
 * Generate a unique ID.
 */
export function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Internal message format used by the adapter.
 */
export interface InternalMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: Array<{ type: 'text'; text: string }> | string;
  createdAt: Date;
  name?: string;
}

/**
 * Internal state held by the adapter.
 */
export interface AdapterState {
  roomKey: string;
  sessionId: string;
  messages: InternalMessage[];
  isProcessing: boolean;
  activeToolCalls: Map<string, ToolCallState>;
}

/**
 * State for tracking a tool call.
 */
export interface ToolCallState {
  toolName: string;
  arguments?: string;
  result?: string;
  success?: boolean;
}

/**
 * Generate a unique ID for messages.
 */
function generateMessageId(kind: TranscriptItemKind, id: string): string {
  return `msg-${kind}-${id}`;
}

/**
 * Convert a transcript item to an internal message.
 */
export function transcriptItemToMessage(item: TranscriptItem): InternalMessage {
  const id = generateMessageId(item.kind, item.id);
  const createdAt = new Date(item.timestamp);

  switch (item.kind) {
    case 'user_message':
      return {
        id,
        role: 'user',
        content: [{ type: 'text' as const, text: item.text }],
        createdAt,
      };

    case 'assistant_message': {
      const content: Array<{ type: 'text'; text: string }> = [
        { type: 'text' as const, text: item.text },
      ];

      if (item.thinking) {
        content.unshift({ type: 'text' as const, text: `Thinking: ${item.thinking}` });
      }

      return {
        id,
        role: 'assistant',
        content,
        createdAt,
      };
    }

    case 'tool_start':
      return {
        id,
        role: 'tool',
        name: item.toolName,
        content: `\n<span class="tool-call">\n  <strong>Tool Call:</strong> ${item.toolName}\n  ${item.toolCallId ? `(${item.toolCallId})` : ''}\n</span>`.trim(),
        createdAt,
      };

    case 'tool_end': {
      const successIcon = item.success ? '✓' : '✗';
      return {
        id,
        role: 'tool',
        name: item.toolName,
        content: `\n<span class="tool-result">\n  <strong>Result:</strong> ${item.toolName} ${successIcon}\n</span>`.trim(),
        createdAt,
      };
    }

    case 'thinking':
      return {
        id,
        role: 'assistant',
        content: [
          {
            type: 'text' as const,
            text: `<thinking>${item.text}</thinking>`,
          },
        ],
        createdAt,
      };
  }
}

/**
 * Convert a full transcript response to internal messages.
 */
export function transcriptToMessages(items: TranscriptItem[]): InternalMessage[] {
  return items.map(transcriptItemToMessage);
}

/**
 * Find the most recent message from a given role.
 */
export function findLastMessageByRole(
  messages: InternalMessage[],
  role: 'user' | 'assistant'
): InternalMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) {
      return messages[i];
    }
  }
  return null;
}

/**
 * Append text to the last text content of a message.
 */
export function appendTextToMessage(message: InternalMessage, text: string): InternalMessage {
  if (message.role !== 'assistant') {
    return message;
  }

  const newContent = [...(Array.isArray(message.content) ? message.content : [])];

  let lastTextIndex = -1;
  for (let i = newContent.length - 1; i >= 0; i--) {
    if (newContent[i].type === 'text') {
      lastTextIndex = i;
      break;
    }
  }

  if (lastTextIndex >= 0) {
    const lastContent = newContent[lastTextIndex];
    if (typeof lastContent === 'object' && 'text' in lastContent) {
      newContent[lastTextIndex] = {
        ...lastContent,
        text: lastContent.text + text,
      };
    }
  } else {
    newContent.push({ type: 'text' as const, text });
  }

  return { ...message, content: newContent };
}

/**
 * Create a new message for streaming.
 */
export function createStreamingMessage(
  role: 'user' | 'assistant',
  text: string
): InternalMessage {
  return {
    id: generateId(),
    role,
    content: [{ type: 'text' as const, text }],
    createdAt: new Date(),
  };
}

/**
 * Process a WebUI event and update the adapter state.
 */
export function processEvent(
  state: AdapterState,
  event: WebUIEvent
): AdapterState {
  switch (event.type) {
    case 'session_connected':
      return {
        ...state,
        sessionId: event.sessionId || state.sessionId,
      };

    case 'turn_start': {
      if (event.promptPreview) {
        const userMessage: InternalMessage = {
          id: generateId(),
          role: 'user',
          content: [{ type: 'text' as const, text: event.promptPreview }],
          createdAt: new Date(event.timestamp),
        };
        return {
          ...state,
          messages: [...state.messages, userMessage],
          isProcessing: true,
        };
      }
      return { ...state, isProcessing: true };
    }

    case 'message_update': {
      const delta = event.content.delta;
      let assistantMessage = findLastMessageByRole(state.messages, 'assistant');

      if (!assistantMessage) {
        assistantMessage = createStreamingMessage('assistant', delta);
        return {
          ...state,
          messages: [...state.messages, assistantMessage],
        };
      }

      const updatedMessage = appendTextToMessage(assistantMessage, delta);
      const messageIndex = state.messages.findIndex((m) => m.id === assistantMessage.id);
      if (messageIndex >= 0) {
        const newMessages = [...state.messages];
        newMessages[messageIndex] = updatedMessage;
        return { ...state, messages: newMessages };
      }
      return state;
    }

    case 'tool_start': {
      const newActiveToolCalls = new Map(state.activeToolCalls);
      newActiveToolCalls.set(event.toolCallId, {
        toolName: event.toolName,
        arguments: event.arguments,
      });

      const toolMessage: InternalMessage = {
        id: event.toolCallId,
        role: 'tool',
        name: event.toolName,
        content: `\n<span class="tool-call">\n  <strong>Tool Call:</strong> ${event.toolName}\n</span>`.trim(),
        createdAt: new Date(event.timestamp),
      };

      return {
        ...state,
        activeToolCalls: newActiveToolCalls,
        messages: [...state.messages, toolMessage],
      };
    }

    case 'tool_end': {
      const newActiveToolCalls = new Map(state.activeToolCalls);
      newActiveToolCalls.delete(event.toolCallId);

      const successIcon = event.success ? '✓' : '✗';
      const toolMessage: InternalMessage = {
        id: `result-${event.toolCallId}`,
        role: 'tool',
        name: event.toolName,
        content: `\n<span class="tool-result">\n  <strong>Result:</strong> ${event.toolName} ${successIcon}\n</span>`.trim(),
        createdAt: new Date(event.timestamp),
      };

      return {
        ...state,
        activeToolCalls: newActiveToolCalls,
        messages: [...state.messages, toolMessage],
      };
    }

    case 'turn_end':
      return { ...state, isProcessing: false };

    case 'state_change': {
      if (event.changeType === 'processing_start') {
        return { ...state, isProcessing: true };
      }
      if (event.changeType === 'processing_end') {
        return { ...state, isProcessing: false };
      }
      return state;
    }

    case 'error': {
      const errorMessage: InternalMessage = {
        id: generateId(),
        role: 'assistant',
        content: [
          {
            type: 'text' as const,
            text: `Error: ${event.message}${event.code ? ` (${event.code})` : ''}`,
          },
        ],
        createdAt: new Date(),
      };
      return {
        ...state,
        messages: [...state.messages, errorMessage],
        isProcessing: false,
      };
    }

    default:
      return state;
  }
}

/**
 * Extract text content from a message object.
 */
export function extractTextFromMessage(message: { content: any }): string {
  if (typeof message.content === 'string') {
    return message.content;
  }
  return message.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text || '')
    .join('');
}
