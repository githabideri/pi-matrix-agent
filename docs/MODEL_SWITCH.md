# Model Switch Feature

## Overview

The `!model` command provides **room-level model switching** for pi-matrix-agent without requiring service restarts or session wipes.

This is a **first-pass operational feature** that provides live-room model control with documented limitations.

---

## Commands

### Show Model Status

```
!model
!model --status
!m --status
```

Shows the current model status for the room:
```
Model status:
  Active model: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf
  Thinking level: medium
  Session ID: abc123-...
  Session file: /path/to/session.jsonl
  Status: Idle
```

### Switch Model

```bash
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

Note: This also updates the global default. New rooms and !reset will use this model.
```

### Busy Room Rejection

```
Cannot switch model while a turn is in progress; try again once idle.
```

---

## Behavior (What Works)

| Scenario | Behavior |
|----------|----------|
| **Live room switch** | ✅ Works. Model changes immediately for the active session. |
| **No restart needed** | ✅ Works. Bot continues running without interruption. |
| **No session wipe** | ✅ Works. Conversation history is preserved. |
| **Active rooms isolated** | ✅ Works. Switching in Room A doesn't affect Room B's active model. |

---

## Limitations (Documented)

### SDK Side Effect: Global Default Mutation

The SDK's `setModel()` updates the **bot-global default** in `settings.json`. This means:

| Scenario | Behavior | Note |
|----------|----------|------|
| **New room creation** | ❌ Uses global default (changed by switch) | Side effect |
| **Same-room resume** | ❌ Falls back to global default | Not restored from session file |
| **Fresh session after `!reset`** | ❌ Uses global default | Not restored from previous switch |

### Why This Happens

The SDK's `setModel()`:
1. ✅ Updates `agent.state.model` (live-room switch works)
2. ✅ Appends `model_change` entry to session file
3. ⚠️ Updates global default via `settingsManager.setDefaultModelAndProvider()`

However, `createAgentSession()` does **not** restore the model from the session file's `model_change` entry on resume. The switched model is **not being re-established on resume**, so effective behavior falls back to the global default.

---

## Architectural Classification

This feature is a **pragmatic operator tool**, not a true room-persistent solution.

### What It Is
- Live-room model control without restarts
- Global-default mutation for future session creation
- Acceptable for operators who switch models close to when they're needed

### What It Is Not
- True room-scoped model persistence
- Trustworthy across `!reset` or service restarts
- A finished architecture

---

## Operational Recommendations

### For First-Pass Use

1. **Switch models when needed**: Use `!model` to switch for the current session
2. **Accept global side effect**: New rooms will use the switched model as default
3. **Switch close to use time**: Before restarts or `!reset`, the switched model is lost
4. **Use `!model --status`**: Verify the active model after switching

### Example Workflow

```matrix
User: !model qwen27
Bot: ✓ Model switch successful
      Requested: qwen27
      Active model: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf

User: [send prompt]
Bot: [responds with qwen27]

User: !model gemma4
Bot: ✓ Model switch successful
      Requested: gemma4
      Active model: gemma-4-26B-A4B-it-UD-Q4_K_M.gguf

User: [send prompt]
Bot: [responds with gemma4]
```

---

## Follow-Up: Room-Level Desired Model State

For genuine room-scoped model persistence, the next step is:

1. **Introduce explicit per-room desired model state**: Store the "desired model" per room
2. **Apply on session creation**: When creating/resuming a session, check for stored desired model
3. **Call `setModel()` if needed**: Re-establish the desired model after session creation

This would require:
- Persistent storage for per-room desired model (e.g., JSON file, database)
- Integration with `getOrCreateSession()` to apply desired model
- Optionally, `!model` command to update the stored desired model

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

- **Purpose**: Live-room model control without restart
- **Effect**: Changes active room's model immediately
- **Use case**: Operator control during active conversations

---

## Testing

### Unit Tests

```bash
npm test -- command.test.ts    # Parser tests
npm test -- router.test.ts     # Router tests  
npm test -- pi-backend.test.ts # Backend tests
```

### Key Tests

- **Parser**: `!model`, `!model --status`, `!model <profile>`, `!m <alias>`
- **Router**: Status reply, switch reply, busy-room rejection
- **Backend**: `switchModel()`, `getModelStatus()`, global side effects
- **Isolation**: Same-room resume uses global default, NOT session file

---

## Summary

| Aspect | Status |
|--------|--------|
| Live-room switch | ✅ Works |
| No restart needed | ✅ Works |
| No session wipe | ✅ Works |
| Active rooms isolated | ✅ Works |
| New room persistence | ⚠️ Uses global default |
| Resume persistence | ⚠️ Uses global default |
| `!reset` persistence | ⚠️ Uses global default |

**Verdict**: Good for merge as first-pass operational feature. Not a finished architecture.

For genuine room-scoped model control, room-level desired model state is the next step.
