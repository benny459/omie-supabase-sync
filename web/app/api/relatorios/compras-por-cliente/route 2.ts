// GET /api/relatorios/compras-por-cliente?from=YYYY-MM-DD&to=YYYY-MM-DD
// DRE consolidada por (cliente × projeto × tipo_venda × mês):
//   Receita (faturamento)
//   (–) Compras (PCs aprovados de approval.v_compras_por_cliente)
//   (–) Despesas operacionais (combustível + pedágio + diretas + empresa de bi.v_rentabilidade_cliente)
//   (–) Custo mão de obra (bi.v_rentabilidade_cliente, técnicos com valor_hora cadastrado)
//   = Margem bruta + %
//
// Faturamento vem replicado por técnico em bi.v_rentabilidade_cliente — agrego com MAX.
// custo_mao_obra NULL de técnico = valor_hora faltando; contamos como zero mas flag alerta.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

export type Linha = {
  codigo_cliente: number | null;
  cliente_nome: string;
  codigo_projeto: string | null;
  projeto_nome: string | null;
  tipo_venda: string;
  periodo_mes: string;
  faturamento: number;
  total_compras: number;
  despesas: number;
  custo_mao_obra: number;
  n_tec_sem_mao_obra: number;
  n_tecnicos: number;
  qtd_pcs: number;
};

type RentRow = {
  codigo_cliente: number | null;
  cliente_nome: string;
  codigo_projeto: string | null;
  tipo_venda: string;
  periodo_mes: string;
  faturamento: string | number | null;
  despesas: string | number | null;         // só despesas_empresa (do snapshot)
  custo_mao_obra: string | number | null;
  technician_id: string | null;
};
// Fonte completa de custos operacionais (empresa + combustível + pedágio + mão obra)
type CustoRow = {
  omie_codigo_cliente: number | null;
  tipo_venda: string;
  periodo_mes: string;
  technician_id: string | null;
  despesas_empresa: string | number | null;       // já é a soma consolidada na v_custo_por_cliente
  custo_mao_obra: string | number | null;
};
type CompraRow = {
  codigo_cliente: number | null;
  cliente_nome: string | null;
  codigo_projeto: string | null;
  projeto_nome: string | null;
  tipo_venda: string;
  periodo_mes: string;
  total_compras: string | number | null;
  qtd_pcs: number | null;
  nome_fornecedor: string | null;
};

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to   = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to devem ser YYYY-MM-DD" }, { status: 400 });
  }

  // bi.* não é exposto ao PostgREST — proxy sales.v_bi_rentabilidade_cliente aponta pra ele.
  const admSales = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "sales" } },
  );
  // admApr removido — compras agora vêm de sales.compras_por_cliente_periodo (function)

  const PAGE = 5000;

  // 1a) bi.v_rentabilidade_cliente: faturamento (fonte da verdade pra receita)
  const rentRaw: RentRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admSales
      .from("v_bi_rentabilidade_cliente")
      .select("codigo_cliente, cliente_nome, codigo_projeto, tipo_venda, periodo_mes, faturamento, technician_id")
      .gte("periodo_mes", from)
      .lte("periodo_mes", to)
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: `sales.v_bi_rentabilidade_cliente: ${error.message}` }, { status: 500 });
    const batch = (data ?? []) as RentRow[];
    rentRaw.push(...batch);
    if (batch.length < PAGE) break;
    if (offset > 50_000) break;
  }

  // 1b) bi.v_custo_por_cliente: despesas COMPLETAS (empresa + combustível + pedágio) + mão obra
  const custoRaw: CustoRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admSales
      .from("v_bi_custo_por_cliente")
      .select("omie_codigo_cliente, tipo_venda, periodo_mes, technician_id, despesas_empresa, custo_mao_obra")
      .gte("periodo_mes", from)
      .lte("periodo_mes", to)
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: `sales.v_bi_custo_por_cliente: ${error.message}` }, { status: 500 });
    const batch = (data ?? []) as CustoRow[];
    custoRaw.push(...batch);
    if (batch.length < PAGE) break;
    if (offset > 50_000) break;
  }

  // 2) Compras via function otimizada — CHAMADA MÊS A MÊS em paralelo pra evitar
  //    statement_timeout (a function crua com filtro >1 mês estoura o limite).
  //    Cada mês individual responde <5s.
  function monthsBetween(a: string, b: string): { from: string; to: string }[] {
    const out: { from: string; to: string }[] = [];
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    let y = ay, mo = am;
    while (y < by || (y === by && mo <= bm)) {
      const first = `${y}-${String(mo).padStart(2,"0")}-01`;
      const last = new Date(y, mo, 0);
      const lastStr = `${y}-${String(mo).padStart(2,"0")}-${String(last.getDate()).padStart(2,"0")}`;
      out.push({ from: first, to: lastStr });
      mo++;
      if (mo > 12) { mo = 1; y++; }
    }
    return out;
  }
  const buckets = monthsBetween(from.slice(0,7)+"-01", to.slice(0,7)+"-01");
  const chunkResults = await Promise.all(buckets.map(b =>
    admSales.rpc("compras_por_cliente_periodo", { p_from: b.from, p_to: b.to })
  ));
  const compras: CompraRow[] = [];
  for (let i = 0; i < chunkResults.length; i++) {
    const { data, error } = chunkResults[i];
    if (error) return NextResponse.json({
      error: `sales.compras_por_cliente_periodo (mês ${buckets[i].from.slice(0,7)}): ${error.message}`,
    }, { status: 500 });
    compras.push(...((data ?? []) as CompraRow[]));
  }

  // 3) Agrega bi.v_rentabilidade_cliente por (cliente × projeto × tipo × mês)
  //    Faturamento = MAX (evita replicação por técnico). Despesas/mão obra = SUM cru.
  type Key = string;
  const keyOf = (r: { codigo_cliente: number | null; codigo_projeto: string | null; tipo_venda: string; periodo_mes: string }): Key =>
    `${r.codigo_cliente ?? "null"}|${r.codigo_projeto ?? "null"}|${r.tipo_venda}|${r.periodo_mes}`;

  const rentAgg = new Map<Key, {
    codigo_cliente: number | null; cliente_nome: string;
    codigo_projeto: string | null; tipo_venda: string; periodo_mes: string;
    faturamento: number; despesas: number; custo_mao_obra: number;
    n_tec_sem_mao_obra: number; n_tecnicos: number;
    _tecs: Set<string>;
  }>();
  for (const r of rentRaw) {
    const k = keyOf(r);
    const cur = rentAgg.get(k) ?? {
      codigo_cliente: r.codigo_cliente,
      cliente_nome: r.cliente_nome ?? "(sem nome)",
      codigo_projeto: r.codigo_projeto,
      tipo_venda: r.tipo_venda,
      periodo_mes: r.periodo_mes,
      faturamento: 0, despesas: 0, custo_mao_obra: 0,
      n_tec_sem_mao_obra: 0, n_tecnicos: 0,
      _tecs: new Set<string>(),
    };
    const fat = Number(r.faturamento) || 0;
    if (fat > cur.faturamento) cur.faturamento = fat;      // MAX (distinct)
    if (r.technician_id) cur._tecs.add(r.technician_id);
    rentAgg.set(k, cur);
  }

  // Agrega custos (empresa+combustível+pedágio+mão obra) por (cliente × tipo × mês)
  // Normaliza tipo_venda: v_custo usa "Contrato de Manutenção" — v_rentabilidade usa "Contratuais".
  const normalizeTipo = (t: string): string => {
    if (t === "Contrato de Manutenção") return "Contratuais";
    if (t === "Projeto") return "Projetos";
    if (t === "Clientes Avulsos") return "Avulsos";
    return t;
  };
  const custoAgg = new Map<string, { despesas: number; mao_obra: number; n_tec_sem_mao_obra: number }>();
  for (const c of custoRaw) {
    const k = `${c.omie_codigo_cliente ?? "null"}|${normalizeTipo(c.tipo_venda)}|${c.periodo_mes}`;
    const cur = custoAgg.get(k) ?? { despesas: 0, mao_obra: 0, n_tec_sem_mao_obra: 0 };
    cur.despesas += Number(c.despesas_empresa) || 0;
    cur.mao_obra += Number(c.custo_mao_obra) || 0;
    if (c.technician_id && c.custo_mao_obra == null) cur.n_tec_sem_mao_obra += 1;
    custoAgg.set(k, cur);
  }

  // Injeta despesas+mão obra em rent — só na PRIMEIRA linha (cliente × tipo × mês)
  // pra não duplicar quando o cliente tem múltiplos projetos no mesmo tipo/mês.
  const custoConsumido = new Set<string>();
  for (const v of rentAgg.values()) {
    v.n_tecnicos = v._tecs.size;
    const kCusto = `${v.codigo_cliente ?? "null"}|${v.tipo_venda}|${v.periodo_mes}`;
    if (custoConsumido.has(kCusto)) continue;
    const c = custoAgg.get(kCusto);
    if (c) {
      v.despesas = c.despesas;
      v.custo_mao_obra = c.mao_obra;
      v.n_tec_sem_mao_obra = c.n_tec_sem_mao_obra;
      custoConsumido.add(kCusto);
    }
  }

  // 4) Compras: só chave + valor
  const comprasMap = new Map<Key, { total_compras: number; qtd_pcs: number; projeto_nome: string | null; cliente_nome: string | null }>();
  for (const c of compras) {
    const k = keyOf(c);
    const cur = comprasMap.get(k) ?? { total_compras: 0, qtd_pcs: 0, projeto_nome: c.projeto_nome, cliente_nome: c.cliente_nome };
    cur.total_compras += Number(c.total_compras) || 0;
    cur.qtd_pcs += Number(c.qtd_pcs) || 0;
    if (!cur.projeto_nome && c.projeto_nome) cur.projeto_nome = c.projeto_nome;
    comprasMap.set(k, cur);
  }

  // 5) Merge: união de chaves rent + compras
  const allKeys = new Set<Key>([...rentAgg.keys(), ...comprasMap.keys()]);
  const linhas: Linha[] = [];
  for (const k of allKeys) {
    const r = rentAgg.get(k);
    const c = comprasMap.get(k);
    const [codCli, codProj, tipo, per] = k.split("|");
    linhas.push({
      codigo_cliente: r?.codigo_cliente ?? (codCli === "null" ? null : Number(codCli)),
      cliente_nome:   r?.cliente_nome ?? c?.cliente_nome ?? "(sem nome)",
      codigo_projeto: r?.codigo_projeto ?? (codProj === "null" ? null : codProj),
      projeto_nome:   c?.projeto_nome ?? null,
      tipo_venda:     r?.tipo_venda ?? tipo,
      periodo_mes:    r?.periodo_mes ?? per,
      faturamento:      Number((r?.faturamento ?? 0).toFixed(2)),
      total_compras:    Number((c?.total_compras ?? 0).toFixed(2)),
      despesas:         Number((r?.despesas ?? 0).toFixed(2)),
      custo_mao_obra:   Number((r?.custo_mao_obra ?? 0).toFixed(2)),
      n_tec_sem_mao_obra: r?.n_tec_sem_mao_obra ?? 0,
      n_tecnicos:       r?.n_tecnicos ?? 0,
      qtd_pcs:          c?.qtd_pcs ?? 0,
    });
  }
  linhas.sort((a, b) => (a.periodo_mes < b.periodo_mes ? 1 : -1) || (b.faturamento - a.faturamento));

  // 5.5) Top fornecedores por (tipo_venda + total valor) — do lado das compras cruas.
  const fornecedorMap = new Map<string, { tipo_venda: string; nome: string; valor: number; qtd: number }>();
  for (const c of compras) {
    const nome = (c.nome_fornecedor ?? "").trim() || "(fornecedor sem nome)";
    const key = `${c.tipo_venda}::${nome}`;
    const cur = fornecedorMap.get(key) ?? { tipo_venda: c.tipo_venda, nome, valor: 0, qtd: 0 };
    cur.valor += Number(c.total_compras) || 0;
    cur.qtd += Number(c.qtd_pcs) || 0;
    fornecedorMap.set(key, cur);
  }
  const topFornecedores = Array.from(fornecedorMap.values())
    .map(f => ({ ...f, valor: Number(f.valor.toFixed(2)) }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 40);

  // 6) Totais gerais
  let receita = 0, cCompras = 0, cDespesas = 0, cMaoObra = 0, totalSemMaoObra = 0;
  for (const l of linhas) {
    receita   += l.faturamento;
    cCompras  += l.total_compras;
    cDespesas += l.despesas;
    cMaoObra  += l.custo_mao_obra;
    totalSemMaoObra += l.n_tec_sem_mao_obra;
  }

  return NextResponse.json({
    periodo: { from, to },
    linhas,
    top_fornecedores: topFornecedores,
    totais: {
      faturamento:    Number(receita.toFixed(2)),
      total_compras:  Number(cCompras.toFixed(2)),
      despesas:       Number(cDespesas.toFixed(2)),
      custo_mao_obra: Number(cMaoObra.toFixed(2)),
      custo_total:    Number((cCompras + cDespesas + cMaoObra).toFixed(2)),
      margem_bruta:   Number((receita - cCompras - cDespesas - cMaoObra).toFixed(2)),
      linhas: linhas.length,
      n_tec_sem_mao_obra: totalSemMaoObra,
    },
  });
}
