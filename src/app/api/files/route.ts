import { NextResponse } from "next/server";
import fs from "fs";
import fse from "fs-extra";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { NextRequest } from "next/server";

const FFMPEG_PATH = path.join(process.cwd(), "node_modules", "@ffmpeg-installer", "win32-x64", "ffmpeg.exe");

const MEDIA_DIR = path.join(process.cwd(), "data", "media");
const THUMB_DIR = path.join(process.cwd(), "data", "thumbnails");
const CACHE_FILE = path.join(process.cwd(), "data", "duration_cache.json");

const VIDEO_EXTS = [".mp4", ".webm", ".avi", ".mkv", ".flv", ".wmv", ".mov", ".m4v"];
const AUDIO_EXTS = [".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac", ".wma"];
const ALL_EXTS = [...VIDEO_EXTS, ...AUDIO_EXTS];

// ── Duration Cache ──
let durationCache: Record<string, number> = {};

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      durationCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    }
  } catch {
    durationCache = {};
  }
}

function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(durationCache), "utf-8");
  } catch {}
}

function getCacheKey(filePath: string): string {
  const stat = fs.statSync(filePath);
  // Key = path + size + mtime — invalidates if file changes
  return crypto.createHash("md5").update(`${filePath}|${stat.size}|${stat.mtimeMs}`).digest("hex");
}

function getDuration(filePath: string): Promise<number> {
  const key = getCacheKey(filePath);
  if (durationCache[key] !== undefined) return Promise.resolve(durationCache[key]);

  return new Promise((resolve) => {
    execFile(
      FFMPEG_PATH,
      ["-i", filePath, "-f", "null", "-"],
      { timeout: 15000 },
      (_err, _stdout, stderr) => {
        const match = (stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        let dur = 0;
        if (match) {
          dur = Math.floor(parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]));
        }
        durationCache[key] = dur;
        resolve(dur);
      }
    );
  });
}

// ── File Scanning ──
function scanDir(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) scanDir(full, results);
    else results.push(full);
  }
  return results;
}

function getThumbHash(filePath: string): string {
  return crypto.createHash("md5").update(filePath).digest("hex");
}

function cleanEmptyParents(dirPath: string) {
  let current = dirPath;
  while (current !== path.resolve(MEDIA_DIR) && current.startsWith(path.resolve(MEDIA_DIR))) {
    try {
      if (fs.readdirSync(current).length === 0) {
        fs.rmdirSync(current);
        current = path.dirname(current);
      } else break;
    } catch { break; }
  }
}

// ── GET: List files ──
export async function GET(req: NextRequest) {
  try {
    await fse.ensureDir(MEDIA_DIR);
    await fse.ensureDir(THUMB_DIR);
    loadCache();

    const all = scanDir(MEDIA_DIR);
    const mediaFiles = all.filter((f) => ALL_EXTS.includes(path.extname(f).toLowerCase()));

    // Process durations in parallel batches of 10 for speed
    const BATCH_SIZE = 10;
    const results: any[] = [];

    for (let i = 0; i < mediaFiles.length; i += BATCH_SIZE) {
      const batch = mediaFiles.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (f) => {
          const ext = path.extname(f).toLowerCase();
          const isVideo = VIDEO_EXTS.includes(ext);
          const stat = fs.statSync(f);
          const relPath = f.replace(/\\/g, "/").replace(process.cwd().replace(/\\/g, "/"), "");

          let duration = 0;
          let thumbnail: string | null = null;

          if (isVideo || AUDIO_EXTS.includes(ext)) {
            duration = await getDuration(f);
          }

          if (isVideo) {
            const hash = getThumbHash(f);
            const thumbFile = `${hash}.jpg`;
            if (fs.existsSync(path.join(THUMB_DIR, thumbFile))) {
              thumbnail = `/api/thumbnail?name=${thumbFile}`;
            }
          }

          return {
            path: relPath,
            name: path.basename(f),
            type: isVideo ? "video" : "audio",
            ext,
            size: stat.size,
            duration,
            thumbnail,
            dir: path.relative(MEDIA_DIR, path.dirname(f)).replace(/\\/g, "/"),
          };
        })
      );
      results.push(...batchResults);
    }

    // Save cache after processing all files
    saveCache();

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
      // Clear cache
      durationCache = {};
      saveCache();
      return NextResponse.json({ success: true });
    }

    if (body.path) {
      const full = path.resolve(path.join(process.cwd(), body.path));
      if (!full.startsWith(path.resolve(MEDIA_DIR))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (fs.existsSync(full)) {
        const hash = getThumbHash(full);
        const thumbPath = path.join(THUMB_DIR, `${hash}.jpg`);
        if (fs.existsSync(thumbPath)) await fse.remove(thumbPath);

        const parentDir = path.dirname(full);
        await fse.remove(full);
        cleanEmptyParents(parentDir);

        return NextResponse.json({ success: true });
      }
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
