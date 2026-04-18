import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ControlServer } from "../../src/control-server.js";
import { PiSessionBackend } from "../../src/pi-backend.js";

/**
 * Round 4: API integration testing
 *
 * These tests validate the HTTP API endpoints:
 * - Live control-plane API
 * - Archive API
 * - Control-plane authentication
 *
 * Tests spin up a real HTTP server for integration-level verification.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        port: 9123, // Test port
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
      // Retry once on connection refused (server not ready)
      if (err.code === "ECONNREFUSED") {
        setTimeout(() => {
          makeRequest(options, body).then(resolve).catch(reject);
        }, 100);
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
          models: [
            {
              id: "test-model-qwen",
              name: "Qwen27 Test",
            },
          ],
        },
        "llama-cpp-qwen36": {
          id: "llama-cpp-qwen36",
          name: "Qwen36",
          models: [
            {
              id: "test-model-qwen36",
              name: "Qwen36 Test",
            },
          ],
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
      port: 9123,
      host: "127.0.0.1",
      auth: { username: "testuser", password: "testpass" },
    });

    await this.server.start();
    // Small delay to ensure server is fully ready
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

const fixture = new TestServerFixture();

// =============================================================================
// Control-Plane Authentication Tests
// =============================================================================

describe("Control-plane authentication - integration", () => {
  beforeEach(async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "auth-test-"));
    await fixture.setup(tempDir);
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  it("/ stays open (no auth required)", async () => {
    const res = await makeRequest({ method: "GET", path: "/" });
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe("ok");
  });

  it("protected routes reject requests without Authorization header", async () => {
    const res = await makeRequest({ method: "GET", path: "/api/live/rooms" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Basic");
    const json = JSON.parse(res.body);
    expect(json.error).toBe("Authentication required");
  });

  it("protected routes reject requests with invalid credentials", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/live/rooms",
      headers: { Authorization: basicAuthHeader("wronguser", "wrongpass") },
    });
    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("Invalid credentials");
  });

  it("protected routes accept correct credentials", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/live/rooms",
      headers: { Authorization: basicAuthHeader("testuser", "testpass") },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(res.body))).toBe(true);
  });

  it("archive routes also require authentication", async () => {
    const res = await makeRequest({ method: "GET", path: "/api/archive/rooms/abc123/sessions" });
    expect(res.statusCode).toBe(401);
  });

  it("archive routes accept correct credentials", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/archive/rooms/abc123/sessions",
      headers: { Authorization: basicAuthHeader("testuser", "testpass") },
    });
    expect(res.statusCode).toBe(200);
  });
});

// =============================================================================
// Live Control-Plane API Tests
// =============================================================================

describe("Live control-plane API - integration", () => {
  beforeEach(async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "live-api-test-"));
    await fixture.setup(tempDir);
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  const authHeader = { Authorization: basicAuthHeader("testuser", "testpass") };

  it("GET /api/live/rooms returns empty list initially", async () => {
    const res = await makeRequest({ method: "GET", path: "/api/live/rooms", headers: authHeader });
    expect(res.statusCode).toBe(200);
    const rooms = JSON.parse(res.body);
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms.length).toBe(0);
  });

  it("GET /api/live/rooms returns list after session is created", async () => {
    // Create a session by calling getOrCreateSession
    await fixture.backend!.getOrCreateSession("!testroom:example.org");

    const res = await makeRequest({ method: "GET", path: "/api/live/rooms", headers: authHeader });
    expect(res.statusCode).toBe(200);
    const rooms = JSON.parse(res.body);
    expect(Array.isArray(rooms)).toBe(true);
    expect(rooms.length).toBe(1);
    expect(rooms[0].roomId).toBe("!testroom:example.org");
  });

  it("GET /api/live/rooms/:roomKey returns 404 for non-existent room", async () => {
    const res = await makeRequest({ method: "GET", path: "/api/live/rooms/nonexistent123", headers: authHeader });
    expect(res.statusCode).toBe(404);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("Room not found");
  });

  it("GET /api/live/rooms/:roomKey returns room details for existing room", async () => {
    // Create a session
    await fixture.backend!.getOrCreateSession("!testroom:example.org");

    // Get the room key from the backend
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;

    const res = await makeRequest({ method: "GET", path: `/api/live/rooms/${roomKey}`, headers: authHeader });
    expect(res.statusCode).toBe(200);
    const room = JSON.parse(res.body);
    expect(room.roomId).toBe("!testroom:example.org");
    expect(room.roomKey).toBe(roomKey);
    expect(room.sessionId).toBeDefined();
  });

  it("GET /api/live/rooms/:roomKey/context returns 404 for non-existent room", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/live/rooms/nonexistent123/context",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/live/rooms/:roomKey/context returns context for existing room", async () => {
    // Create a session
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;

    const res = await makeRequest({ method: "GET", path: `/api/live/rooms/${roomKey}/context`, headers: authHeader });
    expect(res.statusCode).toBe(200);
    const context = JSON.parse(res.body);
    expect(context.roomId).toBe("!testroom:example.org");
    expect(context.roomKey).toBe(roomKey);
    expect(context.workingDirectory).toBeDefined();
    expect(context.toolNames).toBeDefined();
  });

  it("POST /api/live/rooms/:roomKey/prompt returns 404 for non-existent room", async () => {
    const res = await makeRequest(
      {
        method: "POST",
        path: "/api/live/rooms/nonexistent123/prompt",
        headers: { ...authHeader, "Content-Type": "application/json" },
      },
      JSON.stringify({ text: "hello" }),
    );
    expect(res.statusCode).toBe(404);
  });

  it("POST /api/live/rooms/:roomKey/prompt returns 400 for missing text", async () => {
    // Create a session
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;

    const res = await makeRequest(
      {
        method: "POST",
        path: `/api/live/rooms/${roomKey}/prompt`,
        headers: { ...authHeader, "Content-Type": "application/json" },
      },
      JSON.stringify({}),
    );
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/live/rooms/:roomKey/prompt returns 409 when room is busy", async () => {
    // Create a session
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;

    // Mark room as processing
    fixture.backend!.setProcessing("!testroom:example.org", true);

    const res = await makeRequest(
      {
        method: "POST",
        path: `/api/live/rooms/${roomKey}/prompt`,
        headers: { ...authHeader, "Content-Type": "application/json" },
      },
      JSON.stringify({ text: "hello" }),
    );

    expect(res.statusCode).toBe(409);
    const json = JSON.parse(res.body);
    expect(json.error).toContain("processing");
    expect(json.retryAfter).toBeDefined();

    // Clean up
    fixture.backend!.clearProcessing("!testroom:example.org");
  });

  it("POST /api/live/rooms/:roomKey/prompt accepts valid prompt (non-blocking)", async () => {
    // Create a session
    await fixture.backend!.getOrCreateSession("!testroom:example.org");
    const roomState = fixture.backend!.getLiveRoomInfo("!testroom:example.org");
    const roomKey = roomState!.roomKey;

    const res = await makeRequest(
      {
        method: "POST",
        path: `/api/live/rooms/${roomKey}/prompt`,
        headers: { ...authHeader, "Content-Type": "application/json" },
      },
      JSON.stringify({ text: "test prompt" }),
    );

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.accepted).toBe(true);
    expect(json.roomKey).toBe(roomKey);
    expect(json.roomId).toBe("!testroom:example.org");
    expect(json.timestamp).toBeDefined();
  });
});

// =============================================================================
// Archive API Tests
// =============================================================================

describe("Archive API - integration", () => {
  beforeEach(async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "archive-test-"));
    await fixture.setup(tempDir);
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  const authHeader = { Authorization: basicAuthHeader("testuser", "testpass") };

  it("GET /api/archive/rooms/:roomKey/sessions validates invalid roomKey", async () => {
    // Invalid roomKey with uppercase characters (must be lowercase hex)
    const res = await makeRequest({ method: "GET", path: "/api/archive/rooms/INVALID/sessions", headers: authHeader });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/archive/rooms/:roomKey/sessions validates roomKey format", async () => {
    // RoomKey must be lowercase hex only
    const res = await makeRequest({ method: "GET", path: "/api/archive/rooms/INVALID/sessions", headers: authHeader });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/archive/rooms/:roomKey/sessions/:sessionId rejects invalid sessionId format", async () => {
    // SessionId with invalid characters (slashes cause Express routing to treat as different path)
    // The important thing is that it's rejected (either 400 or 404)
    const res = await makeRequest({
      method: "GET",
      path: "/api/archive/rooms/abc123/sessions/invalid/id/with/slashes",
      headers: authHeader,
    });
    // Express routing treats path segments differently - can be 400 or 404 depending on routing
    expect([400, 404]).toContain(res.statusCode);
  });

  it("GET /api/archive/rooms/:roomKey/sessions returns 200 for valid but empty room", async () => {
    // Valid hex roomKey but no sessions exist
    const res = await makeRequest({
      method: "GET",
      path: "/api/archive/rooms/abc123def456/sessions",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual([]);
  });

  it("GET /api/archive/rooms/:roomKey/sessions/:sessionId returns 404 for missing session", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/archive/rooms/abc123def456/sessions/nonexistent-session-id",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/archive/rooms/:roomKey/sessions/:sessionId/transcript returns 404 for missing session", async () => {
    const res = await makeRequest({
      method: "GET",
      path: "/api/archive/rooms/abc123def456/sessions/nonexistent-session-id/transcript",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(404);
  });
});

// =============================================================================
// Live Room Rehydration Tests
// =============================================================================

describe("Live room rehydration - integration", () => {
  beforeEach(async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rehydration-test-"));
    await fixture.setup(tempDir);
  });

  afterEach(async () => {
    await fixture.teardown();
  });

  const authHeader = { Authorization: basicAuthHeader("testuser", "testpass") };

  it("persisted managed room is rehydrated on GET /api/live/rooms/:roomKey", async () => {
    // Create a session and set a desired model (making it a managed room)
    const roomId = "!managedroom:example.org";
    await fixture.backend!.getOrCreateSession(roomId);

    // Get the room key
    const roomState = fixture.backend!.getLiveRoomInfo(roomId);
    const roomKey = roomState!.roomKey;

    // Set a desired model for this room
    fixture.backend!.setDesiredModelForRoom(roomId, "qwen36", "test-model-qwen36");

    // Remove the live room state (simulating shutdown/restart)
    fixture.backend!.getRoomStateManager().remove(roomId);

    // Verify room is no longer live
    expect(fixture.backend!.getLiveRoomInfo(roomId)).toBeUndefined();

    // Now try to access via API - should rehydrate
    const res = await makeRequest({ method: "GET", path: `/api/live/rooms/${roomKey}`, headers: authHeader });

    // Should succeed with rehydration
    expect(res.statusCode).toBe(200);
    const room = JSON.parse(res.body);
    expect(room.roomId).toBe(roomId);
    expect(room.roomKey).toBe(roomKey);

    // Room should now be live again
    expect(fixture.backend!.getLiveRoomInfo(roomId)).toBeDefined();
  });
});
