# Model Switch Feature

## Overview

The `!model` command provides **room-persistent model switching** for pi-matrix-agent without requiring service restarts or session wipes.

**Phase 2** introduces true room-scoped model persistence that survives service restarts, `!reset`, and session resume.

---

## Commands

### Show Model Status

```matrix
!model
!model --status
!m -s
!m --status
```

Shows the current model status for the room:
```
Model status:
  Active model: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf
  Thinking level: medium
  Desired model: qwen27 (resolved: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf)
  Global default: gemma4
  Session ID: abc123-...
  Session file: /path/to/session.jsonl
  Status: Idle
```

When active model mismatches desired:
```
Model status:
  Active model: gemma-4-26B-A4B-it-UD-Q4_K_M.gguf ⚠️
  Thinking level: medium
  Desired model: qwen27 (resolved: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf)
  Global default: gemma4
  Session ID: abc123-...
  Session file: /path/to/session.jsonl
  Status: Idle

  ⚠️ Active model differs from desired.
  Send a message to apply the desired model.
```

### Switch Model

```matrix
!model gemma4    # Switch to Gemma4
!model qwen27    # Switch to Qwen27
!m g4            # Switch to Gemma4 (alias)
!m q27           # Switch to Qwen27 (alias)
```

Successful switch response:
```
✓ Model switch successful
  Requested: qwen27
  Resolved to: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf
  Active model: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf

Phase 2: This is now room-persistent.
  - Survives service restart
  - Survives !reset
  - Does not affect other rooms
```

### Clear Room Override

```matrix
!model --clear   # Clear room override, fall back to global default
!m -c            # Alias
```

Clear response:
```
✓ Desired model cleared for this room
  Desired model cleared for this room. Will now use the global default model.
  Previous desired: qwen27

This room will now use the global default model.
```

### Busy Room Rejection

```
Cannot switch model while a turn is in progress; try again once idle.
```

---

## Behavior Matrix

| Scenario | Phase 1 | Phase 2 |
|----------|---------|---------|
| **Live room switch** | ✅ Works | ✅ Works |
| **No restart needed** | ✅ Works | ✅ Works |
| **No session wipe** | ✅ Works | ✅ Works |
| **Active rooms isolated** | ✅ Works | ✅ Works |
| **New room creation** | ❌ Uses global default | ✅ Uses desired or global |
| **Same-room resume** | ❌ Uses global default | ✅ Re-applies desired |
| **Post-`!reset`** | ❌ Uses global default | ✅ Re-applies desired |
| **Service restart** | ❌ Uses global default | ✅ Re-applies desired |
| **Global contamination** | ❌ Yes | ✅ No |

---

## Four Model States

Phase 2 tracks four distinct model-related values:

| State | Description | Source |
|-------|-------------|--------|
| **Global default** | Bot-wide default | `settings.json` |
| **Desired room model** | Per-room persistent override | `room-models.json` |
| **Active runtime model** | Current session model | `session.agent.state.model` |
| **Resolved model** | Model for next turn | Desired or global default |

### Example Status Output

```
Model status:
  Active model: test-model-gemma        ← Runtime model
  Desired model: gemma4                 ← Persistent per-room override
  Global default: qwen27                ← Bot-wide default
```

---

## Architecture

### Data Flow

```
┌────────────────┐     ┌─────────────────────┐
│ Global Default │────▶│                     │
│ (settings.json)│     │  Resolve Model      │
└────────────────┘     │  (desired OR global)│
                       └──────────┬──────────┘
                                  │
                       ┌──────────▼──────────┐
                       │ Desired Room Model  │
                       │ (room-models.json)  │
                       └─────────────────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Session Create/Resume│
                       │ (apply desired)     │
                       └──────────┬──────────┘
                                  │
                                  ▼
                       ┌─────────────────────┐
                       │ Active Runtime Model│
                       │ (session.state)     │
                       └─────────────────────┘
```

### Storage

**Room models file** (`agentDir/room-models.json`):

```json
{
  "rooms": {
    "!roomid1:example.com": {
      "desiredModel": "qwen27",
      "resolvedModelId": "Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf",
      "updatedAt": "2026-04-14T12:34:56.789Z"
    }
  }
}
```

---

## Command Reference

### Status Commands

| Command | Description |
|---------|-------------|
| `!model` | Show model status |
| `!model --status` | Show model status |
| `!m -s` | Show model status (short alias) |
| `!m --status` | Show model status |

### Switch Commands

| Command | Description |
|---------|-------------|
| `!model gemma4` | Switch to Gemma4 |
| `!model qwen27` | Switch to Qwen27 |
| `!m g4` | Switch to Gemma4 (alias) |
| `!m q27` | Switch to Qwen27 (alias) |

### Clear Command

| Command | Description |
|---------|-------------|
| `!model --clear` | Clear room override |
| `!m -c` | Clear room override (short alias) |

---

## Example Workflows

### Switching Models

```matrix
User: !model qwen27
Bot: ✓ Model switch successful
      Requested: qwen27
      Resolved to: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf
      Active model: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf

      Phase 2: This is now room-persistent.
        - Survives service restart
        - Survives !reset
        - Does not affect other rooms
```

### Checking Status

```matrix
User: !model --status
Bot: Model status:
      Active model: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf
      Thinking level: medium
      Desired model: qwen27 (resolved: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf)
      Global default: gemma4
      Session ID: abc123-...
      Session file: /path/to/session.jsonl
      Status: Idle
```

### Clearing Room Override

```matrix
User: !model --clear
Bot: ✓ Desired model cleared for this room
      Desired model cleared for this room. Will now use the global default model.
      Previous desired: qwen27

      This room will now use the global default model.
```

### Persistence Across `!reset`

```matrix
User: !model gemma4
Bot: ✓ Model switch successful
      ...

User: !reset
Bot: Session reset. Previous session archived.

User: !model --status
Bot: Model status:
      Active model: gemma-4-26B-A4B-it-UD-Q4_K_M.gguf  ← Re-applied!
      Desired model: gemma4
      ...
```

---

## Operational Notes

### Files Created

| File | Location | Purpose |
|------|----------|--------|
| `room-models.json` | `agentDir/` | Per-room desired model overrides |

### Recovery

If `room-models.json` becomes corrupt, delete it to reset all room overrides:

```bash
rm agentDir/room-models.json
```

The bot will continue working with global defaults.

### Verification

Use `!model --status` to verify:
1. **Active model**: What the session is currently using
2. **Desired model**: What will be applied on next bind/reset
3. **Global default**: Fallback when no room override exists
4. **Mismatch warning**: Indicates drift between desired and active

---

## Testing

### Unit Tests

```bash
npm test -- command.test.ts      # Parser tests
npm test -- router.test.ts       # Router tests  
npm test -- pi-backend.test.ts   # Backend tests
npm test -- room-model-manager.test.ts # Store tests
```

### Key Test Coverage

- **Parser**: `!model`, `!m -s`, `!m -c`, `!model --clear`
- **Store**: Persistence, reload, clear, corrupt file handling
- **Backend**: Reconciliation, drift detection, status reporting
- **Router**: Status reply, switch reply, clear reply, help text

---

## Comparison: Shell Script vs Matrix Command

### Shell Script (`scripts/model-switch.sh`)

```bash
./scripts/model-switch.sh gemma4  # Changes global default, restarts service
```

- **Purpose**: Set bot-global default for all future sessions
- **Effect**: Changes `settings.json`, restarts service
- **Use case**: Batch configuration, setting defaults for new deployments

### Matrix Command (`!model`)

```matrix
!model gemma4  # Switches model for active room, no restart
```

- **Purpose**: Room-persistent model control without restart
- **Effect**: Changes active room's model and persists to `room-models.json`
- **Use case**: Operator control during active conversations

---

## Summary

| Aspect | Status |
|--------|--------|
| Live-room switch | ✅ Works |
| No restart needed | ✅ Works |
| No session wipe | ✅ Works |
| Active rooms isolated | ✅ Works |
| New room persistence | ✅ Re-applies desired |
| Resume persistence | ✅ Re-applies desired |
| `!reset` persistence | ✅ Re-applies desired |
| Global contamination | ✅ Neutralized |
| Drift detection | ✅ Reported |
| Clear override | ✅ Supported |

**Verdict**: Phase 2 provides true room-persistent model control with proper separation of concerns.
