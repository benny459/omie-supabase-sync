"use client";

// Barras — vertical (magnitude no tempo/categoria) e horizontal (`layout="row"`,
// pra categoria com nome comprido ou ranking). Cobre os tipos `bar` e `row` do
// Metabase, que juntos são 48 dos 200 cards.
//
// Especificações de mark que vêm da skill, não de gosto:
//  • marks finos, ponta arredondada 4px ancorada na baseline
//  • 2px de superfície entre fatias empilhadas e entre barras vizinhas
//  • a barra É o hit target — sem crosshair; hover levanta o mark
//  • grid/eixo recessivos; rótulo de valor seletivo, nunca em todo ponto
//  • UM eixo. Duas medidas de escala diferente = dois gráficos.

import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHROME, seriesColor } from "@/lib/viz/palette";
import { useVizMode } from "./useVizMode";
import type { SeriesDef } from "./ChartFrame";

export default function VizBar({
  rows, series, layout = "column", stacked = false, valueFormat, xKey = "x",
}: {
  rows: Array<Record<string, unknown>>;
  series: SeriesDef[];
  layout?: "column" | "row";
  stacked?: boolean;
  valueFormat?: (v: number) => string;
  xKey?: string;
}) {
  const mode = useVizMode();
  const c = CHROME[mode];
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString("pt-BR"));
  const horizontal = layout === "row";

  const axisTick = { fontSize: 10.5, fill: c.inkMuted };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        layout={horizontal ? "vertical" : "horizontal"}
        margin={{ top: 4, right: 8, bottom: 0, left: horizontal ? 8 : 0 }}
        barCategoryGap={horizontal ? "22%" : "26%"}
        // 2px de superfície entre barras vizinhas do mesmo grupo
        barGap={2}
      >
        <CartesianGrid
          // Grid só no eixo do valor — linha no eixo da categoria é ruído.
          horizontal={!horizontal}
          vertical={horizontal}
          stroke={c.gridline}
          strokeDasharray="0"
        />
        {horizontal ? (
          <>
            <XAxis type="number" tick={axisTick} stroke={c.axis} tickFormatter={(v) => fmt(Number(v))} />
            <YAxis type="category" dataKey={xKey} tick={axisTick} stroke={c.axis} width={110} />
          </>
        ) : (
          <>
            <XAxis type="category" dataKey={xKey} tick={axisTick} stroke={c.axis} />
            <YAxis type="number" tick={axisTick} stroke={c.axis} tickFormatter={(v) => fmt(Number(v))} />
          </>
        )}

        <Tooltip
          // Um tooltip lista TODAS as séries naquele X — o ponteiro nunca precisa
          // acertar a fatia certa. Valor em destaque, nome da série secundário.
          cursor={{ fill: mode === "dark" ? "#ffffff12" : "#0000000a" }}
          contentStyle={{
            background: c.surface, border: `1px solid ${c.gridline}`,
            borderRadius: 8, fontSize: 11.5, color: c.ink, padding: "6px 8px",
          }}
          labelStyle={{ color: c.inkMuted, fontSize: 10.5, marginBottom: 2 }}
          formatter={(v, name) => [fmt(Number(v)), String(name)]}
        />

        {series.map((s, i) => {
          const last = i === series.length - 1;
          // Ponta arredondada só na extremidade livre da pilha; o resto fica reto
          // pra a barra ficar ancorada na baseline.
          const radius: [number, number, number, number] = horizontal
            ? (!stacked || last ? [0, 4, 4, 0] : [0, 0, 0, 0])
            : (!stacked || last ? [4, 4, 0, 0] : [0, 0, 0, 0]);
          return (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId={stacked ? "s" : undefined}
              fill={seriesColor(s.slot, mode)}
              radius={radius}
              // 2px de superfície entre fatias empilhadas
              stroke={stacked ? c.surface : undefined}
              strokeWidth={stacked ? 2 : 0}
              isAnimationActive={false}
            >
              {/* Cor por ENTIDADE: um Cell por row garante que reordenar/filtrar
                  não repinta quem sobrou. */}
              {rows.map((_, ri) => (
                <Cell key={ri} fill={seriesColor(s.slot, mode)} />
              ))}
            </Bar>
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
