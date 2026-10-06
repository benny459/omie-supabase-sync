// /api/compras/email/conversa — conversa por e-mail do pedido de compra com o fornecedor (06/10/26).
//   GET  ?id=        mensagens do pedido (enviadas e respostas) e marca as respostas como lidas
//   GET  ?naoLidos=1 {pedido_id: n} — pedidos com resposta do fornecedor por ler (selo no cartão)
//   POST {id, texto, para?, cc?, anexo?} — responde na mesma conversa (Resend, encadeado
//        por In-Reply-To/References, mesmas cópias ocultas e o "responder para" do pedido)
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro, semPermissao } from "@/lib/compras-server";
import { emailConfigurado, destinatarios, enviarResend, novoMessageId, responderPara, htmlResposta, lista } from "@/lib/compras-email";
import type { Pedido } from "@/lib/compras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MsgEmail = {
  id: number; direcao: "saida" | "entrada"; messageId: string | null; inReplyTo: string | null; de: string | null;
  para: string[]; cc: string[]; cco: string[]; assunto: string | null; texto: string | null; html: string | null;
  anexos: { nome: string; tipo?: string; tamanho?: number; caminho?: string }[]; por: string | null; status: string; lido: boolean; em: string;
};

const endereco = (s: string | null) => (/<([^>]+)>/.exec(s ?? "")?.[1] ?? s ?? "").trim();

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const u = new URL(req.url);
  try {
    if (u.searchParams.get("naoLidos")) return NextResponse.json(await rpc("compras_emails_nao_lidos"));
    const id = Number(u.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
    const msgs = await rpc<MsgEmail[]>("compras_emails", { p_pedido: id });
    if (msgs.some((m) => m.direcao === "entrada" && !m.lido)) await rpc("compras_emails_lidos", { p_pedido: id }).catch(() => null);
    return NextResponse.json({ mensagens: msgs, configurado: emailConfigurado(), soPara: lista(process.env.COMPRAS_EMAIL_SO_PARA) });
  } catch (e) { return erro(e); }
}

export async function POST(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const negado = semPermissao(q, "compras.enviar_fornecedor", "Sem permissão para escrever ao fornecedor");
  if (negado) return negado;
  if (!emailConfigurado()) return NextResponse.json({ error: "E-mail não configurado no painel (RESEND_API_KEY / COMPRAS_EMAIL_REMETENTE)." }, { status: 503 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const id = Number(b.id), texto = String(b.texto ?? "").trim();
  if (!id || !texto) return NextResponse.json({ error: "Escreva a mensagem." }, { status: 400 });
  try {
    const p = await rpc<Pedido>("compras_pedido", { p_id: id });
    const msgs = await rpc<MsgEmail[]>("compras_emails", { p_pedido: id });
    const ultima = msgs[msgs.length - 1];
    const ultimaEntrada = [...msgs].reverse().find((m) => m.direcao === "entrada");
    // Para: o que veio digitado; senão quem respondeu por último; senão os destinatários do último envio.
    let para = lista(b.para);
    if (!para.length) para = ultimaEntrada?.de ? [endereco(ultimaEntrada.de)] : (msgs.filter((m) => m.direcao === "saida").pop()?.para ?? []);
    const dest = destinatarios(para, lista(b.cc), [], q.email);
    if ("erro" in dest) return NextResponse.json({ error: dest.erro }, { status: 400 });
    if (!dest.para.length) return NextResponse.json({ error: "Sem destinatário — informe o e-mail do fornecedor." }, { status: 400 });
    const base = ultima?.assunto ?? `Pedido de Compra Nº ${p.num}`;
    const assunto = /^(re|res|resp):/i.test(base.trim()) ? base : `Re: ${base}`;
    const refs = msgs.map((m) => m.messageId).filter((x): x is string => !!x);
    const messageId = novoMessageId(p.num);
    const html = htmlResposta(texto, ultima ? { de: ultima.de, em: new Date(ultima.em).toLocaleString("pt-BR"), texto: ultima.texto } : undefined);
    const anexos: { filename: string; content: string }[] = [];
    const extra = b.anexo as { nome?: string; base64?: string } | undefined;
    if (extra?.base64 && extra.nome) {
      if (extra.base64.length > 10_000_000) throw new Error("Anexo grande demais (máx. ~7 MB)");
      anexos.push({ filename: extra.nome, content: extra.base64 });
    }
    const resendId = await enviarResend({ para: dest.para, cc: dest.cc, cco: dest.cco, assunto, html, texto,
      replyTo: responderPara(id, p.num, q.email), messageId, inReplyTo: ultima?.messageId ?? null, references: refs.slice(-10), anexos });
    await rpc("compras_email_registrar", { p: { pedido_id: id, direcao: "saida", message_id: messageId, in_reply_to: ultima?.messageId ?? null,
      de: process.env.COMPRAS_EMAIL_REMETENTE, para: dest.para, cc: dest.cc, cco: dest.cco, assunto, texto, html,
      anexos: anexos.map((a) => ({ nome: a.filename })), enviado_por: q.email, resend_id: resendId,
      status: lista(process.env.COMPRAS_EMAIL_SO_PARA).length ? "teste" : "ok" } });
    await rpc("compras_registrar", { p_id: id, p_texto: `E-mail ao fornecedor · para ${dest.para.join(", ")}`, p_por: q.email }).catch(() => null);
    return NextResponse.json({ ok: true, id: resendId });
  } catch (e) { return erro(e); }
}
