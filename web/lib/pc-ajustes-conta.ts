// Conta pura das devoluções de PC (sql/146) — sem servidor, testada em
// scripts/testes/pc-ajustes.test.ts. Leitura do banco em lib/pc-ajustes.ts.
export type DevolucaoBase = { empresa: string; numero: string; tipo: "total" | "parcial"; valor: number; desfeito_em?: string | null };

export type ResumoDev = { valor: number; tipo: "total" | "parcial"; n: number };
/** Devolvido por PC ("empresa|numero"): soma das devoluções ativas; total se alguma fechou o PC. */
export function devolvidoPorPc(devs: DevolucaoBase[]): Map<string, ResumoDev> {
  const m = new Map<string, ResumoDev>();
  for (const d of devs) {
    if (d.desfeito_em) continue;
    const k = `${d.empresa}|${String(d.numero).trim()}`;
    const a = m.get(k) ?? { valor: 0, tipo: "parcial" as const, n: 0 };
    a.valor = Math.round((a.valor + (Number(d.valor) || 0)) * 100) / 100;
    if (d.tipo === "total") a.tipo = "total";
    a.n++;
    m.set(k, a);
  }
  return m;
}

/** Valor do PC para o projeto depois das devoluções (nunca negativo). */
export const valorLiquido = (valor: number, dev?: ResumoDev | null) => (dev ? Math.max(0, Math.round((valor - dev.valor) * 100) / 100) : valor);
/** Fator para ratear parcelas/fluxo: 1 sem devolução, 0 quando devolvido por inteiro. */
export const fatorDevolucao = (valor: number, dev?: ResumoDev | null) => (!dev || !(valor > 0) ? 1 : Math.max(0, Math.min(1, 1 - dev.valor / valor)));
