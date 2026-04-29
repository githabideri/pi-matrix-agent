import { beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixTransport } from "../../src/matrix.js";

// Helper to create a valid minimal PNG buffer (16x16, RGB)
function createMinimalPngBuffer(): Buffer {
  return Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x10, 0x00, 0x00, 0x00, 0x10, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
  ]);
}

describe("MatrixTransport sendMedia", () => {
  let transport: MatrixTransport;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      uploadContent: vi.fn(),
      downloadContent: vi.fn(),
      sendMessage: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      on: vi.fn(),
      setTyping: vi.fn(),
    };
    transport = new MatrixTransport("http://test", "test", ["room1"], "@test:example.com");
    // Replace internal client with mock
    (transport as any).client = mockClient;
  });

  it("sends m.image for a remote URL", async () => {
    const pngBuffer = createMinimalPngBuffer();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength)),
      headers: { get: () => "image/png" },
    });

    mockClient.uploadContent.mockResolvedValue("mxc://test/media-id");

    await transport.sendMedia("!room:example.org", "$event", "https://example.com/image.png", {
      caption: "A nice image",
    });

    expect(mockClient.sendMessage).toHaveBeenCalledWith(
      "!room:example.org",
      expect.objectContaining({
        msgtype: "m.image",
        body: "A nice image",
        url: "mxc://test/media-id",
        info: expect.objectContaining({
          mimetype: "image/png",
          w: 16,
          h: 16,
        }),
      }),
    );
  });

  it("replies with error for URL that returns 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const replySpy = vi.spyOn(transport, "reply").mockResolvedValue();

    await transport.sendMedia("!room:example.org", "$event", "https://example.com/missing.png");

    expect(replySpy).toHaveBeenCalledWith(
      "!room:example.org",
      "$event",
      "❌ Failed to send media: URL returned 404 Not Found",
    );
    expect(mockClient.uploadContent).not.toHaveBeenCalled();
  });

  it("replies with error for file too large", async () => {
    // Mock fetch to return a large buffer
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11 MB
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(
          largeBuffer.buffer.slice(largeBuffer.byteOffset, largeBuffer.byteOffset + largeBuffer.byteLength),
        ),
      headers: { get: () => "image/png" },
    });

    const replySpy = vi.spyOn(transport, "reply").mockResolvedValue();

    await transport.sendMedia("!room:example.org", "$event", "https://example.com/huge.png");

    expect(replySpy).toHaveBeenCalledWith("!room:example.org", "$event", expect.stringContaining("too large"));
    expect(replySpy).toHaveBeenCalledWith("!room:example.org", "$event", expect.stringContaining("10 MB"));
    expect(mockClient.uploadContent).not.toHaveBeenCalled();
  });

  it("replies with error for invalid media source", async () => {
    const replySpy = vi.spyOn(transport, "reply").mockResolvedValue();

    await transport.sendMedia("!room:example.org", "$event", "not-a-valid-source");

    expect(replySpy).toHaveBeenCalledWith(
      "!room:example.org",
      "$event",
      "❌ Failed to send media: Invalid media source (expected URL, local path, or mxc:// URI)",
    );
  });

  it("uses caption from options", async () => {
    const pngBuffer = createMinimalPngBuffer();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength)),
      headers: { get: () => "image/png" },
    });
    mockClient.uploadContent.mockResolvedValue("mxc://test/media-id");

    await transport.sendMedia("!room:example.org", "$event", "https://example.com/img.png", {
      caption: "This is my custom caption",
    });

    expect(mockClient.sendMessage).toHaveBeenCalledWith(
      "!room:example.org",
      expect.objectContaining({
        msgtype: "m.image",
        body: "This is my custom caption",
        url: "mxc://test/media-id",
      }),
    );
  });

  it("sends m.video with duration when type is video", async () => {
    // Mock probeMedia to return video info
    const probeModule = await import("../../src/media-probe.js");
    vi.spyOn(probeModule, "probeMedia").mockResolvedValue({
      mimetype: "video/mp4",
      width: 1920,
      height: 1080,
      duration: 30000,
      type: "video",
    });

    const videoBuffer = Buffer.alloc(1024);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(
          videoBuffer.buffer.slice(videoBuffer.byteOffset, videoBuffer.byteOffset + videoBuffer.byteLength),
        ),
      headers: { get: () => "video/mp4" },
    });
    mockClient.uploadContent.mockResolvedValue("mxc://test/video-id");

    await transport.sendMedia("!room:example.org", "$event", "https://example.com/video.mp4");

    expect(mockClient.sendMessage).toHaveBeenCalledWith(
      "!room:example.org",
      expect.objectContaining({
        msgtype: "m.video",
        body: "video media",
        url: "mxc://test/video-id",
        info: expect.objectContaining({
          mimetype: "video/mp4",
          w: 1920,
          h: 1080,
          duration: 30000,
        }),
      }),
    );
  });

  it("sends m.audio without dimensions", async () => {
    const probeModule = await import("../../src/media-probe.js");
    vi.spyOn(probeModule, "probeMedia").mockResolvedValue({
      mimetype: "audio/mpeg",
      duration: 180000,
      type: "audio",
    });

    const audioBuffer = Buffer.alloc(1024);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () =>
        Promise.resolve(
          audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength),
        ),
      headers: { get: () => "audio/mpeg" },
    });
    mockClient.uploadContent.mockResolvedValue("mxc://test/audio-id");

    await transport.sendMedia("!room:example.org", "$event", "https://example.com/song.mp3");

    const callArgs = mockClient.sendMessage.mock.calls[0][1];
    expect(callArgs.msgtype).toBe("m.audio");
    expect(callArgs.body).toBe("audio media");
    expect(callArgs.url).toBe("mxc://test/audio-id");
    expect(callArgs.info.mimetype).toBe("audio/mpeg");
    expect(callArgs.info.duration).toBe(180000);
    // Verify no w/h in info
    expect(callArgs.info.w).toBeUndefined();
    expect(callArgs.info.h).toBeUndefined();
  });
});
