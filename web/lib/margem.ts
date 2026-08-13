// A régua de margem bruta, em um lugar só.
//
// Existe porque a mesma classificação vive em três telas — /avulsos, /projetos e
// /bi/margem-venda — e cada uma tinha escrito a sua. Duas já divergiam no
// vocabulário ("Muito baixa" contra "0–15%"), e uma comparava contra um rótulo
// que não existia em lugar nenhum ("Sem custo ligado"), então a condição nunca
// era verdadeira e passava despercebida. É o mesmo motivo de lib/alarmes.ts: a
// regra duplicada é a regra que diverge.
//
// Os rótulos numéricos vencem os adjetivos de propósito: "15–25%" não depende de
// quem lê. Eles são idênticos aos que bi.monitor_margem_venda devolve — se mudar
// aqui, mude lá na mesma leva.

/** Ordem = gravidade, não tamanho. O que dói fica no topo de qualquer lista. */
export const FAIXAS_MARGEM = [
  "Negativa",
  "Sem custo lançado",
  "0–15%",
  "15–25%",
  "25–35%",
  "> 35%",
  "Serviço (sem compra)",
  "Sem receita",
] as const;

export type FaixaMargem = typeof FAIXAS_MARGEM[number];

/** Tom de leitura. "Sem custo lançado" é crítico porque é venda que deveria ter
 *  compra e não tem — falta de informação onde ela era obrigatória. "Serviço
 *  (sem compra)" é neutro: ali nunca haveria compra, então não é alarme. */
export const TOM_FAIXA: Record<FaixaMargem, "critico" | "alerta" | "ok" | "neutro"> = {
  "Negativa":             "critico",
  "Sem custo lançado":    "critico",
  "0–15%":                "critico",
  "15–25%":               "alerta",
  "25–35%":               "alerta",
  "> 35%":                "ok",
  "Serviço (sem compra)": "neutro",
  "Sem receita":          "neutro",
};

/** Faixas em que a margem NÃO é um número — são estados, não resultados.
 *  Somar ou mediar margem sobre elas é o erro que inflava o indicador. */
export const FAIXAS_SEM_MARGEM: ReadonlySet<string> = new Set([
  "Sem custo lançado", "Serviço (sem compra)", "Sem receita",
]);

/** Classifica uma venda pela margem bruta (receita − custo) / receita.
 *
 *  Só existe margem quando há receita E há custo medido. Sem custo lançado a
 *  conta daria 100%, o que empurra a venda pra faixa boa e esconde justamente o
 *  caso que interessa vigiar — foi o que fez 387 de 398 vendas do ano
 *  aparecerem como margem alta em /avulsos.
 *
 *  `exigeCusto` vem da regra do negócio: em avulsos só se aprova compra do que é
 *  Mix ou Mercantil. Serviço puro não gera pedido de compra, então não ter custo
 *  nele é o esperado e vira faixa neutra, não alarme. Tipo desconhecido conta
 *  como exigente — não classificado é caso a investigar, não caso a absolver. */
export function faixaDeValores(receita: number, custo: number, exigeCusto: boolean): FaixaMargem {
  if (!(receita > 0)) return "Sem receita";
  if (!(custo > 0))   return exigeCusto ? "Sem custo lançado" : "Serviço (sem compra)";
  const pct = ((receita - custo) / receita) * 100;
  if (pct < 0)  return "Negativa";
  if (pct < 15) return "0–15%";
  if (pct < 25) return "15–25%";
  if (pct < 35) return "25–35%";
  return "> 35%";
}
