import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["e2b", "@openai/codex-sdk"],
};

export default nextConfig;
