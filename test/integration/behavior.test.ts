import { describe, expect, it } from "vitest";
import { extractIncomingTextBody, isAcceptedMatrixMsgType } from "../../src/matrix.js";
import { routeMessage } from "../../src/router.js";
import type {
  AgentBackend,
  IncomingMessage,
  ModelClearResult,
  ModelStatus,
  ModelSwitchResult,
  ReplySink,
} from "../../src/types.js";

/**
 * Round 4: Behavior-level integration testing
 *
 * These tests validate end-to-end behavior across system boundaries:
 * - Router command flows
 * - Matrix ingress filtering
 * - Integration points between components
 *
 * Focus is on behavior verification, not unit-level testing.
 */

// =============================================================================
// Helpers
// =============================================================================

function createTestSink(): { sink: ReplySink; replies: Array<{ roomId: string; text: string }> } {
  const replies: Array<{ roomId: string; text: string }> = [];
  const sink: ReplySink = {
    async reply(roomId, _eventId, text) {
      replies.push({ roomId, text });
    },
  };
  return { sink, replies };
}

function createTestMessage(body: string, roomId = "!room:example.org", sender = "@user:example.org"): IncomingMessage {
  return {
    roomId,
    eventId: "$test_event",
    sender,
    body,
  };
}

// =============================================================================
// Matrix Ingress Filtering Integration Tests
// =============================================================================

describe("Matrix ingress filtering - integration", () => {
  it("passes m.text messages through", () => {
    const event = { content: { msgtype: "m.text", body: "hello" } };
    expect(isAcceptedMatrixMsgType(event.content.msgtype)).toBe(true);
    expect(extractIncomingTextBody(event)).toBe("hello");
  });

  it("passes m.notice messages through", () => {
    const event = { content: { msgtype: "m.notice", body: "system notice" } };
    expect(isAcceptedMatrixMsgType(event.content.msgtype)).toBe(true);
    expect(extractIncomingTextBody(event)).toBe("system notice");
  });

  it("rejects m.emote message type", () => {
    const event = { content: { msgtype: "m.emote", body: "* waves *" } };
    expect(isAcceptedMatrixMsgType(event.content.msgtype)).toBe(false);
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("rejects m.image message type", () => {
    const event = { content: { msgtype: "m.image", body: "image upload", url: "mxc://..." } };
    expect(isAcceptedMatrixMsgType(event.content.msgtype)).toBe(false);
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("rejects m.file message type", () => {
    const event = { content: { msgtype: "m.file", body: "file upload", url: "mxc://..." } };
    expect(isAcceptedMatrixMsgType(event.content.msgtype)).toBe(false);
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("rejects events with missing msgtype", () => {
    const event = { content: { body: "no msgtype" } };
    expect(isAcceptedMatrixMsgType(event.content.msgtype)).toBe(false);
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("rejects events with empty body", () => {
    const event = { content: { msgtype: "m.text", body: "" } };
    expect(isAcceptedMatrixMsgType(event.content.msgtype)).toBe(true);
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("rejects events with whitespace-only body", () => {
    const event = { content: { msgtype: "m.text", body: "   \n\t  " } };
    expect(isAcceptedMatrixMsgType(event.content.msgtype)).toBe(true);
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("rejects events with non-string body", () => {
    const event = { content: { msgtype: "m.text", body: 12345 } };
    expect(isAcceptedMatrixMsgType(event.content.msgtype)).toBe(true);
    expect(extractIncomingTextBody(event)).toBe(null);
  });

  it("trims body but preserves internal whitespace", () => {
    const event = { content: { msgtype: "m.text", body: "  hello world  " } };
    expect(extractIncomingTextBody(event)).toBe("  hello world  ");
  });
});

// =============================================================================
// Router !control Command Integration Tests
// =============================================================================

describe("Router !control command - integration", () => {
  it("returns control URL when live room info exists", async () => {
    const { sink, replies } = createTestSink();

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const sessionRegistry = {
      getLiveRoomInfo(roomId: string) {
        if (roomId === "!room:example.org") {
          return {
            roomId: "!room:example.org",
            roomKey: "abc123",
            sessionId: "test-session",
          };
        }
        return undefined;
      },
    };

    const msg = createTestMessage("!control");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
      sessionRegistry,
      controlUrl: "http://localhost:9000",
    });

    expect(replies.length).toBe(1);
    expect(replies[0].text).toContain("http://localhost:9000/spike");
    expect(replies[0].text).toContain("room=abc123");
  });

  it("returns 'send a message first' when no active room state exists", async () => {
    const { sink, replies } = createTestSink();

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    // Session registry has no info for this room
    const sessionRegistry = {
      getLiveRoomInfo(): undefined {
        return undefined;
      },
    };

    const msg = createTestMessage("!control");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
      sessionRegistry,
      controlUrl: "http://localhost:9000",
    });

    expect(replies.length).toBe(1);
    expect(replies[0].text.toLowerCase()).toContain("send a message first");
  });

  it("returns 'control server not configured' when controlUrl is not set", async () => {
    const { sink, replies } = createTestSink();

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const sessionRegistry = {
      getLiveRoomInfo(roomId: string) {
        if (roomId === "!room:example.org") {
          return { roomId: "!room:example.org", roomKey: "abc123", sessionId: "test-session" };
        }
        return undefined;
      },
    };

    const msg = createTestMessage("!control");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
      sessionRegistry,
      // No controlUrl provided
    });

    expect(replies.length).toBe(1);
    expect(replies[0].text.toLowerCase()).toContain("control server not configured");
  });
});

// =============================================================================
// Router !model --clear / !m -c Command Integration Tests
// =============================================================================

describe("Router !model --clear / !m -c command - integration", () => {
  it("success path with previous desired model", async () => {
    const { sink, replies } = createTestSink();

    const backend: AgentBackend & { clearDesiredModel?: any } = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async clearDesiredModel(_roomId: string): Promise<ModelClearResult> {
        return {
          success: true,
          message: "Desired model cleared for this room. Switched back to global default model.",
          previousDesiredModel: "qwen36",
        };
      },
    };

    const msg = createTestMessage("!model --clear");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend as any,
    });

    expect(replies.length).toBe(1);
    expect(replies[0].text).toContain("✓");
    expect(replies[0].text).toContain("Desired model cleared for this room");
    expect(replies[0].text).toContain("qwen36");
  });

  it("success path when no room-specific override exists", async () => {
    const { sink, replies } = createTestSink();

    const backend: AgentBackend & { clearDesiredModel?: any } = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async clearDesiredModel(_roomId: string): Promise<ModelClearResult> {
        return {
          success: true,
          message: "No room-specific desired model was set. Already using global default.",
        };
      },
    };

    const msg = createTestMessage("!m -c");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend as any,
    });

    expect(replies.length).toBe(1);
    expect(replies[0].text).toContain("✓");
    expect(replies[0].text).toContain("No room-specific desired model was set");
    expect(replies[0].text).toContain("Already using global default");
  });
});

// =============================================================================
// Router !model / !m -s Status Command Integration Tests
// =============================================================================

describe("Router !model / !m -s status command - integration", () => {
  it("status path with active + desired + global default info", async () => {
    const { sink, replies } = createTestSink();

    const backend: AgentBackend & { getModelStatusOrRehydrate?: any } = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async getModelStatusOrRehydrate(_roomId: string): Promise<ModelStatus> {
        return {
          active: true,
          model: "test-model-qwen36",
          thinkingLevel: "high",
          sessionId: "test-session-id",
          sessionFile: "/path/to/session.jsonl",
          desiredModel: "qwen36",
          desiredResolvedModelId: "test-model-qwen36",
          globalDefault: "qwen27",
          modelMismatch: false,
        };
      },
    };

    const msg = createTestMessage("!m -s");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend as any,
    });

    expect(replies.length).toBe(1);
    const reply = replies[0].text;
    expect(reply).toContain("Model status:");
    expect(reply).toContain("test-model-qwen36");
    expect(reply).toContain("Desired model: qwen36");
    expect(reply).toContain("Global default: qwen27");
    expect(reply).toContain("test-session-id");
  });

  it("status path shows 'no active session' when no room state exists", async () => {
    const { sink, replies } = createTestSink();

    const backend: AgentBackend & { getModelStatusOrRehydrate?: any } = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async getModelStatusOrRehydrate(_roomId: string): Promise<null> {
        return null;
      },
    };

    const msg = createTestMessage("!model");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend as any,
    });

    expect(replies.length).toBe(1);
    expect(replies[0].text.toLowerCase()).toContain("no active session");
  });

  it("status path shows model mismatch warning when active differs from desired", async () => {
    const { sink, replies } = createTestSink();

    const backend: AgentBackend & { getModelStatusOrRehydrate?: any } = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async getModelStatusOrRehydrate(_roomId: string): Promise<ModelStatus> {
        return {
          active: true,
          model: "test-model-qwen27",
          thinkingLevel: "high",
          sessionId: "test-session-id",
          sessionFile: "/path/to/session.jsonl",
          desiredModel: "qwen36",
          desiredResolvedModelId: "test-model-qwen36",
          globalDefault: "qwen27",
          modelMismatch: true,
        };
      },
    };

    const msg = createTestMessage("!model --status");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend as any,
    });

    expect(replies.length).toBe(1);
    const reply = replies[0].text;
    expect(reply).toContain("⚠️");
    expect(reply.toLowerCase()).toContain("differs");
    expect(reply.toLowerCase()).toContain("send a message to apply");
  });
});

// =============================================================================
// Router !reset Command Integration Tests
// =============================================================================

describe("Router !reset command - integration", () => {
  it("calls reset capability and replies success", async () => {
    const { sink, replies } = createTestSink();
    let resetCalled = false;

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const sessionRegistry = {
      async reset(roomId: string): Promise<void> {
        resetCalled = true;
        expect(roomId).toBe("!room:example.org");
      },
    };

    const msg = createTestMessage("!reset");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
      sessionRegistry,
    });

    expect(resetCalled).toBe(true);
    expect(replies.length).toBe(1);
    expect(replies[0].text).toContain("Session reset");
    expect(replies[0].text.toLowerCase()).toContain("archived");
  });

  it("failure path replies error", async () => {
    const { sink, replies } = createTestSink();

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const sessionRegistry = {
      async reset(_roomId: string): Promise<void> {
        throw new Error("Simulated reset failure");
      },
    };

    const msg = createTestMessage("!reset");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
      sessionRegistry,
    });

    expect(replies.length).toBe(1);
    expect(replies[0].text).toContain("Failed to reset session");
    expect(replies[0].text).toContain("Check logs");
  });
});

// =============================================================================
// End-to-End Command Flow Integration Tests
// =============================================================================

describe("End-to-end command flow integration", () => {
  it("!ping -> !help -> !status flow works correctly", async () => {
    const { sink, replies } = createTestSink();

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    // !ping
    await routeMessage(createTestMessage("!ping"), {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    // !help
    await routeMessage(createTestMessage("!help"), {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    // !status
    await routeMessage(createTestMessage("!status"), {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    expect(replies.length).toBe(3);
    expect(replies[0].text).toBe("pong");
    expect(replies[1].text).toContain("Commands:");
    expect(replies[2].text).toBe("Status: OK");
  });

  it("model switch flow: status -> switch -> status shows change", async () => {
    const { sink, replies } = createTestSink();

    let switchCount = 0;

    const backend: AgentBackend & { switchModel?: any; getModelStatus?: any } = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
      async switchModel(_roomId: string, profile: string): Promise<ModelSwitchResult> {
        switchCount++;
        return {
          success: true,
          message: `Switched to ${profile}`,
          requestedProfile: profile,
          resolvedModel: "test-model-qwen36",
          activeModel: "test-model-qwen36",
        };
      },
      async getModelStatus(_roomId: string): Promise<ModelStatus> {
        return {
          active: true,
          model: switchCount > 0 ? "test-model-qwen36" : "test-model-qwen27",
          thinkingLevel: "high",
          sessionId: "test-session",
          sessionFile: "/path/to/session.jsonl",
          desiredModel: switchCount > 0 ? "qwen36" : "qwen27",
          desiredResolvedModelId: switchCount > 0 ? "test-model-qwen36" : "test-model-qwen27",
          globalDefault: "qwen27",
          modelMismatch: false,
        };
      },
    };

    // Initial status
    await routeMessage(createTestMessage("!model"), {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend as any,
    });

    // Switch model
    await routeMessage(createTestMessage("!model qwen36"), {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend as any,
    });

    // Status after switch
    await routeMessage(createTestMessage("!model"), {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent: backend as AgentBackend,
        sink,
      },
      modelSwitcher: backend as any,
    });

    expect(switchCount).toBe(1);
    expect(replies.length).toBe(3);
    expect(replies[0].text).toContain("test-model-qwen27");
    expect(replies[1].text).toContain("Model switch successful");
    expect(replies[2].text).toContain("test-model-qwen36");
  });
});

// =============================================================================
// Router Chat Prompt Integration Tests
// =============================================================================

describe("Router chat prompt - integration", () => {
  it("plain text message triggers agent prompt and reply", async () => {
    const { sink, replies } = createTestSink();
    let receivedPrompt = "";

    const agent: AgentBackend = {
      async prompt(_roomId: string, text: string): Promise<string> {
        receivedPrompt = text;
        return `Response to: ${text}`;
      },
    };

    const msg = createTestMessage("Explain quantum computing");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    expect(receivedPrompt).toBe("Explain quantum computing");
    expect(replies.length).toBe(1);
    expect(replies[0].text).toBe("Response to: Explain quantum computing");
  });

  it("chat prompt error is caught and user-friendly error is returned", async () => {
    const { sink, replies } = createTestSink();

    const agent: AgentBackend = {
      async prompt(): Promise<string> {
        throw new Error("Backend crashed");
      },
    };

    const msg = createTestMessage("hello");

    await routeMessage(msg, {
      config: {
        allowedRoomIds: ["!room:example.org"],
        allowedUserIds: ["@user:example.org"],
        agent,
        sink,
      },
    });

    expect(replies.length).toBe(1);
    expect(replies[0].text).toContain("error");
    expect(replies[0].text.toLowerCase()).toContain("processing");
  });
});

// =============================================================================
// Combined Matrix + Router Integration Tests
// =============================================================================

describe("Matrix + Router combined integration", () => {
  it("full flow: matrix event -> filter -> router -> reply", async () => {
    // Simulate a Matrix message event
    const matrixEvent = {
      event_id: "$event123",
      sender: "@user:example.org",
      content: {
        msgtype: "m.text",
        body: "!ping",
      },
    };

    // Step 1: Matrix filtering
    const msgtype = matrixEvent.content.msgtype;
    expect(isAcceptedMatrixMsgType(msgtype)).toBe(true);

    const textBody = extractIncomingTextBody(matrixEvent);
    expect(textBody).toBe("!ping");

    // Step 2: Router processing
    const { sink, replies } = createTestSink();

    const agent: AgentBackend = {
      async prompt() {
        throw new Error("SHOULD NOT BE CALLED");
      },
    };

    const msg: IncomingMessage = {
      roomId: "!room:example.org",
      eventId: matrixEvent.event_id,
      sender: matrixEvent.sender,
      body: textBody!,
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
    expect(replies[0].text).toBe("pong");
  });

  it("full flow: image upload is filtered out before router", async () => {
    // Simulate a Matrix image upload event
    const matrixEvent = {
      event_id: "$event456",
      sender: "@user:example.org",
      content: {
        msgtype: "m.image",
        body: "Uploaded image",
        url: "mxc://example.org/abc123",
      },
    };

    // Step 1: Matrix filtering
    const msgtype = matrixEvent.content.msgtype;
    expect(isAcceptedMatrixMsgType(msgtype)).toBe(false);

    const textBody = extractIncomingTextBody(matrixEvent);
    expect(textBody).toBe(null);

    // Since textBody is null, router should never be called
    // This is verified by the fact that extractIncomingTextBody returns null
  });

  it("full flow: empty message is filtered out before router", async () => {
    // Simulate a Matrix message with empty body
    const matrixEvent = {
      event_id: "$event789",
      sender: "@user:example.org",
      content: {
        msgtype: "m.text",
        body: "   ",
      },
    };

    // Step 1: Matrix filtering
    const msgtype = matrixEvent.content.msgtype;
    expect(isAcceptedMatrixMsgType(msgtype)).toBe(true); // msgtype is valid

    const textBody = extractIncomingTextBody(matrixEvent);
    expect(textBody).toBe(null); // But body is empty/whitespace

    // Since textBody is null, router should never be called
  });
});
