/**
 * Prévia da NF-e (DANFE) e do recibo ANTES de emitir (05/10/26).
 *
 * Monta exatamente o mesmo payload que o motor envia à Focus (montarNfe) e
 * desenha um DANFE no leiaute oficial (canhoto, emitente, destinatário,
 * fatura/duplicatas, cálculo do imposto, transportador, produtos, dados
 * adicionais), com marca d'água "PRÉVIA — SEM VALOR FISCAL", chave/protocolo
 * de mentira e o número previsto. NÃO chama a Focus nem a SEFAZ e não reserva
 * numeração: o emitente vem do cadastro de Empresas (cadastros.aux) e o
 * próximo número de fat_config.
 */
import { supaAdmin } from "@/lib/supabase-admin";
import {
  montarNfe, parcelas, reciboHtml, totalDoc, totalRetencoes, validar,
  type DocFat, type Emitente,
} from "@/lib/faturamento/montar";
import { checarDoc, type Checagem } from "@/lib/faturamento/pv-omie";
import { configDe, documentoPvOmie } from "@/lib/faturamento/server";
import { docFat, documento } from "@/lib/vendas-server";

const so = (s?: string | null) => (s ?? "").replace(/\D/g, "");
const r2 = (v: number) => Math.round(v * 100) / 100;
const brl = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtd = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const dataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
const fmtCnpj = (s?: string | null) => {
  const d = so(s);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return s ?? "";
};
const fmtCep = (s?: string | null) => so(s).replace(/^(\d{5})(\d{3})$/, "$1-$2");

/** Emitente a partir do cadastro de Empresas — sem consultar a Focus. */
export async function emitenteLocal(empresa: string): Promise<Emitente> {
  const { data } = await supaAdmin().schema("cadastros").from("aux")
    .select("nome, dados").eq("registro", "empresas").eq("codigo", empresa).maybeSingle();
  const d = ((data as { dados?: Record<string, string> } | null)?.dados ?? {}) as Record<string, string>;
  const cfg = await configDe(empresa);
  const cidade = (d.cidade ?? "").replace(/\s*\([A-Z]{2}\)\s*$/, "");
  return {
    cnpj: so(cfg.cnpj || d.cnpj),
    nome: (data as { nome?: string } | null)?.nome ?? d.fantasia ?? empresa,
    uf: d.uf || "SP",
    municipio: cidade,
    inscricao_estadual: so(d.ie) || undefined,
    inscricao_municipal: d.im || undefined,
    logradouro: [d.endereco, d.complemento].filter(Boolean).join(" - "),
    numero: d.numero || "S/N",
    bairro: d.bairro,
    cep: d.cep,
    telefone: d.telefone,
  };
}

/** Documento a partir da chave da carteira ("pv_omie:<codigo>" | "venda:<id>"). */
export async function docDaChave(chave: string, empresa: string) {
  const [tipo, idTxt] = chave.split(":");
  const id = Number(idTxt);
  if (!Number.isFinite(id) || id <= 0) throw new Error("chave inválida");
  if (tipo === "pv_omie") {
    const { bruto, doc } = await documentoPvOmie(empresa, id);
    return { doc, tipo: "nfe" as const, extra: { nf_omie: bruto.nf_omie, emissao_painel: bruto.emissao_painel, etapa: String(bruto.pv.etapa ?? ""), total_pv: Number(bruto.pv.valor_total) } };
  }
  if (tipo === "venda") {
    const d = await documento(id);
    const cfg = await configDe(empresa);
    return { doc: docFat(d), tipo: d.tipo === "PV" ? "nfe" as const : (cfg.tipo_os === "nfse" ? "nfse" as const : "recibo" as const), extra: { total_pv: Number(d.valor_total) } };
  }
  throw new Error("Prévia disponível para PV do Omie e PV/OS do painel");
}

type Payload = ReturnType<typeof montarNfe>;

/** Resumo da emissão para a gaveta: o payload exato, parcelas, textos e pendências. */
export async function resumoEmissao(doc: DocFat, extra: Parameters<typeof checarDoc>[1]) {
  const cfg = await configDe(doc.empresa);
  const em = await emitenteLocal(doc.empresa);
  const checagens: Checagem[] = checarDoc(doc, extra);
  const inval = validar(doc);
  if (inval) checagens.push({ item: "Documento válido", ok: false, nivel: "erro", detalhe: inval });
  const c = doc.cliente;
  const aviso = (item: string, ok: boolean, detalhe: string) => { if (!ok) checagens.push({ item, ok, nivel: "aviso", detalhe }); };
  aviso("E-mail do cliente", !!c.email, "sem e-mail — a NF-e sai sem e-mail do destinatário");
  aviso("Código IBGE do município", !!so(c.codigo_municipio), "sem código IBGE — confira o cadastro");
  aviso("CEP", so(c.cep).length === 8, "CEP incompleto");
  aviso("NCM dos itens", doc.itens.every((i) => so(i.ncm).length === 8), "há item sem NCM de 8 dígitos");
  aviso("Forma de pagamento", !!(doc.condicao?.forma_pagamento || doc.condicao?.forma_recebimento), "sem forma definida — sai como boleto/à vista pelo prazo");
  const payload: Payload = montarNfe(doc, em, {
    natureza: cfg.natureza_operacao, serie: cfg.nfe_serie_producao, numero: cfg.nfe_proximo_producao, infoPadrao: cfg.info_complementar_padrao,
  });
  const total = Number(payload.valor_total);
  const ret = totalRetencoes(doc.condicao?.retencoes);
  const liquido = r2(total - ret);
  return {
    destinatario: c,
    condicao: doc.condicao ?? null,
    transporte: doc.transporte ?? null,
    itens: payload.items.map((i) => ({ codigo: i.codigo_produto, descricao: i.descricao, ncm: i.codigo_ncm, cfop: i.cfop, un: i.unidade_comercial, qtd: i.quantidade_comercial, unit: i.valor_unitario_comercial, total: i.valor_bruto })),
    natureza: cfg.natureza_operacao,
    informacoes_complementares: (payload as { informacoes_adicionais_contribuinte?: string }).informacoes_adicionais_contribuinte ?? "",
    parcelas: parcelas(liquido, doc.condicao),
    total, liquido, retencoes: ret,
    pedido_cliente: doc.pedido_cliente ?? null,
    proximo: { nfe: cfg.nfe_proximo_producao, serie: cfg.nfe_serie_producao, recibo: cfg.recibo_proximo },
    checagens,
  };
}

const MOD_FRETE: Record<number, string> = { 0: "0 - Por conta do Emitente", 1: "1 - Por conta do Destinatário", 2: "2 - Por conta de Terceiros", 3: "3 - Próprio (Remetente)", 4: "4 - Próprio (Destinatário)", 9: "9 - Sem Frete" };

/** DANFE (retrato) em HTML/CSS no leiaute oficial, pronto para imprimir/salvar PDF. */
export function danfeHtml(p: Payload, em: Emitente, o: { numero: number | null; serie: string; previa: boolean }) {
  const numero = o.numero ? String(o.numero).padStart(9, "0").replace(/^(\d{3})(\d{3})(\d{3})$/, "$1.$2.$3") : "—";
  const pp = p as Payload & Record<string, unknown>;
  const dest = {
    nome: pp.nome_destinatario as string, doc: (pp.cnpj_destinatario ?? pp.cpf_destinatario) as string,
    end: [pp.logradouro_destinatario, pp.numero_destinatario, pp.complemento_destinatario].filter(Boolean).join(", "),
    bairro: pp.bairro_destinatario as string, cep: pp.cep_destinatario as string, mun: pp.municipio_destinatario as string,
    uf: pp.uf_destinatario as string, fone: pp.telefone_destinatario as string | undefined, ie: pp.inscricao_estadual_destinatario as string | undefined,
  };
  const emissao = dataBR(String(p.data_emissao));
  const dups = ((pp as { duplicatas?: unknown }).duplicatas ?? []) as { numero: string; data_vencimento: string; valor: number }[]; // remessa/devolução sem cobrança: sem duplicatas
  const vol = ((pp.volumes as { quantidade?: number; especie?: string; peso_bruto?: number; peso_liquido?: number }[] | undefined) ?? [])[0] ?? {};
  const chave = "0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000";
  const linhas = p.items.map((i) => `<tr>
    <td>${esc(i.codigo_produto)}</td><td class="l">${esc(i.descricao)}${(i as { informacoes_adicionais_item?: string }).informacoes_adicionais_item ? `<br><small>${esc((i as { informacoes_adicionais_item?: string }).informacoes_adicionais_item)}</small>` : ""}</td>
    <td>${esc(i.codigo_ncm)}</td><td>0${esc(i.icms_situacao_tributaria)}</td><td>${esc(i.cfop)}</td><td>${esc(i.unidade_comercial)}</td>
    <td class="r">${qtd(i.quantidade_comercial)}</td><td class="r">${brl(i.valor_unitario_comercial)}</td><td class="r">${brl(i.valor_bruto)}</td>
    <td class="r">${brl((i as { valor_desconto?: number }).valor_desconto ?? 0)}</td><td class="r">0,00</td><td class="r">0,00</td><td class="r">0,00</td><td class="r">0,00</td><td class="r">0,00</td></tr>`).join("");
  const cx = (rot: string, val: unknown, cls = "") => `<div class="cx ${cls}"><span>${rot}</span><b>${esc(val) || "&nbsp;"}</b></div>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${o.previa ? "PRÉVIA " : ""}DANFE nº ${numero} série ${esc(o.serie)}</title>
<style>
@page{size:A4;margin:6mm}*{box-sizing:border-box}html,body{margin:0;background:#e9ecef}body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:7pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.barra{position:sticky;top:0;background:#111a2e;color:#fff;padding:8px 14px;font:13px Arial;display:flex;gap:12px;align-items:center;z-index:5}.barra button{background:#3b82f6;color:#fff;border:0;border-radius:6px;padding:6px 12px;cursor:pointer}
.folha{width:198mm;margin:8mm auto;background:#fff;padding:3mm;position:relative;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.2)}
.marca{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:3}
.marca span{transform:rotate(-35deg);font-size:46pt;font-weight:900;color:rgba(220,38,38,.18);white-space:nowrap;letter-spacing:2px}
.row{display:flex;width:100%}.cx{border:1px solid #000;margin:-1px 0 0 -1px;padding:.6mm 1mm;flex:1;min-height:7.5mm;overflow:hidden}.cx span{display:block;font-size:5.5pt;text-transform:uppercase}.cx b{font-size:8pt;font-weight:normal;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tit{font-size:6.5pt;font-weight:bold;margin:2mm 0 .5mm;text-transform:uppercase}
.canhoto{display:flex;border:1px dashed #000;margin-bottom:2mm}.canhoto .t{flex:1;padding:1mm;font-size:6.5pt;border-right:1px solid #000}.canhoto .n{width:32mm;text-align:center;padding:1mm;font-size:8pt}
.cab{display:grid;grid-template-columns:78mm 34mm 1fr;border:1px solid #000}.cab>div{padding:1.5mm;border-right:1px solid #000}.cab>div:last-child{border-right:0}
.emit b{font-size:10pt;display:block;margin-bottom:1mm}.danfe{text-align:center}.danfe h1{margin:0;font-size:13pt}.danfe .es{display:flex;justify-content:center;gap:2mm;align-items:center;margin:1mm 0}.danfe .es i{border:1px solid #000;padding:0 2mm;font-style:normal;font-size:11pt}
.cod{height:11mm;background:repeating-linear-gradient(90deg,#000 0 1px,#fff 1px 3px,#000 3px 5px,#fff 5px 6px);opacity:.25;margin-bottom:1mm}
table.prod{width:100%;border-collapse:collapse;font-size:6.5pt}table.prod th,table.prod td{border:1px solid #000;padding:.4mm .6mm;text-align:center}table.prod th{font-size:5.5pt}table.prod td.l{text-align:left}table.prod td.r{text-align:right}
.dups{display:flex;flex-wrap:wrap;border:1px solid #000}.dups div{padding:1mm 2mm;border-right:1px solid #000;font-size:7pt}
.adic{display:grid;grid-template-columns:2fr 1fr}.adic>div{border:1px solid #000;margin:-1px 0 0 -1px;padding:1mm;min-height:28mm;font-size:7pt;white-space:pre-wrap}
@media print{.barra{display:none}html,body{background:#fff}.folha{margin:0;box-shadow:none}}
</style></head><body>
${o.previa ? `<div class="barra"><b>PRÉVIA do DANFE</b><span>sem valor fiscal · nada foi enviado à SEFAZ · número previsto ${numero}</span><span style="flex:1"></span><button onclick="window.print()">Imprimir / salvar PDF</button></div>` : ""}
<div class="folha">
${o.previa ? '<div class="marca"><span>PRÉVIA — SEM VALOR FISCAL</span></div>' : ""}
<div class="canhoto"><div class="t">RECEBEMOS DE ${esc(em.nome)} OS PRODUTOS/SERVIÇOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO<div class="row" style="margin-top:2mm">${cx("Data de recebimento", "")}${cx("Identificação e assinatura do recebedor", "", "")}</div></div><div class="n"><b>NF-e</b><br>Nº ${numero}<br>Série ${esc(o.serie)}</div></div>
<div class="cab">
  <div class="emit"><b>${esc(em.nome)}</b>${esc([em.logradouro, em.numero].filter(Boolean).join(", "))}<br>${esc(em.bairro ?? "")} - ${esc(fmtCep(em.cep))}<br>${esc(em.municipio ?? "")} - ${esc(em.uf ?? "")}${em.telefone ? `<br>Fone: ${esc(em.telefone)}` : ""}</div>
  <div class="danfe"><h1>DANFE</h1><div style="font-size:6.5pt">Documento Auxiliar da Nota Fiscal Eletrônica</div><div class="es"><span style="font-size:6.5pt;text-align:left">0 - ENTRADA<br>1 - SAÍDA</span><i>${p.tipo_documento ?? 1}</i></div><b>Nº ${numero}</b><br><b>SÉRIE ${esc(o.serie)}</b><br>FOLHA 1/1</div>
  <div><div class="cod"></div><div class="cx" style="margin:0"><span>Chave de acesso</span><b style="font-size:7pt">${o.previa ? "(gerada na autorização)" : chave}</b></div><div style="font-size:7pt;text-align:center;margin-top:1mm">Consulta de autenticidade no portal nacional da NF-e www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora</div></div>
</div>
<div class="row">${cx("Natureza da operação", p.natureza_operacao)}${cx("Protocolo de autorização de uso", o.previa ? "PRÉVIA — sem protocolo" : "")}</div>
<div class="row">${cx("Inscrição estadual", em.inscricao_estadual ?? "")}${cx("Insc. estadual do subst. trib.", "")}${cx("CNPJ", fmtCnpj(em.cnpj))}</div>
<div class="tit">Destinatário / remetente</div>
<div class="row">${cx("Nome / razão social", dest.nome)}${cx("CNPJ / CPF", fmtCnpj(dest.doc))}${cx("Data da emissão", emissao)}</div>
<div class="row">${cx("Endereço", dest.end)}${cx("Bairro / distrito", dest.bairro)}${cx("CEP", fmtCep(dest.cep))}${cx("Data da saída/entrada", emissao)}</div>
<div class="row">${cx("Município", dest.mun)}${cx("Fone / fax", dest.fone ?? "")}${cx("UF", dest.uf)}${cx("Inscrição estadual", dest.ie ?? "")}${cx("Hora da saída", "")}</div>
<div class="tit">Fatura / duplicatas</div>
<div class="dups">${dups.map((d) => `<div>Nº ${esc(d.numero)}<br>Venc. ${dataBR(d.data_vencimento)}<br>R$ ${brl(d.valor)}</div>`).join("") || "<div>—</div>"}</div>
<div class="tit">Cálculo do imposto</div>
<div class="row">${cx("Base de cálc. do ICMS", "0,00")}${cx("Valor do ICMS", "0,00")}${cx("Base cálc. ICMS ST", "0,00")}${cx("Valor do ICMS ST", "0,00")}${cx("V. imp. importação", "0,00")}${cx("V. total dos produtos", brl(p.valor_produtos))}</div>
<div class="row">${cx("Valor do frete", brl(pp.valor_frete ?? 0))}${cx("Valor do seguro", "0,00")}${cx("Desconto", brl(pp.valor_desconto ?? 0))}${cx("Outras desp. acess.", brl(pp.valor_outras_despesas ?? 0))}${cx("Valor do IPI", "0,00")}${cx("V. total da nota", brl(p.valor_total))}</div>
<div class="tit">Transportador / volumes transportados</div>
<div class="row">${cx("Nome / razão social", pp.nome_transportador ?? "")}${cx("Frete por conta", MOD_FRETE[Number(p.modalidade_frete)] ?? p.modalidade_frete)}${cx("CNPJ / CPF", fmtCnpj((pp.cnpj_transportador ?? pp.cpf_transportador) as string))}</div>
<div class="row">${cx("Endereço", pp.endereco_transportador ?? "")}${cx("Município", pp.municipio_transportador ?? "")}${cx("UF", pp.uf_transportador ?? "")}${cx("Inscrição estadual", pp.inscricao_estadual_transportador ?? "")}</div>
<div class="row">${cx("Quantidade", vol.quantidade ?? "")}${cx("Espécie", vol.especie ?? "")}${cx("Marca", "")}${cx("Numeração", "")}${cx("Peso bruto", vol.peso_bruto ?? "")}${cx("Peso líquido", vol.peso_liquido ?? "")}</div>
<div class="tit">Dados dos produtos / serviços</div>
<table class="prod"><thead><tr><th>Código</th><th>Descrição do produto / serviço</th><th>NCM/SH</th><th>CSOSN</th><th>CFOP</th><th>UN</th><th>Quant.</th><th>Valor unit.</th><th>Valor total</th><th>Desc.</th><th>B.cálc ICMS</th><th>Valor ICMS</th><th>Valor IPI</th><th>Alíq. ICMS</th><th>Alíq. IPI</th></tr></thead><tbody>${linhas}</tbody></table>
<div class="tit">Dados adicionais</div>
<div class="adic"><div><span style="font-size:5.5pt">INFORMAÇÕES COMPLEMENTARES</span>\n${esc((pp.informacoes_adicionais_contribuinte as string) ?? "")}</div><div><span style="font-size:5.5pt">RESERVADO AO FISCO</span></div></div>
</div></body></html>`;
}

/** Prévia completa a partir de um documento: HTML do DANFE ou do recibo. */
export async function previaHtml(doc: DocFat, tipo: "nfe" | "recibo" | "nfse") {
  const cfg = await configDe(doc.empresa);
  const em = await emitenteLocal(doc.empresa);
  if (tipo === "nfe") {
    const payload = montarNfe(doc, em, { natureza: cfg.natureza_operacao, serie: cfg.nfe_serie_producao, numero: cfg.nfe_proximo_producao, infoPadrao: cfg.info_complementar_padrao });
    return danfeHtml(payload, em, { numero: cfg.nfe_proximo_producao, serie: cfg.nfe_serie_producao, previa: true });
  }
  if (tipo === "recibo") {
    const html = reciboHtml(doc, em, cfg.recibo_proximo ?? 0, false);
    const marca = `<style>.pv-marca{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9}.pv-marca span{transform:rotate(-35deg);font:900 46pt Arial;color:rgba(220,38,38,.18);white-space:nowrap}.pv-barra{position:sticky;top:0;background:#111a2e;color:#fff;padding:8px 14px;font:13px Arial;display:flex;gap:12px;z-index:10}.pv-barra button{background:#3b82f6;color:#fff;border:0;border-radius:6px;padding:6px 12px}@media print{.pv-barra{display:none}}</style><div class="pv-barra"><b>PRÉVIA do recibo</b><span>nada foi emitido · número previsto ${cfg.recibo_proximo ?? "—"}</span><span style="flex:1"></span><button onclick="window.print()">Imprimir / salvar PDF</button></div><div class="pv-marca"><span>PRÉVIA — SEM VALOR</span></div>`;
    return html.replace("<body>", `<body>${marca}`).replace(/Recibo de Prestação de Serviço nº (\d+)/, (_m, n) => `Recibo de Prestação de Serviço nº ${n} (previsto)`);
  }
  throw new Error("NFS-e é emitida no portal da prefeitura — sem prévia aqui");
}

export { totalDoc };
