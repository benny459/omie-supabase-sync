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
  Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHROME, seriesColor } from "@/lib/viz/palette";
import { VizDefs, gradId, shadowId } from "./vizDefs";
import { useVizTema } from "./useVizMode";
import type { SeriesDef } from "./ChartFrame";

export default function VizBar({
  rows, series, layout = "column", stacked = false, valueFormat, xKey = "x",
  categoryWidth = 200, totalNoTopo = false, slotDaLinha, rotuloNaPonta = false,
}: {
  rows: Array<Record<string, unknown>>;
  series: SeriesDef[];
  layout?: "column" | "row";
  stacked?: boolean;
  valueFormat?: (v: number) => string;
  xKey?: string;
  /** Largura reservada ao rótulo de categoria no layout horizontal. */
  categoryWidth?: number;
  /** Cor por linha, para quando o SINAL do valor é o que importa: lucro em
   *  verde, prejuízo em vermelho. É codificação divergente por polaridade, não
   *  por posição no ranking — a mesma entidade mantém a cor se a ordem mudar.
   *
   *  Só faz sentido com UMA série; com várias, a cor já é da série e sobrepor
   *  aqui tornaria a legenda mentirosa. Ignorado nesse caso. */
  slotDaLinha?: (row: Record<string, unknown>, i: number) => number;
  /** Escreve o valor na ponta de cada barra. Só em layout horizontal e série
   *  única — com séries lado a lado os rótulos colidem. */
  rotuloNaPonta?: boolean;
  /** Escreve o total da pilha acima de cada coluna.
   *
   *  É exceção deliberada à regra de "rótulo seletivo, nunca em todo ponto": num
   *  gráfico empilhado a ALTURA TOTAL é justamente o que ninguém consegue ler,
   *  porque só o segmento da base encosta numa linha de referência. Sem esse
   *  número, "quanto faturei no mês" exige somar fatias a olho.
   *
   *  Só se aplica a pilha vertical — ignorado fora disso. */
  totalNoTopo?: boolean;
}) {
  const { mode, tema } = useVizTema();
  const c = CHROME[mode];
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString("pt-BR"));
  const horizontal = layout === "row";
  // Com mais de uma série a cor pertence à série (e à legenda). Cor por linha
  // ali criaria duas fontes de verdade pra mesma barra.
  const porLinha = series.length === 1 ? slotDaLinha : undefined;

  const axisTick = { fontSize: 10.5, fill: c.inkMuted };

  // Total por coluna, calculado uma vez. O LabelList do recharts só enxerga o
  // valor da própria série, então a soma da pilha tem que vir de fora.
  const vazada = (s: SeriesDef) => s.variante === "vazada";
  const mostraTotal = totalNoTopo && stacked && !horizontal;
  const totais = mostraTotal
    ? rows.map((r) => series.reduce((s, d) => s + (Number(r[d.key]) || 0), 0))
    : [];

  // Rótulo de categoria em UMA linha, sempre.
  //
  // Estimar largura por caractere não resolve: o recharts quebra o texto por
  // conta própria quando ele não cabe na largura do eixo, e nome em caixa alta
  // ("SECRETARIA DA RECEITA FEDERAL") estoura qualquer estimativa média. Duas
  // tentativas de calibrar o corte (6.4px e 8px por caractere) continuaram
  // quebrando em duas linhas sobrepostas em produção.
  //
  // Aqui o tick é renderizado à mão: um <text> puro, que não quebra, com
  // textLength+lengthAdjust deixando o próprio SVG comprimir o que passar da
  // largura. O nome inteiro continua no tooltip e na visão de tabela.
  const TickCategoria = (props: {
    x?: number; y?: number; payload?: { value?: unknown };
  }) => {
    const { x = 0, y = 0, payload } = props;
    const texto = String(payload?.value ?? "");
    const largura = categoryWidth - 12;
    // Só comprime se realmente passar — comprimir texto curto deforma à toa.
    const precisaComprimir = texto.length * 5.6 > largura;
    return (
      <text
        x={x - 6} y={y} dy={3.5} textAnchor="end"
        fill={c.inkMuted} fontSize={10.5}
        {...(precisaComprimir ? { textLength: largura, lengthAdjust: "spacingAndGlyphs" as const } : {})}
      >
        {texto}
      </text>
    );
  };

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={rows}
        layout={horizontal ? "vertical" : "horizontal"}
        // 18px no topo quando há rótulo de total: com os 4px de sempre o
        // número nasce fora da área de plotagem e é cortado.
        margin={{ top: mostraTotal ? 18 : 4, right: 16, bottom: 0, left: 0 }}
        barCategoryGap={horizontal ? "22%" : "26%"}
        // 2px de superfície entre barras vizinhas do mesmo grupo
        barGap={2}
      >
        {/* Gradiente + sombra dão volume ao mark sem mexer na geometria: o
            comprimento da barra continua exatamente proporcional ao valor. */}
        {/* Os slots usados por linha também precisam de gradiente definido —
            senão a barra referencia um id inexistente e some, sem erro. */}
        <VizDefs
          slots={[
            ...series.map((x) => x.slot),
            ...(porLinha ? rows.map((r, i) => porLinha(r, i)) : []),
          ]}
          mode={mode} tema={tema} dir={horizontal ? "h" : "v"} />
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
            <YAxis
              type="category" dataKey={xKey} stroke={c.axis}
              width={categoryWidth}
              // interval=0 força um tick por categoria: sem isso o recharts pula
              // rótulos quando ficam apertados, e some com barras da leitura.
              interval={0}
              tick={<TickCategoria />}
            />
          </>
        ) : (
          <>
            <XAxis type="category" dataKey={xKey} tick={axisTick} stroke={c.axis} />
            {/* width explícito: o default (60px) corta valores na casa dos
                milhões — "R$ 20.000.000" virava "0.000.000" na tela. */}
            <YAxis type="number" tick={axisTick} stroke={c.axis} width={92}
                   tickFormatter={(v) => fmt(Number(v))} />
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
              fill={vazada(s)
                ? seriesColor(s.slot, mode, tema)
                : `url(#${gradId(s.slot, mode, horizontal ? "h" : "v", tema)})`}
              fillOpacity={vazada(s) ? 0.28 : 1}
              filter={`url(#${shadowId(mode)})`}
              radius={radius}
              // Empilhada precisa de 2px de SUPERFÍCIE entre fatias; vazada
              // precisa do contorno na própria cor. Empilhar vence: a separação
              // é estrutural, sem ela as fatias grudam.
              stroke={stacked ? c.surface : vazada(s) ? seriesColor(s.slot, mode, tema) : undefined}
              strokeWidth={stacked ? 2 : vazada(s) ? 1.5 : 0}
              isAnimationActive={false}
            >
              {/* Cor por ENTIDADE: um Cell por row garante que reordenar/filtrar
                  não repinta quem sobrou. */}
              {rows.map((row, ri) => {
                const slot = porLinha ? porLinha(row, ri) : s.slot;
                return (
                  <Cell key={ri}
                        fill={vazada(s)
                          ? seriesColor(slot, mode, tema)
                          : `url(#${gradId(slot, mode, horizontal ? "h" : "v", tema)})`} />
                );
              })}
              {/* Valor na ponta da barra horizontal. Exceção deliberada ao
                  "rótulo seletivo": num ranking, o número de CADA linha é a
                  informação — ler 15 barras contra o eixo é trabalho que o
                  rótulo faz de graça. Em tinta de texto, nunca na cor da série. */}
              {rotuloNaPonta && horizontal && series.length === 1 && (
                <LabelList
                  dataKey={s.key}
                  position="right"
                  offset={6}
                  style={{ fill: c.ink, fontSize: 10.5, fontWeight: 600 }}
                  formatter={(v: unknown) => fmt(Number(v) || 0)}
                />
              )}
              {/* Total da pilha, na ÚLTIMA série: é a que fecha a coluna, então
                  o rótulo pousa no topo. Em tinta de texto, nunca na cor da
                  série — o número é do total, não de nenhum segmento. */}
              {mostraTotal && last && (
                <LabelList
                  dataKey={s.key}
                  position="top"
                  offset={7}
                  content={(props: { x?: number | string; y?: number | string;
                                     width?: number | string; index?: number }) => {
                    const i = Number(props.index ?? -1);
                    if (i < 0 || !totais[i]) return null;
                    const x = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
                    const y = Number(props.y ?? 0) - 6;
                    return (
                      <text x={x} y={y} textAnchor="middle"
                            fill={c.ink} fontSize={10.5} fontWeight={600}>
                        {fmt(totais[i])}
                      </text>
                    );
                  }}
                />
              )}
            </Bar>
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
