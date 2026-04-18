import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RoomModelManager } from "../../src/room-model-manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Unit tests for RoomModelManager.
 *
 * Focus: refresh-on-read behavior for global default model.
 */
describe("RoomModelManager", () => {
  let testDir: string;
  let manager: RoomModelManager;

  beforeEach(() => {
    // Create a unique test directory for each test
    testDir = join(__dirname, `__tmp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function writeSettings(provider: string, model: string): void {
    const settingsPath = join(testDir, "settings.json");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ defaultProvider: provider, defaultModel: model }, null, 2),
      "utf-8",
    );
  }

  describe("global default refresh-on-read", () => {
    it("initial qwen27 default is read from settings.json", () => {
      // Setup: write settings.json with qwen27 as default
      writeSettings("llama-cpp-qwen27", "qwen27-chat");

      // Create manager
      manager = new RoomModelManager(testDir);

      // Verify: getGlobalDefault() returns qwen27
      expect(manager.getGlobalDefault()).toBe("qwen27");
    });

    it("after overwriting settings.json to qwen36, getGlobalDefault() returns qwen36 without reconstructing the object", () => {
      // Setup: start with qwen27 as default
      writeSettings("llama-cpp-qwen27", "qwen27-chat");

      // Create manager
      manager = new RoomModelManager(testDir);

      // Verify initial state
      expect(manager.getGlobalDefault()).toBe("qwen27");

      // Act: overwrite settings.json to qwen36 (simulating external config change)
      writeSettings("llama-cpp-qwen36", "qwen36-chat");

      // Verify: getGlobalDefault() now returns qwen36 without reconstructing the manager
      expect(manager.getGlobalDefault()).toBe("qwen36");
    });

    it("resolveDesiredModel(roomId) falls back to the refreshed global default when no room override exists", () => {
      // Setup: start with qwen27 as default
      writeSettings("llama-cpp-qwen27", "qwen27-chat");

      // Create manager
      manager = new RoomModelManager(testDir);

      const roomId = "!test:example.com";

      // Verify: resolveDesiredModel falls back to qwen27
      expect(manager.resolveDesiredModel(roomId)).toBe("qwen27");

      // Act: overwrite settings.json to qwen36
      writeSettings("llama-cpp-qwen36", "qwen36-chat");

      // Verify: resolveDesiredModel now falls back to refreshed qwen36
      expect(manager.resolveDesiredModel(roomId)).toBe("qwen36");
    });

    it("a room-specific desired model still takes precedence over the global default", () => {
      // Setup: start with qwen27 as global default
      writeSettings("llama-cpp-qwen27", "qwen27-chat");

      // Create manager
      manager = new RoomModelManager(testDir);

      const roomId = "!test:example.com";

      // Set room-specific override to qwen36
      manager.setDesiredModel(roomId, "qwen36", "llama-cpp-qwen36:8080");

      // Verify: room override takes precedence over global default
      expect(manager.resolveDesiredModel(roomId)).toBe("qwen36");

      // Act: change global default to qwen27 (it was already, but let's be explicit)
      writeSettings("llama-cpp-qwen27", "qwen27-chat");

      // Verify: room override still takes precedence
      expect(manager.resolveDesiredModel(roomId)).toBe("qwen36");

      // Act: change global default to something else
      writeSettings("llama-cpp-qwen36", "qwen36-chat");

      // Verify: room override still takes precedence (room override is qwen36, global is now also qwen36)
      expect(manager.resolveDesiredModel(roomId)).toBe("qwen36");
    });

    it("if settings.json contains an unrelated/unknown provider, getGlobalDefault() becomes undefined", () => {
      // Setup: start with qwen27 as default
      writeSettings("llama-cpp-qwen27", "qwen27-chat");

      // Create manager
      manager = new RoomModelManager(testDir);

      // Verify initial state
      expect(manager.getGlobalDefault()).toBe("qwen27");

      // Act: overwrite settings.json with unrelated provider
      writeSettings("unknown-provider", "some-model");

      // Verify: getGlobalDefault() now returns undefined
      expect(manager.getGlobalDefault()).toBeUndefined();
    });

    it("handles missing settings.json gracefully by returning undefined", () => {
      // Setup: no settings.json created

      // Create manager
      manager = new RoomModelManager(testDir);

      // Verify: getGlobalDefault() returns undefined
      expect(manager.getGlobalDefault()).toBeUndefined();
    });
  });

  describe("room-specific overrides", () => {
    it("getDesiredModel returns the room-specific override", () => {
      // Setup
      writeSettings("llama-cpp-qwen27", "qwen27-chat");

      // Create manager
      manager = new RoomModelManager(testDir);

      const roomId = "!test:example.com";
      manager.setDesiredModel(roomId, "qwen36", "llama-cpp-qwen36:8080");

      // Verify
      const state = manager.getDesiredModel(roomId);
      expect(state).toBeDefined();
      expect(state?.desiredModel).toBe("qwen36");
      expect(state?.resolvedModelId).toBe("llama-cpp-qwen36:8080");
    });

    it("clearDesiredModel removes the room-specific override", () => {
      // Setup
      writeSettings("llama-cpp-qwen27", "qwen27-chat");

      // Create manager
      manager = new RoomModelManager(testDir);

      const roomId = "!test:example.com";
      manager.setDesiredModel(roomId, "qwen36", "llama-cpp-qwen36:8080");

      // Clear the override
      const previous = manager.clearDesiredModel(roomId);

      // Verify previous state was returned
      expect(previous?.desiredModel).toBe("qwen36");

      // Verify override is gone and falls back to global default
      expect(manager.getDesiredModel(roomId)).toBeUndefined();
      expect(manager.resolveDesiredModel(roomId)).toBe("qwen27");
    });
  });

  describe("getRoomIdsWithOverrides", () => {
    it("returns all room IDs with overrides", () => {
      // Setup
      writeSettings("llama-cpp-qwen27", "qwen27-chat");

      // Create manager
      manager = new RoomModelManager(testDir);

      const room1 = "!room1:example.com";
      const room2 = "!room2:example.com";

      manager.setDesiredModel(room1, "qwen36", "llama-cpp-qwen36:8080");
      manager.setDesiredModel(room2, "qwen27", "llama-cpp-qwen27:8080");

      // Verify
      const roomIds = manager.getRoomIdsWithOverrides();
      expect(roomIds).toHaveLength(2);
      expect(roomIds).toContain(room1);
      expect(roomIds).toContain(room2);
    });
  });
});
