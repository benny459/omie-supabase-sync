"use client";

// Gauge e progresso — 13 cards no Metabase (10 gauge + 3 progress).
//
// Gauge é uma forma caríssima em pixel por bit de informação: mostra UM número
// contra UM alvo. Só se justifica quando a leitura é "estou dentro ou fora da
// faixa?" e a faixa é conhecida. Quando não há alvo, um StatTile responde melhor.
//
// Cor por FAIXA usa a paleta de status (reservada, nunca série), e sempre com o
// número visível ao lado — cor sozinha não carrega o significado. Sem alvo, usa
// o slot 1 da paleta categórica, porque aí não há juízo de "bom/ruim" a fazer.

import { CHROME, STATUS, seriesColor } from "@/lib/viz/palette";
import { useVizTema } from "./useVizMode";

export default function VizGauge({
  value, min = 0, max, label, valueFormat, target, higherIsBetter = true, variant = "arc",
}: {
  value: number;
  min?: number;
  max: number;
  label?: string;
  valueFormat?: (v: number) => string;
  /** Meta. Sem ela não há juízo de faixa e a cor fica neutra. */
  target?: number;
  higherIsBetter?: boolean;
  /** "arc" = gauge semicircular · "bar" = barra de progresso (o `progress`). */
  variant?: "arc" | "bar";
}) {
  const { mode, tema } = useVizTema();
  const c = CHROME[mode];
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString("pt-BR"));

  const span = Math.max(max - min, 1e-9);
  const pct = Math.min(Math.max((value - min) / span, 0), 1);

  // Faixa só quando há meta. 90% da meta = atenção; abaixo disso = crítico.
  let cor = seriesColor(0, mode, tema);
  let faixa: string | null = null;
  if (target != null && Number.isFinite(target) && target !== 0) {
    const razao = higherIsBetter ? value / target : target / Math.max(value, 1e-9);
    if (razao >= 1)        { cor = STATUS.good;     faixa = "na meta"; }
    else if (razao >= 0.9) { cor = STATUS.warning;  faixa = "perto da meta"; }
    else                   { cor = STATUS.critical; faixa = "abaixo da meta"; }
  }

  if (variant === "bar") {
    return (
      <div className="p-1">
        <div className="flex items-baseline justify-between gap-2 mb-1">
          <span className="text-[19px] font-bold text-ww-text leading-none">{fmt(value)}</span>
          <span className="text-[10.5px] text-ww-textFaint tabular-nums">{(pct * 100).toFixed(0)}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: c.gridline }}>
          <div className="h-full rounded-full transition-[width] duration-300"
               style={{ width: `${pct * 100}%`, background: cor }} />
        </div>
        {(label || faixa) && (
          <p className="mt-1 text-[10.5px] text-ww-textMuted">
            {label}{label && faixa ? " · " : ""}{faixa}
          </p>
        )}
      </div>
    );
  }

  // Arco semicircular em SVG. Raio 40 num viewBox 100×58.
  const R = 40, CX = 50, CY = 48;
  const arco = (frac: number) => {
    const ang = Math.PI * (1 - frac);
    return `${CX + R * Math.cos(ang)} ${CY - R * Math.sin(ang)}`;
  };
  const comprimento = Math.PI * R;

  return (
    <div className="flex flex-col items-center justify-center h-full p-1">
      <svg viewBox="0 0 100 58" className="w-full max-w-[190px]" role="img"
           aria-label={`${label ?? "Indicador"}: ${fmt(value)} de ${fmt(max)}`}>
        {/* Trilha */}
        <path d={`M ${arco(0)} A ${R} ${R} 0 0 1 ${arco(1)}`}
              fill="none" stroke={c.gridline} strokeWidth={8} strokeLinecap="round" />
        {/* Valor */}
        <path d={`M ${arco(0)} A ${R} ${R} 0 0 1 ${arco(1)}`}
              fill="none" stroke={cor} strokeWidth={8} strokeLinecap="round"
              strokeDasharray={comprimento} strokeDashoffset={comprimento * (1 - pct)} />
        {/* Marca da meta */}
        {target != null && target > min && target < max && (
          <circle cx={arco((target - min) / span).split(" ")[0]} cy={arco((target - min) / span).split(" ")[1]}
                  r={2.4} fill={c.ink} />
        )}
      </svg>
      <p className="text-[19px] font-bold text-ww-text leading-none -mt-2">{fmt(value)}</p>
      {(label || faixa) && (
        <p className="mt-1 text-[10.5px] text-ww-textMuted text-center">
          {label}{label && faixa ? " · " : ""}{faixa}
        </p>
      )}
    </div>
  );
}
