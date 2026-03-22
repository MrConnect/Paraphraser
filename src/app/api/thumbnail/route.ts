import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const THUMB_DIR = path.join(process.cwd(), "data", "thumbnails");

export async function GET(req: NextRequest) {
  const name = new URL(req.url).searchParams.get("name");

  if (!name || name.includes("..") || name.includes("/") || name.includes("\\")) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const full = path.join(THUMB_DIR, name);

  if (!fs.existsSync(full)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const data = fs.readFileSync(full);

  return new NextResponse(data, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
