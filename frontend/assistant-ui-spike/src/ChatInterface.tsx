/**
 * Chat Interface Component
 *
 * Uses assistant-ui's ExternalStoreRuntime for server-backed state.
 * Server remains authoritative:
 * - Transcript loaded from server on mount
 * - SSE updates stream in progressively  
 * - Prompts submitted to server via onNew
 * - Browser state is only a synchronized view
 *
 * Architecture:
 * - Keeps assistant-ui Thread structure for scrolling/composer
 * - Custom message rendering for thinking/thinking blocks
 * - Custom app shell, top bar, and states
 */

import React, { useEffect, useCallback, useRef, useSyncExternalStore, memo } from 'react';
import { 
  useExternalStoreRuntime,
  Thread,
  ThreadPrimitive,
  type AppendMessage,
} from '@assistant-ui/react';

import { getLiveRoom, getTranscript, submitPrompt, createEventStream, interruptRoom } from './api';
import {
  transcriptToMessages,
  processEvent,
  addOptimisticUserMessage,
  type AdapterState,
  type InternalMessage,
} from './adapter';
import type { WebUIEvent } from './types';
import { normalizeMessage } from './normalization';
import { createBatchedEventProcessor } from './batching';

// Custom components
import { AppShell } from './components/AppShell';
import { Composer as CustomComposer } from './components/Composer';
import { EmptyState } from './components/EmptyState';
import { LoadingState } from './components/LoadingState';
import { ErrorState } from './components/ErrorState';
import { ThinkingBlock } from './components/ThinkingBlock';
import { ToolCallCard } from './components/ToolCallCard';
import { ToolResultCard } from './components/ToolResultCard';
import { MarkdownRenderer } from './components/MarkdownRenderer';

// Simple external store - holds server-synced state
interface ExternalStore {
  getState: () => AdapterState;
  setState: (state: AdapterState) => void;
  subscribe: (listener: () => void) => () => void;
}

function createSimpleStore(initialState: AdapterState): ExternalStore {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (newState) => {
      state = newState;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

interface ChatInterfaceProps {
  roomKey: string;
}

/**
 * Custom message content renderer.
 * Handles thinking blocks, tool cards, and markdown content.
 * Memoized to prevent unnecessary re-renders during streaming.
 */
function MessageContentImpl({ 
  message, 
  isStreaming 
}: { 
  message: InternalMessage; 
  isStreaming: boolean;
}) {
  const isUser = message.role === 'user';
  
  // Get text content from message
  const getTextContent = () => {
    if (typeof message.content === 'string') return message.content;
    return message.content.filter(c => c.type === 'text').map(c => c.text).join('');
  };
  
  const textContent = getTextContent();

  // User message
  if (isUser) {
    return (
      <div className="user-message-content">
        <MarkdownRenderer text={textContent} isStreaming={isStreaming} />
      </div>
    );
  }

  // Assistant or tool message
  if (message.role === 'tool' && message.name) {
    // Use structured tool data if available
    if (message.toolCallId !== undefined && message.toolResult === undefined) {
      // Tool call (no result yet)
      return (
        <ToolCallCard 
          toolName={message.name} 
          arguments={message.toolArguments}
          toolCallId={message.toolCallId}
        />
      );
    }
    if (message.toolResult !== undefined) {
      // Tool result
      return (
        <ToolResultCard 
          toolName={message.name}
          success={message.toolSuccess ?? true}
          result={message.toolResult}
          toolCallId={message.toolCallId}
        />
      );
    }
    return <MarkdownRenderer text={textContent} isStreaming={isStreaming} />;
  }

  // Assistant message with optional thinking
  return (
    <div className="assistant-message-content">
      {message.thinking && (
        <ThinkingBlock content={message.thinking} isStreaming={isStreaming} />
      )}
      {textContent && <MarkdownRenderer text={textContent} isStreaming={isStreaming} />}
      {isStreaming && (
        <span className="streaming-cursor">▊</span>
      )}
    </div>
  );
}

export const MessageContent = memo(
  MessageContentImpl,
  (prevProps, nextProps) => {
    const prevMsg = prevProps.message;
    const nextMsg = nextProps.message;
    
    // Deep equality check for message content
    const sameRole = prevMsg.role === nextMsg.role;
    const sameId = prevMsg.id === nextMsg.id;
    
    if (!sameRole || !sameId) return false;
    
    // Check content equality
    const getFlatContent = (m: InternalMessage) => {
      if (typeof m.content === 'string') return m.content;
      return m.content.map(c => c.text).join('');
    };
    const sameContent = getFlatContent(prevMsg) === getFlatContent(nextMsg);
    const sameThinking = prevMsg.thinking === nextMsg.thinking;
    const sameStreaming = prevProps.isStreaming === nextProps.isStreaming;
    
    // Tool-specific checks
    if (prevMsg.role === 'tool') {
      return sameStreaming && 
             (prevMsg.toolCallId === nextMsg.toolCallId) &&
             (prevMsg.toolResult === nextMsg.toolResult) &&
             (prevMsg.toolArguments === nextMsg.toolArguments) &&
             (prevMsg.toolSuccess === nextMsg.toolSuccess);
    }
    
    return sameContent && sameThinking && sameStreaming;
  }
);

MessageContent.displayName = 'MessageContent';

/**
 * Custom message component that renders user/assistant messages
 * with proper avatars, bubbles, and positioning.
 * Memoized to prevent unnecessary re-renders during streaming.
 */
function CustomMessageImpl({ message, isStreaming }: { message: InternalMessage; isStreaming: boolean }) {
  const isUser = message.role === 'user';
  
  return (
    <div className={`message-row ${isUser ? 'user-row' : 'assistant-row'}`}>
      {isUser ? (
        // User message - bubble on right
        <div className="message-bubble user-bubble">
          <MessageContent message={message} isStreaming={isStreaming} />
        </div>
      ) : (
        // Assistant message - avatar on left, content on right
        <>
          <div className="message-avatar">🤖</div>
          <div className="message-content-wrapper">
            <MessageContent message={message} isStreaming={isStreaming} />
          </div>
        </>
      )}
    </div>
  );
}

export const CustomMessage = memo(
  CustomMessageImpl,
  (prevProps, nextProps) => {
    const prevMsg = prevProps.message;
    const nextMsg = nextProps.message;
    
    // Quick exit checks
    if (prevMsg.id !== nextMsg.id || prevMsg.role !== nextMsg.role || 
        prevProps.isStreaming !== nextProps.isStreaming) {
      return false;
    }
    
    // Check content equality - must reflect actual rendered content
    const getFlatContent = (m: InternalMessage) => {
      if (typeof m.content === 'string') return m.content;
      return m.content.map(c => c.text).join('');
    };
    const sameContent = getFlatContent(prevMsg) === getFlatContent(nextMsg);
    const sameThinking = prevMsg.thinking === nextMsg.thinking;
    
    // Tool-specific checks
    if (prevMsg.role === 'tool') {
      return sameContent && 
             (prevMsg.toolCallId === nextMsg.toolCallId) &&
             (prevMsg.toolResult === nextMsg.toolResult) &&
             (prevMsg.toolArguments === nextMsg.toolArguments) &&
             (prevMsg.toolSuccess === nextMsg.toolSuccess);
    }
    
    return sameContent && sameThinking;
  }
);

CustomMessage.displayName = 'CustomMessage';

/**
 * Custom messages list that renders thinking blocks separately from text.
 * This allows thinking to be collapsible and visually distinct.
 */
function CustomMessages({ messages }: { messages: InternalMessage[] }) {
  return (
    <div className="custom-messages">
      {messages.map((message) => {
        const isStreaming = message.isStreaming || false;
        return (
          <CustomMessage
            key={message.id}
            message={message}
            isStreaming={isStreaming}
          />
        );
      })}
    </div>
  );
}

export function ChatInterface({ roomKey }: ChatInterfaceProps) {
  // External store for server-synchronized state
  const storeRef = useRef<ExternalStore | null>(null);

  // Initialize store
  if (!storeRef.current) {
    storeRef.current = createSimpleStore({
      roomKey,
      sessionId: '',
      messages: [],
      isProcessing: false,
      activeToolCalls: new Map(),
      pendingUserMessages: new Set(),
    });
  }
  const store = storeRef.current;

  // Subscribe to store changes - ensures React re-renders
  const liveState = useSyncExternalStore(
    store.subscribe,
    () => store.getState(),
    () => store.getState()
  );

  // UI state for loading/errors
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [roomData, setRoomData] = React.useState<{ model?: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll behavior state
  const [isNearBottom, setIsNearBottom] = React.useState(true);
  const viewportRef = useRef<HTMLDivElement>(null);

  // Load initial transcript from server
  useEffect(() => {
    async function loadInitialData() {
      try {
        setIsLoading(true);
        setError(null);

        const [room, transcript] = await Promise.all([
          getLiveRoom(roomKey),
          getTranscript(roomKey),
        ]);

        // Convert transcript to messages and update store
        const messages = transcriptToMessages(transcript.items);

        store.setState({
          roomKey,
          sessionId: transcript.sessionId,
          messages,
          isProcessing: room.isProcessing,
          activeToolCalls: new Map(),
          pendingUserMessages: new Set(),
        });
        
        setRoomData({ model: room.model });
      } catch (err) {
        setError(`Failed to load room: ${(err as Error).message}`);
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialData();
  }, [roomKey, store]);

  // Batched event processor for SSE updates
  const batchedProcessorRef = useRef<{ processor: any; initialized: boolean } | null>(null);
  
  // Initialize batched processor
  useEffect(() => {
    if (!batchedProcessorRef.current?.initialized) {
      // Pass getState so batcher reads fresh state at flush time
      const processor = createBatchedEventProcessor(
        store.getState(),
        (newState) => store.setState(newState),
        () => store.getState()
      );
      batchedProcessorRef.current = { processor, initialized: true };
    }
    
    return () => {
      if (batchedProcessorRef.current?.processor) {
        batchedProcessorRef.current.processor.clear();
      }
    };
  }, [store]);
  
  // Set up SSE event stream with batching
  useEffect(() => {
    const cleanup = createEventStream(roomKey, (event: WebUIEvent) => {
      // Use batched processor for performance
      if (batchedProcessorRef.current?.processor) {
        batchedProcessorRef.current.processor.processEvent(event);
      } else {
        // Fallback to direct processing if batcher not ready
        const currentState = store.getState();
        const newState = processEvent(currentState, event);
        store.setState(newState);
      }
      
      // Update room data if model changes (not batched - immediate)
      if (event.type === 'state_change' && event.state?.model) {
        setRoomData({ model: event.state.model });
      }
    });

    return () => cleanup();
  }, [roomKey, store]);

  // Check scroll position - returns true if near bottom (within 150px)
  const checkIsNearBottom = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return true;
    const threshold = 150; // px
    const scrollBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    return scrollBottom < threshold;
  }, []);

  // Update isNearBottom state
  const updateIsNearBottom = useCallback(() => {
    setIsNearBottom(checkIsNearBottom());
  }, [checkIsNearBottom]);

  // Generate a content version that changes when any message content changes
  // Uses actual text content length for reliable content growth tracking
  const contentVersion = React.useMemo(() => {
    let version = 0;
    for (const msg of liveState.messages) {
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
  }, [liveState.messages]);

  // Scroll to bottom when messages change or content grows - only if user is near bottom
  useEffect(() => {
    if (isNearBottom && messagesEndRef.current) {
      // Use requestAnimationFrame to ensure DOM is updated before scrolling
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }, [contentVersion, isNearBottom]);

  // Listen to scroll events to update isNearBottom
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    
    const handleScroll = () => updateIsNearBottom();
    viewport.addEventListener('scroll', handleScroll, { passive: true });
    // Check initial position
    updateIsNearBottom();
    
    return () => viewport.removeEventListener('scroll', handleScroll);
  }, [updateIsNearBottom]);

  // Handle interrupt request
  const handleInterrupt = useCallback(async () => {
    try {
      await interruptRoom(roomKey);
      // State update comes via SSE - no need to manually update
    } catch (err) {
      console.error('Failed to interrupt:', err);
      // Don't set error state - just log it
    }
  }, [roomKey]);

  // Handle prompt submission - sends to server
  // Accepts AppendMessage type as per assistant-ui contract
  const handleOnNew = useCallback(
    async (message: AppendMessage) => {
      // Extract text from AppendMessage
      const content = message.content;
      let text = '';
      
      if (typeof content === 'string') {
        text = content;
      } else {
        text = content
          .filter(c => c.type === 'text')
          .map(c => c.text)
          .join('');
      }
      
      const trimmedText = text.trim();
      if (!trimmedText) return;

      // OPTIMISTIC UPDATE: Add user message immediately
      const { state: updatedState } = addOptimisticUserMessage(store.getState(), trimmedText);
      store.setState(updatedState);

      try {
        await submitPrompt(roomKey, trimmedText);

        // Mark as processing - response comes via SSE
        store.setState({
          ...store.getState(),
          isProcessing: true,
        });
      } catch (err) {
        setError(`Failed to submit: ${(err as Error).message}`);
        // Optionally remove optimistic message on error
        // For now, leave it as a visual indicator something was attempted
      }
    },
    [roomKey, store]
  );

  // Create ExternalStoreRuntime with proper normalization
  const runtime = useExternalStoreRuntime({
    messages: liveState.messages,
    isRunning: liveState.isProcessing,
    onNew: handleOnNew,
    // Convert InternalMessage to ThreadMessageLike using normalization layer
    convertMessage: (msg: InternalMessage) => normalizeMessage(msg),
  });

  if (isLoading) {
    return (
      <div className="full-screen-center">
        <LoadingState roomKey={roomKey} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="full-screen-center">
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  return (
    <AppShell
      roomKey={roomKey}
      sessionId={liveState.sessionId || 'N/A'}
      isProcessing={liveState.isProcessing}
      model={roomData?.model}
    >
      <div className="thread-container">
        <Thread.Root config={{ runtime }}>
          <div ref={viewportRef} className="custom-viewport">
            {liveState.messages.length === 0 ? (
              <ThreadPrimitive.Empty>
                <EmptyState />
              </ThreadPrimitive.Empty>
            ) : (
              <CustomMessages messages={liveState.messages} />
            )}
            
            {/* Processing indicator */}
            {liveState.isProcessing && (
              <div className="processing-placeholder">
                <div className="typing-indicator">
                  <span>●</span>
                  <span>●</span>
                  <span>●</span>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
          
          <Thread.ViewportFooter>
            <CustomComposer
              isProcessing={liveState.isProcessing}
              onSend={(text: string) => handleOnNew({
                role: 'user',
                content: [{ type: 'text', text }],
                parentId: null,
                sourceId: null,
                runConfig: undefined,
                attachments: [],
              })}
              onInterrupt={handleInterrupt}
            />
          </Thread.ViewportFooter>
          
          {/* Jump to bottom button - only shown when user scrolled away */}
          {!isNearBottom && (
            <Thread.ScrollToBottom>
              <button
                onClick={() => viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight, behavior: 'smooth' })}
                className="ai-ScrollToButton"
              >
                ↓ Jump to latest
              </button>
            </Thread.ScrollToBottom>
          )}
        </Thread.Root>
      </div>
    </AppShell>
  );
}

export default ChatInterface;
