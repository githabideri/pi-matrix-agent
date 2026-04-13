# Pi WebUI Integration Design

## Overview

This document describes the Phase 1 groundwork for integrating a Pi-style server-backed WebUI into `pi-matrix-agent`. The design ensures that the server remains the authoritative source of truth for all session state, while providing a clean contract for a future rich frontend.

## Architecture Principle: Server as Source of Truth

### Why the browser is NOT the source of truth

1. **Session ownership**: Matrix rooms own their sessions. The bot manages room sessions, not the browser.
2. **Tool execution**: Tools must run on the server with proper permissions and context.
3. **Model/provider selection**: Configuration lives on the server, not in the browser.
4. **Transcript persistence**: Sessions are persisted server-side in JSONL format.
5. **Live event stream**: The server owns the inference loop and emits events.
6. **Archives**: All historical sessions are server-side files.

### How `pi-matrix-agent` remains authoritative

- **Session lifecycle**: `PiSessionBackend` creates/manages/destroys sessions
- **Prompt submission**: All prompts go through the server via `backend.prompt()`
- **Event emission**: Server emits normalized SSE events to connected clients
- **Transcript storage**: All conversation history is server-side JSONL
- **State caching**: `RoomStateManager` holds authoritative live room state

## Normalized SSE Event Schema

### Event Types

| Event | Description | Maps from legacy |
|-------|-------------|------------------|
| `session_connected` | SSE connection established | - |
| `turn_start` | User prompt received | `run_start` |
| `message_update` | Text/thinking content delta | `text_delta` |
| `tool_start` | Tool execution begins | - |
| `tool_end` | Tool execution completes | - |
| `turn_end` | Response complete | `run_end` |
| `state_change` | Processing state changes | - |

### Event Shapes

```typescript
// Common metadata
interface EventMetadata {
  type: string;
  timestamp: string;
  roomId: string;      // Matrix room ID
  roomKey: string;     // Hashed room key
}

// Turn lifecycle
interface TurnStartEvent extends EventMetadata {
  type: "turn_start";
  turnId: string;
  sessionId: string;
  promptPreview?: string;
}

interface TurnEndEvent extends EventMetadata {
  type: "turn_end";
  turnId: string;
  sessionId: string;
  success: boolean;
}

// Message content
interface MessageUpdateEvent extends EventMetadata {
  type: "message_update";
  turnId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: {
    type: "text_delta" | "thinking_delta";
    delta: string;
  };
}

// Tool lifecycle
interface ToolStartEvent extends EventMetadata {
  type: "tool_start";
  toolCallId: string;
  turnId: string;
  sessionId: string;
  toolName: string;
  arguments?: string;
}

interface ToolEndEvent extends EventMetadata {
  type: "tool_end";
  toolCallId: string;
  turnId: string;
  sessionId: string;
  toolName: string;
  success: boolean;
  result?: string;
  error?: string;
}

// State changes
interface StateChangeEvent extends EventMetadata {
  type: "state_change";
  sessionId: string;
  changeType: "processing_start" | "processing_end" | "model_change" | "thinking_level_change" | "session_reset";
  state?: {
    isProcessing?: boolean;
    model?: string;
    thinkingLevel?: string;
  };
}
```

### Event Flow Example

```
User connects to SSE
  └─> session_connected

User submits prompt via POST /prompt
  └─> turn_start
  └─> message_update (text_delta)
  └─> tool_start (bash)
  └─> tool_end (bash, success)
  └─> message_update (text_delta)
  └─> turn_end

User disconnects
```

## Prompt Submission Endpoint

### Endpoint

```
POST /api/live/rooms/:roomKey/prompt
Content-Type: application/json

{
  "text": "user prompt here"
}
```

### Response (non-blocking)

```json
{
  "accepted": true,
  "roomKey": "abc123",
  "roomId": "!room:example.com",
  "sessionId": "session-uuid",
  "turnId": "turn-uuid",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Design Notes

- **Non-blocking**: Returns immediately without waiting for inference
- **Fire-and-forget**: Actual response comes through SSE events
- **Validates room**: Returns 404 for unknown room keys
- **Validates input**: Returns 400 for missing/invalid `text` field

### Usage Pattern

```javascript
// 1. Connect to SSE first
const es = new EventSource('/api/live/rooms/abc123/events');
es.onmessage = (e) => {
  const event = JSON.parse(e.data);
  // Handle events (turn_start, message_update, turn_end, etc.)
};

// 2. Submit prompt (non-blocking)
fetch('/api/live/rooms/abc123/prompt', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'hello' })
});

// 3. Response arrives via SSE, not via POST response
```

## Transcript API Contract

### Endpoint

```
GET /api/live/rooms/:roomKey/transcript
```

### Response

```json
{
  "roomId": "!room:example.com",
  "roomKey": "abc123",
  "sessionId": "session-uuid",
  "sessionFile": "/path/to/session.jsonl",
  "relativeSessionPath": "room-abc123/session.jsonl",
  "items": [
    {
      "kind": "user_message",
      "id": "msg-uuid",
      "text": "hello",
      "timestamp": "2024-01-01T00:00:00.000Z"
    },
    {
      "kind": "assistant_message",
      "id": "msg-uuid",
      "text": "hi there!",
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Item Kinds

| Kind | Description |
|------|-------------|
| `user_message` | User prompt |
| `assistant_message` | Assistant response |
| `thinking` | Reasoning/thinking content |
| `tool_start` | Tool invocation |
| `tool_end` | Tool result |

## Implementation Files

### Backend

| File | Purpose |
|------|---------|
| `src/webui-types.ts` | Event type definitions |
| `src/webui-emitter.ts` | SSE event emitter |
| `src/routes/live.ts` | Updated with prompt endpoint and new SSE handler |

### Frontend

| File | Purpose |
|------|---------|
| `frontend/operator-ui/src/types.ts` | Updated event types with backward compatibility |
| `frontend/operator-ui/src/api.ts` | Added `submitPrompt()` function |
| `frontend/operator-ui/src/room.ts` | Updated event handling for new schema |

## Backward Compatibility

The new schema maintains backward compatibility:

1. **Legacy event names**: `run_start`, `run_end`, `text_delta` are still recognized
2. **Frontend handling**: Updated to handle both old and new formats
3. **Gradual migration**: Old clients continue to work

## Phase 2: Frontend Work

Phase 1 provides the backend groundwork. Phase 2 will build the actual rich UI:

1. **Chat interface**: Real chat UI with proper message threading
2. **Prompt input**: Text input with submit button
3. **Live streaming**: Progressive rendering of assistant responses
4. **Tool visualization**: Visual indicators for tool execution
5. **Thinking display**: Collapsible thinking/reasoning sections
6. **Archive navigation**: Browse and load archived sessions
7. **Styling**: Pi-style visual design

## Verification

### Build
```bash
cd ~/homelab/pi-matrix-agent
npm run build
```

### Type Check
```bash
npm run check
```

### Tests
```bash
npm test
```

### API Verification

```bash
# 1. Check live rooms
GET /api/live/rooms

# 2. Get room details
GET /api/live/rooms/:roomKey

# 3. Submit prompt (non-blocking)
POST /api/live/rooms/:roomKey/prompt
{
  "text": "hello"
}

# 4. Get transcript
GET /api/live/rooms/:roomKey/transcript

# 5. Connect to SSE
GET /api/live/rooms/:roomKey/events
```

## Summary

Phase 1 delivers:

- ✅ Normalized SSE event schema
- ✅ Prompt submission endpoint (non-blocking)
- ✅ Updated transcript API
- ✅ Backward compatibility
- ✅ Design documentation

Phase 2 will build the actual rich UI on top of this contract.
