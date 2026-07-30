"use client";

// As 5 abas restantes. Compartilham um fetch só (/api/bi/panorama) porque são
// telas pequenas sobre a mesma janela de filtro — abrir 5 endpoints pra isso
// seria 5 round-trips pro mesmo dado.
//
// Cada aba exporta seu próprio componente; o hook comum carrega uma vez.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Payload = {
  saldo: { valor: number; referencia: string | null; origem: string | null };
  ciclo: Array<{ etapa: string; ord: number; dias: number }>;
  ar: {
    saldo_aberto: number; em_atraso: number; a_vencer: number; qtd: number;
    aging: Array<{ faixa: string; ord: number; qtd: number; valor: number }>;
  };
  clientes_atraso: Array<{ cliente: string; cnpj: string; dias: number; valor: number; titulos: number }>;
  previsao: Array<{ x: string; valor: number; titulos: number }>;
  aquisicao: { rows: Array<Record<string, unknown>>; tipos: string[] };
  rentabilidade: Array<{ cliente: string; faturamento: number; compras: number; despesas: number;
                         mao_obra: number; rentabilidade: number; margem: number | null }>;
};

function usePanorama() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      const r = await fetch(`/api/bi/panorama?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, empresas]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
  ];
  const filtros = (
    <VizFilters range={range} onRangeChange={setRange} dims={dims}
                onDimChange={(_, sel) => setEmpresas(sel)} />
  );
  const erro = err ? (
    <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[12px]">
      <strong>Erro:</strong> {err}
    </div>
  ) : null;

  return { data, loading, filtros, erro };
}

// ── Visão Geral (aba raiz) ───────────────────────────────────────────────
export function PanoramaGeralView() {
  const { data, loading, filtros, erro } = usePanorama();
  const cicloSeries: SeriesDef[] = [{ key: "dias", label: "Dias", slot: 0, mark: "rect" }];
  const cicloRows = (data?.ciclo ?? []).map((c) => ({ x: c.etapa, dias: c.dias }));

  return (
    <div className="space-y-3 min-w-0">
      {filtros}{erro}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Saldo em caixa" value={data ? brl(data.saldo.valor) : "—"}
                  hint={data?.saldo.referencia
                    ? `${data.saldo.origem} · ${String(data.saldo.referencia).split("-").reverse().join("/")}`
                    : undefined} />
        <StatTile label="A receber aberto" value={data ? brl(data.ar.saldo_aberto) : "—"}
                  hint={data ? `${data.ar.qtd} títulos` : undefined} />
        <StatTile label="A receber em atraso" value={data ? brl(data.ar.em_atraso) : "—"}
                  higherIsBetter={false}
                  hint={data ? `${data.clientes_atraso.length} clientes` : undefined} />
        <StatTile label="A receber a vencer" value={data ? brl(data.ar.a_vencer) : "—"} />
      </div>

      <ChartFrame
        title="Ciclo financeiro — prazos médios"
        subtitle="Quanto tempo entre faturar, receber e pagar"
        series={cicloSeries} rows={cicloRows}
        valueFormat={(v) => `${Number(v).toFixed(1)} dias`} loading={loading} height={220}
      >
        <VizBar rows={cicloRows} series={cicloSeries} layout="row" categoryWidth={280}
                valueFormat={(v) => `${v.toFixed(1)}d`} />
      </ChartFrame>
    </div>
  );
}

// ── Atraso ───────────────────────────────────────────────────────────────
export function AtrasoView() {
  const { data, loading, filtros, erro } = usePanorama();
  const agingSeries: SeriesDef[] = [{ key: "valor", label: "Em atraso", slot: 7, mark: "rect" }];
  // Só as faixas realmente vencidas — "A vencer" e "Vence hoje" não são atraso.
  const agingRows = (data?.ar.aging ?? []).filter((a) => a.ord >= 3)
    .map((a) => ({ x: a.faixa, valor: a.valor, qtd: a.qtd }));
  const clientesSeries: SeriesDef[] = [{ key: "valor", label: "Valor em atraso", slot: 7, mark: "rect" }];
  const clientesRows = (data?.clientes_atraso ?? [])
    .map((c) => ({ x: c.cliente, valor: c.valor, dias: c.dias, titulos: c.titulos }));

  return (
    <div className="space-y-3 min-w-0">
      {filtros}{erro}
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Total em atraso" value={data ? brl(data.ar.em_atraso) : "—"}
                  higherIsBetter={false} />
        <StatTile label="Clientes em atraso" value={data ? String(data.clientes_atraso.length) : "—"}
                  hint={data?.clientes_atraso[0] ? `Maior: ${data.clientes_atraso[0].cliente}` : undefined}
                  higherIsBetter={false} />
      </div>

      <ChartFrame
        title="Em atraso por faixa"
        subtitle="Só faixas vencidas — 'a vencer' não é atraso"
        series={agingSeries} rows={agingRows}
        valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={240}
      >
        <VizBar rows={agingRows} series={agingSeries} valueFormat={brl} />
      </ChartFrame>

      <ChartFrame
        title="Clientes em atraso"
        subtitle={`${data?.clientes_atraso.length ?? 0} clientes com título vencido`}
        series={clientesSeries} rows={clientesRows}
        valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={420}
      >
        <VizBar rows={clientesRows} series={clientesSeries} layout="row" valueFormat={brl} />
      </ChartFrame>
    </div>
  );
}

// ── Previsão de recebimento ──────────────────────────────────────────────
export function PrevisaoRecebView() {
  const { data, loading, filtros, erro } = usePanorama();
  const series: SeriesDef[] = [{ key: "valor", label: "Previsto", slot: 2, mark: "rect" }];
  const total = (data?.previsao ?? []).reduce((a, p) => a + p.valor, 0);

  return (
    <div className="space-y-3 min-w-0">
      {filtros}{erro}
      <div className="grid grid-cols-2 gap-3">
        <StatTile label="Previsto nas próximas 12 semanas" value={brl(total)} />
        <StatTile label="Semanas com recebimento"
                  value={String((data?.previsao ?? []).filter((p) => p.valor > 0).length)} />
      </div>
      <ChartFrame
        title="Previsão de recebimento — semanal"
        subtitle="Títulos abertos agrupados pela semana da data de previsão"
        series={series} rows={data?.previsao ?? []}
        valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={280}
      >
        <VizBar rows={data?.previsao ?? []} series={series} valueFormat={brl} />
      </ChartFrame>
    </div>
  );
}

// ── Aquisição vs Recorrente ──────────────────────────────────────────────
export function AquisicaoView() {
  const { data, loading, filtros, erro } = usePanorama();
  const series: SeriesDef[] = (data?.aquisicao.tipos ?? [])
    .map((t, i) => ({ key: t, label: t, slot: i, mark: "rect" }));

  return (
    <div className="space-y-3 min-w-0">
      {filtros}{erro}
      <ChartFrame
        title="Aquisição vs recorrente — 18 meses"
        subtitle="Novo Contrato e Novo BOT são aquisição; Recorrente MRR/BOT é base instalada"
        series={series} rows={data?.aquisicao.rows ?? []}
        valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={340}
      >
        <VizBar rows={data?.aquisicao.rows ?? []} series={series} stacked valueFormat={brl} />
      </ChartFrame>
    </div>
  );
}

// ── Rentabilidade por cliente ────────────────────────────────────────────
export function RentabilidadeView() {
  const { data, loading, filtros, erro } = usePanorama();
  const series: SeriesDef[] = [{ key: "rentabilidade", label: "Rentabilidade", slot: 0, mark: "rect" }];
  const rows = (data?.rentabilidade ?? []).map((r) => ({
    x: r.cliente, rentabilidade: r.rentabilidade, faturamento: r.faturamento,
    compras: r.compras, margem: r.margem,
  }));
  const negativos = (data?.rentabilidade ?? []).filter((r) => r.rentabilidade < 0);
  const totalRent = (data?.rentabilidade ?? []).reduce((a, r) => a + r.rentabilidade, 0);
  const totalFat = (data?.rentabilidade ?? []).reduce((a, r) => a + r.faturamento, 0);

  return (
    <div className="space-y-3 min-w-0">
      {filtros}{erro}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatTile label="Rentabilidade total" value={brl(totalRent)} />
        <StatTile label="Margem média"
                  value={totalFat > 0 ? `${((totalRent / totalFat) * 100).toFixed(1)}%` : "—"} />
        <StatTile label="Clientes no prejuízo" value={String(negativos.length)}
                  hint={negativos[0] ? `Pior: ${negativos[0].cliente}` : undefined}
                  higherIsBetter={false} />
      </div>
      <ChartFrame
        title="Rentabilidade por cliente"
        subtitle="Faturamento − compras − despesas − mão de obra. Detalhe na tabela."
        series={[
          { key: "rentabilidade", label: "Rentabilidade", slot: 0, mark: "rect" },
          { key: "faturamento",   label: "Faturamento",   slot: 1, mark: "rect" },
          { key: "compras",       label: "Compras",       slot: 2, mark: "rect" },
        ]}
        rows={rows}
        valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={460}
      >
        <VizBar rows={rows.slice(0, 20)} series={series} layout="row" valueFormat={brl} />
      </ChartFrame>
    </div>
  );
}
