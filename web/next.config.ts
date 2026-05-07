import type { NextConfig } from "next";
import pkg from "./package.json";

// Build ID único por deploy. Usa o SHA do commit (em Vercel) ou timestamp local.
// Cliente compara com /api/version (server) pra detectar quando há build novo.
const BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8)
  ?? process.env.VERCEL_DEPLOYMENT_ID
  ?? `local-${Date.now()}`;

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
};

export default nextConfig;
