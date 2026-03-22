import { NextResponse } from "next/server";
import fs from "fs";
import fse from "fs-extra";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

// Directories that are considered "cache" / temporary
const CACHE_DIRS = [
  "exports",         // ZIP exports
  "downloads",       // temp archive downloads
  "transcode_cache", // transcoded video cache (if exists)
];

const CACHE_FILES = [
  "duration_cache.json",
];

export async function DELETE() {
  try {
    let freedBytes = 0;

    // Remove cache directories
    for (const dir of CACHE_DIRS) {
      const full = path.join(DATA_DIR, dir);
      if (fs.existsSync(full)) {
        const size = getDirSize(full);
        freedBytes += size;
        await fse.emptyDir(full);
      }
    }

    // Remove cache files
    for (const file of CACHE_FILES) {
      const full = path.join(DATA_DIR, file);
      if (fs.existsSync(full)) {
        const stat = fs.statSync(full);
        freedBytes += stat.size;
        fs.unlinkSync(full);
      }
    }

    const freedMB = (freedBytes / (1024 * 1024)).toFixed(1);
    return NextResponse.json({ success: true, freedMB, message: `تم تنظيف ${freedMB} MB` });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function getDirSize(dir: string): number {
  let size = 0;
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) size += getDirSize(full);
      else size += stat.size;
    }
  } catch {}
  return size;
}
