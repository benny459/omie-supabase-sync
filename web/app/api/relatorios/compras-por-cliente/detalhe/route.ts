// GET /api/relatorios/compras-por-cliente/detalhe
// Query params:
//   cliente:  codigo_cliente_omie (bigint, -10 pro sentinel)
//   metric:   "compras" | "receita"
//   tipo:     opcional — filtra por tipo_venda (bucket)
//   from,to:  YYYY-MM-DD (obrigatórios)
//
// Retorna:
//   metric=compras → lista de PCs individuais que somam o valor mostrado
//   metric=receita → lista de NFs (linhas de faturamento_unificado)

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

function admin(schema: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema } },
  );
}

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const cliente = Number(url.searchParams.get("cliente"));
  const metric  = (url.searchParams.get("metric") ?? "").toLowerCase();
  const tipo    = url.searchParams.get("tipo");
  const from    = url.searchParams.get("from") ?? "";
  const to      = url.searchParams.get("to") ?? "";
  if (!Number.isFinite(cliente))                             return NextResponse.json({ error: "cliente inválido" }, { status: 400 });
  if (!["compras", "receita"].includes(metric))              return NextResponse.json({ error: "metric = compras|receita" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to obrigatórios YYYY-MM-DD" }, { status: 400 });
  }

  // ─── RECEITA: linhas de faturamento_unificado do cliente no período ─────
  if (metric === "receita") {
    const svc = admin("sales");
    const { data, error } = await svc.from("faturamento_unificado")
      .select("empresa, codigo_cliente, cliente_nome, codigo_projeto, projeto_nome, codigo_categoria, dt_fat_d, valor_total, numero_nfse, numero_pedido, numero_contrato")
      .eq("codigo_cliente", String(cliente))
      .gte("dt_fat_d", from).lte("dt_fat_d", to)
      .order("dt_fat_d", { ascending: false })
      .limit(2000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    let rows = data ?? [];
    // Filtro por tipo via heurística de projeto (bate com cat_venda_projeto SQL).
    if (tipo) {
      rows = rows.filter((r: { projeto_nome?: string | null }) => {
        const p = (r.projeto_nome ?? "").toUpperCase();
        let t = "Outras";
        if (p.startsWith("47_") || /CT\d+[A-Z]?_/.test(p)) t = "Contratuais";
        else if (p.startsWith("PJ") || p.startsWith("40_")) t = "Projetos";
        else if (p.startsWith("41_") || p.startsWith("AV")) t = "Avulsos";
        else if (p.startsWith("42_") || p.includes("REVENDA")) t = "Revenda";
        else if (p.startsWith("46_") || p.includes("BOT") || p.includes("SW")) t = "BOT/SW";
        return t === tipo;
      });
    }
    const total = rows.reduce((a, r) => a + (Number((r as { valor_total: string | number }).valor_total) || 0), 0);
    return NextResponse.json({
      metric, cliente, tipo, from, to,
      linhas: rows,
      total: Number(total.toFixed(2)),
      qtd: rows.length,
    });
  }

  // ─── COMPRAS: PCs individuais (v_pc_avulsos ∪ v_pc_pcs) atribuídos ao cliente ─
  const svcAppr = admin("approval");
  const svcPlat = admin("platform");

  // Filtro no SQL: aprovado_em OU _dt_inclusao_d dentro do range.
  // .or() do PostgREST cobre "OU". Datas em ISO — aprovado_em é timestamp,
  // range gte/lte funciona nele diretamente.
  const rangeFilter = `and(aprovado_em.gte.${from},aprovado_em.lte.${to}T23:59:59),and(aprovado_em.is.null,_dt_inclusao_d.gte.${from},_dt_inclusao_d.lte.${to})`;
  type Pc = {
    empresa: string; pc_numero: string; nome_fornecedor: string | null; contato_fornecedor: string | null;
    projeto_nome: string | null; codigo_projeto: number | null;
    valor_total: string; aprovado_em: string | null; _dt_inclusao_d: string | null;
    pv_cliente_codigo: number | null; pv_cliente_nome: string | null;
    status: string;
    __fonte: "avulsos" | "pcs";
  };
  const allPcs: Pc[] = [];
  for (const view of ["v_pc_avulsos", "v_pc_pcs"] as const) {
    const { data, error } = await svcAppr.from(view)
      .select("empresa, pc_numero, nome_fornecedor, contato_fornecedor, projeto_nome, codigo_projeto, valor_total, aprovado_em, _dt_inclusao_d, pv_cliente_codigo, pv_cliente_nome, status")
      .eq("status", "APROVADO")
      .or(rangeFilter)
      .limit(2000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as Omit<Pc, "__fonte">[];
    for (const b of batch) allPcs.push({ ...b, __fonte: view === "v_pc_avulsos" ? "avulsos" : "pcs" });
  }
  // Dedup: mesmo pc pode aparecer em v_pc_avulsos E v_pc_pcs. Prefere avulsos (canônica).
  const seen = new Set<string>();
  const inRange: Pc[] = [];
  for (const p of allPcs) {
    const k = `${p.empresa}|${p.pc_numero}`;
    if (seen.has(k)) continue;
    seen.add(k);
    inRange.push(p);
  }

  // Atribuição manual — pra rateio de standalones
  const { data: atribsData } = await svcPlat.from("pc_cliente_atribuicao")
    .select("empresa, pc_numero, codigo_cliente_omie, percentual");
  const atribsByPc = new Map<string, { codigo_cliente_omie: number; percentual: number }[]>();
  for (const a of (atribsData ?? []) as { empresa: string; pc_numero: string; codigo_cliente_omie: number; percentual: string | number }[]) {
    const k = `${a.empresa}|${a.pc_numero}`;
    const arr = atribsByPc.get(k) ?? [];
    arr.push({ codigo_cliente_omie: a.codigo_cliente_omie, percentual: Number(a.percentual) });
    atribsByPc.set(k, arr);
  }
  // Projeto → cliente auto-map
  const svcBi = admin("bi");
  const { data: mapData } = await svcBi.from("projeto_cliente_map")
    .select("projeto_nome, codigo_cliente_omie");
  const projMap = new Map((mapData ?? []).map((m: { projeto_nome: string; codigo_cliente_omie: number }) => [m.projeto_nome, m.codigo_cliente_omie]));

  // Resolve cada PC → 1..N linhas (empresa,pc,cliente,pct)
  type Line = Pc & { resolved_cliente: number; pct: number; origem: string; valor_rateado: number };
  const resolved: Line[] = [];
  for (const p of inRange) {
    const atribs = atribsByPc.get(`${p.empresa}|${p.pc_numero}`);
    if (p.pv_cliente_codigo != null) {
      resolved.push({ ...p, resolved_cliente: Number(p.pv_cliente_codigo), pct: 100, origem: "pv_origem", valor_rateado: Number(p.valor_total) });
    } else if (atribs && atribs.length > 0) {
      for (const a of atribs) {
        resolved.push({ ...p, resolved_cliente: a.codigo_cliente_omie, pct: a.percentual, origem: "manual", valor_rateado: Number(p.valor_total) * a.percentual / 100 });
      }
    } else if (p.projeto_nome && projMap.has(p.projeto_nome)) {
      resolved.push({ ...p, resolved_cliente: projMap.get(p.projeto_nome)!, pct: 100, origem: "projeto_map", valor_rateado: Number(p.valor_total) });
    } else {
      resolved.push({ ...p, resolved_cliente: -10, pct: 100, origem: "sentinel", valor_rateado: Number(p.valor_total) });
    }
  }

  // Filtra pelo cliente pedido
  let alvo = resolved.filter(r => r.resolved_cliente === cliente);
  // Filtro por tipo — heurística de prefixo do projeto (bate com cat_venda_projeto SQL).
  if (tipo) {
    alvo = alvo.filter(r => {
      const p = (r.projeto_nome ?? "").toUpperCase();
      let t = "Outras";
      if (p.startsWith("47_") || /CT\d+[A-Z]?_/.test(p)) t = "Contratuais";
      else if (p.startsWith("PJ") || p.startsWith("40_")) t = "Projetos";
      else if (p.startsWith("41_") || p.startsWith("AV")) t = "Avulsos";
      else if (p.startsWith("42_") || p.includes("REVENDA")) t = "Revenda";
      else if (p.startsWith("46_") || p.includes("BOT") || p.includes("SW")) t = "BOT/SW";
      return t === tipo;
    });
  }

  alvo.sort((a, b) => {
    const da = (a.aprovado_em ?? a._dt_inclusao_d ?? "");
    const db = (b.aprovado_em ?? b._dt_inclusao_d ?? "");
    return db.localeCompare(da);
  });

  const total = alvo.reduce((a, r) => a + r.valor_rateado, 0);
  return NextResponse.json({
    metric, cliente, tipo, from, to,
    linhas: alvo,
    total: Number(total.toFixed(2)),
    qtd: alvo.length,
  });
}
