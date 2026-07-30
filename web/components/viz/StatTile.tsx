"use client";

// Número em destaque (o `scalar` do Metabase — 51 dos 200 cards, a categoria
// mais numerosa). Quando a resposta é UM número, gráfico é desperdício de tinta:
// o número grande responde mais rápido que qualquer barra.
//
// É a única forma que dispensa camada de hover — não há mark pra sondar.
//
// O delta tem que ser lido sem depender de cor: vem com seta (↑/↓) e com o
// rótulo do período. Verde/vermelho reforçam, não carregam o significado — e
// "subiu" não é universalmente bom, então quem chama informa a polaridade.

import { STATUS } from "@/lib/viz/palette";

export default function StatTile({
  label, value, hint, delta, deltaLabel, higherIsBetter = true,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Variação relativa ao período anterior. Positivo = subiu. */
  delta?: number | null;
  /** Contra o quê a variação é medida — "vs. mês anterior". */
  deltaLabel?: string;
  /** Se subir é bom. Em "despesa" ou "atraso", subir é ruim. */
  higherIsBetter?: boolean;
}) {
  const has = delta != null && Number.isFinite(delta) && delta !== 0;
  const subiu = (delta ?? 0) > 0;
  const bom = subiu === higherIsBetter;
  const cor = has ? (bom ? STATUS.good : STATUS.critical) : undefined;

  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 transition-colors">
      <div className="flex items-center gap-1.5">
        {/* Ponto de status ao lado do rótulo — é o que a referência usa pra dar
            leitura de "indicador vivo" sem depender de ícone por métrica.
            Cor só reforça: o sinal real é a seta + o rótulo do delta abaixo. */}
        <span aria-hidden className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: has ? cor : "rgb(var(--color-ww-textFaint))" }} />
        <p className="text-[11px] text-ww-textMuted truncate uppercase tracking-wider" title={label}>{label}</p>
      </div>
      {/* Figura grande em algarismos proporcionais; tabular fica pra coluna que
          precisa alinhar verticalmente. */}
      <p className="mt-1.5 text-[26px] leading-none font-bold text-ww-text tracking-[-0.5px]">{value}</p>
      <div className="mt-1.5 flex items-baseline gap-1.5 min-h-[15px]">
        {has && (
          <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color: cor }}>
            <span aria-hidden>{subiu ? "↑" : "↓"}</span>
            {Math.abs(delta!).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
            <span className="sr-only">{subiu ? "aumento" : "queda"}</span>
          </span>
        )}
        {deltaLabel && <span className="text-[10.5px] text-ww-textFaint">{deltaLabel}</span>}
      </div>
      {hint && <p className="mt-1 text-[10.5px] text-ww-textFaint">{hint}</p>}
    </section>
  );
}
