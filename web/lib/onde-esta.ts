// "Onde está?" (09/10/26) — quando a busca de uma tela da Operação não acha nada,
// a tela pergunta ao servidor em que outra tela o número vive (PC 7119 procurado
// em PCs standalone mora em Vendas avulsas › PV1861). Regra do Benny: quando o
// usuário não encontra, o sistema avisa e guia.
//
// Aqui fica só a parte pura (interpretar o termo e montar o rótulo/link), usada
// pela rota /api/operacao/onde-esta e pela tela.

export type TelaOp = "avulsos" | "pcs" | "projetos";

export const TELA_LABEL: Record<TelaOp, string> = {
  avulsos: "Vendas avulsas",
  pcs: "PCs standalone",
  projetos: "Projetos",
};

export type Termo =
  | { tipo: "numero"; n: string; variantes: string[] }
  | { tipo: "pvos"; label: string; n: string; variantes: string[] }
  | { tipo: "pj"; prefixo: string }
  | { tipo: "texto"; t: string };

/** Interpreta o que o usuário digitou. Números saem com e sem zeros à esquerda
 *  (o Omie grava "00001575" numas colunas e "1575" noutras). */
export function interpretarTermo(qRaw: string): Termo | null {
  const q = qRaw.trim().replace(/\s+/g, " ");
  if (q.length < 2) return null;
  const sem = q.replace(/[\s.\-\/]/g, "");
  if (/^\d+$/.test(sem)) {
    const n = sem.replace(/^0+/, "") || "0";
    return { tipo: "numero", n, variantes: variantesNumero(n, sem) };
  }
  const pv = /^(PV|OS)#?(\d+)$/i.exec(sem);
  if (pv) {
    const n = pv[2].replace(/^0+/, "") || "0";
    return { tipo: "pvos", label: `${pv[1].toUpperCase()}${n}`, n, variantes: variantesNumero(n, pv[2]) };
  }
  const pj = /^PJ_?(\d+)$/i.exec(sem);
  if (pj) return { tipo: "pj", prefixo: `PJ${pj[1].replace(/^0+/, "") || "0"}` };
  // Texto livre (cliente, fornecedor, projeto). Tira o que quebra o filtro do PostgREST.
  const t = q.replace(/[,()*%"\\:]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 3 ? { tipo: "texto", t } : null;
}

export function variantesNumero(n: string, original?: string): string[] {
  const v = new Set<string>([n]);
  if (original) v.add(original);
  for (const w of [4, 5, 6, 8, 9]) if (n.length < w) v.add(n.padStart(w, "0"));
  return [...v];
}

/** O projeto bate com "PJ366"? (PJ366, PJ366_Caruaru, "PJ366 - X"; não PJ3661). */
export function bateProjeto(nome: string | null | undefined, prefixo: string): boolean {
  const m = /^PJ_?0*(\d+)/i.exec(String(nome ?? "").trim());
  return !!m && `PJ${m[1]}` === prefixo.toUpperCase();
}

export type Achado = {
  tela: TelaOp;
  /** O que bateu: "PC 7119", "RC 7119", "NF 1575", "PV1861", "PJ366"… */
  oQue: string;
  /** Onde está dentro da tela: "PV1861 (UNIMED CAMPINA GRANDE)". */
  onde: string;
  faturado: boolean;
  /** Link que abre a tela já com a busca. */
  href: string;
  /** PC escondido em "PCs excluídos" — está na tela, mas fora da lista. */
  escondido?: boolean;
};

export type RespostaOndeEsta = {
  q: string;
  achados: Achado[];
  /** Quando não está em nenhuma tela da Operação: o que se sabe (Omie, Compras…). */
  fora?: { msg: string; href?: string; hrefLabel?: string } | null;
  mais?: boolean;
};

export function hrefTela(tela: TelaOp, q: string, extra?: Record<string, string>): string {
  const p = new URLSearchParams({ q, escopo: "todos", ...(extra ?? {}) });
  return `/${tela}?${p}`;
}
