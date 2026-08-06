"use client";

// Pizza / rosca — composição de um total. 12 cards no Metabase.
//
// Restrição deliberada: no máximo 6 fatias. Acima disso o olho não compara
// ângulos e a leitura vira adivinhação — o excedente colapsa em "Outros", com o
// detalhe disponível na tabela do ChartFrame. Pizza também não aceita valor
// negativo: "parte de um total" não tem sentido negativo, então filtramos e
// avisamos em vez de desenhar algo sem significado.
//
// Rosca (donut) por default: o buraco central dá lugar ao total, que é o número
// que o leitor procura primeiro.

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHROME, seriesColor, MAX_SERIES } from "@/lib/viz/palette";
import { shadowId } from "./vizDefs";
import { useVizTema } from "./useVizMode";

export const PIE_MAX_SLICES = 6;

export type PieSlice = { label: string; value: number };

/** Colapsa em "Outros" o que passar do limite e descarta negativos. Exportado
 *  pra quem monta a tabela poder mostrar exatamente as mesmas fatias. */
export function preparePieSlices(input: PieSlice[], max = PIE_MAX_SLICES) {
  const positivos = input.filter((s) => Number.isFinite(s.value) && s.value > 0);
  const descartados = input.length - positivos.length;
  const ord = [...positivos].sort((a, b) => b.value - a.value);
  if (ord.length <= max) return { slices: ord, descartados };
  const head = ord.slice(0, max - 1);
  const resto = ord.slice(max - 1).reduce((acc, s) => acc + s.value, 0);
  return { slices: [...head, { label: "Outros", value: resto }], descartados };
}

export default function VizPie({
  slices, valueFormat, total, totalLabel,
}: {
  slices: PieSlice[];
  valueFormat?: (v: number) => string;
  /** Número no centro. Se omitido, soma as fatias. */
  total?: number;
  totalLabel?: string;
}) {
  const { mode, tema } = useVizTema();
  const c = CHROME[mode];
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString("pt-BR"));
  const { slices: data } = preparePieSlices(slices);
  const soma = total ?? data.reduce((a, s) => a + s.value, 0);

  if (data.length === 0) {
    return <p className="text-[11.5px] text-ww-textFaint p-4">Sem valores positivos no período.</p>;
  }
  if (data.length > MAX_SERIES) {
    // Não deveria acontecer (preparePieSlices limita), mas falhar alto é melhor
    // que ciclar cor silenciosamente.
    throw new Error("VizPie: mais fatias que slots de paleta");
  }

  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <defs>
            {/* Sombra projetada dá relevo à rosca inteira. A fatia continua
                PLANA de propósito: inclinar a pizza distorce a área aparente e
                a fatia da frente passa a parecer maior que uma igual atrás. */}
            <filter id={shadowId(mode)} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="2.5"
                            floodColor={mode === "dark" ? "#000000" : "#0f1e3a"}
                            floodOpacity={mode === "dark" ? 0.32 : 0.10} />
            </filter>
            {data.map((_, i) => (
              <radialGradient key={i} id={`wwPie-${i}-${mode}`} cx="50%" cy="50%" r="72%">
                <stop offset="55%"  stopColor={seriesColor(i, mode, tema)} stopOpacity={0.90} />
                <stop offset="100%" stopColor={seriesColor(i, mode, tema)} stopOpacity={1} />
              </radialGradient>
            ))}
          </defs>
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="58%"
            outerRadius="88%"
            // 2px de superfície entre fatias
            stroke={c.surface}
            strokeWidth={2}
            filter={`url(#${shadowId(mode)})`}
            isAnimationActive={false}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={`url(#wwPie-${i}-${mode})`} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: c.surface, border: `1px solid ${c.gridline}`,
              borderRadius: 8, fontSize: 11.5, color: c.ink, padding: "6px 8px",
            }}
            formatter={(v, name) => {
              const n = Number(v);
              const pct = soma > 0 ? ` · ${((n / soma) * 100).toFixed(1)}%` : "";
              return [`${fmt(n)}${pct}`, String(name)];
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Total no miolo — texto em token de texto, nunca na cor de série. */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-[17px] font-bold text-ww-text leading-none">{fmt(soma)}</span>
        {totalLabel && <span className="text-[10px] text-ww-textFaint mt-0.5">{totalLabel}</span>}
      </div>
    </div>
  );
}
