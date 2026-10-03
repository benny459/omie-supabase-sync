// POST /api/estoque/ajuste/[id] (admin) { acao: "conferido" | "contestado" | "pendente" | "reverter" }
// Revisão do Benny sobre cada ajuste; só ajuste de inventário contestado pode ser revertido.

import { NextResponse } from "next/server";
import { exigirAdminEstoque, msgErro, orders } from "@/lib/estoque-server";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const q = await exigirAdminEstoque("estoque.senha_inventario");
  if (q instanceof NextResponse) return q;
  const id = Number((await params).id);
  const { acao } = (await req.json().catch(() => ({}))) as { acao?: string };
  const db = orders();
  const res = acao === "reverter"
    ? await db.rpc("estoque_reverter", { p_id: id, p_user: q.id || null, p_email: q.email })
    : ["conferido", "contestado", "pendente"].includes(acao ?? "")
      ? await db.rpc("estoque_revisar", { p_id: id, p_revisao: acao, p_user: q.id || null, p_email: q.email })
      : null;
  if (!res) return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  if (res.error) return NextResponse.json({ error: msgErro(res.error) }, { status: 409 });
  return NextResponse.json({ ajuste: res.data });
}
