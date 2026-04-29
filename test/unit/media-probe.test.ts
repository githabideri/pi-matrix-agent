import { describe, expect, it } from "vitest";
import { probeMedia } from "../../src/media-probe.js";

describe("probeMedia", () => {
  it("detects JPEG image with dimensions", async () => {
    // Build a minimal JPEG with proper SOI + APP0(JFIF) + SOF0 markers
    const jpegBuffer = Buffer.alloc(256);
    let o = 0;

    // SOI marker
    jpegBuffer[o++] = 0xff;
    jpegBuffer[o++] = 0xd8;

    // APP0 (JFIF) marker - length 16 (including length field itself)
    jpegBuffer[o++] = 0xff;
    jpegBuffer[o++] = 0xe0;
    jpegBuffer[o++] = 0x00;
    jpegBuffer[o++] = 0x10; // length = 16
    jpegBuffer[o++] = 0x4a; // J
    jpegBuffer[o++] = 0x46; // F
    jpegBuffer[o++] = 0x49; // I
    jpegBuffer[o++] = 0x46; // F
    jpegBuffer[o++] = 0x00; // null terminator
    jpegBuffer[o++] = 0x01;
    jpegBuffer[o++] = 0x01; // version 1.1
    jpegBuffer[o++] = 0x00; // units = none
    jpegBuffer[o++] = 0x00;
    jpegBuffer[o++] = 0x01; // density X = 1
    jpegBuffer[o++] = 0x00;
    jpegBuffer[o++] = 0x01; // density Y = 1
    jpegBuffer[o++] = 0x00; // thumbnail width = 0 (none)
    jpegBuffer[o++] = 0x00; // thumbnail height = 0 (none)

    // SOF0 marker (Start of Frame, baseline DCT)
    jpegBuffer[o++] = 0xff;
    jpegBuffer[o++] = 0xc0;
    jpegBuffer[o++] = 0x00;
    jpegBuffer[o++] = 0x0c; // length = 12
    jpegBuffer[o++] = 0x08; // precision 8 bits
    jpegBuffer[o++] = 0x00;
    jpegBuffer[o++] = 0x64; // height = 100
    jpegBuffer[o++] = 0x00;
    jpegBuffer[o++] = 0x32; // width = 50
    jpegBuffer[o++] = 0x03; // 3 components (YCbCr)

    const info = await probeMedia(jpegBuffer);
    expect(info.mimetype).toBe("image/jpeg");
    expect(info.type).toBe("image");
    expect(info.width).toBe(50);
    expect(info.height).toBe(100);
  });

  it("detects PNG image", async () => {
    // Minimal PNG signature + IHDR chunk
    const pngHeader = Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG signature
      0x00,
      0x00,
      0x00,
      0x0d, // IHDR length (13)
      0x49,
      0x48,
      0x44,
      0x52, // "IHDR"
      0x00,
      0x00,
      0x00,
      0x01, // width: 1
      0x00,
      0x00,
      0x00,
      0x01, // height: 1
      0x08,
      0x02, // bit depth 8, color type 2 (RGB)
      0x00,
      0x00,
      0x00, // compression, filter, interlace
      0x90,
      0x77,
      0x53,
      0xde, // CRC
    ]);
    const info = await probeMedia(pngHeader);
    expect(info.mimetype).toBe("image/png");
    expect(info.type).toBe("image");
    expect(info.width).toBe(1);
    expect(info.height).toBe(1);
  });

  it("detects GIF image", async () => {
    // Minimal GIF89a header
    const gifHeader = Buffer.from([
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61, // "GIF89a"
      0x01,
      0x00, // width: 1 (little-endian)
      0x01,
      0x00, // height: 1
      0x80, // GCT flag + color resolution + sort + GCT size
      0x00,
      0x00, // background color
      0x00, // pixel aspect ratio
    ]);
    const info = await probeMedia(gifHeader);
    expect(info.mimetype).toBe("image/gif");
    expect(info.type).toBe("image");
    expect(info.width).toBe(1);
    expect(info.height).toBe(1);
  });

  it("throws on unknown/unrecognized data", async () => {
    const randomData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    await expect(probeMedia(randomData)).rejects.toThrow();
  });
});
