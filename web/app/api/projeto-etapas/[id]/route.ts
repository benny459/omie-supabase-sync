// PATCH /api/projeto-etapas/[id] — edita etapa
//   Body: { etapa?, data_prevista?, data_conclusao?, ordem? }
//   Ao mudar data_prevista incrementa alteracoes_count e appenda no histórico.
// DELETE /api/projeto-etapas/[id]

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

type EtapaRow = {
  data_prevista: string | null;
  alteracoes_count: number;
  historico: Array<{ data: string | null; at: string; por: string }>;
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  let body: { etapa?: string; data_prevista?: string | null; data_conclusao?: string | null; ordem?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const approval = supa.schema("approval" as never);
  const { data: cur, error: fErr } = await approval
    .from("projeto_etapas")
    .select("data_prevista, alteracoes_count, historico")
    .eq("id", id)
    .maybeSingle();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
  if (!cur) return NextResponse.json({ error: "not found" }, { status: 404 });

  const curRow = cur as EtapaRow;
  const patch: Record<string, unknown> = {
    atualizado_por: user.email || user.id,
    atualizado_em: new Date().toISOString(),
  };

  if (body.etapa != null) patch.etapa = String(body.etapa).trim();
  if (body.ordem != null) patch.ordem = Number(body.ordem);
  if (body.data_conclusao !== undefined) patch.data_conclusao = body.data_conclusao;

  if (body.data_prevista !== undefined && body.data_prevista !== curRow.data_prevista) {
    // Registra histórico da data anterior + incrementa contador
    const prev = curRow.data_prevista;
    const hist = Array.isArray(curRow.historico) ? [...curRow.historico] : [];
    hist.push({ data: prev, at: new Date().toISOString(), por: user.email || user.id });
    patch.data_prevista = body.data_prevista;
    patch.alteracoes_count = (curRow.alteracoes_count ?? 0) + 1;
    patch.historico = hist;
  }

  const { error } = await approval.from("projeto_etapas").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const { error } = await supa.schema("approval" as never).from("projeto_etapas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
