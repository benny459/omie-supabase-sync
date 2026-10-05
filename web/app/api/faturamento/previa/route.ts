import { NextResponse, type NextRequest } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { docDaChave, previaHtml, resumoEmissao } from "@/lib/faturamento/danfe-previa";
import type { DocFat } from "@/lib/faturamento/montar";

export const dynamic = "force-dynamic";

/* Prévia antes de emitir (05/10/26) — NÃO chama a Focus/SEFAZ nem reserva número.
   GET  ?chave=pv_omie:<cod>|os_omie:<cod>|venda:<id>[&empresa=SF][&tipo=nfe|recibo] → HTML do DANFE/recibo (nova aba)
   POST { acao: "html", documento, tipo }       → HTML a partir da folha (dados editados)
   POST { acao: "resumo", chave | documento }   → resumo para a gaveta (destinatário, parcelas,
                                                  transporte, CFOP/NCM, inf. complementares, pendências) */

const html = (h: string) => new NextResponse(h, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const sp = req.nextUrl.searchParams;
  try {
    const empresa = sp.get("empresa") || "SF";
    const { doc, tipo } = await docDaChave(String(sp.get("chave") ?? ""), empresa);
    const t = (sp.get("tipo") as "nfe" | "recibo" | null) ?? tipo;
    return html(await previaHtml(doc, t));
  } catch (e) {
    return html(`<!doctype html><meta charset="utf-8"><body style="font:14px Arial;padding:24px">Não foi possível gerar a prévia: ${String(e instanceof Error ? e.message : e).replace(/</g, "&lt;")}</body>`);
  }
}

export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { acao?: string; chave?: string; empresa?: string; documento?: DocFat | null; tipo?: "nfe" | "recibo" };
  try {
    const empresa = b.empresa || b.documento?.empresa || "SF";
    if (b.acao === "html") {
      if (!b.documento) return falha("documento obrigatório");
      return html(await previaHtml({ ...b.documento, empresa }, b.tipo ?? "nfe"));
    }
    if (b.acao === "resumo") {
      if (b.documento) return NextResponse.json(await resumoEmissao({ ...b.documento, empresa }, {}, b.tipo ?? "nfe"));
      const { doc, tipo, extra } = await docDaChave(String(b.chave ?? ""), empresa);
      return NextResponse.json({ tipo, documento: doc, ...(await resumoEmissao(doc, extra, tipo)) });
    }
    return falha("ação inválida");
  } catch (e) {
    return falha(e);
  }
}
