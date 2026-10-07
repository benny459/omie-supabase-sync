// GET /api/rc-projetos/lista-sem-pc?empresa=&codigo=  (07/10/26, Benny)
// As linhas da Lista de materiais do projeto que ainda não têm PC — para o "Puxar itens da
// Lista de materiais" da folha do pedido de compra (Compras). Linha ligada a outro PC
// (pc_item_id) ou com nº de PC digitado fica de fora.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const empresa = (u.searchParams.get("empresa") || "SF").toUpperCase();
  const codigo = Number(u.searchParams.get("codigo"));
  if (!Number.isFinite(codigo) || codigo <= 0) return NextResponse.json({ error: "codigo obrigatório" }, { status: 400 });
  const { data, error } = await supaAdmin().schema("approval").from("rc_projetos_itens")
    .select("id, equipamento, item, modelo, qtd, un, cat_codigo, cat_ncod_prod, cat_valor_unit, cat_fornecedor, data_necessaria, rc_item_id, pc_item_id, pc_numero, observacao")
    .eq("empresa", empresa).eq("codigo_projeto", codigo).is("pc_item_id", null)
    .order("equipamento").order("item").limit(3000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const linhas = ((data ?? []) as Record<string, unknown>[])
    .filter((r) => !String(r.pc_numero ?? "").trim() && String(r.item ?? "").trim())
    .map((r) => ({
      id: String(r.id), equipamento: (r.equipamento as string) || "Geral", item: String(r.item), modelo: (r.modelo as string | null) ?? null,
      qtd: Number(r.qtd) || 0, un: (r.un as string | null) || "UN", codigo: (r.cat_codigo as string | null) ?? null,
      ncod_prod: r.cat_ncod_prod != null ? Number(r.cat_ncod_prod) : null, valor_unit: r.cat_valor_unit != null ? Number(r.cat_valor_unit) : null,
      fornecedor: (r.cat_fornecedor as string | null) ?? null, necessario: (r.data_necessaria as string | null) ?? null,
      rc_item_id: r.rc_item_id != null ? Number(r.rc_item_id) : null,
    }));
  return NextResponse.json({ linhas });
}
