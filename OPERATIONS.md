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

### Model Switching

```bash
# Check current model
./scripts/model-status.sh

# Switch models (requires restart)
sudo ./scripts/model-switch.sh qwen27   # Qwen3.5 27B Opus
sudo ./scripts/model-switch.sh qwen36   # Qwen3.6 35B A3B
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

## Model Switching

### Overview

The pi-matrix-agent supports switching between two model profiles:

| Profile | Model | Provider | Endpoint |
|---------|-------|----------|----------|
| `qwen27` | Qwen3.5 27B Opus | llama-cpp-qwen27 | 192.168.0.27:8080 |
| `qwen36` | Qwen3.6 35B A3B | llama-cpp-qwen36 | 192.168.0.27:8081 |

### Key Design Decisions

- **Operational/Admin feature**: Switching is done via scripts, not chat commands
- **Restart required**: Model changes require a service restart
- **Dedicated bot config**: Bot has its own isolated config at `/root/.pi-matrix-agent/agent/`
- **No hot-switching**: No in-flight session preservation across model changes
- **CLI config untouched**: Normal Pi CLI config at `~/.pi/agent/` is not affected

### Bot Config Location

The bot uses a dedicated agent directory:

```
/root/.pi-matrix-agent/agent/
├── models.json      # Model definitions for both profiles
├── settings.json    # Active model selection
└── auth.json        # Authentication state
```

This is **separate** from your normal Pi CLI config at `~/.pi/agent/`.

---

### Checking Current Model

```bash
# View current model configuration
./scripts/model-status.sh
```

Example output:
```
Current Default Provider: llama-cpp-qwen27
Current Default Model ID: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf
Model Display Name:       Qwen3.5 27B Opus (Matrix Bot)

Available Model Profiles:

  qwen27
    Provider: llama-cpp-qwen27
    Model:    Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf
    Name:     Qwen3.5 27B Opus

  qwen36
    Provider: llama-cpp-qwen36
    Model:    Qwen3.6-35B-A3B-UD-Q4_K_S.gguf
    Name:     Qwen3.6 35B A3B

✓ Active Profile: qwen27
```

---

### Switching Models

```bash
# Switch to Qwen27
sudo ./scripts/model-switch.sh qwen27

# Switch to Qwen36
sudo ./scripts/model-switch.sh qwen36
```

### What the Switch Script Does

1. **Validates** the target profile exists in `models.json`
2. **Backs up** current `settings.json`
3. **Updates** `settings.json` with new provider/model
4. **Verifies** the update was successful
5. **Clears session files** - Session files have model baked in; clearing ensures fresh session with new model
6. **Restarts** the systemd service
7. **Reports** the new active model

**Note**: Clearing session files is necessary because the Pi SDK stores the model in each session file. Without clearing, the bot would continue using the old model from the existing session. This means conversation history is lost when switching models.

### Example Switch Session

```bash
$ sudo ./scripts/model-switch.sh qwen36

========================================
   PI-MATRIX-AGENT MODEL SWITCH
========================================

Current Configuration:
  Provider: llama-cpp-qwen27
  Model:    Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf

Target Configuration (qwen36):
  Provider: llama-cpp-qwen36
  Model:    Qwen3.6-35B-A3B-UD-Q4_K_S.gguf
  Name:     Qwen3.6 35B A3B

Creating backup of current settings...
  Backup: /root/.pi-matrix-agent/agent/settings.json.backup.20260414_123456

Updating settings.json...
  defaultProvider: llama-cpp-qwen36
  defaultModel:    Qwen3.6-35B-A3B-UD-Q4_K_S.gguf

✓ Settings updated and verified

Restarting systemd service...

Stopping pi-matrix-agent...
Starting pi-matrix-agent...
  ✓ Service started

  Waiting for service to be ready...
  ✓ Service is active

========================================
Switch complete!
========================================

Now using: qwen36 (Qwen3.6 35B A3B)

To verify, run:
  ./scripts/model-switch.sh --status

Service Status: active
```

### Switch Script Options

```bash
# Show help
./scripts/model-switch.sh --help

# Dry run (show what would change without applying)
sudo ./scripts/model-switch.sh --dry-run qwen27

# Show current status (alias for model-status.sh)
./scripts/model-switch.sh --status
```

---

### Verification After Switch

1. **Check model status:**
   ```bash
   ./scripts/model-status.sh
   ```

2. **Check service is running:**
   ```bash
   systemctl status pi-matrix-agent
   ```

3. **Verify in Matrix:**
   - Send `!ping` → should get single "pong"
   - Send a question → bot responds with new model

4. **Check service-status shows correct model:**
   ```bash
   ./scripts/service-status.sh
   # Look for "Model Configuration" section
   ```

---

### Config File Format

**models.json** (`/root/.pi-matrix-agent/agent/models.json`):
```json
{
  "providers": {
    "llama-cpp-qwen27": {
      "baseUrl": "http://192.168.0.27:8080/v1",
      "api": "openai-completions",
      "apiKey": "sk-openclaw",
      "models": [
        {
          "id": "Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf",
          "name": "Qwen3.5 27B Opus (Matrix Bot)",
          "reasoning": true,
          "contextWindow": 204800,
          "maxTokens": 65536
        }
      ]
    },
    "llama-cpp-qwen36": {
      "baseUrl": "http://192.168.0.27:8081/v1",
      "api": "openai-completions",
      "apiKey": "sk-openclaw",
      "models": [
        {
          "id": "Qwen3.6-35B-A3B-UD-Q4_K_S.gguf",
          "name": "Qwen3.6 35B A3B (Matrix Bot)",
          "reasoning": true,
          "contextWindow": 204800,
          "maxTokens": 65536
        }
      ]
    }
  }
}
```

**settings.json** (`/root/.pi-matrix-agent/agent/settings.json`):
```json
{
  "defaultProvider": "llama-cpp-qwen27",
  "defaultModel": "Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf",
  "defaultThinkingLevel": "medium"
}
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
| Bot models.json | `/root/.pi-matrix-agent/agent/models.json` |
| Bot settings.json | `/root/.pi-matrix-agent/agent/settings.json` |

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
