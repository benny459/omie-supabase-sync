"use client";

// Aba/página "Faturamento" (analítico). Nome do componente com sufixo Bi porque
// já existe FaturamentoView, que é o faturamento DIÁRIO operacional — coisas
// diferentes, e trocar uma pela outra daria número errado sem erro nenhum.
//
// Aqui aparece o primeiro desdobramento de eixo duplo: no Metabase, "Cobertura
// Mensal — Emitido × Recebido" e "Quantidade de Notas por Categoria — Mês × YTD"
// eram combos com série no eixo direito. Pela sua decisão, viraram gráficos
// separados: valor em R$ num, contagem de notas noutro. As duas medidas nunca
// compartilharam escala — o eixo duplo só escondia isso.
//
// FUSÃO (06/08/2026): a tela de "Faturamento → Recebimento" foi absorvida aqui.
// Eram duas páginas sobre o mesmo dinheiro em dois momentos — quanto entrou e em
// quanto tempo. A tabela de detalhe passou a trazer a NF e o título que ela
// gerou na MESMA linha, filtrável por situação, no lugar de duas listas que
// obrigavam a procurar o documento de uma na outra.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizGauge from "@/components/viz/VizGauge";
import VizPie from "@/components/viz/VizPie";
import VizTable, { type Col } from "@/components/viz/VizTable";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];
const CATS = ["Contratuais", "Projetos", "Revenda", "Avulsos", "BOT/SW", "Outras"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Faixa = { label: string; value: number };

// A linha fundida: a nota E o título que ela gerou.
type FatRow = {
  empresa: string; origem: string; documento: string; dt_fat: string | null;
  cliente: string; projeto: string; categoria: string;
  /** No grão parcela vem só na PRIMEIRA — senão o rodapé somaria a nota N vezes. */
  valor_nf: number | null;
  num_titulo: string | null; parcela: string | null;
  /** Da parcela no grão parcela; da nota no grão nota. */
  valor: number;
  vencimento: string | null; pagamento: string | null;
  recebido: number | null; aberto: number | null;
  prazo_dias: number | null; dias_atraso: number | null; situacao: string;
};

const SITUACOES = ["Recebido", "A vencer", "Vencido", "Parcial", "Sem título"];

const tomSituacao = (v: unknown) =>
  v === "Recebido" ? "ok" as const
  : v === "Vencido" || v === "Sem título" ? "critico" as const
  : v === "Parcial" ? "alerta" as const : "neutro" as const;

const COL_BASE: Col<FatRow>[] = [
  { key: "dt_fat",     label: "Dt. NF",    tipo: "date", w: 80 },
  { key: "empresa",    label: "Emp.",      w: 50 },
  { key: "documento",  label: "Doc.",      w: 88 },
  { key: "cliente",    label: "CLIENTE",   w: 200 },
  { key: "projeto",    label: "Projeto",   w: 165 },
  { key: "categoria",  label: "Categoria", w: 96 },
];
const COL_FIM: Col<FatRow>[] = [
  { key: "vencimento", label: "Vence",     tipo: "date", w: 80 },
  { key: "prazo_dias", label: "Prazo",     tipo: "dias", w: 68 },
  { key: "pagamento",  label: "Pago em",   tipo: "date", w: 80 },
  { key: "recebido",   label: "Recebido",  tipo: "money", w: 112 },
  { key: "aberto",     label: "Aberto",    tipo: "money", w: 112 },
  { key: "dias_atraso",label: "Atraso",    tipo: "dias", w: 70 },
  { key: "situacao",   label: "Situação",  tipo: "badge", w: 90, tom: tomSituacao },
];

// No grão parcela existem DUAS colunas de dinheiro com significados diferentes:
// "Faturado NF" (o total da nota, uma vez só) e "Valor parcela". Fundi-las numa
// coluna só faria uma das duas somas ficar errada no rodapé.
const COLS_NOTA: Col<FatRow>[] = [
  ...COL_BASE,
  { key: "valor_nf",   label: "Faturado",  tipo: "money", w: 115 },
  { key: "num_titulo", label: "Título",    w: 88 },
  { key: "parcela",    label: "Parc.",     w: 56 },
  ...COL_FIM,
];
const COLS_PARCELA: Col<FatRow>[] = [
  ...COL_BASE,
  { key: "valor_nf",   label: "Faturado NF",   tipo: "money", w: 118 },
  { key: "num_titulo", label: "Título",        w: 88 },
  { key: "parcela",    label: "Parc.",         w: 60 },
  { key: "valor",      label: "Valor parcela", tipo: "money", w: 118 },
  ...COL_FIM,
];

type CoorteRow = {
  mes: string; faturado: number; emitido: number; recebido: number;
  a_vencer: number; vencido: number; sem_titulo: number; pct_recebido: number | null;
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (iso: string | null) => {
  if (!iso) return "Sem NF";
  const [a, m] = iso.slice(0, 7).split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
};
type Payload = {
  total_periodo: number; total_ytd: number; total_mes: number;
  qtd_notas: number; qtd_notas_ytd: number;
  mensal: Array<Record<string, unknown>>;
  categorias: string[];
  dso: { media: number | null; faixas: Faixa[] };
  concedido: { media: number | null; faixas: Faixa[] };
  top: Array<{ chave: string; valor: number; qtd: number }>;
  dim: string;
  por_parcela: boolean;
  detalhe: FatRow[];
  coorte: CoorteRow[];
  calendario: { rows: Array<Record<string, unknown>>; origens: string[]; agrupadas: number };
};

export default function FaturamentoBiView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [situacoes, setSituacoes] = useState<Set<string>>(new Set());
  const [porParcela, setPorParcela] = useState(false);
  const [dim, setDim] = useState<"projeto" | "cliente">("projeto");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to, dim });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      if (cats.size) qs.set("cat", Array.from(cats).join(","));
      if (situacoes.size) qs.set("situacao", Array.from(situacoes).join(","));
      if (porParcela) qs.set("parcela", "1");
      const r = await fetch(`/api/bi/faturamento?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, empresas, cats, situacoes, porParcela, dim]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
    { key: "cat", label: "Categoria de venda", options: CATS, selected: cats },
    { key: "situacao", label: "Situação do recebimento", options: SITUACOES, selected: situacoes },
  ];

  // Mix mensal: no máximo 6 categorias empilhadas (limite do olho, não do código).
  const mixSeries: SeriesDef[] = (data?.categorias ?? []).slice(0, 6).map((c, i) => ({
    key: c, label: c, slot: i, mark: "rect",
  }));

  const topSeries: SeriesDef[] = [{ key: "valor", label: "Faturado", slot: 0, mark: "rect" }];
  const topRows = (data?.top ?? []).map((t) => ({ x: t.chave, valor: t.valor, qtd: t.qtd }));

  // Desdobramento do combo: contagem de notas é a segunda medida, e vai em
  // gráfico próprio em vez de um segundo eixo.
  const qtdSeries: SeriesDef[] = [{ key: "qtd", label: "Notas", slot: 1, mark: "rect" }];

  // Coorte: ordem = gravidade, do bom pro ruim. A pilha lê de baixo pra cima,
  // então "recebido" fica na base.
  const coorteRows = (data?.coorte ?? []).map((c) => ({
    x: rotuloMes(c.mes),
    Recebido: Number(c.recebido) || 0,
    "A vencer": Number(c.a_vencer) || 0,
    Vencido: Number(c.vencido) || 0,
    "Sem título": Number(c.sem_titulo) || 0,
  }));
  const coorteSeries: SeriesDef[] = [
    { key: "Recebido",   label: "Recebido",   slot: 5, mark: "rect" },
    { key: "A vencer",   label: "A vencer",   slot: 0, mark: "rect" },
    { key: "Vencido",    label: "Vencido",    slot: 3, mark: "rect" },
    { key: "Sem título", label: "Sem título", slot: 2, mark: "rect" },
  ];
  const calSeries: SeriesDef[] = (data?.calendario?.origens ?? [])
    .map((o, i) => ({ key: o, label: o, slot: i, mark: "rect" as const }));

  return (
    <div className="space-y-4 min-w-0">
      <VizFilters
        range={range}
        onRangeChange={setRange}
        dims={dims}
        onDimChange={(k, sel) =>
          k === "empresa" ? setEmpresas(sel)
          : k === "situacao" ? setSituacoes(sel)
          : setCats(sel)}
        right={
          <select
            value={dim}
            onChange={(e) => setDim(e.target.value as "projeto" | "cliente")}
            className="text-[11px] bg-ww-panel border border-ww-border rounded px-1.5 py-0.5 text-ww-text"
          >
            <option value="projeto">ranking por projeto</option>
            <option value="cliente">ranking por cliente</option>
          </select>
        }
      />

      {err && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[12px]">
          <strong>Erro:</strong> {err}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Faturado no período" value={data ? brl(data.total_periodo) : "—"}
                  hint={data ? `${data.qtd_notas} notas` : undefined} />
        <StatTile label="Faturado YTD" value={data ? brl(data.total_ytd) : "—"}
                  hint={data ? `${data.qtd_notas_ytd} notas` : undefined} />
        <StatTile label="Faturado no mês" value={data ? brl(data.total_mes) : "—"} />
        <StatTile label="DSO médio"
                  value={data?.dso.media != null ? `${data.dso.media.toFixed(1)} dias` : "—"}
                  hint="Emissão → pagamento, ponderado"
                  higherIsBetter={false} />
      </div>

      <ChartFrame
        title="Faturamento mensal por categoria"
        subtitle="Barras empilhadas: composição do faturamento mês a mês"
        series={mixSeries}
        rows={data?.mensal ?? []}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={300}
      >
        <VizBar rows={data?.mensal ?? []} series={mixSeries} stacked valueFormat={brl} totalNoTopo />
      </ChartFrame>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartFrame
          title="Prazo efetivo (DSO) — distribuição"
          subtitle={data?.dso.media != null ? `média ponderada ${data.dso.media.toFixed(1)} dias` : undefined}
          series={(data?.dso.faixas ?? []).map((f, i) => ({ key: f.label, label: f.label, slot: i, mark: "rect" }))}
          rows={(data?.dso.faixas ?? []).map((f) => ({ x: f.label, [f.label]: f.value }))}
          loading={loading}
          height={240}
        >
          <VizPie slices={data?.dso.faixas ?? []}
                  valueFormat={(v) => `${v} títulos`} totalLabel="títulos pagos" />
        </ChartFrame>

        <ChartFrame
          title="Prazo concedido — distribuição"
          subtitle={data?.concedido.media != null ? `média ponderada ${data.concedido.media.toFixed(1)} dias` : undefined}
          series={(data?.concedido.faixas ?? []).map((f, i) => ({ key: f.label, label: f.label, slot: i, mark: "rect" }))}
          rows={(data?.concedido.faixas ?? []).map((f) => ({ x: f.label, [f.label]: f.value }))}
          loading={loading}
          height={240}
        >
          <VizPie slices={data?.concedido.faixas ?? []}
                  valueFormat={(v) => `${v} títulos`} totalLabel="títulos" />
        </ChartFrame>
      </div>

      {/* Vindos da tela de Recebimento, absorvida aqui: o mesmo faturamento
          visto pelo que já entrou. A coorte empilha porque as faixas SOMAM o
          faturado do mês — é composição de um total, não séries independentes. */}
      <ChartFrame
        title="Coorte — de cada mês faturado, quanto já entrou"
        subtitle="A coluna é o faturamento do mês; as faixas dizem em que estágio ele está hoje"
        series={coorteSeries}
        rows={coorteRows}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={290}
      >
        <VizBar rows={coorteRows} series={coorteSeries} stacked totalNoTopo valueFormat={brl} />
      </ChartFrame>

      <ChartFrame
        title="Calendário de entrada — quando o que está aberto entra"
        subtitle={"Altura = o que entra naquele mês; faixas = de qual mês de faturamento veio"
          + (data?.calendario?.agrupadas ? ` · ${data.calendario.agrupadas} origem(ns) menor(es) em "Outros"` : "")}
        series={calSeries}
        rows={data?.calendario?.rows ?? []}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={290}
      >
        <VizBar rows={data?.calendario?.rows ?? []} series={calSeries} stacked totalNoTopo valueFormat={brl} />
      </ChartFrame>

      {/* Gauges dos prazos: só fazem sentido com meta. Uso 30d como referência
          comercial padrão — se a meta real for outra, é um número só pra mudar. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <section className="bg-ww-panel border border-ww-border rounded-lg p-3">
          <h3 className="text-[13px] font-semibold text-ww-text mb-1">DSO vs meta de 30 dias</h3>
          <VizGauge value={data?.dso.media ?? 0} max={90} target={30} higherIsBetter={false}
                    label="dias" valueFormat={(v) => v.toFixed(1)} />
        </section>
        <section className="bg-ww-panel border border-ww-border rounded-lg p-3">
          <h3 className="text-[13px] font-semibold text-ww-text mb-1">Prazo concedido vs 30 dias</h3>
          <VizGauge value={data?.concedido.media ?? 0} max={90} target={30} higherIsBetter={false}
                    label="dias" valueFormat={(v) => v.toFixed(1)} />
        </section>
      </div>

      {/* A fusão das duas listas que existiam antes: a NF e o título que ela
          gerou, na mesma linha. "Aberto" e "Recebido" somam no rodapé; "Faturado"
          também — os três estão no grão da nota, sem repetição de parcela. */}
      {/* Grão da tabela. No modo parcela uma nota de 3x vira 3 linhas, cada uma
          com a própria situação — é o que responde "qual parcela falta". */}
      <div className="flex items-center gap-1 justify-end -mb-1">
        <span className="text-[11px] text-ww-textMuted mr-1">Detalhar por</span>
        {([[false, "Nota"], [true, "Parcela"]] as const).map(([v, l]) => (
          <button key={l} type="button" onClick={() => setPorParcela(v)}
            className={`px-2 py-0.5 text-[11px] rounded border transition ${
              porParcela === v ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                               : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
            {l}
          </button>
        ))}
      </div>

      <VizTable
        title="Faturamento e recebimento — linha a linha"
        subtitle={porParcela
          ? 'Uma linha por parcela, com a situação de cada uma. "Faturado NF" aparece só na 1ª parcela — repetido, o total somaria a nota várias vezes'
          : "Cada nota com o título que gerou. Filtre por situação na barra acima"}
        cols={porParcela ? COLS_PARCELA : COLS_NOTA}
        rows={data?.detalhe ?? []}
        ordemInicial="dt_fat"
        loading={loading}
        altura={480}
        totalizar={porParcela
          ? ["valor_nf", "valor", "recebido", "aberto"]
          : ["valor_nf", "recebido", "aberto"]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartFrame
          title={`Top ${dim === "cliente" ? "clientes" : "projetos"} — valor faturado`}
          series={topSeries}
          rows={topRows}
          valueFormat={(v) => brl(Number(v) || 0)}
          loading={loading}
          height={380}
        >
          <VizBar rows={topRows} series={topSeries} layout="row" valueFormat={brl} />
        </ChartFrame>

        {/* Segunda medida do combo desdobrada: quantidade, não valor. */}
        <ChartFrame
          title={`Top ${dim === "cliente" ? "clientes" : "projetos"} — quantidade de notas`}
          subtitle="Desdobrado do combo original — contagem não compartilha escala com R$"
          series={qtdSeries}
          rows={topRows}
          valueFormat={(v) => `${Number(v) || 0}`}
          loading={loading}
          height={380}
        >
          <VizBar rows={topRows} series={qtdSeries} layout="row" valueFormat={(v) => `${v}`} />
        </ChartFrame>
      </div>
    </div>
  );
}
