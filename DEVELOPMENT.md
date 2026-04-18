# pi-matrix-agent Development Guide

This guide covers local development, testing, and operational workflows.

---

## Quick Reference

### Recommended Verification Workflow

After making changes, run this sequence:

```bash
# 1. Run unit tests
npm test

# 2. Type check and lint
npm run check

# 3. Build
npm run build

# Or run all at once:
npm run verify
```

### CI Workflow

The repo has a CI workflow that runs on every push to `main` and pull request:

- **Triggers:** Push to `main`, pull requests targeting `main`
- **Node version:** 20
- **Steps:**
  1. Install dependencies (`npm ci`)
  2. Run tests (`npm test`)
  3. Run type check and lint (`npm run check`)
  4. Build (`npm run build`)

**Run locally:**

```bash
# Fast local convenience (skips install, uses npm cache)
npm run ci:local

# Full fresh-install equivalent (simulates CI exactly)
./scripts/ci-local.sh
```

---

## Local Development vs Systemd Service

### ⚠️ Critical: Port Collision Pitfalls

**The Problem:**

The systemd service (`pi-matrix-agent`) binds to the control port (default: `9000`). If you try to run a local development process on the same port, you'll get port-in-use errors or misleading test results.

**Scenario 1: Port Already in Use**

```bash
# If systemd service is running:
sudo systemctl status pi-matrix-agent
# Service is active

# Trying to run local dev fails:
./scripts/run-bot.sh
# ERROR: Port 9000 is already in use
```

**Scenario 2: Misleading Test Results**

```bash
# You think you're testing your local changes
# But you're actually hitting the systemd service!

./scripts/run-bot.sh  # Port 9000 busy, script exits
# You don't notice and test against port 9000
curl http://127.0.0.1:9000/api/live/rooms
# Returns data from systemd service, NOT your local changes!
```

### Solutions

**Option 1: Use a Different Port for Local Testing (Recommended)**

```bash
# For manual auth/local testing, use a non-conflicting port like 9010
CONTROL_AUTH_USER=testuser \
CONTROL_AUTH_PASSWORD=testpass \
CONTROL_PORT=9010 \
ENABLE_MATRIX=false \
node dist/index.js
```

Then test against the new port:

```bash
curl http://127.0.0.1:9010/
curl -u testuser:testpass http://127.0.0.1:9010/api/live/rooms
```

**Option 2: Stop the Systemd Service Temporarily**

```bash
# Stop service before running dev
sudo systemctl stop pi-matrix-agent

# Now safe to run local dev
npm run dev
# or
./scripts/run-bot.sh

# Restart service when done
sudo systemctl start pi-matrix-agent
```

### Quick Checklist

| Goal | Command |
|------|--------|
| Check if service is running | `sudo systemctl status pi-matrix-agent` |
| Stop service for local dev | `sudo systemctl stop pi-matrix-agent` |
| Start local dev (watch mode) | `npm run dev` |
| Start local dev (single run) | `./scripts/run-bot.sh` |
| Restart service after dev | `sudo systemctl start pi-matrix-agent` |

---

## Auth Testing Workflow

### Testing Control-Plane Authentication

Use a non-conflicting port (e.g., `9010`) to avoid collisions with the systemd service.

**Start a test server:**

```bash
CONTROL_AUTH_USER=testuser \
CONTROL_AUTH_PASSWORD=testpass \
CONTROL_PORT=9010 \
ENABLE_MATRIX=false \
node dist/index.js
```

**Verification curl commands:**

```bash
# 1. Health check (always open, no auth required)
curl http://127.0.0.1:9010/
# Expected: {"status":"ok",...}

# 2. Protected route without auth (should fail)
curl http://127.0.0.1:9010/api/live/rooms
# Expected: 401 Unauthorized

# 3. Protected route with wrong credentials (should fail)
curl -u wronguser:wrongpass http://127.0.0.1:9010/api/live/rooms
# Expected: 401 Unauthorized

# 4. Protected route with correct credentials (should succeed)
curl -u testuser:testpass http://127.0.0.1:9010/api/live/rooms
# Expected: [] (empty array or room list)
```

**Full verification script:**

```bash
PORT=9010

# Health check (no auth)
echo "1. Health check (no auth required):"
curl -s http://127.0.0.1:$PORT/

# Protected without auth (expect 401)
echo ""
echo "2. Protected route without auth (expect 401):"
curl -s -w "\nHTTP Status: %{http_code}\n" http://127.0.0.1:$PORT/api/live/rooms

# Protected with correct auth (expect 200)
echo ""
echo "3. Protected route with correct auth (expect 200):"
curl -s -w "\nHTTP Status: %{http_code}\n" -u testuser:testpass http://127.0.0.1:$PORT/api/live/rooms
```

---

## Git Workflow: 3-Remotes Push

### Remote Configuration

This repository uses three remotes:

| Remote | Purpose |
|--------|--------|
| `origin` | Primary remote |
| `github` | Backup mirror on GitHub |
| `codeberg` | Backup mirror on Codeberg |

### Verify Remotes

```bash
git remote -v
```

Example output:
```
origin    git@example.com:username/repo.git (fetch)
origin    git@example.com:username/repo.git (push)
github    git@github.com:username/repo.git (fetch)
github    git@github.com:username/repo.git (push)
codeberg  git@codeberg.org:username/repo.git (fetch)
codeberg  git@codeberg.org:username/repo.git (push)
```

### Push Workflow

After committing changes, push to all three remotes:

```bash
# Push to all remotes
git push origin main
git push github main
git push codeberg main
```

### Full Commit-and-Push Sequence

```bash
# 1. Verify clean state before starting
git status --short

# 2. Make changes...

# 3. Verify what changed
git status --short
git diff --stat

# 4. Commit
git add -A
git commit -m "your commit message"

# 5. Verify commit
git log --oneline -1

# 6. Push to all remotes
git push origin main
git push github main
git push codeberg main

# 7. Verify clean state after
git status --short
```

---

## Smoke Test Expectations

### smoke-local.sh

**Purpose:** Fast regression check without live Matrix or Tailscale.

**What it tests:**
1. App boots successfully on a temp port (9100)
2. Health check endpoint (`/`) returns `{"status":"ok"}`
3. Live rooms endpoint (`/api/live/rooms`) returns valid JSON
4. Non-existent room returns 404
5. Archive endpoint returns empty array for non-existent room

**Run:**
```bash
npm run smoke:local
# or
bash ./scripts/smoke-local.sh
```

**Note:** Uses `ENABLE_MATRIX=false` to skip Matrix connection. Starts a temporary server on port 9100.

---

### smoke-control.sh

**Purpose:** Verify the running control plane on the LXC/production server.

**What it tests:**
1. Health check endpoint
2. Live rooms endpoint
3. Context manifest endpoint (for first room)
4. Room details endpoint
5. Archive endpoint
6. SSE endpoint (connection test)

**Run:**
```bash
npm run smoke:control
# or
bash ./scripts/smoke-control.sh
```

**Requires:** A running service (systemd or manual) with at least one room.

---

### smoke-matrix.sh

**Purpose:** Live Matrix smoke test.

**What it tests:**
1. Bot responds to `!ping`
2. Memory works (remember "banana", recall it)
3. `!control` returns correct URL
4. `!reset` works and bot stays alive
5. Memory is cleared after reset
6. Archive shows previous session

**Run:**
```bash
# Source Matrix credentials first
source .env.matrix

# Then run
npm run smoke:matrix
# or
bash ./scripts/smoke-matrix.sh
```

**Requires:**
- `.env.matrix` file with `MATRIX_ACCESS_TOKEN` and `MATRIX_ROOM_ID`
- Running bot connected to Matrix

---

## Common Development Tasks

### Check for Duplicate Processes

```bash
npm run check:single-process
# or
bash ./scripts/check-single-process.sh
```

This verifies exactly one bot process is running. Fails loudly if duplicates exist.

### View Service Status

```bash
bash ./scripts/service-status.sh
```

Shows:
- Systemd service status
- Running process count
- Environment variables
- Control public URL configuration
- Model configuration
- Network listeners
- Tailscale Serve status

### Check Model Status

```bash
bash ./scripts/model-status.sh
```

Shows current model configuration for the bot.

### View Live Logs

```bash
sudo journalctl -u pi-matrix-agent -f
```

---

## Troubleshooting

### "Port 9000 is already in use"

**Cause:** Systemd service is already running.

**Fix:**
```bash
# Check what's using port 9000
sudo lsof -i :9000

# Stop the service
sudo systemctl stop pi-matrix-agent

# Or use a different port for local testing
CONTROL_PORT=9010 ./scripts/run-bot.sh
```

### Bot Not Responding to Commands

**Check:**
```bash
# Is the service running?
sudo systemctl status pi-matrix-agent

# Are there duplicate processes?
npm run check:single-process

# Check logs
sudo journalctl -u pi-matrix-agent -n 50
```

### `!control` Returns Localhost URLs

**Cause:** `CONTROL_PUBLIC_URL` not set at process startup.

**Fix:**
```bash
# Check current configuration
./scripts/service-status.sh control-url

# Update environment file
sudo nano /etc/pi-matrix-agent/env.conf
# Set: CONTROL_PUBLIC_URL="https://your-node.your-tailnet.ts.net"

# Restart service
sudo systemctl restart pi-matrix-agent
```

---

## File Locations

| File | Path |
|------|------|
| Source code | `/root/homelab/pi-matrix-agent/` |
| Built binary | `/root/homelab/pi-matrix-agent/dist/index.js` |
| Config | `/root/homelab/pi-matrix-agent/config.json` |
| Service unit | `/etc/systemd/system/pi-matrix-agent.service` |
| Environment | `/etc/pi-matrix-agent/env.conf` |
| Sessions | `/root/homelab/sessions/pi-matrix/` |
| Agent dir | `/root/.pi-matrix-agent/agent/` |

---

## See Also

- [README.md](README.md) - Project overview and setup
- [OPERATIONS.md](OPERATIONS.md) - Production operations guide
