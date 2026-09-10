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

const TOM: Record<Cabecalho["status"], { rot: string; classe: string; dica: string }> = {
  rascunho:  { rot: "Rascunho", classe: "border-ww-border bg-ww-panel text-ww-textMuted",
               dica: "Ainda não foi enviado para aprovação." },
  pendente:  { rot: "Aguardando aprovação", classe: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
               dica: "Enviado. As compras do projeto continuam travadas até a decisão." },
  aprovado:  { rot: "Aprovado", classe: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
               dica: "As compras deste projeto já podem ser aprovadas." },
  rejeitado: { rot: "Rejeitado", classe: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
               dica: "Ajuste o plano e envie de novo." },
};

export default function FluxoProjetoView({
  empresa, codigoProjeto, nomeProjeto,
}: {
  empresa: string; codigoProjeto: number; nomeProjeto?: string;
}) {
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
      ep: number; sp: number; er: number; sr: number;
    }>();
    const cel = (d: string) => {
      const c = porDia.get(d) ?? { ep: 0, sp: 0, er: 0, sr: 0 };
      porDia.set(d, c); return c;
    };

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
    let accP = 0, accR = 0;
    for (const d = new Date(ini); d <= fim; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const c = porDia.get(iso) ?? { ep: 0, sp: 0, er: 0, sr: 0 };
      accP += c.ep - c.sp;
      const futuro = d > hoje;
      if (!futuro) accR += c.er - c.sr;
      linhas.push({
        x: `${iso.slice(8, 10)}/${iso.slice(5, 7)}`,
        _iso: iso,
        "Entrada prevista": c.ep, "Entrada realizada": c.er,
        "Saída prevista": c.sp,   "Saída realizada": c.sr,
        "Saldo previsto": accP,
        // A curva do realizado PARA em hoje: prolongá-la faria parecer que o
        // projeto congelou, quando na verdade ainda não chegou lá.
        "Saldo realizado": futuro ? null : accR,
      });
    }
    return linhas;
  }, [previsto, entradas, data]);

  const hojeIso = new Date().toISOString().slice(0, 10);
  /** O rótulo do primeiro dia >= hoje, para a divisória vertical. */
  const rotuloHoje = useMemo(() => {
    const achou = grafico.find((g) => String(g._iso) >= hojeIso);
    return achou ? String(achou.x) : null;
  }, [grafico, hojeIso]);

  // Previsto vazado, realizado sólido: é a MESMA medida em dois estados, então
  // a cor continua dizendo de que medida se trata e o preenchimento diz o
  // estado. Quatro cores fariam procurar quatro coisas onde existem duas.
  const barras: SeriesDef[] = [
    { key: "Entrada prevista",  label: "Entrada prevista",  slot: 5, mark: "rect", variante: "vazada" },
    { key: "Entrada realizada", label: "Entrada realizada", slot: 5, mark: "rect" },
    { key: "Saída prevista",    label: "Saída prevista",    slot: 3, mark: "rect", variante: "vazada" },
    { key: "Saída realizada",   label: "Saída realizada",   slot: 3, mark: "rect" },
  ];
  /** As duas curvas de equilíbrio. Mesma cor não daria: aqui são medidas
   *  diferentes (plano × realidade), e é a comparação entre elas que responde
   *  "estou financiando este cliente?". */
  const linhas: SeriesDef[] = [
    { key: "Saldo previsto",  label: "Saldo previsto",  slot: 0, mark: "line", tracejada: true },
    { key: "Saldo realizado", label: "Saldo realizado", slot: 2, mark: "line" },
  ];
  const serie: SeriesDef[] = [...barras, ...linhas];

  const cab = data?.cabecalho ?? { status: "rascunho" as const, versao: 1 };
  const tom = TOM[cab.status];
  const podeEditar  = data?.pode_editar ?? false;
  const podeAprovar = data?.pode_aprovar ?? false;
  const realTot = (data?.realizado ?? []).reduce(
    (a, r) => ({ e: a.e + Number(r.entrada_realizada || 0), s: a.s + Number(r.saida_realizada || 0) }),
    { e: 0, s: 0 });

  return (
    <div className="space-y-3.5">
      {/* Faixa de estado. Fica no topo porque é ela que responde "posso comprar
          neste projeto?" — a pergunta que traz a maioria das pessoas aqui. */}
      <div className={`flex items-start gap-3 flex-wrap px-3.5 py-2.5 rounded-xl border text-[12px] ${tom.classe}`}>
        <div className="min-w-0">
          <strong>{tom.rot}</strong>
          {cab.versao > 1 && <span className="opacity-70"> · v{cab.versao}</span>}
          <span className="block text-[11px] opacity-90 mt-0.5">
            {tom.dica}
            {cab.status === "aprovado" && cab.decidido_por && (
              <> Aprovado por {cab.decidido_por}
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

      {sujo && (
        <div className="p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[12px] text-amber-800 dark:text-amber-200">
          Há alterações não gravadas. O gráfico já mostra o que você digitou; o painel só passa a
          considerar depois de <strong>Salvar</strong>.
        </div>
      )}

      {/* Números-âncora. Um plano sem total é uma lista; com total é uma decisão. */}
      {/* Seis números, na ordem em que a pergunta aparece: o que planejei,
          o que já se moveu, e como está o equilíbrio agora. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {[
          { rot: "Entradas previstas", val: brl(totEnt),
            sub: `${brl(liq.recebido)} já recebido`, tom: "receber" as const },
          { rot: "Falta receber", val: brl(liq.faltaReceber),
            sub: "do cliente", tom: "receber" as const },
          { rot: "Saídas previstas", val: brl(totSai),
            sub: `${brl(liq.pago)} já pago`, tom: "pagar" as const },
          { rot: "Falta pagar", val: brl(liq.faltaPagar),
            sub: "a fornecedores", tom: "pagar" as const },
          { rot: "Resultado previsto", val: brl(totEnt - totSai),
            sub: margem == null ? "sem entrada lançada" : `margem de ${margem.toFixed(1).replace(".", ",")}%`,
            tom: (totEnt - totSai >= 0 ? "receber" : "pagar") as "receber" | "pagar" },
          // O número que responde "estou com prejuízo agora?". Negativo = já
          // saiu mais do que entrou; o projeto está sendo financiado por você.
          { rot: "Caixa do projeto hoje", val: brl(liq.caixa),
            sub: liq.caixa < 0 ? "você está financiando este projeto" : "entrou mais do que saiu",
            tom: (liq.caixa >= 0 ? "receber" : "pagar") as "receber" | "pagar" },
        ].map((c) => (
          <div key={c.rot} className={`rounded-xl border p-3 ${
            c.tom === "receber" ? "border-emerald-500/25 bg-emerald-500/[0.06]"
                                : "border-rose-500/25 bg-rose-500/[0.06]"}`}>
            <div className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">{c.rot}</div>
            <div className={`text-[17px] font-bold tabular-nums tracking-[-0.5px] mt-1 ${
              c.tom === "receber" ? "text-emerald-600 dark:text-emerald-300"
                                  : "text-rose-600 dark:text-rose-300"}`}>{c.val}</div>
            <div className="text-[10.5px] text-ww-textMuted mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      <CardBudget empresa={empresa} codigoProjeto={codigoProjeto}
        orcamento={data?.orcamento ?? null} comprado={omiSai + manSai} pago={liq.pago}
        podeEditar={podeEditar} onGravado={() => void carregar()} />

      <ChartFrame
        title={`Fluxo de caixa do projeto${nomeProjeto ? ` — ${nomeProjeto}` : ""}`}
        subtitle={
          "Dia a dia. Barra vazada = previsto; cheia = o que de fato entrou e saiu, pela baixa do título. "
          + "A linha tracejada é o saldo do PLANO; a cheia é o saldo REAL, e ela para em hoje. "
          + "Quando a cheia corre abaixo da tracejada, o projeto está sendo financiado por você."
          + (data?.orcamento?.valor_budget
              ? ` A régua marca o teto de gasto de ${brl(Number(data.orcamento.valor_budget))}.`
              : "")
        }
        series={serie} rows={grafico} valueFormat={(v) => brl(Number(v))}
        loading={carregando} height={360}
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
            regua={data?.orcamento?.valor_budget
              ? { y: -Number(data?.orcamento?.valor_budget), rotulo: `teto de gasto ${brl(Number(data?.orcamento?.valor_budget))}` }
              : undefined}
          />
        )}
      </ChartFrame>

      {/* Empilhadas em largura cheia, não lado a lado. Com duas colunas a grade
          recebia ~600px e a coluna VALOR — a mais importante das quatro — ficava
          cortada fora da vista. Grade é para digitar; digitar num campo que não
          se enxerga não é uma opção de layout. */}
      {/* ── O que veio do Omie ──────────────────────────────────────────────
          Vem primeiro porque é o grosso do plano na maioria dos projetos, e
          porque a coluna de emissão é onde o cronograma entra. Não é apagável:
          é recalculado do ERP a cada leitura. */}
      <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 space-y-3">
        <header>
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
            Do Omie — pedido de venda, títulos e compras
          </h3>
          <p className="text-[11px] text-ww-textMuted mt-0.5">
            Isto já existe no ERP e entra no plano sem ninguém digitar. Ajuste a
            <strong className="text-ww-text"> emissão da NF</strong> pelo cronograma e a
            <strong className="text-ww-text"> nova previsão</strong> sai sozinha, somando o prazo do
            pedido de venda. Nada aqui é apagado pelo painel.
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

      <Secao
        titulo="Acrescentado à mão"
        dica="O que o Omie ainda não tem: parcela que não virou título, despesa prevista, serviço a contratar. Digite, ou cole do Excel as colunas Descrição · Categoria · Data · Valor."
        total={manEnt} tom="receber"
        linhas={entradas} onChange={(l) => { setEntradas(l); setSujo(true); }}
        somenteLeitura={!podeEditar}
      />
      {/* As saídas manuais saíram da tela. Todo pedido de compra do projeto já
          aparece no bloco do Omie assim que é lançado — manter um lugar para
          digitar saída à mão criava uma segunda lista de compras que ninguém ia
          manter, e que somaria em cima da que o ERP já tem. */}

      {(data?.eventos?.length ?? 0) > 0 && (
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
  empresa, codigoProjeto, orcamento, comprado, pago, podeEditar, onGravado,
}: {
  empresa: string; codigoProjeto: number; orcamento: Orcamento;
  comprado: number; pago: number; podeEditar: boolean; onGravado: () => void;
}) {
  const teto = orcamento?.valor_budget != null ? Number(orcamento.valor_budget) : null;
  const [editando, setEditando] = useState(false);
  const [txt, setTxt] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const gravar = async () => {
    const v = num(txt);
    if (!Number.isFinite(v) || v < 0) { setErro("Valor inválido."); return; }
    setSalvando(true); setErro(null);
    try {
      // PUT, não POST — a rota do budget só expõe PUT e DELETE. Um POST
      // voltaria 405 e o botão pareceria não fazer nada.
      const r = await fetch("/api/rc-projetos/budget", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, valor_budget: v }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setEditando(false); onGravado();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(false); }
  };

  const pct = teto && teto > 0 ? Math.min(200, (comprado / teto) * 100) : null;
  const estourou = pct != null && pct > 100;

  return (
    <section className={`rounded-xl border p-3.5 ${
      estourou ? "border-rose-500/40 bg-rose-500/[0.06]" : "border-ww-border bg-ww-panel"}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
            Teto de gasto do projeto
          </div>
          {editando ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-ww-textMuted text-[14px]">R$</span>
              <input autoFocus value={txt} onChange={(e) => setTxt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void gravar();
                                    if (e.key === "Escape") setEditando(false); }}
                inputMode="decimal" placeholder="0,00"
                className="w-[150px] text-[17px] font-bold tabular-nums bg-ww-bg border border-ww-accent
                           rounded px-2 py-0.5 text-ww-text outline-none" />
              <button type="button" onClick={() => void gravar()} disabled={salvando}
                className="px-2.5 py-1 text-[11.5px] rounded-lg bg-ww-accent text-white font-semibold
                           hover:brightness-110 transition disabled:opacity-40">
                {salvando ? "…" : "Salvar"}
              </button>
              <button type="button" onClick={() => setEditando(false)}
                className="text-[11px] text-ww-textMuted hover:text-ww-text">cancelar</button>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[19px] font-bold tabular-nums text-ww-text">
                {teto != null ? brl(teto) : "não definido"}
              </span>
              {podeEditar && (
                <button type="button"
                  onClick={() => { setTxt(teto != null ? String(teto).replace(".", ",") : ""); setEditando(true); }}
                  className="px-2 py-0.5 text-[11px] rounded-lg border border-ww-accent/60 text-ww-accent
                             hover:bg-ww-accentSoft transition font-semibold">
                  {teto != null ? "Editar teto" : "Definir teto"}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="ml-auto text-right text-[11px] text-ww-textMuted tabular-nums">
          <div><strong className="text-ww-text">{brl(comprado)}</strong> já comprado</div>
          <div>{brl(pago)} já pago · {teto != null ? brl(Math.max(0, teto - comprado)) : "—"} de folga</div>
        </div>
      </div>

      {pct != null && (
        <>
          <div className="mt-2.5 h-2 rounded-full bg-ww-border/60 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${
              estourou ? "bg-rose-500" : pct > 85 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className={`mt-1 text-[11px] ${estourou ? "text-rose-600 dark:text-rose-300" : "text-ww-textMuted"}`}>
            {pct.toFixed(0)}% do teto comprometido
            {estourou && <> — <strong>{brl(comprado - (teto ?? 0))} acima do teto</strong></>}
          </p>
        </>
      )}
      {teto == null && (
        <p className="mt-2 text-[11px] text-ww-textMuted">
          Sem teto definido, o gráfico não tem régua e não há como dizer se o projeto está
          estourando o orçamento.
        </p>
      )}
      {erro && <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-300">{erro}</p>}
    </section>
  );
}
