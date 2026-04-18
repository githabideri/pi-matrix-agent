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
- **Control commands**: `!ping`, `!status`, `!help`, `!reset`, `!control`, `!model`
- **Per-room isolation**: Each Matrix room has independent context
- **Sender allowlists**: Only authorized users can trigger responses
- **Typing feedback**: "is typing..." indicator during processing
- **Web UI mirroring**: Prompts from the web UI are mirrored to Matrix with `[WebUI]` prefix

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

**EJS Operator Pages:**

| Route | Description |
|-------|-------------|
| `/room/:roomKey` | Live operator page |
| `/room/:roomKey/context` | Context manifest page |
| `/room/:roomKey/archive` | Archive list |
| `/room/:roomKey/archive/:sessionId` | Archived transcript view |

**Assistant UI Spike:**

| Route | Description |
|-------|-------------|
| `/spike` | Modern React-based chat interface |
| `/spike?room=:roomKey` | Chat interface with room pre-selected |

### Tailscale Integration

The control server is exposed via **Tailscale Serve** for secure tailnet-only access:

```bash
# Set up Tailscale Serve
sudo tailscale serve --bg localhost:9000

# Access WebUI via: https://<node>.<tailnet>.ts.net/room/<roomKey>
# Access Assistant UI Spike via: https://<node>.<tailnet>.ts.net/spike?room=<roomKey>
```

The `!control` command returns the Tailscale Serve URL for the current room, pointing to the Assistant UI Spike (`/spike?room=<roomKey>`).

## Known Limitations

### Control Plane During Inference

The control server runs in the same Node.js process as the SDK. During active inference, **async operations may be blocked** because the SDK performs blocking I/O:

- **Endpoints that work during inference** (read from in-memory state):
  - `GET /` (health check)
  - `GET /api/live/rooms` (list live rooms)
  - `GET /api/live/rooms/:roomKey` (room details)
  - `GET /api/live/rooms/:roomKey/context` (context manifest)

- **Endpoints that may timeout during inference** (require async file I/O):
  - `GET /api/live/rooms/:roomKey/transcript` (returns empty while processing)
  - `GET /room/:roomKey` (Web UI page)

**Workaround**: Poll for `isProcessing: false` before making requests that require file I/O.

### Web UI → Matrix Mirroring

Prompts submitted via the web UI are mirrored to the Matrix room with a `[WebUI]` prefix. The bot ignores its own messages (loop prevention), so mirrored messages don't trigger duplicate runs. The final response is also posted to Matrix once complete.

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
│  - **Ignores own messages (loop prevention)**                  │
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
│  - **Web UI → Matrix mirroring**                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Web UI                                   │
│  - EJS operator pages (/room/:roomKey)                         │
│  - Assistant UI Spike (/spike?room=:roomKey)                   │
│  - Prompts are mirrored to Matrix with [WebUI] prefix          │
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
  "storageFile": "./storage/bot.json",
  "sessionBaseDir": "./sessions",
  "workingDirectory": "/path/to/working/dir",
  "agentDir": "/path/to/agent/dir",
  "controlPublicUrl": "https://your-tailscale-serve-url",
  "controlAuthUser": "your-username",
  "controlAuthPassword": "your-password"
}
```

Key fields:
- `agentDir`: Dedicated Pi agent directory for bot isolation (required)
- `sessionBaseDir`: Directory for per-room session files
- `workingDirectory`: Working directory for tool operations
- `controlPublicUrl`: Tailscale Serve URL for `!control` command (optional - can also use `CONTROL_PUBLIC_URL` env var)
- `controlAuthUser`: Username for control-plane HTTP Basic Auth (optional)
- `controlAuthPassword`: Password for control-plane HTTP Basic Auth (optional)

### Control-Plane Authentication

HTTP Basic Auth can be optionally enabled for the control-plane API and WebUI routes. The health check route (`/`) remains open for local health checks.

**Configuration methods (in order of precedence):**

1. **Environment variables (preferred for secrets):**
   - `CONTROL_AUTH_USER`: Username for authentication
   - `CONTROL_AUTH_PASSWORD`: Password for authentication

2. **Config file:**
   - `controlAuthUser`: Username for authentication
   - `controlAuthPassword`: Password for authentication

**Behavior:**
- Environment variables take precedence over config file values
- Both username and password must be set for authentication to be enabled
- If only one is set, a warning is logged and auth is disabled
- If neither is set, auth is disabled (default behavior)
- The `/` health check route remains open
- Protected routes: `/api`, `/room`, `/app`, `/spike`, `/static`

**Example with environment variables:**

```bash
CONTROL_AUTH_USER="admin" CONTROL_AUTH_PASSWORD="secret123" ./scripts/run-bot.sh
```

**Example with config file:**

```json
{
  "controlAuthUser": "admin",
  "controlAuthPassword": "secret123"
}
```

**Verification:**

```bash
# Health check (no auth required)
curl http://127.0.0.1:9000/

# API route (requires auth)
curl http://127.0.0.1:9000/api/live/rooms           # Returns 401
curl -u admin:secret123 http://127.0.0.1:9000/api/live/rooms  # Works
```

### Running

**Production: Use systemd service (recommended)**

For production deployment, install the systemd service:

```bash
# One-time installation
sudo ./scripts/install-service.sh install

# Edit environment file if needed
sudo nano /etc/pi-matrix-agent/env.conf

# Start and enable on boot
sudo systemctl enable pi-matrix-agent
sudo systemctl start pi-matrix-agent
```

**Development: Use the startup script**

```bash
# Start with CONTROL_PUBLIC_URL set (recommended)
CONTROL_PUBLIC_URL=https://your-tailscale-serve-url ./scripts/run-bot.sh

# Start without (bot works, but !control returns fallback URLs)
./scripts/run-bot.sh
```

**⚠️ Warning:** Do not run dev mode (`npm run dev`) or manual processes alongside the systemd service. This creates duplicate processes and causes unpredictable behavior. Always stop the service first:

```bash
# Stop service before running dev
sudo systemctl stop pi-matrix-agent
npm run dev  # Now safe
```

### Tailscale Serve (Optional)

```bash
# Expose control server to tailnet
sudo tailscale serve --bg localhost:9000

# Access WebUI at: https://<node>.<tailnet>.ts.net/room/<roomKey>
```

## Verification

### CI Workflow

The repository has a CI workflow that runs on every push to `main` and pull request:

- **Triggers:** Push to `main`, pull requests targeting `main`
- **Node version:** 20
- **Steps:**
  1. Install dependencies (`npm ci`)
  2. Run tests (`npm test`)
  3. Run type check and lint (`npm run check`)
  4. Build (`npm run build`)

**Run CI checks locally:**

```bash
# Fast local convenience (skips install, uses npm cache)
npm run ci:local

# Full fresh-install equivalent (simulates CI exactly)
./scripts/ci-local.sh
```

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

### Basic Commands

| Command | Description |
|---------|-------------|
| `!ping` | Check if bot is alive |
| `!status` | Show bot status |
| `!help` | Show available commands |
| `!reset` | Clear conversation memory (archives old session) |
| `!control` | Get WebUI URL for current room |

### Model Switching (Phase 2 - Room-Persistent)

| Command | Description |
|---------|-------------|
| `!model` | Show current model status |
| `!model --status` | Show current model status |
| `!model --clear` | Clear room override (fall back to global) |
| `!model qwen27` | Switch to Qwen27 model |
| `!model qwen36` | Switch to Qwen36 model |
| `!m -s` | Show status (short alias) |
| `!m -c` | Clear room override (short alias) |
| `!m q27` | Switch to Qwen27 (alias) |
| `!m q36` | Switch to Qwen36 (alias) |

**Phase 2 Features:**
- ✅ Live-room switch works without restart
- ✅ No session wipe needed
- ✅ Room-persistent: Survives service restart
- ✅ Survives `!reset`: Desired model is reapplied
- ✅ Does not contaminate global default for other rooms
- ✅ Drift detection: Status shows when active differs from desired
- ✅ Clear override: `!model --clear` removes room override

**Documentation:**
- [docs/MODEL_SWITCH.md](docs/MODEL_SWITCH.md) - Complete feature documentation
- [docs/MODEL_SWITCH_PHASE2.md](docs/MODEL_SWITCH_PHASE2.md) - Phase 2 architecture

**Shell script alternative:** `./scripts/model-switch.sh qwen27` changes the global default and restarts the service. Use this for batch configuration, not live-room control.

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
│   ├── run-bot.sh              # Manual startup script
│   ├── install-service.sh      # Install systemd service
│   ├── service-status.sh       # Health check script
│   ├── check-runtime.sh        # Runtime diagnostics
│   ├── smoke-local.sh
│   ├── smoke-control.sh
│   ├── smoke-matrix.sh
│   └── check-single-process.sh
├── deploy/
│   └── systemd/
│       ├── pi-matrix-agent.service  # Systemd unit file
│       └── env.conf.example         # Environment template
├── test/
│   └── unit/
│       └── pi-backend.test.ts
├── OPERATIONS.md          # Operations guide
└── README.md
```

### Scripts

**Development:**

| Script | Description |
|--------|-------------|
| `npm run dev` | Watch mode development |
| `npm run check` | Biome validation + TypeScript type check |
| `npm run build` | Compile to JavaScript |
| `npm test` | Run unit tests |
| `npm run verify` | Full verification (test + check + build) |
| `./scripts/run-bot.sh` | Manual startup script (development) |
| `./scripts/check-runtime.sh` | Runtime diagnostics |
| `npm run smoke:local` | Local smoke test |
| `npm run smoke:control` | Control API smoke test |
| `npm run smoke:matrix` | Matrix smoke test |
| `npm run check:single-process` | Check for duplicate processes |

**Production (Systemd):**

| Script | Description |
|--------|-------------|
| `sudo ./scripts/install-service.sh` | Install/update systemd service |
| `./scripts/service-status.sh` | Full health check |
| `systemctl status pi-matrix-agent` | Service status |
| `journalctl -u pi-matrix-agent -f` | Follow logs |

## Deployment

### Production Deployment (Systemd)

**Install the service:**

```bash
# One-time installation
sudo ./scripts/install-service.sh install

# Review/edit environment file
sudo nano /etc/pi-matrix-agent/env.conf

# Enable and start
sudo systemctl enable pi-matrix-agent
sudo systemctl start pi-matrix-agent
```

**Key files:**
- Service unit: `/etc/systemd/system/pi-matrix-agent.service`
- Environment: `/etc/pi-matrix-agent/env.conf`
- Logs: `journalctl -u pi-matrix-agent`

**Update after new build:**

```bash
npm run build
sudo systemctl restart pi-matrix-agent
```

**Status and diagnostics:**

```bash
./scripts/service-status.sh    # Full health check
systemctl status pi-matrix-agent
journalctl -u pi-matrix-agent -f
```

See [OPERATIONS.md](OPERATIONS.md) for:
- Complete operational guide
- Troubleshooting guide
- Environment configuration
- Common issues and fixes

## Matrix API Integration

For programmatic access to the Matrix bot (sending messages, testing, automation), see:
- [docs/matrix-api.md](docs/matrix-api.md) - Generic guide for Matrix Client API
- `.env.example` - Template for Matrix configuration

Example: Send a test message

```bash
# Source your Matrix credentials
source .env.matrix

# Send a message to the bot
curl -X POST "$MATRIX_HOMESERVER/_matrix/client/r0/rooms/$MATRIX_ROOM_ID/send/m.room.message" \
  -H "Authorization: Bearer $MATRIX_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"msgtype":"m.text","body":"Hello, bot!"}'
```

### Key Points

- **Source of truth**: `pi-matrix-agent/` directory (source tree)
- **Production runner**: systemd service (`pi-matrix-agent.service`)
- **Single process**: Only one bot process should run at a time
- **Control server**: Binds to `127.0.0.1` (localhost only)
- **Tailscale Serve**: For secure tailnet access (separate infrastructure)
- **Environment**: `/etc/pi-matrix-agent/env.conf` (set `CONTROL_PUBLIC_URL` here)

## Troubleshooting

### Quick Diagnostics

```bash
# Run comprehensive runtime check
./scripts/check-runtime.sh

# Check specific room (replace <roomKey>)
./scripts/check-runtime.sh <roomKey>
```

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

**Prevention:** Always use systemd for production. Never run manual processes alongside the service.

```bash
# Check for duplicates
npm run check:single-process

# Kill all manual processes (not recommended - use systemd)
pkill -f "node dist/index.js"

# Restart via systemd (canonical approach)
sudo systemctl restart pi-matrix-agent
```

**Development warning:** Stop the service before running `npm run dev`:

```bash
sudo systemctl stop pi-matrix-agent  # Stop service first
npm run dev                          # Now safe to run dev
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

### !control Returns Wrong URL

If `!control` returns `http://localhost:9000/room/...` instead of your Tailscale URL:

**Diagnosis:**

```bash
./scripts/service-status.sh control-url
```

**Fix (systemd service):**

```bash
# 1. Update environment file
sudo nano /etc/pi-matrix-agent/env.conf
# Set: CONTROL_PUBLIC_URL="https://your-node.your-tailnet.ts.net"

# 2. Restart service
sudo systemctl restart pi-matrix-agent

# 3. Verify
./scripts/service-status.sh control-url
```

**Fix (development):**

```bash
CONTROL_PUBLIC_URL=https://your-node.your-tailnet.ts.net ./scripts/run-bot.sh
```

**Important:** `CONTROL_PUBLIC_URL` must be set **at process startup** - setting it later won't affect an already-running bot.

## License

MIT License - see LICENSE file.

## Acknowledgments

- [@mariozechner/pi-coding-agent](https://github.com/mariozechner/pi-coding-agent) - Inference backend
- [matrix-bot-sdk](https://github.com/matrix-org/matrix-bot-sdk) - Matrix SDK
