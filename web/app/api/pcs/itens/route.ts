// GET /api/pcs/itens?empresa=SF&ncod=12584796417[,outro,…]
//
// Itens de um ou mais pedidos de compra — o terceiro nível da árvore
// Pedido → Lote → Item.
//
// Sob demanda por desenho: são 15.936 itens em 4.949 PCs. Carregá-los no load
// inicial pagaria por tudo o que ninguém vai abrir. O cliente pede ao expandir
// e guarda em cache na sessão.
//
// O campo que justifica a tela: `nqtde_rec` — recebimento parcial POR ITEM.
// Existe desde sempre no espelho do Omie e não aparece em nenhuma tela; é o
// que responde "chegou tudo?" sem abrir o Omie.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 30;

export type ItemPc = {
  empresa: string;
  ncod_ped: number;
  ncod_item: number | null;
  cproduto: string | null;
  cdescricao: string | null;
  cunidade: string | null;
  nqtde: number | null;
  nqtde_rec: number | null;
  nval_unit: number | null;
  nval_tot: number | null;
  ddt_previsao: string | null;
  ddata_recebimento: string | null;
  cnumero_nf: string | null;
};

const COLS = "empresa, ncod_ped, ncod_item, cproduto, cdescricao, cunidade, " +
             "nqtde, nqtde_rec, nval_unit, nval_tot, ddt_previsao, ddata_recebimento, cnumero_nf";

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Mesma porta das telas que mostram PC: quem vê o pedido pode ver o item.
  if (!canViewArea(perms, "operacao") && !canViewArea(perms, "compras")
      && !canViewArea(perms, "erp")) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const url = new URL(req.url);
  const empresa = (url.searchParams.get("empresa") ?? "").trim();
  const ncods = (url.searchParams.get("ncod") ?? "")
    .split(",").map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0)
    .slice(0, 60);   // um bucket aberto de cada vez; 60 cobre o maior
  if (!empresa || ncods.length === 0) {
    return NextResponse.json({ error: "empresa e ncod obrigatórios" }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "orders" } },
  );

  const { data, error } = await admin.from("pedidos_compra")
    .select(COLS)
    .eq("empresa", empresa)
    .in("ncod_ped", ncods)
    .order("ncod_ped", { ascending: true })
    .order("ncod_item", { ascending: true, nullsFirst: false })
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Agrupado por PC: é assim que a árvore consome, e poupa o cliente de o fazer.
  const porPc: Record<string, ItemPc[]> = {};
  for (const it of (data ?? []) as unknown as ItemPc[]) {
    (porPc[String(it.ncod_ped)] ??= []).push(it);
  }
  return NextResponse.json({ itens: porPc, count: (data ?? []).length });
}
