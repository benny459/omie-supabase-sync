"use client";

// Moldura de todo gráfico do painel: título, legenda, toggle de tabela e o
// comportamento de recarga.
//
// O toggle de tabela NÃO é enfeite, e o motivo mudou em 30/07/2026. Antes ele
// cobria o "alívio" exigido pelos 3 slots claros que ficavam sub-3:1; a rampa
// clara foi repassada e hoje os 8 passam contraste. O que ele cobre agora:
//  • a faixa 6–8 de CVD da rampa clara (ΔE 8.0), que só é legal COM codificação
//    secundária — legenda e tabela são essa codificação;
//  • acessibilidade: todo valor alcançável sem hover;
//  • destino do rótulo que não coube dentro de barra curta.
// Continua sendo errado remover.
//
// Legenda: presente sempre que houver 2+ séries (identidade nunca só pela cor).
// Série única não leva legenda — o título já a nomeia.
//
// A legenda também LIGA E DESLIGA cada série (06/08/2026). Num gráfico com
// entrada, saída e duas curvas de saldo, isolar uma delas é a única forma de ler
// sua forma sem as outras por cima. Série oculta continua na legenda, riscada:
// sumir da legenda tiraria justamente o botão que a traz de volta.
//
// Quem desenha decide o que fazer com a lista filtrada — por isso `children`
// pode ser uma função que recebe as séries visíveis.

import { useId, useState } from "react";
import { CHROME, seriesColor } from "@/lib/viz/palette";
import { useVizTema } from "./useVizMode";

export type SeriesDef = {
  key: string;
  label: string;
  /** Slot da paleta. Fixo por ENTIDADE — não pode mudar quando um filtro
   *  altera a quantidade de séries, senão a cor viraria ranking. */
  slot: number;
  /** Marca na legenda: linha pra série de linha, retângulo pra barra/área. */
  mark?: "rect" | "line";
  /** Preenchimento do mark. "vazada" = mesma cor, translúcida e contornada.
   *
   *  Serve pro caso "mesma medida em dois estados" — previsto × realizado,
   *  meta × atingido. Aí a COR tem que continuar dizendo de que medida se
   *  trata, e o estado vira outro canal. Dar uma quarta cor ao segundo estado
   *  quebra a regra de que cor segue a entidade: o leitor passa a procurar
   *  quatro coisas onde existem duas. */
  variante?: "solida" | "vazada";
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
  /** Nó fixo, ou função que recebe as séries VISÍVEIS (as que sobraram depois
   *  dos cliques na legenda). Use a função quando o gráfico deve reagir. */
  children: React.ReactNode | ((visiveis: SeriesDef[]) => React.ReactNode);
  height?: number;
}) {
  const [asTable, setAsTable] = useState(false);
  /** Séries desligadas pelo clique na legenda. Guarda as OCULTAS, não as
   *  visíveis: assim uma série nova nasce visível sem precisar de sincronização. */
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const { mode, tema } = useVizTema();
  const chrome = CHROME[mode];
  const tableId = useId();

  const fmt = valueFormat ?? ((v: unknown) => (v == null ? "—" : String(v)));

  // Nunca deixa esconder a última: um gráfico sem série nenhuma é uma moldura
  // vazia que parece defeito.
  const visiveis = series.filter((s) => !ocultas.has(s.key));
  const podeOcultar = (key: string) => visiveis.length > 1 || ocultas.has(key);
  const alternar = (key: string) => {
    if (!podeOcultar(key)) return;
    setOcultas((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  };

  return (
    // viz-panel: no tema escuro ganha fio de luz no topo e brilho interno (ver
    // globals.css). No claro é um card normal — o efeito só faz sentido sobre
    // superfície escura.
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 transition-all">
      {/* viz-head: faixa de cabeçalho com fundo próprio (ver globals.css) — é o
          que dá a leitura de "módulo" da referência, em vez de título solto. */}
      <header className="viz-head flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase truncate">{title}</h3>
          {subtitle && <p className="text-[11px] text-ww-textMuted mt-0.5 normal-case">{subtitle}</p>}
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

      {/* Legenda: só com 2+ séries. Marca espelha o tipo do mark no gráfico.
          Cada item é um botão que liga/desliga a própria série. */}
      {series.length >= 2 && !asTable && (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
          {series.map((s) => {
            const off = ocultas.has(s.key);
            const travada = !podeOcultar(s.key);
            return (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => alternar(s.key)}
                  aria-pressed={!off}
                  disabled={travada}
                  title={travada ? "A última série visível não pode ser ocultada"
                        : off ? `Mostrar ${s.label}` : `Ocultar ${s.label}`}
                  className={`inline-flex items-center gap-1.5 text-[11px] rounded px-1 -mx-1 py-0.5 transition ${
                    off ? "text-ww-textFaint line-through" : "text-ww-textMuted hover:text-ww-text"
                  } ${travada ? "cursor-default" : "cursor-pointer hover:bg-ww-rowHover"}`}
                >
                  {s.mark === "line" ? (
                    <span aria-hidden className="inline-block w-3.5 h-0.5 rounded-full transition-opacity"
                          style={{ background: seriesColor(s.slot, mode, tema), opacity: off ? 0.3 : 1 }} />
                  ) : (
                    // A marca espelha o preenchimento real do gráfico: cheia pra
                    // série sólida, contornada pra vazada. Sem isso o vazado na
                    // legenda vira só "a mesma cor mais fraca", que se confunde
                    // com o esmaecido de série desligada.
                    <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm transition-opacity"
                          style={{
                            background: seriesColor(s.slot, mode, tema),
                            opacity: off ? 0.3 : (s.variante === "vazada" ? 0.28 : 1),
                            border: s.variante === "vazada"
                              ? `1.5px solid ${seriesColor(s.slot, mode, tema)}` : undefined,
                            boxSizing: "border-box",
                          }} />
                  )}
                  {s.label}
                </button>
              </li>
            );
          })}
          {ocultas.size > 0 && (
            <li>
              <button type="button" onClick={() => setOcultas(new Set())}
                className="text-[10.5px] text-ww-accent hover:underline">
                mostrar todas
              </button>
            </li>
          )}
        </ul>
      )}

      {asTable ? (
        <div id={tableId} className="overflow-x-auto -mx-1">
          <table className="w-full text-[11.5px] border-collapse">
            <thead>
              <tr className="text-ww-textMuted">
                <th className="text-left font-semibold p-1 border-b border-ww-border">—</th>
                {visiveis.map((s) => (
                  <th key={s.key} className="text-right font-semibold p-1 border-b border-ww-border whitespace-nowrap">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="viz-row">
                  <td className="p-1 border-b border-ww-border/60 text-ww-text">{String(r.x ?? r.label ?? i)}</td>
                  {visiveis.map((s) => (
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
          {typeof children === "function" ? children(visiveis) : children}
        </div>
      )}

      {/* Grid/eixo recessivos — o dado é que tem peso visual, não o cromo. */}
      <span className="hidden" aria-hidden data-grid={chrome.gridline} data-axis={chrome.axis} />
    </section>
  );
}
