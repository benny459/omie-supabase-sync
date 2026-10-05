/**
 * Monta o documento fiscal a partir da interface mínima do faturamento:
 *   { empresa, cliente, itens, condicao }
 * Serve tanto ao PV/OS nativo (P1) quanto a dados de teste. Regras fiscais da
 * SF (Simples Nacional): CSOSN 102, PIS/COFINS CST 49, CFOP 5102/6102 pela UF
 * (ver docs/focus-faturamento.md, branch focus-faturamento).
 */

export type ClienteFat = {
  nome: string;
  cnpj?: string | null;
  cpf?: string | null;
  ie?: string | null;           // inscrição estadual; vazio = não contribuinte
  email?: string | null;
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  municipio: string;
  codigo_municipio?: string | null;
  uf: string;
  cep: string;
  telefone?: string | null;
};

export type ItemFat = {
  codigo: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  unidade?: string | null;
  ncm?: string | null;
  cest?: string | null;
  cfop?: string | null;
  origem?: number | null;       // origem da mercadoria (0 nacional, 1 importação direta...)
};

export type ParcelaCond = { dias?: number; vencimento?: string; percentual?: number; valor?: number };
export type CondicaoFat = { parcelas?: ParcelaCond[]; forma_pagamento?: string; descricao?: string };

export type DocFat = {
  empresa: string;
  cliente: ClienteFat;
  itens: ItemFat[];
  condicao?: CondicaoFat | null;
  observacoes?: string | null;
  pedido_cliente?: string | null;   // nº do pedido/OC do cliente
};

export type Emitente = {
  cnpj: string;
  nome?: string;
  uf?: string;
  municipio?: string;
  codigo_municipio?: string;
  inscricao_municipal?: string;
  inscricao_estadual?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  telefone?: string;
};

const so = (s?: string | null) => (s ?? "").replace(/\D/g, "");
const r2 = (n: number) => Math.round(n * 100) / 100;
const hojeISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // America/Sao_Paulo

export function totalItens(itens: ItemFat[]) {
  return r2(itens.reduce((s, i) => s + r2(i.quantidade * i.valor_unitario), 0));
}

/** Parcelas com vencimento e valor; a última absorve o arredondamento. */
export function parcelas(total: number, cond?: CondicaoFat | null, base = hojeISO()) {
  const ps = cond?.parcelas?.length ? cond.parcelas : [{ dias: 0 }];
  const n = ps.length;
  const out = ps.map((p, i) => {
    const valor = p.valor != null ? r2(p.valor) : p.percentual != null ? r2((total * p.percentual) / 100) : r2(total / n);
    let venc = p.vencimento;
    if (!venc) {
      const d = new Date(`${base}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + (p.dias ?? 0));
      venc = d.toISOString().slice(0, 10);
    }
    return { numero: String(i + 1).padStart(3, "0"), vencimento: venc, valor };
  });
  const soma = r2(out.reduce((s, p) => s + p.valor, 0));
  out[out.length - 1].valor = r2(out[out.length - 1].valor + (total - soma));
  return out;
}

export function validar(doc: DocFat): string | null {
  if (!doc.empresa) return "Empresa não informada";
  const c = doc.cliente;
  if (!c?.nome) return "Cliente sem nome";
  if (!so(c.cnpj) && !so(c.cpf)) return "Cliente sem CNPJ/CPF";
  for (const k of ["logradouro", "numero", "bairro", "municipio", "uf", "cep"] as const) {
    if (!c[k]) return `Cliente sem ${k}`;
  }
  if (!doc.itens?.length) return "Sem itens";
  for (const i of doc.itens) {
    if (!i.descricao || !(i.quantidade > 0) || !(i.valor_unitario >= 0)) return `Item inválido: ${i.descricao || i.codigo}`;
  }
  return null;
}

/** JSON de emissão de NF-e da Focus (v2). */
export function montarNfe(doc: DocFat, em: Emitente, opts: { natureza: string; serie?: string; numero?: number | null }) {
  const c = doc.cliente;
  const mesmaUF = (em.uf || "SP").toUpperCase() === c.uf.toUpperCase();
  const contribuinte = !!so(c.ie);
  const total = totalItens(doc.itens);
  const ps = parcelas(total, doc.condicao);
  const aPrazo = ps.length > 1 || ps.some((p) => p.vencimento > hojeISO());
  const agora = new Date().toISOString();

  const items = doc.itens.map((i, n) => {
    const bruto = r2(i.quantidade * i.valor_unitario);
    const un = (i.unidade || "UN").toUpperCase();
    return {
      numero_item: n + 1,
      codigo_produto: i.codigo,
      descricao: i.descricao,
      cfop: i.cfop || (mesmaUF ? "5102" : "6102"),
      codigo_ncm: so(i.ncm) || "00000000",
      ...(i.cest ? { cest: so(i.cest) } : {}),
      unidade_comercial: un,
      quantidade_comercial: i.quantidade,
      valor_unitario_comercial: i.valor_unitario,
      valor_bruto: bruto,
      unidade_tributavel: un,
      quantidade_tributavel: i.quantidade,
      valor_unitario_tributavel: i.valor_unitario,
      inclui_no_total: 1,
      ...(doc.pedido_cliente ? { pedido_compra: doc.pedido_cliente.slice(0, 15) } : {}),
      icms_origem: i.origem ?? 0,
      icms_situacao_tributaria: "102",
      pis_situacao_tributaria: "49",
      cofins_situacao_tributaria: "49",
    };
  });

  return {
    natureza_operacao: opts.natureza,
    ...(opts.serie ? { serie: opts.serie } : {}),
    ...(opts.numero ? { numero: opts.numero } : {}),
    data_emissao: agora,
    data_entrada_saida: agora,
    tipo_documento: 1,
    local_destino: mesmaUF ? 1 : 2,
    finalidade_emissao: 1,
    consumidor_final: contribuinte ? 0 : 1,
    presenca_comprador: 9,
    cnpj_emitente: so(em.cnpj),
    nome_destinatario: c.nome,
    ...(so(c.cnpj) ? { cnpj_destinatario: so(c.cnpj) } : { cpf_destinatario: so(c.cpf) }),
    indicador_inscricao_estadual_destinatario: contribuinte ? 1 : 9,
    ...(contribuinte ? { inscricao_estadual_destinatario: so(c.ie) } : {}),
    ...(c.email ? { email_destinatario: c.email } : {}),
    logradouro_destinatario: c.logradouro,
    numero_destinatario: c.numero,
    ...(c.complemento ? { complemento_destinatario: c.complemento } : {}),
    bairro_destinatario: c.bairro,
    ...(c.codigo_municipio ? { codigo_municipio_destinatario: c.codigo_municipio } : {}),
    municipio_destinatario: c.municipio,
    uf_destinatario: c.uf.toUpperCase(),
    cep_destinatario: so(c.cep),
    ...(c.telefone ? { telefone_destinatario: so(c.telefone) } : {}),
    modalidade_frete: 9,
    valor_produtos: total,
    valor_total: total,
    ...(aPrazo
      ? {
          numero_fatura: "1",
          valor_original_fatura: total,
          valor_desconto_fatura: 0,
          valor_liquido_fatura: total,
          duplicatas: ps.map((p) => ({ numero: p.numero, data_vencimento: p.vencimento, valor: p.valor })),
        }
      : {}),
    formas_pagamento: [{ forma_pagamento: doc.condicao?.forma_pagamento || (aPrazo ? "15" : "01"), valor_pagamento: total }],
    ...(doc.observacoes ? { informacoes_adicionais_contribuinte: doc.observacoes.slice(0, 2000) } : {}),
    items,
  };
}

/** JSON de NFS-e da Focus (layout nacional/genérico — Barueri usa o provedor
 *  BarueriWs; os campos específicos ficam a validar na 1ª emissão em homologação). */
export function montarNfse(doc: DocFat, em: Emitente, opts: { itemListaServico?: string | null; serie?: string }) {
  const c = doc.cliente;
  const total = totalItens(doc.itens);
  const discriminacao = doc.itens.map((i) => i.descricao).join(" | ") + (doc.observacoes ? ` — ${doc.observacoes}` : "");
  return {
    data_emissao: new Date().toISOString(),
    ...(opts.serie ? { serie: opts.serie } : {}),
    prestador: { cnpj: so(em.cnpj), inscricao_municipal: em.inscricao_municipal, codigo_municipio: em.codigo_municipio },
    tomador: {
      ...(so(c.cnpj) ? { cnpj: so(c.cnpj) } : { cpf: so(c.cpf) }),
      razao_social: c.nome,
      ...(c.email ? { email: c.email } : {}),
      endereco: {
        logradouro: c.logradouro, numero: c.numero, complemento: c.complemento || undefined, bairro: c.bairro,
        codigo_municipio: c.codigo_municipio || undefined, uf: c.uf.toUpperCase(), cep: so(c.cep),
      },
    },
    servico: {
      valor_servicos: total,
      discriminacao: discriminacao.slice(0, 2000),
      iss_retido: false,
      ...(opts.itemListaServico ? { item_lista_servico: opts.itemListaServico } : {}),
    },
  };
}

const brl = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** Recibo de Prestação de Serviço — réplica do modelo do Omie
 *  (docs/modelos/recibo-prestacao-servico.html). HTML pronto para imprimir/PDF. */
export function reciboHtml(doc: DocFat, em: Emitente, numero: number, homologacao: boolean) {
  const c = doc.cliente;
  const total = totalItens(doc.itens);
  const ps = parcelas(total, doc.condicao);
  const n = String(numero).padStart(10, "0");
  const h = new Date(Date.now() - 3 * 3600_000);
  const data = `${h.getUTCDate()} de ${MESES[h.getUTCMonth()]} de ${h.getUTCFullYear()}`;
  const doc_cli = so(c.cnpj) ? `CNPJ: ${so(c.cnpj).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}` : `CPF: ${so(c.cpf)}`;
  const venc = ps.map((p) => `dia ${p.vencimento.split("-").reverse().join("/")} no valor de R$ ${brl(p.valor)}`).join("<br>");
  const itens = doc.itens.map((i) => `<div class="obj-item"><div class="desc"><p>${esc(i.descricao)}</p></div><div class="v">${brl(i.quantidade * i.valor_unitario)}</div></div>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Recibo de Prestação de Serviço nº ${n}</title>
<style>@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff}body{font-family:Helvetica,Arial,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.folha{width:210mm;min-height:297mm;position:relative;margin:0 auto;padding:6mm 10mm}.topo{display:flex;justify-content:space-between;align-items:flex-start}
.emp{text-align:right;font-size:8pt;line-height:1.5}.emp b{font-size:12pt}.titulo{text-align:center;font-size:15pt;font-weight:bold;margin:8mm 0 6mm}
.linha{display:grid;grid-template-columns:40mm 1fr;column-gap:1mm;margin-top:3mm}.rot{background:#00BFB7;color:#fff;font-weight:bold;font-size:10pt;text-align:right;height:6mm;line-height:6mm;padding-right:1mm}
.val{font-size:10pt;line-height:6mm}.cli{font-size:8pt;line-height:1.4}.cli b{font-size:10pt}.obj-cab{display:grid;grid-template-columns:1fr 30mm;font-size:8pt;font-weight:bold}
.obj-cab span{background:#E5F8F7;line-height:6mm;padding:0 1mm}.obj-cab span+span{text-align:right}.obj-item{display:grid;grid-template-columns:1fr 30mm;font-size:8pt;line-height:4mm;margin-top:2mm}
.obj-item p{margin:0;padding:0 1mm}.obj-item .v{text-align:right;padding-right:1mm}.totais{display:grid;grid-template-columns:21mm 20mm 30mm;margin:2mm 0 0 auto;width:71mm;font-size:8pt}
.totais .h{background:#E5F8F7;font-weight:bold;text-align:right;line-height:5mm;padding-right:1mm}.totais .n{text-align:right;line-height:5mm;padding-right:1mm}
.obs{font-size:7pt;line-height:3.5mm;padding:0 1mm}.homolog{border:2px solid #c00;color:#c00;font-weight:bold;text-align:center;padding:2mm;margin-bottom:4mm}</style></head>
<body><div class="folha">
${homologacao ? '<div class="homolog">DOCUMENTO DE TESTE (HOMOLOGAÇÃO) — SEM VALOR</div>' : ""}
<div class="topo"><div></div><div class="emp"><b>${esc(em.nome || "")}</b><br>CNPJ: ${esc(em.cnpj)}${em.inscricao_estadual ? ` | Inscrição Estadual: ${esc(em.inscricao_estadual)}` : ""}${em.inscricao_municipal ? ` | Inscrição Municipal: ${esc(em.inscricao_municipal)}` : ""}<br>${esc([em.logradouro, em.numero].filter(Boolean).join(", "))}${em.bairro ? ` - ${esc(em.bairro)}` : ""}<br>${esc(em.municipio || "")} - ${esc(em.uf || "")}${em.cep ? ` - CEP: ${esc(em.cep)}` : ""}${em.telefone ? `<br>Telefone: ${esc(em.telefone)}` : ""}</div></div>
<div class="titulo">Recibo de Prestação de Serviço nº ${n}</div>
<div class="linha"><div class="rot">Emissão:</div><div class="val">${esc(em.municipio || "Barueri")} (${esc(em.uf || "SP")}), ${data}.</div></div>
<div class="linha"><div class="rot">Cliente:</div><div class="cli"><b>${esc(c.nome)}</b><br>${doc_cli}${c.email ? `<br>${esc(c.email)}` : ""}<br>${esc([c.logradouro, c.numero, c.complemento].filter(Boolean).join(", "))} - ${esc(c.bairro)}<br>${esc(c.municipio)} - ${esc(c.uf)} - CEP: ${esc(so(c.cep))}${c.telefone ? `<br>Telefone: ${esc(c.telefone)}` : ""}</div></div>
<div class="linha"><div class="rot">Objeto:</div><div><div class="obj-cab"><span>Descrição</span><span>Valor Total</span></div>${itens}
<div class="totais"><div class="h">Total Bruto</div><div class="h">Descontos</div><div class="h">Total Líquido</div><div class="n">${brl(total)}</div><div class="n">0,00</div><div class="n">${brl(total)}</div></div></div></div>
<div class="linha"><div class="rot">Vencimento:</div><div class="val">${venc}</div></div>
<div class="linha"><div class="rot">Observações:</div><div class="obs">${doc.observacoes ? `${esc(doc.observacoes)}<br>` : ""}Conforme Lei Complementar 116/2003 de 31/07/03, que trata do VETO ao imposto sobre a prestação de serviço em Saneamento Ambiental, purificação e tratamento de água, esgotamento sanitário e Congêneres.</div></div>
</div></body></html>`;
}
