# Assistant UI Spike

## Overview

This spike explores integrating [assistant-ui](https://www.assistant-ui.com/) as a React frontend for `pi-matrix-agent`, using the `ExternalStoreRuntime` pattern to maintain server-authoritative state.

**Status**: ✅ Complete and functional. Accessible at `/spike?room=<roomKey>`.

## Design Decisions

### Why ExternalStoreRuntime?

The `ExternalStoreRuntime` was chosen over assistant-ui's default runtime because:

1. **Server remains authoritative**: All session state, transcripts, model configuration, and provider settings live on the server. The browser only maintains a synchronized view model.

2. **No browser-owned sessions**: The runtime does not create or manage independent browser-side agent sessions. All prompts flow through the server.

3. **Matches existing architecture**: `pi-matrix-agent` already has a control server managing room/session lifecycle, transcripts, and live event streams. The ExternalStoreRuntime plugs into this existing infrastructure.

4. **Custom message conversion**: The spike implements explicit conversion from server transcript format to assistant-ui message format, keeping the mapping visible and testable.

5. **Streaming support**: The runtime supports progressive updates from SSE events, matching the existing WebUI event schema.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (Assistant UI)                    │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              External Store (Adapter State)          │   │
│  │  - messages: InternalMessage[]                      │   │
│  │  - isProcessing: boolean                            │   │
│  │  - sessionId: string                                │   │
│  │  - activeToolCalls: Map                             │   │
│  └────────────────┬────────────────────────────────────┘   │
│                   │                                         │
│                   ▼                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          useExternalStoreRuntime(store)              │   │
│  │  - messages: from store                              │   │
│  │  - isRunning: from store.isProcessing                │   │
│  │  - onNew: submit to server                          │   │
│  │  - convertMessage: InternalMessage → ThreadMessageLike│  │
│  └────────────────┬────────────────────────────────────┘   │
│                   │                                         │
│                   ▼                                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Thread.Root config={{ runtime }}           │   │
│  │  ┌───────────────────────────────────────────────┐   │   │
│  │  │  Thread.Viewport                              │   │   │
│  │  │  ┌─────────────────────────────────────────┐   │   │   │
│  │  │  │  ThreadPrimitive.Empty                  │   │   │   │
│  │  │  │  Thread.Messages                        │   │   │   │
│  │  │  └─────────────────────────────────────────┘   │   │   │
│  │  └───────────────────────────────────────────────┘   │   │
│  │  ┌───────────────────────────────────────────────┐   │   │
│  │  │  Thread.ViewportFooter                        │   │   │
│  │  │  ┌─────────────────────────────────────────┐   │   │   │
│  │  │  │  Composer                               │   │   │   │
│  │  │  └─────────────────────────────────────────┘   │   │   │
│  │  └───────────────────────────────────────────────┘   │   │
│  │  Thread.ScrollToBottom                               │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          │ HTTP/SSE
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Pi-Matrix-Agent Control Server                  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ /api/live/   │  │ /api/live/   │  │ /api/live/rooms/ │  │
│  │ rooms/:key   │  │ transcript   │  │ :key/events (SSE)│  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ /api/live/   │  │ /api/archive │  │  Room State      │  │
│  │ rooms/:key/  │  │ /rooms/:key/ │  │  Manager         │  │
│  │ prompt       │  │ sessions     │  │                  │  │
│  └──────┬───────┘  └──────────────┘  └──────────────────┘  │
│         │                                                  │
│         │ Web UI → Matrix mirroring                        │
│         ▼                                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  MatrixTransport (mirrors [WebUI] prompts)           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Web UI → Matrix Mirroring

Prompts submitted via the web UI are mirrored to the Matrix room:

1. **User submits prompt via web UI** → `POST /api/live/rooms/:roomKey/prompt`
2. **Control server mirrors to Matrix** as `[WebUI] <prompt text>`
3. **Agent processes prompt** (single execution)
4. **Final response posted to Matrix** (not streamed)
5. **Web UI receives SSE/live updates** as before

**Loop prevention**: The bot ignores its own messages (`event.sender === this.userId`), so mirrored messages don't trigger duplicate runs.

## Data Flow

### Initial Load

1. User enters room key (or uses default)
2. Frontend fetches room details from `GET /api/live/rooms/:roomKey`
3. Frontend fetches transcript from `GET /api/live/rooms/:roomKey/transcript`
4. Transcript items are converted to InternalMessage via `transcriptToMessages()`
5. Messages are loaded into the external store
6. `useExternalStoreRuntime` reads from store and provides runtime to Thread
7. Thread components render from runtime state

### Live Updates (SSE)

1. Frontend opens SSE connection to `GET /api/live/rooms/:roomKey/events`
2. Server emits normalized WebUI events:
   - `session_connected`: SSE connection established
   - `turn_start`: User prompt received
   - `message_update`: Text/thinking content delta
   - `tool_start`: Tool execution begins
   - `tool_end`: Tool execution completes
   - `turn_end`: Response complete
   - `state_change`: Processing state changes
3. Each event is processed by `processEvent()` in the adapter
4. Updated state is applied to the external store
5. Store notifies listeners, causing re-render
6. Thread components update from runtime state

### Prompt Submission

1. User types prompt and submits via Composer
2. `onNew` handler extracts text and calls `submitPrompt(roomKey, text)`
3. Server returns `{ accepted: true, turnId, ... }` immediately (non-blocking)
4. Actual response comes through SSE events
5. User message appears from `turn_start` event's `promptPreview`
6. Assistant response streams in via `message_update` events

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|--------|
| GET | `/api/live/rooms/:roomKey` | Fetch room details (sessionId, isProcessing, etc.) |
| GET | `/api/live/rooms/:roomKey/transcript` | Fetch historical transcript |
| POST | `/api/live/rooms/:roomKey/prompt` | Submit new prompt (non-blocking) |
| GET | `/api/live/rooms/:roomKey/events` | SSE stream of live events |

## Message Conversion

### Transcript Items → InternalMessage

```typescript
// User message
{ kind: 'user_message', text: 'Hello' }
  ↓
{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }

// Assistant message
{ kind: 'assistant_message', text: 'Hi there!' }
  ↓
{ role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] }

// Tool call
{ kind: 'tool_start', toolName: 'bash', ... }
  ↓
{ role: 'tool', name: 'bash', content: '<html>...</html>' }
```

### InternalMessage → ThreadMessageLike (via convertMessage)

```typescript
// User message
{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }
  ↓
{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }

// Assistant message
{ role: 'assistant', content: [{ type: 'text', text: 'Hi' }] }
  ↓
{ role: 'assistant', content: [{ type: 'text', text: 'Hi' }] }

// Tool message - rendered as assistant with HTML
{ role: 'tool', content: '<span>Tool...</span>' }
  ↓
{ role: 'assistant', content: [{ type: 'text', text: '<span>Tool...</span>' }]
```

### SSE Events → Store Updates

```typescript
// turn_start with promptPreview
{ type: 'turn_start', promptPreview: 'Hello' }
  ↓
Adds user message to store, sets isProcessing = true

// message_update (text_delta)
{ type: 'message_update', content: { type: 'text_delta', delta: 'Hi' } }
  ↓
Appends 'Hi' to last assistant message

// tool_start
{ type: 'tool_start', toolName: 'bash', ... }
  ↓
Adds tool call message, tracks in activeToolCalls

// tool_end
{ type: 'tool_end', toolName: 'bash', success: true }
  ↓
Adds tool result message, removes from activeToolCalls

// turn_end
{ type: 'turn_end', success: true }
  ↓
Sets isProcessing = false
```

## Files Created/Modified

### Frontend Files

```
frontend/assistant-ui-spike/
├── package.json          # Dependencies
├── tsconfig.json         # TypeScript config
├── vite.config.ts        # Vite config with proxy
├── vitest.config.ts      # Test config
├── index.html            # Entry point
└── src/
    ├── main.tsx          # React entry, room selector
    ├── ChatInterface.tsx # Main chat component
    ├── types.ts          # Server API types
    ├── api.ts            # API client functions
    ├── adapter.ts        # Transcript/SSE conversion
    ├── adapter.test.ts   # Unit tests
    └── styles.css        # Styling
```

### Server Files Modified

```
src/
└── control-server.ts     # Added /spike routes
```

### Documentation

```
docs/
└── assistant-ui-spike.md # This file
```

## Running the Spike

### Prerequisites

```bash
cd /root/homelab/pi-matrix-agent/frontend/assistant-ui-spike
npm install
```

### Development Mode

1. Start the control server:
```bash
cd /root/homelab/pi-matrix-agent
npm run dev
```

2. Start the spike frontend:
```bash
cd frontend/assistant-ui-spike
npm run dev
```

3. Open `http://localhost:3001` in browser

### Production Mode

```bash
cd /root/homelab/pi-matrix-agent/frontend/assistant-ui-spike
npm run build

# Then start control server which serves both frontends
cd /root/homelab/pi-matrix-agent
npm run start
```

Access the spike at `http://localhost:9000/spike`

## Running Tests

```bash
cd /root/homelab/pi-matrix-agent/frontend/assistant-ui-spike
npm test
```

## Packages Used

| Package | Version | Purpose |
|---------|---------|--------|
| `@assistant-ui/react` | ^0.7.8 | Core assistant-ui library |
| `@assistant-ui/react-markdown` | ^0.7.8 | Markdown rendering |
| `react` | ^18.2.0 | React |
| `react-dom` | ^18.2.0 | React DOM |
| `zustand` | ^4.5.0 | State management (assistant-ui dependency) |
| `vite` | ^5.0.0 | Build tool |
| `typescript` | ^5.3.0 | Type checking |

## Assistant-UI Components Used

| Component | Purpose |
|-----------|--------|
| `useExternalStoreRuntime` | Creates runtime from external store |
| `Thread.Root` | Root container with config |
| `Thread.Viewport` | Scrollable message area |
| `Thread.Messages` | Renders all messages |
| `Thread.ViewportFooter` | Footer for composer |
| `Thread.ScrollToBottom` | Scroll to bottom button |
| `ThreadPrimitive.Empty` | Empty state placeholder |
| `Composer` | Input for new messages |

## Known Limitations

1. **Single room only**: The spike assumes one room key. Multi-room UX is not implemented.

2. **Basic styling**: Visual styling is minimal and functional, not polished.

3. **No authentication**: The spike assumes the control server is trusted and accessible.

4. **Simplified tool display**: Tool calls/results are shown as HTML snippets, not rich interactive components.

5. **No thinking visualization**: Thinking content is prepended to messages, not shown in a collapsible section.

6. **No archive browsing**: The spike only connects to live rooms, not archived sessions.

7. **Room key entry**: Users must manually enter or know the room key.

8. **Web UI → Matrix mirroring**: Prompts from web UI are mirrored to Matrix with `[WebUI]` prefix. The original user identity is not preserved (no Matrix auth).

## Phase 2 Migration Considerations

A full migration from the current operator UI to assistant-ui would require:

1. **Multi-room support**: Room list, navigation, room creation

2. **Archive integration**: Browse and load archived sessions

3. **Rich tool display**: Interactive tool call/result components

4. **Thinking visualization**: Collapsible reasoning sections

5. **Context display**: Show working directory, model, tools available

6. **Authentication**: Secure access to control server

7. **Error handling**: Graceful handling of connection issues, timeouts

8. **Styling**: Consistent visual design, responsive layout

9. **Performance**: Virtual scrolling for long transcripts, pagination

10. **Testing**: E2E tests for full user flows

## Verification Checklist

- [x] Frontend app created with Vite + React + TypeScript
- [x] Uses `useExternalStoreRuntime` from assistant-ui
- [x] Loads initial transcript from server
- [x] Subscribes to SSE events for live updates
- [x] Submits prompts to server via POST
- [x] Shows streaming/progressive updates
- [x] Server remains source of truth
- [x] Unit tests for adapter layer
- [x] Build succeeds
- [x] Documentation

## Design Principle

> **The browser never owns sessions, config, providers, or state.**
>
> On page load, all state comes from the server. On reload, the UI reconstructs from server data. The external store is a synchronized view model, not a source of truth.
