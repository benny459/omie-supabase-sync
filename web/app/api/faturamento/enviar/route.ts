// GET ?id=  → dados da janela de envio (para, assunto, arquivos, situação)
// POST {id, para, cc, cco, assunto, texto, anexo} → envia a nota/recibo ao cliente pelo e-mail da plataforma
// POST {id, acao:"marcar", meio, para} → registra envio feito por outro caminho
import { NextResponse } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { dadosEnvio, enviarEmissao, marcarEnviado } from "@/lib/faturamento/enviar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  try { return NextResponse.json(await dadosEnvio(Number(new URL(req.url).searchParams.get("id")), q.email)); }
  catch (e) { return falha(e); }
}

export async function POST(req: Request) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = await req.json().catch(() => ({}));
  try {
    if (b.acao === "marcar") return NextResponse.json(await marcarEnviado(Number(b.id), q.email, String(b.meio ?? "outro"), String(b.para ?? "")));
    return NextResponse.json(await enviarEmissao(Number(b.id), q.email, {
      para: b.para, cc: b.cc, cco: b.cco, assunto: b.assunto, texto: b.texto, anexo: b.anexo ?? null,
    }));
  } catch (e) { return falha(e); }
}
