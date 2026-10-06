// Monta o documento do faturamento (P5) a partir de um PV/OS nativo (P1).
// Puro (sem dependências de servidor) — usado pela rota e pelo teste E2E.
import type { DocFat } from "./faturamento/montar";
import type { VendaDoc, VendaParcela } from "./vendas";

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
      codigo: d.condicao_codigo ?? null,
      categoria: d.categoria_codigo ?? null,
      projeto: d.projeto_codigo ?? null,
      vendedor: d.vendedor_codigo ?? null,
      conta_corrente: d.conta_codigo && /^\d+$/.test(d.conta_codigo) ? Number(d.conta_codigo) : null,
      forma_recebimento: d.forma_recebimento ?? null,
      parcelas: d.parcelas.map((x) => x.dias != null
        ? { dias: x.dias, percentual: x.percentual ?? undefined }
        : { vencimento: x.vencimento, valor: Number(x.valor) }),
    },
    observacoes: [d.obs_nf, d.proposta ? `Proposta ${d.proposta}` : null, d.label].filter(Boolean).join(" · "),
    pedido_cliente: d.num_pedido_cliente,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const dias = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

/** Parcelas do fechamento de projeto (têm nome do evento), em ordem. */
export function parcelasProjeto(d: VendaDoc): VendaParcela[] {
  return (d.parcelas ?? []).filter((p) => (p.descricao ?? "").trim()).sort((a, b) => a.numero - b.numero);
}

/**
 * PV/OS de projeto: a nota fatura UMA ou mais parcelas do fechamento (06/10/26).
 * Itens proporcionais ao valor das parcelas (mantém NCM/CFOP/serviço do escopo),
 * nome da parcela na descrição e nas observações, e o recebimento conta a partir
 * da data da nota com o mesmo prazo do fechamento (vencimento − faturamento previsto).
 * Sem `numeros`, pega a próxima parcela por faturar.
 */
export function docFatParcelas(d: VendaDoc, numeros?: number[] | null): DocFat | null {
  const ps = parcelasProjeto(d);
  if (!ps.length) return null;
  const abertas = ps.filter((p) => !p.faturada_em);
  const escolhidas = (numeros?.length ? ps.filter((p) => numeros.includes(p.numero)) : abertas.slice(0, 1));
  if (!escolhidas.length) return null;
  const base = docFat(d);
  const total = r2(escolhidas.reduce((a, p) => a + Number(p.valor), 0));
  const somaItens = base.itens.reduce((a, i) => a + i.quantidade * i.valor_unitario, 0);
  const fator = somaItens > 0 ? total / somaItens : 1;
  const nomes = escolhidas.map((p) => `Parcela ${p.numero}/${ps.length} — ${(p.descricao ?? "").trim()}`);
  const sufixo = ` · ${nomes.join(" + ")}`;
  let acum = 0;
  const itens = base.itens.map((i, k, arr) => {
    const ultimo = k === arr.length - 1;
    const vt = ultimo ? r2(total - acum) : r2(i.quantidade * i.valor_unitario * fator);
    acum = r2(acum + vt);
    const vu = i.quantidade ? Math.round((vt / i.quantidade) * 1e6) / 1e6 : vt;
    return { ...i, valor_unitario: vu, descricao: `${i.descricao}${sufixo}`.slice(0, 120) };
  });
  // Prazo do fechamento: vencimento − faturamento previsto (ex.: fatura 30/11, vence 07/12 = 7 dias).
  const prazos = escolhidas.map((p) => (p.faturamento_previsto ? Math.max(0, dias(p.faturamento_previsto, p.vencimento)) : null));
  const prazo = prazos.find((x) => x != null);
  const condicao = { ...base.condicao, parcelas: prazo != null ? [{ dias: prazo }] : escolhidas.map((p) => ({ vencimento: p.vencimento, valor: Number(p.valor) })) };
  const obs = [`${nomes.join(" + ")} (R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} de R$ ${Number(d.valor_total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })})`,
    d.projeto ? `Projeto ${d.projeto}` : null, base.observacoes].filter(Boolean).join(" · ");
  return { ...base, itens, condicao, observacoes: obs,
    parcela_doc: { numeros: escolhidas.map((p) => p.numero), total, total_doc: Number(d.valor_total), rotulo: nomes.join(" + ") } };
}
