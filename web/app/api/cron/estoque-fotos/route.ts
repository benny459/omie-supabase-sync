// /api/cron/estoque-fotos — um ciclo da busca automática de fotos do Estoque (lib/estoque-fotos.ts).
// Vercel cron de 10 em 10 min. Não faz nada (e não chama provedor nenhum) se o job estiver pausado,
// se faltar IMAGE_SEARCH_PROVIDER/IMAGE_SEARCH_KEY (/IMAGE_SEARCH_CX) ou se a cota do dia acabou.
// Manual: /api/cron/estoque-fotos?secret=<CRON_SECRET>
import { NextRequest, NextResponse } from "next/server";
import { rodarCiclo } from "@/lib/estoque-fotos";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if ((req.headers.get("authorization") ?? "") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...(await rodarCiclo({ max: 10, prazoMs: 45_000 })) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
