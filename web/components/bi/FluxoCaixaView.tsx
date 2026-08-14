"use client";

// Fluxo de caixa projetado — cards 100, 151, 98, 106 e 71 do Metabase.
//
// ── O que a curva mostra ────────────────────────────────────────────────────
// Só o que está A VENCER. Atrasado NÃO entra: ancorá-lo em hoje jogaria R$ 441k
// de uma vez no dia 1 e a curva ficaria negativa os 60 dias inteiros, num degrau
// que engole o movimento real dos outros dias. O atrasado entra QUANDO GANHA UMA
// DATA, no painel de agendamento — "quando está contratado?" é fato e vai pro
// gráfico; "quando isso vai de fato acontecer?" é hipótese e vai pra simulação.
//
// ── Escopo, fixo e visível ──────────────────────────────────────────────────
//   ENTRADAS  só Safe  — é quem fatura, e a Omie.CASH da projeção é dela.
//   SAÍDAS    as três  — o grupo paga tudo do mesmo bolso.
// Atraso entra por PREVISÃO no ano corrente, não por dias de vencimento.
//
// ── Enviar pro Omie ─────────────────────────────────────────────────────────
// Reagendar aqui grava só no painel. Mandar pro Omie é um segundo passo
// explícito, com simulação antes. Portado do waterworks-bi, onde rodou em
// produção (23 envios OK em junho/2026).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizCombo from "@/components/viz/VizCombo";
import VizTable, { type Col } from "@/components/viz/VizTable";

// Janelas. "Esta semana" e "Mês atual" são dinâmicas: viram um número de dias
// calculado na hora, então a curva termina exatamente no domingo / no último dia
// do mês, em vez de num ponto arbitrário.
type Janela = { key: string; label: string; dias: () => number };
const JANELAS: Janela[] = [
  { key: "semana", label: "Esta semana", dias: () => {
      const h = new Date();
      return 7 - (h.getDay() === 0 ? 7 : h.getDay());   // até o próximo domingo
    } },
  { key: "mes", label: "Mês atual", dias: () => {
      const h = new Date();
      const fim = new Date(h.getFullYear(), h.getMonth() + 1, 0);
      return Math.round((fim.getTime() - h.getTime()) / 86_400_000);
    } },
  { key: "60", label: "60 dias", dias: () => 60 },
  { key: "90", label: "90 dias", dias: () => 90 },
  { key: "180", label: "180 dias", dias: () => 180 },
];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const hojeIso = () => new Date().toISOString().slice(0, 10);
const diaBr = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};
const addDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesBr = (iso: string) => {
  const [a, m] = iso.slice(0, 7).split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
};

// Faixa de atraso → tom. Gradiente de alerta: quanto mais velho, mais quente.
// O escopo já filtra por previsão; isto aqui lê o VENCIMENTO, que é outra
// pergunta — "há quanto tempo está furado".
const FAIXA_TOM: Record<string, string> = {
  "1-15d":  "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  "16-30d": "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  "31-60d": "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  "61-90d": "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  "90d+":   "bg-rose-600/25 text-rose-800 dark:text-rose-200 border-rose-600/50 font-bold",
};

/** Empurra para o próximo dia útil. Sábado → segunda, domingo → segunda.
 *
 *  Existe porque o Omie NÃO grava esse deslocamento: no campo de previsão que a
 *  API devolve, sábado continua sábado — ele aplica o ajuste só na hora de
 *  desenhar o fluxo dele. Sem empurrar aqui, a curva antecipa dinheiro: mostra
 *  saída no sábado que só sai na segunda. Nos próximos 90 dias são 59 títulos e
 *  R$ 186.693 previstos para fim de semana.
 *
 *  Vale só para a CURVA e os totais dela. A mesa de reagendamento continua
 *  mostrando a data crua do título — quem opera precisa ver o dado verdadeiro,
 *  e é essa data que vai pro Omie.
 *
 *  NÃO cobre feriados: nacional dá pra embutir, mas municipal e estadual variam
 *  por onde o cliente paga e não temos essa lista. Então 07/09 e 12/10, que caem
 *  em dia de semana, seguem na data original. */
function proximoDiaUtil(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const dow = d.getDay();               // 0 = domingo, 6 = sábado
  if (dow === 6) return addDias(iso, 2);
  if (dow === 0) return addDias(iso, 1);
  return iso;
}

/** Dias de hoje até a data. Negativo = passado. */
const diasAte = (iso: string | null) => {
  if (!iso) return null;
  const ms = new Date(`${iso}T12:00:00`).getTime() - new Date(`${hojeIso()}T12:00:00`).getTime();
  return Math.round(ms / 86_400_000);
};

/** Colunas ordenáveis da mesa de reagendamento. */
const ORDEM_ROTULO: Record<string, string> = {
  valor: "valor", previsao: "previsão", vencimento: "vencimento",
  contraparte: "contraparte", categoria: "categoria",
};
type OrdemCol = "valor" | "previsao" | "vencimento" | "contraparte" | "categoria";

/** Minúsculas sem acento: quem digita "sirio" tem que achar "SÍRIO". */
const normaliza = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

type Titulo = {
  cod_titulo: number; empresa: string; natureza: "R" | "P";
  contraparte: string; categoria: string; num_titulo: string; documento: string;
  vencimento: string | null; previsao: string; previsao_original: string | null;
  tem_override: boolean; sincronizado_omie: boolean;
  esta_vencido: boolean; dias_atraso: number | null; faixa_atraso: string | null;
  valor: number;
};
type ContaRow = {
  empresa: string; cod_conta: number; conta: string; saldo: number; dt_ultimo: string | null;
};
type Cenario = {
  entrada: number; saida: number;
  /** Saída das mesmas empresas que entram — o recorte do card do Metabase. */
  saida_da_entrada: number;
  /** Saída do resto do grupo, que é o que vira o sinal do resultado. */
  saida_de_fora: number;
  resultado: number;
  atraso_receber: number; atraso_pagar: number; resultado_se_atraso_pago: number;
};
type MensalRow = {
  mes: string; entrada_prevista: number; entrada_realizada: number;
  saida_prevista: number; saida_realizada: number;
  resultado_previsto: number; resultado_realizado: number;
};
type Payload = {
  dias: number; ano: number; pode_editar: boolean;
  saldo_atual: { saldo: number; dt_ref: string | null; origem: string } | null;
  titulos: Titulo[]; atrasados: Titulo[]; contas: ContaRow[];
  cenario: Cenario | null; mensal: MensalRow[];
};
type SyncResult = {
  ok: boolean; total: number; sucessos: number; erros: number;
  dry_runs: number; dry_run: boolean;
  results: Array<{ cod_titulo: number; contraparte: string; status: string; erro?: string }>;
};

type Ponto = { dia: string; entradas: number; saidas: number; saldo: number };

/** Saldo de partida + movimento de cada dia, acumulado.
 *
 *  `extras` são atrasados reagendados NESTA sessão, ainda não recarregados.
 *
 *  `semOverride` projeta o cenário contrafactual: cada título entra pela
 *  previsão ORIGINAL do Omie, ignorando os reagendamentos já gravados. É o que
 *  permite comparar "como está" com "como estaria sem os agendamentos", e essa
 *  comparação precisa sobreviver ao reload — antes ela vivia só na sessão, e
 *  bastava recarregar pra parecer que o reagendamento não fizera nada.
 *
 *  Título cuja previsão ORIGINAL já venceu não entra no contrafactual: sem o
 *  reagendamento ele estaria no limbo dos atrasados, fora da curva. É
 *  justamente essa ausência que mostra o efeito de tê-lo agendado. */
function projetar(
  saldo0: number, titulos: Titulo[], dias: number,
  extras: Array<{ t: Titulo; dia: string }> = [],
  semOverride = false,
): Ponto[] {
  const inicio = hojeIso();
  const fim = addDias(inicio, dias);
  const porDia = new Map<string, { e: number; s: number }>();
  const lancar = (dia: string, t: Titulo) => {
    const cel = porDia.get(dia) ?? { e: 0, s: 0 };
    if (t.natureza === "R") cel.e += Number(t.valor) || 0;
    else cel.s += Number(t.valor) || 0;
    porDia.set(dia, cel);
  };
  // Toda entrada na curva passa pelo dia útil: o dinheiro não se move no fim de
  // semana, e o Omie não grava esse ajuste no campo de previsão.
  for (const t of titulos) {
    if (semOverride) {
      const orig = t.previsao_original ?? t.previsao;
      // Fora da janela (ou já vencida) = não existiria na curva sem o agendamento.
      if (orig >= inicio && orig <= fim) lancar(proximoDiaUtil(orig), t);
    } else {
      lancar(proximoDiaUtil(t.previsao), t);
    }
  }
  for (const x of extras) lancar(proximoDiaUtil(x.dia), x.t);

  const pontos: Ponto[] = [];
  let saldo = saldo0;
  for (let i = 0; i <= dias; i++) {
    const dia = addDias(inicio, i);
    const mov = porDia.get(dia) ?? { e: 0, s: 0 };
    saldo += mov.e - mov.s;
    pontos.push({ dia, entradas: mov.e, saidas: -mov.s, saldo });
  }
  return pontos;
}

const COLS_CONTAS: Col<ContaRow>[] = [
  { key: "empresa",   label: "Emp.",       w: 60 },
  { key: "conta",     label: "Conta",      w: 260 },
  { key: "saldo",     label: "Saldo",      tipo: "money", w: 140 },
  { key: "dt_ultimo", label: "Últ. lanç.", tipo: "date",  w: 100 },
];

export default function FluxoCaixaView() {
  // Guarda o PRESET, não o número: "esta semana" precisa recalcular os dias a
  // cada render, senão vira um valor congelado no dia em que foi clicado.
  const [janela, setJanela] = useState("60");
  const jan = JANELAS.find((j) => j.key === janela) ?? JANELAS[2];
  const dias = Math.max(1, jan.dias());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  /** Atrasados com data escolhida: cod_titulo → dia. Vazio = curva de base. */
  const [agenda, setAgenda] = useState<Map<number, string>>(new Map());
  /** O que está sendo DIGITADO, antes de virar agendamento.
   *
   *  Existe porque <input type="date"> dispara onChange a cada tecla, com datas
   *  parcialmente montadas: digitar "01/08/2026" passa por ano 0, 00, 000, 0002…
   *  e todas são datas válidas pro navegador. Gravar nelas fazia o valor
   *  controlado voltar quebrado pro campo ("01/08/0002" no print) e travar a
   *  digitação. Aqui o teclado mexe só no rascunho; o commit é no blur. */
  const [rascunho, setRascunho] = useState<Map<number, string>>(new Map());
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dataLote, setDataLote] = useState("");
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<"todos" | "R" | "P">("todos");
  /** Escopo da mesa de reagendamento. Antes só existia "atrasados" — mas
   *  reprogramar um título A VENCER é operação igualmente comum, e era a única
   *  que exigia sair do painel e ir no Omie. "A vencer" inclui hoje: a função
   *  devolve prev_efetiva >= current_date. */
  const [escopo, setEscopo] = useState<"atrasados" | "a_vencer" | "todos">("atrasados");
  /** Categorias selecionadas. Vazio = todas. */
  const [catsSel, setCatsSel] = useState<Set<string>>(new Set());
  /** Recorte por data de previsão — o eixo em que o reagendamento opera. */
  const [prevDe, setPrevDe] = useState("");
  const [prevAte, setPrevAte] = useState("");
  /** Ordenação da mesa. Padrão: maior valor primeiro, que é onde mexer move a
   *  curva. */
  const [ordem, setOrdem] = useState<{ col: OrdemCol; desc: boolean }>(
    { col: "valor", desc: true },
  );
  const [salvando, setSalvando] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bi/fluxo-caixa?dias=${dias}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
      setAgenda(new Map());
      setSel(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dias]);

  useEffect(() => { void load(); }, [load]);

  const saldo0 = Number(data?.saldo_atual?.saldo ?? 0);
  const titulos = useMemo(() => data?.titulos ?? [], [data]);
  const atrasados = useMemo(() => data?.atrasados ?? [], [data]);
  const podeEditar = data?.pode_editar ?? false;

  const extras = useMemo(() => {
    const porCod = new Map(atrasados.map((t) => [t.cod_titulo, t]));
    return Array.from(agenda.entries())
      .map(([cod, dia]) => ({ t: porCod.get(cod), dia }))
      .filter((x): x is { t: Titulo; dia: string } => !!x.t);
  }, [agenda, atrasados]);

  /** Efeito do empurrão pra dia útil, para a tela poder declará-lo.
   *
   *  `foraDaJanela` é o caso de borda: previsão no último fim de semana da
   *  janela vira segunda, que já está fora — o título sai da curva. Silenciar
   *  isso faria o gráfico não fechar com o card de "a vencer", que é contado no
   *  servidor pela data crua. Poucos títulos, mas some sem avisar se eu deixar. */
  const empurrao = useMemo(() => {
    const fim = addDias(hojeIso(), dias);
    let qtd = 0, valor = 0, foraQtd = 0, foraValor = 0;
    for (const t of titulos) {
      const novo = proximoDiaUtil(t.previsao);
      if (novo === t.previsao) continue;
      qtd += 1; valor += Number(t.valor) || 0;
      if (novo > fim) { foraQtd += 1; foraValor += Number(t.valor) || 0; }
    }
    return { qtd, valor, foraQtd, foraValor };
  }, [titulos, dias]);

  /** Quantos títulos DA CURVA já carregam um reagendamento gravado. É o que
   *  decide se a comparação faz sentido — sem nenhum, as duas curvas seriam
   *  idênticas e a segunda linha só poluiria. */
  const comOverrideNaCurva = useMemo(
    () => titulos.filter((t) => t.tem_override).length,
    [titulos],
  );

  const curva = useMemo(
    () => projetar(saldo0, titulos, dias, extras),
    [saldo0, titulos, dias, extras],
  );
  /** O contrafactual: sem nenhum reagendamento, gravado ou desta sessão. */
  const semAgendar = useMemo(
    () => (comOverrideNaCurva > 0 || extras.length
            ? projetar(saldo0, titulos, dias, [], true)
            : null),
    [saldo0, titulos, dias, extras.length, comOverrideNaCurva],
  );


  const rows = curva.map((p, i) => ({
    x: diaBr(p.dia),
    Entradas: p.entradas,
    Saídas: p.saidas,
    Saldo: p.saldo,
    ...(semAgendar ? { "Saldo sem agendar": semAgendar[i]?.saldo ?? 0 } : {}),
  }));

  // Verde entra, vermelho sai — convenção contábil, e aqui ela é legítima como
  // escala: entrada e saída são polos de uma mesma medida com sinal, não duas
  // categorias quaisquer.
  //
  // Verde↔vermelho é justamente o par que o daltônico confunde. O que salva é a
  // codificação secundária, que aqui é forte e estrutural: entrada cresce PRA
  // CIMA do zero e saída PRA BAIXO. A posição já distingue sem depender da cor.
  const barras: SeriesDef[] = [
    { key: "Entradas", label: "Entradas (a receber)", slot: 5, mark: "rect" },  // verde
    { key: "Saídas",   label: "Saídas (a pagar)",     slot: 3, mark: "rect" },  // vermelho
  ];
  // Com agendamento existem DUAS curvas: a simulada e a original. Ver as duas
  // juntas é o que diz se o reagendamento melhorou o caixa e em quanto — a
  // simulada sozinha não tem contra o quê ser comparada.
  const linhas: SeriesDef[] = semAgendar
    ? [{ key: "Saldo", label: "Saldo com agendados", slot: 0, mark: "line" },
       { key: "Saldo sem agendar", label: "Saldo sem agendar", slot: 4, mark: "line" }]
    : [{ key: "Saldo", label: "Saldo projetado", slot: 0, mark: "line" }];

  const resumo = useMemo(() => {
    const s = curva.map((p) => p.saldo);
    let pior = 0;
    s.forEach((v, i) => { if (v < s[pior]) pior = i; });
    const ref = semAgendar ?? curva;
    const piorRef = ref.reduce((acc, p, i) => (p.saldo < ref[acc].saldo ? i : acc), 0);
    return {
      entradas: curva.reduce((a, p) => a + p.entradas, 0),
      saidas:   curva.reduce((a, p) => a + p.saidas, 0),
      piorDia: curva[pior]?.dia ?? null,
      piorSaldo: s[pior] ?? 0,
      negativos: s.filter((v) => v < 0).length,
      piorSaldoSemAgendar: ref[piorRef]?.saldo ?? 0,
    };
  }, [curva, semAgendar]);

  const agendadosForaDaJanela = useMemo(
    () => Array.from(agenda.values()).filter((d) => d > addDias(hojeIso(), dias)).length,
    [agenda, dias],
  );

  const atrasoTot = useMemo(() => {
    const soma = (n: "R" | "P") =>
      atrasados.filter((t) => t.natureza === n).reduce((a, t) => a + (Number(t.valor) || 0), 0);
    const qtd = (n: "R" | "P") => atrasados.filter((t) => t.natureza === n).length;
    return {
      receber: soma("R"), pagar: soma("P"),
      qtdReceber: qtd("R"), qtdPagar: qtd("P"),
      pendentesOmie: atrasados.filter((t) => t.tem_override && !t.sincronizado_omie).length,
    };
  }, [atrasados]);

  /** Universo da mesa conforme o escopo. `atrasados` e `titulos` já vêm
   *  separados do servidor (duas chamadas de fluxo_caixa_titulos), então "todos"
   *  é só a união — sem consulta nova e sem risco de contar duas vezes, porque
   *  vencido e a-vencer são mutuamente exclusivos por construção. */
  const universo = useMemo(() => {
    if (escopo === "atrasados") return atrasados;
    if (escopo === "a_vencer")  return titulos;
    return [...atrasados, ...titulos];
  }, [escopo, atrasados, titulos]);

  /** Categorias presentes no universo atual, com valor — quem reagenda escolhe
   *  pelo peso, não pelo nome. */
  const catsOpcoes = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of universo) m.set(t.categoria, (m.get(t.categoria) ?? 0) + Number(t.valor || 0));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [universo]);

  const lista = useMemo(() => {
    const q = normaliza(busca);
    const arr = universo
      .filter((t) => tipo === "todos" || t.natureza === tipo)
      .filter((t) => !catsSel.size || catsSel.has(t.categoria))
      // Recorte pela previsão EFETIVA, que é a data que a curva usa.
      .filter((t) => !prevDe  || (t.previsao && t.previsao >= prevDe))
      .filter((t) => !prevAte || (t.previsao && t.previsao <= prevAte))
      .filter((t) => !q || normaliza(
        `${t.contraparte} ${t.categoria} ${t.documento} ${t.num_titulo ?? ""}`).includes(q));

    const sinal = ordem.desc ? -1 : 1;
    // String(...) em tudo: contraparte e categoria vêm de left join e podem ser
    // nulas. localeCompare em null lança, e a exceção acontece DENTRO do sort,
    // no meio do render.
    return arr.slice().sort((a, b) => {
      switch (ordem.col) {
        case "valor":       return sinal * (Number(a.valor) - Number(b.valor));
        case "previsao":    return sinal * String(a.previsao ?? "").localeCompare(String(b.previsao ?? ""));
        case "vencimento":  return sinal * String(a.vencimento ?? "").localeCompare(String(b.vencimento ?? ""));
        case "contraparte": return sinal * String(a.contraparte ?? "").localeCompare(String(b.contraparte ?? ""), "pt-BR");
        case "categoria":   return sinal * String(a.categoria ?? "").localeCompare(String(b.categoria ?? ""), "pt-BR");
        default:            return 0;
      }
    });
  }, [universo, tipo, catsSel, prevDe, prevAte, busca, ordem]);

  /** Teto de linhas DESENHADAS.
   *
   *  Cada linha carrega um <input type="date"> nativo, que é caro. Com o escopo
   *  "Todos" a mesa passou de 151 pra 723 linhas e o renderizador do navegador
   *  caiu ao reordenar. O teto resolve sem esconder nada: a contagem real fica
   *  no cabeçalho e um aviso no rodapé diz quantas ficaram de fora.
   *
   *  A ordenação acontece ANTES do corte, então o topo é sempre o que importa
   *  pela ordem escolhida — por padrão, os maiores valores, que são os que movem
   *  a curva. Cortar antes de ordenar mostraria 150 linhas arbitrárias. */
  const TETO_LINHAS = 150;
  const linhasNaMesa = useMemo(() => lista.slice(0, TETO_LINHAS), [lista]);
  const linhasOcultas = lista.length - linhasNaMesa.length;

  const totalLista = useMemo(() => {
    const soma = (n: "R" | "P") =>
      lista.filter((t) => t.natureza === n).reduce((a, t) => a + (Number(t.valor) || 0), 0);
    return { receber: soma("R"), pagar: soma("P") };
  }, [lista]);

  /** Data aceitável: COMPLETA e não no passado. Não limito ao fim da janela —
   *  agendar pra depois dela é legítimo, o título só não aparece na curva atual.
   *  Recusar seria descartar em silêncio o que o usuário acabou de digitar. */
  const dataUtil = (v: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= hojeIso() && v <= "2100-12-31";

  /** Agendado pra depois do fim da janela: gravado, mas fora do gráfico. */
  const foraDaJanela = (v: string) => dataUtil(v) && v > addDias(hojeIso(), dias);

  // Grava no painel (não no Omie). É o que faz o título entrar na curva.
  const gravar = async (alvos: Array<{ cod: number; dia: string }>) => {
    if (!alvos.length) return;
    setSalvando(true);
    try {
      for (const a of alvos) {
        const r = await fetch("/api/previsao", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cod_titulo: a.cod, dt_previsao_nova: a.dia }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setErr(j.error ?? "falha ao gravar previsão");
          return;
        }
      }
      setAgenda((prev) => {
        const n = new Map(prev);
        for (const a of alvos) n.set(a.cod, a.dia);
        return n;
      });
      setErr(null);
      // Recarrega: `extras` só ponteia atrasados reagendados na sessão, então um
      // título A VENCER remarcado gravaria no banco e a curva não se moveria —
      // ele continuaria em `titulos` na data antiga. Com o reload, o servidor
      // devolve a previsão efetiva já nova e os dois escopos se comportam igual.
      // O título também migra de escopo quando deixa de estar vencido, que é o
      // certo: ele não é mais um atrasado.
      await load();
    } finally {
      setSalvando(false);
    }
  };

  const enviarOmie = async (dryRun: boolean, only?: number[]) => {
    const qtd = only?.length ?? atrasoTot.pendentesOmie;
    if (!dryRun) {
      const ok = window.confirm(
        only && only.length === 1
          ? `Enviar a alteração do título ${only[0]} pro Omie? Isso altera dado real no ERP.`
          : `Enviar ${qtd} alteração(ões) pro Omie? Isso altera dados reais no ERP.`,
      );
      if (!ok) return;
    }
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await fetch("/api/previsao/sync-omie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dry_run: dryRun, only }),
      });
      const j = (await r.json()) as SyncResult & { error?: string };
      if (!r.ok) { setErr(j.error ?? "falha no envio"); return; }
      setSyncResult(j);
      if (!dryRun) void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const cen = data?.cenario;
  const cenRows = cen ? [
    { x: "Entradas (Safe)",  v: Number(cen.entrada) },
    { x: "Saídas (Grupo)",   v: -Number(cen.saida) },
    { x: "Resultado",        v: Number(cen.resultado) },
    { x: "Atraso a receber", v: Number(cen.atraso_receber) },
    { x: "Atraso a pagar",   v: -Number(cen.atraso_pagar) },
    { x: "Se atrasos liquidados", v: Number(cen.resultado_se_atraso_pago) },
  ] : [];

  const mensalRows = (data?.mensal ?? []).map((m) => ({
    x: mesBr(m.mes),
    "Entrada prevista":  Number(m.entrada_prevista),
    "Entrada realizada": Number(m.entrada_realizada),
    "Saída prevista":    Number(m.saida_prevista),
    "Saída realizada":   Number(m.saida_realizada),
    "Resultado realizado": Number(m.resultado_realizado),
  }));
  // Duas medidas, dois estados — não quatro coisas.
  //
  // Antes cada uma das quatro séries tinha um hue próprio (verde, amarelo, lima,
  // verde-azulado). O leitor precisava decorar quatro cores sem relação com o
  // significado, e entrada não se distinguia de saída pela cor.
  //
  // Agora o HUE diz a medida — verde entra, vermelho sai, os mesmos do fluxo
  // diário — e o PREENCHIMENTO diz o estado: vazado é previsto, sólido é
  // realizado. Lê-se "quanto do previsto virou realizado" comparando a barra
  // cheia com a vazada ao lado, que é a pergunta do gráfico.
  //
  // Sobre o par verde↔vermelho: ele mede CVD ΔE 3.3, muito abaixo do gate de 8 —
  // é o par que o daltônico não separa. Fica assim de propósito, porque a
  // codificação secundária aqui é estrutural e não depende de cor nenhuma:
  // entrada cresce PRA CIMA do zero e saída PRA BAIXO. Em visão normal os dois
  // medem ΔE 25.3, então a convenção contábil se mantém para quem enxerga cor.
  // Trocar por dois hues distinguíveis (azul/laranja) passaria no validador e
  // perderia a leitura imediata de "entra/sai", que é o que se lê primeiro.
  const mensalBarras: SeriesDef[] = [
    { key: "Entrada prevista",  label: "Entrada prevista",  slot: 5, mark: "rect", variante: "vazada" },
    { key: "Entrada realizada", label: "Entrada realizada", slot: 5, mark: "rect" },
    { key: "Saída prevista",    label: "Saída prevista",    slot: 3, mark: "rect", variante: "vazada" },
    { key: "Saída realizada",   label: "Saída realizada",   slot: 3, mark: "rect" },
  ];
  const mensalLinha: SeriesDef[] = [
    { key: "Resultado realizado", label: "Resultado realizado", slot: 0, mark: "line" },
  ];


  const selecionados = Array.from(sel);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap bg-ww-panel border border-ww-border rounded-xl p-2.5">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-ww-textMuted mr-1">Janela</span>
          {JANELAS.map((j) => (
            <button key={j.key} type="button" onClick={() => setJanela(j.key)}
              title={`${j.dias()} dias a partir de hoje`}
              className={`px-2 py-0.5 text-[11px] rounded border transition ${
                janela === j.key ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                                 : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
              {j.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ww-textFaint">
          Recebe <strong className="text-ww-textMuted">Safe</strong> · paga{" "}
          <strong className="text-ww-textMuted">Safe + CDG + Water</strong> · atrasados com previsão
          em <strong className="text-ww-textMuted">{data?.ano ?? "—"}</strong>
        </p>
        {agenda.size > 0 && (
          <button type="button" onClick={() => { setAgenda(new Map()); void load(); }}
            className="ml-auto px-2 py-0.5 text-[11px] rounded border border-ww-accent text-ww-accent hover:bg-ww-accentSoft transition font-semibold">
            Limpar agendados da curva ({agenda.size})
          </button>
        )}
      </div>

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl p-3 text-[12px]">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Saldo de partida (Omie)" value={brl(saldo0)}
          hint={data?.saldo_atual
            ? `${data.saldo_atual.origem === "manual" ? "Ajuste manual" : "Extrato Omie.CASH"} de ${
                data.saldo_atual.dt_ref ? diaBr(data.saldo_atual.dt_ref) : "—"}`
            : "Sem extrato"} />
        <StatTile label={`Entradas a vencer · ${jan.label.toLowerCase()}`} value={brl(resumo.entradas)}
          hint={`${titulos.filter((t) => t.natureza === "R").length} títulos · Safe`} />
        <StatTile label={`Saídas a vencer · ${jan.label.toLowerCase()}`} value={brl(Math.abs(resumo.saidas))}
          hint={`${titulos.filter((t) => t.natureza === "P").length} títulos · Grupo`}
          higherIsBetter={false} />
        {/* As duas janelas de atraso que faltavam. */}
        <StatTile label="Recebíveis em atraso" value={brl(atrasoTot.receber)}
          hint={`${atrasoTot.qtdReceber} títulos Safe · previsão ${data?.ano ?? ""}`}
          higherIsBetter={false} />
        <StatTile label="A pagar em atraso (grupo)" value={brl(atrasoTot.pagar)}
          hint={`${atrasoTot.qtdPagar} títulos · previsão ${data?.ano ?? ""}`}
          higherIsBetter={false} />
        <StatTile label={semAgendar ? "Dia mais apertado (c/ agendados)" : "Dia mais apertado"}
          value={brl(resumo.piorSaldo)}
          hint={resumo.piorDia
            ? `${diaBr(resumo.piorDia)}${resumo.negativos ? ` · ${resumo.negativos} dia(s) negativo(s)` : " · nunca negativa"}`
            : "—"}
          delta={semAgendar && resumo.piorSaldoSemAgendar !== 0
            ? (resumo.piorSaldo - resumo.piorSaldoSemAgendar) / Math.abs(resumo.piorSaldoSemAgendar)
            : null}
          deltaLabel="vs. sem agendar" />
      </div>

      <ChartFrame
        title="Fluxo de caixa projetado"
        subtitle={
          `Barras = movimento do dia · linha = saldo acumulado, partindo de ${brl(saldo0)}. `
          + `Só o que está a vencer; atrasado entra ao ganhar data. `
          + `Previsão em fim de semana é lida no próximo dia útil — o Omie não grava esse ajuste no campo`
          + (empurrao.qtd
              ? `: ${empurrao.qtd} título(s), ${brl(empurrao.valor)}`
              : "")
          + (empurrao.foraQtd
              ? `, dos quais ${empurrao.foraQtd} (${brl(empurrao.foraValor)}) caem depois do fim da janela e saem da curva`
              : "")
          + `. Feriados não entram no ajuste.`
        }
        series={[...barras, ...linhas]}
        rows={rows}
        valueFormat={(v) => brl(Number(v))}
        loading={loading}
        height={340}
      >
        {/* Recebe as séries que sobraram dos cliques na legenda e desenha só
            elas — clicar em "Saídas" some com as barras vermelhas, clicar numa
            curva de saldo isola a outra. */}
        {(visiveis) => (
          <VizCombo
            rows={rows}
            bars={barras.filter((b) => visiveis.some((v) => v.key === b.key))}
            lines={linhas.filter((l) => visiveis.some((v) => v.key === l.key))}
            valueFormat={(v) => brl(v)}
          />
        )}
      </ChartFrame>

      {/* Painel de agendamento — o que era "simular datas", agora com gravação,
          lote e envio pro Omie. */}
      <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5">
        <header className="viz-head flex items-center gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
              Reagendar títulos
            </h3>
            <p className="text-[11px] text-ww-textMuted mt-0.5 normal-case">
              {lista.length} de {universo.length} títulos ·{" "}
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">
                {brl(totalLista.receber)} a receber
              </span>{" · "}
              <span className="text-rose-600 dark:text-rose-400 tabular-nums">
                {brl(totalLista.pagar)} a pagar
              </span>
              . Dar uma data grava no painel e move a curva; enviar pro Omie é o passo ao lado.
            </p>
          </div>
          {/* Escopo primeiro: define o universo. Os outros filtros recortam dentro
              dele, então mudá-lo depois seria reordenar a leitura. */}
          <div className="flex items-center gap-1">
            {([["atrasados", `Atrasados (${atrasados.length})`],
               ["a_vencer",  `A vencer (${titulos.length})`],
               ["todos",     "Todos"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setEscopo(k); setSel(new Set()); }}
                className={`px-2 py-0.5 text-[11px] rounded border transition ${
                  escopo === k ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                               : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
                {l}
              </button>
            ))}
          </div>
          <span className="h-5 w-px bg-ww-border" />
          <div className="flex items-center gap-1">
            {([["todos", "Todos"], ["R", "A receber"], ["P", "A pagar"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTipo(k)}
                className={`px-2 py-0.5 text-[11px] rounded border transition ${
                  tipo === k ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                             : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
                {l}
              </button>
            ))}
          </div>
          <CategoriaFiltro opcoes={catsOpcoes} selected={catsSel}
            onToggle={(v) => setCatsSel((prev) => {
              const n = new Set(prev);
              if (n.has(v)) n.delete(v); else n.add(v);
              return n;
            })}
            onClear={() => setCatsSel(new Set())} />
          {/* Recorte por previsão: o eixo em que o reagendamento opera. */}
          <div className="flex items-center gap-1 text-[10.5px] text-ww-textMuted">
            <span className="uppercase tracking-wider">Previsão</span>
            <input type="date" value={prevDe} onChange={(e) => setPrevDe(e.target.value)}
              title="Previsão a partir de"
              className="text-[11px] bg-ww-bg border border-ww-border rounded px-1.5 py-0.5 text-ww-text" />
            <span>→</span>
            <input type="date" value={prevAte} onChange={(e) => setPrevAte(e.target.value)}
              title="Previsão até"
              className="text-[11px] bg-ww-bg border border-ww-border rounded px-1.5 py-0.5 text-ww-text" />
            {(prevDe || prevAte) && (
              <button type="button" onClick={() => { setPrevDe(""); setPrevAte(""); }}
                className="text-ww-accent hover:underline">limpar</button>
            )}
          </div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar…"
            className="w-[150px] text-[11px] bg-ww-bg border border-ww-border rounded px-2 py-1 text-ww-text placeholder:text-ww-textFaint" />
        </header>

        {/* Barra de lote — só aparece com seleção, pra não ocupar espaço à toa. */}
        {podeEditar && selecionados.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-2 p-2 rounded-lg bg-ww-accentSoft border border-ww-accent/40">
            <span className="text-[11px] font-semibold text-ww-accent">
              {selecionados.length} selecionado(s)
            </span>
            <input type="date" value={dataLote} min={hojeIso()}
              onChange={(e) => setDataLote(e.target.value)}
              className="text-[11px] bg-ww-bg border border-ww-border rounded px-1.5 py-0.5 text-ww-text" />
            <button type="button" disabled={!dataUtil(dataLote) || salvando}
              title={dataLote && !dataUtil(dataLote) ? "Informe uma data a partir de hoje"
                : foraDaJanela(dataLote) ? "Grava, mas cai depois do fim da janela — não aparece na curva"
                : undefined}
              onClick={() => gravar(selecionados.map((cod) => ({ cod, dia: dataLote })))}
              className="px-2 py-0.5 text-[11px] rounded border border-ww-accent text-ww-accent hover:bg-ww-accent hover:text-white transition font-semibold disabled:opacity-40">
              {salvando ? "Gravando…" : "Aplicar data ao lote"}
            </button>
            <button type="button" disabled={syncing}
              onClick={() => enviarOmie(true, selecionados)}
              className="px-2 py-0.5 text-[11px] rounded border border-ww-border text-ww-textMuted hover:text-ww-text transition disabled:opacity-40">
              Simular no Omie
            </button>
            <button type="button" disabled={syncing}
              onClick={() => enviarOmie(false, selecionados)}
              className="px-2 py-0.5 text-[11px] rounded border border-amber-500 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition font-semibold disabled:opacity-40">
              {syncing ? "Enviando…" : "Enviar lote pro Omie"}
            </button>
            <button type="button" onClick={() => setSel(new Set())}
              className="text-[10.5px] text-ww-textFaint hover:text-ww-text underline ml-auto">
              limpar seleção
            </button>
          </div>
        )}

        {syncResult && (
          <div className={`mb-2 px-3 py-2 rounded-lg text-[11.5px] border ${
            syncResult.ok
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200"
              : "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"}`}>
            {syncResult.dry_run ? "Simulação" : "Envio"}: {syncResult.sucessos} OK ·{" "}
            {syncResult.erros} erro(s) · {syncResult.dry_runs} simulado(s)
            {syncResult.results.filter((r) => r.erro).slice(0, 3).map((r) => (
              <div key={r.cod_titulo} className="mt-0.5 opacity-80">
                {r.contraparte}: {r.erro}
              </div>
            ))}
          </div>
        )}

        <div className="overflow-auto" style={{ maxHeight: 400 }}>
          <table className="w-full text-[11.5px] border-collapse">
            <thead className="sticky top-0 z-10 bg-ww-panel">
              <tr className="text-[10px] uppercase tracking-wider text-ww-textMuted">
                {podeEditar && (
                  <th style={{ width: 34 }} className="p-1.5 shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">
                    <input type="checkbox"
                      checked={linhasNaMesa.length > 0 && linhasNaMesa.every((t) => sel.has(t.cod_titulo))}
                      title={linhasOcultas > 0 ? `Marca as ${linhasNaMesa.length} linhas na tela` : undefined}
                      onChange={(e) => setSel(e.target.checked
                        ? new Set(linhasNaMesa.map((t) => t.cod_titulo)) : new Set())}
                      className="accent-ww-accent" />
                  </th>
                )}
                <th style={{ width: 58 }} className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Tipo</th>
                <th style={{ width: 52 }} className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Emp.</th>
                <Th col="contraparte" w={196} ordem={ordem} setOrdem={setOrdem}>Contraparte</Th>
                <Th col="categoria"   w={130} ordem={ordem} setOrdem={setOrdem}>Categoria</Th>
                <Th col="vencimento"  w={74}  ordem={ordem} setOrdem={setOrdem}>Vencto</Th>
                {/* Previsão vigente: é a data que a curva usa hoje, e o ponto de
                    partida de qualquer reagendamento. Faltava na tela. */}
                <Th col="previsao"    w={78}  ordem={ordem} setOrdem={setOrdem}>Previsão</Th>
                <th style={{ width: 78 }} className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Situação</th>
                <Th col="valor" w={112} alinhaDireita ordem={ordem} setOrdem={setOrdem}>Valor</Th>
                <th style={{ width: 128 }} className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Nova previsão</th>
                <th style={{ width: 96 }} className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Omie</th>
              </tr>
            </thead>
            <tbody className={loading ? "opacity-40" : ""}>
              {linhasNaMesa.length === 0 && (
                <tr><td colSpan={podeEditar ? 12 : 11} className="p-6 text-center text-ww-textFaint">
                  {loading ? "Carregando…" : "Nenhum título com os filtros atuais."}
                </td></tr>
              )}
              {linhasNaMesa.map((t) => {
                const dia = agenda.get(t.cod_titulo) ?? (t.tem_override ? t.previsao : "");
                const pendente = t.tem_override && !t.sincronizado_omie;
                return (
                  <tr key={t.cod_titulo} className={`viz-row ${dia ? "bg-ww-accentSoft/40" : ""}`}>
                    {podeEditar && (
                      <td className="p-1.5 border-b border-ww-border/50">
                        <input type="checkbox" checked={sel.has(t.cod_titulo)}
                          onChange={(e) => setSel((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(t.cod_titulo); else n.delete(t.cod_titulo);
                            return n;
                          })}
                          className="accent-ww-accent" />
                      </td>
                    )}
                    <td className="p-1.5 border-b border-ww-border/50">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        t.natureza === "R"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30"}`}>
                        {t.natureza === "R" ? "Entra" : "Sai"}
                      </span>
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted">{t.empresa}</td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-text truncate" title={t.contraparte}>
                      {t.contraparte}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted truncate" title={t.categoria}>
                      {t.categoria}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted tabular-nums">
                      {t.vencimento ? diaBr(t.vencimento) : "—"}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-text tabular-nums">
                      {t.previsao ? diaBr(t.previsao) : "—"}
                      {t.tem_override && (
                        <span title={`Reagendado no painel. Previsão original do Omie: ${
                          t.previsao_original ? diaBr(t.previsao_original) : "—"}`}
                          className="ml-1 text-[9px] text-ww-accent">↻</span>
                      )}
                    </td>
                    {/* Situação: atrasado mostra há quanto tempo; a vencer mostra
                        em quantos dias. Com os dois escopos na mesma tabela, uma
                        coluna só de "atraso" ficaria vazia em metade das linhas. */}
                    <td className="p-1.5 border-b border-ww-border/50">
                      {t.faixa_atraso ? (
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] border tabular-nums ${
                          FAIXA_TOM[t.faixa_atraso] ?? ""}`}
                          title={`Vencido há ${t.dias_atraso} dia(s)`}>
                          {t.dias_atraso}d atraso
                        </span>
                      ) : (() => {
                        const d = diasAte(t.previsao);
                        if (d == null) return null;
                        return (
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] border tabular-nums ${
                            d === 0 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                                    : "bg-ww-border/50 text-ww-textMuted border-ww-border"}`}
                            title={d === 0 ? "Vence hoje" : `Vence em ${d} dia(s)`}>
                            {d === 0 ? "hoje" : `em ${d}d`}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-right tabular-nums text-ww-text">
                      {brl(Number(t.valor))}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50">
                      <input type="date"
                        value={rascunho.get(t.cod_titulo) ?? dia}
                        min={hojeIso()}
                        disabled={!podeEditar || salvando}
                        // Digitação mexe só no rascunho — ver o comentário do estado.
                        onChange={(e) => setRascunho((prev) =>
                          new Map(prev).set(t.cod_titulo, e.target.value))}
                        // Commit ao sair do campo ou no Enter, e só se a data
                        // estiver completa e dentro da janela.
                        onBlur={(e) => {
                          const v = e.target.value;
                          setRascunho((prev) => {
                            const n = new Map(prev);
                            n.delete(t.cod_titulo);
                            return n;
                          });
                          if (dataUtil(v) && v !== dia) {
                            void gravar([{ cod: t.cod_titulo, dia: v }]);
                          }
                        }}
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                        className="text-[11px] bg-ww-bg border border-ww-border rounded px-1.5 py-0.5 text-ww-text disabled:opacity-50" />
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50">
                      {t.sincronizado_omie ? (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400" title="Já enviado pro Omie">
                          ✓ enviado
                        </span>
                      ) : pendente && podeEditar ? (
                        <button type="button" disabled={syncing}
                          onClick={() => enviarOmie(false, [t.cod_titulo])}
                          title="Enviar esta previsão pro Omie"
                          className="px-1.5 py-0.5 text-[10px] rounded border border-amber-500 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition font-semibold disabled:opacity-40">
                          ↑ Omie
                        </button>
                      ) : (
                        <span className="text-[10px] text-ww-textFaint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Corte declarado. Um teto silencioso leria como "é só isso" — e aqui
            "é só isso" seria uma conclusão errada sobre o próprio caixa. */}
        {linhasOcultas > 0 && (
          <p className="mt-2 px-1 text-[10.5px] text-ww-textFaint">
            Mostrando as {linhasNaMesa.length} primeiras de {lista.length} pela ordem atual
            ({ORDEM_ROTULO[ordem.col]} {ordem.desc ? "↓" : "↑"}).
            Outras {linhasOcultas} não estão na tela — use categoria, previsão ou a busca pra
            chegar nelas. O teto existe porque cada linha traz um campo de data, e desenhar
            centenas ao mesmo tempo derrubava o navegador.
          </p>
        )}
      </section>

      {cen && (
        <ChartFrame
          title={`Resultado acumulado + em atraso (cenário ${data?.ano})`}
          subtitle="Caixa realizado (extrato conciliado): entradas da Safe contra saídas do grupo. As duas últimas colunas são o cenário de liquidar os atrasos com previsão neste ano"
          series={[{ key: "v", label: "R$", slot: 0 }]}
          rows={cenRows}
          valueFormat={(v) => brl(Number(v))}
          loading={loading}
          height={280}
        >
          <VizBar rows={cenRows} series={[{ key: "v", label: "R$", slot: 0 }]}
                  valueFormat={(v) => brl(v)} />
        </ChartFrame>
      )}

      {cen && (
        <p className="text-[11px] text-ww-textMuted px-1 -mt-1">
          A entrada é <strong>só da Safe</strong> e a saída é do <strong>grupo inteiro</strong>:{" "}
          {brl(Number(cen.saida_de_fora))} saem de CDG e Water sem entrada correspondente aqui. Só
          com a Safe dos dois lados o resultado seria{" "}
          {brl(Number(cen.entrada) - Number(cen.saida_da_entrada))} — é o que o card do Metabase
          mostrava.
        </p>
      )}

      <ChartFrame
        title={`Fluxo de caixa mensal — previsto × realizado (${data?.ano})`}
        subtitle="Previsto sai dos títulos pela data de previsão; realizado sai do extrato conciliado. Entradas pra cima, saídas pra baixo"
        series={[...mensalBarras, ...mensalLinha]}
        rows={mensalRows}
        valueFormat={(v) => brl(Number(v))}
        loading={loading}
        height={320}
      >
        {/* 5 séries no mesmo painel: previsto e realizado de entrada e saída,
            mais o resultado. Isolar um par (só previsto, ou só entradas) é o que
            torna a comparação legível. */}
        {(visiveis) => (
          <VizCombo
            rows={mensalRows}
            bars={mensalBarras.filter((b) => visiveis.some((v) => v.key === b.key))}
            lines={mensalLinha.filter((l) => visiveis.some((v) => v.key === l.key))}
            valueFormat={(v) => brl(v)}
          />
        )}
      </ChartFrame>

      <VizTable
        title="Saldo por conta corrente"
        subtitle="Todas as contas das três empresas. A projeção ancora só na Omie.CASH da Safe"
        cols={COLS_CONTAS}
        rows={data?.contas ?? []}
        ordemInicial="saldo"
        totalizar={["saldo"]}
        loading={loading}
        altura={240}
      />
    </div>
  );
}

/** Cabeçalho de coluna ordenável. Clique alterna a direção; clique em outra
 *  coluna começa descendente, que é o que se quer em quase todo caso. */
function Th({
  col, w, children, ordem, setOrdem, alinhaDireita = false,
}: {
  col: OrdemCol; w: number; children: React.ReactNode;
  ordem: { col: OrdemCol; desc: boolean };
  setOrdem: (o: { col: OrdemCol; desc: boolean }) => void;
  alinhaDireita?: boolean;
}) {
  const ativa = ordem.col === col;
  return (
    <th style={{ width: w }}
        className={`p-1.5 shadow-[0_1px_0_0_rgb(var(--color-ww-border))] ${
          alinhaDireita ? "text-right" : "text-left"}`}>
      <button type="button"
        onClick={() => setOrdem(ativa ? { col, desc: !ordem.desc } : { col, desc: true })}
        className={`inline-flex items-center gap-0.5 uppercase tracking-wider transition ${
          ativa ? "text-ww-accent font-semibold" : "hover:text-ww-text"}`}>
        {children}
        <span className="text-[8px] opacity-70">{ativa ? (ordem.desc ? "▼" : "▲") : ""}</span>
      </button>
    </th>
  );
}

/** Filtro de categoria multi-seleção, ordenado por VALOR — quem reagenda escolhe
 *  pelo peso no fluxo, não pela ordem alfabética. */
function CategoriaFiltro({
  opcoes, selected, onToggle, onClear,
}: {
  opcoes: Array<[string, number]>;
  selected: Set<string>;
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  return (
    <div className="relative" ref={caixa}>
      <button type="button" onClick={() => setAberto((v) => !v)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded border transition ${
          selected.size
            ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
            : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
        Categoria
        {selected.size > 0 && (
          <span className="px-1 rounded bg-ww-accent text-white text-[9.5px]">{selected.size}</span>
        )}
      </button>
      {aberto && (
        <div className="absolute right-0 mt-1 z-50 w-[300px] max-h-[320px] overflow-auto rounded-lg border border-ww-border bg-ww-drawer shadow-xl p-1 animate-in fade-in-0 slide-in-from-top-1">
          {opcoes.length === 0 && (
            <p className="px-2 py-2 text-[11px] text-ww-textFaint">Nada no escopo atual.</p>
          )}
          {opcoes.map(([cat, val]) => {
            const on = selected.has(cat);
            return (
              <button key={cat} type="button" onClick={() => onToggle(cat)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md text-[11px] transition text-left ${
                  on ? "bg-ww-accentSoft font-semibold" : "hover:bg-ww-rowHover"}`}>
                <span className="truncate text-ww-text" title={cat}>{cat}</span>
                <span className="shrink-0 text-[10px] text-ww-textFaint tabular-nums">{brl(val)}</span>
              </button>
            );
          })}
          {selected.size > 0 && (
            <button type="button" onClick={onClear}
              className="w-full mt-0.5 px-2 py-1 text-[10.5px] text-ww-accent hover:underline text-left border-t border-ww-border">
              limpar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
