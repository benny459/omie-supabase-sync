// GET /api/compras/fornecedor-cadastro?emp=SF&cod=&cnpj= — cadastro (cadastros.pessoas)
// do fornecedor do pedido: id para abrir a ficha por cima da folha e os e-mails atuais.
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const u = new URL(req.url);
  const cod = Number(u.searchParams.get("cod")) || null;
  try {
    return NextResponse.json(await rpc("compras_fornecedor_pessoa", {
      p_empresa: (u.searchParams.get("emp") ?? "SF").toUpperCase(), p_cod: cod, p_cnpj: u.searchParams.get("cnpj") || null }) ?? null);
  } catch (e) { return erro(e); }
}
