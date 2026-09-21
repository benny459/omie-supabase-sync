"use client";

// Fluxo de caixa previsto do projeto — lançar, aprovar, e comparar com o real.
//
// ── O que existia ────────────────────────────────────────────────────────────
// "Fluxo Financeiro" era só um botão de upload. Sem planilha não havia caminho,
// e o que ele gravava eram três totais agregados — que não desenham curva
// nenhuma: total sem data não tem eixo x, e sem separar entrada de saída não há
// fluxo, há orçamento.
//
// ── Duas grades, não uma com seletor ─────────────────────────────────────────
// Entradas e saídas em tabelas separadas. Uma grade só exigiria uma coluna
// "tipo" com combo em cada linha — e colar 30 linhas do Excel teria que trazer
// a palavra "entrada" repetida 30 vezes. Separado, o que se cola é só
// descrição, data e valor, que é o que a planilha de quem planeja tem.
//
// ── A aprovação é do PLANO INTEIRO ───────────────────────────────────────────
// O Marcelo desenha, o Benny aprova, e é essa aprovação que libera o Marcelo a
// aprovar os PCs do projeto. Por isso o estado vive no projeto e não na linha:
// não existe "metade do plano aprovada". Mexeu numa linha depois de aprovado, a
// aprovação cai (trigger no banco) — senão daria pra aprovar compra contra um
// plano que já não é o que foi lido.

import { useCallback, useEffect, useMemo, useState } from "react";
import GradeEditavel, {
  brl, linhaVazia, num, type ColunaGrade, type LinhaGrade,
} from "./GradeEditavel";
import TabelaPrevisto, { type LinhaPrevisto } from "./TabelaPrevisto";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import VizCombo from "@/components/viz/VizCombo";
import PlanoFechamento, { type PlanoCompleto } from "@/components/projeto/PlanoFechamento";
import { ReguaExecucao, Faturamento, Recebimento, CondicoesComerciais,
         type Execucao, type Venda } from "@/components/projeto/ResumoProjeto";

type LinhaApi = {
  id: number; tipo: "entrada" | "saida"; descricao: string; categoria: string | null;
  data_prevista: string; valor: number; observacao: string | null; origem: string; ordem: number;
};
type Cabecalho = {
  status: "rascunho" | "pendente" | "aprovado" | "rejeitado";
  versao: number;
  enviado_por?: string | null; enviado_em?: string | null;
  decidido_por?: string | null; decidido_em?: string | null; motivo?: string | null;
  total_entradas_aprovado?: number | null; total_saidas_aprovado?: number | null;
  linhas_aprovadas?: number | null;
};
type RealizadoRow = {
  mes: string; entrada_realizada: number; saida_realizada: number;
  qtd_entradas: number; qtd_saidas: number;
};
type Cobertura = {
  titulos_receber: number; valor_receber: number;
  titulos_pagar: number; valor_pagar: number; compras_no_projeto: number;
};
type Evento = {
  versao: number; acao: string; por: string | null; em: string;
  motivo: string | null; total_entradas: number | null; total_saidas: number | null; linhas: number | null;
};
type RealDia = { dia: string; entrada: number; saida: number };
type Orcamento = {
  valor_budget: number | null; valor_total_projeto: number | null;
  resultado_bruto_esperado_pct: number | null;
} | null;
type Payload = {
  linhas: LinhaApi[]; previsto: LinhaPrevisto[]; realizado_diario: RealDia[]; orcamento: Orcamento;
  cabecalho: Cabecalho; realizado: RealizadoRow[];
  cobertura: Cobertura | null; eventos: Evento[];
  execucao: Execucao | null; vendas: Venda[];
  pode_editar: boolean; pode_aprovar: boolean; eu: string;
  error?: string;
};

const COLS: ColunaGrade[] = [
  { key: "descricao", label: "Descrição",  w: 300 },
  { key: "categoria", label: "Categoria",  w: 150 },
  { key: "data",      label: "Data",       w: 140, tipo: "data" },
  { key: "valor",     label: "Valor",      w: 130, tipo: "moeda", alinhaDireita: true },
];

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const diaBr = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};
const mesBr = (iso: string) => {
  const [a, m] = iso.slice(0, 7).split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
};

/** Linhas da API → linhas da grade. A grade guarda tudo como string porque é o
 *  que um input devolve; a conversão acontece na borda, dos dois lados. */
const paraGrade = (ls: LinhaApi[]): LinhaGrade[] => {
  const g = ls.map((l) => ({
    _id: `db${l.id}`,
    descricao: l.descricao,
    categoria: l.categoria ?? "",
    data: l.data_prevista,
    valor: String(l.valor).replace(".", ","),
  })) as LinhaGrade[];
  return g.length ? [...g, linhaVazia(COLS)] : [linhaVazia(COLS)];
};

/** Estado do fluxo. `ponto` em vez de `classe`: o status virou uma linha com
 *  um ponto de cor, não um card com fundo próprio. */
const TOM: Record<Cabecalho["status"], { rot: string; ponto: string; dica: string }> = {
  rascunho:  { rot: "Rascunho", ponto: "bg-ww-textFaint",
               dica: "ainda não foi enviado para aprovação." },
  pendente:  { rot: "Aguardando aprovação", ponto: "bg-amber-500",
               dica: "as compras do projeto continuam travadas até a decisão." },
  aprovado:  { rot: "Aprovado", ponto: "bg-emerald-500",
               dica: "as compras deste projeto já podem ser aprovadas." },
  rejeitado: { rot: "Rejeitado", ponto: "bg-rose-500",
               dica: "ajuste o plano e envie de novo." },
};

/** As abas do projeto. Cada assunto na sua — antes era tudo numa rolagem só,
 *  com treze números antes da primeira tabela. */
export type AbaProjeto = "resumo" | "condicoes" | "faturamento" | "fluxo" | "omie";

export default function FluxoProjetoView({
  empresa, codigoProjeto, nomeProjeto, abas = ["resumo"],
}: {
  empresa: string; codigoProjeto: number; nomeProjeto?: string;
  abas?: AbaProjeto[];
}) {
  /* Uma aba da tela pode conter vários assuntos: `ver` decide o que
     desenhar sem duplicar o componente (e o fetch) por assunto. */
  const ver = (k: AbaProjeto) => abas.includes(k);
  const [data, setData] = useState<Payload | null>(null);
  const [entradas, setEntradas] = useState<LinhaGrade[]>([linhaVazia(COLS)]);
  const [saidas, setSaidas] = useState<LinhaGrade[]>([linhaVazia(COLS)]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** Marca que a grade foi tocada. Sem isso não dá pra distinguir "nada mudou"
   *  de "mudou e voltou ao mesmo" — e o botão de salvar mentiria nos dois. */
  const [sujo, setSujo] = useState(false);
  /** O plano de fechamento, se houver. Carregado em paralelo com o fluxo —
   *  é outra fonte, com outro tempo de resposta, e travar uma na outra só
   *  atrasaria a tela. */
  const [plano, setPlano] = useState<PlanoCompleto | null>(null);
  /** Qual cenário o gráfico mostra. "todos" é o padrão porque a pergunta que
   *  traz alguém aqui é comparativa: o que combinei, o que está previsto e o
   *  que de fato aconteceu. Ver um sozinho não responde nada. */
  const [cenario, setCenario] = useState<"todos" | "plano" | "previsto" | "realizado">("todos");
  const [editandoTeto, setEditandoTeto] = useState(false);

  const carregarPlano = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/rc-projetos/plano?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}`,
        { cache: "no-store" });
      if (!r.ok) return;
      setPlano((await r.json()) as PlanoCompleto);
    } catch { /* plano ausente não impede o resto da tela */ }
  }, [empresa, codigoProjeto]);

  useEffect(() => { void carregarPlano(); }, [carregarPlano]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch(
        `/api/rc-projetos/fluxo?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}`,
        { cache: "no-store" });
      const j = (await r.json()) as Payload;
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setErro(null);
      setData(j);
      setEntradas(paraGrade(j.linhas.filter((l) => l.tipo === "entrada")));
      setSaidas(paraGrade(j.linhas.filter((l) => l.tipo === "saida")));
      setSujo(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setCarregando(false); }
  }, [empresa, codigoProjeto]);

  useEffect(() => { void carregar(); }, [carregar]);

  const preenchidas = (ls: LinhaGrade[]) =>
    ls.filter((l) => l.descricao?.trim() || l.valor?.trim());

  // O previsto do projeto é a soma de DUAS origens: o que o Omie já sabe
  // (PV a faturar, títulos, pedidos de compra) e o que foi acrescentado à mão.
  // Mostrar só o manual faria o plano parecer vazio num projeto que já tem
  // R$ 36 mil de compra lançada.
  const previsto = useMemo(() => data?.previsto ?? [], [data]);
  const somaPrev = (lado: "entrada" | "saida") =>
    previsto.filter((l) => l.lado === lado).reduce((a, l) => a + Number(l.valor || 0), 0);

  const manEnt = preenchidas(entradas).reduce((a, l) => a + num(l.valor), 0);
  const manSai = preenchidas(saidas).reduce((a, l) => a + num(l.valor), 0);
  const omiEnt = somaPrev("entrada");
  const omiSai = somaPrev("saida");
  const totEnt = manEnt + omiEnt;
  const totSai = manSai + omiSai;
  const margem = totEnt > 0 ? ((totEnt - totSai) / totEnt) * 100 : null;

  /** O que já se moveu de verdade, e o que falta.
   *
   *  "Recebido" num pedido de compra diz que o material chegou, não que o
   *  dinheiro saiu — por isso o pago vem do título, não do PC. É a diferença
   *  entre ter a mercadoria e ter pagado por ela. */
  const liq = useMemo(() => {
    const pago = previsto.filter((l) => l.lado === "saida")
                         .reduce((a, l) => a + Number(l.liquidado || 0), 0);
    const recebido = previsto.filter((l) => l.lado === "entrada")
                             .reduce((a, l) => a + Number(l.liquidado || 0), 0);
    return {
      pago, recebido,
      faltaPagar:   Math.max(0, omiSai + manSai - pago),
      faltaReceber: Math.max(0, omiEnt + manEnt - recebido),
      caixa: recebido - pago,
    };
  }, [previsto, omiSai, manSai, omiEnt, manEnt]);

  /** Quanto escorregou desde a aprovação. Só existe com plano aprovado —
   *  sem foto congelada não há contra o que medir. */
  const desvio = useMemo(() => {
    const com = previsto.filter((l) => l.desvio_dias != null && l.desvio_dias !== 0);
    if (!com.length) return null;
    const pior = com.reduce((m, l) => ((l.desvio_dias ?? 0) > (m.desvio_dias ?? 0) ? l : m));
    return { linhas: com.length, pior: pior.desvio_dias ?? 0,
             valor: com.filter((l) => (l.desvio_dias ?? 0) > 0)
                       .reduce((a, l) => a + Number(l.valor || 0), 0) };
  }, [previsto]);

  const salvar = useCallback(async () => {
    setSalvando(true); setErro(null); setAviso(null);
    const monta = (ls: LinhaGrade[], tipo: "entrada" | "saida") =>
      preenchidas(ls).map((l) => ({
        tipo, descricao: l.descricao ?? "", categoria: l.categoria || null,
        data_prevista: l.data ?? "", valor: num(l.valor), origem: "manual" as const,
      }));
    try {
      const r = await fetch("/api/rc-projetos/fluxo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa, codigo_projeto: codigoProjeto,
          linhas: [...monta(entradas, "entrada"), ...monta(saidas, "saida")],
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setAviso(`${j.linhas} linha(s) gravada(s).`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  }, [empresa, codigoProjeto, entradas, saidas, carregar]);

  const decidir = useCallback(async (acao: string, motivo?: string) => {
    setSalvando(true); setErro(null); setAviso(null);
    try {
      const r = await fetch("/api/rc-projetos/fluxo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, acao, motivo }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setAviso(
        acao === "enviar"  ? "Enviado para aprovação."
      : acao === "aprovar" ? "Fluxo aprovado — as compras deste projeto já podem ser aprovadas."
      : acao === "rejeitar" ? "Fluxo rejeitado."
      : "Fluxo reaberto para edição.");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  }, [empresa, codigoProjeto, carregar]);

  /** Previsto e realizado no MESMO eixo de meses. Os dois lados podem ter meses
   *  que o outro não tem — sem unir as chaves, um mês só realizado sumiria. */
  /** A curva DIÁRIA, montada aqui a partir do previsto e do realizado.
   *
   *  Mensal escondia o que importa: numa barra de agosto não dá pra ver que a
   *  saída veio antes da entrada — e é isso que define se o projeto está sendo
   *  financiado pela empresa.
   *
   *  Montada na tela, e não no banco, porque uma função que juntasse os dois
   *  teria que recalcular o previsto inteiro a cada leitura — e o previsto é a
   *  parte cara (a view de projetos não empurra o filtro e custa segundos). */
  const grafico = useMemo(() => {
    const porDia = new Map<string, {
      ep: number; sp: number; er: number; sr: number; e0: number; s0: number;
    }>();
    const cel = (d: string) => {
      const c = porDia.get(d) ?? { ep: 0, sp: 0, er: 0, sr: 0, e0: 0, s0: 0 };
      porDia.set(d, c); return c;
    };

    // ── O PLANO (cenário inicial) ──────────────────────────────────────────
    // Lançado pela data do FECHAMENTO, não pela ajustada: este cenário é a
    // foto do que foi combinado. Usar a data ajustada aqui faria a curva do
    // plano se mexer junto com o cronograma e o desvio desapareceria — que é
    // o defeito clássico de baseline que acompanha a realidade.
    for (const p of (plano?.parcelas ?? [])) {
      if (!p.dt_plano) continue;
      cel(p.dt_plano).e0 += Number(p.valor) || 0;
    }
    for (const x of (plano?.saidas ?? [])) {
      if (!x.no_fluxo || !x.dt_prevista) continue;
      cel(x.dt_prevista).s0 += Number(x.valor) || 0;
    }

    for (const l of previsto) {
      if (!l.data_efetiva) continue;
      const c = cel(l.data_efetiva.slice(0, 10));
      if (l.lado === "entrada") c.ep += Number(l.valor) || 0;
      else                      c.sp += Number(l.valor) || 0;
    }
    // As entradas lançadas à mão continuam entrando na curva.
    for (const l of preenchidas(entradas)) {
      if (!l.data) continue;
      cel(l.data).ep += num(l.valor);
    }
    // ── O plano no PREVISTO, só o que o Omie não tem como saber ────────────
    // Mão de obra e despesa de viagem nunca viram pedido de compra: se não
    // entrarem por aqui, o previsto fica menor que a realidade e a margem
    // aparece melhor do que é. Compras NÃO entram — elas viram pedido no
    // Omie e contariam duas vezes.
    //
    // As parcelas do plano entram pela data AJUSTADA (o cronograma real) e só
    // enquanto não viraram título: com num_titulo preenchido, o Omie já conta.
    for (const x of (plano?.saidas ?? [])) {
      if (!x.no_fluxo || x.origem !== "sem_pc" || !x.dt_prevista) continue;
      cel(x.dt_prevista).sp += Number(x.valor) || 0;
    }
    if (!omiEnt) {
      // Só quando o Omie não conhece entrada nenhuma. Havendo PV ou título, é
      // ele que manda — a parcela do plano viraria uma segunda previsão do
      // mesmo dinheiro.
      for (const p of (plano?.parcelas ?? [])) {
        if (p.num_titulo) continue;
        const d = p.dt_ajustada ?? p.dt_plano;
        if (d) cel(d).ep += Number(p.valor) || 0;
      }
    }
    for (const r of (data?.realizado_diario ?? [])) {
      const c = cel(r.dia.slice(0, 10));
      c.er += Number(r.entrada) || 0;
      c.sr += Number(r.saida) || 0;
    }
    if (!porDia.size) return [];

    // Série contínua de dias: sem ela a linha ligaria pontos distantes como se
    // o intervalo não existisse.
    const chaves = Array.from(porDia.keys()).sort();
    const ini = new Date(`${chaves[0]}T12:00:00`);
    const fim = new Date(`${chaves[chaves.length - 1]}T12:00:00`);
    const hoje = new Date(); hoje.setHours(12, 0, 0, 0);

    const linhas: Array<Record<string, unknown>> = [];
    let accP = 0, accR = 0, acc0 = 0;
    const temPlano = !!(plano?.parcelas.length || plano?.saidas.length);

    for (const d = new Date(ini); d <= fim; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const c = porDia.get(iso) ?? { ep: 0, sp: 0, er: 0, sr: 0, e0: 0, s0: 0 };
      accP += c.ep - c.sp;
      acc0 += c.e0 - c.s0;
      const futuro = d > hoje;
      if (!futuro) accR += c.er - c.sr;
      linhas.push({
        x: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`,
        _iso: iso,
        "Entrada prevista": c.ep, "Entrada realizada": c.er,
        "Saída prevista": c.sp,   "Saída realizada": c.sr,
        ...(temPlano ? {
          "Entrada do plano": c.e0, "Saída do plano": c.s0, "Saldo do plano": acc0,
        } : {}),
        "Saldo previsto": accP,
        // A curva do realizado PARA em hoje: prolongá-la faria parecer que o
        // projeto congelou, quando na verdade ainda não chegou lá.
        "Saldo realizado": futuro ? null : accR,
      });
    }
    return linhas;
  }, [previsto, entradas, data, plano, omiEnt]);

  const hojeIso = new Date().toISOString().slice(0, 10);
  /** O rótulo do primeiro dia >= hoje, para a divisória vertical. */
  const rotuloHoje = useMemo(() => {
    const achou = grafico.find((g) => String(g._iso) >= hojeIso);
    return achou ? String(achou.x) : null;
  }, [grafico, hojeIso]);

  // Previsto vazado, realizado sólido: é a MESMA medida em dois estados, então
  // a cor continua dizendo de que medida se trata e o preenchimento diz o
  // estado. Quatro cores fariam procurar quatro coisas onde existem duas.
  const temPlano = !!(plano?.parcelas.length || plano?.saidas.length);

  /** O teto que vale: o definido à mão vence; na falta dele, o que a proposta
   *  planejou gastar. Um só lugar calcula isto, senão o resumo e o gráfico
   *  desenhariam réguas diferentes. */
  const tetoVigente = useMemo(() => {
    const manual = data?.orcamento?.valor_budget;
    if (manual != null) return Number(manual);
    const c = plano?.plano;
    if (!c) return null;
    const t = Number(c.custo_materiais ?? 0) + Number(c.custo_mao_obra ?? 0)
            + Number(c.custo_despesas ?? 0);
    return t > 0 ? t : null;
  }, [data, plano]);

  /** Os três cenários, e o que cada um responde.
   *
   *   PLANO      o que foi combinado no fechamento. Não se mexe.
   *   PREVISTO   o que se espera hoje: PV e pedidos de compra reais do Omie,
   *              mais o que o ERP não tem como saber (mão de obra, despesa).
   *   REALIZADO  o que de fato entrou e saiu, pela baixa do título.
   *
   *  O seletor existe porque os três juntos são doze séries — legítimo para
   *  comparar, denso demais para ler uma coisa só. */
  const CENARIOS = {
    plano:     ["Entrada do plano", "Saída do plano", "Saldo do plano"],
    previsto:  ["Entrada prevista", "Saída prevista", "Saldo previsto"],
    realizado: ["Entrada realizada", "Saída realizada", "Saldo realizado"],
  } as const;
  const visiveis = new Set<string>(
    cenario === "todos"
      ? [...CENARIOS.plano, ...CENARIOS.previsto, ...CENARIOS.realizado]
      : CENARIOS[cenario]);

  // O HUE diz a medida (verde entra, vermelho sai) e o PREENCHIMENTO diz o
  // estado. Só que estados são TRÊS e densidades são duas — plano e previsto
  // saíam com o mesmo verde vazado, literalmente a mesma barra com dois nomes
  // na legenda.
  //
  // A saída não é inventar uma terceira densidade: é notar que a barra do
  // plano só interessa quando se olha o plano sozinho. Comparando os três, o
  // que se compara são as CURVAS — e três pares de barra por dia deixariam
  // cada uma com 3px de largura.
  const soPlano = cenario === "plano";
  const barras: SeriesDef[] = [
    ...(temPlano && soPlano ? [
      { key: "Entrada do plano", label: "Entrada do plano", slot: 5, mark: "rect", variante: "vazada" } as SeriesDef,
      { key: "Saída do plano",   label: "Saída do plano",   slot: 3, mark: "rect", variante: "vazada" } as SeriesDef,
    ] : []),
    { key: "Entrada prevista",  label: "Entrada prevista",  slot: 5, mark: "rect", variante: "vazada" } as SeriesDef,
    { key: "Entrada realizada", label: "Entrada realizada", slot: 5, mark: "rect" } as SeriesDef,
    { key: "Saída prevista",    label: "Saída prevista",    slot: 3, mark: "rect", variante: "vazada" } as SeriesDef,
    { key: "Saída realizada",   label: "Saída realizada",   slot: 3, mark: "rect" } as SeriesDef,
  ].filter((b) => visiveis.has(b.key));

  /** As curvas de equilíbrio. Cor diferente para cada uma: aqui são medidas
   *  diferentes (plano × expectativa × realidade), e é a comparação entre elas
   *  que responde "estou financiando este cliente?" e "escorregou quanto?". */
  const linhas: SeriesDef[] = [
    // Rosa, não ciano. O slot 4 é vizinho do 0 na rampa e as duas curvas saíam
    // tracejadas no mesmo azul — a legenda nomeava duas coisas que o gráfico
    // desenhava como uma. O 6 não é usado por nada aqui e se separa do azul,
    // do amarelo do realizado e do verde/vermelho das barras.
    ...(temPlano
      ? [{ key: "Saldo do plano", label: "Saldo do plano (fechamento)", slot: 6, mark: "line", tracejada: true } as SeriesDef]
      : []),
    { key: "Saldo previsto",  label: "Saldo previsto",  slot: 0, mark: "line", tracejada: true } as SeriesDef,
    { key: "Saldo realizado", label: "Saldo realizado", slot: 2, mark: "line" } as SeriesDef,
  ].filter((l) => visiveis.has(l.key));
  const serie: SeriesDef[] = [...barras, ...linhas];

  /** O desvio contra o PLANO — em dinheiro e em dias.
   *
   *  É o número que fecha a pergunta do projeto: combinei X, hoje espero Y.
   *  Em dias, o atraso da primeira parcela que ainda não faturou; adiantar o
   *  recebimento não é notícia, atrasar é. */
  const vsPlano = useMemo(() => {
    if (!temPlano) return null;
    const pEnt = (plano?.parcelas ?? []).reduce((a, p) => a + Number(p.valor || 0), 0);
    const pSai = (plano?.saidas ?? []).filter((x) => x.no_fluxo)
                                      .reduce((a, x) => a + Number(x.valor || 0), 0);
    const atrasos = (plano?.parcelas ?? [])
      .filter((p) => p.dt_ajustada && p.dt_plano && p.dt_ajustada > p.dt_plano)
      .map((p) => Math.round(
        (new Date(`${p.dt_ajustada}T12:00:00`).getTime()
         - new Date(`${p.dt_plano}T12:00:00`).getTime()) / 86_400_000));
    return {
      entradas: totEnt - pEnt, saidas: totSai - pSai,
      resultado: (totEnt - totSai) - (pEnt - pSai),
      planoResultado: pEnt - pSai,
      piorAtraso: atrasos.length ? Math.max(...atrasos) : 0,
      parcelasAtrasadas: atrasos.length,
    };
  }, [temPlano, plano, totEnt, totSai]);

  const cab = data?.cabecalho ?? { status: "rascunho" as const, versao: 1 };
  const tom = TOM[cab.status];
  const podeEditar  = data?.pode_editar ?? false;
  const podeAprovar = data?.pode_aprovar ?? false;
  const realTot = (data?.realizado ?? []).reduce(
    (a, r) => ({ e: a.e + Number(r.entrada_realizada || 0), s: a.s + Number(r.saida_realizada || 0) }),
    { e: 0, s: 0 });

  return (
    <div className="space-y-3.5">
      {/* Estado do fluxo: LINHA, não card.
          Era um bloco com borda e fundo próprios, do mesmo tamanho do resumo
          do projeto — e "Rascunho" não é uma informação do mesmo peso que
          R$ 91 mil. Um ponto de cor e uma frase bastam; o que precisa de
          destaque são os botões, e eles já o têm por serem botões. */}
      <div className="flex items-center gap-2.5 flex-wrap px-1 text-[12px]">
        <span aria-hidden className={`w-2 h-2 rounded-full shrink-0 ${tom.ponto}`} />
        <div className="min-w-0">
          <strong className="text-ww-text">{tom.rot}</strong>
          {cab.versao > 1 && <span className="text-ww-textFaint"> · v{cab.versao}</span>}
          <span className="text-ww-textMuted"> — {tom.dica}
            {cab.status === "aprovado" && cab.decidido_por && (
              <> Por {cab.decidido_por}
                {cab.decidido_em ? ` em ${new Date(cab.decidido_em).toLocaleDateString("pt-BR")}` : ""}.</>
            )}
            {cab.status === "rejeitado" && cab.motivo && <> Motivo: <em>{cab.motivo}</em></>}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {podeEditar && (
            <button type="button" onClick={() => void salvar()}
              disabled={salvando || !sujo}
              title={sujo ? "Grava as linhas no painel" : "Nada mudou desde a última gravação"}
              className={`px-2.5 py-1 text-[11.5px] rounded-lg border transition ${
                sujo ? "border-ww-accent bg-ww-accent text-white font-semibold hover:brightness-110"
                     : "border-ww-border text-ww-textFaint cursor-not-allowed"}`}>
              {salvando ? "…" : "Salvar"}
            </button>
          )}
          {podeEditar && cab.status !== "pendente" && (
            <button type="button" onClick={() => void decidir("enviar")}
              disabled={salvando || sujo || !(totEnt || totSai)}
              title={sujo ? "Salve antes de enviar" : "Manda para aprovação do administrador"}
              className="px-2.5 py-1 text-[11.5px] rounded-lg border border-ww-border text-ww-text
                         hover:bg-ww-rowHover transition disabled:opacity-40">
              Enviar para aprovação
            </button>
          )}
          {podeAprovar && cab.status === "pendente" && (
            <>
              <button type="button" onClick={() => void decidir("aprovar")} disabled={salvando}
                className="px-2.5 py-1 text-[11.5px] rounded-lg bg-emerald-600 text-white font-semibold
                           hover:brightness-110 transition disabled:opacity-40">
                Aprovar fluxo
              </button>
              <button type="button" disabled={salvando}
                onClick={() => {
                  const m = window.prompt("Motivo da rejeição:");
                  if (m?.trim()) void decidir("rejeitar", m.trim());
                }}
                className="px-2.5 py-1 text-[11.5px] rounded-lg border border-rose-500/50
                           text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 transition disabled:opacity-40">
                Rejeitar
              </button>
            </>
          )}
          {podeAprovar && cab.status === "aprovado" && (
            <button type="button" onClick={() => void decidir("reabrir")} disabled={salvando}
              title="Volta para rascunho — as compras do projeto voltam a ficar travadas"
              className="px-2.5 py-1 text-[11.5px] rounded-lg border border-ww-border text-ww-textMuted
                         hover:text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40">
              Reabrir
            </button>
          )}
        </div>
      </div>

      {erro && (
        <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-[12px] text-rose-700 dark:text-rose-300">
          <strong>Erro:</strong> {erro}
        </div>
      )}
      {aviso && (
        <div className="p-2.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-[12px] text-emerald-700 dark:text-emerald-300">
          {aviso}
        </div>
      )}
      {/* O desvio contra o plano aprovado. Fica junto dos avisos e não escondido
          numa coluna: escorregar 30 dias no recebimento é notícia, não detalhe. */}
      {desvio && (
        <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/[0.08] text-[12px] text-rose-800 dark:text-rose-200">
          <strong>{desvio.linhas} linha(s) mudaram de data desde a aprovação.</strong>{" "}
          A pior escorregou <strong>{desvio.pior > 0 ? `${desvio.pior} dias para frente` : `${-desvio.pior} dias para trás`}</strong>
          {desvio.valor > 0 && <> · {brl(desvio.valor)} adiado</>}. O gráfico já usa as datas novas.
        </div>
      )}

      {/* O confronto que fecha o projeto: combinei X, hoje espero Y.
          Fica no topo junto dos outros avisos porque perder 10% da margem
          entre o fechamento e a obra é notícia, não linha de tabela. */}
      {vsPlano && (Math.abs(vsPlano.resultado) > 0.5 || vsPlano.parcelasAtrasadas > 0) && (
        // Barra à esquerda em vez de caixa inteira colorida: a cor continua
        // dizendo bom/ruim sem competir em peso com os números do resumo.
        <div className={`pl-3 py-1.5 border-l-[3px] text-[11.5px] ${
          vsPlano.resultado >= 0
            ? "border-emerald-500 text-emerald-700 dark:text-emerald-300"
            : "border-rose-500 text-rose-700 dark:text-rose-300"}`}>
          <strong>Contra o plano do fechamento:</strong>{" "}
          resultado {vsPlano.resultado >= 0 ? "melhor" : "pior"} em{" "}
          <strong>{brl(Math.abs(vsPlano.resultado))}</strong>{" "}
          (plano {brl(vsPlano.planoResultado)} → hoje {brl(totEnt - totSai)}).
          {Math.abs(vsPlano.saidas) > 0.5 && (
            <> Saídas {vsPlano.saidas > 0 ? "acima" : "abaixo"} em {brl(Math.abs(vsPlano.saidas))}.</>
          )}
          {vsPlano.parcelasAtrasadas > 0 && (
            <> {vsPlano.parcelasAtrasadas} parcela(s) com faturamento adiado — a pior em{" "}
              <strong>{vsPlano.piorAtraso} dias</strong>.</>
          )}
        </div>
      )}

      {sujo && (
        <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[12px] text-amber-800 dark:text-amber-200">
          Há alterações não gravadas. O gráfico já mostra o que você digitou; o painel só passa a
          considerar depois de <strong>Salvar</strong>.
        </div>
      )}

      {/* ── RESUMO ────────────────────────────────────────────────────────
          Os KPIs ficam FIXOS acima das abas (no Workspace). Aqui mora o que
          responde "como está indo": onde o dinheiro que sai parou, e as
          premissas que definiram o plano. */}
      {ver("resumo") && (
        <>
          <Bloco titulo="Execução da despesa"
                 dica="o mesmo dinheiro, em cada estágio — da reserva ao pagamento">
            <ReguaExecucao plano={plano} execucao={data?.execucao ?? null} teto={tetoVigente} />
          </Bloco>

          <PlanoFechamento empresa={empresa} codigoProjeto={codigoProjeto}
            podeEditar={podeEditar} dados={plano} onMudou={() => void carregarPlano()} />
        </>
      )}

      {/* ── CONDIÇÕES COMERCIAIS ─────────────────────────────────────────── */}
      {ver("condicoes") && (
        <>
          <Bloco titulo="O que foi acordado"
                 dica="o que vale é o do fechamento; a origem vem embaixo, nomeada">
            <CondicoesComerciais plano={plano} />
          </Bloco>
          <PlanoFechamento empresa={empresa} codigoProjeto={codigoProjeto}
            podeEditar={podeEditar} dados={plano} onMudou={() => void carregarPlano()}
            somenteCondicoes />
        </>
      )}

      {/* ── FATURAMENTO & RECEBIMENTO ────────────────────────────────────── */}
      {ver("faturamento") && (
        <>
          <Bloco titulo="Faturamento"
                 dica="os PV/OS do projeto — é a etapa deles que diz se já virou nota">
            <Faturamento vendas={data?.vendas ?? []} />
          </Bloco>
          <Bloco titulo="Recebimento"
                 dica="faturado não é recebido: entre a nota e o dinheiro está o título">
            <Recebimento execucao={data?.execucao ?? null} vendas={data?.vendas ?? []}
              plano={plano} teto={tetoVigente} />
          </Bloco>
          <Secao
            titulo="Acrescentado à mão"
            dica="O que o Omie ainda não tem: parcela que não virou título, despesa prevista, serviço a contratar. Digite, ou cole do Excel as colunas Descrição · Categoria · Data · Valor."
            total={manEnt} tom="receber"
            linhas={entradas} onChange={(l) => { setEntradas(l); setSujo(true); }}
            somenteLeitura={!podeEditar}
          />
        </>
      )}

      {/* O teto abre sobre qualquer aba — é edição rara, não faixa fixa. */}
      {editandoTeto && (
        <CardBudget empresa={empresa} codigoProjeto={codigoProjeto}
          orcamento={data?.orcamento ?? null} comprado={omiSai + manSai} pago={liq.pago}
          podeEditar={podeEditar}
          onGravado={() => { setEditandoTeto(false); void carregar(); }}
          onFechar={() => setEditandoTeto(false)}
          plano={plano} />
      )}

      {ver("fluxo") && (
      <ChartFrame
        title={`Fluxo de caixa do projeto${nomeProjeto ? ` — ${nomeProjeto}` : ""}`}
        subtitle={
          "Dia a dia. Barra vazada = ainda não aconteceu; cheia = o que de fato entrou e saiu, pela baixa do título. "
          + (temPlano
              ? "São três curvas de saldo: a do PLANO (fechamento), a PREVISTA (o que se espera hoje) e a REALIZADA, que para em hoje. "
                + "A distância entre a do plano e a prevista é o desvio; quando a realizada corre abaixo das duas, o projeto está sendo financiado por você. "
              : "A linha tracejada é o saldo do PLANO; a cheia é o saldo REAL, e ela para em hoje. "
                + "Quando a cheia corre abaixo da tracejada, o projeto está sendo financiado por você. ")
          + (tetoVigente ? `A régua marca o teto de gasto de ${brl(tetoVigente)}.` : "")
        }
        series={serie} rows={grafico} valueFormat={(v) => brl(Number(v))}
        loading={carregando} height={360}
        acoes={temPlano ? (
          <label className="inline-flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-[0.6px] font-bold text-ww-textFaint">
              Vendo
            </span>
            {/* Um select, não quatro chips: a lista dos cenários é uma escolha
                entre alternativas exclusivas, e a seta diz isso sem precisar
                de rótulo. Fica no cabeçalho do gráfico porque é ele que muda —
                solto acima da moldura parecia pertencer ao bloco anterior. */}
            <select value={cenario}
              onChange={(e) => setCenario(e.target.value as typeof cenario)}
              title="Qual fluxo o gráfico mostra"
              className="px-2 py-0.5 text-[11px] rounded border border-ww-border bg-ww-bg text-ww-text
                         hover:border-ww-accent/60 focus:border-ww-accent outline-none cursor-pointer">
              <option value="todos">Os três (consolidado)</option>
              <option value="plano">Plano inicial — o fechamento</option>
              <option value="previsto">Previsto — o que se espera hoje</option>
              <option value="realizado">Realizado — o que aconteceu</option>
            </select>
          </label>
        ) : undefined}
      >
        {(vis) => (
          <VizCombo rows={grafico}
            bars={barras.filter((b) => vis.some((v) => v.key === b.key))}
            lines={linhas.filter((l) => vis.some((v) => v.key === l.key))}
            valueFormat={(v) => brl(v)}
            marco={rotuloHoje ? { x: rotuloHoje, rotulo: "HOJE" } : undefined}
            // A régua entra NEGATIVA: no eixo de saldo, gastar o teto derruba a
            // curva até −budget. Marcar +budget mostraria a linha no lugar
            // errado do desenho e não significaria nada.
            regua={tetoVigente
              ? { y: -tetoVigente, rotulo: `teto de gasto ${brl(tetoVigente)}` }
              : undefined}
          />
        )}
      </ChartFrame>
      )}

      {/* ── O que veio do Omie ──────────────────────────────────────────────
          Aba própria: são as linhas cruas do ERP, e a coluna de emissão é
          onde o cronograma entra. Nada aqui é apagável — é recalculado do ERP
          a cada leitura. */}
      {ver("omie") && (
      <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 space-y-3">
        <header>
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
            Do Omie — pedido de venda, títulos e compras
          </h3>
          {/* Três frases viraram uma. A explicação de que "nada é apagado pelo
              painel" e de que "entra sem ninguém digitar" era tranquilizar
              sobre um medo que ninguém tem — quem lê quer saber o que faz com
              a coluna editável. */}
          <p className="text-[11px] text-ww-textMuted mt-0.5">
            Títulos e pedidos de compra que já existem no ERP. Ajuste a{" "}
            <strong className="text-ww-text">emissão da NF</strong> e a nova previsão sai sozinha,
            somando o prazo do pedido.
          </p>
        </header>

        <div>
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
              A receber
            </span>
            <span className="ml-auto text-[13px] font-bold tabular-nums text-emerald-600 dark:text-emerald-300">
              {brl(omiEnt)}
            </span>
          </div>
          <TabelaPrevisto linhas={previsto} lado="entrada" empresa={empresa}
            codigoProjeto={codigoProjeto} podeEditar={podeEditar} onMudou={() => void carregar()} />
        </div>

        <div>
          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-300">
              A pagar
            </span>
            <span className="ml-auto text-[13px] font-bold tabular-nums text-rose-600 dark:text-rose-300">
              {brl(omiSai)}
            </span>
          </div>
          <TabelaPrevisto linhas={previsto} lado="saida" empresa={empresa}
            codigoProjeto={codigoProjeto} podeEditar={podeEditar} onMudou={() => void carregar()} />
        </div>
      </section>
      )}

      {ver("resumo") && (data?.eventos?.length ?? 0) > 0 && (
        <details className="rounded-xl border border-ww-border bg-ww-panel px-3.5 py-2.5">
          <summary className="text-[11.5px] text-ww-textMuted cursor-pointer">
            Histórico de aprovação ({data!.eventos.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {data!.eventos.map((e, i) => (
              <li key={i} className="text-[11px] text-ww-textMuted flex gap-2 flex-wrap">
                <span className="tabular-nums text-ww-textFaint">
                  {new Date(e.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                </span>
                <strong className="text-ww-text">{e.acao}</strong>
                <span>v{e.versao} · {e.por ?? "—"}</span>
                {e.total_entradas != null && (
                  <span className="tabular-nums">
                    {brl(Number(e.total_entradas))} entra · {brl(Number(e.total_saidas ?? 0))} sai · {e.linhas} linha(s)
                  </span>
                )}
                {e.motivo && <em className="text-ww-textFaint">“{e.motivo}”</em>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** A moldura de uma seção de aba: título, dica e conteúdo.
 *
 *  Uma só, em vez de cada bloco inventar a sua — era parte do motivo de a
 *  tela ter "muita informação com a mesma aparência". */
function Bloco({ titulo, dica, acao, children }: {
  titulo: string; dica?: string; acao?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-ww-border bg-ww-panel p-3.5 min-w-0">
      <header className="flex items-start gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold text-ww-text tracking-wide uppercase">{titulo}</h3>
          {dica && <p className="text-[11px] text-ww-textMuted mt-0.5 normal-case">{dica}</p>}
        </div>
        {acao && <div className="ml-auto shrink-0">{acao}</div>}
      </header>
      {children}
    </section>
  );
}

function Secao({
  titulo, dica, total, tom, linhas, onChange, somenteLeitura,
}: {
  titulo: string; dica: string; total: number; tom: "receber" | "pagar";
  linhas: LinhaGrade[]; onChange: (l: LinhaGrade[]) => void; somenteLeitura: boolean;
}) {
  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0">
      <header className="flex items-baseline gap-3 mb-2">
        <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">{titulo}</h3>
        <span className={`ml-auto text-[15px] font-bold tabular-nums ${
          tom === "receber" ? "text-emerald-600 dark:text-emerald-300"
                            : "text-rose-600 dark:text-rose-300"}`}>
          {brl(total)}
        </span>
      </header>
      <p className="text-[11px] text-ww-textMuted mb-2">{dica}</p>
      {somenteLeitura ? (
        <p className="text-[11.5px] text-ww-textFaint py-2">
          Você não tem permissão para lançar o fluxo — só leitura.
        </p>
      ) : (
        <GradeEditavel cols={COLS} linhas={linhas} onChange={onChange} altura={300}
          vazioMsg="Digite ou cole do Excel." />
      )}
    </section>
  );
}

/** O teto de gasto do projeto — e o quanto dele já foi comprometido.
 *
 *  Estava escondido: o número existia na tela de materiais, num canto, e não
 *  havia como saber daqui quanto se podia gastar. Aqui ele é um bloco próprio,
 *  com barra de consumo e o botão de editar à vista — "definir" quando ainda
 *  não existe, o valor clicável quando existe.
 *
 *  Grava em /api/rc-projetos/budget, a MESMA rota da tela de materiais: dois
 *  lugares para editar o mesmo número dariam dois budgets diferentes. */
function CardBudget({
  empresa, codigoProjeto, orcamento, comprado, podeEditar, onGravado, onFechar, plano,
}: {
  empresa: string; codigoProjeto: number; orcamento: Orcamento;
  comprado: number; pago: number; podeEditar: boolean;
  onGravado: () => void; onFechar: () => void;
  plano?: PlanoCompleto | null;
}) {
  const cab = plano?.plano ?? null;
  const tetoPlano = cab
    ? Number(cab.custo_materiais ?? 0) + Number(cab.custo_mao_obra ?? 0)
      + Number(cab.custo_despesas ?? 0)
    : 0;
  const manual = orcamento?.valor_budget != null ? Number(orcamento.valor_budget) : null;

  const [txt, setTxt] = useState(
    manual != null ? manual.toFixed(2).replace(".", ",") : "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const gravar = async (valor: number | null) => {
    setSalvando(true); setErro(null);
    try {
      // PUT, não POST — a rota do budget só expõe PUT e DELETE. Um POST
      // voltaria 405 e o botão pareceria não fazer nada.
      const r = await fetch("/api/rc-projetos/budget", {
        method: valor == null ? "DELETE" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, valor_budget: valor }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      onGravado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  };

  return (
    <section className="rounded-xl border-2 border-ww-accent bg-ww-accentSoft p-3.5">
      <div className="flex items-center gap-2.5 flex-wrap">
        <div>
          <div className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
            Teto de gasto do projeto
          </div>
          <p className="text-[11px] text-ww-textMuted mt-0.5">
            {tetoPlano > 0
              ? <>A proposta planejou <strong className="text-ww-text">{brl(tetoPlano)}</strong>. Defina outro valor só se a decisão for diferente do plano.</>
              : "Sem plano importado, o teto precisa ser digitado."}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-ww-textMuted text-[14px]">R$</span>
          <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { const v = num(txt); if (Number.isFinite(v) && v >= 0) void gravar(v); }
              if (e.key === "Escape") onFechar();
            }}
            inputMode="decimal" placeholder={tetoPlano > 0 ? tetoPlano.toFixed(2).replace(".", ",") : "0,00"}
            className="w-[150px] text-[16px] font-bold tabular-nums bg-ww-bg border border-ww-accent
                       rounded px-2 py-1 text-ww-text outline-none" />
          <button type="button" disabled={salvando || !podeEditar}
            onClick={() => { const v = num(txt); if (!Number.isFinite(v) || v < 0) { setErro("Valor inválido."); return; } void gravar(v); }}
            className="px-3 py-1 text-[11.5px] rounded-lg bg-ww-accent text-white font-semibold
                       hover:brightness-110 transition disabled:opacity-40">
            {salvando ? "…" : "Salvar"}
          </button>
          {/* Voltar ao plano é uma ação própria, não "salvar vazio": apaga o
              teto manual e o do fechamento volta a valer. */}
          {manual != null && tetoPlano > 0 && (
            <button type="button" disabled={salvando} onClick={() => void gravar(null)}
              title={`Volta a usar o ${brl(tetoPlano)} que a proposta planejou`}
              className="text-[11px] text-ww-accent hover:underline disabled:opacity-40">
              voltar ao do plano
            </button>
          )}
          <button type="button" onClick={onFechar}
            className="text-[11px] text-ww-textMuted hover:text-ww-text">fechar</button>
        </div>
      </div>
      <p className="mt-2 text-[10.5px] text-ww-textMuted">
        O teto é a régua do gráfico e a base da barra de consumo. Comprado até agora:{" "}
        <strong className="text-ww-text tabular-nums">{brl(comprado)}</strong>.
      </p>
      {erro && <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-300">{erro}</p>}
    </section>
  );
}

