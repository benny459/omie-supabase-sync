// Paleta de visualização do painel — VALIDADA, não escolhida por gosto.
//
// Os 8 slots categóricos abaixo passaram os seis checks do validador contra as
// SUPERFÍCIES REAIS do painel (claro #ffffff, escuro #141412 — não as superfícies
// default da referência):
//
//   claro:  banda de luminosidade OK · chroma OK · CVD pior par adjacente
//           ΔE 9.1 (protan) · visão normal ΔE 19.6 · contraste WARN em 3 slots
//   escuro: banda OK · chroma OK · CVD ΔE 8.4 · visão normal ΔE 19.3 ·
//           contraste todos ≥ 3:1
//
// Comando pra reconferir depois de QUALQUER mexida nos hexes:
//   node scripts/validate_palette.js "<hexes>" --mode light  --surface "#ffffff"
//   node scripts/validate_palette.js "<hexes>" --mode dark   --surface "#141412"
//
// REGRAS QUE NÃO SE NEGOCIAM (violar reintroduz bug de leitura, não de estilo):
//  1. A ordem dos slots É o mecanismo de segurança pra daltonismo — atribua na
//     ordem, nunca em ciclo. Série 9 não ganha cor nova: vira "Outros", vira
//     facet, ou o gráfico é dividido.
//  2. Cor segue a ENTIDADE, nunca a posição no ranking. Filtro que muda a
//     quantidade de séries não pode repintar quem sobrou.
//  3. No claro, aqua/yellow/magenta ficam abaixo de 3:1 contra branco. Isso
//     obriga a "regra de alívio": rótulo direto visível ou visão de tabela.
//     O ChartFrame já entrega o toggle de tabela — não remova.
//  4. Cores de status são reservadas e nunca viram "série 4". Sempre com ícone
//     e rótulo, jamais só a cor.
//  5. Nunca eixo duplo. Duas medidas de escala diferente = dois gráficos, ou
//     indexadas a uma base comum.

export type VizMode = "light" | "dark";

// Ordem canônica. Índice = slot. NÃO reordenar sem revalidar.
//
// Rampa CLARA repassada em 2026-07-30: os 8 hues descem juntos pra uma banda
// mais escura, de modo que TODOS clarem 3:1 contra branco. Antes, aqua/amarelo/
// magenta ficavam em 2.17–2.82 — barra fina naquelas cores praticamente sumia
// no fundo, e a regra de alívio (tabela) era o único remendo.
//
// O trade medido: contraste de todos os 8 passa a PASSAR; em troca o pior par
// adjacente de CVD cai de 9.1 pra 8.0 (topo da faixa 6–8, que a skill permite
// SÓ com codificação secundária). O ChartFrame entrega essa codificação —
// legenda sempre presente com 2+ séries, visão de tabela e gap de 2px entre
// marks. Marca invisível é pior que marca parecida.
//
// Tentativas descartadas (todas medidas, todas piores):
//   escurecer só os 3 problemáticos -> laranja claro converge com aqua escuro
//     no protan (ΔE 5.9, FAIL)
//   reordenar pra separar aqua↔amarelo -> verde↔amarelo cai pra ΔE 2.1 (FAIL)
export const SERIES_LIGHT = [
  "#2a78d6", // 1 azul
  "#c4551f", // 2 laranja
  "#0f8f66", // 3 aqua
  "#a97a00", // 4 amarelo
  "#c95480", // 5 magenta
  "#008300", // 6 verde
  "#4a3aa7", // 7 violeta
  "#cf3b3a", // 8 vermelho
] as const;

export const SERIES_DARK = [
  "#3987e5", "#d95926", "#199e70", "#c98500",
  "#d55181", "#008300", "#9085e9", "#e66767",
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
  // Tema escuro "tech" azul-marinho. A paleta categórica NÃO mudou — só a
  // superfície — e foi revalidada contra #152744: contraste ≥3:1 nos 8 slots,
  // pior par CVD ΔE 8.4 (protan), visão normal ΔE 19.3.
  dark: {
    surface:  "#152744",
    gridline: "#24365c",
    axis:     "#33497a",
    ink:      "#eaf0fb",
    inkMuted: "#9db2d4",
    inkFaint: "#6b82a8",
  },
} as const;
