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
//   PC de projeto de obra que estoura o budget (lib/aprovacao-projeto-regra) → só admin, OU quem
//     tem projetos.aprovar_acima_budget (09/10/26, Benny: "O Marcelo me avisa, mas tem sim
//     autonomia para aprovar para projetos") — aprovar exige ver o aviso e dar um motivo
//     (mín. 5 caracteres); reprovar não. O Benny é avisado no Webex.
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
  projeto?: { estouro: number; motivo: string; total?: number; teto?: number | null; nome?: string | null } | "indisponivel" | null;
  /** projetos.aprovar_acima_budget (`pode`) + o motivo digitado ao confirmar o aviso. */
  acimaBudget?: { pode: boolean; motivo?: string | null } | null;
};

export const MIN_MOTIVO_ACIMA_BUDGET = 5;
/** Código da resposta (409) quando falta confirmar o aviso de PC acima do budget. */
export const CODIGO_CONFIRMAR_ACIMA_BUDGET = "ACIMA_BUDGET_CONFIRMAR";

export type AvisoAcimaBudget = { projeto: string | null; estouro: number; total: number | null; teto: number | null; aviso: string };
/** O que fica gravado na aprovação acima do budget (custom_fields.acima_budget / histórico). */
export type RegistroAcimaBudget = AvisoAcimaBudget & { motivo: string };
export type ResultadoDecisao = {
  /** null = pode decidir; senão o motivo (mensagem para o usuário). */
  motivo: string | null;
  /** Falta confirmar o aviso (e dar o motivo) para aprovar acima do budget. */
  confirmar?: AvisoAcimaBudget;
  /** Aprovação acima do budget liberada — gravar e avisar o Benny. */
  acimaBudget?: RegistroAcimaBudget;
};

export const SO_QUEM_APROVA = "só quem aprova pode reprovar";

const brl = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "PJ361_Diaverum Sorocaba" → "PJ361". */
export const codigoPj = (nome: string | null | undefined): string | null => {
  const m = String(nome ?? "").match(/^\s*(PJ\s*\d+)/i);
  return m ? m[1].replace(/\s+/g, "").toUpperCase() : (nome ? String(nome).trim() || null : null);
};

export function avisoAcimaBudget(p: { nome?: string | null; estouro: number; total?: number | null; teto?: number | null }): AvisoAcimaBudget {
  const pj = codigoPj(p.nome);
  const tot = p.total != null && p.teto != null ? ` (total ${brl(p.total)} de ${brl(p.teto)})` : "";
  return {
    projeto: pj, estouro: p.estouro, total: p.total ?? null, teto: p.teto ?? null,
    aviso: `Este PC estoura o budget do projeto${pj ? ` ${pj}` : ""} em ${brl(p.estouro)}${tot}. Você tem autonomia para aprovar — o Benny será avisado.`,
  };
}

/** A decisão completa: pode / não pode / pode, mas confirme o aviso de acima do budget. */
export function decidirAprovacao(e: EntradaPermissao, acao: DecisaoAcao): ResultadoDecisao {
  if (e.ehAdmin) return { motivo: null };
  if (!e.temPermissao) return { motivo: acao === "aprovar" ? "Sem permissão para aprovar compras" : `Sem permissão: ${SO_QUEM_APROVA}` };
  if (e.projeto === "indisponivel") return { motivo: "não consegui conferir o budget do projeto agora — tente de novo" };
  if (e.projeto) {
    if (e.projeto.estouro > 0) {
      if (!e.acimaBudget?.pode) return { motivo: `${e.projeto.motivo} — fica para os administradores` };
      if (acao === "reprovar") return { motivo: null }; // reprovar não gasta: sem aviso nem motivo
      const aviso = avisoAcimaBudget({ nome: e.projeto.nome, estouro: e.projeto.estouro, total: e.projeto.total, teto: e.projeto.teto });
      const motivo = String(e.acimaBudget.motivo ?? "").trim();
      if (motivo.length >= MIN_MOTIVO_ACIMA_BUDGET) return { motivo: null, acimaBudget: { ...aviso, motivo } };
      return { motivo: `${aviso.aviso} Confirme e informe o motivo (mín. ${MIN_MOTIVO_ACIMA_BUDGET} caracteres).`, confirmar: aviso };
    }
    return { motivo: null }; // PC de projeto: a alçada da área não se aplica
  }
  if (e.teto != null && e.valor != null && Number(e.valor) > Number(e.teto)) return { motivo: `Acima da sua alçada (${brl(Number(e.teto))})` };
  return { motivo: null };
}

/** null = pode decidir; senão, o motivo (mensagem para o usuário). */
export function motivoSemPermissao(e: EntradaPermissao, acao: DecisaoAcao): string | null {
  return decidirAprovacao(e, acao).motivo;
}

/** Linha do histórico / Webex de uma aprovação acima do budget. */
export function textoAcimaBudget(r: RegistroAcimaBudget, por: string): string {
  const tot = r.total != null && r.teto != null ? ` (total ${brl(r.total)} de ${brl(r.teto)})` : "";
  return `⚠️ Aprovado acima do budget${r.projeto ? ` do projeto ${r.projeto}` : ""}: estouro ${brl(r.estouro)}${tot} · motivo: ${r.motivo} · por ${por}`;
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
