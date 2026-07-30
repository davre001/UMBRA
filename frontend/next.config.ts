import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Pin the workspace root to frontend/ — without this Turbopack falls back to
    // scanning the monorepo root (backend/ + root node_modules included) because
    // of the extra package-lock.json there, which massively slows cold compiles.
    root: path.join(__dirname),
  },
};

export default nextConfig;
