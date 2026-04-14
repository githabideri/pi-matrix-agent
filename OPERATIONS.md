# pi-matrix-agent Operations Guide

## Quick Reference

### Start (Single Instance)
```bash
cd ~/homelab/pi-matrix-agent
./scripts/run-bot.sh
```

### Start with Public URL (for correct `!control` output)
```bash
export CONTROL_PUBLIC_URL=https://<your-node>.<tailnet>.ts.net
cd ~/homelab/pi-matrix-agent
./scripts/run-bot.sh
```

### Stop All Instances
```bash
pkill -f "node dist/index.js"
pkill -f "tsx.*src/index.ts"
```

### Check Running Instances
```bash
ps aux | grep -E "node.*dist/index|node.*tsx.*src/index" | grep -v grep
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    pi-matrix-agent                           │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────┐ │
│  │ MatrixTransport │  │ ControlServer   │  │PiBackend    │ │
│  │ (Bot)           │  │ (Web UI/API)    │  │(Sessions)   │ │
│  └────────┬────────┘  └────────┬────────┘  └──────┬──────┘ │
│           │                    │                   │        │
│           └──────────┬─────────┴───────────┬───────┘        │
│                      │                     │                │
│              ┌───────▼───────┐   ┌────────▼──────┐         │
│              │  Router       │   │  Express App  │         │
│              │  (Commands)   │   │  (Routes)     │         │
│              └───────────────┘   └───────────────┘         │
└─────────────────────────────────────────────────────────────┘
        │                           │
        ▼                           ▼
   Matrix HS                  Port 9000
   (dendrite)                (Control UI)
```

---

## Common Issues

### Duplicate Bot Responses

**Symptom:** `!control` returns multiple responses with mixed old/new formats.

**Cause:** Multiple bot processes running simultaneously.

**Diagnosis:**
```bash
ps aux | grep -E "node.*dist/index|node.*tsx.*src/index" | grep -v grep
```

**Fix:**
```bash
# Stop all instances
pkill -f "node dist/index.js"
pkill -f "tsx.*src/index.ts"

# Start single instance
export CONTROL_PUBLIC_URL=https://<your-node>.<tailnet>.ts.net
cd ~/homelab/pi-matrix-agent
./scripts/run-bot.sh
```

### `!control` Shows Localhost URLs

**Symptom:** `!control` returns `http://localhost:9000/...` instead of public URL.

**Cause:** `CONTROL_PUBLIC_URL` not set at startup.

**Fix:**
```bash
export CONTROL_PUBLIC_URL=https://<your-node>.<tailnet>.ts.net
pkill -f "node dist/index.js"
./scripts/run-bot.sh
```

---

## Command Reference

| Command | Description |
|---------|-------------|
| `!ping` | Check if bot is alive |
| `!status` | Show bot status |
| `!help` | Show command help |
| `!reset` | Clear conversation memory |
| `!control` | Get control URL for this room |

---

## Web UI Access

### Assistant UI (New)
```
https://<your-node>.<tailnet>.ts.net/spike?room=<roomKey>
```

### Original Room View (Fallback)
```
https://<your-node>.<tailnet>.ts.net/room/<roomKey>
```

---

## Tailscale Serve Setup

```bash
./scripts/setup-serve.sh 9000 127.0.0.1
```

---

## Process Management

### Production Mode (Recommended)
```bash
# Build first
npm run build

# Run with canonical script
./scripts/run-bot.sh
```

### Development Mode
```bash
# Auto-reload on changes
npm run dev
```

### Background Execution
```bash
# Run in background with logging
nohup ./scripts/run-bot.sh > /tmp/pi-matrix-agent.log 2>&1 &
```

---

## Verification Checklist

After restart:

1. **Single process running:**
   ```bash
   ps aux | grep "node dist/index.js" | wc -l  # Should be 1
   ```

2. **Control server listening:**
   ```bash
   ss -tlnp | grep 9000  # Should show one LISTEN on 127.0.0.1:9000
   ```

3. **Matrix connected:**
   - Check logs for "Matrix bot started"
   - Send `!ping` in Matrix, should get single "pong" response

4. **No duplicate responses:**
   - Send `!control` in Matrix
   - Should get exactly ONE response
   - Format: `Assistant UI: https://.../spike?room=<roomKey>`
