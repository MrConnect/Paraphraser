import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import ffmpeg from "fluent-ffmpeg";
import { resolveFFmpegPath } from "@/lib/ffmpeg";

let FFMPEG_PATH: string;
try { FFMPEG_PATH = resolveFFmpegPath(); } catch { FFMPEG_PATH = "ffmpeg"; }
ffmpeg.setFfmpegPath(FFMPEG_PATH);

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const GOOD_DIR = path.join(process.cwd(), "data", "good");
const BAD_DIR = path.join(process.cwd(), "data", "bad");

// Quality → height mapping
const QUALITY_MAP: Record<string, number> = {
  "144": 144, "240": 240, "360": 360, "480": 480, "720": 720, "1080": 1080,
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("path");
  const quality = url.searchParams.get("q") || "original";

  if (!filePath) return new NextResponse("Missing path", { status: 400 });

  const full = path.resolve(path.join(process.cwd(), filePath));

  if (!full.startsWith(path.resolve(MEDIA_DIR)) && !full.startsWith(path.resolve(GOOD_DIR)) && !full.startsWith(path.resolve(BAD_DIR))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  if (!fs.existsSync(full)) return new NextResponse("Not found", { status: 404 });

  const ext = path.extname(full).toLowerCase();
  const isAudio = [".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac", ".wma"].includes(ext);

  // Audio: always direct
  if (isAudio) return serveFile(req, full, getMime(ext));

  // Video: transcode if quality != original or format needs it
  const needsTranscode = [".avi", ".mkv", ".flv", ".wmv", ".mov", ".m4v"].includes(ext);
  const targetHeight = quality !== "original" ? QUALITY_MAP[quality] : null;

  if (targetHeight || needsTranscode) {
    const pass = new PassThrough();
    const cmd = ffmpeg(full)
      .format("mp4")
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-movflags", "frag_keyframe+empty_moov+faststart", "-preset", "ultrafast"]);

    if (targetHeight) {
      cmd.outputOptions(["-vf", `scale=-2:${targetHeight}`]);
    }

    cmd.on("error", (err) => {
      if (!err.message?.includes("Output stream closed")) console.error("FFmpeg:", err.message);
    }).pipe(pass);

    const readable = new ReadableStream({
      start(c) { pass.on("data", (d: any) => c.enqueue(new Uint8Array(d))); pass.on("end", () => c.close()); pass.on("error", (e) => c.error(e)); },
      cancel() { pass.destroy(); },
    });
    return new NextResponse(readable, { headers: { "Content-Type": "video/mp4", "Transfer-Encoding": "chunked" } });
  }

  // Original mp4/webm: direct with Range
  return serveFile(req, full, getMime(ext));
}

function serveFile(req: NextRequest, filePath: string, mime: string) {
  const stat = fs.statSync(filePath);
  const size = stat.size;
  const range = req.headers.get("range");

  if (range) {
    const [s, e] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(s, 10);
    const end = e ? parseInt(e, 10) : size - 1;
    if (start >= size) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const chunk = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    const readable = new ReadableStream({
      start(c) { stream.on("data", (d: any) => c.enqueue(new Uint8Array(d))); stream.on("end", () => c.close()); stream.on("error", (e) => c.error(e)); },
      cancel() { stream.destroy(); },
    });
    return new NextResponse(readable, {
      status: 206,
      headers: { "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes", "Content-Length": chunk.toString(), "Content-Type": mime },
    });
  }

  const stream = fs.createReadStream(filePath);
  const readable = new ReadableStream({
    start(c) { stream.on("data", (d: any) => c.enqueue(new Uint8Array(d))); stream.on("end", () => c.close()); stream.on("error", (e) => c.error(e)); },
    cancel() { stream.destroy(); },
  });
  return new NextResponse(readable, {
    headers: { "Content-Length": size.toString(), "Content-Type": mime, "Accept-Ranges": "bytes" },
  });
}

function getMime(ext: string): string {
  const m: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".flac": "audio/flac", ".aac": "audio/aac" };
  return m[ext] ?? "application/octet-stream";
}
