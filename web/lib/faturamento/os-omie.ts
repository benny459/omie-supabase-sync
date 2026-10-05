// Documento de faturamento a partir de uma OS do Omie (espelho sales.ordens_servico),
// para a SF emitir o RECIBO pelo painel (05/10/2026 — não se fatura mais no Omie).
// Puro: recebe o JSON de orders.fat_os_omie_doc e devolve o DocFat do motor.
import { limpo, type DocFat } from "./montar";

type J = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
const so = (v: unknown) => s(v).replace(/\D/g, "");
const cidade = (v: unknown) => limpo(s(v)).replace(/\s*\([A-Z]{2}\)\s*$/, "");

export type OsOmieDoc = {
  os: J; itens: J[]; cliente: J | null; cliente_omie: J | null;
  conta_texto: number | null; condicao: string | null; parcelas_dias: number[] | null;
  nfse_registrada: boolean;
  emissao_painel: { id: number; status: string; numero: string | null; tipo: string } | null;
};

export function docFatOsOmie(empresa: string, d: OsOmieDoc): DocFat {
  const os = d.os;
  const c = d.cliente ?? {};
  const o = d.cliente_omie ?? {};
  const doc = so(c.cnpj_cpf ?? c.doc ?? o.cnpj_cpf);
  const ie = s(c.inscricao_estadual ?? o.inscricao_estadual);
  const issRet = os.retem_iss === true;
  const contaCc = /^\d+$/.test(s(os.codigo_cc)) ? Number(s(os.codigo_cc)) : null;
  return {
    empresa,
    rotulo: `OS${s(os.numero_os)}`,
    cliente: {
      nome: limpo(s(c.razao_social ?? o.razao_social)),
      cnpj: doc.length === 14 ? doc : null,
      cpf: doc.length === 11 ? doc : null,
      ie: so(ie) || null,
      email: s(c.email_nfe || c.email || o.email) || null,
      logradouro: limpo(s(c.logradouro ?? o.endereco)),
      numero: limpo(s(c.numero ?? o.endereco_numero)) || "S/N",
      complemento: limpo(s(c.complemento ?? o.complemento)) || null,
      bairro: limpo(s(c.bairro ?? o.bairro)),
      municipio: cidade(c.cidade ?? o.cidade),
      codigo_municipio: s(c.cidade_ibge ?? o.cidade_ibge) || null,
      uf: s(c.uf ?? o.estado).toUpperCase() || s(c.cidade ?? o.cidade).match(/\(([A-Z]{2})\)/)?.[1] || "SP",
      cep: so(c.cep ?? o.cep),
      telefone: so(c.telefone) || null,
    },
    itens: d.itens.map((i, k) => ({
      codigo: s(i.codigo) || `OS${s(os.numero_os)}-${k + 1}`,
      // O Omie separa linhas da descrição com "||" (ex.: "…, SW||CONFORME OC N 001317").
      descricao: limpo(s(i.descricao).replace(/\|\|/g, " · ")),
      quantidade: n(i.quantidade) || 1,
      valor_unitario: n(i.valor_unitario) || n(i.valor_total),
      unidade: "UN",
    })),
    condicao: {
      descricao: d.condicao ?? undefined,
      codigo: s(os.codigo_parcela) || null,
      categoria: s(os.codigo_categoria) || null,
      projeto: s(os.codigo_projeto) || null,
      vendedor: s(os.codigo_vendedor) || null,
      contrato: s(os.numero_contrato) || null,
      // Conta: a do texto "DADOS BANCÁRIOS" da OS vence a conta gravada no Omie.
      conta_corrente: d.conta_texto ?? contaCc,
      parcelas: (d.parcelas_dias?.length ? d.parcelas_dias : [0]).map((dias) => ({ dias })),
      retencoes: issRet || n(os.valor_inss) > 0
        ? { iss_retido: issRet, iss: issRet ? n(os.valor_iss) : null, inss: os.retem_inss === true ? n(os.valor_inss) : null }
        : null,
    },
    observacoes: `OS${s(os.numero_os)}`,
  };
}
