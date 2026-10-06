// POST /api/compras/email/entrada — webhook "email.received" do Resend (06/10/26).
// Resposta do fornecedor a um pedido de compra: o endereço de destino
// (pc-<nº>-<id>-<assinatura>@resposta.waterworks.com.br) diz de que pedido é.
// Rota pública no middleware; a guarda é a assinatura Svix (RESEND_WEBHOOK_SECRET).
//  1. confere a assinatura;
//  2. busca corpo e anexos no Resend (o webhook só traz metadados);
//  3. guarda em compras.emails e os anexos no bucket compras-emails;
//  4. avisa quem enviou o pedido (Webex) e manda-lhe a cópia por e-mail, para a
//     conversa ficar também no Gmail dele.
// Mensagens vindas de @waterworks.com.br (alguém respondeu pelo Gmail com o
// endereço do pedido em cópia) ficam na conversa como enviadas, sem aviso.
import { NextResponse } from "next/server";
import { rpc } from "@/lib/compras-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { webhookValido, pedidoDoEndereco, resendGet, destinatarios, enviarResend, novoMessageId, enderecoResposta, semCitacao, lista } from "@/lib/compras-email";
import type { Pedido } from "@/lib/compras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Recebido = {
  id: string; from: string; to: string[]; cc?: string[]; bcc?: string[]; received_for?: string[]; subject?: string;
  html?: string | null; text?: string | null; message_id?: string; headers?: Record<string, string>;
  attachments?: { id: string; filename: string; content_type?: string; size?: number }[];
};
const endereco = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim();
const INTERNO = /@waterworks\.com\.br$/i;
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export async function POST(req: Request) {
  const corpo = await req.text();
  const h = req.headers;
  if (!webhookValido(corpo, { id: h.get("svix-id"), ts: h.get("svix-timestamp"), sig: h.get("svix-signature") })) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }
  let ev: { type?: string; data?: { email_id?: string; to?: string[]; cc?: string[]; received_for?: string[] } };
  try { ev = JSON.parse(corpo); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (ev.type !== "email.received" || !ev.data?.email_id) return NextResponse.json({ ok: true, ignorado: ev.type ?? "?" });

  const alvos = [...(ev.data.to ?? []), ...(ev.data.cc ?? []), ...(ev.data.received_for ?? [])];
  const pedidoId = alvos.map(pedidoDoEndereco).find((x): x is number => x != null) ?? null;
  if (!pedidoId) return NextResponse.json({ ok: true, ignorado: "endereço sem pedido" });

  try {
    const m = await resendGet<Recebido>(`/emails/receiving/${ev.data.email_id}`);
    const de = m.from ?? "";
    const interno = INTERNO.test(endereco(de));
    // Anexos: baixa pelo link temporário do Resend e guarda no bucket privado.
    const anexos: { nome: string; tipo?: string; tamanho?: number; caminho?: string }[] = [];
    for (const a of m.attachments ?? []) {
      try {
        if ((a.size ?? 0) > 15_000_000) { anexos.push({ nome: a.filename, tipo: a.content_type, tamanho: a.size }); continue; }
        const info = await resendGet<{ download_url: string }>(`/emails/receiving/${m.id}/attachments/${a.id}`);
        const r = await fetch(info.download_url);
        if (!r.ok) throw new Error(String(r.status));
        const nome = a.filename.replace(/[/\\]/g, "_").slice(0, 120) || "anexo";
        const caminho = `pc/${pedidoId}/${m.id}/${nome}`;
        const { error } = await supaAdmin().storage.from("compras-emails")
          .upload(caminho, new Uint8Array(await r.arrayBuffer()), { upsert: true, contentType: a.content_type || "application/octet-stream" });
        anexos.push({ nome, tipo: a.content_type, tamanho: a.size, ...(error ? {} : { caminho }) });
      } catch { anexos.push({ nome: a.filename, tipo: a.content_type, tamanho: a.size }); }
    }
    const inReplyTo = m.headers?.["in-reply-to"] ?? m.headers?.["In-Reply-To"] ?? null;
    const novo = await rpc<number | null>("compras_email_registrar", { p: {
      pedido_id: pedidoId, direcao: interno ? "saida" : "entrada", message_id: m.message_id ?? null, in_reply_to: inReplyTo,
      de, para: m.to ?? [], cc: m.cc ?? [], assunto: m.subject ?? null, texto: m.text ?? null, html: m.html ?? null,
      anexos, enviado_por: interno ? endereco(de) : null, resend_id: m.id, status: interno ? "gmail" : "ok" } });
    if (novo == null) return NextResponse.json({ ok: true, repetido: true }); // webhook reenviado
    if (interno) return NextResponse.json({ ok: true, pedido: pedidoId, interno: true });

    // Avisar quem enviou o pedido + cópia no Gmail dele.
    const p = await rpc<Pedido>("compras_pedido", { p_id: pedidoId });
    const ult = await rpc<{ enviado_por?: string } | null>("compras_email_ultimo_envio", { p_pedido: pedidoId }).catch(() => null);
    const quem = ult?.enviado_por && /@/.test(ult.enviado_por) ? ult.enviado_por : (p.enviadoPor && /@/.test(p.enviadoPor) ? p.enviadoPor : null);
    const avisar = lista(quem ?? process.env.COMPRAS_ALERTA_EMAILS ?? "benny@waterworks.com.br");
    const link = `https://painel.waterworks.com.br/erp/compras?abrir=${encodeURIComponent(p.num)}&tipo=PC&emp=${p.emp}`;
    const resumo = semCitacao(m.text ?? "").slice(0, 600);
    if (process.env.WEBEX_TOKEN) {
      for (const e of avisar) {
        await fetch("https://webexapis.com/v1/messages", { method: "POST",
          headers: { Authorization: `Bearer ${process.env.WEBEX_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ toPersonEmail: e, markdown: `**✉️ ${p.forn || "Fornecedor"} respondeu o PC ${p.num}**\n\n${resumo || "(sem texto)"}${anexos.length ? `\n\n📎 ${anexos.map((a) => a.nome).join(", ")}` : ""}\n\nAbrir: ${link}` }) }).catch(() => null);
      }
    }
    const dest = destinatarios(avisar, [], [], "");
    if (!("erro" in dest) && dest.para.length) {
      // Encaminha a resposta para o Gmail de quem enviou; responder dali vai ao fornecedor com o pedido em cópia.
      const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;color:#4A5B66;margin-bottom:10px">
        Resposta de <b>${esc(de)}</b> ao <a href="${link}">PC ${esc(p.num)}</a> — fica também na aba E-mails do pedido.</div>${m.html ?? `<pre style="white-space:pre-wrap">${esc(m.text ?? "")}</pre>`}`;
      await enviarResend({ para: dest.para, cco: dest.cco.filter((e) => !dest.para.includes(e)), assunto: m.subject ?? `Resposta ao PC ${p.num}`, html,
        replyTo: [endereco(de), enderecoResposta(pedidoId, p.num)], messageId: novoMessageId(p.num), inReplyTo: m.message_id ?? null }).catch(() => null);
    }
    await rpc("compras_registrar", { p_id: pedidoId, p_texto: `Resposta do fornecedor por e-mail (${endereco(de)})`, p_por: "e-mail" }).catch(() => null);
    return NextResponse.json({ ok: true, pedido: pedidoId });
  } catch (e) {
    // 500 faz o Resend tentar de novo mais tarde.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
