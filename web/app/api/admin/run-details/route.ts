// Detalhes de execução por módulo/script. Lê sales.sync_state (gravado pelos
// importers Python) e retorna agrupado por "kind" (sales/orders/finance/aux).
import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type Row = {
  modulo: string;
  empresa: string | null;
  kind: "sales" | "orders" | "finance" | "aux" | "outro";
  last_sync_at: string | null;
  ultima_execucao_status: string | null;
  ultima_execucao_msg: string | null;
  rows_inserted: number | null;
  rows_updated: number | null;
  rows_before: number | null;
  total_registros: number | null;
  duracao_segundos: number | null;
  modo: string | null;
};

// Mapa do tipo "modulo" → workflow kind. Padrões mais específicos primeiro.
const KIND_RULES: Array<{ test: (m: string) => boolean; kind: Row["kind"] }> = [
  // Aux primeiro (specific names)
  { test: (m) => m.startsWith("aux_"), kind: "aux" },
  // Finance
  { test: (m) => /^(extratos_cc|contas_pagar|contas_receber|pesquisa_titulos|lancamentos_cc)/.test(m), kind: "finance" },
  // Orders (transacional do dia-a-dia)
  { test: (m) => /^(pedidos_compra|pedidos_venda|ordens_servico|contratos_servico|nfe_entrada|recebimento_nfe|itens_vendidos|etapas_pedidos|etapas_faturamento)/.test(m), kind: "orders" },
  // Sales (cadastros + auxiliares de vendas)
  { test: (m) => /^(clientes|produtos|categorias|projetos|contas_correntes|formas_pag|parcelas|empresas|familias_produtos|produto_fornecedor|unidades)/.test(m), kind: "sales" },
];

function classify(modulo: string): Row["kind"] {
  for (const r of KIND_RULES) if (r.test(modulo)) return r.kind;
  return "outro";
}

export async function GET() {
  const { error: guardErr } = await requireAdmin();
  if (guardErr) return guardErr;

  const admin = supaAdmin();
  const { data, error } = await admin
    .schema("sales" as never)
    .from("sync_state")
    .select("modulo, empresa, last_sync_at, ultima_execucao_status, ultima_execucao_msg, rows_inserted, rows_updated, rows_before, total_registros, duracao_segundos, modo")
    .order("last_sync_at", { ascending: false, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows: Row[] = (data ?? []).map((r) => ({
    ...(r as Omit<Row, "kind">),
    kind: classify((r as { modulo: string }).modulo),
  }));

  // Resumo
  const now = Date.now();
  const last24h = rows.filter((r) => r.last_sync_at && (now - new Date(r.last_sync_at).getTime()) < 24 * 3600_000);
  const summary = {
    total: rows.length,
    ok: rows.filter((r) => r.ultima_execucao_status === "SUCESSO").length,
    erro: rows.filter((r) => r.ultima_execucao_status === "ERRO").length,
    last_24h: last24h.length,
    last_24h_erro: last24h.filter((r) => r.ultima_execucao_status === "ERRO").length,
    by_kind: {
      sales:   rows.filter((r) => r.kind === "sales").length,
      orders:  rows.filter((r) => r.kind === "orders").length,
      finance: rows.filter((r) => r.kind === "finance").length,
      aux:     rows.filter((r) => r.kind === "aux").length,
      outro:   rows.filter((r) => r.kind === "outro").length,
    },
  };

  return NextResponse.json({ rows, summary });
}
