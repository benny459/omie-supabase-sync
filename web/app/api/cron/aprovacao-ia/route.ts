// /api/cron/aprovacao-ia — aprovação automática de PCs avulsos pela Aria.
// Vercel cron 11:00, 15:00 e 20:00 UTC = 08:00, 12:00 e 17:00 de Brasília.
// Idempotente: só aprova o que continua pendente e elegível.
// Manual: /api/cron/aprovacao-ia?secret=<CRON_SECRET>[&simular=1]
import { NextRequest, NextResponse } from "next/server";
import { rodarAprovacaoIA } from "@/lib/aprovacao-ia";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if ((req.headers.get("authorization") ?? "") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const simular = new URL(req.url).searchParams.get("simular") === "1";
    const r = await rodarAprovacaoIA({ aplicar: !simular, disparo: "cron" });
    return NextResponse.json({ ok: true, rodada: r.rodada, modo: r.modo, aprovados: r.aprovados, pulados: r.pulados, falhas: r.falhas });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
