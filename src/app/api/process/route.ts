import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import fse from "fs-extra";
import path from "path";
import https from "https";
import http from "http";
import unzipper from "unzipper";
import { createExtractorFromData } from "node-unrar-js";
import crypto from "crypto";
import { execFile } from "child_process";
import { resolveFFmpegPath } from "@/lib/ffmpeg";

let FFMPEG_PATH: string;
try { FFMPEG_PATH = resolveFFmpegPath(); } catch { FFMPEG_PATH = "ffmpeg"; }

const DOWNLOADS_DIR = path.join(process.cwd(), "data", "downloads");
const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const THUMB_DIR = path.join(process.cwd(), "data", "thumbnails");
const CACHE_FILE = path.join(process.cwd(), "data", "duration_cache.json");

const VIDEO_EXTS = [".mp4", ".webm", ".avi", ".mkv", ".flv", ".wmv", ".mov", ".m4v"];
const AUDIO_EXTS = [".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac", ".wma"];
const ALL_MEDIA = [...VIDEO_EXTS, ...AUDIO_EXTS];

export const maxDuration = 300;

// ── Duration cache ──
function loadDurationCache(): Record<string, number> {
  try { if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")); } catch {}
  return {};
}
function saveDurationCache(cache: Record<string, number>) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), "utf-8"); } catch {}
}
function getCacheKey(filePath: string): string {
  const stat = fs.statSync(filePath);
  return crypto.createHash("md5").update(`${filePath}|${stat.size}|${stat.mtimeMs}`).digest("hex");
}

// ── Get duration of a media file ──
function getDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    execFile(FFMPEG_PATH, ["-i", filePath, "-f", "null", "-"], { timeout: 15000 },
      (_e, _o, stderr) => {
        const m = (stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        resolve(m ? Math.floor(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])) : 0);
      });
  });
}

// ── Generate thumbnail ──
function generateThumbnail(videoPath: string): Promise<void> {
  const hash = crypto.createHash("md5").update(videoPath).digest("hex");
  const thumbPath = path.join(THUMB_DIR, `${hash}.jpg`);
  if (fs.existsSync(thumbPath)) return Promise.resolve();

  return new Promise<void>((resolve) => {
    execFile(FFMPEG_PATH,
      ["-i", videoPath, "-ss", "00:00:03", "-vframes", "1",
       "-vf", "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2",
       "-q:v", "5", "-y", thumbPath],
      { timeout: 30000 },
      (err: any) => {
        if (err) console.error(`Thumb fail: ${path.basename(videoPath)}: ${err.message}`);
        resolve();
      }
    );
  });
}

// ── Process all media: thumbnails + durations ──
async function processAllMedia(dir: string, send: (msg: string, p: number) => void): Promise<void> {
  await fse.ensureDir(THUMB_DIR);

  const mediaFiles: string[] = [];
  function scan(d: string) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d)) {
      const f = path.join(d, e);
      if (fs.statSync(f).isDirectory()) scan(f);
      else if (ALL_MEDIA.includes(path.extname(f).toLowerCase())) mediaFiles.push(f);
    }
  }
  scan(dir);

  if (mediaFiles.length === 0) return;

  send(`⚙️ جاري معالجة ${mediaFiles.length} ملف (صور مصغرة + مدد)...`, 91);

  const cache = loadDurationCache();

  for (let i = 0; i < mediaFiles.length; i++) {
    const f = mediaFiles[i];
    const ext = path.extname(f).toLowerCase();
    const isVideo = VIDEO_EXTS.includes(ext);

    // Generate thumbnail for videos
    if (isVideo) {
      await generateThumbnail(f);
    }

    // Cache duration
    const key = getCacheKey(f);
    if (cache[key] === undefined) {
      cache[key] = await getDuration(f);
    }

    // Progress update every 3 files
    if ((i + 1) % 3 === 0 || i === mediaFiles.length - 1) {
      send(`⚙️ ${i + 1}/${mediaFiles.length} ملف...`, 91 + Math.floor(((i + 1) / mediaFiles.length) * 8));
    }
  }

  saveDurationCache(cache);
}

export async function POST(req: NextRequest) {
  const { url } = await req.json();
  if (!url) return NextResponse.json({ error: "No URL" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (message: string, progress = -1, isError = false) => {
        try { controller.enqueue(encoder.encode(JSON.stringify({ message, progress, isError }) + "\n")); } catch {}
      };
      try {
        await fse.ensureDir(DOWNLOADS_DIR);
        await fse.ensureDir(MEDIA_DIR);
        send("⏳ جاري الاتصال وبدء التحميل...", 5);

        const tempPath = path.join(DOWNLOADS_DIR, `archive_${Date.now()}.tmp`);
        await new Promise<void>((resolve, reject) => {
          const doReq = (u: string, r = 0) => {
            if (r > 10) { reject(new Error("Too many redirects")); return; }
            const proto = u.startsWith("https") ? https : http;
            proto.get(u, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
              if (res.statusCode && [301,302,303,307,308].includes(res.statusCode) && res.headers.location) { doReq(res.headers.location, r+1); return; }
              if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
              const total = parseInt(res.headers["content-length"] || "0", 10);
              let dl = 0, lastP = 0;
              const w = fs.createWriteStream(tempPath);
              res.on("data", (c: Buffer) => {
                dl += c.length;
                if (total > 0) { const p = Math.floor((dl/total)*100); if (p >= lastP+5) { send(`📥 ${p}% — ${(dl/1048576).toFixed(1)}/${(total/1048576).toFixed(1)} MB`, 5+Math.floor(p*0.45)); lastP=p; } }
                else if (dl % (3*1048576) < c.length) send(`📥 ${(dl/1048576).toFixed(1)} MB...`, 25);
              });
              res.pipe(w);
              w.on("finish", () => resolve());
              w.on("error", reject);
            }).on("error", reject);
          };
          doReq(url);
        });

        send("✅ اكتمل التحميل. جاري فحص نوع الملف...", 55);
        const hdr = Buffer.alloc(8);
        const fd = fs.openSync(tempPath, "r"); fs.readSync(fd, hdr, 0, 8, 0); fs.closeSync(fd);
        let type: "zip"|"rar"|"unknown" = "unknown";
        if (hdr[0]===0x50&&hdr[1]===0x4B&&hdr[2]===0x03&&hdr[3]===0x04) type="zip";
        else if (hdr[0]===0x52&&hdr[1]===0x61&&hdr[2]===0x72&&hdr[3]===0x21&&hdr[4]===0x1A&&hdr[5]===0x07) type="rar";
        if (type==="unknown") { send("❌ ليس ZIP أو RAR صالح.", 100, true); await fse.remove(tempPath); controller.close(); return; }

        send(`📦 ${type.toUpperCase()} — جاري فك الضغط...`, 60);
        const extractDir = path.join(MEDIA_DIR, `batch_${Date.now()}`);
        await fse.ensureDir(extractDir);

        if (type==="zip") {
          await new Promise<void>((res, rej) => { fs.createReadStream(tempPath).pipe(unzipper.Extract({path:extractDir})).on("close",res).on("error",rej); });
          send("✅ تم فك ZIP.", 90);
        } else {
          const buf = fs.readFileSync(tempPath);
          const wasmPath = path.join(process.cwd(), "node_modules", "node-unrar-js", "dist", "js", "unrar.wasm");
          const wasmBin = fs.readFileSync(wasmPath);
          const ext = await createExtractorFromData({ data: new Uint8Array(buf).buffer, wasmBinary: new Uint8Array(wasmBin).buffer });
          const { files } = ext.extract();
          let c = 0;
          for (const e of files) {
            if (!e.fileHeader.flags.directory && e.extraction) {
              const d = path.join(extractDir, e.fileHeader.name);
              await fse.ensureDir(path.dirname(d));
              fs.writeFileSync(d, Buffer.from(e.extraction));
              c++; if (c%5===0) send(`📂 ${c} ملف...`, 75);
            }
          }
          send(`✅ تم فك RAR (${c} ملف).`, 90);
        }

        send("🗑️ جاري حذف الأرشيف...", 91);
        await fse.remove(tempPath);

        // Generate ALL metadata: thumbnails + durations (everything ready before player)
        await processAllMedia(extractDir, send);

        send("🎉 تمت العملية بنجاح! كل شيء جاهز.", 100);
        controller.close();
      } catch (err: any) {
        console.error("Process error:", err);
        send("❌ " + (err.message || "Unknown error"), 100, true);
        controller.close();
      }
    },
  });

  return new NextResponse(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
