// Código novo por família (prefixo + 4 dígitos). Só no painel; o código do Omie fica ao lado.
// GET  → prévia (item, família, código Omie → código novo) + se a revisão de famílias foi concluída
// POST (admin) { acao: "aplicar" }             → gera os códigos (bloqueado até concluir a revisão)
// POST (admin) { acao: "recodificar", n_cod_prod, familia_id } → novo código; o anterior vira apelido

import { NextResponse } from "next/server";
import { exigirAdminEstoque, msgErro, orders, quemEstoque } from "@/lib/estoque-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const [p, c] = await Promise.all([
    orders().rpc("estoque_codificar_previa", { p_empresa: "SF" }),
    orders().rpc("estoque_revisao_familias_concluida", { p_empresa: "SF" }),
  ]);
  if (p.error) return NextResponse.json({ error: p.error.message }, { status: 500 });
  return NextResponse.json({ previa: p.data ?? [], revisao_concluida: !!c.data, admin: q.pode["estoque.codigos"] });
}

export async function POST(req: Request) {
  const q = await exigirAdminEstoque("estoque.codigos");
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { acao?: string; n_cod_prod?: number; familia_id?: number };
  const r = b.acao === "aplicar"
    ? await orders().rpc("estoque_codificar_aplicar", { p_empresa: "SF", p_email: q.email })
    : b.acao === "recodificar"
      ? await orders().rpc("estoque_recodificar", { p_empresa: "SF", p_prod: Number(b.n_cod_prod), p_familia: Number(b.familia_id), p_email: q.email })
      : null;
  if (!r) return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
  return NextResponse.json({ ok: true, resultado: r.data });
}
