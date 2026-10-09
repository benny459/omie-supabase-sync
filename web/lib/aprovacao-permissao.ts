// Quem decide a aprovação de um PC — regra pura (08/10/26, Benny: "só pode reprovar quem aprova").
//
// Aprovar, reprovar (Não aprovado, Recusado, Rejeitado por validade, N/A, Pré-seleção…) e
// devolver um PC aprovado para "aguardando" são a MESMA decisão: exigem a MESMA permissão.
// Uma função só, usada por todas as rotas que mudam a aprovação de um PC:
//   /api/compras/acao (PC do painel), /api/compras/pedido (devolver aprovado → aguardando),
//   /api/approvals/set-status e /api/approvals/batch-approve (Operação/Projetos).
// Assim aprovar e reprovar não podem divergir.
//
//   admin                                   → decide sempre
//   sem a permissão de aprovar              → não decide
//   PC de projeto de obra que estoura o budget (lib/aprovacao-projeto-regra) → só admin
//   demais PCs: valor acima da alçada        → não decide
//
// O teto SEMANAL não entra aqui: é limite de gasto, só vale para APROVAR (set-status).
// Testada em scripts/testes/aprovacao-permissao.test.ts.

export type DecisaoAcao = "aprovar" | "reprovar";

export type EntradaPermissao = {
  ehAdmin: boolean;
  /** compras.aprovar (Compras) ou can_approve no módulo (Operação/Projetos). */
  temPermissao: boolean;
  valor: number | null;
  /** Alçada individual (approval_ceiling_brl); null = sem limite. Não vale para PC de projeto de obra. */
  teto: number | null;
  /** Só para PC de projeto de obra (PJ…). `indisponivel` = não deu para conferir o budget agora. */
  projeto?: { estouro: number; motivo: string } | "indisponivel" | null;
};

export const SO_QUEM_APROVA = "só quem aprova pode reprovar";

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** null = pode decidir; senão, o motivo (mensagem para o usuário). */
export function motivoSemPermissao(e: EntradaPermissao, acao: DecisaoAcao): string | null {
  if (e.ehAdmin) return null;
  if (!e.temPermissao) return acao === "aprovar" ? "Sem permissão para aprovar compras" : `Sem permissão: ${SO_QUEM_APROVA}`;
  if (e.projeto === "indisponivel") return "não consegui conferir o budget do projeto agora — tente de novo";
  if (e.projeto) {
    if (e.projeto.estouro > 0) return `${e.projeto.motivo} — fica para os administradores`;
    return null; // PC de projeto: a alçada da área não se aplica
  }
  if (e.teto != null && e.valor != null && Number(e.valor) > Number(e.teto)) return `Acima da sua alçada (${brl(Number(e.teto))})`;
  return null;
}

/** Status de approval.approvals (Operação) que APROVAM. */
export const STATUS_APROVADOS = new Set(["APROVADO", "APROVADO_FAT_DIRETO"]);

/** Mudar o status de approval.approvals exige quem aprova? Só fica de fora pôr "Pendente" numa
 *  compra que ainda não teve decisão (solicitar aprovação). Tudo o resto — aprovar, reprovar,
 *  recusar, N/A, pré-seleção, devolver um aprovado para pendente — é decisão de quem aprova. */
export function statusExigeAprovador(atual: string | null | undefined, novo: string): boolean {
  const a = String(atual ?? "").trim();
  if (novo === "PENDENTE" && (a === "" || a === "PENDENTE")) return false;
  return true;
}

/** Idem para o PC do painel (compras.pedidos.aprov_status). "aguardando" só é decisão quando o
 *  PC já estava aprovado (devolver para aguardando); vindo de "não solicitada" é o pedido de
 *  aprovação do comprador, e vindo de "não aprovado" é o reenvio depois de corrigir. */
export function aprovPainelExigeAprovador(atual: string | null | undefined, novo: string): boolean {
  if (novo === "aguardando") return atual === "aprovado";
  return true;
}

export const acaoDoStatus = (novo: string): DecisaoAcao =>
  STATUS_APROVADOS.has(novo) || novo === "aprovado" ? "aprovar" : "reprovar";

/* Caminho de quem aprova PC do Compras (09/10/26, Benny).
   "compras": área ERP + compras.acesso — tudo como sempre (alçada, compras.aprovar, projeto).
   "projetos": SEM a área ERP, mas com can_approve no módulo Projetos (Operação › Projetos,
   ex.: Marcelo). Só decide PC de projeto de obra (PJ…), com a mesma regra do budget
   (motivoSemPermissao + lib/aprovacao-projeto-regra). Nenhuma outra ação do Compras abre. */
export type CaminhoCompras = "compras" | "projetos";

export function caminhoAprovacaoCompras(e: { ehAdmin: boolean; areaErp: boolean; comprasAcesso: boolean; aprovaProjetos: boolean }): CaminhoCompras | null {
  if (e.ehAdmin || (e.areaErp && e.comprasAcesso)) return "compras";
  if (e.aprovaProjetos) return "projetos";
  return null;
}

export const SO_PC_DE_PROJETO = "por Operação › Projetos você só decide PC de projeto de obra (PJ) — este fica com quem aprova em Compras";

/** Pelo caminho "projetos", o PC tem de ser de projeto de obra; null = segue para a regra. */
export function motivoForaDoCaminho(caminho: CaminhoCompras, pcDeProjetoDeObra: boolean): string | null {
  return caminho === "projetos" && !pcDeProjetoDeObra ? SO_PC_DE_PROJETO : null;
}
