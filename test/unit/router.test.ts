import { describe, expect, it } from "vitest";
import { routeMessage } from "../../src/router.js";
import type { AgentBackend, IncomingMessage, ReplySink } from "../../src/types.js";

describe("routeMessage", () => {
  it("does nothing for messages from non-allowlisted rooms", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const msg: IncomingMessage = {
      roomId: "!other:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "hello",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    expect(replies).toEqual([]);
  });

  it("does nothing for messages from non-allowlisted users", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@notallowed:example.org",
      body: "hello",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    expect(replies).toEqual([]);
  });

  it("calls agent and replies once for plain chat from allowed user", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const agent: AgentBackend = {
      async prompt(roomId, text) {
        return `OK:${roomId}:${text}`;
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "summarize this",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    expect(replies).toEqual(["OK:!room:example.org:summarize this"]);
  });

  it("replies with pong for !ping command", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!ping",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    expect(replies).toEqual(["pong"]);
  });

  it("replies with status for !status command", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!status",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    expect(replies).toEqual(["Status: OK"]);
  });

  it("replies with help for !help command", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!help",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("Commands:");
  });

  it("replies with help for unknown !command", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!unknowncommand",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("Commands:");
  });
});
