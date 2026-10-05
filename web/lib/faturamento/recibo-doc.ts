// Recibo guardado no Storage → HTML com o layout atual e → PDF (05/10/26).
// Usado pela 2ª via em HTML (/api/faturamento/arquivo) e pelo download em PDF
// (/api/faturamento/recibo-pdf), para os dois saírem iguais.
import "server-only";
import { createHash } from "node:crypto";
import { supaAdmin } from "@/lib/supabase-admin";
import { RECIBO_CSS, reciboPagamentoHtml } from "@/lib/faturamento/montar";
import { dadosConta, instrucaoPagamento } from "@/lib/faturamento/lote";
import { htmlParaPdf } from "@/lib/faturamento/pdf";

export const BUCKET_FAT = "fat-documentos";
export const caminhoValido = (p: string) => !!p && !p.includes("..") && /\.html?$/i.test(p);

/** Lê um HTML guardado e aplica o layout atual (recibos). */
export async function documentoGuardado(p: string): Promise<string | null> {
  const { data, error } = await supaAdmin().storage.from(BUCKET_FAT).download(p);
  if (error || !data) return null;
  let html = new TextDecoder("utf-8").decode(await data.arrayBuffer());
  // Recibos guardados antes do layout novo: troca o estilo pelo atual (o conteúdo fica igual).
  if (/\/recibo\//.test(p) && html.includes('class="folha"')) {
    html = html.replace(/<style>@page[\s\S]*?<\/style>/, RECIBO_CSS);
    // Bloco do cliente no formato antigo: sem linha em branco após o nome e um e-mail por linha.
    html = html.replace(/(<div class="cli"><b>[^<]*<\/b>)<br>/, "$1")
      .replace(/(<div class="cli">[\s\S]*?<br>)([^<]*@[^<]*,[^<]*)(<br>)/, (_m, a, mails: string, b) => a + mails.split(/[,;]\s*/).filter(Boolean).join("<br>") + b);
  }
  // Recibos emitidos antes de 05/10/26 ~20h saíram sem o bloco "Pagamento" quando
  // a conta não tinha chave PIX: completa com a forma e o banco da conta escolhida.
  const mRec = p.match(/\/recibo\/(\d+)-\d+\.html?$/i);
  if (mRec && html.includes('class="folha"') && !html.includes('class="pag"')) {
    const pag = await pagamentoDaEmissao(Number(mRec[1])).catch(() => "");
    if (pag) html = html.replace(/(<div class="linha"><div class="rot">Observações:)/, `${pag}\n$1`);
  }
  return html;
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

/** Nome do arquivo = título do documento ("Recibo de Prestação de Serviço nº 0000004646.pdf"). */
export function nomePdf(html: string, reserva = "Recibo") {
  const t = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || reserva;
  return `${t.replace(/[\\/:*?"<>|]+/g, "-")}.pdf`;
}

/** Content-Disposition com nome UTF-8 (RFC 5987) e reserva ASCII. */
export function disposicao(nome: string) {
  const ascii = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/º/g, "o").replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

/** PDF do HTML; guardado no Storage ao lado do original, com o hash do HTML no
 *  nome — muda o layout ou o conteúdo, muda o hash, gera de novo. */
export async function pdfComCache(html: string, base: string | null): Promise<Uint8Array> {
  const hash = createHash("sha1").update(html).digest("hex").slice(0, 12);
  const alvo = base ? `${base.replace(/\.html?$/i, "")}.${hash}.pdf` : null;
  const st = supaAdmin().storage.from(BUCKET_FAT);
  if (alvo) {
    const { data } = await st.download(alvo);
    if (data) return new Uint8Array(await data.arrayBuffer());
  }
  const pdf = await htmlParaPdf(html);
  if (alvo) await st.upload(alvo, new Blob([pdf as BlobPart], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" }).catch(() => null);
  return pdf;
}
