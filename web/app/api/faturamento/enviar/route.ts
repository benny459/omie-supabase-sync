// GET ?id=  → para quem iria (e-mails do cliente da emissão)
// POST {id, para?: string[]} → envia a nota/recibo autorizado ao cliente (lib/faturamento/enviar)
import { NextResponse } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { destinosDaEmissao, enviarEmissao } from "@/lib/faturamento/enviar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  try {
    const { emissao, emails } = await destinosDaEmissao(Number(new URL(req.url).searchParams.get("id")));
    const e = emissao as unknown as { enviado_em?: string | null; enviado_para?: string[] | null };
    return NextResponse.json({ emails, enviado_em: e.enviado_em ?? null, enviado_para: e.enviado_para ?? null });
  } catch (e) { return falha(e); }
}

export async function POST(req: Request) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = await req.json().catch(() => ({}));
  try {
    const para = Array.isArray(b.para) ? b.para.map(String) : typeof b.para === "string" ? b.para.split(/[,;\s]+/).filter(Boolean) : undefined;
    return NextResponse.json(await enviarEmissao(Number(b.id), q.email, para));
  } catch (e) { return falha(e); }
}
