import "server-only";
import { rpc } from "@/lib/compras-server";

// Avisos ao time de compras (sql/51), uma vez por item:
//  • RC nova vinda do CRM (ou criada no painel) ainda por atender;
//  • PC criado no Omie depois de 01/10/2026 (a regra é PC só no painel).
// Canal: Webex (WEBEX_TOKEN, já usado no alerta de NF sem pedido) para
// COMPRAS_ALERTA_EMAILS; e-mail pelo Resend só se RESEND_API_KEY e
// COMPRAS_EMAIL_REMETENTE existirem (destinatários: COMPRAS_RC_EMAILS, ou os
// mesmos do Webex). Sem nenhum canal configurado não marca como avisado.

type Pendentes = {
  rcs: { id: number; num: string; pv?: string; cliente?: string; nItens: number; valor: number; por?: string }[];
  pcsOmie: { id: number; num: string; forn?: string; valor: number; emissao: string }[];
};

const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const lista = (s: string | undefined, padrao = "") => (s || padrao).split(",").map((x) => x.trim()).filter(Boolean);

export async function avisarCompras(): Promise<{ rcs: number; pcsOmie: number; webex: number; email: number; erros: string[] }> {
  const p = await rpc<Pendentes>("compras_avisos_pendentes");
  const erros: string[] = [];
  if (!p.rcs.length && !p.pcsOmie.length) return { rcs: 0, pcsOmie: 0, webex: 0, email: 0, erros };

  const partes: string[] = [];
  if (p.rcs.length) {
    partes.push(`**🛒 ${p.rcs.length} requisição(ões) de compra nova(s) para atender**\n\n` +
      p.rcs.map((r) => `- RC ${r.num}${r.pv ? ` · ${r.pv}` : ""}${r.cliente ? ` · ${r.cliente}` : ""} · ${r.nItens} item(ns) · ${brl(r.valor)}${r.por ? ` · ${r.por}` : ""}`).join("\n"));
  }
  if (p.pcsOmie.length) {
    partes.push(`**⚠️ ${p.pcsOmie.length} pedido(s) de compra criado(s) no Omie depois de 01/10 — o pedido nasce no painel**\n\n` +
      p.pcsOmie.map((c) => `- PC ${c.num} · ${c.forn ?? "—"} · ${brl(c.valor)} · ${String(c.emissao).slice(0, 10).split("-").reverse().join("/")}`).join("\n"));
  }
  const md = partes.join("\n\n") + "\n\nAbrir: https://painel.waterworks.com.br/erp/compras";

  let webex = 0, email = 0;
  const paraWebex = lista(process.env.COMPRAS_ALERTA_EMAILS, "benny@waterworks.com.br");
  if (process.env.WEBEX_TOKEN) {
    for (const e of paraWebex) {
      const r = await fetch("https://webexapis.com/v1/messages", { method: "POST",
        headers: { Authorization: `Bearer ${process.env.WEBEX_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ toPersonEmail: e, markdown: md }) }).catch((x) => ({ ok: false, status: String(x) }) as { ok: boolean; status: string | number });
      if (r.ok) webex++; else erros.push(`webex ${e}: ${r.status}`);
    }
  }
  if (process.env.RESEND_API_KEY && process.env.COMPRAS_EMAIL_REMETENTE) {
    const para = lista(process.env.COMPRAS_RC_EMAILS).length ? lista(process.env.COMPRAS_RC_EMAILS) : paraWebex;
    const html = md.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").split("\n").map((l) => l.startsWith("- ") ? `<li>${l.slice(2)}</li>` : `<p>${l}</p>`).join("");
    const r = await fetch("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.COMPRAS_EMAIL_REMETENTE, to: para,
        subject: p.rcs.length ? `Compras: ${p.rcs.length} requisição(ões) nova(s)` : "Compras: pedido criado no Omie", html }) })
      .catch((x) => ({ ok: false, status: String(x) }) as { ok: boolean; status: string | number });
    if (r.ok) email++; else erros.push(`email: ${r.status}`);
  }
  if (webex || email) {
    await rpc("compras_avisos_marcar", { p_rcs: p.rcs.map((r) => r.id), p_pcs: p.pcsOmie.map((c) => c.id) });
  }
  return { rcs: p.rcs.length, pcsOmie: p.pcsOmie.length, webex, email, erros };
}
