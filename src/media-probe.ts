import { fileTypeFromBuffer } from "file-type";
import probe from "probe-image-size";

export interface ProbedMediaInfo {
  mimetype: string;
  width?: number;
  height?: number;
  duration?: number; // milliseconds
  type: "image" | "video" | "audio";
}

/**
 * Probe a buffer to extract media metadata.
 * - Images: uses probe-image-size (fast, header-only)
 * - Video/Audio: uses ffprobe via fluent-ffmpeg
 * - Fallback: file-type for magic number detection
 */
export async function probeMedia(buffer: Buffer): Promise<ProbedMediaInfo> {
  // Try image probe first (fast, no external binary)
  try {
    const result = probe.sync(buffer);
    if (result?.mime?.startsWith("image/")) {
      return {
        mimetype: result.mime,
        width: result.width,
        height: result.height,
        type: "image",
      };
    }
  } catch {
    // Not an image or unsupported format, continue
  }

  // Try ffprobe for video/audio
  const ffprobeResult = await probeWithFfprobe(buffer);
  if (ffprobeResult) {
    return ffprobeResult;
  }

  // Fallback: detect type from magic numbers
  const fileResult = await fileTypeFromBuffer(buffer);
  if (fileResult) {
    const type = classifyMediaType(fileResult.mime);
    if (type) {
      return {
        mimetype: fileResult.mime,
        type,
      };
    }
  }

  throw new Error("Could not determine media type from buffer");
}

function classifyMediaType(mime: string): "image" | "video" | "audio" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return null;
}

/**
 * Use ffprobe to extract metadata from video/audio buffers.
 * Writes buffer to a temp file, runs ffprobe, cleans up.
 */
async function probeWithFfprobe(buffer: Buffer): Promise<ProbedMediaInfo | null> {
  const { execFile } = await import("node:child_process");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");

  const tmpFile = path.join(os.tmpdir(), `media-probe-${Date.now()}.tmp`);

  try {
    fs.writeFileSync(tmpFile, buffer);

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "ffprobe",
        ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", tmpFile],
        { timeout: 10000 },
        (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        },
      );
    });

    const info = JSON.parse(stdout);
    const streams = info.streams || [];
    const format = info.format || {};

    const videoStream = streams.find((s: any) => s.codec_type === "video");
    const audioStream = streams.find((s: any) => s.codec_type === "audio");

    if (!videoStream && !audioStream) {
      return null; // Not video or audio
    }

    const durationMs = format.duration ? Math.round(parseFloat(format.duration) * 1000) : undefined;

    const mimetype = format.mime_type || detectMimeFromCodec(videoStream, audioStream);

    return {
      mimetype,
      width: videoStream?.width ? parseInt(videoStream.width, 10) : undefined,
      height: videoStream?.height ? parseInt(videoStream.height, 10) : undefined,
      duration: durationMs,
      type: videoStream ? "video" : "audio",
    };
  } catch {
    return null; // ffprobe failed or not available
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

function detectMimeFromCodec(videoStream: any, audioStream: any): string {
  if (videoStream) {
    const codec = videoStream.codec_name || "";
    if (codec === "h264") return "video/mp4";
    if (codec === "vp8" || codec === "vp9") return "video/webm";
    if (codec === "theora") return "video/ogg";
  }
  if (audioStream) {
    const codec = audioStream.codec_name || "";
    if (codec === "mp3") return "audio/mpeg";
    if (codec === "flac") return "audio/flac";
    if (codec === "vorbis") return "audio/ogg";
    if (codec === "opus") return "audio/opus";
  }
  return "application/octet-stream";
}
