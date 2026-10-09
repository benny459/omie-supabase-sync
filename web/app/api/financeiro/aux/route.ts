// GET /api/financeiro/aux?empresa=SF&tipo=pagar[&q=texto]
// Dados pros selects do modal "Nova conta": contrapartes (busca por nome/CNPJ),
// categorias do tipo certo (despesa/receita, sem totalizadoras), contas
// correntes ativas e projetos ativos.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) {
    return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  }

  const url = new URL(req.url);
  const empresa = (url.searchParams.get("empresa") ?? "SF").toUpperCase();
  const tipo = url.searchParams.get("tipo") === "receber" ? "receber" : "pagar";
  const q = (url.searchParams.get("q") ?? "").trim();

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );

  // Contrapartes: só busca com q (base tem milhares); nome fantasia OU razão OU CNPJ.
  // 09/10/26: busca no cadastro do painel (orders.cadastros_listar) — o mesmo da tela Cadastros,
  // com o espelho do Omie E os cadastrados no painel. Antes lia finance.clientes (só Omie) e o
  // fornecedor novo (ex.: GABRIEL AGUA MENESES, cód. 9000…) não aparecia na Nova conta a pagar.
  const clientesPromise = q.length >= 2
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false }, db: { schema: "orders" } })
        .rpc("cadastros_listar", { p_papel: null, p_empresa: empresa, p_q: q, p_ativos: true, p_lim: 20, p_off: 0 })
        .then(({ data, error }) => ({
          error,
          data: ((data as { linhas?: { codigo: number; fantasia: string | null; razao: string | null; doc: string | null }[] } | null)?.linhas ?? [])
            .map((l) => ({ codigo_cliente_omie: l.codigo, nome_fantasia: l.fantasia ?? l.razao, razao_social: l.razao, cnpj_cpf: l.doc })),
        }))
    : Promise.resolve({ data: [], error: null });

  const catFiltro = tipo === "pagar" ? "conta_despesa" : "conta_receita";
  const [clientes, categorias, contas, projetos] = await Promise.all([
    clientesPromise,
    admin.from("categorias")
      .select("codigo, descricao")
      .eq("empresa", empresa)
      .eq(catFiltro, "S")
      .neq("totalizadora", "S")
      .neq("conta_inativa", "S")
      .order("descricao")
      .limit(500),
    admin.from("contas_correntes")
      .select("cod_cc, descricao, tipo_conta_corrente")
      .eq("empresa", empresa)
      .neq("inativo", "S")
      .order("descricao")
      .limit(100),
    admin.from("projetos")
      .select("codigo, nome")
      .eq("empresa", empresa)
      .neq("inativo", "S")
      .order("nome")
      .limit(500),
  ]);

  const err = clientes.error ?? categorias.error ?? contas.error ?? projetos.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  return NextResponse.json({
    clientes: clientes.data ?? [],
    categorias: categorias.data ?? [],
    contas_correntes: contas.data ?? [],
    projetos: projetos.data ?? [],
  });
}
