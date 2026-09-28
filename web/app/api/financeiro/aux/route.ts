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
  const clientesPromise = q.length >= 2
    ? admin.from("clientes")
        .select("codigo_cliente_omie, nome_fantasia, razao_social, cnpj_cpf")
        .eq("empresa", empresa)
        .neq("inativo", "S")
        .or(`nome_fantasia.ilike.%${q}%,razao_social.ilike.%${q}%,cnpj_cpf.ilike.%${q}%`)
        .order("nome_fantasia")
        .limit(20)
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
