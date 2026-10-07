// Aprovação de PC de projeto — avaliação no servidor (07/10/26). A regra pura está
// em lib/aprovacao-projeto-regra.ts; aqui só se juntam os números do projeto com a
// MESMA definição da Lista de materiais (Comprometido = cada PC uma vez, sem os escondidos).
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { completarPcs, type DadosPcs } from "@/lib/lista-pc-completar";
import { regraProjeto, type DecisaoProjeto } from "@/lib/aprovacao-projeto-regra";

export type AvaliacaoProjeto = DecisaoProjeto & { codigoProjeto: number; pc: string; valorPc: number; budget: number | null; comprometidoOutros: number; fluxoStatus: string | null };

type Contexto = { codigoProjeto: number; fluxoStatus: string | null; budget: number | null; comprometido: number; valores: Record<string, number> };

/** Números do projeto (uma leitura) — a Aria reaproveita para vários PCs do mesmo projeto. */
export async function contextoProjeto(empresa: string, codigoProjeto: number): Promise<Contexto> {
  const emp = empresa.toUpperCase();
  const [fl, cmp] = await Promise.all([
    supaAdmin().schema("approval").from("projeto_fluxo").select("status").eq("empresa", emp).eq("codigo_projeto", codigoProjeto).maybeSingle(),
    supaAdmin().schema("approval").rpc("rc_projetos_compras", { p_empresa: emp, p_projeto: codigoProjeto }),
  ]);
  if (cmp.error) throw new Error(cmp.error.message);
  const d = await completarPcs(cmp.data as DadosPcs, emp, codigoProjeto);
  const t = (d.totais ?? {}) as { comprometido?: number; budget_lista?: number | null; budget_plano?: number | null; pcs_valores?: Record<string, number> };
  const b = t.budget_lista ?? t.budget_plano ?? null;
  return { codigoProjeto, fluxoStatus: (fl.data as { status?: string } | null)?.status ?? null, budget: b != null ? Number(b) : null,
    comprometido: Number(t.comprometido) || 0, valores: t.pcs_valores ?? {} };
}

export function avaliarComContexto(ctx: Contexto, pc: string, valorInformado?: number | null): AvaliacaoProjeto {
  const doPc = ctx.valores[pc] ?? 0;
  const valorPc = doPc || Number(valorInformado) || 0;
  const comprometidoOutros = Math.round((ctx.comprometido - doPc) * 100) / 100;
  const dec = regraProjeto({ fluxoStatus: ctx.fluxoStatus, budget: ctx.budget, comprometidoOutros, valorPc });
  return { ...dec, codigoProjeto: ctx.codigoProjeto, pc, valorPc, budget: ctx.budget, comprometidoOutros, fluxoStatus: ctx.fluxoStatus };
}

export async function avaliarPcProjeto(empresa: string, codigoProjeto: number, pc: string, valorInformado?: number | null): Promise<AvaliacaoProjeto> {
  return avaliarComContexto(await contextoProjeto(empresa, codigoProjeto), pc, valorInformado);
}
