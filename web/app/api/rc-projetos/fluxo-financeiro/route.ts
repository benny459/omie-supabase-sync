// POST /api/rc-projetos/fluxo-financeiro — sync do Fluxo Financeiro pro projeto.
// Aplica:
//   1. Budget breakdown em rc_projetos_budget (custos/despesas/serviços + total)
//   2. Sync destrutivo em projeto_etapas por NOME:
//      - existentes → atualiza data_prevista (grava histórico se mudou)
//      - preserva data_conclusao se já marcada
//      - novas entram, removidas saem
//
// Body: {
//   empresa, codigo_projeto,
//   budget: { valor_total, valor_previsto_custos, valor_previsto_despesas,
//             valor_previsto_servicos, resultado_bruto_esperado,
//             resultado_bruto_esperado_pct, condicao_recebimento?,
//             nome_projeto_fluxo? },
//   etapas: [{ nome, data_prevista (YYYY-MM-DD | null), ordem, pct_total? }]
// }

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

type Budget = {
  valor_total?: number | null;
  valor_previsto_custos?: number | null;
  valor_previsto_despesas?: number | null;
  valor_previsto_servicos?: number | null;
  resultado_bruto_esperado?: number | null;
  resultado_bruto_esperado_pct?: number | null;
  condicao_recebimento?: string | null;
  nome_projeto_fluxo?: string | null;
};
type EtapaIn = { nome: string; data_prevista: string | null; ordem?: number };
type Body = { empresa: string; codigo_projeto: number; budget: Budget; etapas: EtapaIn[] };

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userEmail = user.email || user.id;

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (!body.empresa || !body.codigo_projeto) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }

  const empresa = String(body.empresa);
  const codigoProjeto = Number(body.codigo_projeto);
  const approval = supa.schema("approval" as never);

  // ── 1. Budget ───────────────────────────────────────────────
  const b = body.budget ?? {};
  // valor_budget "compatível" = soma dos 3 previstos (para não quebrar view)
  const somaPrevistos =
    Number(b.valor_previsto_custos ?? 0) +
    Number(b.valor_previsto_despesas ?? 0) +
    Number(b.valor_previsto_servicos ?? 0);

  const { error: budErr } = await approval.from("rc_projetos_budget").upsert({
    empresa, codigo_projeto: codigoProjeto,
    valor_budget: Number.isFinite(somaPrevistos) ? somaPrevistos : null,
    valor_total_projeto: b.valor_total ?? null,
    valor_previsto_custos: b.valor_previsto_custos ?? null,
    valor_previsto_despesas: b.valor_previsto_despesas ?? null,
    valor_previsto_servicos: b.valor_previsto_servicos ?? null,
    resultado_bruto_esperado: b.resultado_bruto_esperado ?? null,
    resultado_bruto_esperado_pct: b.resultado_bruto_esperado_pct ?? null,
    condicao_recebimento: b.condicao_recebimento ?? null,
    nome_projeto_fluxo: b.nome_projeto_fluxo ?? null,
    criado_por: userEmail,
    atualizado_por: userEmail,
  }, { onConflict: "empresa,codigo_projeto" });
  if (budErr) return NextResponse.json({ error: `budget: ${budErr.message}` }, { status: 500 });

  // ── 2. Etapas ───────────────────────────────────────────────
  const incoming = (body.etapas ?? [])
    .map((e) => ({ nome: String(e.nome ?? "").trim(), data_prevista: e.data_prevista ?? null, ordem: e.ordem ?? 0 }))
    .filter((e) => e.nome);
  const incomingByName = new Map<string, EtapaIn>();
  for (const e of incoming) incomingByName.set(e.nome.toLowerCase(), e as EtapaIn);

  // Carrega etapas existentes
  const { data: existData, error: exErr } = await approval
    .from("projeto_etapas")
    .select("id, etapa, data_prevista, data_conclusao, alteracoes_count, historico")
    .eq("empresa", empresa)
    .eq("codigo_projeto", codigoProjeto);
  if (exErr) return NextResponse.json({ error: `read etapas: ${exErr.message}` }, { status: 500 });

  type Existing = { id: string; etapa: string; data_prevista: string | null; data_conclusao: string | null; alteracoes_count: number; historico: Array<{ data: string | null; at: string; por: string }> };
  const existing = (existData ?? []) as Existing[];
  const existingByName = new Map<string, Existing>();
  for (const r of existing) existingByName.set(r.etapa.toLowerCase(), r);

  let novos = 0, atualizados = 0, removidos = 0;

  // UPDATE existentes + INSERT novos
  for (const e of incoming) {
    const key = e.nome.toLowerCase();
    const prior = existingByName.get(key);
    if (prior) {
      // Update: se data_prevista mudou, incrementa contador + histórico
      const patch: Record<string, unknown> = {
        ordem: e.ordem,
        atualizado_por: userEmail,
        atualizado_em: new Date().toISOString(),
      };
      if (e.data_prevista !== prior.data_prevista) {
        const hist = Array.isArray(prior.historico) ? [...prior.historico] : [];
        hist.push({ data: prior.data_prevista, at: new Date().toISOString(), por: userEmail });
        patch.data_prevista = e.data_prevista;
        patch.alteracoes_count = (prior.alteracoes_count ?? 0) + 1;
        patch.historico = hist;
      }
      // Preserva data_conclusao — não mexer!
      const { error } = await approval.from("projeto_etapas").update(patch).eq("id", prior.id);
      if (error) return NextResponse.json({ error: `update etapa "${e.nome}": ${error.message}` }, { status: 500 });
      atualizados++;
    } else {
      const { error } = await approval.from("projeto_etapas").insert({
        empresa, codigo_projeto: codigoProjeto,
        etapa: e.nome, ordem: e.ordem,
        data_prevista: e.data_prevista,
        criado_por: userEmail, atualizado_por: userEmail,
      });
      if (error) return NextResponse.json({ error: `insert etapa "${e.nome}": ${error.message}` }, { status: 500 });
      novos++;
    }
  }

  // DELETE removidas
  const idsRemover: string[] = [];
  for (const [name, prior] of existingByName) {
    if (!incomingByName.has(name)) idsRemover.push(prior.id);
  }
  if (idsRemover.length > 0) {
    const { error } = await approval.from("projeto_etapas").delete().in("id", idsRemover);
    if (error) return NextResponse.json({ error: `delete etapas: ${error.message}` }, { status: 500 });
    removidos = idsRemover.length;
  }

  return NextResponse.json({
    ok: true,
    budget: { valor_budget: somaPrevistos },
    etapas: { novos, atualizados, removidos, total: incoming.length },
  });
}
