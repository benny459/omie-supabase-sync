// /api/cron/fat-nao-enviados — lembrete diário (dias úteis, 08:00 de Brasília = 11:00 UTC, vercel.json)
// dos documentos emitidos no painel e NÃO ENVIADOS ao cliente há mais de 1 dia (09/10/26).
// Cada pessoa que emitiu recebe no Webex (mensagem direta) a lista dos seus; FAT_LEMBRETE_EMAILS
// (opcional, vírgula) recebe a lista inteira. Sem quem emitiu → benny@.
// Liga/desliga: FAT_LEMBRETE_NAO_ENVIADO (padrão LIGADO; "0" desliga).
// Só documentos autorizados a partir de FAT_LEMBRETE_DESDE (padrão 2026-10-09, quando o envio
// pelo painel começou) — os anteriores continuam com a pill "✉ não enviado" na carteira.
// Manual: /api/cron/fat-nao-enviados?secret=<CRON_SECRET>[&simular=1] — simular não envia, devolve as mensagens.
import { NextRequest, NextResponse } from "next/server";
import { pendentes, type Pendente } from "@/lib/faturamento/enviar";
import { brl, dataBR } from "@/lib/faturamento/envio-modelo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function autorizado(req: NextRequest) {
  const s = process.env.CRON_SECRET;
  if (!s) return false;
  if ((req.headers.get("authorization") ?? "") === `Bearer ${s}`) return true;
  return new URL(req.url).searchParams.get("secret") === s;
}
const lista = (v?: string) => (v ?? "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
const linha = (p: Pendente) => `- ${p.doc} ${p.numero}${p.origem ? ` · ${p.origem}` : ""} · ${p.cliente || "—"} · ${brl(p.valor)} · emitido ${p.autorizada_em ? dataBR(p.autorizada_em.slice(0, 10)) : "—"}`;
const msg = (ps: Pendente[]) => `**✉ ${ps.length} documento(s) emitido(s) e ainda NÃO ENVIADO(S) ao cliente**\n\n${ps.slice(0, 40).map(linha).join("\n")}${ps.length > 40 ? `\n- … e mais ${ps.length - 40}` : ""}\n\nAbra o documento no Faturamento › “✉ Enviar ao cliente” (ou “Marcar como enviado”, se foi por outro caminho): https://painel.waterworks.com.br/faturamento`;

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const simular = new URL(req.url).searchParams.get("simular") === "1";
  if (process.env.FAT_LEMBRETE_NAO_ENVIADO === "0" && !simular) return NextResponse.json({ ok: true, desligado: true });
  const desde = process.env.FAT_LEMBRETE_DESDE || "2026-10-09";
  const limite = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { docs } = await pendentes(null);
  const velhos = docs.filter((p) => p.autorizada_em && p.autorizada_em >= desde && p.autorizada_em <= limite);
  const porQuem = new Map<string, Pendente[]>();
  for (const p of velhos) {
    const k = (p.criado_por && p.criado_por.includes("@") ? p.criado_por : "benny@waterworks.com.br").toLowerCase();
    porQuem.set(k, [...(porQuem.get(k) ?? []), p]);
  }
  const mensagens: { para: string; n: number; markdown: string }[] = [...porQuem].map(([para, ps]) => ({ para, n: ps.length, markdown: msg(ps) }));
  if (velhos.length) for (const e of lista(process.env.FAT_LEMBRETE_EMAILS)) {
    if (!porQuem.has(e)) mensagens.push({ para: e, n: velhos.length, markdown: msg(velhos) });
  }
  if (simular) return NextResponse.json({ ok: true, simular: true, desde, total: velhos.length, mensagens });
  const erros: string[] = [];
  let enviados = 0;
  if (!process.env.WEBEX_TOKEN) erros.push("WEBEX_TOKEN não configurado");
  else for (const m of mensagens) {
    const r = await fetch("https://webexapis.com/v1/messages", { method: "POST",
      headers: { Authorization: `Bearer ${process.env.WEBEX_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ toPersonEmail: m.para, markdown: m.markdown }) }).catch((x) => ({ ok: false, status: String(x) }) as { ok: boolean; status: string | number });
    if (r.ok) enviados++; else erros.push(`webex ${m.para}: ${r.status}`);
  }
  return NextResponse.json({ ok: !erros.length, total: velhos.length, mensagens: mensagens.length, enviados, erros });
}
