import { describe, expect, it } from "vitest";
import { isAllowedRoom, isAllowedUser } from "../../src/policy.js";

describe("isAllowedRoom", () => {
  it("returns true for allowlisted room", () => {
    const allowed = ["!room1:example.org", "!room2:example.org"];
    expect(isAllowedRoom("!room1:example.org", allowed)).toBe(true);
  });

  it("returns false for non-allowlisted room", () => {
    const allowed = ["!room1:example.org"];
    expect(isAllowedRoom("!other:example.org", allowed)).toBe(false);
  });

  it("returns false for empty allowlist", () => {
    expect(isAllowedRoom("!room:example.org", [])).toBe(false);
  });
});

describe("isAllowedUser", () => {
  it("returns true for allowlisted user", () => {
    const allowed = ["@user1:example.org", "@user2:example.org"];
    expect(isAllowedUser("@user1:example.org", allowed)).toBe(true);
  });

  it("returns false for non-allowlisted user", () => {
    const allowed = ["@user1:example.org"];
    expect(isAllowedUser("@other:example.org", allowed)).toBe(false);
  });

  it("returns false for empty allowlist", () => {
    expect(isAllowedUser("@user:example.org", [])).toBe(false);
  });
});
