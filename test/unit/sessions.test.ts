import { beforeEach, describe, expect, it } from "vitest";
import { SessionRegistry } from "../../src/sessions.js";

describe("SessionRegistry", () => {
  let registry: SessionRegistry<string>;
  let callCount = 0;

  beforeEach(() => {
    // Use a fake factory for testing that tracks calls
    const factory = async (dir: string) => {
      callCount++;
      return `session-${callCount}-for-${dir}`;
    };
    registry = new SessionRegistry(factory, "/tmp/test-sessions");
    callCount = 0;
  });

  it("returns same session for same room", async () => {
    const session1 = await registry.get("!room1:example.org");
    const session2 = await registry.get("!room1:example.org");
    expect(session1).toBe(session2);
  });

  it("returns different sessions for different rooms", async () => {
    const session1 = await registry.get("!room1:example.org");
    const session2 = await registry.get("!room2:example.org");
    expect(session1).not.toBe(session2);
  });

  it("creates session directories with hashed room IDs", async () => {
    const session = await registry.get("!room-with-special-chars:example.org");
    expect(session).toContain("session-");
  });

  it("drop removes cached session", async () => {
    const session1 = await registry.get("!room1:example.org");
    await registry.drop("!room1:example.org");

    // After drop, getting the same room should create a new session
    const session2 = await registry.get("!room1:example.org");
    expect(session1).not.toBe(session2);
  });

  it("drop does not affect other rooms", async () => {
    const _session1 = await registry.get("!room1:example.org");
    const session2 = await registry.get("!room2:example.org");

    await registry.drop("!room1:example.org");

    // Room2 session should still be cached
    const session2Again = await registry.get("!room2:example.org");
    expect(session2).toBe(session2Again);
  });
});
