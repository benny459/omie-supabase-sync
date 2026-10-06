import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { montarDestinatarios } from "@/lib/compras-email-destinos";
export { assuntoTeste, faixaTeste } from "@/lib/compras-email-destinos";

// Conversa por e-mail do pedido de compra com o fornecedor (06/10/26).
//
// • Saída: Resend (API HTTP). Todo e-mail do PC leva cópia oculta para o
//   compras@ (COMPRAS_EMAIL_CCO_FIXO) e para quem enviou — a conversa fica
//   também no Gmail de cada um.
// • Respostas: com COMPRAS_EMAIL_RESPOSTAS=1 o "responder para" passa a ser um
//   endereço próprio do pedido no subdomínio de respostas
//   (pc-<nº>-<id>-<assinatura>@resposta.waterworks.com.br). O Resend recebe e
//   chama /api/compras/email/entrada, que liga a mensagem ao pedido. A
//   assinatura (HMAC) impede que alguém invente endereços de outros pedidos.
//   Sem a flag, o "responder para" continua a ser o e-mail de quem enviou.
// • COMPRAS_EMAIL_SO_PARA (modo teste) vale para Para, Cc e Cco: redireciona
//   tudo o que é externo para esses endereços (o assunto e o corpo dizem para
//   quem iria). Nenhum endereço externo recebe com a trava ligada.

export const lista = (v: unknown) =>
  (Array.isArray(v) ? v : String(v ?? "").split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean);
export const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const soParaLista = () => lista(process.env.COMPRAS_EMAIL_SO_PARA).map((e) => e.toLowerCase());

export const emailConfigurado = () => !!(process.env.RESEND_API_KEY && process.env.COMPRAS_EMAIL_REMETENTE);
export const respostasLigadas = () => process.env.COMPRAS_EMAIL_RESPOSTAS === "1";
export const dominioRespostas = () => (process.env.COMPRAS_EMAIL_DOMINIO_RESPOSTA || "resposta.waterworks.com.br").toLowerCase();
export const ccoFixo = () => lista(process.env.COMPRAS_EMAIL_CCO_FIXO ?? "compras@waterworks.com.br").map((e) => e.toLowerCase());
const soPara = () => lista(process.env.COMPRAS_EMAIL_SO_PARA).map((e) => e.toLowerCase());

function segredo() {
  const s = process.env.COMPRAS_EMAIL_TOKEN_SECRET || process.env.COMPRAS_RC_SECRET || process.env.CADASTROS_SYNC_SECRET;
  if (!s) throw new Error("Falta segredo para assinar o endereço de resposta (COMPRAS_EMAIL_TOKEN_SECRET)");
  return s;
}
const assinatura = (id: number) => createHmac("sha256", segredo()).update(`compras-pc:${id}`).digest("hex").slice(0, 10);

/** Endereço de resposta do pedido: pc-<nº>-<id>-<assinatura>@resposta.… */
export function enderecoResposta(id: number, numero: string) {
  const n = String(numero).replace(/[^0-9A-Za-z]/g, "") || "x";
  return `pc-${n}-${id}-${assinatura(id)}@${dominioRespostas()}`;
}

/** Id do pedido a partir de um endereço de resposta válido (assinatura conferida), ou null. */
export function pedidoDoEndereco(endereco: string): number | null {
  const m = /<?([^<>\s@]+)@([^<>\s]+?)>?$/.exec(String(endereco).trim().toLowerCase());
  if (!m || m[2] !== dominioRespostas()) return null;
  const k = /^pc-[0-9a-z]+-(\d+)-([0-9a-f]{10})$/.exec(m[1]);
  if (!k) return null;
  const id = Number(k[1]);
  const esperado = Buffer.from(assinatura(id)), veio = Buffer.from(k[2]);
  return esperado.length === veio.length && timingSafeEqual(esperado, veio) ? id : null;
}

/** "Responder para" do e-mail do PC. */
export const responderPara = (id: number, numero: string, quem: string) =>
  respostasLigadas() ? enderecoResposta(id, numero) : quem;

export const novoMessageId = (numero: string) => `<pc-${String(numero).replace(/[^0-9A-Za-z]/g, "")}-${randomUUID()}@waterworks.com.br>`;

/**
 * Monta Para/Cc/Cco finais aplicando a cópia fixa, a cópia de quem enviou e o
 * modo teste — que REDIRECIONA para a lista de teste (ver compras-email-destinos.ts).
 */
export function destinatarios(para: string[], cc: string[], cco: string[], quem: string) {
  return montarDestinatarios(para, cc, cco, quem, soPara(), ccoFixo());
}

type Anexo = { filename: string; content: string };
/** Envia pelo Resend. Devolve o id do Resend. */
export async function enviarResend(m: {
  para: string[]; cc?: string[]; cco?: string[]; assunto: string; html: string; texto?: string;
  replyTo: string | string[]; messageId: string; inReplyTo?: string | null; references?: string[]; anexos?: Anexo[];
}) {
  const headers: Record<string, string> = { "Message-ID": m.messageId };
  if (m.inReplyTo) headers["In-Reply-To"] = m.inReplyTo;
  if (m.references?.length) headers["References"] = m.references.join(" ");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.COMPRAS_EMAIL_REMETENTE, to: m.para, cc: m.cc?.length ? m.cc : undefined,
      bcc: m.cco?.length ? m.cco : undefined, reply_to: m.replyTo, subject: m.assunto, html: m.html,
      text: m.texto || undefined, headers, attachments: m.anexos?.length ? m.anexos : undefined,
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok) throw new Error(`Falha no envio: ${j.message ?? r.statusText}`);
  return j.id ?? null;
}

/** GET na API do Resend (e-mails recebidos e anexos). */
export async function resendGet<T>(caminho: string): Promise<T> {
  const r = await fetch(`https://api.resend.com${caminho}`, { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Resend ${caminho}: ${(j as { message?: string }).message ?? r.status}`);
  return j as T;
}

/**
 * Confere a assinatura do webhook (Svix, usada pelo Resend): HMAC-SHA256 de
 * "<svix-id>.<svix-timestamp>.<corpo cru>" com o segredo whsec_… (base64),
 * comparado com cada "v1,<base64>" do cabeçalho svix-signature. Tolerância de 5 min.
 */
export function webhookValido(corpo: string, h: { id: string | null; ts: string | null; sig: string | null },
  segredoWh = process.env.RESEND_WEBHOOK_SECRET, agora = Date.now()) {
  if (!segredoWh || !h.id || !h.ts || !h.sig) return false;
  const ts = Number(h.ts);
  if (!Number.isFinite(ts) || Math.abs(agora / 1000 - ts) > 300) return false;
  const chave = Buffer.from(segredoWh.replace(/^whsec_/, ""), "base64");
  const esperado = createHmac("sha256", chave).update(`${h.id}.${h.ts}.${corpo}`).digest();
  return h.sig.split(" ").some((parte) => {
    const [v, b64] = parte.split(",");
    if (v !== "v1" || !b64) return false;
    const veio = Buffer.from(b64, "base64");
    return veio.length === esperado.length && timingSafeEqual(veio, esperado);
  });
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
/** HTML simples de uma resposta digitada no painel (texto → parágrafos) + citação. */
export function htmlResposta(texto: string, citacao?: { de?: string | null; em?: string; texto?: string | null }) {
  const corpo = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1A2731;font-size:14px;line-height:1.55;white-space:pre-wrap">${esc(texto)}</div>`;
  if (!citacao?.texto) return corpo;
  return `${corpo}<br><div style="color:#6A7B86;font-size:12px">Em ${esc(citacao.em ?? "")}, ${esc(citacao.de ?? "")} escreveu:</div>
<blockquote style="margin:6px 0 0;padding-left:10px;border-left:2px solid #C9D6DD;color:#4A5B66;white-space:pre-wrap">${esc(citacao.texto.slice(0, 4000))}</blockquote>`;
}

/** Texto sem a parte citada (linhas ">" e "Em …, … escreveu:"/"On … wrote:"). */
export function semCitacao(texto: string) {
  const linhas = String(texto ?? "").split(/\r?\n/);
  const corte = linhas.findIndex((l) => /^(Em .+escreveu:|On .+wrote:|-{2,}\s*Original Message|De: .+)$/i.test(l.trim()) || /^>/.test(l));
  return (corte > 0 ? linhas.slice(0, corte) : linhas).join("\n").trim();
}
