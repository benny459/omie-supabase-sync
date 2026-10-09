// PC de projeto acima do budget — lado da tela (09/10/26, Benny: "O Marcelo me avisa, mas tem
// sim autonomia para aprovar para projetos"). Quem tem projetos.aprovar_acima_budget recebe do
// servidor o aviso (code ACIMA_BUDGET_CONFIRMAR) em vez de "fica para os administradores"; a
// tela mostra o aviso, pede o motivo (mín. 5 caracteres) e reenvia só esses PCs com o motivo.
// Regra e textos no servidor: lib/aprovacao-permissao.ts (decidirAprovacao).

export const CODIGO_CONFIRMAR = "ACIMA_BUDGET_CONFIRMAR";
export const MIN_MOTIVO = 5;

export type AvisoTela = { aviso: string; num?: string | null };

/** Mostra o(s) aviso(s) e pede o motivo. null = a pessoa cancelou. */
export function pedirMotivoAcimaBudget(avisos: AvisoTela[]): string | null {
  if (typeof window === "undefined" || !avisos.length) return null;
  const texto = avisos.length === 1
    ? avisos[0].aviso
    : `${avisos.length} PCs estouram o budget do projeto:\n` + avisos.map((a) => `• ${a.num ? `PC ${a.num}: ` : ""}${a.aviso}`).join("\n");
  let msg = `${texto}\n\nMotivo da aprovação acima do budget (mín. ${MIN_MOTIVO} caracteres):`;
  for (;;) {
    const r = window.prompt(msg, "");
    if (r === null) return null;
    if (r.trim().length >= MIN_MOTIVO) return r.trim();
    msg = `${texto}\n\nO motivo precisa ter pelo menos ${MIN_MOTIVO} caracteres:`;
  }
}

type Falha = { num: string; erro: string };
type RespAcao = { alterados?: number; falhas?: Falha[]; code?: string; avisos?: (AvisoTela & { id: number; num: string })[]; error?: string };

/** Aprovar/reprovar PCs pela /api/compras/acao com o passo do aviso de acima do budget.
 *  Lança em erro HTTP; cancelar o aviso vira falha "aprovação acima do budget cancelada". */
export async function aprovarComprasComAviso(ids: number[], status: string): Promise<{ alterados: number; falhas: Falha[] }> {
  const enviar = async (corpo: Record<string, unknown>): Promise<RespAcao> => {
    const r = await fetch("/api/compras/acao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const j = (await r.json().catch(() => ({}))) as RespAcao;
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j;
  };
  const j = await enviar({ acao: "aprovar", ids, status });
  let alterados = Number(j.alterados ?? 0);
  const falhas = [...(j.falhas ?? [])];
  const avisos = j.code === CODIGO_CONFIRMAR ? (j.avisos ?? []) : [];
  if (avisos.length) {
    const motivo = pedirMotivoAcimaBudget(avisos);
    if (motivo == null) {
      for (const a of avisos) falhas.push({ num: a.num, erro: "aprovação acima do budget cancelada" });
    } else {
      const j2 = await enviar({ acao: "aprovar", ids: avisos.map((a) => a.id), status, motivoAcimaBudget: motivo });
      alterados += Number(j2.alterados ?? 0);
      falhas.push(...(j2.falhas ?? []));
      for (const a of j2.avisos ?? []) falhas.push({ num: a.num, erro: a.aviso });
    }
  }
  return { alterados, falhas };
}

type LinhaLote = { empresa: string; ncod_ped: number; modulo?: string; valorPc?: number | null };
type RespLote = { ok?: boolean; count?: number; failed?: { empresa: string; ncod_ped: number; error?: string; code?: string }[];
  code?: string; avisos?: (AvisoTela & { empresa: string; ncod_ped: number })[]; error?: string };

/** /api/approvals/batch-approve (tela clássica) com o passo do aviso de acima do budget. */
export async function batchApproveComAviso(rows: LinhaLote[], status: string): Promise<{ httpOk: boolean; j: RespLote }> {
  const enviar = async (rs: LinhaLote[], motivoAcimaBudget?: string) => {
    const res = await fetch("/api/approvals/batch-approve", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rs, status, ...(motivoAcimaBudget ? { motivoAcimaBudget } : {}) }) });
    return { httpOk: res.ok, j: (await res.json().catch(() => ({}))) as RespLote };
  };
  const r = await enviar(rows);
  if (!r.httpOk || r.j.code !== CODIGO_CONFIRMAR || !r.j.avisos?.length) return r;
  const avisos = r.j.avisos;
  const motivo = pedirMotivoAcimaBudget(avisos);
  if (motivo == null) return r;
  const chave = (x: { empresa: string; ncod_ped: number }) => `${x.empresa}|${Number(x.ncod_ped)}`;
  const deles = new Set(avisos.map(chave));
  const r2 = await enviar(rows.filter((x) => deles.has(chave(x))), motivo);
  const failed = [...(r.j.failed ?? []).filter((f) => !deles.has(chave(f))), ...(r2.j.failed ?? [])];
  return { httpOk: r2.httpOk, j: { ...r2.j, count: Number(r.j.count ?? 0) + Number(r2.j.count ?? 0), failed, ok: failed.length === 0 } };
}
