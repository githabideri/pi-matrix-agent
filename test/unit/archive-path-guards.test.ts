import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidRoomKey, isValidSessionId, resolveRoomSessionDir } from "../../src/routes/archive.js";

describe("Archive Path Guards", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "archive-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("isValidRoomKey", () => {
    it("accepts valid lowercase hex room key", () => {
      expect(isValidRoomKey("abcd1234")).toBe(true);
      expect(isValidRoomKey("0123456789abcdef")).toBe(true);
      expect(isValidRoomKey("a1b2c3d4e5f6")).toBe(true);
    });

    it("rejects uppercase hex characters", () => {
      expect(isValidRoomKey("ABCD1234")).toBe(false);
      expect(isValidRoomKey("A1B2C3D4")).toBe(false);
    });

    it("rejects path traversal attempts", () => {
      expect(isValidRoomKey("../etc")).toBe(false);
      expect(isValidRoomKey("..\\etc")).toBe(false);
      expect(isValidRoomKey("../../passwd")).toBe(false);
    });

    it("rejects paths with slashes", () => {
      expect(isValidRoomKey("abc/def")).toBe(false);
      expect(isValidRoomKey("room/123")).toBe(false);
    });

    it("rejects non-hex characters", () => {
      expect(isValidRoomKey("ghijkl")).toBe(false);
      expect(isValidRoomKey("room-123")).toBe(false);
      expect(isValidRoomKey("room_123")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidRoomKey("")).toBe(false);
    });

    it("rejects non-string types", () => {
      expect(isValidRoomKey(123)).toBe(false);
      expect(isValidRoomKey(null)).toBe(false);
      expect(isValidRoomKey(undefined)).toBe(false);
    });
  });

  describe("isValidSessionId", () => {
    it("accepts normal UUID-like session id", () => {
      expect(isValidSessionId("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      expect(isValidSessionId("abc123-def456")).toBe(true);
    });

    it("accepts alphanumeric session ids", () => {
      expect(isValidSessionId("session123")).toBe(true);
      expect(isValidSessionId("ABC123xyz")).toBe(true);
    });

    it("accepts dots in session id", () => {
      expect(isValidSessionId("session.id.123")).toBe(true);
      expect(isValidSessionId("1.2.3.4")).toBe(true);
    });

    it("accepts underscores in session id", () => {
      expect(isValidSessionId("session_123")).toBe(true);
      expect(isValidSessionId("_session_")).toBe(true);
    });

    it("accepts hyphens in session id", () => {
      expect(isValidSessionId("session-123")).toBe(true);
      expect(isValidSessionId("-session-")).toBe(true);
    });

    it("rejects path traversal attempts", () => {
      expect(isValidSessionId("../evil")).toBe(false);
      expect(isValidSessionId("..\\evil")).toBe(false);
      expect(isValidSessionId("../../etc/passwd")).toBe(false);
    });

    it("rejects slashes", () => {
      expect(isValidSessionId("session/evil")).toBe(false);
      expect(isValidSessionId("a/b")).toBe(false);
    });

    it("rejects spaces and special characters", () => {
      expect(isValidSessionId("session 123")).toBe(false);
      expect(isValidSessionId("session@123")).toBe(false);
      expect(isValidSessionId("session#123")).toBe(false);
      expect(isValidSessionId("session!123")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidSessionId("")).toBe(false);
    });

    it("rejects non-string types", () => {
      expect(isValidSessionId(123)).toBe(false);
      expect(isValidSessionId(null)).toBe(false);
      expect(isValidSessionId(undefined)).toBe(false);
    });
  });

  describe("resolveRoomSessionDir", () => {
    it("returns a path ending in room-<roomKey>", async () => {
      const validRoomKey = "abcd1234";
      const result = await resolveRoomSessionDir(tempDir, validRoomKey);

      expect(result).toMatch(/room-abcd1234$/);
      expect(result).toContain(tempDir);
    });

    it("resolves to absolute path", async () => {
      const result = await resolveRoomSessionDir(tempDir, "abcd1234");
      expect(path.isAbsolute(result)).toBe(true);
    });

    it("stays inside base directory", async () => {
      const result = await resolveRoomSessionDir(tempDir, "abcd1234");
      expect(result.startsWith(tempDir)).toBe(true);
    });

    it("throws on invalid room key", async () => {
      await expect(resolveRoomSessionDir(tempDir, "../etc")).rejects.toThrow();
      await expect(resolveRoomSessionDir(tempDir, "ABCD")).rejects.toThrow();
      await expect(resolveRoomSessionDir(tempDir, "room/123")).rejects.toThrow();
    });

    it("throws on empty room key", async () => {
      await expect(resolveRoomSessionDir(tempDir, "")).rejects.toThrow();
    });

    it("handles edge case room keys safely", async () => {
      // Even if someone tries weird hex-only inputs, they should be safe
      const result = await resolveRoomSessionDir(tempDir, "0000");
      expect(result).toMatch(/room-0000$/);
    });
  });
});
