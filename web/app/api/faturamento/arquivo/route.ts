// Abre um documento HTML guardado (recibo, 2ª via) como página: o Storage
// serve .html como text/plain, então lemos aqui e devolvemos text/html em UTF-8,
// com uma barra "Imprimir / salvar PDF" que some na impressão.
// Vários ?p=…&p=… (recibos em lote, 05/10/26): todos numa página só, um por folha.
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { RECIBO_CSS, reciboPagamentoHtml } from "@/lib/faturamento/montar";
import { dadosConta, instrucaoPagamento } from "@/lib/faturamento/lote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "fat-documentos";
const valido = (p: string) => !!p && !p.includes("..") && /\.html?$/i.test(p);

/** Lê um HTML guardado e aplica o layout atual (recibos). */
async function documento(p: string): Promise<string | null> {
  const { data, error } = await supaAdmin().storage.from(BUCKET).download(p);
  if (error || !data) return null;
  let html = new TextDecoder("utf-8").decode(await data.arrayBuffer());
  // Recibos guardados antes do layout novo: troca o estilo pelo atual (o conteúdo fica igual).
  if (/\/recibo\//.test(p) && html.includes('class="folha"')) html = html.replace(/<style>@page[\s\S]*?<\/style>/, RECIBO_CSS);
  // Recibos emitidos antes de 05/10/26 ~20h saíram sem o bloco "Pagamento" quando
  // a conta não tinha chave PIX: completa com a forma e o banco da conta escolhida.
  const mRec = p.match(/\/recibo\/(\d+)-\d+\.html?$/i);
  if (mRec && html.includes('class="folha"') && !html.includes('class="pag"')) {
    const pag = await pagamentoDaEmissao(Number(mRec[1])).catch(() => "");
    if (pag) html = html.replace(/(<div class="linha"><div class="rot">Observações:)/, `${pag}\n$1`);
  }
  return html;
}

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  const ps = new URL(req.url).searchParams.getAll("p").slice(0, 60);
  if (!ps.length || !ps.every(valido)) return NextResponse.json({ error: "arquivo inválido" }, { status: 400 });
  const docs = await Promise.all(ps.map(documento));
  if (docs.some((d) => d == null)) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  let html = docs[0]!;
  if (docs.length > 1) {
    // Junta os corpos na página do primeiro: cada recibo numa folha.
    const corpo = (h: string) => h.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? h;
    html = html.replace(/<body([^>]*)>[\s\S]*<\/body>/i, (_m, a) => `<body${a}>${docs.map((d) => corpo(d!)).join("\n")}</body>`)
      .replace(/<\/head>/i, "<style>.folha{break-after:page}.folha:last-of-type{break-after:auto}@media screen{.folha{margin-bottom:8mm;box-shadow:0 0 0 1px #ddd}}</style></head>");
  }
  const n = docs.length > 1 ? `<span style="color:#cbd5e1;margin-right:auto">${docs.length} documentos</span>` : "";
  const barra = `<div class="__barra" style="position:sticky;top:0;z-index:9;display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:8px 12px;background:#0f172a;font:13px system-ui,sans-serif">${n}<button onclick="window.print()" style="background:#2563eb;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer">Imprimir / salvar PDF</button><button onclick="window.close()" style="background:#334155;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer">Fechar</button></div><style>@media print{.__barra{display:none!important}}</style>`;
  html = /<body[^>]*>/i.test(html) ? html.replace(/<body([^>]*)>/i, `<body$1>${barra}`) : barra + html;
  if (!/<meta[^>]+charset/i.test(html)) html = html.replace(/<head>/i, '<head><meta charset="utf-8">');
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}

async function pagamentoDaEmissao(id: number) {
  const { data: e } = await supaAdmin().schema("orders").from("fat_emissoes").select("empresa, condicao").eq("id", id).maybeSingle();
  const cond = (e?.condicao ?? null) as { forma_recebimento?: string | null; instrucao_pagamento?: string | null; conta_corrente?: number | null } | null;
  if (!e || !cond) return "";
  let instr = cond.instrucao_pagamento ?? "";
  // Banco/agência/conta sempre; chave PIX quando a forma é PIX.
  if (!instr && cond.conta_corrente) instr = instrucaoPagamento(["TRA", cond.forma_recebimento ?? ""], await dadosConta(e.empresa, cond.conta_corrente));
  return reciboPagamentoHtml(cond.forma_recebimento ?? null, instr);
}
