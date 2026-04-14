# Model Switch Smoke Test Procedure

## Pre-Test Setup

Ensure the bot is running and you're in an allowed Matrix room.

## Test 1: Status Before Switch

```matrix
!model --status
```

**Expected output:**
```
Model status:
  Active model: <current-model>
  Thinking level: medium
  Session ID: <id>
  Session file: <path>
  Status: Idle
```

**Pass criteria:** Status shows active model and session info.

---

## Test 2: Switch to Gemma4

```matrix
!model gemma4
```

**Expected output:**
```
✓ Model switch successful
  Requested: gemma4
  Resolved to: gemma-4-26B-A4B-it-UD-Q4_K_M.gguf
  Active model: gemma-4-26B-A4B-it-UD-Q4_K_M.gguf

Note: This also updates the global default. New rooms and !reset will use this model.
```

**Pass criteria:** Switch succeeds, shows resolved model path.

---

## Test 3: Verify Active Model Changed

```matrix
!model --status
```

**Expected output:**
```
Model status:
  Active model: gemma-4-26B-A4B-it-UD-Q4_K_M.gguf
  Thinking level: medium
  ...
```

**Pass criteria:** Active model shows Gemma4.

---

## Test 4: Switch to Qwen27 (Alias)

```matrix
!m q27
```

**Expected output:**
```
✓ Model switch successful
  Requested: qwen27
  Resolved to: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf
  Active model: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf

Note: This also updates the global default. New rooms and !reset will use this model.
```

**Pass criteria:** Alias `q27` resolves correctly to Qwen27.

---

## Test 5: Busy Room Rejection

Start a long inference, then immediately try to switch:

```matrix
[Send a prompt that triggers a response]
!model gemma4    # While above is still processing
```

**Expected output:**
```
Cannot switch model while a turn is in progress; try again once idle.
```

**Pass criteria:** Switch rejected while room is busy.

---

## Test 6: Invalid Profile

```matrix
!model nonexistent
```

**Expected output:**
```
✗ Unknown profile "nonexistent". Available profiles: gemma4, qwen27 (aliases: g4, q27)
```

**Pass criteria:** Invalid profile rejected with helpful error.

---

## Test 7: Model Actually Switched (Functional)

```matrix
!model gemma4
Who are you and what model are you running?
```

**Expected:** Response should indicate Gemma4.

**Pass criteria:** Bot responds with the switched model.

---

## Test 8: Reset Uses Global Default (Known Limitation)

```matrix
!model qwen27
!model --status    # Verify qwen27 is active
!reset
!model --status    # Check model after reset
```

**Expected after reset:**
```
Model status:
  Active model: Qwen3.5-27B-Claude-4.6-Opus-Reasoning-Distilled.i1-Q4_K_M.gguf
  ...
```

**Pass criteria:** After `!reset`, new session uses the global default (which was set by the last `!model` switch). This is the **documented limitation** of Phase 1.

---

## Summary Checklist

- [ ] Test 1: Status before switch
- [ ] Test 2: Switch to Gemma4
- [ ] Test 3: Verify active model changed
- [ ] Test 4: Switch via alias (`!m q27`)
- [ ] Test 5: Busy room rejection
- [ ] Test 6: Invalid profile rejection
- [ ] Test 7: Functional switch verification
- [ ] Test 8: Reset uses global default (limitation)

## Known Limitations (Phase 1)

1. **New room uses global default**: Not room-persistent
2. **Resume uses global default**: Not restored from session file
3. **`!reset` uses global default**: Not preserved across reset

These are **intentional limitations** documented in `docs/MODEL_SWITCH.md`.
Phase 2 (`docs/MODEL_SWITCH_PHASE2.md`) addresses these with per-room desired model state.

</content>} > ~/homelab/pi-matrix-agent/scripts/model-switch-smoke-test.md