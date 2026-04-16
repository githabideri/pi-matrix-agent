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

// Model command router tests
interface ModelBackend extends AgentBackend {
  switchModel?(roomId: string, profile: string): Promise<any>;
  getModelStatus?(roomId: string): Promise<any>;
  setProcessing?(roomId: string, processing: boolean): void;
}

describe("routeMessage model commands", () => {
  it("replies with model status for !model command", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async getModelStatus(_roomId) {
        return {
          active: true,
          model: "test-model",
          thinkingLevel: "high",
          sessionId: "test-session-id",
          sessionFile: "/path/to/session.jsonl",
        };
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!model",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("test-model");
    expect(replies[0]).toContain("test-session-id");
  });

  it("replies with model status for !model --status command", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async getModelStatus(_roomId) {
        return {
          active: true,
          model: "qwen-model",
          thinkingLevel: "medium",
          sessionId: "session-123",
          sessionFile: "/path/to/session.jsonl",
        };
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!model --status",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("qwen-model");
  });

  it("switches model for !model qwen27 command", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async switchModel(_roomId, profile) {
        return {
          success: true,
          message: `Switched to ${profile}`,
          requestedProfile: profile,
          activeModel: "new-model-id",
        };
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!model qwen27",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("qwen27");
    expect(replies[0].toLowerCase()).toContain("switch");
  });

  it("switches model for !m g4 command (alias)", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async switchModel(_roomId, profile) {
        // profile should be canonicalized to "gemma4"
        return {
          success: true,
          message: `Switched to ${profile}`,
          requestedProfile: profile,
          activeModel: "gemma-model-id",
        };
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!m g4",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
    });

    expect(replies.length).toBe(1);
    // Should mention gemma4 (canonicalized from g4)
    expect(replies[0]).toContain("gemma4");
  });

  it("rejects model switch while room is processing", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async switchModel(_roomId, _profile) {
        // This should not be called because the room is processing
        throw new Error("switchModel should not be called while processing");
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!model gemma4",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
      isRoomProcessing: () => true, // Room is processing
    });

    expect(replies.length).toBe(1);
    expect(replies[0].toLowerCase()).toContain("in progress");
  });

  it("help text includes model commands", async () => {
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
    expect(replies[0]).toContain("!model");
    expect(replies[0]).toContain("gemma4");
    expect(replies[0]).toContain("qwen27");
  });
});

// Phase 2: Clear command router tests - truthful message preservation
describe("routeMessage model clear command", () => {
  it("clears desired model for !model --clear command with truthful immediate switch message", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async clearDesiredModel(_roomId) {
        // Backend returns truthful message for immediate switch case
        return {
          success: true,
          message: "Desired model cleared for this room. Switched back to global default model.",
          previousDesiredModel: "qwen27",
        };
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!model --clear",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("✓");
    expect(replies[0]).toContain("Desired model cleared for this room");
    expect(replies[0]).toContain("Switched back to global default model");
    expect(replies[0]).toContain("qwen27");
    // Verify router does NOT add misleading unconditional "will now use" line
    expect(replies[0]).not.toContain("This room will now use the global default model");
  });

  it("clears desired model for !model --clear with truthful deferred message", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async clearDesiredModel(_roomId) {
        // Backend returns truthful message for deferred case (not live/idle)
        return {
          success: true,
          message:
            "Desired model cleared for this room. The global default will apply on next rehydrate/reset/new session.",
          previousDesiredModel: "gemma4",
        };
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!model --clear",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("✓");
    expect(replies[0]).toContain("Desired model cleared for this room");
    expect(replies[0]).toContain("The global default will apply on next rehydrate/reset/new session");
    expect(replies[0]).toContain("gemma4");
    // Verify router does NOT add misleading unconditional "will now use" line
    expect(replies[0]).not.toContain("This room will now use the global default model");
  });

  it("clears desired model for !model --clear when no override was set", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async clearDesiredModel(_roomId) {
        // Backend returns truthful message when no override was set
        return {
          success: true,
          message: "No room-specific desired model was set. Already using global default.",
        };
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!model --clear",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("✓");
    expect(replies[0]).toContain("No room-specific desired model was set");
    expect(replies[0]).toContain("Already using global default");
    // Verify router does NOT claim something was cleared (misleading header)
    // The reply should NOT have "Desired model cleared for this room" as a separate line
    const firstLine = replies[0].split("\n")[0];
    expect(firstLine).not.toContain("Desired model cleared for this room");
    // The first line should be the truthful message about no override being set
    expect(firstLine).toContain("No room-specific desired model was set");
  });

  it("clears desired model for !m -c command (alias)", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async clearDesiredModel(_roomId) {
        return {
          success: true,
          message: "Desired model cleared for this room. Switched back to global default model.",
          previousDesiredModel: "gemma4",
        };
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!m -c",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("✓");
    expect(replies[0]).toContain("Desired model cleared for this room");
    expect(replies[0]).toContain("gemma4");
  });

  it("help text includes --clear command", async () => {
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
    expect(replies[0]).toContain("--clear");
    expect(replies[0]).toContain("-c");
  });
});

// Phase 2: Status with desired model info
describe("routeMessage model status with Phase 2 info", () => {
  it("status reply includes desired model info", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async getModelStatus(_roomId) {
        return {
          active: true,
          model: "test-model-gemma",
          thinkingLevel: "high",
          sessionId: "test-session-id",
          sessionFile: "/path/to/session.jsonl",
          desiredModel: "gemma4",
          desiredResolvedModelId: "test-model-gemma",
          globalDefault: "qwen27",
          modelMismatch: false,
        };
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!model --status",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("test-model-gemma");
    expect(replies[0]).toContain("gemma4");
    expect(replies[0]).toContain("qwen27");
  });

  it("status reply shows mismatch warning when active differs from desired", async () => {
    const replies: string[] = [];
    const sink: ReplySink = {
      async reply(_roomId, _eventId, text) {
        replies.push(text);
      },
    };

    const backend: ModelBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async getModelStatus(_roomId) {
        return {
          active: true,
          model: "test-model-qwen", // Active is qwen
          thinkingLevel: "high",
          sessionId: "test-session-id",
          sessionFile: "/path/to/session.jsonl",
          desiredModel: "gemma4", // Desired is gemma
          desiredResolvedModelId: "test-model-gemma",
          globalDefault: "qwen27",
          modelMismatch: true, // Mismatch detected
        };
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: "$event",
      sender: "@user:example.org",
      body: "!model --status",
    };

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend,
    });

    expect(replies.length).toBe(1);
    expect(replies[0]).toContain("⚠️");
    expect(replies[0].toLowerCase()).toContain("differs");
  });
});
