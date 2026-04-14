import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomModelManager } from "../../src/room-model-manager.js";

// Helper to create a minimal test agentDir
async function createTestAgentDir(): Promise<string> {
  const agentDir = join(tmpdir(), `room-model-test-${Date.now()}`);
  await mkdir(agentDir, { recursive: true });

  // Create settings.json with qwen27 as default
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify(
      {
        theme: "dark",
        defaultProvider: "llama-cpp-qwen27",
        defaultModel: "test-model-qwen",
      },
      null,
      2,
    ),
  );

  // Create auth.json (empty auth)
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({ providers: {} }, null, 2));

  return agentDir;
}

describe("RoomModelManager", () => {
  let agentDir: string;
  let manager: RoomModelManager;

  beforeEach(async () => {
    agentDir = await createTestAgentDir();
    manager = new RoomModelManager(agentDir);
  });

  afterEach(async () => {
    await rm(agentDir, { recursive: true, force: true });
  });

  describe("constructor and load", () => {
    it("creates manager with empty store when no room-models.json exists", () => {
      const desired = manager.getDesiredModel("!room1:example.com");
      expect(desired).toBeUndefined();
    });

    it("loads global default from settings.json", () => {
      const globalDefault = manager.getGlobalDefault();
      expect(globalDefault).toBe("qwen27");
    });

    it("loads existing room-models.json", async () => {
      const roomModelsPath = join(agentDir, "room-models.json");
      await writeFile(
        roomModelsPath,
        JSON.stringify({
          rooms: {
            "!room1:example.com": {
              desiredModel: "gemma4",
              resolvedModelId: "test-gemma-model-id",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          },
        }),
      );

      manager = new RoomModelManager(agentDir);

      const desired = manager.getDesiredModel("!room1:example.com");
      expect(desired).toBeDefined();
      expect(desired!.desiredModel).toBe("gemma4");
      expect(desired!.resolvedModelId).toBe("test-gemma-model-id");
    });

    it("handles corrupt room-models.json gracefully", async () => {
      const roomModelsPath = join(agentDir, "room-models.json");
      await writeFile(roomModelsPath, "not valid json");

      // Should not throw
      manager = new RoomModelManager(agentDir);

      // Should fall back to empty store
      const desired = manager.getDesiredModel("!room1:example.com");
      expect(desired).toBeUndefined();
    });

    it("handles malformed room-models.json structure gracefully", async () => {
      const roomModelsPath = join(agentDir, "room-models.json");
      await writeFile(roomModelsPath, JSON.stringify({ rooms: "invalid" }));

      // Should not throw
      manager = new RoomModelManager(agentDir);

      // Should fall back to empty store
      const desired = manager.getDesiredModel("!room1:example.com");
      expect(desired).toBeUndefined();
    });

    it("filters invalid room entries while loading", async () => {
      const roomModelsPath = join(agentDir, "room-models.json");
      await writeFile(
        roomModelsPath,
        JSON.stringify({
          rooms: {
            "!room1:example.com": {
              desiredModel: "gemma4",
              resolvedModelId: "test-model",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
            "!room2:example.com": {
              // Missing required fields
              invalid: true,
            },
          },
        }),
      );

      manager = new RoomModelManager(agentDir);

      // Room 1 should be loaded
      const room1 = manager.getDesiredModel("!room1:example.com");
      expect(room1?.desiredModel).toBe("gemma4");

      // Room 2 should be filtered out
      const room2 = manager.getDesiredModel("!room2:example.com");
      expect(room2).toBeUndefined();
    });
  });

  describe("getDesiredModel", () => {
    it("returns undefined for room without desired model", () => {
      const desired = manager.getDesiredModel("!nonexistent:example.com");
      expect(desired).toBeUndefined();
    });

    it("returns desired model after setDesiredModel", () => {
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-model-id");

      const desired = manager.getDesiredModel("!room1:example.com");
      expect(desired).toBeDefined();
      expect(desired!.desiredModel).toBe("gemma4");
      expect(desired!.resolvedModelId).toBe("test-gemma-model-id");
      expect(desired!.updatedAt).toBeDefined();
    });
  });

  describe("setDesiredModel", () => {
    it("sets desired model for a room", () => {
      manager.setDesiredModel("!room1:example.com", "qwen27", "test-qwen-model-id");

      const desired = manager.getDesiredModel("!room1:example.com");
      expect(desired?.desiredModel).toBe("qwen27");
      expect(desired?.resolvedModelId).toBe("test-qwen-model-id");
    });

    it("persists desired model to file", async () => {
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-model-id");

      // Read file directly to verify persistence
      const roomModelsPath = join(agentDir, "room-models.json");
      const content = await readFile(roomModelsPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.rooms["!room1:example.com"]).toBeDefined();
      expect(parsed.rooms["!room1:example.com"].desiredModel).toBe("gemma4");
    });

    it("updates existing room entry", () => {
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-1");
      manager.setDesiredModel("!room1:example.com", "qwen27", "test-qwen-1");

      const desired = manager.getDesiredModel("!room1:example.com");
      expect(desired?.desiredModel).toBe("qwen27");
      expect(desired?.resolvedModelId).toBe("test-qwen-1");
    });
  });

  describe("clearDesiredModel", () => {
    it("removes desired model for a room", () => {
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-model-id");

      const cleared = manager.clearDesiredModel("!room1:example.com");

      expect(cleared?.desiredModel).toBe("gemma4");
      expect(manager.getDesiredModel("!room1:example.com")).toBeUndefined();
    });

    it("returns undefined for room without desired model", () => {
      const cleared = manager.clearDesiredModel("!nonexistent:example.com");
      expect(cleared).toBeUndefined();
    });

    it("persists clear to file", async () => {
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-model-id");
      manager.clearDesiredModel("!room1:example.com");

      const roomModelsPath = join(agentDir, "room-models.json");
      const content = await readFile(roomModelsPath, "utf-8");
      const parsed = JSON.parse(content);

      expect(parsed.rooms["!room1:example.com"]).toBeUndefined();
    });
  });

  describe("resolveDesiredModel", () => {
    it("returns room-specific desired model when set", () => {
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-model-id");

      const resolved = manager.resolveDesiredModel("!room1:example.com");
      expect(resolved).toBe("gemma4");
    });

    it("returns global default when no room-specific desired model", () => {
      const resolved = manager.resolveDesiredModel("!room1:example.com");
      expect(resolved).toBe("qwen27"); // From settings.json
    });

    it("room-specific desired model takes precedence over global default", () => {
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-model-id");

      const resolved = manager.resolveDesiredModel("!room1:example.com");
      expect(resolved).toBe("gemma4"); // Not "qwen27"
    });
  });

  describe("persistence across restart", () => {
    it("desired model persists when manager is recreated", () => {
      // Set desired model
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-model-id");

      // Create new manager (simulates restart)
      const newManager = new RoomModelManager(agentDir);

      // Verify persistence
      const desired = newManager.getDesiredModel("!room1:example.com");
      expect(desired?.desiredModel).toBe("gemma4");
      expect(desired?.resolvedModelId).toBe("test-gemma-model-id");
    });

    it("cleared desired model persists when manager is recreated", () => {
      // Set then clear desired model
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-model-id");
      manager.clearDesiredModel("!room1:example.com");

      // Create new manager (simulates restart)
      const newManager = new RoomModelManager(agentDir);

      // Verify clear persisted
      const desired = newManager.getDesiredModel("!room1:example.com");
      expect(desired).toBeUndefined();
    });
  });

  describe("multiple rooms", () => {
    it("maintains separate desired models for different rooms", () => {
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-model-id");
      manager.setDesiredModel("!room2:example.com", "qwen27", "test-qwen-model-id");

      const room1 = manager.getDesiredModel("!room1:example.com");
      const room2 = manager.getDesiredModel("!room2:example.com");

      expect(room1?.desiredModel).toBe("gemma4");
      expect(room2?.desiredModel).toBe("qwen27");
    });

    it("clearing one room does not affect another", () => {
      manager.setDesiredModel("!room1:example.com", "gemma4", "test-gemma-model-id");
      manager.setDesiredModel("!room2:example.com", "qwen27", "test-qwen-model-id");

      manager.clearDesiredModel("!room1:example.com");

      expect(manager.getDesiredModel("!room1:example.com")).toBeUndefined();
      expect(manager.getDesiredModel("!room2:example.com")?.desiredModel).toBe("qwen27");
    });
  });
});
