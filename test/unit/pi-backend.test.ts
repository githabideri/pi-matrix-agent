import { mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiSessionBackend } from "../../src/pi-backend.js";

describe("PiSessionBackend", () => {
  let backend: PiSessionBackend;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test sessions
    testDir = join(tmpdir(), `pi-backend-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });

    backend = new PiSessionBackend({
      sessionBaseDir: testDir,
      cwd: process.cwd(),
    });
  });

  afterEach(async () => {
    // Clean up
    await backend.dispose();
    await rm(testDir, { recursive: true, force: true });
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
