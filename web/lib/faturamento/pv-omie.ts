// Documento de faturamento a partir de um PV do Omie (espelho sales.*), para a
// SF faturar pela Focus os PVs que nasceram no Omie (05/10/2026). Puro: recebe
// o JSON de orders.fat_pv_omie_doc e devolve o DocFat do motor (montar.ts).
import { limpo, totalDoc, type DocFat } from "./montar";

type J = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
const so = (v: unknown) => s(v).replace(/\D/g, "");

export type PvOmieDoc = {
  pv: J; cliente: J | null; cliente_omie: J | null; transportadora: J | null;
  itens: J[]; condicao: string | null; parcelas_dias: number[] | null;
  nf_omie: { numero: string; serie: string; emissao: string; chave: string } | null;
  emissao_painel: { id: number; status: string; numero: string | null } | null;
};

/** Município sem o "(SP)" que o cadastro do Omie acrescenta. */
const cidade = (v: unknown) => limpo(s(v)).replace(/\s*\([A-Z]{2}\)\s*$/, "");

export function docFatPvOmie(empresa: string, d: PvOmieDoc): DocFat {
  const pv = d.pv;
  // Cadastro próprio (P2) primeiro; o espelho do Omie cobre o que faltar.
  const c = d.cliente ?? {};
  const o = d.cliente_omie ?? {};
  const doc = so(c.cnpj_cpf ?? c.doc ?? o.cnpj_cpf);
  const ie = s(c.inscricao_estadual ?? o.inscricao_estadual);
  const contrib = s(c.contribuinte ?? o.contribuinte).toUpperCase();
  const indicador_ie: "1" | "2" | "9" =
    /isent/i.test(ie) ? "2" : so(ie) && contrib !== "N" ? "1" : "9";
  const t = d.transportadora;
  const modal = s(pv.modalidade);
  const vol = n(pv.volumes);
  return {
    empresa,
    rotulo: `PV${s(pv.numero_pedido)}`,
    cliente: {
      nome: limpo(s(c.razao_social ?? o.razao_social)),
      cnpj: doc.length === 14 ? doc : null,
      cpf: doc.length === 11 ? doc : null,
      ie: indicador_ie === "1" ? so(ie) : indicador_ie === "2" ? "ISENTO" : null,
      indicador_ie,
      email: s(c.email_nfe || c.email || o.email) || null,
      logradouro: limpo(s(c.logradouro ?? o.endereco)),
      numero: limpo(s(c.numero ?? o.endereco_numero)) || "S/N",
      complemento: limpo(s(c.complemento ?? o.complemento)) || null,
      bairro: limpo(s(c.bairro ?? o.bairro)),
      municipio: cidade(c.cidade ?? o.cidade),
      codigo_municipio: s(c.cidade_ibge ?? o.cidade_ibge) || null,
      uf: s(c.uf ?? o.estado).toUpperCase() || s(c.cidade ?? o.cidade).match(/\(([A-Z]{2})\)/)?.[1] || "SP",
      cep: so(c.cep ?? o.cep),
      telefone: so(c.telefone) || (o.telefone1_numero ? `${so(o.telefone1_ddd)}${so(o.telefone1_numero)}` : null),
    },
    itens: d.itens.map((i, k) => ({
      codigo: s(i.codigo) || `${s(pv.numero_pedido)}-${k + 1}`,
      descricao: limpo(s(i.descricao)),
      quantidade: n(i.quantidade),
      valor_unitario: n(i.valor_unitario),
      valor_desconto: n(i.valor_desconto) || null,
      // O total do item no Omie inclui o frete rateado: total − qtd×unit + desconto.
      valor_frete: (() => { const f = Math.round((n(i.valor_total) - n(i.quantidade) * n(i.valor_unitario) + n(i.valor_desconto)) * 100) / 100; return f > 0.004 ? f : null; })(),
      unidade: s(i.unidade) || "UN",
      ncm: s(i.ncm) || null,
      cest: s(i.cest) || null,
      origem: i.origem == null ? 0 : n(i.origem),
    })),
    condicao: {
      descricao: d.condicao ?? undefined,
      // Códigos do PV do Omie (05/10/26): a folha de emissão já abre com a
      // condição, categoria, projeto, vendedor e conta do pedido.
      codigo: s(pv.codigo_parcela) || null,
      categoria: s(pv.codigo_categoria) || null,
      projeto: s(pv.codigo_projeto) || null,
      vendedor: s(pv.codigo_vendedor) || null,
      conta_corrente: /^\d+$/.test(s(pv.codigo_conta)) ? Number(s(pv.codigo_conta)) : null,
      parcelas: (d.parcelas_dias?.length ? d.parcelas_dias : [0]).map((dias) => ({ dias })),
    },
    consumidor_final: s(pv.consumidor_final).toUpperCase() === "S" ? true : indicador_ie !== "1",
    info_contribuinte: limpo(s(pv.dados_adicionais_nf)) || null,
    pedido_cliente: s(pv.num_pedido_cliente) || null,
    transporte: modal === "" ? null : {
      modalidade: Number(modal),
      nome: t ? limpo(s(t.razao_social)) : null,
      cnpj: t ? so(t.cnpj_cpf ?? t.doc) || null : null,
      ie: t ? so(t.inscricao_estadual) || null : null,
      endereco: t && t.logradouro ? limpo(`${s(t.logradouro)}${t.numero ? `, ${s(t.numero)}` : ""}`) : null,
      municipio: t ? cidade(t.cidade) || null : null,
      uf: t ? s(t.uf) || s(t.cidade).match(/\(([A-Z]{2})\)/)?.[1] || null : null,
      volumes: vol ? [{ quantidade: vol, peso_bruto: n(pv.peso_bruto) || null, peso_liquido: n(pv.peso_liquido) || null }] : [],
    },
  };
}

/** Checagens do pré-voo (sem enviar nada). */
export type Checagem = { item: string; ok: boolean; nivel: "erro" | "aviso"; detalhe: string };

export function checarDoc(doc: DocFat, extra: { nf_omie?: PvOmieDoc["nf_omie"]; emissao_painel?: PvOmieDoc["emissao_painel"]; etapa?: string | null; total_pv?: number | null }): Checagem[] {
  const c = doc.cliente;
  const out: Checagem[] = [];
  const add = (item: string, ok: boolean, detalhe: string, nivel: "erro" | "aviso" = "erro") => out.push({ item, ok, nivel, detalhe });
  add("Sem NF no Omie para este PV", !extra.nf_omie, extra.nf_omie ? `Omie já emitiu a NF-e ${Number(extra.nf_omie.numero)} em ${extra.nf_omie.emissao}` : "ok");
  add("Sem NF do painel para este PV", !extra.emissao_painel, extra.emissao_painel ? `Emissão #${extra.emissao_painel.id} ${extra.emissao_painel.status}` : "ok");
  if (extra.etapa != null) add("Etapa do PV (10/20/50)", ["10", "20", "50"].includes(String(extra.etapa)), `etapa ${extra.etapa}`, "aviso");
  add("Cliente: CNPJ/CPF", !!(so(c.cnpj) || so(c.cpf)), so(c.cnpj) || so(c.cpf) || "faltando");
  add("Cliente: endereço", !!(c.logradouro && c.bairro && c.municipio), [c.logradouro, c.numero, c.bairro, c.municipio].filter(Boolean).join(", ") || "faltando");
  add("Cliente: CEP (8 dígitos)", so(c.cep).length === 8, so(c.cep) || "faltando");
  add("Cliente: município IBGE (7 dígitos)", so(c.codigo_municipio).length === 7, so(c.codigo_municipio) || "faltando");
  add("Cliente: UF", /^[A-Z]{2}$/.test(c.uf), c.uf || "faltando");
  add("Cliente: IE coerente", c.indicador_ie !== "1" || so(c.ie).length >= 8, c.indicador_ie === "1" ? `contribuinte, IE ${c.ie}` : c.indicador_ie === "2" ? "isento" : "não contribuinte", "aviso");
  add("Cliente: e-mail para a NF", !!c.email, c.email || "sem e-mail (a NF não vai por e-mail)", "aviso");
  add("Itens", doc.itens.length > 0, `${doc.itens.length} item(ns)`);
  if (extra.total_pv != null) {
    const t = totalDoc(doc.itens);
    add("Total da nota = total do PV", Math.abs(t - Number(extra.total_pv)) < 0.02, `nota ${t.toFixed(2)} · PV ${Number(extra.total_pv).toFixed(2)}`);
  }
  for (const i of doc.itens) {
    add(`NCM — ${i.codigo}`, (i.ncm ?? "").replace(/\D/g, "").length === 8, i.ncm || "sem NCM");
    if (!(i.quantidade > 0 && i.valor_unitario > 0)) add(`Qtd/valor — ${i.codigo}`, false, `${i.quantidade} × ${i.valor_unitario}`);
  }
  return out;
}
