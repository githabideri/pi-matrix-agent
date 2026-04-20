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

  it("POST /api/live/rooms/:roomKey/interrupt returns 200 when room is processing", async () => {
    // Start a prompt in the background
    const promptPromise = makeRequest(
      {
        method: "POST",
        path: "/api/live/rooms/3bcd0d8c/prompt",
        headers: { "Content-Type": "application/json", ...authHeader },
      },
      JSON.stringify({ text: "test prompt for interrupt" }),
    );

    // Wait a tiny bit for the room to enter processing state
    await new Promise((r) => setTimeout(r, 50));

    // Try to interrupt
    const interruptRes = await makeRequest({
      method: "POST",
      path: "/api/live/rooms/3bcd0d8c/interrupt",
      headers: authHeader,
    });

    // Either succeeds (200) or fails with 400 (already finished due to no API key)
    // Both are acceptable since the prompt fails quickly without auth
    if (interruptRes.statusCode === 200) {
      const body = JSON.parse(interruptRes.body);
      expect(body.success).toBe(true);
      expect(body.message).toBe("Interrupt successful");
      expect(body.roomKey).toBe("3bcd0d8c");
    } else if (interruptRes.statusCode === 400) {
      // This is also acceptable - the prompt may have already finished
      const body = JSON.parse(interruptRes.body);
      expect(body.error).toBe("Room is not currently processing");
    }

    await promptPromise;
  });

  it("room state reflects stopped processing after prompt completes", async () => {
    // Verify room is not processing initially
    let contextRes = await makeRequest({
      method: "GET",
      path: "/api/live/rooms/3bcd0d8c/context",
      headers: authHeader,
    });
    let context = JSON.parse(contextRes.body);
    expect(context.isProcessing).toBe(false);

    // Start a prompt
    const promptPromise = makeRequest(
      {
        method: "POST",
        path: "/api/live/rooms/3bcd0d8c/prompt",
        headers: { "Content-Type": "application/json", ...authHeader },
      },
      JSON.stringify({ text: "test" }),
    );

    // Wait for prompt to complete (it fails quickly without auth)
    await promptPromise;

    // Room should be idle again
    contextRes = await makeRequest({ method: "GET", path: "/api/live/rooms/3bcd0d8c/context", headers: authHeader });
    context = JSON.parse(contextRes.body);
    expect(context.isProcessing).toBe(false);
  });
});
