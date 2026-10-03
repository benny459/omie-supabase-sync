// Revisão de famílias — sugestões automáticas (orders.estoque_sugerir_familias). Nada é aplicado sem decisão.
// GET  → sugestões (pendentes e decididas) com o item
// POST (admin) { acao: "gerar" } → recalcula as pendentes (regras) e, para as que ficaram sem família, a IA (cache primeiro)
// POST (admin) { acao: "ia" }    → só a passada de IA nas pendentes sem família sugerida
// POST (admin) { acao: "aceita" | "rejeitada" | "alterada" | "pendente", itens: number[], familia_id? }

import { NextResponse } from "next/server";
import { exigirAdminEstoque, msgErro, orders, platform, quemEstoque, todas, todasParalelo } from "@/lib/estoque-server";
import { passadaIA } from "@/lib/estoque-familia-ia";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  try {
    const [sug, itens] = await Promise.all([
      todas((de, ate) => platform().from("estoque_familia_sugestao").select("*").eq("empresa", "SF").range(de, ate)),
      todasParalelo<Record<string, unknown>>((de, ate) => orders().from("v_estoque_item")
        .select("n_cod_prod, codigo, codigo_novo, descricao, ncm, saldo, cmc, familia_id, familia").range(de, ate)),
    ]);
    const porId = new Map(itens.map((i) => [Number(i.n_cod_prod), i]));
    const linhas = (sug as Record<string, unknown>[]).map((s) => ({ ...s, item: porId.get(Number(s.n_cod_prod)) ?? null })).filter((s) => s.item);
    return NextResponse.json({ sugestoes: linhas, admin: q.pode["estoque.codigos"] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const q = await exigirAdminEstoque("estoque.codigos");
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { acao?: string; itens?: number[]; familia_id?: number };
  const db = orders();
  if (b.acao === "ia" || b.acao === "gerar") {
    try {
      let regras: unknown = null;
      if (b.acao === "gerar") {
        const r = await db.rpc("estoque_sugerir_familias", { p_empresa: "SF" });
        if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
        regras = r.data;
      }
      const ia = await passadaIA("SF");
      return NextResponse.json({ ok: true, resultado: regras, ia });
    } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
  }
  const r = await db.rpc("estoque_decidir_sugestoes", { p_empresa: "SF", p_itens: (b.itens ?? []).map(Number), p_acao: b.acao, p_familia: b.familia_id ?? null, p_email: q.email });
  if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
  return NextResponse.json({ ok: true, resultado: r.data });
}
