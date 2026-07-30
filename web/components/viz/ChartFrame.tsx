"use client";

// Moldura de todo gráfico do painel: título, legenda, toggle de tabela e o
// comportamento de recarga.
//
// O toggle de tabela NÃO é enfeite. No modo claro, três slots da paleta ficam
// abaixo de 3:1 contra o branco (aqua 2.82, amarelo 2.17, magenta 2.69) — o
// validador marca WARN e isso obriga "alívio": rótulo direto visível OU visão de
// tabela. A tabela também é o caminho de acessibilidade (todo valor alcançável
// sem hover) e o destino dos rótulos que não couberam dentro de barras curtas.
// Remover o toggle quebra as duas garantias de uma vez.
//
// Legenda: presente sempre que houver 2+ séries (identidade nunca só pela cor).
// Série única não leva legenda — o título já a nomeia.

import { useId, useState } from "react";
import { CHROME, seriesColor } from "@/lib/viz/palette";
import { useVizMode } from "./useVizMode";

export type SeriesDef = {
  key: string;
  label: string;
  /** Slot da paleta. Fixo por ENTIDADE — não pode mudar quando um filtro
   *  altera a quantidade de séries, senão a cor viraria ranking. */
  slot: number;
  /** Marca na legenda: linha pra série de linha, retângulo pra barra/área. */
  mark?: "rect" | "line";
};

export default function ChartFrame({
  title, subtitle, series, rows, valueFormat, loading, children, height = 260,
}: {
  title: string;
  subtitle?: string;
  series: SeriesDef[];
  /** Dados crus — alimentam a visão de tabela. Mesma fonte do gráfico. */
  rows: Array<Record<string, unknown>>;
  /** Formatador dos valores na tabela (R$, %, etc). */
  valueFormat?: (v: unknown) => string;
  /** Recarregando: mantém o render anterior em opacidade menor. Sem skeleton,
   *  sem salto de layout — a moldura não pisca. */
  loading?: boolean;
  children: React.ReactNode;
  height?: number;
}) {
  const [asTable, setAsTable] = useState(false);
  const mode = useVizMode();
  const chrome = CHROME[mode];
  const tableId = useId();

  const fmt = valueFormat ?? ((v: unknown) => (v == null ? "—" : String(v)));

  return (
    // viz-panel: no tema escuro ganha fio de luz no topo e brilho interno (ver
    // globals.css). No claro é um card normal — o efeito só faz sentido sobre
    // superfície escura.
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 transition-colors">
      <header className="flex items-start gap-3 mb-2.5">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-ww-text tracking-[-0.2px] truncate">{title}</h3>
          {subtitle && <p className="text-[11px] text-ww-textMuted mt-0.5">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          aria-expanded={asTable}
          aria-controls={tableId}
          className="shrink-0 px-2 py-0.5 text-[10.5px] font-semibold rounded border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition"
          title="Alterna entre gráfico e tabela — todo valor fica alcançável sem hover"
        >
          {asTable ? "Gráfico" : "Tabela"}
        </button>
      </header>

      {/* Legenda: só com 2+ séries. Marca espelha o tipo do mark no gráfico. */}
      {series.length >= 2 && !asTable && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
          {series.map((s) => (
            <li key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-ww-textMuted">
              {s.mark === "line" ? (
                <span aria-hidden className="inline-block w-3.5 h-0.5 rounded-full"
                      style={{ background: seriesColor(s.slot, mode) }} />
              ) : (
                <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm"
                      style={{ background: seriesColor(s.slot, mode) }} />
              )}
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {asTable ? (
        <div id={tableId} className="overflow-x-auto -mx-1">
          <table className="w-full text-[11.5px] border-collapse">
            <thead>
              <tr className="text-ww-textMuted">
                <th className="text-left font-semibold p-1 border-b border-ww-border">—</th>
                {series.map((s) => (
                  <th key={s.key} className="text-right font-semibold p-1 border-b border-ww-border whitespace-nowrap">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="hover:bg-ww-rowHover">
                  <td className="p-1 border-b border-ww-border/60 text-ww-text">{String(r.x ?? r.label ?? i)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="p-1 border-b border-ww-border/60 text-right tabular-nums text-ww-text">
                      {fmt(r[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }} className={`transition-opacity duration-150 ${loading ? "opacity-40" : "opacity-100"}`}>
          {children}
        </div>
      )}

      {/* Grid/eixo recessivos — o dado é que tem peso visual, não o cromo. */}
      <span className="hidden" aria-hidden data-grid={chrome.gridline} data-axis={chrome.axis} />
    </section>
  );
}
