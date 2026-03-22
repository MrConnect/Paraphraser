import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import ffmpeg from "fluent-ffmpeg";

const FFMPEG_PATH = path.join(process.cwd(), "node_modules", "@ffmpeg-installer", "win32-x64", "ffmpeg.exe");
ffmpeg.setFfmpegPath(FFMPEG_PATH);

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const TRANSCODE_EXTS = [".avi", ".mkv", ".flv", ".wmv", ".mov", ".m4v"];

export async function GET(req: NextRequest) {
  const filePath = new URL(req.url).searchParams.get("path");

  if (!filePath) {
    return new NextResponse("Missing path", { status: 400 });
  }

  const full = path.resolve(path.join(process.cwd(), filePath));

  // Security: only serve files within MEDIA_DIR
  if (!full.startsWith(path.resolve(MEDIA_DIR))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  if (!fs.existsSync(full)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const ext = path.extname(full).toLowerCase();

  // ── Transcoding path: convert to mp4 on-the-fly ──
  if (TRANSCODE_EXTS.includes(ext)) {
    const pass = new PassThrough();

    ffmpeg(full)
      .format("mp4")
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions(["-movflags", "frag_keyframe+empty_moov+faststart", "-preset", "ultrafast"])
      .on("error", (err) => {
        if (!err.message?.includes("Output stream closed")) {
          console.error("FFmpeg error:", err.message);
        }
      })
      .pipe(pass);

    const readable = new ReadableStream({
      start(ctrl) {
        pass.on("data", (chunk: Buffer) => ctrl.enqueue(new Uint8Array(chunk)));
        pass.on("end", () => ctrl.close());
        pass.on("error", (e) => ctrl.error(e));
      },
      cancel() {
        pass.destroy();
      },
    });

    return new NextResponse(readable, {
      headers: {
        "Content-Type": "video/mp4",
        "Transfer-Encoding": "chunked",
      },
    });
  }

  // ── Normal streaming with Range support ──
  const stat = fs.statSync(full);
  const size = stat.size;
  const range = req.headers.get("range");
  const mime = getMime(ext);

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : size - 1;

    if (start >= size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }

    const chunk = end - start + 1;
    const fileStream = fs.createReadStream(full, { start, end });

    const readable = new ReadableStream({
      start(ctrl) {
        fileStream.on("data", (c: any) => ctrl.enqueue(new Uint8Array(c)));
        fileStream.on("end", () => ctrl.close());
        fileStream.on("error", (e) => ctrl.error(e));
      },
      cancel() {
        fileStream.destroy();
      },
    });

    return new NextResponse(readable, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunk.toString(),
        "Content-Type": mime,
      },
    });
  }

  // No range — full file
  const fileStream = fs.createReadStream(full);
  const readable = new ReadableStream({
    start(ctrl) {
      fileStream.on("data", (c: any) => ctrl.enqueue(new Uint8Array(c)));
      fileStream.on("end", () => ctrl.close());
      fileStream.on("error", (e) => ctrl.error(e));
    },
    cancel() {
      fileStream.destroy();
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Length": size.toString(),
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
    },
  });
}

function getMime(ext: string): string {
  const map: Record<string, string> = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
  };
  return map[ext] ?? "application/octet-stream";
}
