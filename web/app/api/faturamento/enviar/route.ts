// GET ?id=<emissão> | ?nfse=<NFS-e registrada>  → dados da janela de envio (para, assunto, modelo, arquivos, histórico)
// GET ?pendentes=1[&empresa=SF]                  → documentos de produção ainda NÃO ENVIADOS ao cliente
// POST {id|nfse, para, cc, cco, assunto, texto, anexo} → envia ao cliente pelo e-mail da plataforma
// POST {id|nfse, acao:"previa", …}  → ensaio (dry-run): monta o e-mail e os anexos de verdade e NÃO envia
// POST {id|nfse, acao:"prova", …}   → manda o mesmo e-mail só para quem está logado, assunto "[TESTE]" (não marca como enviado)
// POST {id|nfse, acao:"marcar", meio, para} → registra envio feito por outro caminho
import { NextResponse } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { alvoDe, dadosEnvio, enviarEmissao, marcarEnviado, pendentes, previaEnvio, provaEnvio } from "@/lib/faturamento/enviar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const p = new URL(req.url).searchParams;
  try {
    if (p.get("pendentes")) return NextResponse.json(await pendentes(p.get("empresa")));
    return NextResponse.json(await dadosEnvio(alvoDe({ id: p.get("id"), nfse: p.get("nfse") }), q.email));
  } catch (e) { return falha(e); }
}

export async function POST(req: Request) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = await req.json().catch(() => ({}));
  try {
    const alvo = alvoDe(b);
    const o = { para: b.para, cc: b.cc, cco: b.cco, assunto: b.assunto, texto: b.texto, anexo: b.anexo ?? null };
    if (b.acao === "marcar") return NextResponse.json(await marcarEnviado(alvo, q.email, String(b.meio ?? "outro"), String(b.para ?? "")));
    if (b.acao === "previa") return NextResponse.json(await previaEnvio(alvo, q.email, o));
    if (b.acao === "prova") return NextResponse.json(await provaEnvio(alvo, q.email, o));
    return NextResponse.json(await enviarEmissao(alvo, q.email, o));
  } catch (e) { return falha(e); }
}
