import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["unzipper", "node-unrar-js", "fluent-ffmpeg"],
};

export default nextConfig;
