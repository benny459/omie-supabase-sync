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

type FatRow = {
  empresa: string; origem: string; documento: string; cliente: string;
  projeto: string; categoria: string; dt_fat: string | null; valor: number;
};

const COLS_FAT: Col<FatRow>[] = [
  { key: "dt_fat",    label: "Data",      tipo: "date", w: 82 },
  { key: "empresa",   label: "Emp.",      w: 52 },
  { key: "origem",    label: "Origem",    w: 80 },
  { key: "documento", label: "Doc.",      w: 96 },
  { key: "cliente",   label: "CLIENTE",   w: 230 },
  { key: "projeto",   label: "Projeto",   w: 200 },
  { key: "categoria", label: "Categoria", w: 110 },
  { key: "valor",     label: "Valor",     tipo: "money", w: 120 },
];
type Payload = {
  total_periodo: number; total_ytd: number; total_mes: number;
  qtd_notas: number; qtd_notas_ytd: number;
  mensal: Array<Record<string, unknown>>;
  categorias: string[];
  dso: { media: number | null; faixas: Faixa[] };
  concedido: { media: number | null; faixas: Faixa[] };
  top: Array<{ chave: string; valor: number; qtd: number }>;
  dim: string;
  detalhe: FatRow[];
};

export default function FaturamentoBiView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
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
  }, [range.from, range.to, empresas, cats, dim]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
    { key: "cat", label: "Categoria de venda", options: CATS, selected: cats },
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

  return (
    <div className="space-y-4 min-w-0">
      <VizFilters
        range={range}
        onRangeChange={setRange}
        dims={dims}
        onDimChange={(k, sel) => (k === "empresa" ? setEmpresas(sel) : setCats(sel))}
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
        <VizBar rows={data?.mensal ?? []} series={mixSeries} stacked valueFormat={brl} />
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

      <VizTable
        title="Detalhe de faturamento"
        subtitle="Notas emitidas no período — mesma lista do card do Metabase"
        cols={COLS_FAT}
        rows={data?.detalhe ?? []}
        ordemInicial="dt_fat"
        loading={loading}
        altura={460}
        totalizar={["valor"]}
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
