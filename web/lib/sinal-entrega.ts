// Sinal de entrega da linha da lista de materiais (07/10/26): a compra chega a
// tempo do "Necessário em"? Pura — testada em scripts/testes/sinal-entrega.test.ts.

/** Folga (dias) antes da data necessária: chegar dentro dela já é risco. Mude aqui. */
export const FOLGA_ENTREGA_DIAS = 3;

/** Dois conceitos separados (07/10/26, Benny — PJ361):
 *  · nível (✓/⚠/✕) = PRAZO × NECESSIDADE: a chegada efetiva contra a data necessária;
 *  · pcAtrasadoDias = o PC passou da própria previsão sem chegar (mostrado na célula da chegada).
 *  Chegada efetiva: recebido → a data do recebimento; PC → max(previsão do PC, hoje) (previsão
 *  vencida sem chegar = "chega hoje no melhor caso"); sem PC → hoje + prazo médio (estimada). */
export type SinalEntrega = {
  nivel: "ok" | "risco" | "atrasado"; chegada: string | null; estimada: boolean; folga: number | null; motivo: string;
  /** previsão do PC (a data que o PC promete), quando há */ previsaoPc: string | null;
  /** dias que o PC já passou da previsão sem chegar (0 = em dia) */ pcAtrasadoDias: number;
  recebido: boolean;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
const addDias = (base: string, n: number) => { const d = new Date(`${base}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function sinalEntrega(a: {
  necessario: string | null | undefined;
  recebidoEm?: string | null; recebido?: boolean;
  temPc: boolean; previsaoPc?: string | null;
  prazoDias?: number | null; hoje?: string; folgaDias?: number;
  /** de onde veio o prazo (ex.: "ajustado no item") — só entra no texto do motivo (sql/141) */
  prazoFonte?: string | null;
}): SinalEntrega | null {
  const nec = a.necessario && /^\d{4}-\d{2}-\d{2}/.test(a.necessario) ? a.necessario.slice(0, 10) : null;
  const hoje = a.hoje ?? iso(new Date());
  const folgaMin = a.folgaDias ?? FOLGA_ENTREGA_DIAS;
  const prevPc = a.temPc && a.previsaoPc && /^\d{4}-\d{2}-\d{2}/.test(a.previsaoPc) ? a.previsaoPc.slice(0, 10) : null;
  const base = { previsaoPc: prevPc, pcAtrasadoDias: 0, recebido: false };
  if (a.recebido || a.recebidoEm) {
    const ch = a.recebidoEm ? a.recebidoEm.slice(0, 10) : null;
    if (!nec) return null;
    return { ...base, recebido: true, nivel: "ok", chegada: ch, estimada: false, folga: ch ? dias(nec, ch) : null, motivo: `recebido${ch ? ` em ${br(ch)}` : ""}` };
  }
  let chegada: string | null = null, estimada = false, pcAtrasadoDias = 0, porque = "";
  if (a.temPc) {
    if (!prevPc) {
      if (!nec) return null;
      if (dias(nec, hoje) < 0) return { ...base, nivel: "atrasado", chegada: null, estimada: false, folga: dias(nec, hoje), motivo: `necessário ${br(nec)} já passou e não foi recebido` };
      return { ...base, nivel: "risco", chegada: null, estimada: false, folga: null, motivo: "PC sem previsão de entrega — não dá para saber se chega a tempo" };
    }
    if (dias(prevPc, hoje) < 0) {
      pcAtrasadoDias = dias(hoje, prevPc);
      chegada = hoje;
      porque = `chegada efetiva hoje (PC atrasado ${pcAtrasadoDias}d, previsão era ${br(prevPc)})`;
    } else { chegada = prevPc; porque = `chegada prev. ${br(prevPc)} (PC)`; }
  } else if (a.prazoDias == null || !(Number(a.prazoDias) > 0)) {
    // sem PC e sem prazo médio no catálogo: não dá para estimar a chegada
    if (!nec) return null;
    if (dias(nec, hoje) < 0) return { ...base, nivel: "atrasado", chegada: null, estimada: true, folga: dias(nec, hoje), motivo: `necessário ${br(nec)} já passou e não foi recebido` };
    return { ...base, nivel: "risco", chegada: null, estimada: true, folga: null, motivo: "sem PC e sem prazo médio no catálogo — não dá para estimar a chegada" };
  } else {
    chegada = addDias(hoje, Math.max(0, Number(a.prazoDias) || 0));
    estimada = true;
    porque = `chegada ≈ ${br(chegada)} (sem PC: hoje + prazo de ${Math.max(0, Number(a.prazoDias) || 0)}d${a.prazoFonte ? `, ${a.prazoFonte}` : ""})`;
  }
  if (!nec) return { ...base, pcAtrasadoDias, nivel: "ok", chegada, estimada, folga: null, motivo: porque };
  const f = dias(nec, chegada);
  const r = (nivel: SinalEntrega["nivel"], sinal: string): SinalEntrega =>
    ({ ...base, pcAtrasadoDias, nivel, chegada, estimada, folga: f, motivo: `${porque} · necessário ${br(nec)} · folga ${f}d → ${sinal}` });
  if (dias(nec, hoje) < 0) return { ...r("atrasado", "✕"), motivo: `necessário ${br(nec)} já passou e não foi recebido` };
  if (f < 0) return r("atrasado", "✕ chega depois do necessário");
  if (f < folgaMin) return r("risco", `⚠ menos de ${folgaMin}d de folga`);
  return r("ok", "✓");
}
