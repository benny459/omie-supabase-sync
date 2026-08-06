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

// ─────────────────────────────────────────────────────────────────────────────
// TEMAS — o usuário escolhe, como nos temas de cor do Excel.
//
// Só entram aqui rampas que PASSARAM no validador. Oferecer um tema bonito que
// reprova em daltonismo transformaria uma escolha de gosto num bug de leitura
// que ninguém rastreia — o usuário troca a cor e a acessibilidade cai junto,
// sem aviso.
//
// Medições (CVD ΔE / visão normal ΔE):
//   tech      escura 11.6 / 18.7      clara 7.9 / 17.2
//   classica  escura 10.2 / 16.2      clara 7.8 / 15.3
//   vibrante  escura  8.6 / 17.5      clara 6.9 / 16.7
//
// Todas as rampas CLARAS caem na faixa 6–8 de CVD, que é legal apenas COM
// codificação secundária — contra branco é intrinsecamente mais difícil separar
// hues sob dicromacia. A legenda e a visão de tabela do ChartFrame são essa
// codificação nos três temas; removê-las quebra os três de uma vez.
//
// Reprovados, e por quê (ficam registrados pra ninguém tentar de novo):
//   "oceano" (só azuis/cianos) -> visão normal ΔE 11.5: com 8 slots os hues
//                                 ficam vizinhos demais. Só funcionaria com 4-5.
//   "sóbria" (croma baixo)     -> 5 slots abaixo do piso de croma, leem como
//                                 cinza. Mesma armadilha já registrada acima.
export type VizTema = "tech" | "classica" | "vibrante";

export const TEMAS: Record<VizTema, { nome: string; descricao: string; light: readonly string[]; dark: readonly string[] }> = {
  tech: {
    nome: "Tech",
    descricao: "Fria e terrosa, sem roxo nem laranja",
    light: SERIES_LIGHT,
    dark: SERIES_DARK,
  },
  classica: {
    nome: "Clássica",
    descricao: "A rampa anterior, com terracota e violeta",
    light: ["#3a72b8", "#bd5f31", "#1f8a6a", "#a37c22",
            "#b0568f", "#2e7d43", "#5b4ab0", "#c4413f"],
    dark:  ["#5297dd", "#d0703a", "#22a888", "#b08c22",
            "#c96aa8", "#3da75f", "#8b79e0", "#e35f5d"],
  },
  vibrante: {
    nome: "Vibrante",
    descricao: "Croma alto, mais separação entre séries",
    light: ["#1a8fd4", "#b8402f", "#12a06a", "#8a6b12",
            "#d15a96", "#2f3fa8", "#7d9a24", "#c94545"],
    dark:  ["#4db8ff", "#f0785c", "#3ddc97", "#e8c53d",
            "#f06bab", "#8a9eff", "#a2cf74", "#f05252"],
  },
};

export const TEMA_PADRAO: VizTema = "tech";

/** Aceita qualquer string e devolve um tema válido — o valor vem do
 *  localStorage, que o usuário pode ter editado ou que pode ter sobrado de uma
 *  versão anterior com outro nome. */
export function temaValido(v: string | null | undefined): VizTema {
  return v && v in TEMAS ? (v as VizTema) : TEMA_PADRAO;
}

// Depois do repasse da rampa clara, nenhum slot fica sub-3:1. Mantido vazio (e
// não removido) porque ChartFrame e futuros consumidores checam por aqui — se
// alguém clarear um hue de novo, é aqui que se registra.
export const LOW_CONTRAST_LIGHT_SLOTS = new Set<number>();

export const MAX_SERIES = 8;

// Formas de gráfico que comparam TODOS os pares ao mesmo tempo (scatter, bubble,
// mapa, small multiples) não seguram os 8: só os 3 primeiros slots passam o
// validador em modo --pairs all. Acima disso, agrupe em "Outros" ou facete.
export const MAX_SERIES_ALL_PAIRS = 3;

export function seriesColor(slot: number, mode: VizMode, tema: VizTema = TEMA_PADRAO): string {
  const t = TEMAS[tema] ?? TEMAS[TEMA_PADRAO];
  const ramp = mode === "dark" ? t.dark : t.light;
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
