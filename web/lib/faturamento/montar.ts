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
  /** "1" contribuinte, "2" isento, "9" não contribuinte. Sem isto: pela IE. */
  indicador_ie?: "1" | "2" | "9" | null;
};

export type TransporteFat = {
  /** 0 emitente (CIF), 1 destinatário (FOB), 2 terceiros, 3/4 próprio, 9 sem frete */
  modalidade: number;
  nome?: string | null;
  cnpj?: string | null;
  ie?: string | null;
  endereco?: string | null;
  municipio?: string | null;
  uf?: string | null;
  volumes?: { quantidade?: number | null; especie?: string | null; peso_bruto?: number | null; peso_liquido?: number | null }[];
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
  valor_desconto?: number | null;
  valor_frete?: number | null;   // frete rateado no item (o Omie rateia o frete do PV pelos itens)
  valor_outras?: number | null;  // outras despesas acessórias rateadas no item
  servico_lc116?: string | null;               // NFS-e: item da LC116 (ex.: 0703)
  codigo_tributario_municipio?: string | null; // NFS-e: código municipal do serviço
  /** Devolução (05/10/26): tributação espelhada da NF de origem. */
  icms_aliquota?: number | null;
  pis_cst?: string | null; pis_aliquota?: number | null;
  cofins_cst?: string | null; cofins_aliquota?: number | null;
  /** Texto do item (infAdProd), ex.: código do fornecedor na NF de origem. */
  info_item?: string | null;
  /** Só na tela: quantidade da NF de origem (a devolução não pode passar dela). */
  quantidade_max?: number | null;
  /** Devolução: nº do item na NF de origem (DFeReferenciado/nItem — NT 2025.002, obrigatório desde 01/09/2026). */
  ref_item?: number | null;
};

/** NF-e que não é venda (05/10/26) — modalidades que a SF emitia no Omie:
 *  devolução de compra (CFOP 5.202/6.202, finNFe 4, NF referenciada, CSOSN 900
 *  com o ICMS da nota de origem), simples remessa (5.949/6.949, "Outra Saida de
 *  Merc.…") e remessa para conserto (5.915/6.915). Sem cobrança (tPag 90). */
export type OperacaoTipo = "venda" | "devolucao" | "remessa" | "conserto";
export type OperacaoNfe = {
  tipo: OperacaoTipo;
  natureza?: string | null;
  nf_ref?: { chave: string; numero?: string | null; serie?: string | null; emitente_doc?: string | null; emissao?: string | null } | null;
  motivo?: string | null;
  projeto_codigo?: string | null; projeto_nome?: string | null; cliente_projeto?: string | null;
  /** Remessa com cobrança / devolução com crédito a receber do fornecedor. */
  gera_cobranca?: boolean;
};
export const NATUREZA_OP: Record<Exclude<OperacaoTipo, "venda">, string> = {
  devolucao: "Devolucao de Compra para Comercializacao",
  remessa: "Outra Saida de Merc.ou Prestacao de Servico nao Especificado",
  conserto: "Remessa de Mercadoria ou Bem para Conserto ou Reparo",
};
const CFOP_OP: Record<OperacaoTipo, [string, string]> = {
  venda: ["5102", "6102"], devolucao: ["5202", "6202"], remessa: ["5949", "6949"], conserto: ["5915", "6915"],
};
export const operacaoDe = (doc: { operacao?: OperacaoNfe | null }): OperacaoTipo => doc.operacao?.tipo ?? "venda";
/** Sem cobrança: não-venda sem a opção "gera cobrança". */
export const semCobranca = (doc: { operacao?: OperacaoNfe | null }) => operacaoDe(doc) !== "venda" && !doc.operacao?.gera_cobranca;

/** forma: tipo de documento do título a receber (BOL, PIX, TRF, CRT, DIN, CHQ, REC…). */
export type ParcelaCond = { dias?: number; vencimento?: string; percentual?: number; valor?: number; forma?: string | null };
/** Retenções da OS/NFS-e: o que o tomador retém sai do valor a receber. */
export type RetencoesFat = {
  iss_retido?: boolean; iss?: number | null; ir?: number | null; pis?: number | null;
  cofins?: number | null; csll?: number | null; inss?: number | null;
};
/** Seção "Recebimento" da Nova emissão (05/10/26): condição, parcelas, forma,
 *  conta, categoria, projeto, centro de custo, vendedor e retenções. As
 *  parcelas a receber são criadas exatamente daqui. */
export type CondicaoFat = {
  parcelas?: ParcelaCond[];
  /** tPag da NF-e (15 boleto, 17 PIX, 18 transferência, 03 crédito, 04 débito, 01 dinheiro, 02 cheque). */
  forma_pagamento?: string;
  descricao?: string;
  codigo?: string | null;              // código da condição (cadastros › condições)
  forma_recebimento?: string | null;   // tipo de documento padrão das parcelas (BOL, PIX…)
  conta_corrente?: number | null;      // cod_cc da conta de recebimento
  conta_nome?: string | null;
  categoria?: string | null;           // código da categoria de receita
  projeto?: string | null;             // código do projeto
  centro_custo?: string | null;
  vendedor?: string | null;
  contrato?: string | null;
  retencoes?: RetencoesFat | null;
  /** Instrução de pagamento (05/10/26): PIX/dados bancários da conta de recebimento —
   *  sai no documento (infCpl da NF-e, quadro do recibo) e em cada parcela a receber. */
  instrucao_pagamento?: string | null;
};

/** Soma das retenções que o tomador desconta do pagamento. */
export function totalRetencoes(r?: RetencoesFat | null) {
  if (!r) return 0;
  return r2((r.iss_retido ? r.iss ?? 0 : 0) + (r.ir ?? 0) + (r.pis ?? 0) + (r.cofins ?? 0) + (r.csll ?? 0) + (r.inss ?? 0));
}

export type DocFat = {
  empresa: string;
  cliente: ClienteFat;
  itens: ItemFat[];
  condicao?: CondicaoFat | null;
  observacoes?: string | null;
  pedido_cliente?: string | null;   // nº do pedido/OC do cliente
  /** PV marcado "consumidor final" (Omie: consumidor_final = S). */
  consumidor_final?: boolean | null;
  transporte?: TransporteFat | null;
  /** Texto do PV que o Omie põe em "Inf. Contribuinte" (ex.: "CONFORME OC N …"). */
  info_contribuinte?: string | null;
  /** Rótulo da origem para o receber/infCpl (PV1890). */
  rotulo?: string | null;
  /** NF-e de devolução / simples remessa / conserto (padrão: venda). */
  operacao?: OperacaoNfe | null;
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

/** O Omie grava entidades HTML (&quot; &apos; &amp;) e espaços duplos nos textos. */
export function limpo(s?: string | null) {
  return (s ?? "")
    .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

/** E-mail do destinatário na NF-e: até 60 caracteres (como o Omie). */
export function emailNfe(s?: string | null) {
  return (s ?? "").split(/[,;\s]+/).filter(Boolean).join(", ").slice(0, 60).replace(/[,\s]+$/, "");
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const hojeISO = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10); // America/Sao_Paulo

export function totalItens(itens: ItemFat[]) {
  return r2(itens.reduce((s, i) => s + r2(i.quantidade * i.valor_unitario), 0));
}

/** Valor da nota: produtos − descontos + frete + outras despesas (rateados nos itens). */
export function totalDoc(itens: ItemFat[]) {
  return r2(totalItens(itens) - itens.reduce((s, i) => s + (i.valor_desconto ?? 0), 0) + itens.reduce((s, i) => s + (i.valor_frete ?? 0), 0)
    + itens.reduce((s, i) => s + (i.valor_outras ?? 0), 0));
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
    return { numero: String(i + 1).padStart(3, "0"), vencimento: venc, valor, forma: p.forma ?? cond?.forma_recebimento ?? null };
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
  const op = operacaoDe(doc);
  if (op === "devolucao") {
    if (so(doc.operacao?.nf_ref?.chave).length !== 44) return "Devolução: informe a chave (44 dígitos) da NF de origem";
    if ((doc.operacao?.motivo ?? "").trim().length < 5) return "Devolução: informe o motivo";
    for (const i of doc.itens) if (i.quantidade_max != null && i.quantidade > i.quantidade_max + 1e-9) return `Devolução: ${i.descricao} passa da quantidade da NF de origem (${i.quantidade_max})`;
  }
  if (op === "remessa" || op === "conserto") {
    if (!doc.operacao?.projeto_codigo) return "Remessa: escolha o projeto";
    if ((doc.operacao?.motivo ?? "").trim().length < 3) return "Remessa: informe o motivo";
  }
  for (const i of doc.itens) {
    if (!i.descricao || !(i.quantidade > 0) || !(i.valor_unitario >= 0)) return `Item inválido: ${i.descricao || i.codigo}`;
  }
  return null;
}

const fmtDoc = (d: string) => {
  const x = so(d);
  return x.length === 14 ? x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5") : x;
};
/** "2026-08-12" ou "12/08/2026" → "08/2026" (como o Omie escreve a NF referenciada). */
const mesAno = (d: string) => {
  const m = d.match(/^(\d{4})-(\d{2})/); if (m) return `${m[2]}/${m[1]}`;
  const b = d.match(/^\d{2}\/(\d{2})\/(\d{4})/); return b ? `${b[1]}/${b[2]}` : d;
};
/** Devolução de compra (Simples Nacional): CSOSN 900 com o ICMS destacado pela
 *  alíquota da NF de origem — igual à NF 2131 emitida pelo Omie. */
function icmsDevolucao(base: number, aliq?: number | null) {
  const b = r2(Math.max(0, base));
  const a = Number(aliq ?? 0);
  return {
    icms_situacao_tributaria: "900",
    icms_modalidade_base_calculo: 3,
    icms_base_calculo: a ? b : 0,
    icms_aliquota: a,
    icms_valor: a ? r2((b * a) / 100) : 0,
    icms_aliquota_credito_simples: 0,
    icms_valor_credito_simples: 0,
  };
}
/** PIS/COFINS: venda e remessa 49 zerado; devolução espelha a NF de origem quando conhecida. */
function pisCofins(orig: ItemFat | null, base: number) {
  const b = r2(Math.max(0, base));
  const um = (cst?: string | null, aliq?: number | null) => {
    const c = (cst ?? "").padStart(2, "0");
    const tributado = ["01", "02"].includes(c) && Number(aliq ?? 0) > 0;
    return tributado ? { cst: c, base: b, aliq: Number(aliq), valor: r2((b * Number(aliq)) / 100) } : { cst: "49", base: 0, aliq: 0, valor: 0 };
  };
  const p = um(orig?.pis_cst, orig?.pis_aliquota), c = um(orig?.cofins_cst, orig?.cofins_aliquota);
  return {
    pis_situacao_tributaria: p.cst, pis_base_calculo: p.base, pis_aliquota_porcentual: p.aliq, pis_valor: p.valor,
    cofins_situacao_tributaria: c.cst, cofins_base_calculo: c.base, cofins_aliquota_porcentual: c.aliq, cofins_valor: c.valor,
  };
}
const infoItem = (i: ItemFat, cest: string) => [
  i.info_item ? limpo(i.info_item) : null,
  cest ? `CEST: ${cest.replace(/^(\d{2})(\d{3})(\d{2})$/, "$1.$2.$3")}` : null,
].filter(Boolean).join("; ");

/** JSON de emissão de NF-e da Focus (v2) — espelha a NF-e mercantil que o Omie
 *  emitia para a SF (comparada campo a campo com os XMLs 2185–2192, 05/10/26):
 *  CRT 1, CSOSN 102, PIS/COFINS 49 zerados, CFOP 5102/6102, cEAN "SEM GTIN",
 *  CEST + "CEST: xx.xxx.xx" no item, transporte do PV, cobrança com fatura =
 *  nº da NF e duplicata 001, pagamento boleto (15) a prazo, e o mesmo texto de
 *  informações complementares. */
export function montarNfe(doc: DocFat, em: Emitente, opts: { natureza: string; serie?: string; numero?: number | null; infoPadrao?: string | null }) {
  const c = doc.cliente;
  const op = operacaoDe(doc);
  const devol = op === "devolucao";
  const semCob = semCobranca(doc);
  const mesmaUF = (em.uf || "SP").toUpperCase() === c.uf.toUpperCase();
  const ieDig = so(c.ie);
  const indIE = c.indicador_ie ?? (ieDig ? "1" : /isent/i.test(c.ie ?? "") ? "2" : "9");
  const desconto = r2(doc.itens.reduce((s, i) => s + (i.valor_desconto ?? 0), 0));
  const frete = r2(doc.itens.reduce((s, i) => s + (i.valor_frete ?? 0), 0));
  const outras = r2(doc.itens.reduce((s, i) => s + (i.valor_outras ?? 0), 0));
  const total = r2(totalItens(doc.itens) - desconto + frete + outras);
  const ps = parcelas(total, doc.condicao);
  const aPrazo = ps.length > 1 || ps.some((p) => p.vencimento > hojeISO());
  // Devolução: o Omie marcava consumidor final (indFinal 1), como na NF 2131.
  const consumidorFinal = doc.consumidor_final ?? (devol ? true : indIE !== "1");
  const agora = new Date().toISOString();
  const email = emailNfe(c.email);

  const items = doc.itens.map((i, n) => {
    const bruto = r2(i.quantidade * i.valor_unitario);
    const un = (i.unidade || "UN").toUpperCase();
    const cest = so(i.cest);
    return {
      numero_item: n + 1,
      codigo_produto: i.codigo,
      descricao: limpo(i.descricao).slice(0, 120),
      codigo_barras_comercial: "SEM GTIN",
      codigo_barras_tributavel: "SEM GTIN",
      codigo_barras_proprio_comercial: String(i.codigo).slice(0, 30), // cBarra = cProd, como o Omie
      cfop: i.cfop || CFOP_OP[op][mesmaUF ? 0 : 1],
      codigo_ncm: so(i.ncm) || "00000000",
      ...(cest ? { cest } : {}),
      unidade_comercial: un,
      quantidade_comercial: i.quantidade,
      valor_unitario_comercial: i.valor_unitario,
      valor_bruto: bruto,
      ...(i.valor_desconto ? { valor_desconto: r2(i.valor_desconto) } : {}),
      ...(i.valor_frete ? { valor_frete: r2(i.valor_frete) } : {}),
      ...(i.valor_outras ? { valor_outras_despesas: r2(i.valor_outras) } : {}),
      unidade_tributavel: un,
      quantidade_tributavel: i.quantidade,
      valor_unitario_tributavel: i.valor_unitario,
      inclui_no_total: 1,
      icms_origem: i.origem ?? 0,
      ...(devol ? icmsDevolucao(bruto - (i.valor_desconto ?? 0), i.icms_aliquota) : { icms_situacao_tributaria: "102" }),
      ...pisCofins(devol ? i : null, bruto - (i.valor_desconto ?? 0)),
      ...(infoItem(i, cest) ? { informacoes_adicionais_item: infoItem(i, cest) } : {}),
      // Devolução: documento referenciado POR ITEM (rejeição 321 sem isto, desde 01/09/2026).
      ...(devol && doc.operacao?.nf_ref?.chave ? {
        chave_acesso_dfe_referenciado: so(doc.operacao.nf_ref.chave),
        numero_item_dfe_referenciado: String(i.ref_item ?? n + 1),
      } : {}),
    };
  });
  const icmsBase = devol ? r2(items.reduce((a, it) => a + Number((it as { icms_base_calculo?: number }).icms_base_calculo ?? 0), 0)) : 0;
  const icmsValor = devol ? r2(items.reduce((a, it) => a + Number((it as { icms_valor?: number }).icms_valor ?? 0), 0)) : 0;

  // Informações complementares no formato do Omie.
  const o = doc.operacao;
  const ref = o?.nf_ref;
  const inf = [
    devol && ref?.chave ? `NF-e Ref.: serie:${ref.serie ?? "?"} numero:${ref.numero ?? "?"}${ref.emitente_doc ? ` emit:${fmtDoc(ref.emitente_doc)}` : ""}${ref.emissao ? ` em ${mesAno(ref.emissao)}` : ""} [${so(ref.chave)}]` : null,
    email ? `Email do Destinatario: ${email.split(", ")[0]}` : null,
    doc.info_contribuinte ? `Inf. Contribuinte: ${limpo(doc.info_contribuinte)}` : null,
    opts.infoPadrao || null,
    consumidorFinal ? "Produto destinado a Consumidor Final." : null,
    doc.observacoes ? limpo(doc.observacoes) : null,
    doc.condicao?.instrucao_pagamento && !semCob ? limpo(doc.condicao.instrucao_pagamento) : null,
    (op === "remessa" || op === "conserto") ? [
      o?.projeto_codigo || o?.projeto_nome ? `Projeto: ${limpo([o?.projeto_nome, o?.projeto_codigo && !String(o?.projeto_nome ?? "").includes(String(o.projeto_codigo)) ? `(${o.projeto_codigo})` : null].filter(Boolean).join(" "))}` : null,
      o?.cliente_projeto ? `Cliente: ${limpo(o.cliente_projeto)}` : null,
      o?.motivo ? `Motivo: ${limpo(o.motivo)}` : null,
    ].filter(Boolean).join(" - ") || null : null,
    devol ? `Motivo da Devolucao: ${limpo(o?.motivo) || "Nao foi informado"}` : null,
  ].filter(Boolean).map((t) => `${t};`).join(" ");

  const t = doc.transporte;
  const modFrete = t?.modalidade ?? 9;

  return {
    natureza_operacao: op === "venda" ? opts.natureza : (o?.natureza || NATUREZA_OP[op]),
    ...(opts.serie ? { serie: opts.serie } : {}),
    ...(opts.numero ? { numero: opts.numero } : {}),
    data_emissao: agora,
    data_entrada_saida: agora,
    tipo_documento: 1,
    local_destino: mesmaUF ? 1 : 2,
    finalidade_emissao: devol ? 4 : 1,
    // A NF de origem vai POR ITEM (DFeReferenciado): a SEFAZ rejeita referência no cabeçalho e no item ao mesmo tempo.
    consumidor_final: consumidorFinal ? 1 : 0,
    presenca_comprador: 9,
    cnpj_emitente: so(em.cnpj),
    nome_destinatario: limpo(c.nome).slice(0, 60),
    ...(so(c.cnpj) ? { cnpj_destinatario: so(c.cnpj) } : { cpf_destinatario: so(c.cpf) }),
    indicador_inscricao_estadual_destinatario: Number(indIE),
    ...(indIE === "1" ? { inscricao_estadual_destinatario: ieDig } : {}),
    ...(email ? { email_destinatario: email } : {}),
    logradouro_destinatario: limpo(c.logradouro),
    numero_destinatario: limpo(c.numero) || "S/N",
    ...(c.complemento ? { complemento_destinatario: limpo(c.complemento).slice(0, 60) } : {}),
    bairro_destinatario: limpo(c.bairro),
    ...(c.codigo_municipio ? { codigo_municipio_destinatario: c.codigo_municipio } : {}),
    municipio_destinatario: limpo(c.municipio),
    uf_destinatario: c.uf.toUpperCase(),
    cep_destinatario: so(c.cep),
    ...(c.telefone ? { telefone_destinatario: so(c.telefone).slice(-11) } : {}),
    modalidade_frete: modFrete,
    ...(t && modFrete !== 9 && t.nome ? {
      nome_transportador: limpo(t.nome).slice(0, 60),
      ...(so(t.cnpj).length === 14 ? { cnpj_transportador: so(t.cnpj) } : so(t.cnpj).length === 11 ? { cpf_transportador: so(t.cnpj) } : {}),
      ...(so(t.ie) ? { inscricao_estadual_transportador: so(t.ie) } : {}),
      ...(t.endereco ? { endereco_transportador: limpo(t.endereco).slice(0, 60) } : {}),
      ...(t.municipio ? { municipio_transportador: limpo(t.municipio) } : {}),
      ...(t.uf ? { uf_transportador: t.uf.toUpperCase() } : {}),
    } : {}),
    ...(t?.volumes?.length ? {
      volumes: t.volumes.map((v) => ({
        ...(v.quantidade ? { quantidade: v.quantidade } : {}), ...(v.especie ? { especie: v.especie } : {}),
        ...(v.peso_bruto ? { peso_bruto: v.peso_bruto } : {}), ...(v.peso_liquido ? { peso_liquido: v.peso_liquido } : {}),
      })),
    } : {}),
    valor_produtos: totalItens(doc.itens),
    ...(desconto ? { valor_desconto: desconto } : {}),
    ...(frete ? { valor_frete: frete } : {}),
    ...(outras ? { valor_outras_despesas: outras } : {}),
    valor_total: total,
    ...(devol ? { icms_base_calculo: icmsBase, icms_valor_total: icmsValor } : {}),
    // Venda: cobrança sempre, como o Omie (fatura = nº da NF, duplicatas 001…).
    // Remessa/devolução sem cobrança: sem fatura e pagamento "90 — sem pagamento".
    ...(semCob ? {
      formas_pagamento: [{ forma_pagamento: "90", valor_pagamento: 0 }],
    } : {
      numero_fatura: String(opts.numero ?? "1"),
      valor_original_fatura: total,
      valor_desconto_fatura: 0,
      valor_liquido_fatura: total,
      duplicatas: ps.map((p) => ({ numero: p.numero, data_vencimento: p.vencimento, valor: p.valor })),
      formas_pagamento: [{
        indicador_pagamento: aPrazo ? 1 : 0,
        forma_pagamento: doc.condicao?.forma_pagamento || (aPrazo ? "15" : "01"),
        valor_pagamento: total,
      }],
    }),
    ...(inf ? { informacoes_adicionais_contribuinte: inf.slice(0, 2000) } : {}),
    items,
  };
}

/** JSON de NFS-e da Focus (layout nacional/genérico — Barueri usa o provedor
 *  BarueriWs; os campos específicos ficam a validar na 1ª emissão em homologação). */
export function montarNfse(doc: DocFat, em: Emitente, opts: {
  itemListaServico?: string | null; codigoTributario?: string | null; aliquota?: number | null; serie?: string;
}) {
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
      iss_retido: !!doc.condicao?.retencoes?.iss_retido,
      ...(doc.condicao?.retencoes?.iss ? { valor_iss: r2(doc.condicao.retencoes.iss) } : {}),
      ...(doc.condicao?.retencoes?.ir ? { valor_ir: r2(doc.condicao.retencoes.ir) } : {}),
      ...(doc.condicao?.retencoes?.pis ? { valor_pis: r2(doc.condicao.retencoes.pis) } : {}),
      ...(doc.condicao?.retencoes?.cofins ? { valor_cofins: r2(doc.condicao.retencoes.cofins) } : {}),
      ...(doc.condicao?.retencoes?.csll ? { valor_csll: r2(doc.condicao.retencoes.csll) } : {}),
      ...(doc.condicao?.retencoes?.inss ? { valor_inss: r2(doc.condicao.retencoes.inss) } : {}),
      ...((doc.itens[0]?.servico_lc116 || opts.itemListaServico) ? { item_lista_servico: doc.itens[0]?.servico_lc116 || opts.itemListaServico } : {}),
      ...((doc.itens[0]?.codigo_tributario_municipio || opts.codigoTributario) ? { codigo_tributario_municipio: doc.itens[0]?.codigo_tributario_municipio || opts.codigoTributario } : {}),
      ...(opts.aliquota != null ? { aliquota: opts.aliquota } : {}),
    },
  };
}

const brl = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

/** Recibo de Prestação de Serviço — réplica do modelo do Omie
 *  (docs/modelos/recibo-prestacao-servico.html). HTML pronto para imprimir/PDF. */
export function reciboHtml(doc: DocFat, em: Emitente, numero: number, homologacao: boolean, dataEmissao?: string | null) {
  const c = doc.cliente;
  const total = totalItens(doc.itens);
  const ps = parcelas(total, doc.condicao);
  const n = String(numero).padStart(10, "0");
  // Data do recibo: a da emissão (2ª via de recibo já emitido) ou hoje.
  const h = dataEmissao && /^\d{4}-\d{2}-\d{2}/.test(dataEmissao) ? new Date(`${dataEmissao.slice(0, 10)}T12:00:00Z`) : new Date(Date.now() - 3 * 3600_000);
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
.pag{font-size:9pt;line-height:4.5mm;border:1px solid #00BFB7;padding:1.5mm 2mm;border-radius:1mm}.obs{font-size:7pt;line-height:3.5mm;padding:0 1mm}.homolog{border:2px solid #c00;color:#c00;font-weight:bold;text-align:center;padding:2mm;margin-bottom:4mm}</style></head>
<body><div class="folha">
${homologacao ? '<div class="homolog">DOCUMENTO DE TESTE (HOMOLOGAÇÃO) — SEM VALOR</div>' : ""}
<div class="topo"><div></div><div class="emp"><b>${esc(em.nome || "")}</b><br>CNPJ: ${esc(em.cnpj)}${em.inscricao_estadual ? ` | Inscrição Estadual: ${esc(em.inscricao_estadual)}` : ""}${em.inscricao_municipal ? ` | Inscrição Municipal: ${esc(em.inscricao_municipal)}` : ""}<br>${esc([em.logradouro, em.numero].filter(Boolean).join(", "))}${em.bairro ? ` - ${esc(em.bairro)}` : ""}<br>${esc(em.municipio || "")} - ${esc(em.uf || "")}${em.cep ? ` - CEP: ${esc(em.cep)}` : ""}${em.telefone ? `<br>Telefone: ${esc(em.telefone)}` : ""}</div></div>
<div class="titulo">Recibo de Prestação de Serviço nº ${n}</div>
<div class="linha"><div class="rot">Emissão:</div><div class="val">${esc(em.municipio || "Barueri")} (${esc(em.uf || "SP")}), ${data}.</div></div>
<div class="linha"><div class="rot">Cliente:</div><div class="cli"><b>${esc(c.nome)}</b><br>${doc_cli}${c.email ? `<br>${esc(c.email)}` : ""}<br>${esc([c.logradouro, c.numero, c.complemento].filter(Boolean).join(", "))} - ${esc(c.bairro)}<br>${esc(c.municipio)} - ${esc(c.uf)} - CEP: ${esc(so(c.cep))}${c.telefone ? `<br>Telefone: ${esc(c.telefone)}` : ""}</div></div>
<div class="linha"><div class="rot">Objeto:</div><div><div class="obj-cab"><span>Descrição</span><span>Valor Total</span></div>${itens}
<div class="totais"><div class="h">Total Bruto</div><div class="h">Descontos</div><div class="h">Total Líquido</div><div class="n">${brl(total)}</div><div class="n">0,00</div><div class="n">${brl(total)}</div></div></div></div>
<div class="linha"><div class="rot">Vencimento:</div><div class="val">${venc}</div></div>
${doc.condicao?.instrucao_pagamento ? `<div class="linha"><div class="rot">Pagamento:</div><div class="pag">${esc(doc.condicao.instrucao_pagamento).replace(/ \| /g, "<br>")}</div></div>` : ""}
<div class="linha"><div class="rot">Observações:</div><div class="obs">${doc.observacoes ? `${esc(doc.observacoes)}<br>` : ""}Conforme Lei Complementar 116/2003 de 31/07/03, que trata do VETO ao imposto sobre a prestação de serviço em Saneamento Ambiental, purificação e tratamento de água, esgotamento sanitário e Congêneres.</div></div>
</div></body></html>`;
}
