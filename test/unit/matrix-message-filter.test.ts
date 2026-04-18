import { describe, expect, it } from "vitest";
import { extractIncomingTextBody, isAcceptedMatrixMsgType } from "../../src/matrix.js";

describe("isAcceptedMatrixMsgType", () => {
  it("accepts m.text", () => {
    expect(isAcceptedMatrixMsgType("m.text")).toBe(true);
  });

  it("accepts m.notice", () => {
    expect(isAcceptedMatrixMsgType("m.notice")).toBe(true);
  });

  it("rejects m.image", () => {
    expect(isAcceptedMatrixMsgType("m.image")).toBe(false);
  });

  it("rejects m.emote", () => {
    expect(isAcceptedMatrixMsgType("m.emote")).toBe(false);
  });

  it("rejects m.file", () => {
    expect(isAcceptedMatrixMsgType("m.file")).toBe(false);
  });

  it("rejects m.video", () => {
    expect(isAcceptedMatrixMsgType("m.video")).toBe(false);
  });

  it("rejects m.audio", () => {
    expect(isAcceptedMatrixMsgType("m.audio")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isAcceptedMatrixMsgType(undefined)).toBe(false);
  });

  it("rejects null", () => {
    expect(isAcceptedMatrixMsgType(null)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isAcceptedMatrixMsgType("")).toBe(false);
  });
});

describe("extractIncomingTextBody", () => {
  it("returns body for valid text event", () => {
    const event = {
      content: {
        msgtype: "m.text",
        body: "Hello, world!",
      },
    };
    expect(extractIncomingTextBody(event)).toBe("Hello, world!");
  });

  it("returns body for valid notice event", () => {
    const event = {
      content: {
        msgtype: "m.notice",
        body: "System notification",
      },
    };
    expect(extractIncomingTextBody(event)).toBe("System notification");
  });

  it("returns null for missing body", () => {
    const event = {
      content: {
        msgtype: "m.text",
      },
    };
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("returns null for non-string body", () => {
    const event = {
      content: {
        msgtype: "m.text",
        body: 12345, // number instead of string
      },
    };
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("returns null for whitespace-only body", () => {
    const event = {
      content: {
        msgtype: "m.text",
        body: "   ",
      },
    };
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("returns null for non-text event (m.image)", () => {
    const event = {
      content: {
        msgtype: "m.image",
        body: "image caption",
        url: "mxc://example.com/abc123",
      },
    };
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("returns null for non-text event (m.file)", () => {
    const event = {
      content: {
        msgtype: "m.file",
        body: "document.pdf",
        url: "mxc://example.com/def456",
      },
    };
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("returns null for event with missing content", () => {
    const event = {};
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("returns null for undefined event", () => {
    expect(extractIncomingTextBody(undefined)).toBe(null);
  });

  it("returns null for null event", () => {
    expect(extractIncomingTextBody(null)).toBe(null);
  });

  it("preserves body with leading/trailing whitespace if inner content exists", () => {
    const event = {
      content: {
        msgtype: "m.text",
        body: "  Hello with spaces  ",
      },
    };
    expect(extractIncomingTextBody(event)).toBe("  Hello with spaces  ");
  });
});
