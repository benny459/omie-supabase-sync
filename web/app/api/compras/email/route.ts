// GET  /api/compras/email?id=  — dados para o modal "Enviar a impressão do pedido de compra por e-mail"
// POST /api/compras/email      — envia (PDF anexo) e registra no histórico do pedido
//
// Envio por Resend (API HTTP, sem pacote). Precisa de RESEND_API_KEY e
// COMPRAS_EMAIL_REMETENTE ("Compras WaterWorks <compras@waterworks.com.br>",
// domínio verificado no Resend). Sem isso o modal mostra "e-mail não
// configurado" e oferece baixar o PDF e marcar como enviado à mão.
// COMPRAS_EMAIL_SO_PARA (lista separada por vírgula), se definida, limita os
// destinatários — usada para testar só com endereços internos.
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro } from "@/lib/compras-server";
import { gerarPdfPedido, type VariantePdf } from "@/lib/compras-pdf";
import { supaAdmin } from "@/lib/supabase-admin";
import type { Pedido } from "@/lib/compras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const configurado = () => !!(process.env.RESEND_API_KEY && process.env.COMPRAS_EMAIL_REMETENTE);
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const lista = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/[,;\s]+/)).map((x) => String(x).trim()).filter(Boolean);
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const titulo = (t?: string | null) => (t ?? "").toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  try {
    const p = await rpc<Pedido>("compras_pedido", { p_id: id });
    const [{ data: emp }, { data: forn }] = await Promise.all([
      supaAdmin().schema("orders").rpc("compras_empresa", { p_empresa: p.emp }),
      p.fornCod ? supaAdmin().schema("finance").from("clientes").select("email, razao_social").eq("empresa", p.emp)
        .eq("codigo_cliente_omie", p.fornCod).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const empresa = (emp as { razao_social?: string } | null)?.razao_social ?? p.emp;
    // e-mails do cadastro do fornecedor, sem os nossos (o Omie põe o contasareceber@ em vários)
    const para = lista((forn as { email?: string } | null)?.email).filter((e) => emailOk(e) && !/@waterworks\.com\.br$/i.test(e));
    return NextResponse.json({
      configurado: configurado(), soPara: lista(process.env.COMPRAS_EMAIL_SO_PARA), para,
      assunto: `${empresa.toUpperCase()} - Pedido de Compra Nº ${p.num}`, empresa, numero: p.num,
      fornecedor: p.forn, eu: q.email, aprovado: p.aprov === "aprovado", origem: p.origem,
      enviadoEm: p.enviadoEm, enviadoPara: p.enviadoPara,
    });
  } catch (e) { return erro(e); }
}

export async function POST(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const id = Number(b.id);
  const variante: VariantePdf = b.variante === "sem_valores" ? "sem_valores" : "completo";

  // Marcar como enviado sem e-mail (WhatsApp, entregue em mãos…)
  if (b.acao === "marcar") {
    try {
      const ped = await rpc<Pedido>("compras_pedido", { p_id: id });
      if (ped.aprov !== "aprovado") throw new Error("Pedido ainda não aprovado — só pedido aprovado vai ao fornecedor"); return NextResponse.json(await rpc("compras_marcar_enviado", { p_id: id, p_para: String(b.para ?? ""), p_meio: String(b.meio ?? "outro"), p_por: q.email })); }
    catch (e) { return erro(e); }
  }

  if (!configurado()) {
    return NextResponse.json({ error: "E-mail não configurado no painel (falta RESEND_API_KEY e COMPRAS_EMAIL_REMETENTE na Vercel). Baixe o PDF e use “Marcar como enviado”." }, { status: 503 });
  }
  const para = lista(b.para), cc = lista(b.cc), cco = lista(b.cco);
  if (b.copia) cco.push(q.email);
  const todos = [...para, ...cc, ...cco];
  if (!para.length) return NextResponse.json({ error: "Informe pelo menos um destinatário em “Para”." }, { status: 400 });
  const ruim = todos.find((e) => !emailOk(e));
  if (ruim) return NextResponse.json({ error: `E-mail inválido: ${ruim}` }, { status: 400 });
  const so = lista(process.env.COMPRAS_EMAIL_SO_PARA).map((e) => e.toLowerCase());
  if (so.length && todos.some((e) => !so.includes(e.toLowerCase()))) {
    return NextResponse.json({ error: `Modo teste: só envia para ${so.join(", ")}.` }, { status: 400 });
  }
  try {
    const { pdf, pedido, empresa } = await gerarPdfPedido(id, variante, q.nome);
    if (pedido.aprov !== "aprovado") throw new Error("Pedido ainda não aprovado — aprove antes de enviar ao fornecedor");
    const nomeEmp = titulo(empresa.razao_social ?? pedido.emp);
    const texto = String(b.texto ?? "").trim();
    const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1A2731;font-size:14px;line-height:1.55;max-width:600px">
      <div style="height:4px;background:linear-gradient(90deg,#10324A,#1C7FA0);margin-bottom:18px"></div>
      <img src="https://painel.waterworks.com.br/logo-waterworks.png" alt="WaterWorks" width="150" style="display:block;margin-bottom:16px">
      <p>Prezado Fornecedor,</p>
      <p>Anexo o arquivo PDF com o Pedido de Compra Nº <b>${esc(pedido.num)}</b>.</p>
      <p>Por favor, providenciar a entrega conforme as condições do pedido.</p>
      ${texto ? `<p style="white-space:pre-wrap">${esc(texto)}</p>` : ""}
      <p style="background:#EEF4F7;border-left:3px solid #1C7FA0;padding:10px 12px;font-size:13px">
        Ao emitir a NF-e, informe o número <b>${esc(pedido.num)}</b> no campo “Pedido de compra” (xPed) de cada item e o item do pedido em nItemPed.</p>
      <p style="color:#6A7B86;font-size:12px">${esc(nomeEmp)}</p></div>`;
    const anexos: { filename: string; content: string }[] = [
      { filename: `pedido_de_compra_${pedido.num}${variante === "sem_valores" ? "_sem_valores" : ""}.pdf`, content: Buffer.from(pdf).toString("base64") },
    ];
    const extra = b.anexo as { nome?: string; base64?: string } | undefined;
    if (extra?.base64 && extra.nome) {
      if (extra.base64.length > 10_000_000) throw new Error("Anexo extra grande demais (máx. ~7 MB)");
      anexos.push({ filename: extra.nome, content: extra.base64 });
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.COMPRAS_EMAIL_REMETENTE, to: para, cc: cc.length ? cc : undefined,
        bcc: cco.length ? cco : undefined, reply_to: q.email, subject: String(b.assunto ?? `Pedido de Compra Nº ${pedido.num}`), html, attachments: anexos }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Falha no envio: ${(j as { message?: string }).message ?? r.statusText}`);
    await rpc("compras_registrar", { p_id: id, p_texto: `E-mail enviado (${variante === "sem_valores" ? "sem valores" : "completo"}) · para ${para.join(", ")}${cc.length ? ` · cc ${cc.join(", ")}` : ""}${cco.length ? ` · cco ${cco.join(", ")}` : ""}`, p_por: q.email });
    await rpc("compras_marcar_enviado", { p_id: id, p_para: para.join(", "), p_meio: "email", p_por: q.email });
    return NextResponse.json({ ok: true, id: (j as { id?: string }).id });
  } catch (e) { return erro(e); }
}
