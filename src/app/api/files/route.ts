import { NextResponse } from "next/server";
import fs from "fs";
import fse from "fs-extra";
import path from "path";
import crypto from "crypto";
import { NextRequest } from "next/server";

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const GOOD_DIR = path.join(process.cwd(), "data", "good");
const BAD_DIR = path.join(process.cwd(), "data", "bad");
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

function getCacheKey(filePath: string, stat: fs.Stats): string {
  return crypto.createHash("md5").update(`${filePath}|${stat.size}|${stat.mtimeMs}`).digest("hex");
}

function getThumbHash(f: string): string { return crypto.createHash("md5").update(f).digest("hex"); }

function scanDir(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  for (const e of fs.readdirSync(dir)) {
    const f = path.join(dir, e);
    try {
      if (fs.statSync(f).isDirectory()) scanDir(f, results);
      else results.push(f);
    } catch {}
  }
  return results;
}

function cleanEmptyParents(dirPath: string, rootDir: string) {
  let c = dirPath;
  const root = path.resolve(rootDir);
  while (c !== root && c.startsWith(root)) {
    try { if (fs.readdirSync(c).length === 0) { fs.rmdirSync(c); c = path.dirname(c); } else break; } catch { break; }
  }
}

function moveThumb(srcPath: string, destPath: string) {
  const oldHash = getThumbHash(srcPath);
  const oldThumb = path.join(THUMB_DIR, `${oldHash}.jpg`);
  const newHash = getThumbHash(destPath);
  const newThumb = path.join(THUMB_DIR, `${newHash}.jpg`);
  if (fs.existsSync(oldThumb)) {
    try { fse.moveSync(oldThumb, newThumb, { overwrite: true }); } catch {}
  }
}

// ── GET: Return files instantly — NO ffmpeg ──
export async function GET() {
  try {
    await fse.ensureDir(MEDIA_DIR);
    await fse.ensureDir(THUMB_DIR);
    loadCache();

    const all = scanDir(MEDIA_DIR);
    const mediaFiles = all.filter(f => ALL_EXTS.includes(path.extname(f).toLowerCase()));

    const results = mediaFiles.map((f) => {
      const ext = path.extname(f).toLowerCase();
      const isVideo = VIDEO_EXTS.includes(ext);
      const stat = fs.statSync(f);
      const key = getCacheKey(f, stat);
      const relPath = f.replace(/\\/g, "/").replace(process.cwd().replace(/\\/g, "/"), "");

      let thumbnail: string | null = null;
      if (isVideo) {
        const hash = getThumbHash(f);
        if (fs.existsSync(path.join(THUMB_DIR, `${hash}.jpg`))) {
          thumbnail = `/api/thumbnail?name=${hash}.jpg`;
        }
      }

      return {
        path: relPath, name: path.basename(f),
        type: isVideo ? "video" : "audio",
        ext, size: stat.size, duration: durationCache[key] ?? 0, thumbnail,
        dir: path.relative(MEDIA_DIR, path.dirname(f)).replace(/\\/g, "/"),
      };
    });

    return NextResponse.json({ files: results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── DELETE ──
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.deleteAll) {
      await fse.emptyDir(MEDIA_DIR);
      await fse.emptyDir(THUMB_DIR);
      durationCache = {}; cacheLoaded = false;
      try { fs.unlinkSync(CACHE_FILE); } catch {}
      return NextResponse.json({ success: true });
    }
    if (body.path) {
      const full = path.resolve(path.join(process.cwd(), body.path));
      if (!full.startsWith(path.resolve(MEDIA_DIR))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      if (fs.existsSync(full)) {
        const hash = getThumbHash(full);
        const tp = path.join(THUMB_DIR, `${hash}.jpg`);
        if (fs.existsSync(tp)) await fse.remove(tp);
        const parent = path.dirname(full);
        await fse.remove(full);
        cleanEmptyParents(parent, MEDIA_DIR);
        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── POST: Mark as Good or Bad ──
export async function POST(req: NextRequest) {
  try {
    const { filePath, target } = await req.json();
    if (!filePath) return NextResponse.json({ error: "No path" }, { status: 400 });

    const destDir = target === "bad" ? BAD_DIR : GOOD_DIR;
    const full = path.resolve(path.join(process.cwd(), filePath));
    if (!full.startsWith(path.resolve(MEDIA_DIR))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!fs.existsSync(full)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await fse.ensureDir(destDir);
    let dest = path.join(destDir, path.basename(full));
    if (fs.existsSync(dest)) {
      const ext = path.extname(full);
      const base = path.basename(full, ext);
      dest = path.join(destDir, `${base}_${Date.now()}${ext}`);
    }
    await fse.move(full, dest);
    moveThumb(full, dest);
    cleanEmptyParents(path.dirname(full), MEDIA_DIR);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
