// Manual do usuário (05/10/26). O conteúdo vive em web/content/manual/*.md e
// é compilado para lib/manual-dados.json por scripts/manual-gerar.mjs.
import dados from "./manual-dados.json";

export type Mudanca = { hash: string; data: string; texto: string };
export type PaginaManual = {
  slug: string; titulo: string; resumo: string; icone: string; area: string | null;
  rotas: string[]; atualizado: string | null; corpo: string; mudancas: Mudanca[];
};

export const PAGINAS = (dados as { paginas: PaginaManual[] }).paginas;

export function paginaPorSlug(slug: string) {
  return PAGINAS.find((p) => p.slug === slug) ?? null;
}

export { slugDaRota } from "./manual-rotas";
