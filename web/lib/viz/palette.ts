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
// Rampa FRIA + TERROSA (06/08/2026). Roxo e laranja saíram a pedido — não
// combinavam com o navy do fundo. O que restou (azul, ciano, verde, amarelo,
// vermelho, rosa, lima) são hues VIZINHOS entre si, e vizinho confunde sob
// daltonismo: as primeiras candidatas caíram pra CVD ΔE 7.1, abaixo do gate.
//
// A alavanca que resolveu não foi matiz, foi LUMINOSIDADE. Alternando slot
// claro e slot escuro, o par que o daltônico não distingue por cor passa a se
// distinguir por brilho. Foi o que levou a escura de 7.1 pra 11.6 — melhor,
// inclusive, que a rampa anterior, que ainda tinha roxo e laranja disponíveis.
//
//   clara:  CVD ΔE 7.9 · visão normal 17.2 · contraste todos ≥3:1
//   escura: CVD ΔE 11.6 · visão normal 18.7 · contraste todos ≥3:1
//
// A CLARA fica na faixa 6–8 de CVD, que é legal SOMENTE com codificação
// secundária. Ela existe: ChartFrame sempre mostra legenda com 2+ séries e tem
// visão de tabela. Removê-los quebra a acessibilidade desta rampa — ver regra 3.
//
// Descartadas, todas medidas:
//   luminosidade uniforme    -> CVD 7.1, abaixo do gate
//   alternar L sem clarear   -> 2 slots < 3:1 contra o navy
//   ciano #3aa3b0 no claro   -> 2.98:1, reprovado por 0.02
//
// Revalidar depois de QUALQUER mudança de hexe (o script vive no repo):
//   node scripts/validate_palette.js "<hexes>" --mode light --surface "#ffffff"
//   node scripts/validate_palette.js "<hexes>" --mode dark  --surface "#152744"
export const SERIES_LIGHT = [
  "#3a86c9", // 1 azul
  "#0f6a50", // 2 verde-azulado escuro
  "#a8871a", // 3 amarelo-ocre
  "#c4443f", // 4 vermelho
  "#2f96a3", // 5 ciano
  "#1f6b3a", // 6 verde escuro
  "#c26a86", // 7 rosa
  "#7d9420", // 8 verde-lima
] as const;

export const SERIES_DARK = [
  "#5aa9e6", "#22916f", "#e3c94a", "#d15550",
  "#7ddde0", "#3d9455", "#e08fa8", "#a8c95a",
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
