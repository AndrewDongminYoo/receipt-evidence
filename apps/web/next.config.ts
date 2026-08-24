import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev otherwise writes AGENTS.md/CLAUDE.md into apps/web on every
  // first run — this repo already has its own docs conventions.
  agentRules: false,
};

export default nextConfig;
