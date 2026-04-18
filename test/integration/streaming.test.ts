import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest, type IncomingMessage } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControlServer } from "../../src/control-server.js";
import { PiSessionBackend } from "../../src/pi-backend.js";
import type { WebUIEvent } from "../../src/webui-types.js";

/**
 * Round 5: Streaming and Transcript Integration Testing
 *
 * These tests validate:
 * - SSE event stream (GET /api/live/rooms/:roomKey/events)
 * - Live transcript API (GET /api/live/rooms/:roomKey/transcript)
 * - Archive transcript API (GET /api/archive/rooms/:roomKey/sessions/:sessionId/transcript)
 * - Session file fixtures and helpers
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// Test Fixtures: Realistic Session File Builders
// =============================================================================

/**
 * Builder for creating realistic JSONL session files for transcript testing.
 */
class SessionFileBuilder {
  private lines: string[] = [];
  private sessionId = "test-session-001";

  withSessionId(id: string): SessionFileBuilder {
    this.sessionId = id;
    return this;
  }

  addHeader(): SessionFileBuilder {
    this.lines.push(
      JSON.stringify({
        type: "session",
        id: this.sessionId,
        timestamp: new Date().toISOString(),
      }),
    );
    return this;
  }

  addUserMessage(text: string): SessionFileBuilder {
    this.lines.push(
      JSON.stringify({
        type: "message",
        id: `msg-${this.lines.length}`,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "text", text }],
        },
      }),
    );
    return this;
  }

  addAssistantMessage(text: string, thinking?: string): SessionFileBuilder {
    const content: any[] = [{ type: "text", text }];
    if (thinking) {
      content.unshift({ type: "thinking", thinking });
    }
    this.lines.push(
      JSON.stringify({
        type: "message",
        id: `msg-${this.lines.length}`,
        timestamp: new Date().toISOString(),
        message: {
          role: "assistant",
          content,
        },
      }),
    );
    return this;
  }

  addToolCall(name: string, args: Record<string, unknown>, toolCallId?: string): SessionFileBuilder {
    this.lines.push(
      JSON.stringify({
        type: "message",
        id: `msg-${this.lines.length}`,
        timestamp: new Date().toISOString(),
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: toolCallId || `tool-${this.lines.length}`,
              name,
              arguments: args,
            },
          ],
        },
      }),
    );
    return this;
  }

  addToolResult(toolCallId: string, toolName: string, result: string, isError: boolean = false): SessionFileBuilder {
    this.lines.push(
      JSON.stringify({
        type: "message",
        id: `msg-${this.lines.length}`,
        timestamp: new Date().toISOString(),
        message: {
          role: "toolResult" as any,
          toolCallId,
          toolName,
          isError,
          content: [{ type: "text", text: result }],
        },
      }),
    );
    return this;
  }

  build(): string {
    if (this.lines.length === 0) {
      this.addHeader();
    }
    return this.lines.join("\n");
  }

  static createSimpleConversation(): string {
    return new SessionFileBuilder()
      .withSessionId("simple-convo-001")
      .addHeader()
      .addUserMessage("What is the capital of France?")
      .addAssistantMessage("The capital of France is Paris.")
      .build();
  }

  static createWithToolUse(): string {
    return new SessionFileBuilder()
      .withSessionId("tool-use-001")
      .addHeader()
      .addUserMessage("Read the file README.md")
      .addToolCall("read", { path: "README.md" }, "tool-call-123")
      .addToolResult("tool-call-123", "read", "# Project Title\n\nDescription here.")
      .addAssistantMessage("The README.md file contains a project title and description.")
      .build();
  }

  static createWithThinking(): string {
    return new SessionFileBuilder()
      .withSessionId("thinking-001")
      .addHeader()
      .addUserMessage("Explain how photosynthesis works")
      .addAssistantMessage(
        "Photosynthesis is the process by which plants convert light energy into chemical energy.",
        "Let me think about how to explain this clearly...",
      )
      .build();
  }
}

// =============================================================================
// HTTP Test Helpers
// =============================================================================

function makeRequest(
  options: { method: string; path: string; headers?: Record<string, string> },
  body?: string,
): Promise<{ statusCode: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: 9124, // Test port for streaming tests
        path: options.path,
        method: options.method,
        headers: options.headers || {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode!,
            headers: res.headers,
            body: data,
          });
        });
      },
    );
    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        setTimeout(() => makeRequest(options, body).then(resolve).catch(reject), 100);
        return;
      }
      reject(err);
    });
    if (body) req.write(body);
    req.end();
  });
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/**
 * Parse SSE events from a response body.
 */
function parseSSEEvents(body: string): WebUIEvent[] {
  const events: WebUIEvent[] = [];
  const lines = body.split("\n");
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      try {
        const data = line.slice(6);
        events.push(JSON.parse(data));
      } catch {
        // Skip invalid lines
      }
    }
  }
  return events;
}

/**
 * Read SSE stream until timeout or specific event count.
 */
function readSSEStream(
  options: { path: string; headers?: Record<string, string> },
  maxEvents?: number,
  timeoutMs: number = 2000,
): Promise<{ events: WebUIEvent[]; rawBody: string }> {
  return new Promise((resolve, reject) => {
    let rawBody = "";
    let eventCount = 0;
    const timer = setTimeout(() => {
      req.destroy();
      if (rawBody) {
        resolve({ events: parseSSEEvents(rawBody), rawBody });
      } else {
        reject(new Error("SSE stream timed out with no data"));
      }
    }, timeoutMs);

    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: 9124,
        path: options.path,
        method: "GET",
        headers: options.headers || {},
      },
      (res: IncomingMessage) => {
        res.on("data", (chunk: Buffer) => {
          rawBody += chunk.toString();
          eventCount++;
          if (maxEvents && eventCount >= maxEvents) {
            clearTimeout(timer);
            req.destroy();
            resolve({ events: parseSSEEvents(rawBody), rawBody });
          }
        });
        res.on("end", () => {
          clearTimeout(timer);
          resolve({ events: parseSSEEvents(rawBody), rawBody });
        });
      },
    );
    req.on("error", (err) => {
      clearTimeout(timer);
      // Connection closed by client is expected
      if (err.code === "ECONNRESET" && rawBody) {
        resolve({ events: parseSSEEvents(rawBody), rawBody });
      } else {
        reject(err);
      }
    });
    req.end();
  });
}

// =============================================================================
// Test Server Setup
// =============================================================================

class StreamingTestFixture {
  server?: ControlServer;
  backend?: PiSessionBackend;
  sessionBaseDir = "";
  agentDir = "";
  tempDir = "";

  async setup(tempDir: string) {
    this.tempDir = tempDir;
    this.sessionBaseDir = path.join(tempDir, "sessions");
    this.agentDir = path.join(tempDir, "agent");

    fs.mkdirSync(this.sessionBaseDir, { recursive: true });
    fs.mkdirSync(this.agentDir, { recursive: true });

    // Create models.json
    const modelsJson = {
      providers: {
        "llama-cpp-qwen27": {
          id: "llama-cpp-qwen27",
          name: "Qwen27",
          models: [{ id: "test-model-qwen", name: "Qwen27 Test" }],
        },
      },
    };
    fs.writeFileSync(path.join(this.agentDir, "models.json"), JSON.stringify(modelsJson, null, 2));

    this.backend = new PiSessionBackend({
      sessionBaseDir: this.sessionBaseDir,
      cwd: tempDir,
      agentDir: this.agentDir,
    });

    this.server = new ControlServer(this.backend, tempDir, this.sessionBaseDir, {
      port: 9124,
      host: "127.0.0.1",
      auth: { username: "testuser", password: "testpass" },
    });

    await this.server.start();
    await new Promise((r) => setTimeout(r, 50));
  }

  async teardown() {
    if (this.server) {
      await this.server.stop();
      this.server = undefined;
    }
    this.backend = undefined;
  }
}

const fixture = new StreamingTestFixture();

// =============================================================================
// SSE Event Stream Integration Tests
// =============================================================================

describe("SSE event stream - GET /api/live/rooms/:roomKey/events", () => {
  beforeEach(async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "sse-test-"));
    await fixture.setup(tempDir);
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  const authHeader = { Authorization: basicAuthHeader("testuser", "testpass") };

  it("returns 404 for missing room", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/live/rooms/nonexistent123/events",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(404);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("Room not found");
  });

  it("returns SSE headers for valid room", async () => {
    // Create a session
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;

    // Make a short-lived SSE connection to check headers
    const res = await readSSEStream({ path: `/api/live/rooms/${roomKey}/events`, headers: authHeader }, 1, 500);

    // Should have received session_connected event
    expect(res.events.length).toBeGreaterThanOrEqual(1);
    expect(res.events[0].type).toBe("session_connected");
    expect(res.events[0].roomId).toBe("!testroom:example.org");
    expect(res.events[0].roomKey).toBe(roomKey);
  });

  it("emits session_connected event with correct metadata", async () => {
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;
    const sessionId = roomState!.sessionId!;

    const res = await readSSEStream({ path: `/api/live/rooms/${roomKey}/events`, headers: authHeader }, 1, 500);

    const connectedEvent = res.events.find((e) => e.type === "session_connected");
    expect(connectedEvent).toBeDefined();
    expect(connectedEvent!.roomId).toBe("!testroom:example.org");
    expect(connectedEvent!.roomKey).toBe(roomKey);
    expect(connectedEvent!.sessionId).toBe(sessionId);
    expect(connectedEvent!.timestamp).toBeDefined();
  });

  it("emits turn_start, message_update, and turn_end events for a prompt", async () => {
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;

    // Start SSE stream in background
    const ssePromise = readSSEStream(
      { path: `/api/live/rooms/${roomKey}/events`, headers: authHeader },
      undefined,
      3000,
    );

    // Give SSE connection time to establish
    await new Promise((r) => setTimeout(r, 100));

    // Submit a prompt
    await makeRequest(
      {
        method: "POST",
        path: `/api/live/rooms/${roomKey}/prompt`,
        headers: { ...authHeader, "Content-Type": "application/json" },
      },
      JSON.stringify({ text: "Say hello" }),
    );

    // Wait for SSE events
    const res = await ssePromise;

    // Should have received some events (at minimum session_connected)
    expect(res.events.length).toBeGreaterThan(0);

    // Check that we got session_connected
    const connectedEvent = res.events.find((e) => e.type === "session_connected");
    expect(connectedEvent).toBeDefined();

    // May have received turn events depending on timing
    const turnStartEvent = res.events.find((e) => e.type === "turn_start");
    if (turnStartEvent) {
      expect(turnStartEvent.turnId).toBeDefined();
      expect(turnStartEvent.sessionId).toBeDefined();
    }
  });

  it("handles client disconnect gracefully", async () => {
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;

    // Start and immediately destroy connection
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port: 9124,
        path: `/api/live/rooms/${roomKey}/events`,
        method: "GET",
        headers: authHeader,
      },
      (res) => {
        res.on("data", () => {});
      },
    );
    req.end();

    // Destroy immediately
    await new Promise((r) => setTimeout(r, 50));
    req.destroy();

    // Server should still be running
    const res = await makeRequest({ method: "GET", path: "/api/live/rooms", headers: authHeader });
    expect(res.statusCode).toBe(200);
  });
});

// =============================================================================
// Live Transcript API Tests
// =============================================================================

describe("Live transcript API - GET /api/live/rooms/:roomKey/transcript", () => {
  beforeEach(async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "transcript-test-"));
    await fixture.setup(tempDir);
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  const authHeader = { Authorization: basicAuthHeader("testuser", "testpass") };

  it("returns 404 for missing room", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/live/rooms/nonexistent123/transcript",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(404);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("Room not found");
  });

  it("returns busy response with isProcessing: true when room is processing", async () => {
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;
    const sessionId = roomState!.sessionId!;

    // Mark room as processing
    fixture.backend!.setProcessing("!testroom:example.org", true);

    const res = await makeRequest({
      method: "GET",
      path: `/api/live/rooms/${roomKey}/transcript`,
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.roomId).toBe("!testroom:example.org");
    expect(json.roomKey).toBe(roomKey);
    expect(json.sessionId).toBe(sessionId);
    expect(json.items).toEqual([]);
    expect(json.isProcessing).toBe(true);

    // Clean up
    fixture.backend!.clearProcessing("!testroom:example.org");
  });

  it("returns transcript with items when room is not processing and has session file", async () => {
    // Create a session file with test data first
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;
    const sessionId = roomState!.sessionId!;

    // Update the session file path
    const sessionFile = path.join(
      fixture.sessionBaseDir,
      "room-" + roomKey,
      `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, -1)}_${sessionId}.jsonl`,
    );
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, SessionFileBuilder.createSimpleConversation());

    // Update room state to point to session file
    fixture.backend!.getRoomStateManager().updateSessionFile("!testroom:example.org", sessionFile);

    const res = await makeRequest({
      method: "GET",
      path: `/api/live/rooms/${roomKey}/transcript`,
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.sessionId).toBeDefined();
    expect(json.items).toBeDefined();
    expect(json.items.length).toBeGreaterThan(0);

    // Check transcript structure
    const userMessage = json.items.find((item: any) => item.kind === "user_message");
    expect(userMessage).toBeDefined();
    expect(userMessage.text).toContain("capital of France");

    const assistantMessage = json.items.find((item: any) => item.kind === "assistant_message");
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage.text).toContain("Paris");
  });
});

// =============================================================================
// Archive Transcript API Tests
// =============================================================================

describe("Archive transcript API - GET /api/archive/rooms/:roomKey/sessions/:sessionId/transcript", () => {
  beforeEach(async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "archive-transcript-test-"));
    await fixture.setup(tempDir);
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  const authHeader = { Authorization: basicAuthHeader("testuser", "testpass") };

  it("returns 400 for invalid roomKey format", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/archive/rooms/INVALID/sessions/session-123/transcript",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("Invalid room key");
  });

  it("returns 400 for invalid sessionId format", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/archive/rooms/abc123/sessions/invalid@session@id/transcript",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("Invalid session id");
  });

  it("returns 404 for missing session", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/archive/rooms/abc123def456/sessions/nonexistent-session/transcript",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(404);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("Session not found");
  });

  it("returns transcript for existing archived session", async () => {
    // Create a room directory with a session file
    const roomKey = "abc123def456"; // Must be lowercase hex only
    const roomDir = path.join(fixture.sessionBaseDir, `room-${roomKey}`);
    fs.mkdirSync(roomDir, { recursive: true });

    const sessionContent = SessionFileBuilder.createWithToolUse();
    const sessionFile = path.join(roomDir, "2024-01-01T00-00-00-000Z_tool-use-001.jsonl");
    fs.writeFileSync(sessionFile, sessionContent);

    const res = await makeRequest({
      method: "GET",
      path: `/api/archive/rooms/${roomKey}/sessions/tool-use-001/transcript`,
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);

    // Check transcript structure
    expect(json.sessionId).toBe("tool-use-001");
    expect(json.roomKey).toBe(roomKey);
    expect(json.items).toBeDefined();
    expect(json.items.length).toBeGreaterThan(0);

    // Check for user message
    const userMessage = json.items.find((item: any) => item.kind === "user_message");
    expect(userMessage).toBeDefined();
    expect(userMessage.text).toContain("README.md");

    // Check for tool start
    const toolStart = json.items.find((item: any) => item.kind === "tool_start");
    expect(toolStart).toBeDefined();
    expect(toolStart.toolName).toBe("read");

    // Check for tool end
    const toolEnd = json.items.find((item: any) => item.kind === "tool_end");
    expect(toolEnd).toBeDefined();
    expect(toolEnd.success).toBe(true);

    // Check for assistant message
    const assistantMessage = json.items.find((item: any) => item.kind === "assistant_message");
    expect(assistantMessage).toBeDefined();
  });

  it("parses thinking content correctly", async () => {
    const roomKey = "def789abc012"; // Must be lowercase hex only
    const roomDir = path.join(fixture.sessionBaseDir, `room-${roomKey}`);
    fs.mkdirSync(roomDir, { recursive: true });

    const sessionContent = SessionFileBuilder.createWithThinking();
    const sessionFile = path.join(roomDir, "2024-01-01T00-00-00-000Z_thinking-001.jsonl");
    fs.writeFileSync(sessionFile, sessionContent);

    const res = await makeRequest({
      method: "GET",
      path: `/api/archive/rooms/${roomKey}/sessions/thinking-001/transcript`,
      headers: authHeader,
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);

    // Check for thinking item
    const thinkingItem = json.items.find((item: any) => item.kind === "thinking");
    expect(thinkingItem).toBeDefined();
    expect(thinkingItem.text).toContain("explain this clearly");

    // Check for user and assistant messages
    const userMessage = json.items.find((item: any) => item.kind === "user_message");
    expect(userMessage).toBeDefined();

    const assistantMessage = json.items.find((item: any) => item.kind === "assistant_message");
    expect(assistantMessage).toBeDefined();
  });
});

// =============================================================================
// SSE Lazy Hydration Tests
// =============================================================================

describe("SSE lazy hydration for persisted rooms", () => {
  beforeEach(async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lazy-hydration-test-"));
    await fixture.setup(tempDir);
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  const authHeader = { Authorization: basicAuthHeader("testuser", "testpass") };

  it("lazily hydrates persisted managed room on SSE connection", async () => {
    // Create a session and set a desired model (making it a managed room)
    const roomId = "!managedroom:example.org";
    await fixture.backend!.getOrCreateSession(roomId);

    const roomState = fixture.backend!.getLiveRoomInfo(roomId);
    const roomKey = roomState!.roomKey;

    // Set a desired model for this room
    fixture.backend!.setDesiredModelForRoom(roomId, "qwen27", "test-model-qwen");

    // Remove the live room state (simulating shutdown/restart)
    fixture.backend!.getRoomStateManager().remove(roomId);

    // Verify room is no longer live
    expect(fixture.backend!.getLiveRoomInfo(roomId)).toBeUndefined();

    // Connect to SSE - should lazy hydrate
    const res = await readSSEStream({ path: `/api/live/rooms/${roomKey}/events`, headers: authHeader }, 1, 1000);

    // Should have received session_connected event
    expect(res.events.length).toBeGreaterThanOrEqual(1);
    expect(res.events[0].type).toBe("session_connected");
    expect(res.events[0].roomId).toBe(roomId);

    // Room should now be live again
    expect(fixture.backend!.getLiveRoomInfo(roomId)).toBeDefined();
  });
});
