import type { NextConfig } from "next";
import pkg from "./package.json";

// Build ID único por deploy. DEPLOYMENT_ID > SHA — SHA repete quando fazemos
// múltiplos `vercel --prod` sem commit entre (comum em iteração rápida).
// DEPLOYMENT_ID é único por deploy no Vercel.
// Fallback: package.version + timestamp (garante novidade em qualquer caso).
const BUILD_ID =
  process.env.VERCEL_DEPLOYMENT_ID
  ?? process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8)
  ?? `${pkg.version}-${Date.now()}`;

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  // Recibo em PDF no servidor (05/10/26): o Chromium vai como pacote externo, com
  // os binários (bin/*.br) e a fonte Arimo copiados para as rotas que geram PDF.
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/faturamento/recibo-pdf": ["./node_modules/@sparticuz/chromium/bin/**", "./lib/faturamento/fonts/**"],
    "/api/faturamento/documento-omie": ["./node_modules/@sparticuz/chromium/bin/**", "./lib/faturamento/fonts/**"],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
  },
};

export default nextConfig;
