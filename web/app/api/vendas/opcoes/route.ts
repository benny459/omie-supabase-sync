// GET /api/vendas/opcoes?emp=SF            → condições, projetos e categorias de receita
// GET /api/vendas/opcoes?emp=SF&cliente=q  → clientes do cadastro próprio (P2)
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { rpc } from "@/lib/compras-server";
import { erro, exigirVendas } from "@/lib/vendas-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirVendas();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  const emp = (sp.get("emp") ?? "SF").toUpperCase();
  try {
    const termo = sp.get("cliente");
    if (termo != null) {
      const r = await rpc<{ linhas: { codigo: number; razao: string; fantasia: string | null; doc: string | null; cidade: string | null; uf: string | null }[] }>(
        "cadastros_listar", { p_papel: "cliente", p_empresa: emp, p_q: termo.trim() || null, p_ativos: true, p_lim: 20, p_off: 0 });
      return NextResponse.json({ clientes: r.linhas ?? [] });
    }
    const a = supaAdmin();
    const [cond, proj, cat] = await Promise.all([
      a.schema("sales").from("formas_pagamento").select("codigo, descricao").eq("empresa", emp).order("codigo"),
      a.schema("finance").from("projetos").select("codigo, nome").eq("empresa", emp).neq("inativo", "S").order("nome"),
      a.schema("finance").from("categorias").select("codigo, descricao").eq("empresa", emp).like("codigo", "1.%")
        .neq("conta_inativa", "S").neq("totalizadora", "S").not("descricao", "ilike", "%dispon%").order("codigo"),
    ]);
    return NextResponse.json({ condicoes: cond.data ?? [], projetos: proj.data ?? [], categorias: cat.data ?? [] });
  } catch (e) { return erro(e); }
}
