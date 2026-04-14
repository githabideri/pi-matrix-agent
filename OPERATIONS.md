# pi-matrix-agent Operations Guide

## Quick Reference

### Production (Systemd Service) - RECOMMENDED

```bash
# Install service (one-time)
sudo ./scripts/install-service.sh install

# Start/stop/restart
sudo systemctl start pi-matrix-agent
sudo systemctl stop pi-matrix-agent
sudo systemctl restart pi-matrix-agent

# Status and logs
sudo systemctl status pi-matrix-agent
sudo journalctl -u pi-matrix-agent -f

# Full health check
./scripts/service-status.sh
```

### Development (Manual)

```bash
# Build first
npm run build

# Run with public URL
CONTROL_PUBLIC_URL=https://pi-prototype.home.macl.at.ts.net ./scripts/run-bot.sh

# Or dev mode with watch
npm run dev
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    systemd                                   │
│  ┌─────────────────────────────────────────────────────────┐│
│  │              pi-matrix-agent.service                     ││
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────┐ ││
│  │  │ MatrixTransport │  │ ControlServer   │  │Backend │ ││
│  │  │ (Bot)           │  │ (Web UI/API)    │  │        │ ││
│  │  └────────┬────────┘  └────────┬────────┘  └────┬────┘ ││
│  │           │                    │                 │     ││
│  │           └──────────┬─────────┴───────────┬─────┘     ││
│  │                      │                     │           ││
│  │             ┌────────▼────────┐   ┌────────▼────┐      ││
│  │             │  Router         │   │Express App  │      ││
│  │             │  (Commands)     │   │  (Routes)   │      ││
│  │             └─────────────────┘   └─────────────┘      ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
        │                           │
        ▼                           ▼
   Matrix HS                  Port 9000
   (dendrite)                (Control UI)
                              │
                              ▼
                       ┌───────────┐
                       │ Tailscale │
                       │   Serve   │
                       └───────────┘
```

---

## Systemd Service (Production)

### Installation

**One-time setup:**

```bash
cd ~/homelab/pi-matrix-agent

# Install service (creates unit + checks env file)
sudo ./scripts/install-service.sh install

# Review environment file (edit if needed)
sudo nano /etc/pi-matrix-agent/env.conf

# Enable and start
sudo systemctl enable pi-matrix-agent
sudo systemctl start pi-matrix-agent
```

### Environment File

The service reads environment variables from `/etc/pi-matrix-agent/env.conf`:

```bash
# Required
CONFIG_FILE="/root/homelab/pi-matrix-agent/config.json"
CONTROL_PUBLIC_URL="https://pi-prototype.home.macl.at.ts.net"

# Optional (have defaults)
# CONTROL_PORT=9000
# CONTROL_HOST=127.0.0.1
NODE_ENV="production"
```

**Key variable: `CONTROL_PUBLIC_URL`**

This must be set for `!control` to return the correct public URL:

```bash
# Format: https://<node-name>.<tailnet>.ts.net
CONTROL_PUBLIC_URL="https://pi-prototype.home.macl.at.ts.net"
```

### Service Management

```bash
# Start
sudo systemctl start pi-matrix-agent

# Stop
sudo systemctl stop pi-matrix-agent

# Restart (after config change or new build)
sudo systemctl restart pi-matrix-agent

# Status
sudo systemctl status pi-matrix-agent

# Logs (follow)
sudo journalctl -u pi-matrix-agent -f

# Logs (last 50 lines)
sudo journalctl -u pi-matrix-agent -n 50

# Logs (since boot)
sudo journalctl -u pi-matrix-agent -b
```

### Update After New Build

```bash
# 1. Build the new version
cd ~/homelab/pi-matrix-agent
npm run build

# 2. Restart the service
sudo systemctl restart pi-matrix-agent

# 3. Verify
./scripts/service-status.sh
```

### Uninstall

```bash
sudo ./scripts/install-service.sh uninstall
```

---

## Development Mode

### Warning: Do Not Run Dev Mode Alongside Service!

```bash
# ❌ WRONG - Running both creates duplicate processes:
sudo systemctl start pi-matrix-agent  # Service running
npm run dev                           # Dev also running → DUPLICATES!
```

**Always stop the service before running dev mode:**

```bash
# ✅ CORRECT - Stop service first:
sudo systemctl stop pi-matrix-agent
npm run dev  # Now safe to run dev
```

### Development Commands

```bash
# Watch mode (auto-reload on changes)
npm run dev

# Single run with public URL
CONTROL_PUBLIC_URL=https://pi-prototype.home.macl.at.ts.net ./scripts/run-bot.sh

# Direct node run (not recommended)
CONTROL_PUBLIC_URL=https://pi-prototype.home.macl.at.ts.net node dist/index.js
```

---

## Health Checks & Diagnostics

### Full Status Check

```bash
./scripts/service-status.sh
```

This checks:
- Systemd service status
- Running process count (should be exactly 1)
- Environment variables (especially CONTROL_PUBLIC_URL)
- Network listeners
- Tailscale Serve status

### Check Single Process

```bash
npm run check:single-process
# or
./scripts/check-single-process.sh
```

### Manual Process Check

```bash
# Count processes
ps aux | grep "node dist/index.js" | grep -v grep | wc -l
# Should output: 1

# See process details
ps aux | grep "node dist/index.js" | grep -v grep

# Check parent (should be PID 1 if systemd-managed)
pgrep -f "node dist/index.js" | xargs -I{} sh -c 'echo PID {}: $(ps -o ppid= -p {})'
```

### Check Environment

```bash
# Check env file
cat /etc/pi-matrix-agent/env.conf

# Check running process environment
PID=$(pgrep -f "node dist/index.js")
cat /proc/$PID/environ | tr '\0' '\n' | grep CONTROL
```

---

## Common Issues

### Issue: `!control` Returns Localhost URLs

**Symptom:**
```
!control
Assistant UI: http://localhost:9000/spike?room=...
```

**Cause:** `CONTROL_PUBLIC_URL` not set at process startup.

**Diagnosis:**
```bash
./scripts/service-status.sh control-url
```

**Fix:**
```bash
# 1. Update env file
sudo nano /etc/pi-matrix-agent/env.conf
# Set: CONTROL_PUBLIC_URL="https://pi-prototype.home.macl.at.ts.net"

# 2. Restart service
sudo systemctl restart pi-matrix-agent

# 3. Verify
./scripts/service-status.sh control-url
```

---

### Issue: Multiple Bot Responses (Duplicate Processes)

**Symptom:** `!ping` returns multiple "pong" responses.

**Diagnosis:**
```bash
ps aux | grep "node dist/index.js" | grep -v grep
# Shows multiple processes
```

**Fix:**
```bash
# Kill all manual processes
pkill -f "node dist/index.js"

# Restart via systemd (single canonical process)
sudo systemctl restart pi-matrix-agent

# Verify single process
./scripts/check-single-process.sh
```

**Prevention:** Always use systemd for production. Never run manual processes alongside the service.

---

### Issue: Service Won't Start

**Diagnosis:**
```bash
# Check status
sudo systemctl status pi-matrix-agent

# Check logs
sudo journalctl -u pi-matrix-agent -n 50
```

**Common causes:**
1. Config file not found - check `CONFIG_FILE` in env.conf
2. Port 9000 already in use - another process running
3. Missing dependencies - run `npm install`

**Fixes:**
```bash
# If port in use - kill old process
sudo lsof -i :9000
pkill -f "node dist/index.js"

# Restart service
sudo systemctl restart pi-matrix-agent
```

---

### Issue: Web UI Not Accessible via Tailscale

**Diagnosis:**
```bash
# Check control server locally
curl http://127.0.0.1:9000/

# Check Tailscale Serve
sudo tailscale serve status
```

**Fix:**
```bash
# Restart Tailscale Serve
sudo ./scripts/setup-serve.sh 9000 127.0.0.1
```

---

## Command Reference

### Bot Commands (in Matrix)

| Command | Description |
|---------|-------------|
| `!ping` | Check if bot is alive |
| `!status` | Show bot status |
| `!help` | Show available commands |
| `!reset` | Clear conversation memory |
| `!control` | Get WebUI URL for current room |

### Systemd Commands

| Command | Description |
|---------|-------------|
| `systemctl start pi-matrix-agent` | Start service |
| `systemctl stop pi-matrix-agent` | Stop service |
| `systemctl restart pi-matrix-agent` | Restart service |
| `systemctl status pi-matrix-agent` | Show status |
| `systemctl enable pi-matrix-agent` | Enable on boot |
| `journalctl -u pi-matrix-agent -f` | Follow logs |

---

## Web UI Access

### Assistant UI (Primary)
```
https://pi-prototype.home.macl.at.ts.net/spike?room=<roomKey>
```

### Original Room View (Fallback)
```
https://pi-prototype.home.macl.at.ts.net/room/<roomKey>
```

---

## Tailscale Serve

Tailscale Serve is separate infrastructure that exposes the control server.

```bash
# Setup (one-time)
sudo ./scripts/setup-serve.sh 9000 127.0.0.1

# Check status
sudo tailscale serve status

# Restart
sudo ./scripts/setup-serve.sh 9000 127.0.0.1
```

**Note:** The bot service does NOT manage Tailscale Serve. They are independent.

---

## Operational Checklist

### After Installing Service

1. **Service is active:**
   ```bash
   sudo systemctl status pi-matrix-agent
   # Should show "active (running)"
   ```

2. **Single process:**
   ```bash
   ./scripts/check-single-process.sh
   # Should show "✓ Exactly one process running"
   ```

3. **Control URL configured:**
   ```bash
   ./scripts/service-status.sh control-url
   # Should show public URL, not localhost
   ```

4. **Bot responds:**
   - Send `!ping` in Matrix → get single "pong"

5. **!control returns public URL:**
   - Send `!control` in Matrix → get `https://pi-prototype.home.macl.at.ts.net/spike?room=...`

---

## File Locations

| File | Path |
|------|------|
| Service unit | `/etc/systemd/system/pi-matrix-agent.service` |
| Environment | `/etc/pi-matrix-agent/env.conf` |
| Source code | `/root/homelab/pi-matrix-agent/` |
| Built binary | `/root/homelab/pi-matrix-agent/dist/index.js` |
| Config | `/root/homelab/pi-matrix-agent/config.json` |
| Sessions | `/root/homelab/sessions/pi-matrix/` |
| Agent dir | `/root/.pi-matrix-agent/agent/` |

---

## Logs

### Real-time logs
```bash
sudo journalctl -u pi-matrix-agent -f
```

### Last 100 lines
```bash
sudo journalctl -u pi-matrix-agent -n 100
```

### Since boot
```bash
sudo journalctl -u pi-matrix-agent -b
```

### Specific time range
```bash
sudo journalctl -u pi-matrix-agent --since "2026-04-14 10:00:00" --until "2026-04-14 12:00:00"
```

### Export logs
```bash
sudo journalctl -u pi-matrix-agent -b > /tmp/pi-matrix-agent-logs.txt
```
