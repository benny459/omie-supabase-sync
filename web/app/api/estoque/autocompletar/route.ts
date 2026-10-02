// Autocompletar da "Nova movimentação": GET ?tipo=cliente|projeto|pvos|pc&q=texto
// cliente → finance.clientes (razão/fantasia + CNPJ); projeto → finance.projetos (+ cliente mais frequente nos PV/OS);
// pvos → PV/OS em aberto (com cliente e projeto); pc → PCs do Compras. Via orders.estoque_autocompletar.

import { NextResponse } from "next/server";
import { orders, quemEstoque } from "@/lib/estoque-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const u = new URL(req.url);
  const tipo = u.searchParams.get("tipo") ?? "";
  if (!["cliente", "projeto", "pvos", "pc"].includes(tipo)) return NextResponse.json({ error: "tipo inválido" }, { status: 400 });
  const r = await orders().rpc("estoque_autocompletar", { p_tipo: tipo, p_q: (u.searchParams.get("q") ?? "").slice(0, 80), p_empresa: "SF" });
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  return NextResponse.json({ itens: r.data ?? [] });
}
