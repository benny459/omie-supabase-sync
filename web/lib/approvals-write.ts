// Gravação das linhas de approval.approvals a partir das telas de Operação.
//
// É a MESMA lógica que a grade antiga usa (components/EditableCell.tsx e a
// rota /api/approvals/set-status), extraída para as vistas novas (Lista,
// Tabela, Kanban) gravarem pelos mesmos caminhos — com as mesmas regras de
// RLS (can_write_module), alçada, orçamento semanal, atribuição de cliente e
// fluxo do projeto, que vivem no servidor.
//
// Aprovação em massa: de propósito NÃO usa /api/approvals/batch-approve, que
// pula alçada, orçamento semanal e atribuição (lacuna achada em 30/09/2026).
// Chama set-status linha a linha, com concorrência limitada.

import { supaBrowser } from "@/lib/supabase";

type AnyRow = Record<string, unknown>;
export type Modulo = "avulsos" | "projetos" | "pcs";

const moduloDaLinha = (row: AnyRow, fallback: Modulo) =>
  (String(row.modulo ?? "") || fallback) as Modulo;

export type ResultadoStatus = { ok: true } | { ok: false; erro: string; codigo?: string; aviso?: { aviso: string } };

/** Muda o status de aprovação de UMA compra (mesma chamada do popover antigo).
 *  `motivoAcimaBudget` (09/10/26): motivo ao confirmar o aviso de PC de projeto acima do budget —
 *  sem ele, o servidor responde codigo ACIMA_BUDGET_CONFIRMAR com o `aviso` para mostrar. */
export async function mudarStatus(row: AnyRow, status: string, modulo: Modulo, motivoAcimaBudget?: string | null): Promise<ResultadoStatus> {
  try {
    const r = await fetch("/api/approvals/set-status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empresa: row.empresa, ncod_ped: row.ncod_ped, status,
        modulo: moduloDaLinha(row, modulo),
        valorPc: row.valor_total != null ? Number(row.valor_total) : null,
        ...(motivoAcimaBudget ? { motivoAcimaBudget } : {}),
      }),
    });
    if (r.ok) return { ok: true };
    const j = await r.json().catch(() => ({}));
    return { ok: false, erro: String(j.error ?? j.message ?? r.statusText), codigo: j.code, aviso: j.aviso };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/** Várias compras, com as travas da aprovação individual valendo para cada uma. */
export async function mudarStatusEmMassa(
  rows: AnyRow[], status: string, modulo: Modulo, motivoAcimaBudget?: string | null,
): Promise<{ ok: number; falhas: { row: AnyRow; erro: string; codigo?: string; aviso?: { aviso: string } }[] }> {
  const falhas: { row: AnyRow; erro: string; codigo?: string; aviso?: { aviso: string } }[] = [];
  let ok = 0;
  const fila = [...rows];
  const trabalhador = async () => {
    while (fila.length) {
      const row = fila.shift()!;
      const r = await mudarStatus(row, status, modulo, motivoAcimaBudget);
      if (r.ok) ok++; else falhas.push({ row, erro: r.erro, codigo: r.codigo, aviso: r.aviso });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, trabalhador));
  return { ok, falhas };
}

/** Grava um campo. `campo` pode ser coluna de approval.approvals ou
 *  "custom:<slug>" (custom_fields); `historico` acrescenta {v, at} em
 *  `<slug>_hist` — usado na nova previsão de materiais, como na grade antiga. */
export async function salvarCampo(
  row: AnyRow, campo: string, valor: unknown, modulo: Modulo, opts: { historico?: boolean } = {},
): Promise<string | null> {
  const empresa = row.empresa, ncod_ped = row.ncod_ped;
  const mod = moduloDaLinha(row, modulo);
  const approval = supaBrowser().schema("approval" as never);
  if (campo.startsWith("custom:")) {
    const slug = campo.slice("custom:".length);
    const { data, error: re } = await approval.from("approvals").select("custom_fields")
      .eq("empresa", empresa).eq("ncod_ped", ncod_ped).maybeSingle();
    if (re) return re.message;
    const cf: Record<string, unknown> = { ...((data as { custom_fields?: object } | null)?.custom_fields ?? {}) };
    const antes = cf[slug];
    if (valor === null) delete cf[slug]; else cf[slug] = valor;
    if (opts.historico && valor !== null && valor !== antes) {
      const k = `${slug}_hist`;
      const hist = Array.isArray(cf[k]) ? (cf[k] as unknown[]) : [];
      cf[k] = [...hist, { v: valor, at: new Date().toISOString() }];
    }
    const { error } = await approval.from("approvals")
      .upsert({ empresa, ncod_ped, modulo: mod, custom_fields: cf }, { onConflict: "empresa,ncod_ped" });
    return error?.message ?? null;
  }
  const base: AnyRow = { empresa, ncod_ped, modulo: mod, [campo]: valor };
  if (Number(ncod_ped) < 0) base.source = "native";
  const { error } = await approval.from("approvals").upsert(base, { onConflict: "empresa,ncod_ped" });
  return error?.message ?? null;
}

/** Campos editáveis nas vistas novas — os mesmos que a grade antiga editava. */
export const CAMPOS = {
  justificativa: { campo: "justificativa" },
  pc: { campo: "pc_numero_manual" },
  rcNumero: { campo: "rc_numero" },
  rcDescricao: { campo: "rc_descricao" },
  rcQtd: { campo: "custom:rc_qtd" },
  rcCusto: { campo: "rc_custo" },
  prevMateriais: { campo: "custom:s4b87bk9", historico: true },
} as const;
