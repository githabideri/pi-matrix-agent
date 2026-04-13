/**
 * Chat Interface Component
 *
 * Uses assistant-ui's ExternalStoreRuntime for server-backed state.
 * 
 * Server remains authoritative:
 * - Transcript loaded from server on mount
 * - SSE updates stream in progressively
 * - Prompts submitted to server via onNew
 * - Browser state is only a synchronized view
 * 
 * React state synchronization:
 * - Uses useSyncExternalStore to subscribe to store changes
 * - Ensures React rerenders when SSE events update the store
 */

import React, { useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import {
  useExternalStoreRuntime,
  Thread,
  Composer,
  ThreadPrimitive,
} from '@assistant-ui/react';

import { getLiveRoom, getTranscript, submitPrompt, createEventStream } from './api';
import {
  transcriptToMessages,
  processEvent,
  extractTextFromMessage,
  type AdapterState,
} from './adapter';
import type { WebUIEvent } from './types';

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
    });
  }
  const store = storeRef.current;

  // CRITICAL FIX: Use useSyncExternalStore to subscribe to store changes.
  // This ensures React rerenders when SSE events update the store.
  // Without this, useExternalStoreRuntime receives stale captured values.
  const liveState = useSyncExternalStore(
    store.subscribe,
    () => store.getState(),
    () => store.getState() // snapshotForCache - same as getSnapshot for simplicity
  );

  // UI state for loading/errors
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

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
        });
      } catch (err) {
        setError(`Failed to load room: ${(err as Error).message}`);
      } finally {
        setIsLoading(false);
      }
    }

    loadInitialData();
  }, [roomKey, store]);

  // Set up SSE event stream
  useEffect(() => {
    const cleanup = createEventStream(roomKey, (event: WebUIEvent) => {
      const currentState = store.getState();
      const newState = processEvent(currentState, event);
      store.setState(newState);
    });

    return () => cleanup();
  }, [roomKey, store]);

  // Handle prompt submission - sends to server
  const handleOnNew = useCallback(
    async (message: any) => {
      const text = extractTextFromMessage(message);

      if (!text) return;

      try {
        await submitPrompt(roomKey, text);

        // Mark as processing - response comes via SSE
        store.setState({
          ...store.getState(),
          isProcessing: true,
        });
      } catch (err) {
        setError(`Failed to submit: ${(err as Error).message}`);
      }
    },
    [roomKey, store]
  );

  // Convert our InternalMessage to ThreadMessageLike
  const convertMessage = useCallback(
    (msg: any) => {
      // Tool messages rendered as assistant messages with HTML
      if (msg.role === 'tool') {
        return {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: msg.content }],
        };
      }

      return {
        role: msg.role,
        content: Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content) }],
        id: msg.id,
        createdAt: msg.createdAt,
      };
    },
    []
  );

  // Create ExternalStoreRuntime with LIVE state from useSyncExternalStore
  // liveState is reactive and triggers rerenders when updated
  const runtime = useExternalStoreRuntime({
    messages: liveState.messages,
    isRunning: liveState.isProcessing,
    onNew: handleOnNew,
    convertMessage,
  });

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading room {roomKey}...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <p className="error-message">{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <div className="chat-interface">
      <header className="chat-header">
        <h1>Room: {roomKey}</h1>
        <div className="room-meta">
          <span>Session: {liveState.sessionId || 'N/A'}</span>
          <span className={liveState.isProcessing ? 'processing' : ''}>
            {liveState.isProcessing ? 'Processing...' : 'Ready'}
          </span>
        </div>
      </header>

      <div className="chat-container">
        <Thread.Root config={{ runtime }}>
          <Thread.Viewport>
            <ThreadPrimitive.Empty>
              <p>No messages yet. Start the conversation!</p>
            </ThreadPrimitive.Empty>
            <Thread.Messages />
          </Thread.Viewport>
          <Thread.ViewportFooter>
            <Composer />
          </Thread.ViewportFooter>
          <Thread.ScrollToBottom />
        </Thread.Root>
      </div>
    </div>
  );
}

export default ChatInterface;
