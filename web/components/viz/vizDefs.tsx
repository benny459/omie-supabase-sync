"use client";

// Definições SVG compartilhadas que dão PROFUNDIDADE aos marks.
//
// A linha que separa profundidade legítima de 3D que mente:
//
//   ✅ gradiente ao longo do mark, sombra projetada, brilho no traço, área com
//      degradê. A GEOMETRIA continua exata — o comprimento da barra segue
//      proporcional ao valor, e é o comprimento que o leitor mede.
//
//   ❌ extrusão isométrica, pizza inclinada, perspectiva. Aí o tamanho aparente
//      deixa de ser proporcional ao dado: numa pizza 3D a fatia da frente parece
//      maior que uma fatia igual atrás, e a leitura vira artefato do desenho.
//
// Por isso aqui só existe a primeira família.

import { seriesColor, type VizMode } from "@/lib/viz/palette";

/** id estável por slot+modo — dois gráficos na mesma página compartilham o def. */
export const gradId = (slot: number, mode: VizMode, dir: "v" | "h") =>
  `wwGrad-${dir}-${slot}-${mode}`;
export const shadowId = (mode: VizMode) => `wwShadow-${mode}`;
export const glowId = (slot: number, mode: VizMode) => `wwGlow-${slot}-${mode}`;

/**
 * Defs pra um conjunto de slots. `dir` acompanha o sentido do mark: vertical
 * pra barra em coluna, horizontal pra barra em linha — o degradê tem que correr
 * NO SENTIDO do crescimento, senão vira textura aleatória.
 *
 * A extremidade que carrega o dado (topo da coluna, direita da barra) fica com
 * a cor cheia; o degradê clareia só em direção à baseline, onde não há leitura
 * de valor a fazer.
 */
export function VizDefs({
  slots, mode, dir = "v", comGlow = false,
}: {
  slots: number[];
  mode: VizMode;
  dir?: "v" | "h";
  comGlow?: boolean;
}) {
  const unicos = Array.from(new Set(slots));
  return (
    <defs>
      {unicos.map((slot) => {
        const cor = seriesColor(slot, mode);
        const coords = dir === "v"
          ? { x1: "0", y1: "0", x2: "0", y2: "1" }
          : { x1: "1", y1: "0", x2: "0", y2: "0" };
        return (
          <linearGradient key={slot} id={gradId(slot, mode, dir)} {...coords}>
            <stop offset="0%"   stopColor={cor} stopOpacity={1} />
            <stop offset="55%"  stopColor={cor} stopOpacity={0.88} />
            <stop offset="100%" stopColor={cor} stopOpacity={0.62} />
          </linearGradient>
        );
      })}

      {/* Sombra projetada — separa o mark da superfície. Deslocamento pequeno e
          desfoque curto: sombra longa vira ilustração e come a grade. */}
      <filter id={shadowId(mode)} x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow
          dx="0" dy={dir === "v" ? 2 : 0} stdDeviation="2.5"
          floodColor={mode === "dark" ? "#000000" : "#0f1e3a"}
          floodOpacity={mode === "dark" ? 0.45 : 0.18}
        />
      </filter>

      {comGlow && unicos.map((slot) => (
        <filter key={slot} id={glowId(slot, mode)} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="3"
                        floodColor={seriesColor(slot, mode)}
                        floodOpacity={mode === "dark" ? 0.55 : 0.28} />
        </filter>
      ))}
    </defs>
  );
}
