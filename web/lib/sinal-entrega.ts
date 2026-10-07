// Sinal de entrega da linha da lista de materiais (07/10/26): a compra chega a
// tempo do "Necessário em"? Pura — testada em scripts/testes/sinal-entrega.test.ts.

/** Folga (dias) antes da data necessária: chegar dentro dela já é risco. Mude aqui. */
export const FOLGA_ENTREGA_DIAS = 3;

export type SinalEntrega = { nivel: "ok" | "risco" | "atrasado"; chegada: string | null; estimada: boolean; folga: number | null; motivo: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const dias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
const addDias = (base: string, n: number) => { const d = new Date(`${base}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

export function sinalEntrega(a: {
  necessario: string | null | undefined;
  recebidoEm?: string | null; recebido?: boolean;
  temPc: boolean; previsaoPc?: string | null;
  prazoDias?: number | null; hoje?: string; folgaDias?: number;
}): SinalEntrega | null {
  const nec = a.necessario && /^\d{4}-\d{2}-\d{2}/.test(a.necessario) ? a.necessario.slice(0, 10) : null;
  if (!nec) return null;
  const hoje = a.hoje ?? iso(new Date());
  const folga = a.folgaDias ?? FOLGA_ENTREGA_DIAS;
  if (a.recebido || a.recebidoEm) {
    const ch = a.recebidoEm ? a.recebidoEm.slice(0, 10) : null;
    return { nivel: "ok", chegada: ch, estimada: false, folga: ch ? dias(nec, ch) : null, motivo: "recebido" };
  }
  let chegada: string | null = null, estimada = false;
  if (a.temPc) {
    if (!a.previsaoPc) {
      if (dias(nec, hoje) < 0) return { nivel: "atrasado", chegada: null, estimada: false, folga: dias(nec, hoje), motivo: "necessário já passou e não foi recebido" };
      return { nivel: "risco", chegada: null, estimada: false, folga: null, motivo: "PC sem previsão de entrega" };
    }
    chegada = a.previsaoPc.slice(0, 10);
    // previsão do PC já passou e nada chegou: a data não vale mais — risco (ou atraso, se a necessária também passou)
    if (dias(chegada, hoje) < 0) {
      if (dias(nec, hoje) < 0) return { nivel: "atrasado", chegada, estimada: false, folga: dias(nec, chegada), motivo: "necessário já passou e não foi recebido" };
      return { nivel: "risco", chegada, estimada: false, folga: dias(nec, chegada), motivo: "previsão do PC vencida e ainda não recebido" };
    }
  } else {
    chegada = addDias(hoje, Math.max(0, Number(a.prazoDias) || 0));
    estimada = true;
  }
  const f = dias(nec, chegada);
  if (dias(nec, hoje) < 0) return { nivel: "atrasado", chegada, estimada, folga: f, motivo: "necessário já passou e não foi recebido" };
  if (f < 0) return { nivel: "atrasado", chegada, estimada, folga: f, motivo: estimada ? "pelo prazo médio, não chega a tempo" : "previsão do PC depois da data necessária" };
  if (f < folga) return { nivel: "risco", chegada, estimada, folga: f, motivo: estimada ? "sem PC e o prazo médio está apertado" : `chega com menos de ${folga} dias de folga` };
  return { nivel: "ok", chegada, estimada, folga: f, motivo: estimada ? "estimativa pelo prazo médio" : "previsão do PC dentro do prazo" };
}
