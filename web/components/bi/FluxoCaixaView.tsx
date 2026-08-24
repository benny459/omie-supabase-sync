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

/** Data de HOJE no fuso do usuário, não em UTC.
 *
 *  toISOString() devolve UTC: às 22h de Brasília ele já diz que é o dia
 *  seguinte. Como a gravação recusa data anterior a "hoje", digitar a data de
 *  hoje à noite era RECUSADO EM SILÊNCIO — o onBlur não chamava a API e nada
 *  aparecia na tela. Os atalhos "Hoje" também apontavam pro dia errado. */
const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Timestamp do banco (UTC) para data local YYYY-MM-DD. Comparar a fatia crua do
 *  ISO compararia o dia em UTC, e um reagendamento feito às 22h cairia no dia
 *  seguinte no filtro. */
const diaLocalDe = (ts: string | null) => {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
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
  contraparte: "contraparte", categoria: "categoria", reprogramado_em: "reprogramado em",
};
type OrdemCol = "valor" | "previsao" | "vencimento" | "contraparte" | "categoria" | "reprogramado_em";

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
  /** Quando eu reprogramei. Null se nunca mexi no título. */
  reprogramado_em: string | null;
  /** Fora da curva: pagamento a repactuar ou cancelar, sem data confiável. */
  em_renegociacao: boolean;
  motivo_renegociacao: string | null;
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


/** Uma fatia do rateio: data destino e quanto do total deve cair nela. */
type Fatia = { data: string; pct: number };

/** Distribui títulos INTEIROS entre as fatias, chegando o mais perto possível da
 *  proporção pedida.
 *
 *  Título é indivisível: não dá pra pagar metade numa data e metade em outra sem
 *  quebrar a parcela no Omie. Então o rateio é uma APROXIMAÇÃO por itens
 *  inteiros, e a tela mostra o que saiu de fato ao lado do que foi pedido — a
 *  diferença é real e esconder seria mentir sobre o caixa.
 *
 *  Heurística: do maior valor pro menor, cada título vai pra fatia com a maior
 *  falta absoluta. É o guloso clássico de particionamento — não é ótimo, mas
 *  erra pouco e é previsível, que aqui vale mais que perfeição: quem confere
 *  precisa entender por que aquele título caiu naquela data. */
function ratear(titulos: Titulo[], fatias: Fatia[]) {
  const validas = fatias.filter((f) => f.data && f.pct > 0);
  if (!validas.length || !titulos.length) return null;

  const total = titulos.reduce((a, t) => a + (Number(t.valor) || 0), 0);
  const somaPct = validas.reduce((a, f) => a + f.pct, 0) || 1;
  const baldes = validas.map((f) => ({
    data: f.data,
    pct: f.pct,
    // Normaliza: se as porcentagens não somam 100, respeita a proporção entre
    // elas em vez de recusar. Quem digita 30/30/30 quer três partes iguais.
    meta: total * (f.pct / somaPct),
    valor: 0,
    itens: [] as Titulo[],
  }));

  for (const t of [...titulos].sort((a, b) => Number(b.valor) - Number(a.valor))) {
    const alvo = baldes.reduce((m, b) => (b.meta - b.valor > m.meta - m.valor ? b : m));
    alvo.valor += Number(t.valor) || 0;
    alvo.itens.push(t);
  }
  return { total, baldes };
}

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
  /** Prévia: título nesse mapa entra na data simulada, não na atual. Diferente
   *  de `extras`, que ACRESCENTA — aqui a data é SUBSTITUÍDA, senão o título
   *  contaria duas vezes, na data velha e na nova. */
  simulacao?: Map<number, string>,
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
      const dia = simulacao?.get(t.cod_titulo) ?? t.previsao;
      // A simulação pode jogar pra fora da janela — aí ele some da curva, que é
      // o efeito real de empurrar pra depois do horizonte.
      if (dia >= inicio && dia <= fim) lancar(proximoDiaUtil(dia), t);
    }
  }
  for (const x of extras) {
    const dia = simulacao?.get(x.t.cod_titulo) ?? x.dia;
    if (dia >= inicio && dia <= fim) lancar(proximoDiaUtil(dia), x.t);
  }

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
  /** Rateio em até 3 datas. Desligado = uma data só, o comportamento antigo. */
  const [rateioOn, setRateioOn] = useState(false);
  const [fatias, setFatias] = useState<Fatia[]>([
    { data: "", pct: 40 }, { data: "", pct: 30 }, { data: "", pct: 30 },
  ]);
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
  /** Recorte por QUANDO reprogramei — responde "o que mexi hoje?". */
  const [reprogDe, setReprogDe] = useState("");
  const [reprogAte, setReprogAte] = useState("");
  const [prevDe, setPrevDe] = useState("");
  const [prevAte, setPrevAte] = useState("");
  /** Só os que EU reprogramei. Ortogonal ao escopo: um reprogramado pode estar
   *  atrasado ou a vencer, então não cabe como quarta aba de escopo. */
  /** Simula o recebimento dos atrasados da Safe: soma-os ao saldo de partida.
   *
   *  Responde "e se eu cobrar o que está vencido?" sem inventar data pra cada
   *  título. Entra como saldo INICIAL e não como entrada num dia qualquer —
   *  escolher um dia seria fabricar informação que ninguém tem. */
  const [comAtrasoRecebido, setComAtrasoRecebido] = useState(false);
  const [soReprog, setSoReprog] = useState(false);
  /** Isola os que estão fora do fluxo — é aqui que se volta pra definir data. */
  const [soReneg, setSoReneg] = useState(false);
  /** Última linha clicada, âncora do shift. Ref e não state: muda a cada clique
   *  e não deve provocar re-render da tabela inteira. */
  const ancoraRef = useRef<number | null>(null);
  /** Ordenação da mesa. Padrão: maior valor primeiro, que é onde mexer move a
   *  curva. */
  const [ordem, setOrdem] = useState<{ col: OrdemCol; desc: boolean }>(
    { col: "valor", desc: true },
  );
  const [salvando, setSalvando] = useState(false);
  /** Confirmação da gravação. Antes não havia nenhuma: aplicava e a tela não
   *  dizia se deu certo, então dava pra achar que reprogramou sem ter. */
  const [aviso, setAviso] = useState<string | null>(null);
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

  const saldoOmie = Number(data?.saldo_atual?.saldo ?? 0);
  const titulos = useMemo(() => data?.titulos ?? [], [data]);
  const atrasados = useMemo(() => data?.atrasados ?? [], [data]);
  const podeEditar = data?.pode_editar ?? false;

  /** Títulos que a curva NÃO enxerga, e quanto isso representa. Tirar dinheiro
   *  da projeção deixa o gráfico mais bonito; sem esse número visível na tela,
   *  vira autoengano. */
  const foraDoFluxo = useMemo(() => {
    const fora = titulos.filter((t) => t.em_renegociacao);
    return {
      qtd: fora.length,
      pagar:   fora.filter((t) => t.natureza === "P").reduce((a, t) => a + (Number(t.valor) || 0), 0),
      receber: fora.filter((t) => t.natureza === "R").reduce((a, t) => a + (Number(t.valor) || 0), 0),
    };
  }, [titulos]);

  /** A curva só vê quem tem data confiável. */
  const titulosNaCurva = useMemo(() => titulos.filter((t) => !t.em_renegociacao), [titulos]);

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

  /** Saldo de partida da curva. Com a simulação ligada, entra o Omie MAIS os
   *  atrasados a receber da Safe. */
  const saldo0 = comAtrasoRecebido ? saldoOmie + atrasoTot.receber : saldoOmie;


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
    for (const t of titulosNaCurva) {
      const novo = proximoDiaUtil(t.previsao);
      if (novo === t.previsao) continue;
      qtd += 1; valor += Number(t.valor) || 0;
      if (novo > fim) { foraQtd += 1; foraValor += Number(t.valor) || 0; }
    }
    return { qtd, valor, foraQtd, foraValor };
  }, [titulosNaCurva, dias]);

  /** Quantos títulos DA CURVA já carregam um reagendamento gravado. É o que
   *  decide se a comparação faz sentido — sem nenhum, as duas curvas seriam
   *  idênticas e a segunda linha só poluiria. */
  const comOverrideNaCurva = useMemo(
    () => titulosNaCurva.filter((t) => t.tem_override).length,
    [titulosNaCurva],
  );

  /** Data aceitável: COMPLETA e não no passado. Não limito ao fim da janela —
   *  agendar pra depois dela é legítimo, o título só não aparece na curva atual.
   *  Recusar seria descartar em silêncio o que o usuário acabou de digitar.
   *  Função DECLARADA e não const: `destinos` a usa antes desta posição.
   */
  function dataUtil(v: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= hojeIso() && v <= "2100-12-31";
  }

  /** Universo da mesa conforme o escopo. `atrasados` e `titulos` já vêm
   *  separados do servidor (duas chamadas de fluxo_caixa_titulos), então "todos"
   *  é só a união — sem consulta nova e sem risco de contar duas vezes, porque
   *  vencido e a-vencer são mutuamente exclusivos por construção. */
  const universo = useMemo(() => {
    if (escopo === "atrasados") return atrasados;
    if (escopo === "a_vencer")  return titulos;
    return [...atrasados, ...titulos];
  }, [escopo, atrasados, titulos]);

  /** Quantos estão fora do fluxo no universo atual — o número do chip ⚖. */
  const qtdReneg = useMemo(
    () => universo.filter((t) => t.em_renegociacao).length,
    [universo],
  );

  /** Quantos reprogramados existem no universo atual — o número do chip. */
  const qtdReprog = useMemo(
    () => universo.filter((t) => t.tem_override).length,
    [universo],
  );

  /** Os títulos da seleção, não só os códigos — o rateio precisa dos valores. */
  const titulosSelecionados = useMemo(
    () => universo.filter((t) => sel.has(t.cod_titulo)),
    [sel, universo],
  );

  const distribuicaoRateio = useMemo(
    () => (rateioOn ? ratear(titulosSelecionados, fatias) : null),
    [rateioOn, titulosSelecionados, fatias],
  );

  /** Título → data destino. Uma data só, ou o rateio quando ligado. É este mapa
   *  que alimenta tanto a prévia da curva quanto a gravação, então prévia e
   *  resultado não podem divergir. */
  const destinos = useMemo(() => {
    const m = new Map<number, string>();
    if (rateioOn) {
      for (const b of distribuicaoRateio?.baldes ?? []) {
        for (const t of b.itens) m.set(t.cod_titulo, b.data);
      }
    } else if (dataUtil(dataLote)) {
      for (const cod of sel) m.set(cod, dataLote);
    }
    return m;
  }, [rateioOn, distribuicaoRateio, dataLote, sel]);



  const curva = useMemo(
    () => projetar(saldo0, titulosNaCurva, dias, extras),
    [saldo0, titulosNaCurva, dias, extras],
  );
  /** O contrafactual: sem nenhum reagendamento, gravado ou desta sessão. */
  const semAgendar = useMemo(
    () => (comOverrideNaCurva > 0 || extras.length
            ? projetar(saldo0, titulosNaCurva, dias, [], true)
            : null),
    [saldo0, titulosNaCurva, dias, extras.length, comOverrideNaCurva],
  );


  /** Prévia do lote: como a curva ficaria SE a data selecionada fosse aplicada.
   *
   *  Existe porque "Simular no Omie" só testa se a API aceitaria a chamada — não
   *  mostra o efeito no caixa, que é a pergunta de quem está reagendando. Sem
   *  isso, a decisão de mover R$ 60 mil de dia era tomada às cegas e só se via o
   *  resultado depois de gravar.
   *
   *  Só existe com data válida e seleção — desenhar uma terceira linha idêntica
   *  às outras seria ruído. */
  const previa = useMemo(() => {
    if (!destinos.size) return null;
    return projetar(saldo0, titulosNaCurva, dias, extras, false, destinos);
  }, [destinos, saldo0, titulosNaCurva, dias, extras]);

  const rows = curva.map((p, i) => ({
    x: diaBr(p.dia),
    Entradas: p.entradas,
    Saídas: p.saidas,
    Saldo: p.saldo,
    ...(semAgendar ? { "Saldo sem agendar": semAgendar[i]?.saldo ?? 0 } : {}),
    ...(previa ? { "Saldo simulado": previa[i]?.saldo ?? 0 } : {}),
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
  const linhas: SeriesDef[] = [
    ...(semAgendar
      ? [{ key: "Saldo", label: "Saldo com agendados", slot: 0, mark: "line" } as SeriesDef,
         { key: "Saldo sem agendar", label: "Saldo sem agendar", slot: 4, mark: "line" } as SeriesDef]
      : [{ key: "Saldo", label: "Saldo projetado", slot: 0, mark: "line" } as SeriesDef]),
    // A simulada entra por último pra desenhar por cima, e em âmbar: é hipótese,
    // não estado — não pode ter a mesma cor de nada que já aconteceu.
    ...(previa ? [{ key: "Saldo simulado", label: "▸ Caixa se aplicar o lote", slot: 2, mark: "line" } as SeriesDef] : []),
  ];

  /** O que o lote faria com o pior dia da janela. É o número que decide se vale
   *  aplicar: mover data só importa se o fundo do poço melhora. */
  const impactoPrevia = useMemo(() => {
    if (!previa) return null;
    const min = (ps: Ponto[]) => ps.reduce((m, p) => Math.min(m, p.saldo), Infinity);
    const antes = min(curva);
    const depois = min(previa);
    return { antes, depois, delta: depois - antes };
  }, [previa, curva]);

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
      .filter((t) => !soReprog || t.tem_override)
      .filter((t) => !soReneg || t.em_renegociacao)
      // Data de reprogramação: compara só a parte YYYY-MM-DD do timestamp.
      .filter((t) => !reprogDe  || (t.reprogramado_em ? diaLocalDe(t.reprogramado_em) >= reprogDe : false))
      .filter((t) => !reprogAte || (t.reprogramado_em ? diaLocalDe(t.reprogramado_em) <= reprogAte : false))
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
        case "reprogramado_em":
          return sinal * String(a.reprogramado_em ?? "").localeCompare(String(b.reprogramado_em ?? ""));
        default:            return 0;
      }
    });
  }, [universo, tipo, soReprog, soReneg, reprogDe, reprogAte, catsSel, prevDe, prevAte, busca, ordem]);

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

  const selecionados = Array.from(sel);

  /** Quanto a seleção move, separado por lado. Selecionar sem ver o total é
   *  operar às cegas — e entra e sai NÃO viram um número só: mover R$ 50 mil de
   *  entrada é o oposto de mover R$ 50 mil de saída.
   *
   *  Soma sobre o UNIVERSO, não sobre a lista filtrada: a seleção sobrevive à
   *  troca de filtro, e somar só o visível daria um total menor que o que o
   *  botão vai de fato aplicar. */
  const totalSelecao = useMemo(() => {
    if (!sel.size) return null;
    let receber = 0, pagar = 0;
    for (const t of universo) {
      if (!sel.has(t.cod_titulo)) continue;
      if (t.natureza === "R") receber += Number(t.valor) || 0;
      else pagar += Number(t.valor) || 0;
    }
    return { receber, pagar };
  }, [sel, universo]);

  /** Códigos que vão pro relatório.
   *
   *  BUG QUE ISTO CORRIGE: antes a seleção ia crua pro relatório. Marcar linhas
   *  NÃO reprogramadas e clicar em Excel gerava planilha VAZIA sem erro nenhum —
   *  bi.titulos_reprogramados só tem linha pra quem tem override, então os
   *  códigos não casavam com nada e o arquivo saía em branco.
   *
   *  Agora a seleção é INTERSECTADA com os reprogramados. Se a seleção não tem
   *  nenhum, cai na lista filtrada inteira em vez de exportar vazio.
   *
   *  A lista é a filtrada INTEIRA, não o que está desenhado: o teto de 150 é
   *  limite de render, não de conteúdo. */
  const codsRelatorio = useMemo(() => {
    const reprogDaLista = lista.filter((t) => t.tem_override);
    if (selecionados.length) {
      const escolhidos = new Set(selecionados);
      const intersecao = reprogDaLista.filter((t) => escolhidos.has(t.cod_titulo));
      if (intersecao.length) return intersecao.map((t) => t.cod_titulo);
    }
    return reprogDaLista.map((t) => t.cod_titulo);
  }, [selecionados, lista]);

  /** Quantos da seleção já estão fora do fluxo — decide qual botão aparece. */
  const selRenegociando = useMemo(
    () => universo.filter((t) => sel.has(t.cod_titulo) && t.em_renegociacao).length,
    [sel, universo],
  );

  /** Da seleção, quantos já têm reprogramação pendente de envio. É o número que
   *  o botão de enviar deveria ter mostrado desde sempre: sem ele, "Enviar lote
   *  pro Omie" parece o botão que reprograma. */
  const selPendenteOmie = useMemo(() => {
    if (!sel.size) return 0;
    return universo.filter((t) => sel.has(t.cod_titulo) && t.tem_override && !t.sincronizado_omie).length;
  }, [sel, universo]);

  /** Seleção que NÃO entra no relatório, pra avisar em vez de exportar calado. */
  const selecaoForaDoRelatorio = useMemo(() => {
    if (!selecionados.length) return 0;
    const nosCods = new Set(codsRelatorio);
    return selecionados.filter((c) => !nosCods.has(c)).length;
  }, [selecionados, codsRelatorio]);

  const [exportando, setExportando] = useState(false);

  /** Excel: uma aba, uma linha por título, com o antes e o depois. Busca do
   *  servidor em vez de montar do estado da tela — o relatório tem que refletir
   *  o banco, não o que o navegador tem em memória. */
  const baixarExcel = async () => {
    if (!codsRelatorio.length) return;
    setExportando(true);
    try {
      const r = await fetch(`/api/relatorios/reprogramados?cods=${codsRelatorio.join(",")}`,
                            { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? "falha ao gerar Excel"); return; }
      const XLSX = await import("xlsx");
      type L = {
        tipo: string; empresa: string; contraparte: string; categoria: string;
        num_titulo: string; documento: string; vencimento: string | null;
        previsao_original: string | null; previsao_nova: string;
        dias_movidos: number | null; valor: number; dias_atraso: number | null;
        enviado_omie: boolean; reprogramado_em: string | null; observacao: string | null;
      };
      const br = (v: string | null) => {
        if (!v) return "";
        const [a, m, d] = v.slice(0, 10).split("-");
        return `${d}/${m}/${a}`;
      };
      if (!j.linhas?.length) {
        setErr("Nenhum título reprogramado no recorte atual — não há o que exportar.");
        return;
      }
      const rows = (j.linhas as L[]).map((l) => ({
        "Tipo": l.tipo,
        "Empresa": l.empresa,
        "Contraparte": l.contraparte,
        "Categoria": l.categoria,
        "Nº título": l.num_titulo,
        "Documento": l.documento,
        "Vencimento": br(l.vencimento),
        "Previsão original (Omie)": br(l.previsao_original),
        "Nova previsão": br(l.previsao_nova),
        "Dias movidos": l.dias_movidos ?? "",
        "Dias de atraso": l.dias_atraso ?? "",
        "Valor": Number(l.valor) || 0,
        "Enviado ao Omie": l.enviado_omie ? "Sim" : "Não",
        "Reprogramado em": l.reprogramado_em
          ? new Date(l.reprogramado_em).toLocaleString("pt-BR") : "",
        "Observação": l.observacao ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      // Larguras explícitas: sem isso as datas viram ##### e o nome trunca.
      ws["!cols"] = [
        { wch: 9 }, { wch: 8 }, { wch: 34 }, { wch: 28 }, { wch: 11 }, { wch: 14 },
        { wch: 12 }, { wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 13 }, { wch: 14 },
        { wch: 15 }, { wch: 18 }, { wch: 30 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Reprogramados");
      XLSX.writeFile(wb, `titulos-reprogramados-${hojeIso()}.xlsx`);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setExportando(false); }
  };

  const baixarPdf = () => {
    if (!codsRelatorio.length) return;
    // Âncora e não window.open: bloqueador de pop-up mata o open sem avisar, e o
    // usuário fica achando que o botão não funciona.
    const a = document.createElement("a");
    a.href = `/api/relatorios/reprogramados/pdf?cods=${codsRelatorio.join(",")}`;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const totalLista = useMemo(() => {
    const soma = (n: "R" | "P") =>
      lista.filter((t) => t.natureza === n).reduce((a, t) => a + (Number(t.valor) || 0), 0);
    return { receber: soma("R"), pagar: soma("P") };
  }, [lista]);


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
      // Definir data RESOLVE a renegociação: se o título estava fora do fluxo,
      // ele volta. Deixar fora depois de ter data seria esconder movimento que
      // agora é conhecido.
      const voltando = alvos
        .map((a) => a.cod)
        .filter((cod) => universo.some((t) => t.cod_titulo === cod && t.em_renegociacao));
      if (voltando.length) {
        await fetch("/api/renegociacao", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cods: voltando }),
        }).catch(() => { /* a data já gravou; o retorno ao fluxo é o bônus */ });
      }
      {
        const datas = Array.from(new Set(alvos.map((a) => a.dia))).sort();
        setAviso(datas.length === 1
          ? `${alvos.length} título(s) reprogramado(s) para ${diaBr(datas[0])}`
          : `${alvos.length} título(s) rateados em ${datas.length} datas: ${datas.map(diaBr).join(" · ")}`);
      }
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

  /** Tira da curva (ou devolve). Não toca no Omie e não apaga nada — o título
   *  continua na mesa, some do gráfico, e o valor sai declarado na tela. */
  const marcarRenegociacao = async (cods: number[], entrar: boolean, motivo?: string) => {
    if (!cods.length) return;
    setSalvando(true);
    try {
      const r = await fetch("/api/renegociacao", {
        method: entrar ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cods, motivo }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setErr(j.error ?? "falha ao marcar renegociação");
        return;
      }
      setErr(null);
      setAviso(entrar
        ? `${cods.length} título(s) fora do fluxo — a curva não os considera mais. Volte pelo filtro "⚖ Renegociação" quando tiver a data.`
        : `${cods.length} título(s) de volta ao fluxo, na previsão atual.`);
      await load();
    } finally { setSalvando(false); }
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

        {/* "E se eu cobrar o que está vencido?" — soma os atrasados a receber da
            Safe ao saldo de PARTIDA. Entra como saldo inicial e não como entrada
            num dia qualquer: escolher um dia seria fabricar informação que
            ninguém tem, e a curva ganharia um degrau falso. */}
        <label className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[11px] cursor-pointer transition ${
          comAtrasoRecebido
            ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold"
            : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}
          title="Simula receber hoje tudo que está vencido a receber da Safe. Não altera nada — é só a curva.">
          <input type="checkbox" checked={comAtrasoRecebido}
            onChange={(e) => setComAtrasoRecebido(e.target.checked)}
            className="accent-emerald-500" />
          Simular recebimento dos atrasos
          <span className="tabular-nums">
            (+{brl(atrasoTot.receber)})
          </span>
        </label>
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
        <StatTile label={comAtrasoRecebido ? "Saldo de partida + atrasos (simulado)" : "Saldo de partida (Omie)"}
          value={brl(saldo0)}
          hint={data?.saldo_atual
            ? `${data.saldo_atual.origem === "manual" ? "Ajuste manual" : "Extrato Omie.CASH"} de ${
                data.saldo_atual.dt_ref ? diaBr(data.saldo_atual.dt_ref) : "—"}`
            : "Sem extrato"} />
        <StatTile label={`Entradas a vencer · ${jan.label.toLowerCase()}`} value={brl(resumo.entradas)}
          hint={`${titulos.filter((t) => t.natureza === "R").length} títulos · Safe`} />
        {/* O hint declara o que ficou de fora. Sem isso o card diria "R$ X a
            pagar" enquanto existe mais a pagar que a curva não conta. */}
        <StatTile label={`Saídas a vencer · ${jan.label.toLowerCase()}`} value={brl(Math.abs(resumo.saidas))}
          hint={`${titulosNaCurva.filter((t) => t.natureza === "P").length} títulos · Grupo`
            + (foraDoFluxo.pagar ? ` · ⚖ ${brl(foraDoFluxo.pagar)} fora da curva` : "")}
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
          `Barras = movimento do dia · linha = saldo acumulado, partindo de ${brl(saldo0)}`
          + (comAtrasoRecebido
              ? ` — SIMULADO: ${brl(saldoOmie)} do Omie mais ${brl(atrasoTot.receber)} de atrasos a receber da Safe, como se entrassem hoje. `
              : `. `)
          + `Só o que está a vencer; atrasado entra ao ganhar data. `
          + `Previsão em fim de semana é lida no próximo dia útil — o Omie não grava esse ajuste no campo`
          + (empurrao.qtd
              ? `: ${empurrao.qtd} título(s), ${brl(empurrao.valor)}`
              : "")
          + (empurrao.foraQtd
              ? `, dos quais ${empurrao.foraQtd} (${brl(empurrao.foraValor)}) caem depois do fim da janela e saem da curva`
              : "")
          + `. Feriados não entram no ajuste.`
          + (foraDoFluxo.qtd
              ? ` ⚖ ${foraDoFluxo.qtd} título(s) FORA da curva por renegociação`
                + (foraDoFluxo.pagar ? `, ${brl(foraDoFluxo.pagar)} a pagar` : "")
                + (foraDoFluxo.receber ? ` e ${brl(foraDoFluxo.receber)} a receber` : "")
                + ` — a curva está melhor do que a realidade nesse montante.`
              : "")
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
        {/* Duas fileiras: título/resumo em cima, filtros embaixo. Numa linha só,
            os seis grupos espremiam o texto até uma palavra por linha. */}
        <header className="viz-head flex flex-col gap-2.5">
          <div className="min-w-0">
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
              . Marque, escolha a data e veja a linha âmbar no gráfico: é o efeito no caixa.
              "Aplicar data ao lote" grava no painel e move a curva de verdade; enviar pro Omie
              é o passo final e separado.
            </p>
          </div>
          {/* Grupos ROTULADOS. Antes tudo vinha numa fila só e havia dois botões
              "Todos" lado a lado significando coisas diferentes — um de prazo,
              outro de natureza. Com rótulo em cima, cada segmento diz do que
              trata e o nome duplicado deixa de ser ambíguo. */}
          <div className="flex items-end gap-x-4 gap-y-2 flex-wrap">
          <Grupo rot="Prazo">
            {([["atrasados", `Atrasados ${atrasados.length}`],
               ["a_vencer",  `A vencer ${titulos.length}`],
               ["todos",     "Tudo"]] as const).map(([k, l]) => (
              <Chip key={k} on={escopo === k}
                    onClick={() => { setEscopo(k); setSel(new Set()); setAviso(null); ancoraRef.current = null; }}>{l}</Chip>
            ))}
          </Grupo>

          <Grupo rot="Fluxo">
            {([["todos", "Ambos"], ["R", "Entra"], ["P", "Sai"]] as const).map(([k, l]) => (
              <Chip key={k} on={tipo === k} onClick={() => { setTipo(k); ancoraRef.current = null; }}>{l}</Chip>
            ))}
          </Grupo>

          {/* Previsão: atalhos antes do intervalo. "Vence hoje" é a pergunta mais
              frequente da mesa e exigia digitar a mesma data nos dois campos. */}
          <Grupo rot="Previsão">
            <Chip on={prevDe === hojeIso() && prevAte === hojeIso()}
                  onClick={() => {
                    const h = hojeIso();
                    const jaEra = prevDe === h && prevAte === h;
                    setPrevDe(jaEra ? "" : h); setPrevAte(jaEra ? "" : h);
                  }}>Hoje</Chip>
            <Chip on={prevDe === hojeIso() && prevAte === addDias(hojeIso(), 7)}
                  onClick={() => {
                    const h = hojeIso(), f = addDias(h, 7);
                    const jaEra = prevDe === h && prevAte === f;
                    setPrevDe(jaEra ? "" : h); setPrevAte(jaEra ? "" : f);
                  }}>7 dias</Chip>
            <Chip on={soReprog} onClick={() => setSoReprog((v) => !v)}
                  titulo="Só títulos cuja previsão eu alterei no painel">
              ↻ {qtdReprog}
            </Chip>
            {/* O caminho de volta. Aqui se retoma o que ficou pendente de data. */}
            <Chip on={soReneg} onClick={() => setSoReneg((v) => !v)}
                  titulo="Só os que estão fora da curva, esperando repactuação ou cancelamento">
              ⚖ {qtdReneg}
            </Chip>
          </Grupo>

          {/* Quando reprogramei. Grupo próprio e não junto de "Previsão": são
              duas datas diferentes do mesmo título e misturá-las num intervalo
              só produziria filtro que ninguém consegue explicar. */}
          <Grupo rot="Reprog. em">
            <Chip on={reprogDe === hojeIso() && reprogAte === hojeIso()}
                  titulo="O que eu reprogramei hoje"
                  onClick={() => {
                    const h = hojeIso();
                    const jaEra = reprogDe === h && reprogAte === h;
                    setReprogDe(jaEra ? "" : h); setReprogAte(jaEra ? "" : h);
                  }}>Hoje</Chip>
            <Chip on={reprogDe === addDias(hojeIso(), -7) && reprogAte === hojeIso()}
                  titulo="Reprogramados nos últimos 7 dias"
                  onClick={() => {
                    const h = hojeIso(), d = addDias(h, -7);
                    const jaEra = reprogDe === d && reprogAte === h;
                    setReprogDe(jaEra ? "" : d); setReprogAte(jaEra ? "" : h);
                  }}>7 dias</Chip>
            <input type="date" value={reprogDe} onChange={(e) => setReprogDe(e.target.value)}
              title="Reprogramado a partir de"
              className="text-[11px] bg-ww-bg border border-ww-border rounded px-1 py-0.5 text-ww-text" />
            <input type="date" value={reprogAte} onChange={(e) => setReprogAte(e.target.value)}
              title="Reprogramado até"
              className="text-[11px] bg-ww-bg border border-ww-border rounded px-1 py-0.5 text-ww-text" />
            {(reprogDe || reprogAte) && (
              <button type="button" onClick={() => { setReprogDe(""); setReprogAte(""); }}
                className="text-[10.5px] text-ww-accent hover:underline">limpar</button>
            )}
          </Grupo>

          <Grupo rot="Recorte">
            <CategoriaFiltro opcoes={catsOpcoes} selected={catsSel}
              onToggle={(v) => setCatsSel((prev) => {
                const n = new Set(prev);
                if (n.has(v)) n.delete(v); else n.add(v);
                return n;
              })}
              onClear={() => setCatsSel(new Set())} />
          <div className="flex items-center gap-1 text-[10.5px] text-ww-textMuted">
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
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…"
            className="w-[140px] text-[11px] bg-ww-bg border border-ww-border rounded px-2 py-1 text-ww-text placeholder:text-ww-textFaint" />
          </Grupo>

          {/* Relatório dos reprogramados. Cobre a seleção, se houver; senão todos
              os reprogramados do filtro atual — inclusive os que o teto de linhas
              não desenha, porque teto é limite de render, não de conteúdo. */}
          <Grupo rot="Report">
            <button type="button" onClick={baixarPdf} disabled={!codsRelatorio.length}
              title={codsRelatorio.length
                ? `PDF de ${codsRelatorio.length} título(s) reprogramado(s)`
                  + (selecaoForaDoRelatorio
                      ? ` · ${selecaoForaDoRelatorio} da seleção ficam de fora: não foram reprogramados`
                      : "")
                : "Nenhum título reprogramado no filtro atual"}
              className="px-2 py-0.5 text-[11px] rounded border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40">
              📄 PDF
            </button>
            <button type="button" onClick={baixarExcel} disabled={!codsRelatorio.length || exportando}
              title={codsRelatorio.length
                ? `Excel de ${codsRelatorio.length} título(s) reprogramado(s)`
                  + (selecaoForaDoRelatorio
                      ? ` · ${selecaoForaDoRelatorio} da seleção ficam de fora: não foram reprogramados`
                      : "")
                : "Nenhum título reprogramado no filtro atual"}
              className="px-2 py-0.5 text-[11px] rounded border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40">
              {exportando ? "Gerando…" : "📊 Excel"}
            </button>
          </Grupo>
          </div>
        </header>

        {/* Barra de lote — só aparece com seleção, pra não ocupar espaço à toa. */}
        {podeEditar && selecionados.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-2 p-2 rounded-lg bg-ww-accentSoft border border-ww-accent/40">
            <span className="text-[11px] font-semibold text-ww-accent whitespace-nowrap">
              {selecionados.length} selecionado(s)
            </span>
            {/* O quanto da seleção, por lado. Dois números e não um: somar entrada
                com saída esconderia justamente o que importa na hora de mover. */}
            {totalSelecao && (
              <span className="text-[11px] tabular-nums whitespace-nowrap">
                {totalSelecao.receber > 0 && (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    +{brl(totalSelecao.receber)}
                  </span>
                )}
                {totalSelecao.receber > 0 && totalSelecao.pagar > 0 && (
                  <span className="text-ww-textFaint"> · </span>
                )}
                {totalSelecao.pagar > 0 && (
                  <span className="text-rose-600 dark:text-rose-400">
                    −{brl(totalSelecao.pagar)}
                  </span>
                )}
              </span>
            )}
            <input type="date" value={dataLote} min={hojeIso()}
              onChange={(e) => setDataLote(e.target.value)}
              className="text-[11px] bg-ww-bg border border-ww-border rounded px-1.5 py-0.5 text-ww-text" />
            {/* Atalhos: reagendar quase sempre é "joga pra semana que vem" ou
                "joga pro mês que vem". Digitar a data pra isso é atrito puro. */}
            {([["hoje", 0], ["+7d", 7], ["+15d", 15], ["+30d", 30]] as const).map(([l, n]) => (
              <button key={l} type="button" onClick={() => setDataLote(addDias(hojeIso(), n))}
                className="px-1.5 py-0.5 text-[10.5px] rounded border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition">
                {l}
              </button>
            ))}
            <span className="h-5 w-px bg-ww-border" />
            <button type="button" onClick={() => setRateioOn((v) => !v)}
              title="Divide a seleção em até 3 datas, por proporção de valor"
              className={`px-2 py-0.5 text-[11px] rounded border transition ${
                rateioOn ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                         : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
              ⑃ Ratear em datas
            </button>
            {/* O efeito no caixa ANTES de gravar. "Simular no Omie" só testa se a
                API aceitaria; isto responde se vale a pena. */}
            {impactoPrevia && (
              <span className={`text-[11px] tabular-nums px-2 py-0.5 rounded border ${
                impactoPrevia.delta > 0
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : impactoPrevia.delta < 0
                    ? "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                    : "border-ww-border text-ww-textMuted"}`}
                title="Menor saldo da janela, hoje e com o lote aplicado. A linha âmbar no gráfico mostra a curva simulada.">
                pior dia: {brl(impactoPrevia.antes)} → <strong>{brl(impactoPrevia.depois)}</strong>
                {impactoPrevia.delta !== 0 && (
                  <> ({impactoPrevia.delta > 0 ? "+" : ""}{brl(impactoPrevia.delta)})</>
                )}
              </span>
            )}
            {/* Grava pelo mapa `destinos`, que é o MESMO que alimenta a prévia da
                curva — com rateio ou sem. Se fossem dois caminhos, a linha âmbar
                mostraria uma coisa e o gravado seria outra. */}
            <button type="button" disabled={destinos.size === 0 || salvando}
              title={rateioOn
                ? (destinos.size ? `Grava ${destinos.size} título(s) nas datas do rateio`
                                 : "Preencha ao menos uma data no rateio")
                : dataLote && !dataUtil(dataLote) ? "Informe uma data a partir de hoje"
                : foraDaJanela(dataLote) ? "Grava, mas cai depois do fim da janela — não aparece na curva"
                : undefined}
              onClick={() => gravar(Array.from(destinos, ([cod, dia]) => ({ cod, dia })))}
              className="px-3 py-1 text-[11.5px] rounded-md border-2 border-ww-accent bg-ww-accent text-white hover:brightness-110 transition font-bold disabled:opacity-30 disabled:bg-transparent disabled:text-ww-textFaint disabled:border-ww-border">
              {salvando ? "Gravando…"
                : destinos.size === 0
                  ? (rateioOn ? "1 · Preencha o rateio ↓" : "1 · Escolha a data ↑")
                  : `1 · Reprogramar ${destinos.size}`}
            </button>
            {/* Chamava-se "Simular no Omie" e induzia ao erro: não chama o Omie
                nem simula caixa. Percorre a lista e devolve o que SERIA enviado —
                é conferência do pacote. Quem simula o caixa é a linha âmbar do
                gráfico; quem envia é o botão ao lado. */}
            <button type="button" disabled={syncing}
              onClick={() => enviarOmie(true, selecionados)}
              title="Lista o que seria enviado, sem chamar o Omie e sem alterar nada"
              className="px-2 py-0.5 text-[11px] rounded border border-ww-border text-ww-textMuted hover:text-ww-text transition disabled:opacity-40">
              Conferir envio
            </button>
            {/* Segundo passo, e SECUNDÁRIO no visual. Antes era o botão mais
                chamativo da barra enquanto "Aplicar data" ficava apagado — o olho
                ia no lugar errado e dava pra achar que enviar era reprogramar.
                O contador diz quantos da seleção realmente têm o que enviar. */}
            <button type="button" disabled={syncing || selPendenteOmie === 0}
              onClick={() => enviarOmie(false, selecionados)}
              title={selPendenteOmie === 0
                ? "Nenhum da seleção tem reprogramação pendente. Reprograme primeiro (passo 1)."
                : `Envia ao Omie ${selPendenteOmie} reprogramação(ões) ainda não sincronizada(s)`}
              className="px-2 py-0.5 text-[11px] rounded border border-amber-500/70 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition disabled:opacity-30 disabled:border-ww-border disabled:text-ww-textFaint">
              {syncing ? "Enviando…" : `2 · Enviar pro Omie (${selPendenteOmie})`}
            </button>
            {/* Fora do fluxo. Separado dos passos 1 e 2 por uma barra: é outra
                natureza de ação — não reagenda nem envia, tira da conta. */}
            <span className="h-5 w-px bg-ww-border" />
            {selRenegociando < selecionados.length && (
              <button type="button" disabled={salvando}
                onClick={() => {
                  const motivo = window.prompt(
                    `Tirar ${selecionados.length - selRenegociando} título(s) da curva.\n\n`
                    + "Motivo (opcional) — ex.: 'repactuar com fornecedor', 'a cancelar':", "");
                  if (motivo === null) return;   // cancelou o prompt
                  void marcarRenegociacao(
                    selecionados.filter((cod) =>
                      !universo.some((t) => t.cod_titulo === cod && t.em_renegociacao)),
                    true, motivo || undefined);
                }}
                title="Tira da projeção de caixa. Não altera o Omie — o título continua aqui e volta quando tiver data."
                className="px-2 py-0.5 text-[11px] rounded border border-violet-500/70 text-violet-700 dark:text-violet-300 hover:bg-violet-500/20 transition disabled:opacity-30">
                ⚖ Renegociar ({selecionados.length - selRenegociando})
              </button>
            )}
            {selRenegociando > 0 && (
              <button type="button" disabled={salvando}
                onClick={() => void marcarRenegociacao(
                  selecionados.filter((cod) =>
                    universo.some((t) => t.cod_titulo === cod && t.em_renegociacao)),
                  false)}
                title="Devolve à curva, na previsão atual do título"
                className="px-2 py-0.5 text-[11px] rounded border border-emerald-500/70 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 transition disabled:opacity-30">
                ↩ Voltar ao fluxo ({selRenegociando})
              </button>
            )}
            <button type="button" onClick={() => { setSel(new Set()); setRateioOn(false); }}
              className="text-[10.5px] text-ww-textFaint hover:text-ww-text underline ml-auto">
              limpar seleção
            </button>
          </div>
        )}

        {/* Painel do rateio. Só aparece ligado, e mostra o PEDIDO ao lado do
            OBTIDO: título é indivisível, então a proporção real quase nunca bate
            exatamente com a pedida. Esconder essa diferença seria mentir sobre
            quanto vai sair em cada data. */}
        {podeEditar && selecionados.length > 0 && rateioOn && (
          <div className="mb-2 p-2.5 rounded-lg bg-ww-panel border border-ww-accent/30">
            <p className="text-[10.5px] text-ww-textMuted mb-2">
              Divide os {selecionados.length} títulos em até 3 datas, aproximando a proporção.
              Título não se parte: cada um vai inteiro pra uma data, e o valor obtido pode
              diferir do pedido.
            </p>
            <div className="flex items-start gap-3 flex-wrap">
              {fatias.map((f, i) => {
                const b = distribuicaoRateio?.baldes.find((x) => x.data === f.data && f.data);
                const pedido = distribuicaoRateio
                  ? distribuicaoRateio.total * (f.pct / (fatias.filter((y) => y.data && y.pct > 0)
                      .reduce((a, y) => a + y.pct, 0) || 1))
                  : 0;
                return (
                  <div key={i} className="flex flex-col gap-1 p-2 rounded-md border border-ww-border min-w-[190px]">
                    <span className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
                      Parte {i + 1}
                    </span>
                    <div className="flex items-center gap-1">
                      <input type="date" value={f.data} min={hojeIso()}
                        onChange={(e) => setFatias((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, data: e.target.value } : x)))}
                        className="text-[11px] bg-ww-bg border border-ww-border rounded px-1.5 py-0.5 text-ww-text" />
                      <input type="number" min={0} max={100} value={f.pct}
                        onChange={(e) => setFatias((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) || 0 } : x)))}
                        className="w-[52px] text-[11px] bg-ww-bg border border-ww-border rounded px-1.5 py-0.5 text-ww-text tabular-nums" />
                      <span className="text-[10.5px] text-ww-textFaint">%</span>
                    </div>
                    {b ? (
                      <span className="text-[10.5px] tabular-nums text-ww-text">
                        {b.itens.length} título(s) · <strong>{brl(b.valor)}</strong>
                        <span className="text-ww-textFaint"> (pedido {brl(pedido)})</span>
                      </span>
                    ) : (
                      <span className="text-[10.5px] text-ww-textFaint">
                        {f.data ? "sem título nesta parte" : "escolha a data"}
                      </span>
                    )}
                  </div>
                );
              })}
              {distribuicaoRateio && (
                <div className="flex flex-col gap-1 p-2 rounded-md border border-ww-border bg-ww-rowHover">
                  <span className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
                    Total distribuído
                  </span>
                  <span className="text-[13px] font-bold tabular-nums text-ww-text">
                    {brl(distribuicaoRateio.baldes.reduce((a, b) => a + b.valor, 0))}
                  </span>
                  <span className="text-[10px] text-ww-textFaint">
                    de {brl(distribuicaoRateio.total)} selecionados
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {aviso && (
          <div className="mb-2 px-3 py-2 rounded-lg text-[11.5px] border bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
            <span>✓ {aviso}</span>
            <span className="text-ww-textFaint">
              — já está na curva. Para o Omie receber, use o passo 2.
            </span>
            <button type="button" onClick={() => setAviso(null)}
              className="ml-auto text-ww-textFaint hover:text-ww-text">✕</button>
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
                <Th col="contraparte" w={196} ordem={ordem} setOrdem={setOrdem} onReordenar={() => { ancoraRef.current = null; }}>Contraparte</Th>
                <Th col="categoria"   w={130} ordem={ordem} setOrdem={setOrdem} onReordenar={() => { ancoraRef.current = null; }}>Categoria</Th>
                <Th col="vencimento"  w={74}  ordem={ordem} setOrdem={setOrdem} onReordenar={() => { ancoraRef.current = null; }}>Vencto</Th>
                {/* Previsão vigente: é a data que a curva usa hoje, e o ponto de
                    partida de qualquer reagendamento. Faltava na tela. */}
                <Th col="previsao"    w={78}  ordem={ordem} setOrdem={setOrdem} onReordenar={() => { ancoraRef.current = null; }}>Previsão</Th>
                <th style={{ width: 78 }} className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Situação</th>
                <Th col="valor" w={104} alinhaDireita ordem={ordem} setOrdem={setOrdem} onReordenar={() => { ancoraRef.current = null; }}>Valor</Th>
                {/* Quando eu mexi. Só faz sentido pra reprogramado, mas a coluna
                    fica sempre — some e volta conforme o filtro seria pior. */}
                <Th col="reprogramado_em" w={86} ordem={ordem} setOrdem={setOrdem} onReordenar={() => { ancoraRef.current = null; }}>Reprog.</Th>
                <th style={{ width: 128 }} className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Nova previsão</th>
                <th style={{ width: 96 }} className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Omie</th>
              </tr>
            </thead>
            <tbody className={loading ? "opacity-40" : ""}>
              {linhasNaMesa.length === 0 && (
                <tr><td colSpan={podeEditar ? 13 : 12} className="p-6 text-center text-ww-textFaint">
                  {loading ? "Carregando…" : "Nenhum título com os filtros atuais."}
                </td></tr>
              )}
              {linhasNaMesa.map((t, idx) => {
                const dia = agenda.get(t.cod_titulo) ?? (t.tem_override ? t.previsao : "");
                const pendente = t.tem_override && !t.sincronizado_omie;
                return (
                  <tr key={t.cod_titulo}
                      className={`viz-row ${
                        t.em_renegociacao ? "bg-violet-500/10 opacity-75"
                        : dia ? "bg-ww-accentSoft/40" : ""}`}>
                    {podeEditar && (
                      <td className="p-1.5 border-b border-ww-border/50">
                        {/* Shift marca o intervalo desde a última linha clicada,
                            como em planilha. Sem isso, escolher 30 títulos
                            seguidos são 30 cliques.
                            Vai no onClick e não no onChange: só o evento de mouse
                            carrega shiftKey. */}
                        <input type="checkbox" checked={sel.has(t.cod_titulo)}
                          onClick={(e) => {
                            const marcar = e.currentTarget.checked;
                            const anterior = ancoraRef.current;
                            ancoraRef.current = idx;
                            setSel((prev) => {
                              const n = new Set(prev);
                              // Intervalo inteiro assume o estado do clique — é o
                              // que o usuário acabou de pedir explicitamente.
                              const de = e.shiftKey && anterior != null ? Math.min(anterior, idx) : idx;
                              const ate = e.shiftKey && anterior != null ? Math.max(anterior, idx) : idx;
                              for (let i = de; i <= ate; i++) {
                                const cod = linhasNaMesa[i]?.cod_titulo;
                                if (cod == null) continue;
                                if (marcar) n.add(cod); else n.delete(cod);
                              }
                              return n;
                            });
                          }}
                          onChange={() => { /* estado vem do onClick */ }}
                          className="accent-ww-accent cursor-pointer" />
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
                      {t.em_renegociacao ? (
                        <span title={t.motivo_renegociacao
                          ? `Fora da curva — ${t.motivo_renegociacao}`
                          : "Fora da curva por renegociação"}
                          className="inline-flex px-1.5 py-0.5 rounded text-[10px] border bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30">
                          ⚖ fora
                        </span>
                      ) : t.faixa_atraso ? (
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
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted tabular-nums text-[10.5px]">
                      {t.reprogramado_em ? (
                        <span title={`Reprogramado em ${new Date(t.reprogramado_em).toLocaleString("pt-BR")}`}>
                          {diaBr(diaLocalDe(t.reprogramado_em))}
                        </span>
                      ) : "—"}
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
  col, w, children, ordem, setOrdem, alinhaDireita = false, onReordenar,
}: {
  col: OrdemCol; w: number; children: React.ReactNode;
  ordem: { col: OrdemCol; desc: boolean };
  setOrdem: (o: { col: OrdemCol; desc: boolean }) => void;
  alinhaDireita?: boolean;
  /** Reordenar troca os índices das linhas, então a âncora do shift precisa
   *  cair — senão o intervalo seguinte marcaria linhas que o usuário não viu. */
  onReordenar?: () => void;
}) {
  const ativa = ordem.col === col;
  return (
    <th style={{ width: w }}
        className={`p-1.5 shadow-[0_1px_0_0_rgb(var(--color-ww-border))] ${
          alinhaDireita ? "text-right" : "text-left"}`}>
      <button type="button"
        onClick={() => { setOrdem(ativa ? { col, desc: !ordem.desc } : { col, desc: true }); onReordenar?.(); }}
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

/** Grupo rotulado de filtros. O rótulo em cima é o que resolve a ambiguidade:
 *  "Tudo" em Prazo e "Ambos" em Fluxo deixam de competir pela mesma leitura
 *  quando cada um está debaixo do seu próprio título. */
function Grupo({ rot, children }: { rot: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint px-0.5">
        {rot}
      </span>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

/** Chip de filtro. Um só componente pra todos os segmentos — antes cada grupo
 *  repetia a mesma string de classes, e divergir era questão de tempo. */
function Chip({
  on, onClick, children, titulo,
}: { on: boolean; onClick: () => void; children: React.ReactNode; titulo?: string }) {
  return (
    <button type="button" onClick={onClick} title={titulo}
      className={`px-2 py-0.5 text-[11px] rounded border transition whitespace-nowrap ${
        on ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
           : "border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover"}`}>
      {children}
    </button>
  );
}
