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
    let q = svc.from("faturamento_unificado")
      .select("empresa, codigo_cliente, cliente_nome, codigo_projeto, projeto_nome, codigo_categoria, dt_fat_d, valor_total, numero_nfse, numero_pedido, numero_contrato")
      .eq("codigo_cliente", String(cliente))
      .gte("dt_fat_d", from).lte("dt_fat_d", to)
      .order("dt_fat_d", { ascending: false })
      .limit(1000);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Filtro por tipo se pedido (via cat_venda no cliente — cat_venda é RPC-friendly?)
    // Simplifica: retorna tudo e front pode filtrar; ou aplica cat_venda via RPC
    let rows = data ?? [];
    if (tipo) {
      // Filtro server-side por tipo — usa cat_venda(codigo_categoria)
      const svcRpc = admin("public");
      const { data: tipoData } = await svcRpc.rpc("cat_venda_batch" as never, {
        codigos: [...new Set(rows.map((r: { codigo_categoria: unknown }) => r.codigo_categoria).filter(Boolean))],
      } as never).select("*") as unknown as { data: { codigo_categoria: string; tipo: string }[] | null };
      if (tipoData) {
        const tipoMap = new Map(tipoData.map((t) => [t.codigo_categoria, t.tipo]));
        rows = rows.filter((r: { codigo_categoria: unknown }) => tipoMap.get(String(r.codigo_categoria)) === tipo);
      }
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

  // Puxa PCs aprovados no range (por aprovado_em com fallback pra _dt_inclusao_d)
  // — mesma lógica da view v_compras_por_cliente.
  const PAGE = 1000;
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
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await svcAppr.from(view)
        .select("empresa, pc_numero, nome_fornecedor, contato_fornecedor, projeto_nome, codigo_projeto, valor_total, aprovado_em, _dt_inclusao_d, pv_cliente_codigo, pv_cliente_nome, status")
        .eq("status", "APROVADO")
        .range(off, off + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      const batch = (data ?? []) as Omit<Pc, "__fonte">[];
      for (const b of batch) allPcs.push({ ...b, __fonte: view === "v_pc_avulsos" ? "avulsos" : "pcs" });
      if (batch.length < PAGE) break;
      if (off > 20_000) break;
    }
  }
  // Dedup: mesmo pc pode aparecer em v_pc_avulsos E v_pc_pcs. Prefere avulsos (canônica).
  const seen = new Set<string>();
  const dedupd: Pc[] = [];
  for (const p of allPcs) {
    const k = `${p.empresa}|${p.pc_numero}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedupd.push(p);
  }
  // Filtra por range aplicando data efetiva (aprovado_em ?? _dt_inclusao_d)
  const inRange = dedupd.filter((p) => {
    const d = (p.aprovado_em ? p.aprovado_em.slice(0, 10) : p._dt_inclusao_d) ?? "";
    return d >= from && d <= to;
  });

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
  // Filtra por tipo se pedido
  if (tipo) {
    const svcPub = admin("public");
    const { data: catData } = await svcPub.from("cat_venda")
      .select("*")
      .limit(2000);
    type CatRow = { codigo_categoria: string; nome?: string; tipo?: string };
    const catMap = new Map<string, string>();
    for (const c of (catData ?? []) as CatRow[]) {
      const t = c.tipo ?? c.nome ?? "Outras";
      catMap.set(String(c.codigo_categoria), t);
    }
    // cat_venda_projeto pra projeto_nome — heurística inline pra bater com view
    // Simplificado: usa projeto_nome pra derivar tipo pelo prefixo comum.
    alvo = alvo.filter(r => {
      const proj = r.projeto_nome ?? "";
      const p = proj.toUpperCase();
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
