import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import RawTableBrowser from "./RawTableBrowser";

export const dynamic = "force-dynamic";

const ALLOWED: { schema: string; tables: string[] }[] = [
  { schema: "orders", tables: ["pedidos_compra", "nfe_entrada", "recebimento_nfe",
      "produtos_compras", "etapas_faturamento", "formas_pagamento_vendas",
      "formas_pagamento_compras", "familias_produtos", "produto_fornecedor", "unidades"] },
  { schema: "sales", tables: ["pedidos_venda", "itens_vendidos", "etapas_pedidos",
      "ordens_servico", "contratos_servico", "produtos", "sync_state"] },
  { schema: "finance", tables: ["contas_pagar", "contas_receber", "pesquisa_titulos",
      "lancamentos_cc", "extratos_cc", "clientes", "categorias", "projetos",
      "contas_correntes", "empresas", "parcelas", "formas_pagamento"] },
  { schema: "approval", tables: ["approvals", "comments", "attachments", "audit_log"] },
  { schema: "platform", tables: ["user_profiles", "approvers"] },
];

export default async function TabelasPage({
  searchParams,
}: {
  searchParams: Promise<{ schema?: string; table?: string; page?: string; order?: string; dir?: string }>;
}) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  const { data: me } = await supa.schema("platform" as never)
    .from("user_profiles").select("is_admin").eq("id", user?.id ?? "").maybeSingle();
  const isAdmin = (me as { is_admin?: boolean } | null)?.is_admin === true;

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto mt-16 bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900 mb-1">Acesso restrito</h1>
        <p className="text-sm text-slate-500">Apenas administradores podem acessar tabelas raw.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const selectedSchema = sp.schema ?? "";
  const selectedTable = sp.table ?? "";
  const page = Math.max(0, Number(sp.page ?? "0"));
  const limit = 50;
  const orderBy = sp.order ?? "";
  const orderDir = (sp.dir ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";

  // Se selecionou tabela: busca dados via service role (bypass RLS)
  let result: {
    rows: Record<string, unknown>[];
    columns: string[];
    count: number | null;
    error?: string;
  } | null = null;

  if (selectedSchema && selectedTable) {
    const allowed = ALLOWED.find(g => g.schema === selectedSchema)?.tables.includes(selectedTable);
    if (!allowed) {
      result = { rows: [], columns: [], count: null, error: `${selectedSchema}.${selectedTable} não permitida` };
    } else {
      const admin = supaAdmin();
      const offset = page * limit;
      let query = admin.schema(selectedSchema as never).from(selectedTable)
        .select("*", { count: "exact" });
      if (orderBy) query = query.order(orderBy, { ascending: orderDir === "asc" });
      query = query.range(offset, offset + limit - 1);
      const { data, count, error } = await query;
      if (error) {
        result = { rows: [], columns: [], count: null, error: error.message };
      } else {
        const rows = (data ?? []) as Record<string, unknown>[];
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        result = { rows, columns, count: count ?? null };
      }
    }
  }

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight">
          Tabelas do banco
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Browse raw em todas as tabelas sincronizadas. Apenas leitura (admin only).
        </p>
      </div>

      <RawTableBrowser
        groups={ALLOWED}
        selectedSchema={selectedSchema}
        selectedTable={selectedTable}
        page={page}
        limit={limit}
        orderBy={orderBy}
        orderDir={orderDir}
        result={result}
      />
    </div>
  );
}
