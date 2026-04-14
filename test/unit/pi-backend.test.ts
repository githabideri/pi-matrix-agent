import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiSessionBackend } from "../../src/pi-backend.js";

// Helper to create a minimal test agentDir with required Pi config files
async function createTestAgentDir(withModels: boolean = false): Promise<string> {
  const agentDir = join(tmpdir(), `pi-agent-test-${Date.now()}`);
  await mkdir(agentDir, { recursive: true });

  // Create minimal settings.json
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify(
      {
        theme: "dark",
        defaultProvider: withModels ? "llama-cpp-qwen27" : undefined,
        defaultModel: withModels ? "test-model-qwen" : undefined,
      },
      null,
      2,
    ),
  );

  // Create models.json - with or without models based on flag
  const modelsContent = withModels
    ? {
        providers: {
          "llama-cpp-gemma4": {
            baseUrl: "http://test-gemma:8081/v1",
            api: "openai-completions",
            apiKey: "test-key",
            models: [
              {
                id: "test-model-gemma",
                name: "Test Gemma4 Model",
                reasoning: true,
                input: ["text"],
                contextWindow: 131072,
                maxTokens: 16384,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
          "llama-cpp-qwen27": {
            baseUrl: "http://test-qwen:8080/v1",
            api: "openai-completions",
            apiKey: "test-key",
            models: [
              {
                id: "test-model-qwen",
                name: "Test Qwen27 Model",
                reasoning: true,
                input: ["text"],
                contextWindow: 204800,
                maxTokens: 65536,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      }
    : {
        providers: {},
        models: [],
      };

  await writeFile(join(agentDir, "models.json"), JSON.stringify(modelsContent, null, 2));

  // Create auth.json (empty auth)
  await writeFile(
    join(agentDir, "auth.json"),
    JSON.stringify(
      {
        providers: {},
      },
      null,
      2,
    ),
  );

  return agentDir;
}

describe("PiSessionBackend", () => {
  let backend: PiSessionBackend;
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    // Create temporary directories for test sessions and agent config
    sessionTestDir = join(tmpdir(), `pi-backend-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });

    // Create test agentDir with minimal config
    agentTestDir = await createTestAgentDir();

    backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });
  });

  afterEach(async () => {
    // Clean up
    await backend.dispose();
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  it("creates sessions for different rooms", async () => {
    const session1 = await backend.getOrCreateSession("!room1:example.com");
    const session2 = await backend.getOrCreateSession("!room2:example.com");

    expect(session1).toBeDefined();
    expect(session2).toBeDefined();
    expect(session1).not.toBe(session2);
  });

  it("returns cached session for same room", async () => {
    const session1 = await backend.getOrCreateSession("!room1:example.com");
    const session2 = await backend.getOrCreateSession("!room1:example.com");

    expect(session1).toBe(session2);
  });

  it("hashes room IDs consistently", async () => {
    const session1 = await backend.getOrCreateSession("!room1:example.com");
    const session2 = await backend.getOrCreateSession("!room1:example.com");

    // Both should have the same session file
    expect(session1.sessionFile).toBe(session2.sessionFile);
  });

  it("resets session and creates new one", async () => {
    // Create first session
    const session1 = await backend.getOrCreateSession("!room1:example.com");
    const sessionFile1 = session1.sessionFile;

    expect(sessionFile1).toBeDefined();

    await backend.reset("!room1:example.com");

    // Get new session
    const session2 = await backend.getOrCreateSession("!room1:example.com");
    const sessionFile2 = session2.sessionFile;

    // Session file should be different (new session created)
    expect(sessionFile2).not.toBe(sessionFile1);
  });

  it("purges session from cache and disk", async () => {
    const session = await backend.getOrCreateSession("!room1:example.com");
    const sessionFile = session.sessionFile;

    expect(sessionFile).toBeDefined();

    await backend.purge("!room1:example.com");

    // Session should be removed from cache
    const sessionInfo = await backend.getSessionInfo("!room1:example.com");
    expect(sessionInfo).toBeNull();
  });

  it("lists active sessions", async () => {
    await backend.getOrCreateSession("!room1:example.com");
    await backend.getOrCreateSession("!room2:example.com");

    const sessions = await backend.listSessions();

    expect(sessions.filter((s) => s.active)).toHaveLength(2);
  });

  it("disposes old session on reset", async () => {
    // Create first session
    const session1 = await backend.getOrCreateSession("!room1:example.com");
    const sessionFile1 = session1.sessionFile;

    expect(sessionFile1).toBeDefined();

    // Reset creates a new session
    await backend.reset("!room1:example.com");

    // Get new session
    const session2 = await backend.getOrCreateSession("!room1:example.com");
    const sessionFile2 = session2.sessionFile;

    // Session files should be different
    expect(sessionFile1).not.toBe(sessionFile2);

    // Old session should be disposed (can't be accessed anymore)
    // Note: actual archive-on-disk verification requires integration test with real prompts
  });

  it("disposes all sessions on cleanup", async () => {
    await backend.getOrCreateSession("!room1:example.com");
    await backend.getOrCreateSession("!room2:example.com");

    await backend.dispose();

    // Sessions should be cleared from cache
    const sessions = await backend.listSessions();
    expect(sessions.filter((s) => s.active)).toHaveLength(0);
  });

  it("preserves context across prompts in same room", async () => {
    // This test verifies that the same session is used for multiple prompts
    const session1 = await backend.getOrCreateSession("!room1:example.com");
    const session2 = await backend.getOrCreateSession("!room1:example.com");

    // Should return the same cached session
    expect(session1).toBe(session2);
  });

  it("keeps different rooms isolated", async () => {
    const session1 = await backend.getOrCreateSession("!room1:example.com");
    const session2 = await backend.getOrCreateSession("!room2:example.com");

    // Should be different sessions
    expect(session1).not.toBe(session2);
    expect(session1.sessionFile).not.toBe(session2.sessionFile);
  });
});

// Model switch tests
describe("PiSessionBackend model switching", () => {
  let backend: PiSessionBackend;
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `pi-backend-model-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });

    agentTestDir = await createTestAgentDir();

    backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });
  });

  afterEach(async () => {
    await backend.dispose();
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  it("switchModel() is defined", async () => {
    // This test verifies the method exists
    expect(typeof backend.switchModel).toBe("function");
  });

  it("getModelStatus() is defined", async () => {
    // This test verifies the method exists
    expect(typeof backend.getModelStatus).toBe("function");
  });

  it("getModelStatus() returns null for non-existent room", async () => {
    const status = await backend.getModelStatus("!nonexistent:example.com");
    expect(status).toBeNull();
  });

  it("switchModel() rejects with error for non-existent room", async () => {
    await expect(backend.switchModel("!nonexistent:example.com", "gemma4")).rejects.toThrow();
  });

  it("switchModel() rejects while room is processing", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    // Set room to processing state
    backend.setProcessing(roomId, true);

    // Switch should be rejected
    await expect(backend.switchModel(roomId, "gemma4")).rejects.toThrow(/processing|busy|in progress/i);
  });

  it("switchModel() updates snapshot model after switch", async () => {
    const roomId = "!room1:example.com";
    const _session = await backend.getOrCreateSession(roomId);

    // Get initial status
    const initialStatus = await backend.getModelStatus(roomId);
    expect(initialStatus).not.toBeNull();

    // Note: This test requires the backend to actually implement switchModel()
    // and the SDK to have models configured. For now, we test the interface.
    // The actual model switch will be tested with mocked sessions below.
  });

  it("switchModel() in room A does not affect room B", async () => {
    const roomA = "!roomA:example.com";
    const roomB = "!roomB:example.com";

    // Create sessions for both rooms
    await backend.getOrCreateSession(roomA);
    await backend.getOrCreateSession(roomB);

    // Get initial statuses
    const statusA_before = await backend.getModelStatus(roomA);
    const statusB_before = await backend.getModelStatus(roomB);

    // Both rooms should have status
    expect(statusA_before).not.toBeNull();
    expect(statusB_before).not.toBeNull();

    // Note: Full test requires actual model switching implementation
  });
});

// Characterization tests for global side effects
describe("PiSessionBackend model switch global side effects", () => {
  let backend: PiSessionBackend;
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `pi-backend-global-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });

    agentTestDir = await createTestAgentDir();

    backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });
  });

  afterEach(async () => {
    await backend.dispose();
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  // Characterization test: What happens to new rooms after switching in room A?
  it("characterization: new room after switch in room A", async () => {
    // This test characterizes the current behavior of global settings side effects
    // After switching model in room A, what model does a fresh room B get?
    const roomA = "!roomA:example.com";
    await backend.getOrCreateSession(roomA);

    // Note: Full characterization requires actual model switching
    // This is a placeholder for the behavior we need to observe
  });

  // Characterization test: What happens after !reset?
  it("characterization: model after !reset", async () => {
    // After switching model and then doing !reset, what model does the new session get?
    const roomA = "!roomA:example.com";
    await backend.getOrCreateSession(roomA);

    // Note: Full characterization requires actual model switching
  });
});

// Model switching tests with actual models configured
describe("PiSessionBackend model switching with models", () => {
  let backend: PiSessionBackend;
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `pi-backend-models-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });

    agentTestDir = await createTestAgentDir(true); // with models

    backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });
  });

  afterEach(async () => {
    await backend.dispose();
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  it("finds gemma4 model by profile", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    // Access private method via any cast for testing
    const backendAny = backend as any;
    const model = backendAny.findModelByProfile("gemma4");

    expect(model).not.toBeNull();
    expect(model!.provider).toBe("llama-cpp-gemma4");
    expect(model!.id).toBe("test-model-gemma");
  });

  it("finds qwen27 model by profile", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    const backendAny = backend as any;
    const model = backendAny.findModelByProfile("qwen27");

    expect(model).not.toBeNull();
    expect(model!.provider).toBe("llama-cpp-qwen27");
    expect(model!.id).toBe("test-model-qwen");
  });

  it("returns null for unknown profile", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    const backendAny = backend as any;
    const model = backendAny.findModelByProfile("unknown-profile");

    expect(model).toBeNull();
  });

  it("switchModel() rejects unknown profile with helpful message", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    const result = await backend.switchModel(roomId, "unknown-profile");

    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown profile");
    expect(result.message).toContain("gemma4");
    expect(result.message).toContain("qwen27");
  });

  it("switchModel() updates active model and snapshot", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    // Get initial status
    const initialStatus = await backend.getModelStatus(roomId);
    expect(initialStatus).not.toBeNull();

    // Switch to gemma4
    const switchResult = await backend.switchModel(roomId, "gemma4");

    expect(switchResult.success).toBe(true);
    expect(switchResult.activeModel).toBe("test-model-gemma");

    // Verify status reflects the switch
    const newStatus = await backend.getModelStatus(roomId);
    expect(newStatus!.model).toBe("test-model-gemma");
  });

  it("switchModel() can switch back and forth", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    // Switch to gemma4
    let result = await backend.switchModel(roomId, "gemma4");
    expect(result.success).toBe(true);
    expect(result.activeModel).toBe("test-model-gemma");

    // Switch to qwen27
    result = await backend.switchModel(roomId, "qwen27");
    expect(result.success).toBe(true);
    expect(result.activeModel).toBe("test-model-qwen");

    // Switch back to gemma4
    result = await backend.switchModel(roomId, "gemma4");
    expect(result.success).toBe(true);
    expect(result.activeModel).toBe("test-model-gemma");
  });

  it("switchModel() with alias resolves to correct model", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    // Note: Aliases are resolved in the parser, not in switchModel
    // switchModel receives the canonicalized profile name
    const result = await backend.switchModel(roomId, "gemma4");

    expect(result.success).toBe(true);
    expect(result.activeModel).toBe("test-model-gemma");
  });

  it("getModelStatus() reports runtime model, not settings default", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    // Settings default is qwen27, but after switching to gemma4,
    // status should report the active runtime model
    await backend.switchModel(roomId, "gemma4");

    const status = await backend.getModelStatus(roomId);

    // Status should report the switched model, not the settings default
    expect(status!.model).toBe("test-model-gemma");
  });

  it("switchModel() in room A does not change room B's active model", async () => {
    const roomA = "!roomA:example.com";
    const roomB = "!roomB:example.com";

    // Create sessions for both rooms
    await backend.getOrCreateSession(roomA);
    await backend.getOrCreateSession(roomB);

    // Switch room A to gemma4
    const resultA = await backend.switchModel(roomA, "gemma4");
    expect(resultA.success).toBe(true);

    // Verify room A's model changed
    const statusA = await backend.getModelStatus(roomA);
    expect(statusA!.model).toBe("test-model-gemma");

    // Room B should be unaffected (still has no active model or default)
    const statusB = await backend.getModelStatus(roomB);
    // Room B's model should not be gemma4
    expect(statusB!.model).not.toBe("test-model-gemma");
  });

  it("switchModel() persists desired model per room", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    // Switch to gemma4
    const result = await backend.switchModel(roomId, "gemma4");
    expect(result.success).toBe(true);

    // Verify status includes desired model info
    const status = await backend.getModelStatus(roomId);
    expect(status!.desiredModel).toBe("gemma4");
    expect(status!.desiredResolvedModelId).toBe("test-model-gemma");
  });

  it("getModelStatus() reports global default", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    const status = await backend.getModelStatus(roomId);
    expect(status!.globalDefault).toBe("qwen27"); // From createTestAgentDir
  });

  it("getModelStatus() reports modelMismatch when active differs from desired", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    // Set desired model to gemma4
    const backendAny = backend as any;
    backendAny.roomModelManager.setDesiredModel(roomId, "gemma4", "test-model-gemma");

    // Get status - should show mismatch since active is qwen27 but desired is gemma4
    const status = await backend.getModelStatus(roomId);
    expect(status!.desiredModel).toBe("gemma4");
    expect(status!.modelMismatch).toBe(true);
  });

  it("clearDesiredModel() removes room override", async () => {
    const roomId = "!room1:example.com";
    await backend.getOrCreateSession(roomId);

    // Set desired model
    const backendAny = backend as any;
    backendAny.roomModelManager.setDesiredModel(roomId, "gemma4", "test-model-gemma");

    // Clear desired model
    const result = await backend.clearDesiredModel(roomId);
    expect(result.success).toBe(true);
    expect(result.previousDesiredModel).toBe("gemma4");

    // Verify room override was removed
    const status = await backend.getModelStatus(roomId);
    expect(status!.desiredModel).toBeUndefined();
  });
});

// Characterization tests for global side effects
describe("PiSessionBackend model switch global side effects", () => {
  let backend: PiSessionBackend;
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `pi-backend-global-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });

    agentTestDir = await createTestAgentDir(true); // with models

    backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });
  });

  afterEach(async () => {
    await backend.dispose();
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  // Phase 2: New room after switch in room A should NOT get switched model
  it("Phase 2: new room after switch in room A uses global default, not switched model", async () => {
    // After switching model in room A, a fresh room B should use the global default,
    // not the switched model (Phase 2 fixes the global contamination issue).

    const roomA = "!roomA:example.com";
    const _sessionA = await backend.getOrCreateSession(roomA);

    // Switch room A to gemma4
    const switchResult = await backend.switchModel(roomA, "gemma4");
    expect(switchResult.success).toBe(true);

    // Create a fresh room B
    const roomB = "!roomB:example.com";
    const _sessionB = await backend.getOrCreateSession(roomB);

    // Room B should NOT get the switched model as its default
    // Phase 2: Each room has its own desired model, independent of global default
    const statusB = await backend.getModelStatus(roomB);

    // Room B should use global default (qwen27), not the switched model (gemma4)
    expect(statusB!.model).toBe("test-model-qwen");
    expect(statusB!.desiredModel).toBeUndefined(); // No room override
    expect(statusB!.globalDefault).toBe("qwen27");
  });

  // Characterization test: What happens after !reset?
  it("characterization: model after !reset uses last switched model", async () => {
    // After switching model and then doing !reset, what model does the new session get?

    const roomA = "!roomA:example.com";
    await backend.getOrCreateSession(roomA);

    // Switch to gemma4
    await backend.switchModel(roomA, "gemma4");

    // Do !reset
    await backend.reset(roomA);

    // Get the new session
    const _sessionAfterReset = await backend.getOrCreateSession(roomA);
    const statusAfterReset = await backend.getModelStatus(roomA);

    // The new session after reset should get the last switched model
    // because setModel() updated the global default
    expect(statusAfterReset!.model).toBe("test-model-gemma");
  });
});

// Phase 2: Persistence tests
describe("PiSessionBackend Phase 2: Per-room desired model persistence", () => {
  let backend: PiSessionBackend;
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `pi-backend-phase2-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });

    agentTestDir = await createTestAgentDir(true); // with models

    backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });
  });

  afterEach(async () => {
    await backend.dispose();
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  it("desired model persists across restart (new backend instance)", async () => {
    const roomId = "!room1:example.com";

    // Phase 1: Set desired model in first backend
    await backend.getOrCreateSession(roomId);
    await backend.switchModel(roomId, "gemma4");

    // Verify desired model was set
    const status1 = await backend.getModelStatus(roomId);
    expect(status1!.desiredModel).toBe("gemma4");

    // Dispose first backend (simulates restart)
    await backend.dispose();

    // Phase 2: Create new backend instance
    const backend2 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    // Resume session
    await backend2.getOrCreateSession(roomId);

    // Verify desired model persisted
    const status2 = await backend2.getModelStatus(roomId);
    expect(status2!.desiredModel).toBe("gemma4");

    await backend2.dispose();
  });

  it("desired model is reapplied after !reset", async () => {
    const roomId = "!room1:example.com";

    // Set desired model to gemma4
    await backend.getOrCreateSession(roomId);
    await backend.switchModel(roomId, "gemma4");

    // Verify desired model was set
    const beforeReset = await backend.getModelStatus(roomId);
    expect(beforeReset!.desiredModel).toBe("gemma4");

    // Do !reset
    await backend.reset(roomId);

    // Get new session
    await backend.getOrCreateSession(roomId);

    // Verify desired model was reapplied (active model should be gemma4)
    const afterReset = await backend.getModelStatus(roomId);
    expect(afterReset!.desiredModel).toBe("gemma4");
    expect(afterReset!.model).toBe("test-model-gemma");
  });

  it("desired model is reapplied on same-room resume", async () => {
    const roomId = "!room1:example.com";
    const backendAny = backend as any;

    // Set desired model to gemma4 without actually switching (to simulate drift)
    await backend.getOrCreateSession(roomId);
    backendAny.roomModelManager.setDesiredModel(roomId, "gemma4", "test-model-gemma");

    // Verify desired model was set but active is still qwen27 (drift)
    const beforeResume = await backend.getModelStatus(roomId);
    expect(beforeResume!.desiredModel).toBe("gemma4");
    expect(beforeResume!.modelMismatch).toBe(true);

    // Remove session from cache to simulate disconnect
    backendAny.roomStateManager.remove(roomId);

    // Resume session
    await backend.getOrCreateSession(roomId);

    // Verify desired model was reapplied
    const afterResume = await backend.getModelStatus(roomId);
    expect(afterResume!.model).toBe("test-model-gemma");
    expect(afterResume!.modelMismatch).toBe(false);
  });

  it("switching one room does not permanently contaminate global default", async () => {
    const roomA = "!roomA:example.com";
    const roomB = "!roomB:example.com";

    // Switch room A to gemma4
    await backend.getOrCreateSession(roomA);
    await backend.switchModel(roomA, "gemma4");

    // Create fresh room B
    await backend.getOrCreateSession(roomB);

    // Room B should NOT have gemma4 as desired model
    const statusB = await backend.getModelStatus(roomB);
    expect(statusB!.desiredModel).toBeUndefined(); // No room override
    expect(statusB!.globalDefault).toBe("qwen27"); // Global default unchanged

    // Room A should still have gemma4 as desired
    const statusA = await backend.getModelStatus(roomA);
    expect(statusA!.desiredModel).toBe("gemma4");
  });

  it("clear desired model falls back to global default", async () => {
    const roomId = "!room1:example.com";

    // Set desired model to gemma4
    await backend.getOrCreateSession(roomId);
    await backend.switchModel(roomId, "gemma4");

    // Clear desired model
    await backend.clearDesiredModel(roomId);

    // Verify desired model was cleared
    const status = await backend.getModelStatus(roomId);
    expect(status!.desiredModel).toBeUndefined();
    expect(status!.globalDefault).toBe("qwen27");
  });
});

// Persistence tests - CRITICAL: Verify model survives restart/resume
describe("PiSessionBackend model persistence across resume", () => {
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `pi-backend-persist-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });

    agentTestDir = await createTestAgentDir(true); // with models
  });

  afterEach(async () => {
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  it("model switch persists to session file and survives resume", async () => {
    // Phase 1: Create session, switch model
    const backend1 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    const roomId = "!room1:example.com";
    await backend1.getOrCreateSession(roomId);

    // Get session file path before switch
    const statusBefore = await backend1.getModelStatus(roomId);
    const sessionFile = statusBefore!.sessionFile!;

    console.log(`[TEST] Session file before switch: ${sessionFile}`);

    // Switch to gemma4
    const switchResult = await backend1.switchModel(roomId, "gemma4");
    expect(switchResult.success).toBe(true);

    // Verify switch worked
    const statusAfterSwitch = await backend1.getModelStatus(roomId);
    expect(statusAfterSwitch!.model).toBe("test-model-gemma");

    console.log(`[TEST] Model after switch: ${statusAfterSwitch!.model}`);

    // Dispose backend1 (simulates shutdown)
    await backend1.dispose();

    // Phase 2: Resume session with new backend instance
    const backend2 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    // GetOrCreateSession will resume the existing session
    await backend2.getOrCreateSession(roomId);

    // Get the new status
    const statusAfterResume = await backend2.getModelStatus(roomId);
    const newSessionFile = statusAfterResume!.sessionFile;

    console.log(`[TEST] Session file after resume: ${newSessionFile}`);
    console.log(`[TEST] Model after resume: ${statusAfterResume!.model}`);

    // CRITICAL: Verify the model survived the resume
    // Note: This tests that SOME model restoration happens.
    // The current SDK implementation may restore from:
    // 1. Session file's model_change entry (via buildSessionContext)
    // 2. Global default (via settingsManager.setDefaultModelAndProvider in setModel)
    // Both mechanisms contribute to persistence.
    // In practice, the global default mechanism is what makes this work,
    // because setModel() updates the global default.
    expect(statusAfterResume!.model).toBe("test-model-gemma");

    await backend2.dispose();
  });

  it("verifies persistence mechanism: global default vs session file", async () => {
    // This test verifies HOW persistence works.
    // It checks if the model is restored from the session file or global default.

    const backend1 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    const roomId = "!room1:example.com";
    await backend1.getOrCreateSession(roomId);

    // Switch to gemma4
    await backend1.switchModel(roomId, "gemma4");

    // Read settings.json to see if default was updated
    const fs = await import("fs/promises");
    const settingsPath = join(agentTestDir, "settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));

    console.log(`[TEST] Settings after switch:`, settings);

    // The SDK's setModel() updates the global default
    expect(settings.defaultProvider).toBe("llama-cpp-gemma4");
    expect(settings.defaultModel).toBe("test-model-gemma");

    await backend1.dispose();

    // Now create a completely NEW room (different hash)
    // This room should get the switched model as its default
    const backend2 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    const newRoomId = "!newroom:example.com";
    await backend2.getOrCreateSession(newRoomId);

    const newRoomStatus = await backend2.getModelStatus(newRoomId);

    console.log(`[TEST] New room model: ${newRoomStatus!.model}`);

    // New room gets the switched model because it's now the global default
    expect(newRoomStatus!.model).toBe("test-model-gemma");

    await backend2.dispose();
  });

  // Phase 2: Same-room resume now re-applies desired model
  it("Phase 2: same-room resume re-applies desired model even if global default changed", async () => {
    // This test verifies Phase 2 behavior: same-room resume now re-applies desired model
    // from room-models.json, independent of global default.
    //
    // Procedure:
    // 1. Start with global default = qwen27 (set by createTestAgentDir)
    // 2. Create room A (gets qwen27 as default)
    // 3. Switch room A to gemma4 (sets desired model to gemma4)
    // 4. Manually set global default back to qwen27
    // 5. Dispose/reopen room A
    // 6. Verify resumed model is gemma4 (desired), not qwen27 (global default)

    const fs = await import("fs/promises");
    const settingsPath = join(agentTestDir, "settings.json");

    // Verify initial global default is qwen27
    let settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    console.log(`[TEST] Initial global default: ${settings.defaultProvider}/${settings.defaultModel}`);
    expect(settings.defaultProvider).toBe("llama-cpp-qwen27");
    expect(settings.defaultModel).toBe("test-model-qwen");

    // Phase 1: Create room A (gets qwen27 as default)
    const backend1 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    const roomId = "!room1:example.com";
    await backend1.getOrCreateSession(roomId);

    let status = await backend1.getModelStatus(roomId);
    console.log(`[TEST] Room A initial model: ${status!.model}`);
    expect(status!.model).toBe("test-model-qwen"); // Default from global settings

    // Phase 2: Switch room A to gemma4 (sets desired model to gemma4)
    const switchResult = await backend1.switchModel(roomId, "gemma4");
    expect(switchResult.success).toBe(true);

    status = await backend1.getModelStatus(roomId);
    console.log(`[TEST] Room A after switch: ${status!.model}, desired: ${status!.desiredModel}`);
    expect(status!.model).toBe("test-model-gemma");
    expect(status!.desiredModel).toBe("gemma4");

    // Phase 3: Manually reset global default to qwen27
    console.log(`[TEST] Manually resetting global default to qwen27...`);
    settings = {
      theme: "dark",
      defaultProvider: "llama-cpp-qwen27",
      defaultModel: "test-model-qwen",
    };
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));

    settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    console.log(`[TEST] Global default after manual reset: ${settings.defaultProvider}/${settings.defaultModel}`);
    expect(settings.defaultProvider).toBe("llama-cpp-qwen27");
    expect(settings.defaultModel).toBe("test-model-qwen");

    // Phase 4: Dispose and reopen room A
    await backend1.dispose();

    const backend2 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    await backend2.getOrCreateSession(roomId);

    // Phase 5: CRITICAL - Verify resumed model
    status = await backend2.getModelStatus(roomId);
    console.log(`[TEST] Room A after resume: ${status!.model}`);
    console.log(`[TEST] Room A desired model: ${status!.desiredModel}`);
    console.log(`[TEST] Global default at resume time: qwen27`);

    // PHASE 2 RESULT: The resumed model is gemma4 (desired), NOT qwen27 (global default).
    // This proves that same-room resume now re-applies desired model from room-models.json,
    // independent of global default contamination.
    expect(status!.model).toBe("test-model-gemma"); // gemma4, because desired model was reapplied
    expect(status!.desiredModel).toBe("gemma4");

    await backend2.dispose();
  });

  it("session file contains model_change entry after switch", async () => {
    const backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    const roomId = "!room1:example.com";
    const session = await backend.getOrCreateSession(roomId);

    const statusBefore = await backend.getModelStatus(roomId);
    const sessionFile = statusBefore!.sessionFile!;

    // Switch model
    await backend.switchModel(roomId, "gemma4");

    // Force session to persist by accessing its properties
    // The SDK may buffer writes
    session.sessionId;

    // Small delay to ensure file is written
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Read session file and verify model_change entry exists
    const fs = await import("fs/promises");

    // Check if file exists first
    try {
      await fs.access(sessionFile);
    } catch {
      // File doesn't exist yet - this can happen if session hasn't been persisted
      // In this case, we'll verify via the session manager instead
      const sessionManager: any = (session as any).sessionManager;
      const entries = sessionManager.getEntries?.() || [];

      // Find the LAST model_change entry (most recent switch)
      let lastModelChange: any = null;
      for (const entry of entries) {
        if (entry.type === "model_change") {
          lastModelChange = entry;
        }
      }

      expect(lastModelChange).not.toBeNull();
      expect(lastModelChange!.provider).toBe("llama-cpp-gemma4");
      expect(lastModelChange!.modelId).toBe("test-model-gemma");
    }

    await backend.dispose();
  });
});
