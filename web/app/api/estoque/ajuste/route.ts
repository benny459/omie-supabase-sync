// POST /api/estoque/ajuste { codigo, empresa, n_cod_prod, local, contagem, motivo, obs? }
// Ajuste de inventário SÓ no painel (nunca vai ao Omie). Exige a senha de uma janela ativa:
// a rota confere a senha e orders.estoque_ajustar confere de novo, na transação, se a janela
// não foi revogada/expirou e se o item/local está no escopo.

import { NextResponse } from "next/server";
import { msgErro, orders, quemEstoque, validarCodigo } from "@/lib/estoque-server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  if (!q.pode["estoque.ajustar"]) return NextResponse.json({ error: "Sem permissão para ajustar saldo" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as {
    codigo?: string; empresa?: string; n_cod_prod?: number; local?: string | number; contagem?: number; motivo?: string; obs?: string;
  };
  const j = await validarCodigo(String(b.codigo ?? ""), q.id);
  if (j instanceof NextResponse) return j;
  const contagem = Number(b.contagem);
  if (!b.empresa || !b.n_cod_prod || b.local == null || !Number.isFinite(contagem))
    return NextResponse.json({ error: "Dados do ajuste incompletos" }, { status: 400 });
  const { data, error } = await orders().rpc("estoque_ajustar", {
    p_janela: j.id, p_empresa: b.empresa, p_prod: Number(b.n_cod_prod), p_local: Number(b.local), p_contagem: contagem,
    p_motivo: String(b.motivo ?? ""), p_obs: b.obs ?? null, p_user: q.id || null, p_email: q.email,
  });
  if (error) return NextResponse.json({ error: msgErro(error) }, { status: 409 });
  return NextResponse.json({ ajuste: data, janela: j });
}
