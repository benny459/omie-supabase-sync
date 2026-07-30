"use client";

// Combo (barra + linha) de UM ÚNICO EIXO.
//
// Por que não existe eixo duplo aqui: duas escalas no mesmo desenho fazem o
// leitor ver cruzamentos e correlações que são artefato do escalonamento, não do
// dado — mover uma escala muda a "conclusão" sem mudar um número. É considerado
// o erro nº 1 de visualização.
//
// 13 dos 20 combos do Metabase têm série fixada no eixo direito. Para portar
// esses, escolha UMA das saídas:
//   1. Dois gráficos empilhados (o mais honesto quando as medidas não se somam)
//   2. Indexar as duas medidas a uma base comum (ambas = 100 no início)
//   3. Converter a segunda medida pra mesma unidade da primeira
// `mode="indexado"` implementa a 2 aqui dentro.

import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHROME, seriesColor } from "@/lib/viz/palette";
import { useVizMode } from "./useVizMode";
import type { SeriesDef } from "./ChartFrame";

export default function VizCombo({
  rows, bars, lines, xKey = "x", valueFormat, mode: scaleMode = "mesma-unidade",
}: {
  rows: Array<Record<string, unknown>>;
  bars: SeriesDef[];
  lines: SeriesDef[];
  xKey?: string;
  valueFormat?: (v: number) => string;
  /** "mesma-unidade": barras e linhas já compartilham escala.
   *  "indexado": tudo vira índice base 100 no primeiro ponto — use quando as
   *  medidas têm unidades diferentes e você quer comparar a FORMA das curvas. */
  mode?: "mesma-unidade" | "indexado";
}) {
  const vizMode = useVizMode();
  const c = CHROME[vizMode];
  const all = [...bars, ...lines];
  const indexado = scaleMode === "indexado";

  // Base 100: divide cada série pelo seu primeiro valor não-nulo. Assim as duas
  // medidas convivem num eixo só sem mentir sobre magnitude — o eixo passa a ser
  // "variação relativa", que é o que o leitor de fato compara.
  const data = indexado
    ? (() => {
        const base = new Map<string, number>();
        for (const s of all) {
          const first = rows.map((r) => Number(r[s.key])).find((v) => Number.isFinite(v) && v !== 0);
          if (first != null) base.set(s.key, first);
        }
        return rows.map((r) => {
          const out: Record<string, unknown> = { [xKey]: r[xKey] };
          for (const s of all) {
            const b = base.get(s.key);
            const v = Number(r[s.key]);
            out[s.key] = b && Number.isFinite(v) ? (v / b) * 100 : null;
          }
          return out;
        });
      })()
    : rows;

  const fmt = indexado
    ? (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`
    : (valueFormat ?? ((v: number) => v.toLocaleString("pt-BR")));

  const axisTick = { fontSize: 10.5, fill: c.inkMuted };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="26%" barGap={2}>
        <CartesianGrid horizontal vertical={false} stroke={c.gridline} />
        <XAxis dataKey={xKey} tick={axisTick} stroke={c.axis} />
        {/* UM eixo. Sempre. */}
        <YAxis tick={axisTick} stroke={c.axis} tickFormatter={(v) => fmt(Number(v))} />
        <Tooltip
          cursor={{ fill: vizMode === "dark" ? "#ffffff12" : "#0000000a" }}
          contentStyle={{
            background: c.surface, border: `1px solid ${c.gridline}`,
            borderRadius: 8, fontSize: 11.5, color: c.ink, padding: "6px 8px",
          }}
          labelStyle={{ color: c.inkMuted, fontSize: 10.5, marginBottom: 2 }}
          formatter={(v, name) => [indexado ? `${fmt(Number(v))} (base 100)` : fmt(Number(v)), String(name)]}
        />
        {bars.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label}
               fill={seriesColor(s.slot, vizMode)} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        ))}
        {lines.map((s) => (
          <Line key={s.key} dataKey={s.key} name={s.label}
                stroke={seriesColor(s.slot, vizMode)} strokeWidth={2} dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: c.surface }} isAnimationActive={false} />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
