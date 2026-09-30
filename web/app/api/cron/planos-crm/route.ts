// /api/cron/planos-crm — importa sozinho o plano de fechamento (CP/MC) que o
// CRM publicou para cada projeto ligado. Regras em lib/plano-auto.ts.
//
// Vercel cron de 15 em 15 min. Manual: /api/cron/planos-crm?secret=<CRON_SECRET>
import { NextRequest, NextResponse } from "next/server";
import { sincronizarTodos } from "@/lib/plano-auto";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const r = await sincronizarTodos();
    return NextResponse.json({ ok: true, projetos: r.length, resultados: r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
