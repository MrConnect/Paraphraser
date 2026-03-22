import path from "path";
import fs from "fs";

// Resolve ffmpeg binary path across platforms WITHOUT importing @ffmpeg-installer/ffmpeg
// (importing it causes webpack bundling errors in Next.js dev mode)
export function resolveFFmpegPath(): string {
  // 1. System ffmpeg (Docker: apk add ffmpeg)
  try {
    const { execFileSync } = require("child_process");
    const result = execFileSync("which", ["ffmpeg"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    if (result && fs.existsSync(result)) return result;
  } catch {}

  // 2. Windows: where ffmpeg
  try {
    const { execFileSync } = require("child_process");
    const result = execFileSync("where", ["ffmpeg"], { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim().split("\n")[0].trim();
    if (result && fs.existsSync(result)) return result;
  } catch {}

  // 3. Look in node_modules manually (no require of @ffmpeg-installer!)
  const os = require("os");
  const platform = os.platform();
  const arch = os.arch();
  const bin = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const archStr = arch === "x64" ? "x64" : arch;

  // Try npm3-style (nested)
  const npm3 = path.join(process.cwd(), "node_modules", "@ffmpeg-installer", "ffmpeg", "node_modules", "@ffmpeg-installer", `${platform}-${archStr}`, bin);
  if (fs.existsSync(npm3)) return npm3;

  // Try npm2-style / hoisted
  const top = path.join(process.cwd(), "node_modules", "@ffmpeg-installer", `${platform}-${archStr}`, bin);
  if (fs.existsSync(top)) return top;

  // Last resort
  return "ffmpeg";
}
