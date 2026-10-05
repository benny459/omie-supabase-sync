// Monta o documento do faturamento (P5) a partir de um PV/OS nativo (P1).
// Puro (sem dependências de servidor) — usado pela rota e pelo teste E2E.
import type { DocFat } from "./faturamento/montar";
import type { VendaDoc } from "./vendas";

/**
 * Monta o documento do faturamento (P5) a partir do PV/OS: cliente do cadastro
 * próprio (endereço, IE, e-mail de NF), itens e condição (parcelas do PV/OS).
 */
export function docFat(d: VendaDoc): DocFat {
  const c = (d.pessoa ?? {}) as Record<string, string | boolean | null>;
  const doc = String(c.doc ?? c.cnpj_cpf ?? d.cnpj ?? "").replace(/\D/g, "");
  const s = (v: unknown) => (v == null ? "" : String(v));
  return {
    empresa: d.empresa,
    cliente: {
      nome: s(c.razao_social || d.cliente_razao || d.cliente),
      cnpj: doc.length === 14 ? doc : null,
      cpf: doc.length === 11 ? doc : null,
      ie: s(c.inscricao_estadual).replace(/\D/g, "") || null,
      email: s(c.email_nfe || c.email) || null,
      logradouro: s(c.logradouro), numero: s(c.numero) || "S/N", complemento: s(c.complemento) || null,
      bairro: s(c.bairro), municipio: s(c.cidade || d.cidade).replace(/\s*\([A-Z]{2}\)\s*$/, ""),
      codigo_municipio: s(c.cidade_ibge) || null, uf: s(c.uf || d.uf || "SP"),
      cep: s(c.cep).replace(/\D/g, ""), telefone: s(c.telefone) || null,
    },
    itens: d.itens.map((i, k) => ({
      codigo: i.codigo || String(i.ncod_prod ?? "") || `${d.label}-${k + 1}`,
      descricao: i.descricao, quantidade: Number(i.quantidade), valor_unitario: Number(i.valor_unitario),
      unidade: i.unidade ?? "UN", ncm: i.ncm ?? null, cfop: i.cfop ?? null,
      servico_lc116: (i.fiscal?.lc116 as string | undefined) ?? null,
      codigo_tributario_municipio: (i.fiscal?.mun as string | undefined) ?? null,
    })),
    // Parcelas pela condição contam a partir da data da nota (dias); as fixadas
    // à mão (sem dias) vão com o vencimento gravado.
    condicao: {
      descricao: d.condicao ?? undefined,
      parcelas: d.parcelas.map((x) => x.dias != null
        ? { dias: x.dias, percentual: x.percentual ?? undefined }
        : { vencimento: x.vencimento, valor: Number(x.valor) }),
    },
    observacoes: [d.obs_nf, d.proposta ? `Proposta ${d.proposta}` : null, d.label].filter(Boolean).join(" · "),
    pedido_cliente: d.num_pedido_cliente,
  };
}
