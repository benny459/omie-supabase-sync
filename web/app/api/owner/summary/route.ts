// Owner Dashboard — KPIs e séries macro (sistemas LOCAIS apenas).
// Pipeline (CRM) e Operações (App WW) têm endpoints próprios pra evitar
// estourar timeout do Vercel quando algum deles está offline.
import { NextResponse } from "next/server";
import { requireOwner } from "../_guard";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

type Periodo = "3m" | "6m" | "12m" | "ytd";

function periodoStart(p: Periodo): Date {
  const now = new Date();
  if (p === "ytd") return new Date(now.getFullYear(), 0, 1);
  const months = p === "3m" ? 3 : p === "6m" ? 6 : 12;
  return new Date(now.getFullYear(), now.getMonth() - months, 1);
}

function ymd(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  const { error: guardErr } = await requireOwner();
  if (guardErr) return guardErr;

  const url = new URL(req.url);
  const periodo = (url.searchParams.get("periodo") ?? "12m") as Periodo;
  const from = periodoStart(periodo);
  const fromIso = from.toISOString();

  const admin = supaAdmin();

  // ── Receita: contas_receber liquidadas (status_titulo='LIQUIDADO' ou similar) ──
  // ⚠ contas_receber não tem valor_pago — usamos valor_documento como proxy
  // Filtro por data_vencimento (texto BR, dd/MM/yyyy → parseamos)
  const [
    { data: cr, error: crErr },
    { data: pv, error: pvErr },
    { data: pcs, error: pcsErr },
  ] = await Promise.all([
    admin.schema("finance" as never).from("contas_receber")
      .select("data_vencimento, valor_documento, status_titulo, codigo_cliente_fornecedor, codigo_projeto")
      .gte("synced_at", fromIso)
      .limit(20000),
    admin.schema("sales" as never).from("pedidos_venda")
      .select("data_previsao, valor_total, etapa, codigo_cliente, codigo_projeto, d_inc")
      .gte("synced_at", fromIso)
      .limit(20000),
    admin.schema("approval" as never).from("approvals")
      .select("empresa, ncod_ped, status, valor_aprovado, aprovado_em, pv_os_label")
      .eq("status", "APROVADO")
      .gte("aprovado_em", fromIso)
      .limit(20000),
  ]);

  if (crErr || pvErr || pcsErr) {
    return NextResponse.json({
      error: "Falha lendo dados base",
      details: { cr: crErr?.message, pv: pvErr?.message, pcs: pcsErr?.message },
    }, { status: 500 });
  }

  // Agrupamento por mês (YYYY-MM)
  const byMonth: Record<string, { receita: number; receita_contratada: number; compras: number }> = {};
  function bump(mes: string, key: "receita" | "receita_contratada" | "compras", v: number) {
    if (!byMonth[mes]) byMonth[mes] = { receita: 0, receita_contratada: 0, compras: 0 };
    byMonth[mes][key] += v;
  }

  // Parse BR date (dd/MM/yyyy ou ISO)
  function parseBrToDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!m) return null;
    return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  }

  let receitaRealizada = 0;
  let receitaContratada = 0;
  let custoCompras = 0;

  for (const r of (cr ?? [])) {
    const dt = parseBrToDate(r.data_vencimento);
    if (!dt || dt < from) continue;
    const liquidado = (r.status_titulo ?? "").toUpperCase() === "LIQUIDADO" || (r.status_titulo ?? "").toUpperCase() === "RECEBIDO";
    if (!liquidado) continue;
    const v = Number(r.valor_documento ?? 0);
    receitaRealizada += v;
    bump(ymd(dt).slice(0, 7), "receita", v);
  }

  for (const p of (pv ?? [])) {
    const dt = parseBrToDate((p as { data_previsao?: string }).data_previsao) ?? parseBrToDate((p as { d_inc?: string }).d_inc);
    if (!dt || dt < from) continue;
    if ((p as { etapa?: string }).etapa === "60") continue;  // cancelado
    const v = Number((p as { valor_total?: number }).valor_total ?? 0);
    receitaContratada += v;
    bump(ymd(dt).slice(0, 7), "receita_contratada", v);
  }

  for (const a of (pcs ?? [])) {
    const dt = a.aprovado_em ? new Date(a.aprovado_em) : null;
    if (!dt || dt < from) continue;
    const v = Number(a.valor_aprovado ?? 0);
    custoCompras += v;
    bump(ymd(dt).slice(0, 7), "compras", v);
  }

  // Top 10 fornecedores e categorias via v_pc_completo_enriched (já tem nome resolvido)
  const { data: pcEnriched } = await admin
    .schema("approval" as never).from("v_pc_completo_enriched")
    .select("nome_fornecedor, codigo_categoria, projeto_nome, valor_total, status, aprovado_em")
    .eq("status", "APROVADO")
    .gte("aprovado_em", fromIso)
    .limit(10000);

  const fornAgg = new Map<string, number>();
  const catAgg = new Map<string, number>();
  const projAgg = new Map<string, number>();
  for (const r of (pcEnriched ?? []) as Array<{
    nome_fornecedor?: string; codigo_categoria?: string; projeto_nome?: string; valor_total?: number;
  }>) {
    const v = Number(r.valor_total ?? 0);
    if (!v) continue;
    if (r.nome_fornecedor) fornAgg.set(r.nome_fornecedor, (fornAgg.get(r.nome_fornecedor) ?? 0) + v);
    if (r.codigo_categoria) catAgg.set(r.codigo_categoria, (catAgg.get(r.codigo_categoria) ?? 0) + v);
    if (r.projeto_nome) projAgg.set(r.projeto_nome, (projAgg.get(r.projeto_nome) ?? 0) + v);
  }
  const topN = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([nome, total]) => ({ nome, total }));

  // Série mensal ordenada
  const por_mes = Object.entries(byMonth)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, v]) => ({ mes, receita: v.receita, receita_contratada: v.receita_contratada, compras: v.compras }));

  const margemBruta = receitaRealizada - custoCompras;
  const margemPct = receitaRealizada > 0 ? (margemBruta / receitaRealizada) * 100 : 0;

  // Tendência MoM: compara último mês vs anterior
  let tendencia_mom = 0;
  if (por_mes.length >= 2) {
    const last = por_mes[por_mes.length - 1].receita;
    const prev = por_mes[por_mes.length - 2].receita;
    tendencia_mom = prev > 0 ? ((last - prev) / prev) * 100 : 0;
  }

  return NextResponse.json({
    periodo,
    desde: fromIso,
    pl: {
      receita_realizada: receitaRealizada,
      receita_contratada: receitaContratada,
      custo_compras: custoCompras,
      margem_bruta: margemBruta,
      margem_pct: margemPct,
      tendencia_mom,
    },
    compras: {
      total_aprovado: custoCompras,
      qtd_pcs: (pcs ?? []).length,
      top_fornecedores: topN(fornAgg, 10),
      top_categorias: topN(catAgg, 10),
      top_projetos: topN(projAgg, 10),
      por_mes: por_mes.map((m) => ({ mes: m.mes, total: m.compras })),
    },
    serie_mensal: por_mes,
  });
}
