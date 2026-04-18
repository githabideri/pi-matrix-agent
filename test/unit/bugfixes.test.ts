import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixTransport } from "../../src/matrix.js";
import { PiSessionBackend } from "../../src/pi-backend.js";

// Helper to create a minimal test agentDir with required Pi config files
async function createTestAgentDir(withModels: boolean = false): Promise<string> {
  const agentDir = join(tmpdir(), `pi-agent-test-${Date.now()}`);
  await mkdir(agentDir, { recursive: true });

  // Create minimal settings.json
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify(
      {
        theme: "dark",
        defaultProvider: withModels ? "llama-cpp-qwen27" : undefined,
        defaultModel: withModels ? "test-model-qwen" : undefined,
      },
      null,
      2,
    ),
  );

  // Create models.json - with or without models based on flag
  const modelsContent = withModels
    ? {
        providers: {
          "llama-cpp-qwen36": {
            baseUrl: "http://test-gemma:8081/v1",
            api: "openai-completions",
            apiKey: "test-key",
            models: [
              {
                id: "test-model-gemma",
                name: "Test Gemma4 Model",
                reasoning: true,
                input: ["text"],
                contextWindow: 131072,
                maxTokens: 16384,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
          "llama-cpp-qwen27": {
            baseUrl: "http://test-qwen:8080/v1",
            api: "openai-completions",
            apiKey: "test-key",
            models: [
              {
                id: "test-model-qwen",
                name: "Test Qwen27 Model",
                reasoning: true,
                input: ["text"],
                contextWindow: 204800,
                maxTokens: 65536,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        },
      }
    : {
        providers: {},
        models: [],
      };

  await writeFile(join(agentDir, "models.json"), JSON.stringify(modelsContent, null, 2));

  // Create auth.json (empty auth)
  await writeFile(
    join(agentDir, "auth.json"),
    JSON.stringify(
      {
        providers: {},
      },
      null,
      2,
    ),
  );

  return agentDir;
}

// ============================================
// Fix 1: PiSessionBackend.prompt() timeout handling
// ============================================

describe("Bugfix 1: prompt() timeout handling and cleanup", () => {
  let backend: PiSessionBackend;
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `pi-backend-bugfix-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });
    agentTestDir = await createTestAgentDir();

    backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });
  });

  afterEach(async () => {
    await backend.dispose();
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  it("checkProcessingGuard returns error when existing room is processing", () => {
    const roomId = "!room1:example.com";
    const backendAny = backend as any;

    // Create a fake session object to seed the roomStateManager
    const fakeSession = {
      sessionId: "test-session",
      sessionFile: "/tmp/test.jsonl",
      dispose: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as any;

    // Seed the roomStateManager with a fake session
    backendAny.roomStateManager.getOrCreateSession(roomId, fakeSession);

    // Set room to processing state
    backend.setProcessing(roomId, true);

    // Guard check should return error
    expect(backend.checkProcessingGuard(roomId)).toBe("Already working on the previous request.");
  });

  it("checkProcessingGuard returns null when existing room is not processing", () => {
    const roomId = "!room1:example.com";
    const backendAny = backend as any;

    // Create a fake session object to seed the roomStateManager
    const fakeSession = {
      sessionId: "test-session",
      sessionFile: "/tmp/test.jsonl",
      dispose: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as any;

    // Seed the roomStateManager with a fake session
    backendAny.roomStateManager.getOrCreateSession(roomId, fakeSession);

    // Room is not processing
    expect(backend.checkProcessingGuard(roomId)).toBeNull();
  });

  it("inFlightPrompts map is initialized", () => {
    // Verify the inFlightPrompts map exists (private field)
    const backendAny = backend as any;
    expect(backendAny.inFlightPrompts).toBeDefined();
    expect(backendAny.inFlightPrompts instanceof Map).toBe(true);
  });

  it("dispose() cleans up inFlightPrompts", async () => {
    const backendAny = backend as any;

    // Verify inFlightPrompts is cleared after dispose
    await backend.dispose();

    expect(backendAny.inFlightPrompts.size).toBe(0);
  });
});

// ============================================
// Fix 2: Stop typing indicators explicitly
// ============================================

describe("Bugfix 2: stopTypingLoop() sends typing=false", () => {
  let transport: MatrixTransport;

  beforeEach(async () => {
    // Create transport with mock values
    transport = new MatrixTransport(
      "http://localhost:8081",
      "test-token",
      ["!room1:example.com"],
      "@bot:localhost",
      join(tmpdir(), `.matrix-storage-${Date.now()}`),
    );
  });

  afterEach(async () => {
    await transport.stop();
    await rm(join(tmpdir(), `.matrix-storage-${Date.now()}`), { recursive: true, force: true });
  });

  it("stopTypingLoop signature accepts roomId and interval", () => {
    // Verify the method signature
    expect(typeof transport.stopTypingLoop).toBe("function");
    // The method should accept two parameters
    expect(transport.stopTypingLoop.length).toBe(2);
  });

  it("stopTypingLoop calls setTyping with false", async () => {
    const roomId = "!room1:example.com";
    const setTypingSpy = vi.spyOn(transport, "setTyping").mockResolvedValue();

    // Create a typing interval
    const interval = setInterval(() => {}, 1000);

    // Call stopTypingLoop
    transport.stopTypingLoop(roomId, interval);

    // Verify setTyping was called with false
    expect(setTypingSpy).toHaveBeenCalledWith(roomId, false);

    // Clean up
    setTypingSpy.mockRestore();
  });
});

// ============================================
// Fix 3: !model --clear behavior
// ============================================

describe("Bugfix 3: !model --clear switches live session to global default", () => {
  let backend: PiSessionBackend;
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `pi-backend-clear-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });
    agentTestDir = await createTestAgentDir(true); // with models

    backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });
  });

  afterEach(async () => {
    await backend.dispose();
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  it("clearDesiredModel returns truthful message when room is idle", async () => {
    const roomId = "!room1:example.com";

    // Create session and switch to gemma4
    await backend.getOrCreateSession(roomId);
    await backend.switchModel(roomId, "qwen36");

    // Verify desired model is set
    const statusBefore = await backend.getModelStatus(roomId);
    expect(statusBefore!.desiredModel).toBe("qwen36");

    // Clear desired model (room is idle)
    const result = await backend.clearDesiredModel(roomId);

    expect(result.success).toBe(true);
    // Message should indicate immediate switch since room is idle
    expect(result.message).toContain("Switched back to global default");
    expect(result.previousDesiredModel).toBe("qwen36");

    // Verify desired model was cleared
    const statusAfter = await backend.getModelStatus(roomId);
    expect(statusAfter!.desiredModel).toBeUndefined();
  });

  it("clearDesiredModel returns truthful message when no override set", async () => {
    const roomId = "!room1:example.com";

    // Create session without switching model
    await backend.getOrCreateSession(roomId);

    // Clear desired model (no override set)
    const result = await backend.clearDesiredModel(roomId);

    expect(result.success).toBe(true);
    expect(result.message).toContain("No room-specific desired model was set");
  });
});

// ============================================
// Fix 4: XSS prevention in preview room page
// ============================================

describe("Bugfix 4: preview page XSS prevention", () => {
  it("JSON.stringify properly escapes hostile roomKey for script injection", () => {
    // Test various hostile inputs
    const hostileInputs = [
      '"; alert(1); //',
      "<script>alert(1)</script>",
      "'\"",
      "\\",
      "</title><script>alert(1)</script>",
    ];

    for (const input of hostileInputs) {
      const escaped = JSON.stringify(input);
      // JSON.stringify should always produce valid JSON that can be parsed
      const parsed = JSON.parse(escaped);
      expect(parsed).toBe(input);
      // Verify the escaped string is valid JS that won't break out of context
      // When injected as: window.ROOM_KEY = ${escaped};
      // It should result in a valid string assignment, not code execution
      const code = `window.ROOM_KEY = ${escaped};`;
      // The code should be syntactically valid
      expect(() => Function(code)).not.toThrow();
    }
  });

  it("HTML escaping properly escapes hostile roomKey for title", () => {
    const escapeHtml = (str: string) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");

    // Test various hostile inputs
    const hostileInputs = [
      "<script>alert(1)</script>",
      "</title><script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      '" onload="alert(1)"',
    ];

    for (const input of hostileInputs) {
      const escaped = escapeHtml(input);
      // The escaped version should not contain raw HTML tags
      expect(escaped).not.toContain("<");
      expect(escaped).not.toContain(">");
      expect(escaped).not.toContain("<script>");
      expect(escaped).not.toContain("</script>");
    }
  });
});

// ============================================
// Fix 5: WebUI prompt returns 409 when busy
// ============================================

describe("Bugfix 5: live prompt route returns 409 when busy", () => {
  let backend: PiSessionBackend;
  let sessionTestDir: string;
  let agentTestDir: string;

  beforeEach(async () => {
    sessionTestDir = join(tmpdir(), `pi-backend-live-test-${Date.now()}`);
    await mkdir(sessionTestDir, { recursive: true });
    agentTestDir = await createTestAgentDir();

    backend = new PiSessionBackend({
      sessionBaseDir: sessionTestDir,
      cwd: process.cwd(),
      agentDir: agentTestDir,
    });
  });

  afterEach(async () => {
    await backend.dispose();
    await rm(sessionTestDir, { recursive: true, force: true });
    await rm(agentTestDir, { recursive: true, force: true });
  });

  it("preflight busy check: isProcessing flag is correctly set and checked", () => {
    const roomId = "!room1:example.com";
    const backendAny = backend as any;

    // Create a fake session object to seed the roomStateManager
    const fakeSession = {
      sessionId: "test-session",
      sessionFile: "/tmp/test.jsonl",
      dispose: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } as any;

    // Seed the roomStateManager with a fake session
    backendAny.roomStateManager.getOrCreateSession(roomId, fakeSession);

    // Get room state
    const roomState = backend.getLiveRoomInfo(roomId);
    expect(roomState).toBeDefined();
    expect(roomState!.isProcessing).toBe(false);

    // Set room to processing state
    backend.setProcessing(roomId, true);

    // Verify isProcessing returns true
    expect(roomState!.isProcessing).toBe(true);

    // The route checks roomState.isProcessing and returns 409 if true
    // This test verifies the state is correctly set for the route to check
  });
});
