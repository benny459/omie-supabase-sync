// GET /api/financeiro/titulos?tipo=pagar|receber&modo=aberto|baixado|todos&de=YYYY-MM-DD&ate=YYYY-MM-DD
// Lê finance.v_titulos (Contas a Pagar/Receber do Omie unificadas com nomes e
// datas parseadas) e devolve { rows, resumo, breakdowns }. Área "financeiro"
// obrigatória — o dado é consolidado demais pra vazar por URL de API.
//
// modo=aberto  → todos os títulos A VENCER / VENCE HOJE / ATRASADO (sem recorte de data)
// modo=baixado → PAGO/RECEBIDO com vencimento dentro de [de, ate]
// modo=todos   → qualquer status com vencimento dentro de [de, ate]

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const ABERTO_STATUS = ["A VENCER", "VENCE HOJE", "ATRASADO"];

export type TituloRow = {
  empresa: string;
  /** ⛔ a NF deste título está na caixa "NF sem pedido" de Compras — não pagar. */
  nf_sem_pedido?: boolean;
  codigo_lancamento_omie: number;
  contraparte: string | null;
  cnpj_cpf: string | null;
  vencimento: string | null;
  previsao: string | null;
  emissao: string | null;
  valor_documento: number | string | null;
  valor_pago: number | string | null;
  status_titulo: string | null;
  numero_documento: string | null;
  numero_parcela: string | null;
  numero_documento_fiscal: string | null;
  numero_pedido: string | null;
  categoria: string | null;
  projeto: string | null;
  conta_corrente: string | null;
  observacao: string | null;
  boleto_gerado: string | null;
  boleto_numero: string | null;
  chave_nfe: string | null;
  codigo_categoria: string | null;
  codigo_projeto: number | string | null;

  // ── Campos do Omie que a fonte antiga nao trazia ────────────────────────
  contraparte_razao: string | null;
  codigo_cliente_fornecedor: number | null;
  pagamento: string | null;
  dt_registro: string | null;
  dt_cancelamento: string | null;
  /** Saldo devedor do titulo. Antes era inferido de documento menos pago. */
  val_aberto: number | string | null;
  val_liquido: number | string | null;
  juros: number | string | null;
  multa: number | string | null;
  desconto: number | string | null;
  liquidado: string | null;
  em_aberto: boolean | null;
  dias_para_vencer: number | null;
  num_boleto: string | null;
  codigo_barras: string | null;
  nsu: string | null;
  num_os: string | null;
  cod_nf: number | null;
  num_contrato: string | null;
  /** Lista de categorias quando o titulo e rateado: "2.01.01, 2.01.03". */
  categorias_rateio: string | null;
  tem_rateio: boolean | null;
  grupo_despesa: string | null;
  cod_cc: number | null;
  operacao: string | null;
  /** ADCP APIP BARP COMP CTEP DEVP IMPP MANP RPTP */
  origem: string | null;
  tipo_documento: string | null;
  cod_comprador: number | null;
  cod_vendedor: string | null;
  valor_ir: number | string | null;
  valor_pis: number | string | null;
  valor_cofins: number | string | null;
  valor_csll: number | string | null;
  valor_inss: number | string | null;
  valor_iss: number | string | null;
  info_u_inc: string | null;
  info_d_inc: string | null;
  info_u_alt: string | null;
  info_d_alt: string | null;
  cod_tit_repet: number | null;
  synced_at: string | null;
  cod_titulo: number | null;
  cod_int_titulo: string | null;
  num_titulo: string | null;
  cod_contrato: number | string | null;
  cod_os: number | string | null;
  /** Status cru do Omie (status_titulo é o calculado). */
  status: string | null;
  status_pago_d: string | null;
  info_h_inc: string | null;
  info_h_alt: string | null;
  ret_ir: string | null;
  ret_pis: string | null;
  ret_cofins: string | null;
  ret_csll: string | null;
  ret_inss: string | null;
  ret_iss: string | null;

  // ── Só em receber (finance.v_receber, desde 01/10/26) ───────────────────
  /** Id da linha em finance.receber — a fonte da verdade do receber. */
  id?: string | null;
  /** De onde a linha nasceu: 'painel' (nossa) ou 'omie' (veio do sync). */
  origem_registro?: "painel" | "omie" | null;
  /** ok · divergente · pendente · so_painel · so_omie */
  conferencia?: string | null;
  divergencias?: Record<string, { painel: unknown; omie: unknown }> | null;
  /** Ligada a um título do Omie que já não aparece no sync. */
  omie_ausente?: boolean | null;
};

/* Todos os campos do titulo. A fonte passou de finance.v_titulos (que le
   contas_pagar) para finance.v_titulos_omie (que le pesquisa_titulos): medido
   em 28/09/26, a antiga era um subconjunto estrito — faltavam-lhe 694 titulos
   em aberto, R$ 3.104.769,54, e tres anos de historico. A view nova mantem os
   nomes antigos como alias, por isso a tela nao muda de contrato. */
const COLS =
  "empresa, codigo_lancamento_omie, contraparte, contraparte_razao, cnpj_cpf, " +
  "codigo_cliente_fornecedor, vencimento, previsao, emissao, pagamento, dt_registro, " +
  "valor_documento, valor_pago, val_aberto, val_liquido, juros, multa, desconto, " +
  "status_titulo, liquidado, dt_cancelamento, em_aberto, dias_para_vencer, " +
  "numero_documento, numero_parcela, numero_documento_fiscal, numero_pedido, " +
  "num_boleto, codigo_barras, nsu, chave_nfe, num_os, cod_nf, num_contrato, " +
  "categoria, codigo_categoria, categorias_rateio, tem_rateio, grupo_despesa, " +
  "projeto, codigo_projeto, conta_corrente, cod_cc, operacao, origem, tipo_documento, " +
  "cod_comprador, cod_vendedor, observacao, boleto_gerado, boleto_numero, " +
  "valor_ir, valor_pis, valor_cofins, valor_csll, valor_inss, valor_iss, " +
  "info_u_inc, info_d_inc, info_u_alt, info_d_alt, cod_tit_repet, synced_at, " +
  // 30/09/26: o resto do que a view traz e ainda nao vinha — a tela Navy
  // oferece todos os campos no controlo Colunas. "Cód. Omie" (cod_titulo)
  // aparecia na tela antiga mas nunca era pedido, por isso vinha sempre vazio.
  "cod_titulo, cod_int_titulo, num_titulo, cod_contrato, cod_os, status, status_pago_d, " +
  "info_h_inc, info_h_alt, ret_ir, ret_pis, ret_cofins, ret_csll, ret_inss, ret_iss";

/* Receber lê finance.v_receber desde 01/10/26: as contas a receber nascem no
   painel (finance.receber) e o Omie entra conferido, sem duplicar
   (finance.conciliar_receber_omie, pg_cron 30 min). Mesmos nomes de coluna da
   v_titulos_omie, mais a conferência. Pagar continua no Omie. */
const COLS_RECEBER = COLS + ", id, origem_registro, conferencia, divergencias, omie_ausente";

function num(v: number | string | null): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type Agg = { total: number; qtd: number };
function bump(map: Map<string, Agg>, key: string, valor: number) {
  const cur = map.get(key) ?? { total: 0, qtd: 0 };
  cur.total += valor; cur.qtd += 1;
  map.set(key, cur);
}
function topN(map: Map<string, Agg>, n: number) {
  return [...map.entries()]
    .map(([nome, a]) => ({ nome, total: a.total, qtd: a.qtd }))
    .sort((a, b) => b.total - a.total)
    .slice(0, n);
}

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) {
    return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  }

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") === "receber" ? "receber" : "pagar";
  const modo = url.searchParams.get("modo") ?? "aberto";
  const de = url.searchParams.get("de");
  const ate = url.searchParams.get("ate");
  if ((modo === "baixado" || modo === "todos") && (!de || !ate)) {
    return NextResponse.json({ error: "modo baixado/todos exige de e ate (YYYY-MM-DD)" }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );

  // PAGE = 1000: cap do PostgREST — pedir mais volta 1000 silenciosamente.
  const PAGE = 1000;
  const MAX_ROWS = 30_000;
  const rows: TituloRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let q = tipo === "receber"
      ? admin.from("v_receber").select(COLS_RECEBER)
      : admin.from("v_titulos_omie").select(COLS).eq("tipo", tipo);
    if (modo === "aberto") {
      q = q.in("status_titulo", ABERTO_STATUS);
    } else {
      q = q.gte("vencimento", de!).lte("vencimento", ate!);
      if (modo === "baixado") q = q.in("status_titulo", ["PAGO", "RECEBIDO"]);
    }
    const { data, error } = await q
      .order("vencimento", { ascending: true, nullsFirst: false })
      .order(tipo === "receber" ? "id" : "codigo_lancamento_omie", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: `${tipo === "receber" ? "v_receber" : "v_titulos_omie"}: ${error.message}` }, { status: 500 });
    const batch = (data ?? []) as unknown as TituloRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  /* Pagar: previsões dos pedidos de compra do painel (finance.v_pagar_previsto,
     sql/29) entram como "Previsto (PC nnnn)" até a conta real chegar do Omie —
     aí são substituídas (não duplicam). */
  if (tipo === "pagar" && modo !== "baixado") {
    let pq = admin.from("v_pagar_previsto").select("*");
    if (modo !== "aberto") pq = pq.gte("vencimento", de!).lte("vencimento", ate!);
    const { data: prev, error: pe } = await pq.order("vencimento", { ascending: true });
    if (!pe) rows.push(...((prev ?? []) as unknown as TituloRow[]));
  }

  /* ⛔ NF sem pedido — não pagar: título a pagar cuja NF (fornecedor + número
     do documento fiscal, ou a chave) está na caixa "NF sem pedido" de Compras.
     Some sozinho quando a NF é casada com um pedido ou dispensada. */
  if (tipo === "pagar") {
    const { data: sp } = await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false }, db: { schema: "orders" } }).rpc("compras_nf_sem_pedido_resumo");
    const nfs = ((sp as { nfs?: { cnpj: string; numero: string; chave: string }[] } | null)?.nfs ?? []);
    if (nfs.length) {
      const chaves = new Set(nfs.map((n) => n.chave));
      const pares = new Set(nfs.map((n) => `${n.cnpj}|${n.numero}`));
      const dig = (v: unknown) => String(v ?? "").replace(/\D/g, "");
      for (const r of rows) {
        const num = dig(r.numero_documento_fiscal).replace(/^0+/, "");
        if ((r.chave_nfe && chaves.has(r.chave_nfe)) || (num && pares.has(`${dig(r.cnpj_cpf)}|${num}`))) r.nf_sem_pedido = true;
      }
    }
  }

  // ── Agregados (sempre sobre o conjunto devolvido) ──────────────────────
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }); // YYYY-MM-DD
  const d7 = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const d30 = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

  const resumo = {
    total: { total: 0, qtd: 0 },
    vencido: { total: 0, qtd: 0 },
    vence_hoje: { total: 0, qtd: 0 },
    vence_7d: { total: 0, qtd: 0 },
    vence_30d: { total: 0, qtd: 0 },
    baixado: { total: 0, qtd: 0 },
  };
  const porCategoria = new Map<string, Agg>();
  const porContraparte = new Map<string, Agg>();
  const porProjeto = new Map<string, Agg>();

  for (const r of rows) {
    const v = num(r.valor_documento);
    const st = r.status_titulo ?? "";
    const venc = r.vencimento ?? "";
    if (st === "CANCELADO") continue;
    resumo.total.total += v; resumo.total.qtd += 1;
    if (st === "PAGO" || st === "RECEBIDO") { resumo.baixado.total += v; resumo.baixado.qtd += 1; }
    else {
      if (st === "ATRASADO" || (venc && venc < hoje)) { resumo.vencido.total += v; resumo.vencido.qtd += 1; }
      else if (venc === hoje || st === "VENCE HOJE") { resumo.vence_hoje.total += v; resumo.vence_hoje.qtd += 1; }
      else if (venc && venc <= d7) { resumo.vence_7d.total += v; resumo.vence_7d.qtd += 1; }
      else if (venc && venc <= d30) { resumo.vence_30d.total += v; resumo.vence_30d.qtd += 1; }
    }
    bump(porCategoria, r.categoria ?? "(Sem categoria)", v);
    bump(porContraparte, r.contraparte ?? "(Sem nome)", v);
    bump(porProjeto, r.projeto ?? "(Sem projeto)", v);
  }

  return NextResponse.json({
    rows,
    count: rows.length,
    truncated: rows.length >= MAX_ROWS,
    resumo,
    breakdowns: {
      categoria: topN(porCategoria, 10),
      contraparte: topN(porContraparte, 10),
      projeto: topN(porProjeto, 10),
    },
  });
}
