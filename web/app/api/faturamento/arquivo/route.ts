// Abre um documento HTML guardado (recibo, 2ª via) como página: o Storage
// serve .html como text/plain, então lemos aqui e devolvemos text/html em UTF-8,
// com uma barra "Imprimir / salvar PDF" que some na impressão.
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { RECIBO_CSS, reciboPagamentoHtml } from "@/lib/faturamento/montar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "fat-documentos";

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  const p = new URL(req.url).searchParams.get("p") ?? "";
  if (!p || p.includes("..") || !/\.html?$/i.test(p)) return NextResponse.json({ error: "arquivo inválido" }, { status: 400 });
  const { data, error } = await supaAdmin().storage.from(BUCKET).download(p);
  if (error || !data) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
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
  const barra = `<div class="__barra" style="position:sticky;top:0;z-index:9;display:flex;gap:8px;justify-content:flex-end;padding:8px 12px;background:#0f172a;font:13px system-ui,sans-serif"><button onclick="window.print()" style="background:#2563eb;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer">Imprimir / salvar PDF</button><button onclick="window.close()" style="background:#334155;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer">Fechar</button></div><style>@media print{.__barra{display:none!important}}</style>`;
  html = /<body[^>]*>/i.test(html) ? html.replace(/<body([^>]*)>/i, `<body$1>${barra}`) : barra + html;
  if (!/<meta[^>]+charset/i.test(html)) html = html.replace(/<head>/i, '<head><meta charset="utf-8">');
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}

const BANCOS: Record<string, string> = { "001": "Banco do Brasil", "033": "Santander", "104": "Caixa", "237": "Bradesco", "260": "Nubank", "301": "Conta Simples", "336": "C6 Bank", "341": "Itaú", "077": "Inter", "208": "BTG" };

async function pagamentoDaEmissao(id: number) {
  const db = supaAdmin();
  const { data: e } = await db.schema("orders").from("fat_emissoes").select("empresa, condicao").eq("id", id).maybeSingle();
  const cond = (e?.condicao ?? null) as { forma_recebimento?: string | null; instrucao_pagamento?: string | null; conta_corrente?: number | null } | null;
  if (!e || !cond) return "";
  let instr = cond.instrucao_pagamento ?? "";
  if (!instr && cond.conta_corrente) {
    const { data: c } = await db.schema("orders").rpc("fat_conta_dados", { p_empresa: e.empresa, p_codigo: String(cond.conta_corrente) });
    const d = (c ?? {}) as { banco?: string; agencia?: string; conta?: string; pix_tipo?: string; pix_chave?: string; beneficiario?: string };
    const quem = d.beneficiario ? ` — favorecido ${d.beneficiario}` : "";
    const l: string[] = [];
    if (cond.forma_recebimento === "PIX" && d.pix_chave) l.push(`Pagamento via PIX: chave ${d.pix_tipo ? `${d.pix_tipo.toUpperCase()} ` : ""}${d.pix_chave}${quem}`);
    if (d.banco && d.agencia && d.conta) l.push(`Transferência/depósito: ${BANCOS[d.banco] ?? `Banco ${d.banco}`} (${d.banco}) Ag ${d.agencia} CC ${d.conta}${quem}`);
    instr = l.join(" | ");
  }
  return reciboPagamentoHtml(cond.forma_recebimento ?? null, instr);
}
