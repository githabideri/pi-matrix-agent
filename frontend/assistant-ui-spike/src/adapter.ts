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
  // Turn-bound streaming state: ID of the assistant message currently being streamed
  currentAssistantMessageId?: string;
  // Current turn ID for detecting turn boundaries
  currentTurnId?: string;
  // Tail-aware continuation state set by snapshot rehydration
  // Tracks the kind of the last item in the snapshot to derive correct continuation behavior
  snapshotTailKind?: 'user_message' | 'assistant_message' | 'tool_start' | 'tool_end' | 'thinking';
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
 * Convert a transcript snapshot item to an internal message.
 */
export function snapshotItemToMessage(item: TranscriptItem): InternalMessage {
  return transcriptItemToMessage(item);
}

/**
 * Rehydrate adapter state from a transcript snapshot.
 * This replaces the current message list with the authoritative backend snapshot.
 *
 * Implements tail-aware continuation:
 * - If snapshot ends with assistant_message: set currentAssistantMessageId for continuation
 * - If snapshot ends with thinking: set currentAssistantMessageId for thinking continuation
 * - If snapshot ends with tool_start/tool_end: clear currentAssistantMessageId (new assistant needed)
 * - If snapshot ends with user_message: clear currentAssistantMessageId (new assistant needed)
 */
export function rehydrateFromSnapshot(
  state: AdapterState,
  snapshot: {
    sessionId: string;
    isProcessing: boolean;
    items: TranscriptItem[];
  }
): AdapterState {
  // Convert snapshot items to internal messages
  const messages = snapshot.items.map(snapshotItemToMessage);

  // Derive continuation state from the tail of the snapshot
  const lastItem = snapshot.items[snapshot.items.length - 1];
  let currentAssistantMessageId: string | undefined = undefined;
  let snapshotTailKind: AdapterState['snapshotTailKind'] = undefined;

  if (lastItem) {
    switch (lastItem.kind) {
      case 'assistant_message':
        // Rule A: snapshot ends with assistant_message → continue that message
        snapshotTailKind = 'assistant_message';
        {
          const assistantMsg = messages.find(m => m.role === 'assistant' && 
            typeof m.content !== 'string' && m.content.length > 0 &&
            m.content.some(c => c.type === 'text' && typeof c.text === 'string'));
          if (assistantMsg) {
            currentAssistantMessageId = assistantMsg.id;
          }
        }
        break;

      case 'thinking':
        // Rule B: snapshot ends with thinking → continue the thinking segment
        snapshotTailKind = 'thinking';
        {
          // Find the assistant message with thinking content at the end
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].thinking) {
              currentAssistantMessageId = messages[i].id;
              break;
            }
          }
        }
        break;

      case 'tool_start':
      case 'tool_end':
        // Rule C: snapshot ends with tool activity → next assistant delta creates NEW message
        snapshotTailKind = lastItem.kind;
        currentAssistantMessageId = undefined;
        break;

      case 'user_message':
        // Rule D: snapshot ends with user_message → next assistant delta creates NEW message
        snapshotTailKind = 'user_message';
        currentAssistantMessageId = undefined;
        break;
    }
  }

  return {
    ...state,
    sessionId: snapshot.sessionId,
    messages,
    isProcessing: snapshot.isProcessing,
    // Set continuation state based on snapshot tail
    currentAssistantMessageId,
    currentTurnId: undefined,
    snapshotTailKind,
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

    case 'transcript_snapshot': {
      // Rehydrate from the backend-authoritative snapshot
      return rehydrateFromSnapshot(state, {
        sessionId: event.sessionId,
        isProcessing: event.isProcessing,
        items: event.items,
      });
    }

    case 'turn_start': {
      // Clear the current assistant message ID for the new turn
      // This ensures deltas will create a new assistant message instead of appending to the old one
      const clearedState = {
        ...state,
        currentAssistantMessageId: undefined,
        currentTurnId: event.turnId,  // Set the turn ID for this turn
      };
      if (event.promptPreview) {
        // Check for duplicate - if we already have a user message with this text,
        // or if it's in pendingUserMessages, skip adding it
        // Strip [WebUI] prefix for comparison since optimistic update uses trimmed text
        // Note: '[WebUI] ' is 8 chars, so we slice from index 8 (or use substring(8))
        const promptForComparison = event.promptPreview.startsWith('[WebUI] ') 
          ? event.promptPreview.substring(8) 
          : event.promptPreview;
        const existingMessage = findUserMessageByText(clearedState.messages, promptForComparison);
        const isPending = clearedState.pendingUserMessages?.has(promptForComparison) || false;
        
        if (!existingMessage && !isPending) {
          const userMessage: InternalMessage = {
            id: generateId(),
            role: 'user',
            content: [{ type: 'text' as const, text: event.promptPreview }],
            createdAt: new Date(event.timestamp),
          };
          return {
            ...clearedState,
            messages: [...clearedState.messages, userMessage],
            isProcessing: true,
          };
        }
        
        // Clear pending message from set if it was found (reconciliation complete)
        // This runs when either: message exists in list, OR it's marked as pending
        // Both cases mean the prompt is accounted for and should be removed from pending
        if (existingMessage || isPending) {
          const newPendingUserMessages = new Set(clearedState.pendingUserMessages || []);
          newPendingUserMessages.delete(promptForComparison);
          return { ...clearedState, isProcessing: true, pendingUserMessages: newPendingUserMessages };
        }
      }
      return { ...clearedState, isProcessing: true };
    }

    case 'user_message': {
      // Handle user_message event (for Matrix-originated messages where promptPreview
      // wasn't available in turn_start)
      // Clear current assistant message ID if set, to prepare for new turn's assistant response
      const userMessageClearedState = {
        ...state,
        currentAssistantMessageId: undefined,
        currentTurnId: event.turnId,  // Set the turn ID for this turn
      };
      // Strip [WebUI] prefix for comparison since optimistic update uses trimmed text
      const promptForComparison = event.promptPreview.startsWith('[WebUI] ') 
        ? event.promptPreview.substring(8) 
        : event.promptPreview;
      const existingMessage = findUserMessageByText(userMessageClearedState.messages, promptForComparison);
      const isPending = userMessageClearedState.pendingUserMessages?.has(promptForComparison) || false;
      
      if (!existingMessage && !isPending) {
        const userMessage: InternalMessage = {
          id: generateId(),
          role: 'user',
          content: [{ type: 'text' as const, text: event.promptPreview }],
          createdAt: new Date(event.timestamp),
        };
        return {
          ...userMessageClearedState,
          messages: [...userMessageClearedState.messages, userMessage],
        };
      }
      
      // Clear pending message from set if it was found (reconciliation complete)
      // This runs when either: message exists in list, OR it's marked as pending
      // Both cases mean the prompt is accounted for and should be removed from pending
      if (existingMessage || isPending) {
        const newPendingUserMessages = new Set(userMessageClearedState.pendingUserMessages || []);
        newPendingUserMessages.delete(promptForComparison);
        return { ...userMessageClearedState, pendingUserMessages: newPendingUserMessages };
      }
      return userMessageClearedState;
    }

    case 'message_update': {
      const delta = event.content.delta;
      
      // Check if this is a new turn - if so, we must create a new assistant message
      // Only consider it a new turn if both currentTurnId and event.turnId are set and different
      const isNewTurn = state.currentTurnId != null && 
                        event.turnId != null && 
                        state.currentTurnId !== event.turnId;
      
      // Check if this is the first message update for this turn (no active assistant message)
      const isFirstUpdateForTurn = state.currentTurnId == event.turnId && 
                                   !state.currentAssistantMessageId;
      
      // Determine the target assistant message for this delta
      // Use currentAssistantMessageId if set AND this is not a new turn AND not first update
      let targetMessageId = !isNewTurn && !isFirstUpdateForTurn && state.currentAssistantMessageId 
        ? state.currentAssistantMessageId
        : undefined;
      let targetMessage = targetMessageId 
        ? state.messages.find(m => m.id === targetMessageId)
        : null;
      
      // FALLBACK RULE:
      // After snapshot rehydration, we MUST NOT fall back to findLastMessageByRole('assistant')
      // because that can jump across tool boundaries and corrupt segment ordering.
      // The snapshot tail-aware continuation already set currentAssistantMessageId correctly.
      // Only allow fallback for legacy non-snapshot paths, and even then, only if:
      // - NOT a new turn AND NOT first update for turn AND no snapshot tail kind set
      if (!targetMessage && !isNewTurn && !isFirstUpdateForTurn && !state.snapshotTailKind) {
        // Legacy fallback: only for pre-snapshot scenarios
        targetMessage = findLastMessageByRole(state.messages, 'assistant');
      }
      
      // Handle thinking delta separately
      if (event.content.type === 'thinking_delta') {
        if (!targetMessage) {
          // Create new assistant message for thinking
          const assistantMessage: InternalMessage = {
            id: generateId(),
            role: 'assistant',
            content: [],
            thinking: delta,
            createdAt: new Date(event.timestamp),
            isStreaming: true,
          };
          return {
            ...state,
            currentAssistantMessageId: assistantMessage.id,
            currentTurnId: event.turnId,  // Update turn ID
            snapshotTailKind: undefined,  // Clear snapshot tail kind after first live delta
            messages: [...state.messages, assistantMessage],
          };
        }
        
        const updatedMessage = {
          ...targetMessage,
          thinking: (targetMessage.thinking || '') + delta,
          isStreaming: true,
        };
        const messageIndex = state.messages.findIndex((m) => m.id === targetMessage.id);
        if (messageIndex >= 0) {
          const newMessages = [...state.messages];
          newMessages[messageIndex] = updatedMessage;
          return { ...state, messages: newMessages };
        }
        return state;
      }
      
      // Handle regular text delta
      if (!targetMessage) {
        // Create new assistant message for text
        const assistantMessage = createStreamingMessage('assistant', delta);
        return {
          ...state,
          currentAssistantMessageId: assistantMessage.id,
          currentTurnId: event.turnId,  // Update turn ID
          snapshotTailKind: undefined,  // Clear snapshot tail kind after first live delta
          messages: [...state.messages, assistantMessage],
        };
      }

      const updatedMessage = appendTextToMessage(targetMessage, delta);
      const messageIndex = state.messages.findIndex((m) => m.id === targetMessage.id);
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
      // Clear the current assistant message ID and turn ID for the next turn
      return { ...state, isProcessing: false, messages: newMessages, currentAssistantMessageId: undefined, currentTurnId: undefined };
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
