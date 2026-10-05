// Rota do painel → página do manual (para o botão "?" da barra). Gerado junto
// com o manual por scripts/manual-gerar.mjs — leve, roda no navegador.
import rotas from "./manual-rotas.json";

export function slugDaRota(rota: string): string | null {
  let melhor: { slug: string; n: number } | null = null;
  for (const p of rotas as { slug: string; rotas: string[] }[]) {
    for (const r of p.rotas) {
      if (r === "/") continue;
      if (rota === r || rota.startsWith(r + "/")) {
        if (!melhor || r.length > melhor.n) melhor = { slug: p.slug, n: r.length };
      }
    }
  }
  return melhor?.slug ?? null;
}
