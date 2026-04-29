import { describe, expect, it, vi } from "vitest";
import { routeMessage } from "../../src/router.js";
import type { AgentBackend, IncomingMessage, ReplySink } from "../../src/types.js";

describe("routeMessage !media command", () => {
  const baseAgent: AgentBackend = {
    async prompt() {
      throw new Error("SHOULD NOT BE CALLED");
    },
  };

  const baseMsg: IncomingMessage = {
    roomId: "!room:example.org",
    eventId: "$event",
    sender: "@user:example.org",
    body: "",
  };

  const baseConfig = (sink: ReplySink) => ({
    allowedRoomIds: ["!room:example.org"],
    allowedUserIds: ["@user:example.org"],
    agent: baseAgent,
    sink,
  });

  it("calls sendMedia for !media with URL (no caption)", async () => {
    const sink: ReplySink = {
      reply: vi.fn().mockResolvedValue(undefined),
      sendMedia: vi.fn().mockResolvedValue(undefined),
    };

    await routeMessage(
      {
        ...baseMsg,
        body: "!media https://example.com/image.png",
      },
      { config: baseConfig(sink) },
    );

    expect(sink.sendMedia).toHaveBeenCalledWith(
      "!room:example.org",
      "$event",
      "https://example.com/image.png",
      undefined,
    );
    expect(sink.reply).not.toHaveBeenCalled();
  });

  it("calls sendMedia with caption", async () => {
    const sink: ReplySink = {
      reply: vi.fn().mockResolvedValue(undefined),
      sendMedia: vi.fn().mockResolvedValue(undefined),
    };

    await routeMessage(
      {
        ...baseMsg,
        body: "!media https://example.com/chart.png Quarterly results",
      },
      { config: baseConfig(sink) },
    );

    expect(sink.sendMedia).toHaveBeenCalledWith("!room:example.org", "$event", "https://example.com/chart.png", {
      caption: "Quarterly results",
    });
  });

  it("ignores !media from non-allowed room", async () => {
    const sink: ReplySink = {
      reply: vi.fn().mockResolvedValue(undefined),
      sendMedia: vi.fn().mockResolvedValue(undefined),
    };

    await routeMessage(
      {
        ...baseMsg,
        roomId: "!other:example.org",
        body: "!media https://example.com/x.png",
      },
      { config: baseConfig(sink) },
    );

    expect(sink.sendMedia).not.toHaveBeenCalled();
    expect(sink.reply).not.toHaveBeenCalled();
  });

  it("!media with no URL shows help", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      reply: vi.fn().mockImplementation((_r, _e, text) => replies.push(text)),
      sendMedia: vi.fn().mockResolvedValue(undefined),
    };

    await routeMessage(
      {
        ...baseMsg,
        body: "!media",
      },
      { config: baseConfig(sink) },
    );

    expect(sink.sendMedia).not.toHaveBeenCalled();
    expect(replies[0]).toContain("Commands:");
  });

  it("help text includes !media command", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      reply: vi.fn().mockImplementation((_r, _e, text) => replies.push(text)),
      sendMedia: vi.fn().mockResolvedValue(undefined),
    };

    await routeMessage(
      {
        ...baseMsg,
        body: "!help",
      },
      { config: baseConfig(sink) },
    );

    expect(replies[0]).toContain("!media");
  });
});
