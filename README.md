# pi-matrix-agent

A Matrix bot powered by the **pi coding agent** SDK, with stateful per-room sessions and a control-plane WebUI.

## Overview

This bot connects Matrix to a local LLM inference backend via the [@mariozechner/pi-coding-agent](https://github.com/mariozechner/pi-coding-agent) SDK. It provides:

- **Stateful per-room sessions**: Each Matrix room maintains its own conversation context
- **Session persistence**: Context survives bot restarts
- **Control plane API**: RESTful API for inspection and management
- **WebUI**: Read-only operator dashboard for live monitoring
- **Tailscale integration**: Secure access via Tailscale Serve

## Features

### Matrix Bot

- **Autorespond mode**: Plain text messages from allowlisted users trigger inference
- **Control commands**: `!ping`, `!status`, `!help`, `!reset`, `!control`
- **Per-room isolation**: Each Matrix room has independent context
- **Sender allowlists**: Only authorized users can trigger responses
- **Typing feedback**: "is typing..." indicator during processing

### Session Management

- **Stateful sessions**: Uses pi-coding-agent SDK with `createAgentSession`
- **Persistence**: Sessions saved to disk, resumed after restart
- **Lazy creation**: Sessions created on first prompt
- **`!reset` command**: Creates fresh session, archives previous one
- **Single-flight guard**: Prevents concurrent prompts per room

### Control Plane

**REST API** (runs on `127.0.0.1:9000` by default):

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/api/live/rooms` | GET | List all live rooms |
| `/api/live/rooms/:roomKey` | GET | Room details |
| `/api/live/rooms/:roomKey/context` | GET | Context manifest |
| `/api/live/rooms/:roomKey/reset` | POST | Reset live session |
| `/api/live/rooms/:roomKey/events` | GET | SSE event stream |
| `/api/archive/rooms/:roomKey/sessions` | GET | List archived sessions |
| `/api/archive/rooms/:roomKey/sessions/:sessionId` | GET | Session metadata |
| `/api/archive/rooms/:roomKey/sessions/:sessionId/transcript` | GET | Full transcript |

**WebUI** (same server):

| Route | Description |
|-------|-------------|
| `/room/:roomKey` | Live operator page |
| `/room/:roomKey/context` | Context manifest page |
| `/room/:roomKey/archive` | Archive list |
| `/room/:roomKey/archive/:sessionId` | Archived transcript view |

### Tailscale Integration

The control server is exposed via **Tailscale Serve** for secure tailnet-only access:

```bash
# Set up Tailscale Serve
sudo tailscale serve --bg localhost:9000

# Access via: https://<node>.<tailnet>.ts.net/room/<roomKey>
```

The `!control` command returns the Tailscale Serve URL for the current room.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Matrix Client                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     MatrixTransport                              │
│  - Connects to Matrix homeserver                                │
│  - Receives room.message events                                 │
│  - Filters by allowed rooms/users                               │
│  - Provides typing feedback                                     │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                          Router                                  │
│  - Parses commands (!ping, !reset, !control, etc.)              │
│  - Routes to control handlers or PiSessionBackend               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     PiSessionBackend                             │
│  - Per-room session management                                  │
│  - Uses pi-coding-agent SDK (createAgentSession)               │
│  - Session persistence to disk                                  │
│  - Single-flight guard                                          │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                  pi-coding-agent SDK                             │
│  - Inference backend                                            │
│  - Tool execution (read, bash, edit, write)                    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     Control Server                               │
│  - Express server on 127.0.0.1:9000                             │
│  - REST API + WebUI                                             │
│  - SSE event streaming                                          │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js >= 20
- npm
- Matrix homeserver with bot access token
- Local LLM inference endpoint (for pi-coding-agent)

### Setup

```bash
cd pi-matrix-agent
npm install
npm run build
```

### Configuration

Create `config.json`:

```json
{
  "homeserverUrl": "http://your-matrix-server:8008",
  "accessToken": "your-bot-access-token",
  "botUserId": "@bot:your-server",
  "allowedRoomIds": ["!roomid:your-server"],
  "allowedUserIds": ["@user:your-server"],
  "storageFile": "./matrix.db",
  "sessionBaseDir": "./sessions",
  "workingDirectory": "/path/to/working/dir",
  "controlPublicUrl": "https://your-tailscale-serve-url"
}
```

### Running

```bash
# Start the bot
CONTROL_PUBLIC_URL=https://your-tailscale-serve-url \
  CONFIG_FILE=./config.json \
  node dist/index.js
```

### Tailscale Serve (Optional)

```bash
# Expose control server to tailnet
sudo tailscale serve --bg localhost:9000

# Access WebUI at: https://<node>.<tailnet>.ts.net/room/<roomKey>
```

## Verification

### Local Verification (No Matrix Required)

```bash
# Run unit tests
npm test

# Type check
npm run check

# Build
npm run build

# Full verification
npm run verify
```

### Smoke Tests

```bash
# Local smoke test (starts temp server, tests API)
npm run smoke:local

# Control API smoke test (against running service)
npm run smoke:control

# Matrix smoke test (live Matrix behavior)
npm run smoke:matrix

# Check for duplicate processes
npm run check:single-process
```

## Control Commands

| Command | Description |
|---------|-------------|
| `!ping` | Check if bot is alive |
| `!status` | Show bot status |
| `!help` | Show available commands |
| `!reset` | Clear conversation memory (archives old session) |
| `!control` | Get WebUI URL for current room |

## WebUI Tour

### Live Operator Page (`/room/:roomKey`)

**Live Status Panel:**
- Room ID and key
- Current session ID
- Model being used
- Working directory
- Processing/streaming state
- Available tools

**Context Manifest:**
- Resource loader type
- Discovered context sources
- Generated timestamp

**Live Event Log:**
- SSE-powered real-time events
- Run start/end
- Text deltas
- Tool start/end

**Archive List:**
- List of archived sessions
- Click to view transcript

### Context Manifest Page (`/room/:roomKey/context`)

Full context manifest in table format with raw JSON view.

### Archive Pages

**Archive List (`/room/:roomKey/archive`):**
- All archived sessions for the room
- Session ID, timestamp, file size

**Archive View (`/room/:roomKey/archive/:sessionId`):**
- Session metadata
- Parsed transcript (user/assistant/tool messages)
- Raw JSONL view

## Session Lifecycle

```
1. User sends first prompt → Session created (lazy)
2. Subsequent prompts → Same session reused
3. User sends !reset → Old session archived, new session created
4. Bot restarts → Sessions persisted on disk, resumed
```

### Session Files

Sessions are stored in `sessionBaseDir/room-{hash}/`:

```
sessions/pi-matrix/
  room-625e66af/
    2026-04-12T14-03-14-490Z_7291b0ac-c908-48c1-814d-796a4f00cc63.jsonl  ← live
    2026-04-12T12-00-00-000Z_previous-session.jsonl                        ← archived
```

## Development

### Project Structure

```
pi-matrix-agent/
├── src/
│   ├── index.ts           # Entry point
│   ├── config.ts          # Configuration loading
│   ├── matrix.ts          # MatrixTransport class
│   ├── router.ts          # Message router
│   ├── command.ts         # Command parsing
│   ├── types.ts           # Type definitions
│   ├── pi-backend.ts      # PiSessionBackend class
│   ├── room-state.ts      # RoomStateManager class
│   ├── context-manifest.ts # Context manifest generation
│   ├── control-server.ts  # Express control server
│   └── routes/
│       ├── live.ts        # Live room API routes
│       ├── archive.ts     # Archive API routes
│       └── webui.ts       # WebUI routes
├── views/                 # EJS templates
│   ├── room.ejs
│   ├── context.ejs
│   ├── archive-list.ejs
│   └── archive-view.ejs
├── public/
│   └── css/
│       └── style.css
├── scripts/
│   ├── smoke-local.sh
│   ├── smoke-control.sh
│   ├── smoke-matrix.sh
│   └── check-single-process.sh
├── test/
│   └── unit/
│       └── pi-backend.test.ts
├── OPERATIONS.md          # Operations guide
└── README.md
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Watch mode development |
| `npm run check` | TypeScript type check |
| `npm run build` | Compile to JavaScript |
| `npm test` | Run unit tests |
| `npm run verify` | Full verification (test + check + build) |
| `npm run smoke:local` | Local smoke test |
| `npm run smoke:control` | Control API smoke test |
| `npm run smoke:matrix` | Matrix smoke test |
| `npm run check:single-process` | Check for duplicate processes |

## Deployment

See [OPERATIONS.md](OPERATIONS.md) for:
- Development workflow
- Deployment workflow
- Tailscale workflow
- Troubleshooting guide
- Verification ladder

### Key Points

- **Source of truth**: `/root/homelab/pi-matrix-agent` (source tree)
- **Deployment config**: Separate services directory (not in repo)
- **Single process**: Only one bot process should run at a time
- **Control server**: Binds to `127.0.0.1` (localhost only)
- **Tailscale Serve**: For secure tailnet access

## Troubleshooting

### Bot Not Responding

```bash
# Check if process is running
ps aux | grep "node dist/index.js"

# Check logs
tail -50 /tmp/pi-bot.log

# Check Matrix connection
curl -s http://127.0.0.1:9000/
```

### Duplicate Processes

```bash
# Check for duplicates
npm run check:single-process

# Kill all old processes
pkill -f "node dist/index.js"

# Restart cleanly
CONTROL_PUBLIC_URL=... CONFIG_FILE=... node dist/index.js
```

### WebUI Not Accessible

```bash
# Check control server
curl http://127.0.0.1:9000/

# Check Tailscale Serve
tailscale serve status

# Check Tailscale is up
tailscale status
```

## License

MIT License - see LICENSE file.

## Acknowledgments

- [@mariozechner/pi-coding-agent](https://github.com/mariozechner/pi-coding-agent) - Inference backend
- [matrix-bot-sdk](https://github.com/matrix-org/matrix-bot-sdk) - Matrix SDK
