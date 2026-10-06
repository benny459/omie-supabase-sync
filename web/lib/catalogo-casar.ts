// "Compatibilizar com o estoque" (CP do CRM, 06/10/26): para cada linha de texto
// livre, os N itens NOSSOS (com código novo) mais prováveis — nome (mesma
// pontuação da lista de materiais do projeto, onde a medida é barreira), custo
// perto do último preço/CMC e unidade. O de-para gravado pelo usuário (acao
// "vincular") vem primeiro, com score 1.
import { tokens, construirIdf, pontuar } from "@/lib/match-pc";

export type ItemNosso = { id: number; cod: string; desc: string; un: string; cmc: number | null; ultimo_preco: number | null };
export type Candidato = ItemNosso & { score: number; motivo: string };
export type ItemIndexado = ItemNosso & { tok: string[] };

/** Chave do de-para: sem acento, caixa, pontuação nem espaços. */
export const normTexto = (t: string) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const normUn = (u?: string | null) => {
  const s = String(u ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ({ UND: "UN", UNID: "UN", UNIDADE: "UN", PC: "UN", PCS: "UN", PECA: "UN", MT: "M", METRO: "M", KGS: "KG", LT: "L", LITRO: "L" } as Record<string, string>)[s] ?? s;
};
const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function indexar(itens: ItemNosso[]) {
  const idx: ItemIndexado[] = itens.map((i) => ({ ...i, tok: tokens(i.desc) }));
  return { itens: idx, idf: construirIdf(idx.map((i) => i.tok)) };
}

/** Pontua uma linha contra o catálogo indexado. Puro (testável). */
export function pontuarLinha(texto: string, custo: number | null | undefined, unidade: string | null | undefined,
                             base: { itens: ItemIndexado[]; idf: Map<string, number> }, top = 3): Candidato[] {
  const alvo = tokens(texto);
  if (!alvo.length) return [];
  const un = unidade ? normUn(unidade) : "";
  const out: Candidato[] = [];
  for (const it of base.itens) {
    let nome = pontuar(alvo, it.tok, base.idf);
    // bitola composta ("1.1/2" vira "1/1/2" no tokenizador) também é barreira
    const fA = alvo.filter((w) => /^\d+(\/\d+){2,}$/.test(w)), fB = it.tok.filter((w) => /^\d+(\/\d+){2,}$/.test(w));
    if (fA.length && fB.length && !fA.some((x) => fB.includes(x))) nome *= 0.25;
    // dimensão "30X72" e código de modelo ("F74A3") dos dois lados: precisam bater
    const dim = (w: string) => /^\d+X\d+$/.test(w);
    const dA = alvo.filter(dim), dB = it.tok.filter(dim);
    if (dA.length && dB.length && !dA.some((x) => dB.includes(x))) nome *= 0.4;
    // modelo: letras+dígitos com 3+ caracteres ("F67", "F74A3"); "F 74A3" escrito com espaço também conta
    const modelo = (w: string) => /^(?=.*\d)(?=.*[A-Z])[A-Z0-9]{3,}$/.test(w) && !dim(w) && !/^\d+(MM|CM|CV|PSI|LPM|GPD|KG|ML|M3H|M3|V|W|L|M)$/.test(w);
    const modelos = (t: string[]) => {
      const m = t.filter(modelo);
      for (let i = 0; i + 1 < t.length; i++) if (/^[A-Z]$/.test(t[i]) && /^\d[A-Z0-9]*$/.test(t[i + 1])) m.push(t[i] + t[i + 1]);
      return m;
    };
    const mA = modelos(alvo), mB = modelos(it.tok);
    if (mA.length && mB.length && !mA.some((x) => mB.includes(x))) nome *= 0.55;
    // precisa de ao menos uma PALAVRA em comum (medida sozinha não identifica o item)
    const pal = (w: string) => /^[A-Z]{3,}$/.test(w);
    const pA = alvo.filter(pal), pB = it.tok.filter(pal);
    if (pA.length && !pA.some((w) => pB.some((p) => p === w || (w.length >= 4 && p.length >= 4 && (p.startsWith(w) || w.startsWith(p)))))) nome *= 0.3;
    if (nome < 0.2) continue;
    let s = nome;
    const motivo: string[] = [`nome ${Math.round(nome * 100)}%`];
    const ref = it.ultimo_preco ?? it.cmc;
    if (custo && custo > 0 && ref && ref > 0) {
      const d = Math.abs(custo - ref) / Math.max(custo, ref);
      if (d <= 0.02) { s += 0.1 * nome; motivo.push(`mesmo preço (R$ ${brl(ref)})`); }
      else if (d <= 0.1) { s += 0.07 * nome; motivo.push(`preço perto (R$ ${brl(ref)})`); }
      else if (d <= 0.3) { s += 0.03 * nome; motivo.push(`preço ±${Math.round(d * 100)}%`); }
      else if (d >= 0.7) { s -= 0.1; motivo.push(`preço muito diferente (R$ ${brl(ref)})`); }
    }
    if (un && it.un) {
      if (normUn(it.un) === un) { s += 0.03; } else { s -= 0.03; motivo.push(`unidade ${it.un}`); }
    }
    out.push({ id: it.id, cod: it.cod, desc: it.desc, un: it.un, cmc: it.cmc, ultimo_preco: it.ultimo_preco,
      score: Math.max(0, Math.min(1, Math.round(s * 1000) / 1000)), motivo: motivo.join(" · ") });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.max(1, Math.min(top, 10)));
}
