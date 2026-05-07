import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// Lista branca de tabelas que podem ser browseadas. Schema → tabelas permitidas.
// Adicionar aqui pra liberar acesso. Mantem auditoria explícita.
const ALLOWED: Record<string, string[]> = {
  orders: ["pedidos_compra", "nfe_entrada", "recebimento_nfe",
           "produtos_compras", "etapas_faturamento",
           "formas_pagamento_vendas", "formas_pagamento_compras",
           "familias_produtos", "produto_fornecedor", "unidades"],
  sales:  ["pedidos_venda", "itens_vendidos", "etapas_pedidos",
           "ordens_servico", "contratos_servico", "produtos", "sync_state"],
  finance:["contas_pagar", "contas_receber", "pesquisa_titulos",
           "lancamentos_cc", "extratos_cc", "clientes", "categorias",
           "projetos", "contas_correntes", "empresas", "parcelas",
           "formas_pagamento"],
  approval: ["approvals", "comments", "attachments", "audit_log"],
  platform: ["user_profiles", "approvers"],
};

function isAllowed(schema: string, table: string): boolean {
  return Boolean(ALLOWED[schema]?.includes(table));
}

export async function GET(req: Request) {
  // Auth: só admin
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supa.schema("platform" as never)
    .from("user_profiles").select("is_admin").eq("id", user.id).maybeSingle();
  const isAdmin = (me as { is_admin?: boolean } | null)?.is_admin === true;
  if (!isAdmin) return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });

  // Parse query
  const url = new URL(req.url);
  const schema = url.searchParams.get("schema") ?? "";
  const table = url.searchParams.get("table") ?? "";
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0"));
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? "50")));
  const orderBy = url.searchParams.get("order") ?? "";
  const orderDir = (url.searchParams.get("dir") ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";

  if (!schema || !table) {
    return NextResponse.json({ error: "schema e table obrigatórios" }, { status: 400 });
  }
  if (!isAllowed(schema, table)) {
    return NextResponse.json({ error: `Tabela ${schema}.${table} não está na lista permitida` }, { status: 400 });
  }

  const admin = supaAdmin();
  const offset = page * limit;

  let query = admin.schema(schema as never).from(table)
    .select("*", { count: "exact" });
  if (orderBy) query = query.order(orderBy, { ascending: orderDir === "asc" });
  query = query.range(offset, offset + limit - 1);

  const { data, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Detecta colunas a partir do 1º row (se houver)
  const columns = data && data.length > 0 ? Object.keys(data[0] as object) : [];

  return NextResponse.json({
    schema, table, page, limit, count, columns,
    rows: data ?? [],
  });
}
