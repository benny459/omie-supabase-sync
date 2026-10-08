// Regras puras dos grupos de equipamento (07/10/26) — usadas pela tela e testadas
// em scripts/testes/grupos-equipamento.test.ts.

/** Chave do grupo: sem acento, caixa nem pontuação (mesma ideia de approval._norm_item). */
export const normGrupo = (t: string | null | undefined) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9/.,]+/g, " ").trim();

/** Data do grupo = a data mais comum entre as linhas do grupo (empate: a mais cedo).
 *  Linha sem data também vota: se as sem data são maioria, o grupo não tem data. */
export function dataDoGrupo(datas: (string | null | undefined)[]): string | null {
  const c = new Map<string, number>();
  let semData = 0;
  for (const d of datas) {
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) c.set(d, (c.get(d) ?? 0) + 1);
    else semData++;
  }
  const [top] = [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  // Linhas sem data também votam (08/10/26): colar 3 linhas com data num grupo de 17 sem
  // data não pode virar a data do grupo inteiro (e, ao salvar, a de todas as linhas).
  if (!top || semData > top[1]) return null;
  return top[0];
}

/** Datas novas das linhas ao mudar a data do grupo: muda quem estava vazio ou seguia
 *  a data antiga do grupo; quem tinha data própria fica como está. */
export function aplicarDataGrupo(datas: string[], antiga: string | null, nova: string): string[] {
  return datas.map((d) => (!d || d === antiga ? nova : d));
}

/** Nome padrão do cadastro parecido com o nome livre ("Filtro Muiltimeios" → "Filtro Multimeios").
 *  Igual (sem acento/caixa) ou com a maioria das palavras batendo por prefixo/edição pequena. */
export function nomePadrao(livre: string, cadastro: string[]): string | null {
  const k = normGrupo(livre);
  if (!k) return null;
  const igual = cadastro.find((c) => normGrupo(c) === k);
  if (igual) return igual;
  const pal = (t: string) => normGrupo(t).split(" ").filter((w) => w.length >= 3);
  const perto = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && distancia(a, b) <= 2);
  const pa = pal(livre);
  let melhor: { nome: string; s: number } | null = null;
  for (const c of cadastro) {
    const pc = pal(c);
    if (!pa.length || !pc.length) continue;
    const s = pa.filter((w) => pc.some((x) => perto(w, x))).length / Math.max(pa.length, pc.length);
    if (s >= 0.99 && (!melhor || s > melhor.s)) melhor = { nome: c, s };
  }
  return melhor?.nome ?? null;
}

/** Distância de edição (Levenshtein) — palavras curtas, custo irrelevante. */
function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
