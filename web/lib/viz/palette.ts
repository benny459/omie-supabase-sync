// Paleta de visualização do painel — VALIDADA, não escolhida por gosto.
//
// Os 8 slots passaram os seis checks contra as superfícies REAIS do painel:
// claro #ffffff e escuro #152744 (o navy do tema tech). Números atuais estão
// no comentário da rampa, logo abaixo.
//
// Reconferir depois de QUALQUER mexida nos hexes:
//   node scripts/validate_palette.js "<hexes>" --mode light --surface "#ffffff"
//   node scripts/validate_palette.js "<hexes>" --mode dark  --surface "#152744"
//
// REGRAS QUE NÃO SE NEGOCIAM (violar reintroduz bug de leitura, não de estilo):
//  1. A ordem dos slots É o mecanismo de segurança pra daltonismo — atribua na
//     ordem, nunca em ciclo. Série 9 não ganha cor nova: vira "Outros", vira
//     facet, ou o gráfico é dividido.
//  2. Cor segue a ENTIDADE, nunca a posição no ranking. Filtro que muda a
//     quantidade de séries não pode repintar quem sobrou.
//  3. O CVD da rampa clara fica na faixa 6–8, que só é legal COM codificação
//     secundária. Legenda sempre presente com 2+ séries e a visão de tabela do
//     ChartFrame são essa codificação — não remova nenhuma das duas.
//  4. Cores de status são reservadas e nunca viram "série 4". Sempre com ícone
//     e rótulo, jamais só a cor.
//  5. Nunca eixo duplo. Duas medidas de escala diferente = dois gráficos, ou
//     indexadas a uma base comum.

export type VizMode = "light" | "dark";

// Ordem canônica. Índice = slot. NÃO reordenar sem revalidar.
//
// Rampa SUAVE (31/07/2026). A anterior era saturada demais — leitura de "cor
// primária de giz", cansativa num painel que se lê por minutos. Esta baixa o
// croma e unifica a luminosidade, ficando mais harmônica SEM perder o gate.
//
// Harmonia e distinguibilidade puxam pra lados opostos: cor harmônica é vizinha
// no círculo, e vizinha confunde sob daltonismo. Por isso não foi escolha de
// gosto — foram candidatas medidas até achar uma que passasse inteira.
//
//   clara:  CVD ΔE 8.3 (protan) · visão normal 15.3 · contraste todos ≥3:1
//   escura: CVD ΔE 9.5 (deutan) · visão normal 16.2 · contraste todos ≥3:1
//
// A escura MELHOROU o CVD (era 8.4) porque o magenta foi puxado pro violeta,
// separando-o do verde — o par verde↔magenta era o gargalo.
//
// Descartadas, todas medidas:
//   dessaturar mais  -> 3 slots caem abaixo do piso de croma e leem como cinza
//   magenta puro     -> verde↔magenta despenca pra ΔE 3.2 sob deutan
//
// Revalidar depois de QUALQUER mudança de hexe:
//   node scripts/validate_palette.js "<hexes>" --mode light --surface "#ffffff"
//   node scripts/validate_palette.js "<hexes>" --mode dark  --surface "#152744"
export const SERIES_LIGHT = [
  "#3a72b8", // 1 azul
  "#bd5f31", // 2 terracota
  "#1f8a6a", // 3 verde-azulado
  "#a37c22", // 4 ocre
  "#b0568f", // 5 rosa-violeta
  "#2e7d43", // 6 verde
  "#5b4ab0", // 7 violeta
  "#c4413f", // 8 vermelho
] as const;

export const SERIES_DARK = [
  "#5297dd", "#d0703a", "#22a888", "#b08c22",
  "#c96aa8", "#3da75f", "#8b79e0", "#e35f5d",
] as const;

// Depois do repasse da rampa clara, nenhum slot fica sub-3:1. Mantido vazio (e
// não removido) porque ChartFrame e futuros consumidores checam por aqui — se
// alguém clarear um hue de novo, é aqui que se registra.
export const LOW_CONTRAST_LIGHT_SLOTS = new Set<number>();

export const MAX_SERIES = 8;

// Formas de gráfico que comparam TODOS os pares ao mesmo tempo (scatter, bubble,
// mapa, small multiples) não seguram os 8: só os 3 primeiros slots passam o
// validador em modo --pairs all. Acima disso, agrupe em "Outros" ou facete.
export const MAX_SERIES_ALL_PAIRS = 3;

export function seriesColor(slot: number, mode: VizMode): string {
  const ramp = mode === "dark" ? SERIES_DARK : SERIES_LIGHT;
  // Sem ciclo de propósito: estourar o limite é erro de composição do gráfico,
  // não algo pra resolver repetindo cor (duas séries idênticas é pior que erro).
  if (slot < 0 || slot >= ramp.length) {
    throw new Error(
      `viz/palette: slot ${slot} fora dos ${ramp.length} slots. Agrupe em "Outros" ou divida o gráfico — não cicle a paleta.`,
    );
  }
  return ramp[slot];
}

// Rampa sequencial (magnitude contínua): UM hue, claro→escuro. Nunca arco-íris.
// Pra rampa ORDINAL (etapas discretas), o passo mais próximo da superfície ainda
// precisa de 2:1 — no claro comece em 250, no escuro não passe de 600.
export const SEQUENTIAL_BLUE = {
  100: "#cde2fb", 150: "#b7d3f6", 200: "#9ec5f4", 250: "#86b6ef",
  300: "#6da7ec", 350: "#5598e7", 400: "#3987e5", 450: "#2a78d6",
  500: "#256abf", 550: "#1c5cab", 600: "#184f95", 650: "#104281", 700: "#0d366b",
} as const;

// Divergente: polos quente/frio + CINZA no meio. Hue no midpoint quebra a leitura
// de "neutro". Braços com o mesmo número de passos.
export const DIVERGING = {
  negative: "#e34948",
  positive: "#2a78d6",
  midpoint: { light: "#f0efec", dark: "#383835" },
} as const;

// Status é fixo, nunca tematizado, nunca reaproveitado como série.
export const STATUS = {
  good:     "#0ca30c",
  warning:  "#fab219",
  serious:  "#ec835a",
  critical: "#d03b3b",
} as const;

// Cromo do gráfico. Texto usa token de TEXTO, nunca a cor da série — o mark
// colorido ao lado é que carrega a identidade.
export const CHROME = {
  // Claro "tech": mesma família do escuro, espelhada. Tinta e grade ganham um
  // leve viés azul pra o par claro/escuro parecer o MESMO produto em dois
  // modos, e não dois temas diferentes colados.
  light: {
    surface:  "#ffffff",
    gridline: "#dfe7f2",
    axis:     "#c2cfe3",
    ink:      "#0f1e3a",
    inkMuted: "#51637f",
    inkFaint: "#8496b0",
  },
  // Tema escuro "tech" azul-marinho. Números da validação estão no comentário
  // da rampa, que é onde eles mudam.
  dark: {
    surface:  "#152744",
    gridline: "#24365c",
    axis:     "#33497a",
    ink:      "#eaf0fb",
    inkMuted: "#9db2d4",
    inkFaint: "#6b82a8",
  },
} as const;
