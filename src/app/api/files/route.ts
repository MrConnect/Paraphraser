import { NextResponse } from "next/server";
import fs from "fs";
import fse from "fs-extra";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { NextRequest } from "next/server";
import ffmpeg from "fluent-ffmpeg";
import { resolveFFmpegPath } from "@/lib/ffmpeg";

const FFMPEG_PATH = resolveFFmpegPath();
ffmpeg.setFfmpegPath(FFMPEG_PATH);

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const GOOD_DIR = path.join(process.cwd(), "data", "good");
const THUMB_DIR = path.join(process.cwd(), "data", "thumbnails");
const CACHE_FILE = path.join(process.cwd(), "data", "duration_cache.json");

const VIDEO_EXTS = [".mp4", ".webm", ".avi", ".mkv", ".flv", ".wmv", ".mov", ".m4v"];
const AUDIO_EXTS = [".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac", ".wma"];
const ALL_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS];

// ── Duration Cache ──
let durationCache: Record<string, number> = {};
function loadCache() { try { if (fs.existsSync(CACHE_FILE)) durationCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")); } catch { durationCache = {}; } }
function saveCache() { try { fs.writeFileSync(CACHE_FILE, JSON.stringify(durationCache), "utf-8"); } catch {} }
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

function scanDir(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  for (const e of fs.readdirSync(dir)) {
    const f = path.join(dir, e);
    if (fs.statSync(f).isDirectory()) scanDir(f, results);
    else results.push(f);
  }
  return results;
}

function getThumbHash(f: string): string { return crypto.createHash("md5").update(f).digest("hex"); }

function cleanEmptyParents(dirPath: string, rootDir: string) {
  let c = dirPath;
  const root = path.resolve(rootDir);
  while (c !== root && c.startsWith(root)) {
    try { if (fs.readdirSync(c).length === 0) { fs.rmdirSync(c); c = path.dirname(c); } else break; } catch { break; }
  }
}

// Auto-generate missing thumbnails (non-blocking background)
async function autoGenMissingThumbnails() {
  try {
    await fse.ensureDir(THUMB_DIR);
    const all = scanDir(MEDIA_DIR);
    const videos = all.filter(f => VIDEO_EXTS.includes(path.extname(f).toLowerCase()));
    for (const v of videos) {
      const hash = getThumbHash(v);
      const thumbPath = path.join(THUMB_DIR, `${hash}.jpg`);
      if (!fs.existsSync(thumbPath)) {
        await new Promise<void>((resolve) => {
          execFile(FFMPEG_PATH,
            ["-i", v, "-ss", "00:00:03", "-vframes", "1",
             "-vf", "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2",
             "-q:v", "5", "-y", thumbPath],
            { timeout: 30000 }, () => resolve()
          );
        });
      }
    }
  } catch {}
}

// ── GET: List media files ──
export async function GET() {
  try {
    await fse.ensureDir(MEDIA_DIR);
    await fse.ensureDir(THUMB_DIR);
    loadCache();

    const all = scanDir(MEDIA_DIR);
    const mediaFiles = all.filter(f => ALL_EXTS.includes(path.extname(f).toLowerCase()));

    const BATCH = 10;
    const results: any[] = [];
    for (let i = 0; i < mediaFiles.length; i += BATCH) {
      const batch = await Promise.all(
        mediaFiles.slice(i, i + BATCH).map(async (f) => {
          const ext = path.extname(f).toLowerCase();
          const isVideo = VIDEO_EXTS.includes(ext);
          const stat = fs.statSync(f);
          const relPath = f.replace(/\\/g, "/").replace(process.cwd().replace(/\\/g, "/"), "");
          const duration = await getDuration(f);
          let thumbnail: string | null = null;
          if (isVideo) {
            const hash = getThumbHash(f);
            if (fs.existsSync(path.join(THUMB_DIR, `${hash}.jpg`))) thumbnail = `/api/thumbnail?name=${hash}.jpg`;
          }
          return { path: relPath, name: path.basename(f), type: isVideo ? "video" : "audio", ext, size: stat.size, duration, thumbnail, dir: path.relative(MEDIA_DIR, path.dirname(f)).replace(/\\/g, "/") };
        })
      );
      results.push(...batch);
    }
    saveCache();

    // Trigger background thumbnail generation for any missing
    autoGenMissingThumbnails();

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
      durationCache = {}; saveCache();
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

// ── POST: Mark as Good ──
export async function POST(req: NextRequest) {
  try {
    const { filePath } = await req.json();
    if (!filePath) return NextResponse.json({ error: "No path" }, { status: 400 });

    const full = path.resolve(path.join(process.cwd(), filePath));
    if (!full.startsWith(path.resolve(MEDIA_DIR))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!fs.existsSync(full)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await fse.ensureDir(GOOD_DIR);
    const dest = path.join(GOOD_DIR, path.basename(full));

    // Move (rename) to good dir, handle name collision
    let finalDest = dest;
    if (fs.existsSync(finalDest)) {
      const ext = path.extname(full);
      const base = path.basename(full, ext);
      finalDest = path.join(GOOD_DIR, `${base}_${Date.now()}${ext}`);
    }
    await fse.move(full, finalDest);

    // Move thumbnail too
    const oldHash = getThumbHash(full);
    const oldThumb = path.join(THUMB_DIR, `${oldHash}.jpg`);
    const newHash = getThumbHash(finalDest);
    const newThumb = path.join(THUMB_DIR, `${newHash}.jpg`);
    if (fs.existsSync(oldThumb)) await fse.move(oldThumb, newThumb, { overwrite: true });

    // Clean empty parent
    cleanEmptyParents(path.dirname(full), MEDIA_DIR);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
