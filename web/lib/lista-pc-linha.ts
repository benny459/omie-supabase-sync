// Linha da lista de materiais × linha do pedido de compra (07/10/26).
//
// Lista antiga ligada só pelo NÚMERO do PC (PJ361: 45 linhas com "7274", "6299"…
// e nenhum vínculo por item) mostrava o PC sem valor nenhum: Comprado "—" mesmo
// com o pedido recebido. Aqui se acha, dentro do PC, a linha que é daquele item:
// código igual primeiro; senão a descrição mais parecida (mesma pontuação da
// lista, onde a medida é barreira); PC de uma linha só é aquela linha.
// Puro — testado em scripts/testes/lista-pc-linha.test.ts.
import { tokens, construirIdf, pontuar, deHtml } from "@/lib/match-pc";

export type LinhaPc = { cod: string | null; desc: string; qtd: number; vu: number; valor: number; rec: number | null };
export type Achado = LinhaPc & { por: "código" | "descrição" | "única linha" };

export const LIMIAR_LINHA_PC = 0.45;

export function acharLinhaPc(item: { codigo?: string | null; texto: string }, linhas: LinhaPc[]): Achado | null {
  if (!linhas.length) return null;
  const cod = String(item.codigo ?? "").trim().toUpperCase();
  if (cod) {
    const l = linhas.find((x) => String(x.cod ?? "").trim().toUpperCase() === cod);
    if (l) return { ...l, por: "código" };
  }
  const alvo = tokens(item.texto);
  const toks = linhas.map((l) => tokens(l.desc));
  const idf = construirIdf([alvo, ...toks]);
  let melhor = -1, s1 = 0;
  toks.forEach((t, i) => { const s = pontuar(alvo, t, idf); if (s > s1) { s1 = s; melhor = i; } });
  if (melhor >= 0 && s1 >= LIMIAR_LINHA_PC) return { ...linhas[melhor], por: "descrição" };
  if (linhas.length === 1) return { ...linhas[0], por: "única linha" };
  return null;
}

/** Valor da linha do PC como o banco calcula (sql/89): qtd × vu − desconto + IPI + ST. */
export const valorLinhaPc = (i: { qtd?: number | null; vu?: number | null; desc0?: number | null; ipi?: number | null; st?: number | null }) =>
  Math.round(((Number(i.qtd) || 0) * (Number(i.vu) || 0) - (Number(i.desc0) || 0) + (Number(i.ipi) || 0) + (Number(i.st) || 0)) * 100) / 100;

export { deHtml };
