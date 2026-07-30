"use client";

// Linha / área — mudança ao longo do tempo. Cobre `line` (5 cards) e serve de
// base pro combo.
//
// Specs de mark: traço 2px, marcador ≥8px, hit target de 24px, crosshair que
// SNAPA na posição de dado mais próxima (o leitor mira numa data, não numa
// linha de 2px), e um tooltip só listando todas as séries naquele X.

import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHROME, seriesColor } from "@/lib/viz/palette";
import { useVizMode } from "./useVizMode";
import type { SeriesDef } from "./ChartFrame";

export default function VizLine({
  rows, series, xKey = "x", valueFormat, area = false, stacked = false,
}: {
  rows: Array<Record<string, unknown>>;
  series: SeriesDef[];
  xKey?: string;
  valueFormat?: (v: number) => string;
  area?: boolean;
  stacked?: boolean;
}) {
  const mode = useVizMode();
  const c = CHROME[mode];
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString("pt-BR"));
  const axisTick = { fontSize: 10.5, fill: c.inkMuted };

  const Chart = area ? AreaChart : LineChart;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <Chart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        {/* Grid só na horizontal — linha vertical compete com o crosshair. */}
        <CartesianGrid horizontal vertical={false} stroke={c.gridline} />
        <XAxis dataKey={xKey} tick={axisTick} stroke={c.axis} />
        <YAxis tick={axisTick} stroke={c.axis} tickFormatter={(v) => fmt(Number(v))} />
        <Tooltip
          // Crosshair: hairline vertical que acha o X. Recharts já snapa no ponto.
          cursor={{ stroke: c.axis, strokeWidth: 1 }}
          contentStyle={{
            background: c.surface, border: `1px solid ${c.gridline}`,
            borderRadius: 8, fontSize: 11.5, color: c.ink, padding: "6px 8px",
          }}
          labelStyle={{ color: c.inkMuted, fontSize: 10.5, marginBottom: 2 }}
          formatter={(v, name) => [fmt(Number(v)), String(name)]}
        />
        {series.map((s) => {
          const col = seriesColor(s.slot, mode);
          return area ? (
            <Area
              key={s.key} dataKey={s.key} name={s.label}
              stackId={stacked ? "s" : undefined}
              stroke={col} strokeWidth={2}
              fill={col} fillOpacity={0.16}
              // Anel de 2px da superfície em marks que se sobrepõem.
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: c.surface }}
              dot={false}
              isAnimationActive={false}
            />
          ) : (
            <Line
              key={s.key} dataKey={s.key} name={s.label}
              stroke={col} strokeWidth={2}
              dot={false}
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: c.surface }}
              isAnimationActive={false}
            />
          );
        })}
      </Chart>
    </ResponsiveContainer>
  );
}
