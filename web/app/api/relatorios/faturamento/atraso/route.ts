// GET /api/relatorios/faturamento/atraso?from=YYYY-MM-DD&to=YYYY-MM-DD
// Série temporal do backlog atrasado. Pra cada dia D no [from, to]:
//   Σ valor de PVs onde pv_data_previsao < D AND (pv_dt_fat vazio OR pv_dt_fat > D)
// = quanto estava esperando faturamento no fim daquele dia.
// Também retorna o snapshot atual (ref = to) pros KPIs.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

export type Grupo = "Contrato" | "BOT" | "Projeto" | "Avulso";
export type TipoOmie = "PV" | "OS";

const CAT_TO_GRUPO: Record<string, Grupo> = {
  "Contratuais": "Contrato",
  "BOT/SW":      "BOT",
  "Projetos":    "Projeto",
  "Avulsos":     "Avulso",
  "Revenda":     "Avulso",
  "Outras":      "Avulso",
};
function grupoOf(cat: string | null | undefined): Grupo {
  return CAT_TO_GRUPO[String(cat ?? "")] ?? "Avulso";
}
function grupoFromProjeto(nome: string | null | undefined): Grupo {
  const s = String(nome ?? "").trim().toUpperCase();
  if (s.startsWith("CT")) return "Contrato";
  if (s.startsWith("PJ")) return "Projeto";
  if (s.startsWith("BOT")) return "BOT";
  return "Avulso";
}

function parseFlexDate(s: string): Date | null {
  const t = s.trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return new Date(t.slice(0, 10) + "T00:00:00");
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
  return null;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const to  = url.searchParams.get("to")  ?? url.searchParams.get("ref") ?? new Date().toISOString().slice(0, 10);
  const from = url.searchParams.get("from") ?? to; // sem from → só o snapshot final (1 ponto)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to devem ser YYYY-MM-DD" }, { status: 400 });
  }
  const fromDate = new Date(from + "T00:00:00");
  const toDate   = new Date(to   + "T00:00:00");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "sales" } },
  );

  // Pega TODOS os PVs com pv_data_previsao definida (necessário pra calcular atraso em qq data).
  // Filtro pra reduzir: só os que ainda estavam em aberto em algum momento do range —
  // (pv_dt_fat IS NULL OR pv_dt_fat >= from).
  // 1000 = cap default do PostgREST/Supabase. Pedir mais faz voltar 1000 silenciosamente,
  // batch.length < PAGE trigga break e faltam linhas.
  const PAGE = 1000;
  type Row = {
    empresa: string; pv_os_label: string | null; pv_os_tipo: string | null;
    pv_data_previsao: string | null; pv_dt_fat: string | null;
    pv_valor_total: number | string | null;
    projeto_nome: string | null; codigo_categoria: string | null;
  };
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("mv_pc_avulsos")
      .select("empresa, pv_os_label, pv_os_tipo, pv_data_previsao, pv_dt_fat, pv_valor_total, projeto_nome, codigo_categoria")
      .not("pv_data_previsao", "is", null)
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: `mv_pc_avulsos: ${error.message}` }, { status: 500 });
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (offset > 60_000) break;
  }

  // Dedup por (empresa, pv_os_label) — v_pc_avulsos tem N linhas por PV
  type Pv = { tipo: TipoOmie; grupo: Grupo; valor: number; dt_prev: Date; dt_fat: Date | null };
  const pvs: Pv[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const label = String(r.pv_os_label ?? "").trim();
    if (!label) continue;
    const key = `${r.empresa}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dtPrev = parseFlexDate(String(r.pv_data_previsao ?? ""));
    if (!dtPrev) continue;
    // Se já foi faturado ANTES do range, nunca ficou atrasado no range
    const dtFat = r.pv_dt_fat ? parseFlexDate(String(r.pv_dt_fat)) : null;
    if (dtFat && dtFat < fromDate) continue;
    const tipo: TipoOmie = String(r.pv_os_tipo ?? "").toUpperCase() === "OS" ? "OS" : "PV";
    const grupo = r.codigo_categoria ? grupoOf(r.codigo_categoria) : grupoFromProjeto(r.projeto_nome);
    const valor = Number(r.pv_valor_total) || 0;
    pvs.push({ tipo, grupo, valor, dt_prev: dtPrev, dt_fat: dtFat });
  }

  // Série diária: pra cada dia D no [from, to], soma valores atrasados naquele D
  const serie: { date: string; valor: number; qtd: number; valor_pv: number; valor_os: number }[] = [];
  for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
    let vTotal = 0, vPv = 0, vOs = 0, qtd = 0;
    for (const p of pvs) {
      const foiFaturado = p.dt_fat && p.dt_fat <= d;
      const atrasadoNaqueleDia = p.dt_prev < d && !foiFaturado;
      if (!atrasadoNaqueleDia) continue;
      vTotal += p.valor; qtd += 1;
      if (p.tipo === "PV") vPv += p.valor; else vOs += p.valor;
    }
    serie.push({
      date: ymd(d),
      valor: Number(vTotal.toFixed(2)),
      qtd, valor_pv: Number(vPv.toFixed(2)), valor_os: Number(vOs.toFixed(2)),
    });
  }

  // Snapshot final (últimoo ponto da série = ref) pros KPIs
  const finalPt = serie[serie.length - 1] ?? { valor: 0, qtd: 0, valor_pv: 0, valor_os: 0 };
  const by_tipo: Record<TipoOmie, { qtd: number; valor: number }> = {
    PV: { qtd: 0, valor: finalPt.valor_pv }, OS: { qtd: 0, valor: finalPt.valor_os },
  };
  const by_grupo: Record<Grupo, { qtd: number; valor: number }> = {
    Contrato: { qtd:0, valor:0 }, BOT: { qtd:0, valor:0 }, Projeto: { qtd:0, valor:0 }, Avulso: { qtd:0, valor:0 },
  };
  // Recalcula qtd/by_tipo/by_grupo pro dia de referência
  for (const p of pvs) {
    const foiFaturado = p.dt_fat && p.dt_fat <= toDate;
    if (!(p.dt_prev < toDate && !foiFaturado)) continue;
    by_tipo[p.tipo].qtd += 1;
    by_grupo[p.grupo].qtd += 1; by_grupo[p.grupo].valor += p.valor;
  }

  return NextResponse.json({
    from, to, ref: to,
    totals: { qtd: finalPt.qtd, valor: finalPt.valor },
    by_tipo,
    by_grupo,
    serie,   // <-- novo: série temporal do backlog atrasado
  });
}
