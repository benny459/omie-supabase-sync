// Recibo em PDF, baixado direto (05/10/26): GET ?p=<caminho do .html no Storage>.
// Mesmo layout da 2ª via em HTML; nome do arquivo = título do recibo
// ("Recibo de Prestação de Serviço nº 0000004646.pdf").
import { NextResponse } from "next/server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { caminhoValido, disposicao, documentoGuardado, nomePdf, pdfComCache } from "@/lib/faturamento/recibo-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  const p = new URL(req.url).searchParams.get("p") ?? "";
  if (!caminhoValido(p)) return NextResponse.json({ error: "arquivo inválido" }, { status: 400 });
  const html = await documentoGuardado(p);
  if (!html) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  try {
    const pdf = await pdfComCache(html, p);
    return new NextResponse(pdf as BodyInit, { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": disposicao(nomePdf(html)), "Cache-Control": "private, no-store",
    } });
  } catch (e) {
    return NextResponse.json({ error: `Não gerou o PDF: ${(e as Error).message}` }, { status: 500 });
  }
}
