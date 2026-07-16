// POST /api/relatorios/avulsos-daily/send — envia daily ao Webex.
// Chamado pelo botão Webex do /avulsos e do preview.
//
// Estratégia atual: mensagem markdown com link pro /relatorios/avulsos-daily
// (gráfico + histórico ficam no painel). Antes tentávamos anexar PNG via
// next/og mas o Webex rejeita atachment gerado por Satori — trocado por link.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { postWebexMessage } from "@/lib/webex";
import { persistSnapshot } from "@/lib/avulsos-report";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { markdown?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const md = String(body.markdown ?? "").trim();
  if (!md) return NextResponse.json({ error: "markdown vazio" }, { status: 400 });

  // Garante snapshot do dia — assim o gráfico no painel reflete "hoje"
  try { await persistSnapshot(); } catch { /* silencioso — snapshot é best-effort */ }

  const r = await postWebexMessage(md, { target: "report" });
  if (!r.ok) return NextResponse.json({ error: r.error ?? "webex fail" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
