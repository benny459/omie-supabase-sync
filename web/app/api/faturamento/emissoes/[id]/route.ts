import { NextResponse, type NextRequest } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { atualizar, cancelar, urlArquivo } from "@/lib/faturamento/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function resposta(id: number) {
  const e = await atualizar(id);
  return NextResponse.json({ emissao: e, xml_url: await urlArquivo(e.xml_path), pdf_url: await urlArquivo(e.pdf_path) });
}

/** GET — consulta a Focus (se ainda processando) e devolve links assinados. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const { id } = await ctx.params;
  try { return await resposta(Number(id)); } catch (e) { return falha(e); }
}

/** POST { acao: "cancelar", justificativa } — só homologação. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.acao === "cancelar") {
      const e = await cancelar(Number(id), String(body.justificativa || ""));
      return NextResponse.json({ emissao: e });
    }
    return falha("Ação desconhecida");
  } catch (e) {
    return falha(e);
  }
}
