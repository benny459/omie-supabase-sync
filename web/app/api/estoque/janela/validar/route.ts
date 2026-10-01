// POST /api/estoque/janela/validar { codigo } → janela ativa a que a senha pertence (qualquer usuário do ERP).
// A tela guarda a senha na sessão do navegador e a reenvia em cada ajuste; o servidor confere de novo.

import { NextResponse } from "next/server";
import { quemEstoque, validarCodigo } from "@/lib/estoque-server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const { codigo } = (await req.json().catch(() => ({}))) as { codigo?: string };
  const j = await validarCodigo(String(codigo ?? ""), q.id);
  if (j instanceof NextResponse) return j;
  return NextResponse.json({ janela: j });
}
