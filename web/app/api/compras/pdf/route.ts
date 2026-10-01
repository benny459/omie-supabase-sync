// GET /api/compras/pdf?id=&variante=completo|sem_valores — PDF do pedido para
// o fornecedor ("Visualizar o arquivo" do modal de envio).
import { NextResponse } from "next/server";
import { exigirCompras, erro } from "@/lib/compras-server";
import { gerarPdfPedido, type VariantePdf } from "@/lib/compras-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  const id = Number(sp.get("id"));
  const variante: VariantePdf = sp.get("variante") === "sem_valores" ? "sem_valores" : "completo";
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  try {
    const { pdf, pedido } = await gerarPdfPedido(id, variante, q.nome);
    const nome = `pedido_de_compra_${pedido.num}${variante === "sem_valores" ? "_sem_valores" : ""}.pdf`;
    return new NextResponse(pdf, { headers: {
      "Content-Type": "application/pdf", "Cache-Control": "no-store",
      "Content-Disposition": `${sp.get("baixar") ? "attachment" : "inline"}; filename="${nome}"`,
    } });
  } catch (e) { return erro(e); }
}
