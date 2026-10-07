// Aprovação de PC de PROJETO — regra pura (07/10/26, decisão do Benny).
//
// PC de projeto não vai para o aprovador da área: quem libera as compras do
// projeto é o FLUXO aprovado ("Aprovar o fluxo é o que libera a aprovação dos
// pedidos de compra deste projeto"), desde que o projeto inteiro caiba no budget
// de materiais. Não há comparação item a item (nem PC × RC, nem PC × lista).
//   aprova  ⇔ fluxo aprovado  E  comprometido (sem este PC) + este PC ≤ budget × (1 + tolerância)
//   senão   → fica pendente para os administradores, com o motivo.
// Usada na aprovação manual (Operação/Projetos e Compras) e pela Aria.
// Testada em scripts/testes/aprovacao-projeto.test.ts.

/** Só projeto de obra (PJ…) segue esta regra. "41_VP", "47_CONTRATUAL", "45_GARANTIA" e
 *  afins são projetos-conta do Omie: continuam com a regra de sempre (alçada / avulsos). */
export const ehProjetoDeObra = (nome: string | null | undefined) => /^\s*PJ\s*\d/i.test(String(nome ?? ""));

/** Fluxo de caixa do projeto tem de estar aprovado. */
export const EXIGE_FLUXO_APROVADO = true;
/** Folga sobre o budget de materiais (0 = nenhuma). Ex.: 0.05 = 5%. */
export const TOLERANCIA_BUDGET = 0;

export type EntradaRegraProjeto = {
  fluxoStatus: string | null;          // approval.projeto_fluxo.status (null = projeto sem fluxo lançado)
  budget: number | null;               // budget de materiais (painel, senão CP/MC do CRM)
  comprometidoOutros: number;          // PCs do projeto sem este (cada PC uma vez, sem os escondidos)
  valorPc: number;
};
export type DecisaoProjeto = { aprova: boolean; motivo: string; estouro: number; total: number; teto: number | null };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function regraProjeto(e: EntradaRegraProjeto): DecisaoProjeto {
  const total = Math.round((e.comprometidoOutros + e.valorPc) * 100) / 100;
  const teto = e.budget != null && e.budget > 0 ? Math.round(e.budget * (1 + TOLERANCIA_BUDGET) * 100) / 100 : null;
  const estouro = teto != null && total > teto + 0.005 ? Math.round((total - teto) * 100) / 100 : 0;
  // o estouro vem primeiro: é o que manda o PC para os administradores
  if (estouro > 0) return { aprova: false, motivo: `estoura o budget do projeto em ${brl(estouro)}`, estouro, total, teto };
  if (EXIGE_FLUXO_APROVADO && e.fluxoStatus !== "aprovado") {
    const como = e.fluxoStatus === "pendente" ? "está aguardando aprovação" : e.fluxoStatus === "rejeitado" ? "foi rejeitado"
      : e.fluxoStatus ? "ainda está em rascunho" : "não foi lançado";
    return { aprova: false, motivo: `o fluxo de caixa do projeto ${como}`, estouro: 0, total, teto };
  }
  if (teto == null) return { aprova: false, motivo: "projeto sem budget de materiais", estouro: 0, total, teto };
  return { aprova: true, motivo: `projeto dentro do budget (${brl(total)} de ${brl(teto)})`, estouro: 0, total, teto };
}
