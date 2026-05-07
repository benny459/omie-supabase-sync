// Retorna o build ID atual do server. Cliente compara com NEXT_PUBLIC_BUILD_ID
// que ele recebeu na primeira carga; se diferentes, mostra banner "atualizar".
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const buildId =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8)
    ?? process.env.VERCEL_DEPLOYMENT_ID
    ?? process.env.NEXT_PUBLIC_BUILD_ID
    ?? "unknown";
  const version = process.env.NEXT_PUBLIC_APP_VERSION ?? "?";
  return NextResponse.json({ buildId, version });
}
