// Casa o item da lista de materiais com o item comprado no pedido do Omie.
//
// Os dois lados descrevem a mesma peça com nomenclaturas diferentes: a lista
// diz "BROCA AÇO RAPIDO 8 MM", o cadastro do Omie diz "BROCA ACO RAP. (A)
// 08MM IRWIN". O que NÃO pode variar é a medida — um joelho de 1" não é um
// joelho de 3/4", por mais parecido que o resto da frase seja. Por isso a
// bitola é barreira, não peso: foi ela que, num teste com os 62 itens do
// PJ361, impediu que os dois joelhos de 45° casassem com o mesmo pedido.
//
// Medido nesse projeto: 29 casam por texto idêntico, 15 por similaridade e
// 18 ficam para vínculo manual (não têm mesmo pedido correspondente).

export const deHtml = (s: string) => String(s ?? "")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const STOP = new Set(["DE","DA","DO","EM","PARA","COM","SEM","POR","UND","UNID","UN","PC","PCS","E","A","O","AO","NA","NO","TIPO","MODELO"]);

export function tokens(t: string): string[] {
  const s = deHtml(t).toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/Ø/g, " ").replace(/["']/g, " ")
    .replace(/(\d)[.,](\d)/g, "$1/$2")          // 3.4 -> 3/4
    .replace(/[^A-Z0-9/]+/g, " ")
    /* Medida primeiro: "8 MM" tem de virar "8MM" ANTES da regra que cola
       número em palavra — senão "RAPIDO 8 MM" vira "RAPIDO8 MM" e a medida
       desaparece (foi o que apagou todas as brocas no primeiro teste). */
    .replace(/\b(\d+(?:\/\d+)?)\s+(MM|CM|CV|PSI|LPM|GPD|KG|ML)\b/g, "$1$2")
    .replace(/\b([A-Z]{2,4})\s+(\d+)\b/g, "$1$2");   // KPI 35 -> KPI35
  return s.split(" ")
    .filter((w) => w && w.length >= 2 && !STOP.has(w))
    .map((w) => w.replace(/^0+(\d)/, "$1"));         // 05MM -> 5MM
}

function medidas(toks: string[]): Set<string> {
  const m = new Set<string>();
  for (const w of toks) {
    if (/^\d+\/\d+$/.test(w)) m.add(w);
    else if (/^\d+(\/\d+)?(MM|CM|CV|PSI|LPM|GPD|V|W|A)$/.test(w)) m.add(w);
    else if (/^\d{2,}$/.test(w)) m.add(w);
  }
  return m;
}

export function construirIdf(listas: string[][]): Map<string, number> {
  const df = new Map<string, number>(); const N = listas.length || 1;
  for (const toks of listas) for (const w of new Set(toks)) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = new Map<string, number>();
  for (const [w, d] of df) idf.set(w, Math.log(1 + N / d));
  return idf;
}

export function pontuar(alvoTok: string[], pcTok: string[], idf: Map<string, number>): number {
  if (!alvoTok.length || !pcTok.length) return 0;
  const set = new Set(pcTok);
  let bom = 0, tot = 0;
  for (const w of alvoTok) {
    const peso = idf.get(w) ?? 1;
    tot += peso;
    if (set.has(w)) { bom += peso; continue; }
    /* "RAP." é a abreviatura de "RAPIDO" no cadastro: prefixo de 3 letras
       já é sinal, e exigir 4 deixava a broca inteira de fora. */
    if (w.length >= 3 && pcTok.some((p) => p.startsWith(w) || (w.startsWith(p) && p.length >= 3))) bom += peso * 0.8;
  }
  const cobertura = tot ? bom / tot : 0;
  const setA = new Set(alvoTok);
  const inv = pcTok.filter((w) => setA.has(w)).length / pcTok.length;
  let s = cobertura * 0.8 + inv * 0.2;

  const mA = medidas(alvoTok), mB = medidas(pcTok);
  if (mA.size && mB.size) {
    let comuns = 0;
    for (const x of mA) if (mB.has(x)) comuns++;
    if (!comuns) s *= 0.25;
    else s = Math.min(1, s * (1 + 0.15 * (comuns / mA.size)));
  }
  /* A bitola escapa da regra acima porque 1" é um dígito só. Fração num lado
     e não no outro também conta como divergência — é assim que o joelho de
     1" acha o "cola, 1" e o de 3/4" acha o "3/4' COLA". */
  const fA = alvoTok.filter((w) => /^\d+\/\d+$/.test(w));
  const fB = pcTok.filter((w) => /^\d+\/\d+$/.test(w));
  if (fA.length && fB.length) { if (!fA.some((x) => fB.includes(x))) s *= 0.25; }
  else if (fA.length !== fB.length) s *= 0.55;
  return s;
}

export type ItemPc = { pc: string; desc: string };
export type Palpite = {
  id: string; item: string;
  pc: string | null; score: number; via: "exato" | "similar" | "nenhum";
  descPc: string;
};

/** Limiar do automático. Abaixo dele o palpite vira sugestão para o humano —
    medido com os 62 itens do PJ361: 0,55 entra no ROTAMETRO e no ENGATE
    (ambos certos) e para antes do primeiro errado, em 0,46. */
export const LIMIAR = 0.55;

export function casarItens(
  itens: Array<{ id: string; item: string }>,
  itensPc: ItemPc[],
): Palpite[] {
  const tokPc = itensPc.map((p) => tokens(p.desc));
  const idf = construirIdf([...itens.map((i) => tokens(i.item)), ...tokPc]);
  const norm = (s: string) => deHtml(s).trim().toUpperCase().replace(/\s+/g, " ");
  return itens.map((it) => {
    const exato = itensPc.findIndex((p) => norm(p.desc) === norm(it.item));
    if (exato >= 0) {
      return { id: it.id, item: it.item, pc: itensPc[exato].pc, score: 1,
               via: "exato" as const, descPc: deHtml(itensPc[exato].desc) };
    }
    const a = tokens(it.item);
    let melhor = -1, s1 = 0;
    tokPc.forEach((t, i) => { const s = pontuar(a, t, idf); if (s > s1) { s1 = s; melhor = i; } });
    if (melhor < 0 || s1 < LIMIAR) {
      return { id: it.id, item: it.item, pc: null, score: s1, via: "nenhum" as const,
               descPc: melhor >= 0 ? deHtml(itensPc[melhor].desc) : "" };
    }
    return { id: it.id, item: it.item, pc: itensPc[melhor].pc, score: s1,
             via: "similar" as const, descPc: deHtml(itensPc[melhor].desc) };
  });
}
