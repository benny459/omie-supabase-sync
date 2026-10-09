import "server-only";
// Execução das ações da Central SEMPRE pelas rotas existentes do painel, com a sessão
// da própria pessoa (o cookie dela é reencaminhado). Assim valem exactamente as mesmas
// regras, alçadas, avisos Webex e auditoria das telas de hoje. A Central não escreve
// nos módulos por nenhum outro caminho.
import type { ChamadaRota } from "./tipos";

/** Só estas rotas podem ser chamadas pela Central (nunca um caminho vindo do cliente). */
export const ROTAS_PERMITIDAS = new Set([
  "/api/compras/acao", "/api/compras/email", "/api/compras/email/conversa",
  "/api/financeiro/conciliacao", "/api/approvals/batch-approve", "/api/approvals/set-status",
]);

export type Resposta = { ok: boolean; status: number; corpo: unknown };

export async function chamarRota(origem: string, cookie: string, metodo: "GET" | "POST" | "PATCH", caminho: string, corpo?: Record<string, unknown>): Promise<Resposta> {
  const base = caminho.split("?")[0];
  if (!ROTAS_PERMITIDAS.has(base)) throw new Error(`Rota não permitida: ${base}`);
  const r = await fetch(new URL(caminho, origem), {
    method: metodo, cache: "no-store",
    headers: { cookie, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, corpo: j };
}

/** Uma chamada ou uma por corpo do lote. Para no primeiro erro de sessão/permissão (401/403). */
export async function executarChamada(origem: string, cookie: string, c: ChamadaRota, extra: Record<string, unknown> = {}) {
  const corpos = c.lote?.length ? c.lote : [c.corpo];
  const res: (Resposta & { corpoEnviado: Record<string, unknown> })[] = [];
  for (const b of corpos) {
    const corpo = { ...b, ...extra };
    const r = await chamarRota(origem, cookie, c.metodo, c.caminho, corpo);
    res.push({ ...r, corpoEnviado: corpo });
    if (r.status === 401 || r.status === 403) break;
  }
  const ok = res.filter((r) => r.ok).length;
  return { res, ok, falhas: res.length - ok, total: corpos.length };
}

export const erroDe = (r: Resposta) => {
  const c = r.corpo as { error?: string; falhas?: { num: string; erro: string }[] } | null;
  return c?.error ?? (c?.falhas?.length ? c.falhas.map((f) => `PC ${f.num}: ${f.erro}`).join("; ") : `erro ${r.status}`);
};
