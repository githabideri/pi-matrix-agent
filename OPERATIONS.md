# Operations Guide

This document describes how to develop, test, build, and deploy the pi-matrix-agent.

---

## Architecture Overview

### Source of Truth

| Path | Purpose |
|------|--------|
| `pi-matrix-agent/` | **Source tree** - all development happens here |
| `services/pi-matrix-agent/` | **Config/secrets only** - systemd unit, config.json |

**Never** edit code in the services directory. All code changes go in the source tree.

### Process Model

- **Exactly one** bot process should run at any time
- Managed via systemd (production) or direct execution (development)
- Duplicate processes cause session state confusion

### Network Model

```
┌─────────────────────────────────────────────────────┐
│  Tailscale Tailnet                                   │
│  ┌──────────────────────────────────────────────┐   │
│  │  Tailscale Serve                              │   │
│  │  https://<node>.<tailnet>.ts.net:443          │   │
│  └──────────────────┬───────────────────────────┘   │
│                     │ proxy                          │
│                     ▼                                │
│  ┌──────────────────────────────────────────────┐   │
│  │  Host Machine                                 │   │
│  │                                              │   │
│  │  ┌──────────────────────────────────────┐    │   │
│  │  │  Control Server                       │    │   │
│  │  │  http://127.0.0.1:9000               │    │   │
│  │  │  (localhost only - NOT 0.0.0.0)      │    │   │
│  │  └──────────────────────────────────────┘    │   │
│  │                                              │   │
│  │  ┌──────────────────────────────────────┐    │   │
│  │  │  Matrix Bot                          │    │   │
│  │  │  - Connects to Matrix homeserver     │    │   │
│  │  │  - Uses pi-coding-agent SDK          │    │   │
│  │  └──────────────────────────────────────┘    │   │
│  │                                              │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## Development Workflow

### 1. Edit Code

Edit code **only** in `pi-matrix-agent/src/`.

```bash
cd pi-matrix-agent
# Edit files in src/
```

### 2. Run Tests Locally

```bash
# Fast unit tests (no network, no Matrix)
npm test

# Full verification (tests + type check + build)
npm run verify

# Local smoke test (starts temp server, tests API)
npm run smoke:local
```

### 3. Build

```bash
npm run build
```

### 4. Test Live

**Only after** local tests pass:

```bash
# Stop old process
pkill -f "node dist/index.js"

# Start new process (adjust paths and URLs for your environment)
CONTROL_PUBLIC_URL=<your-tailscale-serve-url> \
  CONFIG_FILE=<path-to-config.json> \
  node dist/index.js

# Or with logging to file
CONTROL_PUBLIC_URL=<your-tailscale-serve-url> \
  CONFIG_FILE=<path-to-config.json> \
  node dist/index.js > /tmp/pi-bot.log 2>&1 &
```

### 5. Run Live Smoke Tests

```bash
# Check single process
npm run check:single-process

# Test control API
npm run smoke:control

# Test live Matrix behavior (requires real Matrix room)
npm run smoke:matrix
```

---

## Deployment Workflow

### Full Deployment Sequence

```bash
cd pi-matrix-agent

# 1. Pull latest code (if on remote repo)
git pull

# 2. Install dependencies (if package.json changed)
npm install

# 3. Verify everything builds and tests pass
npm run verify

# 4. Run local smoke test
npm run smoke:local

# 5. Stop old process
pkill -f "node dist/index.js"
sleep 1

# 6. Start new process (adjust for your environment)
CONTROL_PUBLIC_URL=<your-tailscale-serve-url> \
  CONFIG_FILE=<path-to-config.json> \
  node dist/index.js > /tmp/pi-bot.log 2>&1 &

# 7. Wait for startup
sleep 3

# 8. Verify single process
npm run check:single-process

# 9. Verify control API
npm run smoke:control

# 10. Optionally test live Matrix behavior
npm run smoke:matrix
```

### Systemd (If Applicable)

If using systemd:

```bash
# Restart service
sudo systemctl restart pi-matrix-agent

# Check status
sudo systemctl status pi-matrix-agent

# View logs
sudo journalctl -u pi-matrix-agent -f
```

---

## Tailscale Workflow

### Control Server Exposure

The control server binds to `127.0.0.1:9000` (localhost only).

Tailscale Serve exposes it to the tailnet:

```bash
# Set up Tailscale Serve (run once)
sudo tailscale serve --bg localhost:9000

# Check status
tailscale serve status
```

This exposes the control server at:
- **URL**: `https://<node>.<tailnet>.ts.net/`
- **Proxies to**: `http://localhost:9000`

### Important

- **Do NOT** bind control server to `0.0.0.0`
- **Do NOT** expose via firewall rules
- **Use** Tailscale Serve for secure tailnet-only access

---

## Troubleshooting

### Bot Not Responding

```bash
# Check if process is running
ps aux | grep "node dist/index.js"

# Check logs
tail -50 /tmp/pi-bot.log

# Check Matrix connection
curl -s http://127.0.0.1:9000/ | grep status
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

### Session Issues After Reset

1. Verify single process: `npm run check:single-process`
2. Check live rooms: `curl http://127.0.0.1:9000/api/live/rooms`
3. Check logs for reset messages: `grep -i reset /tmp/pi-bot.log`

### Control Server Not Accessible via Tailscale

```bash
# Check Tailscale Serve status
tailscale serve status

# Verify control server is running
curl http://127.0.0.1:9000/

# Check Tailscale is up
tailscale status
```

---

## Verification Ladder

Run these in order after any change:

| Change Type | Required Tests |
|-------------|----------------|
| Unit test only | `npm test` |
| Type/compile change | `npm run verify` |
| API/control server change | `npm run verify && npm run smoke:local && npm run smoke:control` |
| Session/reset change | `npm run verify && npm run smoke:local && npm run smoke:control && npm run smoke:matrix` |
| Deployment | Full sequence above |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_FILE` | `./config.json` | Path to config.json |
| `CONTROL_PORT` | `9000` | Control server port |
| `CONTROL_HOST` | `127.0.0.1` | Control server bind host |
| `CONTROL_PUBLIC_URL` | `http://localhost:9000` | Public URL for !control command |

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check |
| `/api/live/rooms` | GET | List live rooms |
| `/api/live/rooms/:roomKey` | GET | Room details |
| `/api/live/rooms/:roomKey/context` | GET | Context manifest |
| `/api/live/rooms/:roomKey/reset` | POST | Reset session |
| `/api/live/rooms/:roomKey/events` | GET | SSE event stream |
| `/api/archive/rooms/:roomKey/sessions` | GET | List archived sessions |
| `/api/archive/rooms/:roomKey/sessions/:sessionId` | GET | Session metadata |
| `/api/archive/rooms/:roomKey/sessions/:sessionId/transcript` | GET | Full transcript |

---

## Configuration

### config.json Schema

```json
{
  "homeserverUrl": "http://<matrix-homeserver>:<port>",
  "accessToken": "<bot-access-token>",
  "allowedRoomIds": ["<room-id-1>", "<room-id-2>"],
  "allowedUserIds": ["@user1:<server>", "@user2:<server>"],
  "botUserId": "@bot:<server>",
  "storageFile": "<path-to-storage-file>",
  "sessionBaseDir": "<path-to-session-directory>",
  "workingDirectory": "<working-directory-for-tools>",
  "controlPublicUrl": "https://<tailscale-serve-url>"
}
```

### config.json Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `homeserverUrl` | string | Yes | Matrix homeserver URL |
| `accessToken` | string | Yes | Bot access token |
| `allowedRoomIds` | string[] | Yes | Room IDs bot can join |
| `allowedUserIds` | string[] | Yes | User IDs allowed to message bot |
| `botUserId` | string | Yes | Bot's Matrix user ID |
| `storageFile` | string | Yes | Path to Matrix storage file |
| `sessionBaseDir` | string | Yes | Directory for session files |
| `workingDirectory` | string | No | Working directory for tools (default: process.cwd()) |
| `controlPublicUrl` | string | No | Public control URL (default: http://localhost:9000) |
