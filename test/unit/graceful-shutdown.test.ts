import { mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiSessionBackend } from "../../src/pi-backend.js";
import { RoomStateManager } from "../../src/room-state.js";

describe("Graceful Shutdown - Resource Cleanup", () => {
  let backend: PiSessionBackend;
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `shutdown-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });

    agentTestDir = join(tmpdir(), `agent-shutdown-test-${Date.now()}`);
    await mkdir(agentTestDir, { recursive: true });

    // Create minimal agent config
    const fs = await import("fs/promises");
    await fs.writeFile(
      join(agentTestDir, "settings.json"),
      JSON.stringify({ theme: "dark", defaultProvider: "llama-cpp-qwen27", defaultModel: "test-model" }),
    );
    await fs.writeFile(join(agentTestDir, "models.json"), JSON.stringify({ providers: {}, models: [] }));
    await fs.writeFile(join(agentTestDir, "auth.json"), JSON.stringify({ providers: {} }));

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

  it("dispose() clears all live room state", async () => {
    // Create sessions for multiple rooms
    const room1 = "!room1:example.com";
    const room2 = "!room2:example.com";
    await backend.getOrCreateSession(room1);
    await backend.getOrCreateSession(room2);

    // Verify sessions exist
    expect(backend.listLiveRooms()).toHaveLength(2);

    // Dispose
    await backend.dispose();

    // Verify all sessions cleared
    expect(backend.listLiveRooms()).toHaveLength(0);
  });

  it("dispose() clears processing state for all rooms", async () => {
    const room1 = "!room1:example.com";
    await backend.getOrCreateSession(room1);

    // Set room to processing state
    backend.setProcessing(room1, true);

    // Verify processing state is set
    expect(backend.checkProcessingGuard(room1)).not.toBeNull();

    // Dispose
    await backend.dispose();

    // After dispose, room should no longer exist (and thus not be processing)
    expect(backend.checkProcessingGuard(room1)).toBeNull();
  });

  it("dispose() can be called multiple times without error", async () => {
    await backend.getOrCreateSession("!room1:example.com");

    // First dispose
    await backend.dispose();

    // Second dispose should not throw
    await expect(backend.dispose()).resolves.not.toThrow();
  });
});

describe("RoomStateManager - Cleanup Methods", () => {
  let manager: RoomStateManager;

  beforeEach(() => {
    manager = new RoomStateManager();
  });

  afterEach(() => {
    // Clear without disposing to avoid issues with mock sessions
    manager.listLive().forEach((state) => {
      if (state.typingTimeout) {
        clearTimeout(state.typingTimeout);
      }
    });
    (manager as any).live.clear();
  });

  it("disposeAll() clears all rooms and stops typing timeouts", async () => {
    const mockSession1 = { dispose: vi.fn() } as any;
    const mockSession2 = { dispose: vi.fn() } as any;

    manager.getOrCreate("!room1:example.com", mockSession1);
    manager.getOrCreate("!room2:example.com", mockSession2);

    expect(manager.listLive()).toHaveLength(2);

    manager.disposeAll();

    expect(manager.listLive()).toHaveLength(0);
    expect(mockSession1.dispose).toHaveBeenCalled();
    expect(mockSession2.dispose).toHaveBeenCalled();
  });

  it("dispose() clears typing timeout for a single room", async () => {
    const mockSession = { dispose: vi.fn() } as any;
    const state = manager.getOrCreate("!room1:example.com", mockSession);

    // Set a typing timeout
    state.typingTimeout = setTimeout(() => {}, 1000) as any;

    manager.dispose("!room1:example.com");

    expect(manager.listLive()).toHaveLength(0);
    expect(mockSession.dispose).toHaveBeenCalled();
  });

  it("remove() clears typing timeout but doesn't dispose session", async () => {
    const mockSession = { dispose: vi.fn() } as any;
    const state = manager.getOrCreate("!room1:example.com", mockSession);

    // Set a typing timeout
    state.typingTimeout = setTimeout(() => {}, 1000) as any;

    manager.remove("!room1:example.com");

    expect(manager.listLive()).toHaveLength(0);
    expect(mockSession.dispose).not.toHaveBeenCalled();
  });

  it("clearAllProcessing() clears processing state for all rooms", async () => {
    const mockSession1 = { dispose: vi.fn() } as any;
    const mockSession2 = { dispose: vi.fn() } as any;

    const state1 = manager.getOrCreate("!room1:example.com", mockSession1);
    const state2 = manager.getOrCreate("!room2:example.com", mockSession2);

    // Set both rooms to processing
    state1.isProcessing = true;
    state1.processingStartedAt = new Date();
    state2.isProcessing = true;
    state2.processingStartedAt = new Date();

    // Set typing timeouts
    state1.typingTimeout = setTimeout(() => {}, 1000) as any;
    state2.typingTimeout = setTimeout(() => {}, 1000) as any;

    expect(manager.isProcessing("!room1:example.com")).toBe(true);
    expect(manager.isProcessing("!room2:example.com")).toBe(true);

    manager.clearAllProcessing();

    expect(manager.isProcessing("!room1:example.com")).toBe(false);
    expect(manager.isProcessing("!room2:example.com")).toBe(false);
    expect(state1.processingStartedAt).toBeUndefined();
    expect(state2.processingStartedAt).toBeUndefined();
  });
});

describe("ControlServer - HTTP Server Shutdown", () => {
  it("HTTP server can be closed without hanging", async () => {
    // This is a characterization test to verify the HTTP server can be closed
    const http = await import("http");

    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end("OK");
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
      server.on("error", reject);
    });

    // Close the server
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    expect(true).toBe(true); // If we get here, it didn't hang
  });
});

// Rehydration tests
import { RoomModelManager } from "../../src/room-model-manager.js";

describe("RoomModelManager - Source of Truth for Rehydration", () => {
  let agentTestDir: string;

  beforeEach(async () => {
    agentTestDir = join(tmpdir(), `room-model-test-${Date.now()}`);
    await mkdir(agentTestDir, { recursive: true });

    const fs = await import("fs/promises");
    await fs.writeFile(
      join(agentTestDir, "settings.json"),
      JSON.stringify({ theme: "dark", defaultProvider: "llama-cpp-qwen27", defaultModel: "test-model" }),
    );
    await fs.writeFile(join(agentTestDir, "models.json"), JSON.stringify({ providers: {}, models: [] }));
    await fs.writeFile(join(agentTestDir, "auth.json"), JSON.stringify({ providers: {} }));
  });

  afterEach(async () => {
    await rm(agentTestDir, { recursive: true, force: true });
  });

  it("stores room-model mapping with roomId keys", async () => {
    const manager = new RoomModelManager(agentTestDir);

    // Set desired model for a room (using roomId as key)
    const roomId = "!room1:example.com";
    manager.setDesiredModel(roomId, "qwen36", "test-model-qwen36");

    // Verify it's stored
    const desiredModel = manager.getDesiredModel(roomId);
    expect(desiredModel).toBeDefined();
    expect(desiredModel!.desiredModel).toBe("qwen36");
    expect(desiredModel!.resolvedModelId).toBe("test-model-qwen36");
  });

  it("persisted room-models.json contains all rooms with desired model overrides", async () => {
    const fs = await import("fs/promises");
    const manager = new RoomModelManager(agentTestDir);

    // Set desired models for multiple rooms
    manager.setDesiredModel("!room1:example.com", "qwen36", "test-model-qwen36");
    manager.setDesiredModel("!room2:example.com", "qwen27", "test-model-qwen");

    // Read the persisted file directly
    const content = await fs.readFile(join(agentTestDir, "room-models.json"), "utf-8");
    const data = JSON.parse(content);

    // Verify both rooms are stored
    expect(data.rooms["!room1:example.com"]).toBeDefined();
    expect(data.rooms["!room2:example.com"]).toBeDefined();
    expect(Object.keys(data.rooms)).toHaveLength(2);
  });

  it("can enumerate all rooms with desired model overrides", async () => {
    const manager = new RoomModelManager(agentTestDir);

    // Set desired models for multiple rooms
    manager.setDesiredModel("!room1:example.com", "qwen36", "test-model-qwen36");
    manager.setDesiredModel("!room2:example.com", "qwen27", "test-model-qwen");
    manager.setDesiredModel("!room3:example.com", "qwen36", "test-model-qwen36");

    // Access internal store for testing
    const store = (manager as any).store;

    // Verify we can enumerate all rooms with overrides
    const roomIdsWithOverrides = Object.keys(store.rooms);
    expect(roomIdsWithOverrides).toHaveLength(3);
    expect(roomIdsWithOverrides).toContain("!room1:example.com");
    expect(roomIdsWithOverrides).toContain("!room2:example.com");
    expect(roomIdsWithOverrides).toContain("!room3:example.com");
  });
});

describe("Rehydration - RoomKey to RoomId Mapping", () => {
  let agentTestDir: string;

  beforeEach(async () => {
    agentTestDir = join(tmpdir(), `rehydration-test-${Date.now()}`);
    await mkdir(agentTestDir, { recursive: true });

    const fs = await import("fs/promises");
    await fs.writeFile(
      join(agentTestDir, "settings.json"),
      JSON.stringify({ theme: "dark", defaultProvider: "llama-cpp-qwen27", defaultModel: "test-model" }),
    );
    await fs.writeFile(join(agentTestDir, "models.json"), JSON.stringify({ providers: {}, models: [] }));
    await fs.writeFile(join(agentTestDir, "auth.json"), JSON.stringify({ providers: {} }));
  });

  afterEach(async () => {
    await rm(agentTestDir, { recursive: true, force: true });
  });

  it("room key can be derived from roomId using consistent hash", async () => {
    const roomId = "!room1:example.com";
    const roomKey1 = RoomStateManager.hashRoomId(roomId);
    const roomKey2 = RoomStateManager.hashRoomId(roomId);

    // Hash should be consistent
    expect(roomKey1).toBe(roomKey2);
    expect(roomKey1).toBeDefined();
    expect(roomKey1.length).toBeGreaterThan(0);
  });

  it("different roomIds produce different roomKeys", async () => {
    const roomKey1 = RoomStateManager.hashRoomId("!room1:example.com");
    const roomKey2 = RoomStateManager.hashRoomId("!room2:example.com");

    expect(roomKey1).not.toBe(roomKey2);
  });
});

// Test for the rehydration mechanism that will be added
describe("Rehydration - Control Plane Discovery", () => {
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `rehydration-control-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });

    agentTestDir = join(tmpdir(), `agent-rehydration-test-${Date.now()}`);
    await mkdir(agentTestDir, { recursive: true });

    const fs = await import("fs/promises");
    await fs.writeFile(
      join(agentTestDir, "settings.json"),
      JSON.stringify({ theme: "dark", defaultProvider: "llama-cpp-qwen27", defaultModel: "test-model" }),
    );
    await fs.writeFile(join(agentTestDir, "models.json"), JSON.stringify({ providers: {}, models: [] }));
    await fs.writeFile(join(agentTestDir, "auth.json"), JSON.stringify({ providers: {} }));
  });

  afterEach(async () => {
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  // This test validates the new rehydration behavior
  it("rehydration: persisted room is discoverable via getRoomIdByRoomKey after 'restart'", async () => {
    // Phase 1: Set up a room with desired model
    const backend1 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    const roomId = "!room1:example.com";
    await backend1.getOrCreateSession(roomId);

    // Set desired model
    (backend1 as any).roomModelManager.setDesiredModel(roomId, "qwen36", "test-model-qwen36");

    await backend1.dispose();

    // Phase 2: Simulate restart - new backend instance
    const backend2 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    // NEW BEHAVIOR: Room should be discoverable via getRoomIdByRoomKey
    const roomKey = RoomStateManager.hashRoomId(roomId);
    const foundRoomId = backend2.getRoomIdByRoomKey(roomKey);

    // This should now work - the room ID should be resolvable from the roomKey
    expect(foundRoomId).toBe(roomId);

    // Also verify that the desired model is accessible
    const desiredModel = backend2.getDesiredModelForRoom(roomId);
    expect(desiredModel).toBeDefined();
    expect(desiredModel!.desiredModel).toBe("qwen36");

    await backend2.dispose();
  });

  // This test validates that model status works for persisted rooms
  it("rehydration: getModelStatusOrRehydrate returns status for persisted room", async () => {
    // Phase 1: Set up a room with desired model
    const backend1 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    const roomId = "!room1:example.com";
    await backend1.getOrCreateSession(roomId);

    // Set desired model
    (backend1 as any).roomModelManager.setDesiredModel(roomId, "qwen36", "test-model-qwen36");

    await backend1.dispose();

    // Phase 2: Simulate restart - new backend instance
    const backend2 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    // Use the rehydration-aware status method
    const status = await backend2.getModelStatusOrRehydrate(roomId);

    // Status should be available even though room is not live
    expect(status).not.toBeNull();
    expect(status!.desiredModel).toBe("qwen36");
    expect(status!.desiredResolvedModelId).toBe("test-model-qwen36");

    await backend2.dispose();
  });

  // This test validates that on-demand rehydration works
  it("rehydration: on-demand rehydration makes room live via getModelStatusOrRehydrate", async () => {
    // Phase 1: Set up a room with desired model
    const backend1 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    const roomId = "!room1:example.com";
    await backend1.getOrCreateSession(roomId);

    // Set desired model
    (backend1 as any).roomModelManager.setDesiredModel(roomId, "qwen36", "test-model-qwen36");

    await backend1.dispose();

    // Phase 2: Simulate restart - new backend instance
    const backend2 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    // Verify room is not live initially
    expect(backend2.getSessionByKey(RoomStateManager.hashRoomId(roomId))).toBeUndefined();

    // Call getModelStatusOrRehydrate which should rehydrate the room
    const status = await backend2.getModelStatusOrRehydrate(roomId);

    // Status should be available
    expect(status).not.toBeNull();
    expect(status!.desiredModel).toBe("qwen36");

    // Room should now be live (rehydrated)
    expect(backend2.getSessionByKey(RoomStateManager.hashRoomId(roomId))).toBeDefined();

    await backend2.dispose();
  });

  // This test validates that non-managed rooms return null
  it("rehydration: non-managed room returns null from getModelStatusOrRehydrate", async () => {
    const backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    const roomId = "!nonexistent:example.com";

    // Room has no persisted state, so status should be null
    const status = await backend.getModelStatusOrRehydrate(roomId);

    expect(status).toBeNull();

    await backend.dispose();
  });

  // This test validates the regression: !m -s works without a user message
  it("regression: status query works for persisted room without user message", async () => {
    // Phase 1: Set up a room with desired model
    const backend1 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    const roomId = "!room1:example.com";
    await backend1.getOrCreateSession(roomId);

    // Set desired model
    (backend1 as any).roomModelManager.setDesiredModel(roomId, "qwen36", "test-model-qwen36");

    await backend1.dispose();

    // Phase 2: Simulate restart - new backend instance
    const backend2 = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });

    // CRITICAL: Status query should work WITHOUT a user message first
    // This is the regression test for the "!m -s returns 'No active session'" bug
    const status = await backend2.getModelStatusOrRehydrate(roomId);

    // Should return status, not null
    expect(status).not.toBeNull();
    expect(status!.desiredModel).toBe("qwen36");

    // Room should now be live after rehydration
    const roomState = backend2.getSessionByKey(RoomStateManager.hashRoomId(roomId));
    expect(roomState).toBeDefined();

    await backend2.dispose();
  });
});
