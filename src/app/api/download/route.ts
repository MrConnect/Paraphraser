import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import fse from "fs-extra";
import path from "path";
import { execFile } from "child_process";
import { resolveFFmpegPath } from "@/lib/ffmpeg";
import crypto from "crypto";

const GOOD_DIR = path.join(process.cwd(), "data", "good");
const EXPORTS_DIR = path.join(process.cwd(), "data", "exports");
const META_FILE = path.join(EXPORTS_DIR, "meta.json");
const FFMPEG_PATH = resolveFFmpegPath();

const EXPIRY_MS = 96 * 60 * 60 * 1000; // 96 hours

interface ExportMeta {
  [id: string]: { path: string; createdAt: number; name: string };
}

function loadMeta(): ExportMeta { try { if (fs.existsSync(META_FILE)) return JSON.parse(fs.readFileSync(META_FILE, "utf-8")); } catch {} return {}; }
function saveMeta(m: ExportMeta) { fs.writeFileSync(META_FILE, JSON.stringify(m), "utf-8"); }

// Cleanup expired exports
async function cleanup() {
  const meta = loadMeta();
  const now = Date.now();
  let changed = false;
  for (const [id, info] of Object.entries(meta)) {
    if (now - info.createdAt > EXPIRY_MS) {
      if (fs.existsSync(info.path)) await fse.remove(info.path);
      delete meta[id];
      changed = true;
    }
  }
  if (changed) saveMeta(meta);
}

// GET: Download a file or an export by id
// ?file=<relative path> — direct file download from good/
// ?id=<export id> — download generated ZIP
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const filePath = url.searchParams.get("file");
  const exportId = url.searchParams.get("id");

  // Cleanup expired exports
  cleanup();

  let targetPath: string;
  let fileName: string;

  if (filePath) {
    // Direct download from good/
    const full = path.resolve(path.join(process.cwd(), filePath));
    if (!full.startsWith(path.resolve(GOOD_DIR))) return new NextResponse("Forbidden", { status: 403 });
    if (!fs.existsSync(full)) return new NextResponse("Not found", { status: 404 });
    targetPath = full;
    fileName = path.basename(full);
  } else if (exportId) {
    // Download generated ZIP
    const meta = loadMeta();
    const info = meta[exportId];
    if (!info) return new NextResponse("Export not found or expired", { status: 404 });
    if (!fs.existsSync(info.path)) { delete meta[exportId]; saveMeta(meta); return new NextResponse("File gone", { status: 404 }); }
    targetPath = info.path;
    fileName = info.name;
  } else {
    return new NextResponse("Missing file or id param", { status: 400 });
  }

  // Serve with Range support for resumable downloads
  const stat = fs.statSync(targetPath);
  const size = stat.size;
  const range = req.headers.get("range");

  const headers: Record<string, string> = {
    "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
    "Accept-Ranges": "bytes",
    "Content-Type": "application/octet-stream",
    "Cache-Control": "public, max-age=345600", // 96 hours
  };

  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : size - 1;
    if (start >= size) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });

    const chunk = end - start + 1;
    const stream = fs.createReadStream(targetPath, { start, end });
    const readable = new ReadableStream({
      start(ctrl) { stream.on("data", (c: any) => ctrl.enqueue(new Uint8Array(c))); stream.on("end", () => ctrl.close()); stream.on("error", (e) => ctrl.error(e)); },
      cancel() { stream.destroy(); },
    });

    return new NextResponse(readable, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": chunk.toString() },
    });
  }

  const stream = fs.createReadStream(targetPath);
  const readable = new ReadableStream({
    start(ctrl) { stream.on("data", (c: any) => ctrl.enqueue(new Uint8Array(c))); stream.on("end", () => ctrl.close()); stream.on("error", (e) => ctrl.error(e)); },
    cancel() { stream.destroy(); },
  });

  return new NextResponse(readable, { headers: { ...headers, "Content-Length": size.toString() } });
}

// POST: Create a ZIP of all good files
export async function POST() {
  try {
    await fse.ensureDir(GOOD_DIR);
    await fse.ensureDir(EXPORTS_DIR);

    // Cleanup old
    await cleanup();

    const files = fs.readdirSync(GOOD_DIR).filter(f => !fs.statSync(path.join(GOOD_DIR, f)).isDirectory());
    if (files.length === 0) return NextResponse.json({ error: "No files in good list" }, { status: 400 });

    const id = crypto.randomBytes(16).toString("hex");
    const zipName = `good_${new Date().toISOString().slice(0, 10)}_${id.slice(0, 8)}.zip`;
    const zipPath = path.join(EXPORTS_DIR, zipName);

    // Use system zip or a simple archiver approach
    // We'll use a tar-like approach with Node.js built-in zlib for streaming
    const archiver = await import("archiver").catch(() => null);

    if (archiver) {
      // If archiver is available
      const output = fs.createWriteStream(zipPath);
      const archive = archiver.default("zip", { zlib: { level: 1 } }); // Fast compression
      archive.pipe(output);
      for (const f of files) {
        archive.file(path.join(GOOD_DIR, f), { name: f });
      }
      await archive.finalize();
      await new Promise<void>((res) => output.on("close", res));
    } else {
      // Fallback: use zip command if available, or create a simple concat
      await new Promise<void>((resolve, reject) => {
        execFile("zip", ["-j", "-1", zipPath, ...files.map(f => path.join(GOOD_DIR, f))],
          { timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
    }

    // Save meta
    const meta = loadMeta();
    meta[id] = { path: zipPath, createdAt: Date.now(), name: zipName };
    saveMeta(meta);

    return NextResponse.json({ id, name: zipName, expiresIn: "96 hours", downloadUrl: `/api/download?id=${id}` });
  } catch (err: any) {
    console.error("ZIP error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
