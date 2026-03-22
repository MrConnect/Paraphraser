import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import fse from "fs-extra";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { resolveFFmpegPath } from "@/lib/ffmpeg";

const FFMPEG_PATH = resolveFFmpegPath();
const GOOD_DIR = path.join(process.cwd(), "data", "good");
const THUMB_DIR = path.join(process.cwd(), "data", "thumbnails");
const CACHE_FILE = path.join(process.cwd(), "data", "duration_cache.json");

const VIDEO_EXTS = [".mp4", ".webm", ".avi", ".mkv", ".flv", ".wmv", ".mov", ".m4v"];
const AUDIO_EXTS = [".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac", ".wma"];
const ALL_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS];

let durationCache: Record<string, number> = {};
function loadCache() { try { if (fs.existsSync(CACHE_FILE)) durationCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")); } catch { durationCache = {}; } }
function getCacheKey(f: string): string { const s = fs.statSync(f); return crypto.createHash("md5").update(`${f}|${s.size}|${s.mtimeMs}`).digest("hex"); }
function getDuration(filePath: string): Promise<number> {
  const key = getCacheKey(filePath);
  if (durationCache[key] !== undefined) return Promise.resolve(durationCache[key]);
  return new Promise((resolve) => {
    execFile(FFMPEG_PATH, ["-i", filePath, "-f", "null", "-"], { timeout: 15000 },
      (_e, _o, stderr) => {
        const m = (stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        const d = m ? Math.floor(parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])) : 0;
        durationCache[key] = d;
        resolve(d);
      });
  });
}

function getThumbHash(f: string): string { return crypto.createHash("md5").update(f).digest("hex"); }

// GET: List good files
export async function GET() {
  try {
    await fse.ensureDir(GOOD_DIR);
    await fse.ensureDir(THUMB_DIR);
    loadCache();

    const entries = fs.readdirSync(GOOD_DIR).filter(f => ALL_EXTS.includes(path.extname(f).toLowerCase()));

    const files = await Promise.all(entries.map(async (name) => {
      const full = path.join(GOOD_DIR, name);
      const ext = path.extname(name).toLowerCase();
      const isVideo = VIDEO_EXTS.includes(ext);
      const stat = fs.statSync(full);
      const duration = await getDuration(full);
      let thumbnail: string | null = null;
      if (isVideo) {
        const hash = getThumbHash(full);
        if (fs.existsSync(path.join(THUMB_DIR, `${hash}.jpg`))) thumbnail = `/api/thumbnail?name=${hash}.jpg`;
      }
      return {
        path: full.replace(/\\/g, "/").replace(process.cwd().replace(/\\/g, "/"), ""),
        name, type: isVideo ? "video" : "audio", ext, size: stat.size, duration, thumbnail
      };
    }));

    return NextResponse.json({ files });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: Remove from good list (move back to media, or delete permanently)
export async function DELETE(req: NextRequest) {
  try {
    const { filePath, permanent } = await req.json();
    if (!filePath) return NextResponse.json({ error: "No path" }, { status: 400 });
    const full = path.resolve(path.join(process.cwd(), filePath));
    if (!full.startsWith(path.resolve(GOOD_DIR))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!fs.existsSync(full)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (permanent) {
      const hash = getThumbHash(full);
      const tp = path.join(THUMB_DIR, `${hash}.jpg`);
      if (fs.existsSync(tp)) await fse.remove(tp);
      await fse.remove(full);
    } else {
      // Move back to media
      const MEDIA_DIR = path.join(process.cwd(), "data", "media");
      await fse.ensureDir(MEDIA_DIR);
      await fse.move(full, path.join(MEDIA_DIR, path.basename(full)), { overwrite: true });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
