import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import fse from "fs-extra";
import path from "path";
import crypto from "crypto";

const BAD_DIR = path.join(process.cwd(), "data", "bad");
const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const THUMB_DIR = path.join(process.cwd(), "data", "thumbnails");
const CACHE_FILE = path.join(process.cwd(), "data", "duration_cache.json");

const VIDEO_EXTS = [".mp4", ".webm", ".avi", ".mkv", ".flv", ".wmv", ".mov", ".m4v"];
const AUDIO_EXTS = [".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac", ".wma"];
const ALL_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS];

let durationCache: Record<string, number> = {};
let cacheLoaded = false;
function loadCache() {
  if (cacheLoaded) return;
  try { if (fs.existsSync(CACHE_FILE)) durationCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")); } catch { durationCache = {}; }
  cacheLoaded = true;
}
function getCacheKey(f: string, stat: fs.Stats): string {
  return crypto.createHash("md5").update(`${f}|${stat.size}|${stat.mtimeMs}`).digest("hex");
}
function getThumbHash(f: string): string { return crypto.createHash("md5").update(f).digest("hex"); }

// GET: List bad files — INSTANT, no ffmpeg
export async function GET() {
  try {
    await fse.ensureDir(BAD_DIR);
    await fse.ensureDir(THUMB_DIR);
    loadCache();

    const entries = fs.readdirSync(BAD_DIR).filter(f => ALL_EXTS.includes(path.extname(f).toLowerCase()));

    const files = entries.map((name) => {
      const full = path.join(BAD_DIR, name);
      const ext = path.extname(name).toLowerCase();
      const isVideo = VIDEO_EXTS.includes(ext);
      const stat = fs.statSync(full);
      const key = getCacheKey(full, stat);

      let thumbnail: string | null = null;
      if (isVideo) {
        const hash = getThumbHash(full);
        if (fs.existsSync(path.join(THUMB_DIR, `${hash}.jpg`))) thumbnail = `/api/thumbnail?name=${hash}.jpg`;
      }

      return {
        path: full.replace(/\\/g, "/").replace(process.cwd().replace(/\\/g, "/"), ""),
        name, type: isVideo ? "video" : "audio", ext, size: stat.size,
        duration: durationCache[key] ?? 0, thumbnail,
      };
    });

    return NextResponse.json({ files });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: Remove from bad list (permanently or move back)
export async function DELETE(req: NextRequest) {
  try {
    const { filePath, permanent } = await req.json();
    if (!filePath) return NextResponse.json({ error: "No path" }, { status: 400 });
    const full = path.resolve(path.join(process.cwd(), filePath));
    if (!full.startsWith(path.resolve(BAD_DIR))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!fs.existsSync(full)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (permanent) {
      const hash = getThumbHash(full);
      const tp = path.join(THUMB_DIR, `${hash}.jpg`);
      if (fs.existsSync(tp)) await fse.remove(tp);
      await fse.remove(full);
    } else {
      await fse.ensureDir(MEDIA_DIR);
      const dest = path.join(MEDIA_DIR, path.basename(full));
      await fse.move(full, dest, { overwrite: true });
      const oldHash = getThumbHash(full);
      const oldThumb = path.join(THUMB_DIR, `${oldHash}.jpg`);
      const newHash = getThumbHash(dest);
      const newThumb = path.join(THUMB_DIR, `${newHash}.jpg`);
      if (fs.existsSync(oldThumb)) await fse.move(oldThumb, newThumb, { overwrite: true });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
