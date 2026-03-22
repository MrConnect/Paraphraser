import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import fse from "fs-extra";
import path from "path";
import https from "https";
import http from "http";
import unzipper from "unzipper";
import { createExtractorFromData } from "node-unrar-js";
import ffmpeg from "fluent-ffmpeg";
import crypto from "crypto";

// Directly resolve the ffmpeg binary — avoids @ffmpeg-installer module resolution issues in Next.js
const FFMPEG_PATH = path.join(process.cwd(), "node_modules", "@ffmpeg-installer", "win32-x64", "ffmpeg.exe");
ffmpeg.setFfmpegPath(FFMPEG_PATH);

const DOWNLOADS_DIR = path.join(process.cwd(), "data", "downloads");
const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const THUMB_DIR = path.join(process.cwd(), "data", "thumbnails");

const VIDEO_EXTS = [".mp4", ".webm", ".avi", ".mkv", ".flv", ".wmv", ".mov", ".m4v"];

export const maxDuration = 300;

// Generate thumbnail for a single video file using ffmpeg directly
async function generateThumbnail(videoPath: string): Promise<void> {
  const hash = crypto.createHash("md5").update(videoPath).digest("hex");
  const thumbPath = path.join(THUMB_DIR, `${hash}.jpg`);

  if (fs.existsSync(thumbPath)) return;

  const { execFile } = require("child_process");

  return new Promise<void>((resolve) => {
    execFile(
      FFMPEG_PATH,
      [
        "-i", videoPath,
        "-ss", "00:00:03",     // grab frame at 3 seconds
        "-vframes", "1",
        "-vf", "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2",
        "-q:v", "5",
        "-y",                  // overwrite
        thumbPath,
      ],
      { timeout: 30000 },
      (err: any) => {
        if (err) console.error(`Thumbnail failed for ${path.basename(videoPath)}:`, err.message);
        resolve(); // Never reject — continue even if one fails
      }
    );
  });
}

// Scan dir for video files and generate thumbnails
async function generateAllThumbnails(dir: string, send: (msg: string, p: number) => void): Promise<void> {
  await fse.ensureDir(THUMB_DIR);
  const videos: string[] = [];

  function scan(d: string) {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d)) {
      const full = path.join(d, entry);
      if (fs.statSync(full).isDirectory()) scan(full);
      else if (VIDEO_EXTS.includes(path.extname(full).toLowerCase())) videos.push(full);
    }
  }
  scan(dir);

  if (videos.length === 0) return;

  send(`🖼️ جاري توليد صور مصغرة لـ ${videos.length} فيديو...`, 92);

  for (let i = 0; i < videos.length; i++) {
    await generateThumbnail(videos[i]);
    if ((i + 1) % 3 === 0 || i === videos.length - 1) {
      send(`🖼️ تم توليد ${i + 1}/${videos.length} صورة مصغرة`, 92 + Math.floor(((i + 1) / videos.length) * 6));
    }
  }
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url) return NextResponse.json({ error: "No URL provided" }, { status: 400 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (message: string, progress = -1, isError = false) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify({ message, progress, isError }) + "\n"));
        } catch (_) {}
      };

      try {
        await fse.ensureDir(DOWNLOADS_DIR);
        await fse.ensureDir(MEDIA_DIR);

        send("⏳ جاري الاتصال وبدء التحميل...", 5);

        const tempName = `archive_${Date.now()}.tmp`;
        const tempPath = path.join(DOWNLOADS_DIR, tempName);

        await new Promise<void>((resolve, reject) => {
          const doRequest = (targetUrl: string, redirects = 0) => {
            if (redirects > 10) { reject(new Error("Too many redirects")); return; }
            const proto = targetUrl.startsWith("https") ? https : http;
            proto.get(targetUrl, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
              if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                doRequest(res.headers.location, redirects + 1); return;
              }
              if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }

              const total = parseInt(res.headers["content-length"] || "0", 10);
              let downloaded = 0;
              let lastPct = 0;
              const writer = fs.createWriteStream(tempPath);

              res.on("data", (chunk: Buffer) => {
                downloaded += chunk.length;
                if (total > 0) {
                  const pct = Math.floor((downloaded / total) * 100);
                  if (pct >= lastPct + 5) {
                    send(`📥 تم تحميل ${pct}% — ${(downloaded / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB`, 5 + Math.floor(pct * 0.45));
                    lastPct = pct;
                  }
                } else if (downloaded % (3 * 1048576) < chunk.length) {
                  send(`📥 جاري التحميل... ${(downloaded / 1048576).toFixed(1)} MB`, 25);
                }
              });
              res.pipe(writer);
              writer.on("finish", () => resolve());
              writer.on("error", reject);
            }).on("error", reject);
          };
          doRequest(url);
        });

        send("✅ اكتمل التحميل. جاري فحص نوع الملف...", 55);

        const headerBuf = Buffer.alloc(8);
        const fd = fs.openSync(tempPath, "r");
        fs.readSync(fd, headerBuf, 0, 8, 0);
        fs.closeSync(fd);

        let fileType: "zip" | "rar" | "unknown" = "unknown";
        if (headerBuf[0] === 0x50 && headerBuf[1] === 0x4B && headerBuf[2] === 0x03 && headerBuf[3] === 0x04) fileType = "zip";
        else if (headerBuf[0] === 0x52 && headerBuf[1] === 0x61 && headerBuf[2] === 0x72 && headerBuf[3] === 0x21 && headerBuf[4] === 0x1A && headerBuf[5] === 0x07) fileType = "rar";

        if (fileType === "unknown") {
          send("❌ الملف ليس ZIP أو RAR صالح.", 100, true);
          await fse.remove(tempPath);
          controller.close(); return;
        }

        send(`📦 تم التعرف: ${fileType.toUpperCase()}. جاري فك الضغط...`, 60);

        const extractDir = path.join(MEDIA_DIR, `batch_${Date.now()}`);
        await fse.ensureDir(extractDir);

        if (fileType === "zip") {
          await new Promise<void>((resolve, reject) => {
            fs.createReadStream(tempPath)
              .pipe(unzipper.Extract({ path: extractDir }))
              .on("close", resolve).on("error", reject);
          });
          send("✅ تم فك ضغط ZIP.", 90);
        } else {
          const fileBuf = fs.readFileSync(tempPath);
          const wasmPath = path.join(process.cwd(), "node_modules", "node-unrar-js", "dist", "js", "unrar.wasm");
          const wasmBin = fs.readFileSync(wasmPath);
          const extractor = await createExtractorFromData({
            data: new Uint8Array(fileBuf).buffer,
            wasmBinary: new Uint8Array(wasmBin).buffer,
          });
          const { files } = extractor.extract();
          let count = 0;
          for (const entry of files) {
            if (!entry.fileHeader.flags.directory && entry.extraction) {
              const dest = path.join(extractDir, entry.fileHeader.name);
              await fse.ensureDir(path.dirname(dest));
              fs.writeFileSync(dest, Buffer.from(entry.extraction));
              count++;
              if (count % 5 === 0) send(`📂 تم فك ${count} ملف...`, 75);
            }
          }
          send(`✅ تم فك ضغط RAR (${count} ملف).`, 90);
        }

        send("🗑️ جاري حذف الأرشيف الأصلي...", 91);
        await fse.remove(tempPath);

        // Generate thumbnails for extracted videos
        await generateAllThumbnails(extractDir, send);

        send("🎉 تمت العملية بنجاح! الملفات جاهزة.", 100);
        controller.close();
      } catch (err: any) {
        console.error("Process error:", err);
        send("❌ خطأ: " + (err.message || "Unknown error"), 100, true);
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
