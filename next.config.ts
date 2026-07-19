import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@vercel/sandbox", "esbuild"],
};

export default nextConfig;
