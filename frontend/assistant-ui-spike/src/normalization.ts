/**
 * Normalization Layer
 *
 * Converts internal message format to assistant-ui compatible format.
 * Separates data normalization from UI rendering.
 *
 * Content Parts:
 * - TextContentPart: { type: "text", text: string }
 * - ReasoningContentPart: { type: "reasoning", text: string }
 * - ToolCallContentPart: { type: "tool-call", toolCallId, toolName, args, argsText, result?, isError? }
 */

import type {
  TextContentPart,
  ReasoningContentPart,
  ThreadMessageLike,
} from '@assistant-ui/react';
import type { InternalMessage } from './adapter';

/**
 * Normalized content part types matching assistant-ui.
 */
export type NormalizedTextPart = TextContentPart;
export type NormalizedReasoningPart = ReasoningContentPart;

/**
 * Normalized tool call part.
 */
export interface NormalizedToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args?: Record<string, any>;
  argsText?: string;
  result?: any;
  isError?: boolean;
}

/**
 * Normalized tool result part.
 */
export interface NormalizedToolResultPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args?: Record<string, any>;
  argsText?: string;
  result: string;
  isError?: boolean;
}

/**
 * Convert an internal message to assistant-ui ThreadMessageLike.
 * This is the key normalization function used by convertMessage.
 */
export function normalizeMessage(msg: InternalMessage): ThreadMessageLike {
  // User messages - simple text content
  if (msg.role === 'user') {
    const text = typeof msg.content === 'string' ? msg.content : 
      msg.content.filter(c => c.type === 'text').map(c => c.text).join('');
    
    return {
      role: 'user' as const,
      content: [{ type: 'text', text }],
      id: msg.id,
      createdAt: msg.createdAt,
    };
  }

  // Tool messages - convert to tool-call parts
  if (msg.role === 'tool') {
    return normalizeToolMessage(msg);
  }

  // Assistant messages - may have text, reasoning, both, or neither
  return normalizeAssistantMessage(msg);
}

/**
 * Normalize assistant message with separate text and reasoning content.
 */
function normalizeAssistantMessage(msg: InternalMessage): ThreadMessageLike {
  const contentParts: Array<TextContentPart | ReasoningContentPart> = [];
  
  // Add reasoning content first (if present)
  if (msg.thinking) {
    contentParts.push({ type: 'reasoning', text: msg.thinking });
  }
  
  // Add text content (if present)
  const text = typeof msg.content === 'string' ? msg.content : 
    msg.content.filter(c => c.type === 'text').map(c => c.text).join('');
  
  if (text) {
    contentParts.push({ type: 'text', text });
  }
  
  // If no content parts, return empty assistant message
  if (contentParts.length === 0) {
    return {
      role: 'assistant' as const,
      content: [],
      id: msg.id,
      createdAt: msg.createdAt,
    };
  }
  
  return {
    role: 'assistant' as const,
    content: contentParts,
    id: msg.id,
    createdAt: msg.createdAt,
  };
}

/**
 * Normalize tool start/end messages to tool-call parts.
 * Uses structured data from InternalMessage, no regex parsing.
 */
function normalizeToolMessage(msg: InternalMessage): ThreadMessageLike {
  // Use structured tool data from InternalMessage
  if (msg.toolCallId !== undefined) {
    const toolCallPart: any = {
      type: 'tool-call',
      toolCallId: msg.toolCallId,
      toolName: msg.name,
    };

    // Add arguments if present (tool call)
    if (msg.toolArguments !== undefined) {
      toolCallPart.argsText = msg.toolArguments;
    }

    // Add result if present (tool result)
    if (msg.toolResult !== undefined) {
      toolCallPart.result = msg.toolResult;
      toolCallPart.isError = !msg.toolSuccess;
    }

    return {
      role: 'assistant' as const,
      content: [toolCallPart],
      id: msg.id,
      createdAt: msg.createdAt,
    };
  }
  
  // Fallback: render as assistant text message
  const text = typeof msg.content === 'string' ? msg.content : '';
  return {
    role: 'assistant' as const,
    content: [{ type: 'text', text }],
    id: msg.id,
    createdAt: msg.createdAt,
  };
}

/**
 * Convert a normalized tool call part to a display-friendly string.
 * Used for legacy tool card rendering.
 */
export function toolCallPartToString(part: NormalizedToolCallPart | NormalizedToolResultPart): string {
  if ('result' in part && part.result !== undefined) {
    const status = part.isError ? 'Failed' : 'Success';
    return `Tool Result: ${part.toolName} - ${status}`;
  }
  return `Tool Call: ${part.toolName}`;
}
