// GET /api/erp/itens?tipo=PV|OS|PC&empresa=SF&chave=<numero_pedido|numero_os|ncod_ped>
// Itens do documento pro drawer dos módulos ERP.

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
  const tipo = String(url.searchParams.get("tipo") ?? "");
  const empresa = (url.searchParams.get("empresa") ?? "SF").toUpperCase();
  const chave = String(url.searchParams.get("chave") ?? "");
  if (!chave || !["PV", "OS", "PC"].includes(tipo)) {
    return NextResponse.json({ error: "tipo (PV|OS|PC) e chave obrigatórios" }, { status: 400 });
  }

  const mk = (schema: string) => createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema } },
  );

  if (tipo === "PV") {
    const { data, error } = await mk("sales").from("itens_vendidos")
      .select("codigo_produto, descricao, unidade, quantidade, valor_unitario, valor_total, ncm")
      .eq("empresa", empresa).eq("numero_pedido", chave)
      .order("codigo_item");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ itens: data ?? [] });
  }
  if (tipo === "OS") {
    const { data, error } = await mk("sales").from("ordens_servico")
      .select("codigo_servico, descricao_servico, quantidade, valor_unitario, valor_iss, aliq_iss")
      .eq("empresa", empresa).eq("numero_os", chave)
      .order("seq_item");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      itens: (data ?? []).map(i => ({
        codigo_produto: i.codigo_servico, descricao: i.descricao_servico, unidade: "UN",
        quantidade: i.quantidade, valor_unitario: i.valor_unitario,
        valor_total: Number(i.quantidade ?? 0) * Number(i.valor_unitario ?? 0),
      })),
    });
  }
  // PC: chave = ncod_ped
  const { data, error } = await mk("orders").from("pedidos_compra")
    .select("ncod_prod, cproduto, cdescricao, cunidade, nqtde, nval_unit, nval_tot, nqtde_rec, cncm")
    .eq("empresa", empresa).eq("ncod_ped", Number(chave))
    .order("ncod_item");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    itens: (data ?? []).map(i => ({
      codigo_produto: i.cproduto ?? i.ncod_prod, descricao: i.cdescricao, unidade: i.cunidade,
      quantidade: i.nqtde, valor_unitario: i.nval_unit, valor_total: i.nval_tot,
      qtd_recebida: i.nqtde_rec, ncm: i.cncm,
    })),
  });
}
