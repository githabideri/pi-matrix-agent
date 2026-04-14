# Model Switch Phase 2: Per-Room Desired Model State

## Overview

Phase 2 introduces **explicit per-room desired model state** to enable true room-persistent model control across restarts, `!reset`, and session resume.

This document defines the target architecture and implementation plan.

---

## Current Baseline Limitation

### What Works (Phase 1)

| Scenario | Behavior |
|----------|----------|
| Live room switch | ✅ Works via `session.setModel()` |
| No restart needed | ✅ Works |
| No session wipe | ✅ Works |
| Active rooms isolated | ✅ Works |

### What Doesn't (Phase 1)

| Scenario | Behavior | Problem |
|----------|----------|----------|
| New room creation | ❌ Uses global default | SDK `setModel()` mutates global default |
| Same-room resume | ❌ Uses global default | Session file's `model_change` not re-applied |
| Post-`!reset` | ❌ Uses global default | New session uses global default |

---

## Phase 2 Target Architecture

### Key Concepts

The architecture separates four distinct model-related values:

1. **Global default model**: The bot-wide default stored in `settings.json`. Used when no room-specific desired model exists.

2. **Desired room model**: Per-room persistent state stored in a new file. Survives restart and `!reset`.

3. **Active runtime model**: The model currently active in the session. Read from `session.agent.state.model`.

4. **Resolved model for next turn**: The model that should be used for the next session creation/restore. Derived from desired room model or global default.

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    MODEL STATE LIFECYCLE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────┐                                             │
│  │ Global Default │  ───────────────────────────────────────┐   │
│  │ (settings.json)│                                        │   │
│  └────────┬───────┘                                        ▼   │
│           │                                    ┌─────────────────────┐    │
│           │                                    │  Desired Room Model │    │
│           │                                    │  (room-models.json) │    │
│           │                                    └──────────┬──────────┘    │
│           │                                               │              │
│           └───────────────────────────────────────────────┘              │
│                       │                                                  │
│                       ▼                                                  │
│              ┌─────────────────┐                                         │
│              │ Resolved Model  │  (desired room model OR global default) │
│              └────────┬────────┘                                         │
│                       │                                                  │
│                       ▼                                                  │
│              ┌─────────────────┐                                         │
│              │ Session Create  │  (createAgentSession uses resolved)     │
│              └────────┬────────┘                                         │
│                       │                                                  │
│                       ▼                                                  │
│              ┌─────────────────┐                                         │
│              │ Active Runtime  │  (session.agent.state.model)            │
│              │      Model      │                                         │
│              └─────────────────┘                                         │
│                       │                                                  │
│        ┌──────────────┴──────────────┐                                   │
│        ▼                             ▼                                   │
│  ┌──────────┐              ┌──────────────────┐                          │
│  │ !model   │              │  Inference Turn  │                          │
│  │ command  │              │                  │                          │
│  └────┬─────┘              └──────────────────┘                          │
│       ▼                                                                  │
│  ┌──────────┐                                                            │
│  │setModel()│  ────────────────────────────────────┐                    │
│  └──────────┘                                      ▼                    │
│       │                                    ┌──────────────────┐          │
│       │                                    │ Update Desired   │          │
│       └───────────────────────────────────▶│ Room Model File  │          │
│                                            └──────────────────┘          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Storage Design

### Room Models File (`room-models.json`)

Located in `agentDir` alongside `settings.json` and `auth.json`.

```json
{
  "rooms": {
    "!roomid1:example.com": {
      "desiredModel": "qwen27",
      "resolvedModelId": "Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf",
      "updatedAt": "2026-04-14T12:34:56.789Z"
    },
    "!roomid2:example.com": {
      "desiredModel": "gemma4",
      "resolvedModelId": "gemma-4-26B-A4B-it-UD-Q4_K_M.gguf",
      "updatedAt": "2026-04-14T12:35:00.000Z"
    }
  }
}
```

### Fields Explained

| Field | Type | Description |
|-------|------|-------------|
| `desiredModel` | string | User-facing profile name (e.g., "qwen27", "gemma4") |
| `resolvedModelId` | string | Full resolved model ID for verification |
| `updatedAt` | ISO timestamp | When the desired model was last set |

---

## Behavior Matrix

### Phase 2 Target Behavior

| Scenario | Phase 1 (Current) | Phase 2 (Target) |
|----------|-------------------|------------------|
| **Live room switch** `!model qwen27` | ✅ Switches active model | ✅ Switches active model + persists desired |
| **`!model --status`** | Shows active model | Shows active + desired (if different) |
| **New room creation** | Uses global default | Uses desired room model or global default |
| **Same-room resume** | Uses global default | Uses desired room model or global default |
| **Post-`!reset`** | Uses global default | Uses desired room model or global default |
| **Service restart** | Uses global default | Uses desired room model or global default |
| **Desired model cleared** | N/A | Falls back to global default |

---

## Implementation Details

### 1. Data Model Changes

#### New Type: `RoomModelState`

```typescript
interface RoomModelState {
  desiredModel: string;      // Profile name (e.g., "qwen27")
  resolvedModelId?: string;  // Resolved model ID
  updatedAt: string;         // ISO timestamp
}
```

#### New Type: `RoomModelsStore`

```typescript
interface RoomModelsStore {
  rooms: Record<string, RoomModelState>;
}
```

#### Extended Type: `ModelStatus`

```typescript
interface ModelStatus {
  active: boolean;
  model?: string;            // Active runtime model
  thinkingLevel?: string;
  sessionId?: string;
  sessionFile?: string;
  isProcessing?: boolean;
  
  // Phase 2 additions:
  desiredModel?: string;     // Desired room model (profile name)
  desiredResolvedModelId?: string;  // Resolved model ID for desired
  globalDefault?: string;    // Bot-wide global default
  modelMismatch?: boolean;   // true if active != desired
}
```

### 2. Backend Changes

#### New Class: `RoomModelManager`

```typescript
class RoomModelManager {
  private storePath: string;
  private store: RoomModelsStore;
  
  constructor(agentDir: string);
  
  // Read desired model for a room
  getDesiredModel(roomId: string): RoomModelState | undefined;
  
  // Set desired model for a room
  setDesiredModel(roomId: string, desiredModel: string, resolvedModelId?: string): void;
  
  // Clear desired model for a room (fall back to global)
  clearDesiredModel(roomId: string): void;
  
  // Get global default model profile
  getGlobalDefault(): string | undefined;
  
  // Resolve desired model for a room (desired or global default)
  resolveDesiredModel(roomId: string): string | undefined;
}
```

#### Modified: `PiSessionBackend.getOrCreateSession()`

```typescript
async getOrCreateSession(roomId: string): Promise<AgentSession> {
  // ... existing code ...
  
  // Phase 2: Check for desired room model
  const desiredModelProfile = this.roomModelManager.resolveDesiredModel(roomId);
  
  if (desiredModelProfile) {
    // Apply desired model after session creation
    const session = await createAgentSession({ ... });
    await this.applyDesiredModel(session, desiredModelProfile);
    return session;
  }
  
  // No desired model - use global default
  const session = await createAgentSession({ ... });
  return session;
}
```

#### New Method: `applyDesiredModel()`

```typescript
private async applyDesiredModel(session: AgentSession, profile: string): Promise<void> {
  // Find the target model
  const targetModel = this.findModelByProfile(profile);
  
  if (targetModel && this.modelRegistry.hasConfiguredAuth(targetModel)) {
    await session.setModel(targetModel);
  }
}
```

#### Modified: `PiSessionBackend.switchModel()`

```typescript
async switchModel(roomId: string, requestedProfile: string): Promise<ModelSwitchResult> {
  // ... existing validation ...
  
  try {
    // Call SDK setModel
    await session.setModel(targetModel);
    
    // Phase 2: Persist desired model per room
    this.roomModelManager.setDesiredModel(roomId, requestedProfile, targetModel.id);
    
    // Update snapshot
    this.updateSnapshotFromSession(roomState, session);
    
    // Verify the switch
    const activeModel = session.model?.id || session.model?.name || "unknown";
    
    return {
      success: true,
      message: `Model switched to "${activeModel}"`,
      requestedProfile,
      resolvedModel: targetModel.id,
      activeModel,
    };
  } catch (error: any) {
    // ... error handling ...
  }
}
```

#### Modified: `PiSessionBackend.getModelStatus()`

```typescript
async getModelStatus(roomId: string): Promise<ModelStatus | null> {
  const roomState = this.roomStateManager.get(roomId);
  
  if (!roomState) {
    return null;
  }
  
  // ... existing active model extraction ...
  
  // Phase 2: Add desired model info
  const desiredModelState = this.roomModelManager.getDesiredModel(roomId);
  const globalDefault = this.roomModelManager.getGlobalDefault();
  
  return {
    active: true,
    model,
    thinkingLevel,
    sessionId: roomState.sessionId,
    sessionFile: roomState.sessionFile,
    isProcessing: roomState.isProcessing,
    desiredModel: desiredModelState?.desiredModel,
    desiredResolvedModelId: desiredModelState?.resolvedModelId,
    globalDefault,
    modelMismatch: model !== desiredModelState?.resolvedModelId,
  };
}
```

### 3. Command/Status Changes

#### Updated Status Format

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

When active model mismatches desired:

```matrix
User: !model --status

Bot: Model status:
      Active model: gemma-4-26B-A4B-it-UD-Q4_K_M.gguf ⚠️
      Thinking level: medium
      Desired model: qwen27 (resolved: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf)
      Global default: gemma4
      ⚠️ Active model differs from desired. Send a message to apply desired model.
      Session ID: abc123-...
      Session file: /path/to/session.jsonl
      Status: Idle
```

#### New Command: Clear Desired Model

```matrix
!model --default      # Clear desired model for this room, fall back to global default
!m --default          # Alias
```

Response:
```
✓ Desired model cleared for this room
  This room will now use the global default model
```

### 4. Test Plan

#### Unit Tests

1. **RoomModelManager tests** (`test/unit/room-model-manager.test.ts`):
   - `getDesiredModel()` returns correct value
   - `setDesiredModel()` persists to file
   - `clearDesiredModel()` removes entry
   - `resolveDesiredModel()` falls back to global default
   - File is loaded/saved correctly

2. **Backend integration tests**:
   - `getOrCreateSession()` applies desired model
   - `switchModel()` persists desired model
   - `getModelStatus()` reports desired + active
   - `!reset` preserves desired model

3. **Router tests**:
   - Status reply shows desired model
   - Status reply warns on mismatch
   - `--default` command clears desired model

#### Integration Tests

1. **Desired model persistence across restart**:
   - Set desired model in Room A
   - Restart bot
   - Verify Room A uses desired model

2. **Desired model persistence across `!reset`**:
   - Set desired model in Room A
   - `!reset` in Room A
   - Verify new session uses desired model

3. **Active/Desired mismatch detection**:
   - Set desired model to qwen27
   - Manually switch active model to gemma4
   - Verify `!model --status` shows mismatch warning

---

## Migration Notes

### Existing Data

No migration needed. Phase 2 introduces a new file (`room-models.json`) that is empty on first boot.

### Backward Compatibility

- Existing behavior preserved when no desired model is set
- Rooms without desired model fall back to global default
- `settings.json` unchanged

### Rollback Plan

If Phase 2 needs to be rolled back:
1. Delete `room-models.json`
2. Revert to Phase 1 behavior (global default only)

---

## Implementation Checklist

### Phase 2.1: Core Data Model

- [ ] Add `RoomModelState` and `RoomModelsStore` types to `src/types.ts`
- [ ] Create `RoomModelManager` class in `src/room-model-manager.ts`
- [ ] Implement file read/write for `room-models.json`
- [ ] Add unit tests for `RoomModelManager`

### Phase 2.2: Backend Integration

- [ ] Add `RoomModelManager` to `PiSessionBackend`
- [ ] Modify `getOrCreateSession()` to apply desired model
- [ ] Add `applyDesiredModel()` helper method
- [ ] Modify `switchModel()` to persist desired model
- [ ] Modify `getModelStatus()` to report desired model
- [ ] Add `reset()` preserves desired model (already does - verify)
- [ ] Add unit tests for backend changes

### Phase 2.3: Command/Status Updates

- [ ] Update router status reply format
- [ ] Add mismatch warning in status reply
- [ ] Add `--default` command to clear desired model
- [ ] Update help text
- [ ] Add router tests

### Phase 2.4: Documentation

- [ ] Update `docs/MODEL_SWITCH.md` with Phase 2 behavior
- [ ] Add ops notes for `room-models.json`
- [ ] Update README.md

---

## Risk Assessment

### Low Risk

- New file added, no migration of existing data
- Backward compatible (falls back to global default)
- Can be rolled back by deleting `room-models.json`

### Medium Risk

- `applyDesiredModel()` on session creation could fail silently if auth not configured
- Need to handle case where desired model no longer exists

### Mitigations

- Log warnings when desired model cannot be applied
- Fall back to global default silently (no user-facing error)
- Status report shows desired vs active mismatch

---

## Future Considerations (Phase 3+)

These are NOT part of Phase 2:

1. **Per-room model preferences**: Thinking level, temperature, etc.
2. **Model availability check**: Warn if desired model's backend is down
3. **Model rotation**: Round-robin or load-based selection
4. **User-scoped defaults**: Per-user desired models

---

## Summary

Phase 2 introduces **per-room desired model state** to enable true room-persistent model control. The key insight is separating:

1. **Desired model** (persistent, per-room configuration)
2. **Active model** (runtime state, may differ from desired)

This architecture avoids the SDK's global default mutation side effect and enables reliable room-scoped model persistence across restarts and `!reset`.

</content>} > ~/homelab/pi-matrix-agent/docs/MODEL_SWITCH_PHASE2.md