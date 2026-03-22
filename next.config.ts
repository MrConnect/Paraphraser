import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["unzipper", "node-unrar-js", "fluent-ffmpeg", "archiver"],
  allowedDevOrigins: ["192.168.1.9"],
};

export default nextConfig;
