/**
 * Interrupt API - Integration Tests
 *
 * Tests the POST /api/live/rooms/:roomKey/interrupt endpoint.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { request } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControlServer } from "../../src/control-server.js";
import { PiSessionBackend } from "../../src/pi-backend.js";

// =============================================================================
// Test Server Setup
// =============================================================================

class TestServerFixture {
  server?: ControlServer;
  backend?: PiSessionBackend;
  sessionBaseDir = "";
  agentDir = "";

  async setup(tempDir: string) {
    this.sessionBaseDir = path.join(tempDir, "sessions");
    this.agentDir = path.join(tempDir, "agent");

    fs.mkdirSync(this.sessionBaseDir, { recursive: true });
    fs.mkdirSync(this.agentDir, { recursive: true });

    // Create models.json with test models
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

    // Create settings.json with global default
    const settingsJson = {
      theme: "dark",
      defaultProvider: "llama-cpp-qwen27",
      defaultModel: "test-model-qwen",
    };
    fs.writeFileSync(path.join(this.agentDir, "settings.json"), JSON.stringify(settingsJson, null, 2));

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
  }

  async teardown() {
    await this.server?.stop();
    this.server = undefined;
    this.backend = undefined;
  }
}

const fixture = new TestServerFixture();

// =============================================================================
// HTTP Test Helpers
// =============================================================================

function makeRequest(
  options: { method: string; path: string; headers?: Record<string, string> },
  body?: string,
): Promise<{ statusCode: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: 9124, // Test port
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
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

const authHeader = { Authorization: basicAuthHeader("testuser", "testpass") };

// =============================================================================
// Tests
// =============================================================================

describe("Interrupt API - integration", () => {
  beforeEach(async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "interrupt-test-"));
    await fixture.setup(tempDir);
    // Create a test room by calling getOrCreateSession
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  it("POST /api/live/rooms/:roomKey/interrupt returns 404 for non-existent room", async () => {
    const res = await makeRequest({
      method: "POST",
      path: "/api/live/rooms/nonexistent123/interrupt",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("Room not found");
  });

  it("POST /api/live/rooms/:roomKey/interrupt returns 400 when room is not processing", async () => {
    // Small delay to ensure server is ready
    await new Promise((r) => setTimeout(r, 10));

    // Now try to interrupt - should fail because room is not processing
    const interruptRes = await makeRequest({
      method: "POST",
      path: "/api/live/rooms/3bcd0d8c/interrupt",
      headers: authHeader,
    });
    expect(interruptRes.statusCode).toBe(400);
    const body = JSON.parse(interruptRes.body);
    expect(body.error).toBe("Room is not currently processing");
  });

  it("POST /api/live/rooms/:roomKey/interrupt succeeds when room is processing", async () => {
    // NOTE: This test uses a controllable mock session to verify the abort() path is invoked.
    // We cannot reliably time a real prompt request, so we create a mock session that:
    // 1. Is already in processing state
    // 2. Has a trackable abort() method
    // 3. Resolves waitForIdle() immediately for test determinism

    // Get the room state
    const roomState = fixture.backend!.getSessionByKey("3bcd0d8c");
    if (!roomState) {
      throw new Error("Room not found - should have been created in beforeEach");
    }

    // Create a mock session that tracks abort() calls
    let abortCalled = false;
    const mockSession = {
      ...roomState.session,
      abort: async () => {
        abortCalled = true;
        // The real abort() does: abortRetry(), agent.abort(), waitForIdle()
        // We simulate successful abort by resolving immediately
      },
    } as any;

    // Replace the session in room state with our mock
    roomState.session = mockSession;
    roomState.isProcessing = true;
    roomState.processingStartedAt = new Date();

    // Verify room is in processing state
    let contextRes = await makeRequest({
      method: "GET",
      path: "/api/live/rooms/3bcd0d8c/context",
      headers: authHeader,
    });
    let context = JSON.parse(contextRes.body);
    expect(context.isProcessing).toBe(true);

    // Call interrupt
    const interruptRes = await makeRequest({
      method: "POST",
      path: "/api/live/rooms/3bcd0d8c/interrupt",
      headers: authHeader,
    });

    // Verify abort was called
    expect(abortCalled).toBe(true);

    // Verify success response
    expect(interruptRes.statusCode).toBe(200);
    const interruptBody = JSON.parse(interruptRes.body);
    expect(interruptBody.success).toBe(true);
    expect(interruptBody.message).toBe("Interrupt successful");
    expect(interruptBody.roomKey).toBe("3bcd0d8c");

    // Verify room state reflects stopped processing
    contextRes = await makeRequest({ method: "GET", path: "/api/live/rooms/3bcd0d8c/context", headers: authHeader });
    context = JSON.parse(contextRes.body);
    expect(context.isProcessing).toBe(false);
  });
});
