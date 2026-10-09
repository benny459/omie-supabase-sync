import "server-only";
// Detetores de Operação e Projetos — chamam a lógica que já existe:
// - Operação: computeReportCounts() de lib/avulsos-report.ts (os 15 alarmes de lib/alarmes.ts,
//   com os donos fixos de hoje, ALARM_OWNERS, como fallback do M6);
// - Projetos: PCs PJ pendentes (mesma lista de Compras), "aprovar até" de approval.v_pc_projetos,
//   etapas de approval.projeto_etapas e o budget de lib/aprovacao-projeto.ts (contextoProjeto).
import { supaAdmin } from "@/lib/supabase-admin";
import { ALARM_OWNERS, REPORT_SECTIONS, buildAlarmeLink, computeReportCounts } from "@/lib/avulsos-report";
import { contextoProjeto } from "@/lib/aprovacao-projeto";
import type { ConfigOrdem } from "../config";
import type { ItemDetectado } from "../tipos";
import { pedidosCompras, type Resultado } from "./compras";
import {
  detetarAcimaBudget, detetarAlarmesOperacao, detetarAprovarAte, detetarEtapasAtrasadas, detetarPjPendentes,
  type EtapaProjeto, type LinhaAprovarAte, type ProjetoBudget,
} from "../regras-outros";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const ROTULOS_ALARME: Record<string, string> = Object.fromEntries(REPORT_SECTIONS.flatMap((s) => s.items.map((i) => [i.kind, i.label])));

export async function detetarOperacao(_cfg: ConfigOrdem, hoje: string): Promise<Resultado> {
  const itens: ItemDetectado[] = [];
  const tipos: string[] = [];
  const erros: Record<string, string> = {};
  const opTipos = Object.keys(ALARM_OWNERS).map((k) => `op_${k}`);
  try {
    const r = await computeReportCounts().catch(() => computeReportCounts());   // 1 nova tentativa (timeout ocasional)
    itens.push(...detetarAlarmesOperacao(r.pvs_by_kind as unknown as Record<string, { pv_os_label: string; cliente: string; tipo: string; valor: number }[]>,
      ROTULOS_ALARME, ALARM_OWNERS as Record<string, string>, (k) => buildAlarmeLink(k as Parameters<typeof buildAlarmeLink>[0])));
    tipos.push(...opTipos);
  } catch (e) { for (const t of opTipos) erros[t] = msg(e); }

  try { itens.push(...detetarPjPendentes(await pedidosCompras(), hoje)); tipos.push("pj_pc_pendente"); }
  catch (e) { erros.pj_pc_pendente = msg(e); }

  try {
    const ap = supaAdmin().schema("approval");
    const { data, error } = await ap.from("v_pc_projetos")
      .select("empresa, ncod_ped, pc_numero, projeto_nome, nome_fornecedor, valor_total, aprovar_ate_calc, status")
      .in("status", ["PENDENTE", "PRE_SELECAO"]).not("aprovar_ate_calc", "is", null).limit(2000);
    if (error) throw new Error(error.message);
    itens.push(...detetarAprovarAte((data ?? []) as LinhaAprovarAte[], hoje));
    tipos.push("pj_aprovar_ate");
  } catch (e) { erros.pj_aprovar_ate = msg(e); }

  try {
    const ap = supaAdmin().schema("approval");
    const [{ data: es, error }, { data: bs }] = await Promise.all([
      ap.from("projeto_etapas").select("empresa, codigo_projeto, etapa, data_prevista").is("data_conclusao", null).lt("data_prevista", hoje),
      ap.from("rc_projetos_budget").select("empresa, codigo_projeto, nome_projeto_fluxo"),
    ]);
    if (error) throw new Error(error.message);
    const nomes = new Map(((bs ?? []) as { empresa: string; codigo_projeto: number; nome_projeto_fluxo: string | null }[]).map((b) => [`${b.empresa}|${b.codigo_projeto}`, b.nome_projeto_fluxo]));
    itens.push(...detetarEtapasAtrasadas(((es ?? []) as EtapaProjeto[]).map((e) => ({ ...e, nome: nomes.get(`${e.empresa}|${e.codigo_projeto}`) ?? null })), hoje));
    tipos.push("pj_etapa_atrasada");
  } catch (e) { erros.pj_etapa_atrasada = msg(e); }

  try {
    const { data, error } = await supaAdmin().schema("approval").from("rc_projetos_budget")
      .select("empresa, codigo_projeto, nome_projeto_fluxo").eq("ativo", true);
    if (error) throw new Error(error.message);
    const { data: nm } = await supaAdmin().schema("approval").from("v_pc_projetos").select("empresa, codigo_projeto, projeto_nome").not("projeto_nome", "is", null).limit(3000);
    const nomeProj = new Map(((nm ?? []) as { empresa: string; codigo_projeto: string | number; projeto_nome: string }[]).map((x) => [`${x.empresa}|${x.codigo_projeto}`, x.projeto_nome]));
    const ps: ProjetoBudget[] = [];
    for (const p of (data ?? []) as { empresa: string; codigo_projeto: number; nome_projeto_fluxo: string | null }[]) {
      const ctx = await contextoProjeto(p.empresa, p.codigo_projeto).catch(() => null);
      if (ctx) ps.push({ empresa: p.empresa, codigo_projeto: p.codigo_projeto, nome: p.nome_projeto_fluxo ?? nomeProj.get(`${p.empresa}|${p.codigo_projeto}`) ?? `Projeto ${p.codigo_projeto}`, budget: ctx.budget, comprometido: ctx.comprometido });
    }
    itens.push(...detetarAcimaBudget(ps));
    tipos.push("pj_acima_budget");
  } catch (e) { erros.pj_acima_budget = msg(e); }

  return { itens, tipos, erros };
}
