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
  thinking?: string;  // Separate thinking/reasoning content
  isStreaming?: boolean;  // Track if message is still being streamed
  // Tool call/result structured data
  toolCallId?: string;
  toolArguments?: string;
  toolResult?: string;
  toolSuccess?: boolean;
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
  // Track pending user messages for deduplication
  pendingUserMessages?: Set<string>;  // Set of prompt texts awaiting server confirmation
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
      return {
        id,
        role: 'assistant',
        content: [{ type: 'text' as const, text: item.text }],
        thinking: item.thinking,
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
        toolCallId: item.toolCallId,
        toolArguments: item.arguments,
      };

    case 'tool_end': {
      const successIcon = item.success ? '✓' : '✗';
      return {
        id,
        role: 'tool',
        name: item.toolName,
        content: `\n<span class="tool-result">\n  <strong>Result:</strong> ${item.toolName} ${successIcon}\n</span>`.trim(),
        createdAt,
        toolCallId: item.toolCallId,
        toolResult: item.result,
        toolSuccess: item.success,
      };
    }

    case 'thinking':
      // Thinking items from transcript are converted to assistant messages
      // with thinking content. This preserves the thinking for display.
      return {
        id,
        role: 'assistant',
        content: [],
        thinking: item.text,
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
 * Add an optimistic user message for web UI submissions.
 * Returns the newly created message ID for tracking.
 */
export function addOptimisticUserMessage(
  state: AdapterState,
  promptText: string
): { state: AdapterState; messageId: string } {
  const messageId = generateId();
  
  // Add to pending messages for deduplication
  const newPendingUserMessages = new Set(state.pendingUserMessages || []);
  newPendingUserMessages.add(promptText);

  const userMessage: InternalMessage = {
    id: messageId,
    role: 'user',
    content: [{ type: 'text' as const, text: promptText }],
    createdAt: new Date(),
  };

  return {
    state: {
      ...state,
      messages: [...state.messages, userMessage],
      pendingUserMessages: newPendingUserMessages,
    },
    messageId,
  };
}

/**
 * Check if a user message text is already in the messages list.
 * Used for deduplication when transcript is reloaded.
 */
export function findUserMessageByText(
  messages: InternalMessage[],
  text: string
): InternalMessage | null {
  for (const msg of messages) {
    if (msg.role === 'user') {
      const msgText = typeof msg.content === 'string' 
        ? msg.content 
        : msg.content.filter(c => c.type === 'text').map(c => c.text).join('');
      if (msgText === text) {
        return msg;
      }
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
        // Check for duplicate - if we already have a user message with this text,
        // or if it's in pendingUserMessages, skip adding it
        // Strip [WebUI] prefix for comparison since optimistic update uses trimmed text
        // Note: '[WebUI] ' is 8 chars, so we slice from index 8 (or use substring(8))
        const promptForComparison = event.promptPreview.startsWith('[WebUI] ') 
          ? event.promptPreview.substring(8) 
          : event.promptPreview;
        const existingMessage = findUserMessageByText(state.messages, promptForComparison);
        const isPending = state.pendingUserMessages?.has(promptForComparison) || false;
        
        if (!existingMessage && !isPending) {
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
      }
      return { ...state, isProcessing: true };
    }

    case 'user_message': {
      // Handle user_message event (for Matrix-originated messages where promptPreview
      // wasn't available in turn_start)
      // Strip [WebUI] prefix for comparison since optimistic update uses trimmed text
      const promptForComparison = event.promptPreview.startsWith('[WebUI] ') 
        ? event.promptPreview.substring(8) 
        : event.promptPreview;
      const existingMessage = findUserMessageByText(state.messages, promptForComparison);
      const isPending = state.pendingUserMessages?.has(promptForComparison) || false;
      
      if (!existingMessage && !isPending) {
        const userMessage: InternalMessage = {
          id: generateId(),
          role: 'user',
          content: [{ type: 'text' as const, text: event.promptPreview }],
          createdAt: new Date(event.timestamp),
        };
        return {
          ...state,
          messages: [...state.messages, userMessage],
        };
      }
      return state;
    }

    case 'message_update': {
      const delta = event.content.delta;
      
      // Handle thinking delta separately
      if (event.content.type === 'thinking_delta') {
        let assistantMessage = findLastMessageByRole(state.messages, 'assistant');
        
        if (!assistantMessage) {
          assistantMessage = {
            id: generateId(),
            role: 'assistant',
            content: [],
            thinking: delta,
            createdAt: new Date(event.timestamp),
            isStreaming: true,
          };
          return {
            ...state,
            messages: [...state.messages, assistantMessage],
          };
        }
        
        const updatedMessage = {
          ...assistantMessage,
          thinking: (assistantMessage.thinking || '') + delta,
          isStreaming: true,
        };
        const messageIndex = state.messages.findIndex((m) => m.id === assistantMessage.id);
        if (messageIndex >= 0) {
          const newMessages = [...state.messages];
          newMessages[messageIndex] = updatedMessage;
          return { ...state, messages: newMessages };
        }
        return state;
      }
      
      // Handle regular text delta
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
        newMessages[messageIndex] = { ...updatedMessage, isStreaming: true };
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
        toolCallId: event.toolCallId,
        toolArguments: event.arguments,
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
        toolCallId: event.toolCallId,
        toolResult: event.result,
        toolSuccess: event.success,
      };

      return {
        ...state,
        activeToolCalls: newActiveToolCalls,
        messages: [...state.messages, toolMessage],
      };
    }

    case 'turn_end': {
      // Clear isStreaming flag from all messages
      const newMessages = state.messages.map(msg => ({
        ...msg,
        isStreaming: false,
      }));
      return { ...state, isProcessing: false, messages: newMessages };
    }

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
