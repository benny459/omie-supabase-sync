import { NextResponse, type NextRequest } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { arquivos, cancelar } from "@/lib/faturamento/nfse-manual";

export const dynamic = "force-dynamic";

/** GET — links assinados (1 h) do PDF/XML da NFS-e registrada. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const { id } = await ctx.params;
  try { return NextResponse.json(await arquivos(Number(id))); } catch (e) { return falha(e); }
}

/** POST { acao: "cancelar", motivo } — só sem baixa nas parcelas. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { acao?: string; motivo?: string };
  try {
    if (body.acao !== "cancelar") return falha("ação inválida");
    return NextResponse.json({ registro: await cancelar(Number(id), String(body.motivo ?? ""), q.email) });
  } catch (e) {
    return falha(e);
  }
}
