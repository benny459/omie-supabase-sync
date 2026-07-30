"use client";

// Aba "Vendas". PV+OS unificados na categoria 1.01.
//
// Dois combos do Metabase desdobrados aqui, pela sua decisão: "PV vs OS —
// Mensal" e "Quantidade PV/OS por Categoria — Mês × Média YTD" tinham série no
// eixo direito. Viraram gráficos separados — valor em R$ num, composição por
// tipo noutro. As medidas não compartilhavam escala.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizPie from "@/components/viz/VizPie";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];
const CATS = ["Contratuais", "Projetos", "Revenda", "Avulsos", "BOT/SW", "Outras"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Pend = { tipo: string; numero: string; categoria: string; valor: number;
              dt_emissao: string; etapa: string; dias: number };
type Payload = {
  total_periodo: number; qtd_periodo: number;
  total_ytd: number; qtd_ytd: number;
  total_mes: number; qtd_mes: number;
  total_pv: number; total_os: number;
  mensal_categoria: Array<Record<string, unknown>>; categorias: string[];
  mensal_tipo: Array<Record<string, unknown>>; tipos: string[];
  pendentes: { qtd: number; valor: number;
               por_etapa: Array<{ label: string; value: number; qtd: number }>;
               lista: Pend[] };
};

export default function VendasView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      if (cats.size) qs.set("cat", Array.from(cats).join(","));
      const r = await fetch(`/api/bi/vendas?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, empresas, cats]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
    { key: "cat", label: "Categoria de venda", options: CATS, selected: cats },
  ];

  const catSeries: SeriesDef[] = (data?.categorias ?? []).slice(0, 6)
    .map((c, i) => ({ key: c, label: c, slot: i, mark: "rect" }));
  const tipoSeries: SeriesDef[] = (data?.tipos ?? [])
    .map((t, i) => ({ key: t, label: t === "PV" ? "Pedido de venda" : "Ordem de serviço", slot: i, mark: "rect" }));

  const mixPv = data ? data.total_pv + data.total_os : 0;

  return (
    <div className="space-y-4 min-w-0">
      <VizFilters
        range={range} onRangeChange={setRange} dims={dims}
        onDimChange={(k, sel) => (k === "empresa" ? setEmpresas(sel) : setCats(sel))}
      />

      {err && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[12px]">
          <strong>Erro:</strong> {err}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Vendido no período" value={data ? brl(data.total_periodo) : "—"}
                  hint={data ? `${data.qtd_periodo} PV/OS` : undefined} />
        <StatTile label="Vendido YTD" value={data ? brl(data.total_ytd) : "—"}
                  hint={data ? `${data.qtd_ytd} PV/OS` : undefined} />
        <StatTile label="Vendido no mês" value={data ? brl(data.total_mes) : "—"}
                  hint={data ? `${data.qtd_mes} PV/OS` : undefined} />
        <StatTile label="Pendente de faturamento"
                  value={data ? brl(data.pendentes.valor) : "—"}
                  hint={data ? `${data.pendentes.qtd} PV/OS abertos` : undefined}
                  higherIsBetter={false} />
      </div>

      <ChartFrame
        title="Vendido mensal por categoria"
        subtitle="PV e OS somados, empilhados por categoria de venda"
        series={catSeries} rows={data?.mensal_categoria ?? []}
        valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={300}
      >
        <VizBar rows={data?.mensal_categoria ?? []} series={catSeries} stacked valueFormat={brl} />
      </ChartFrame>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Desdobramento do combo "PV vs OS — Mensal" */}
        <ChartFrame
          title="PV vs OS por mês"
          subtitle="Desdobrado do combo original — sem eixo duplo"
          series={tipoSeries} rows={data?.mensal_tipo ?? []}
          valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={280}
        >
          <VizBar rows={data?.mensal_tipo ?? []} series={tipoSeries} stacked valueFormat={brl} />
        </ChartFrame>

        <ChartFrame
          title="Mix PV × OS no período"
          subtitle={mixPv > 0 && data
            ? `OS representa ${((data.total_os / mixPv) * 100).toFixed(0)}% do vendido`
            : undefined}
          series={[
            { key: "PV", label: "Pedido de venda", slot: 0, mark: "rect" },
            { key: "OS", label: "Ordem de serviço", slot: 1, mark: "rect" },
          ]}
          rows={data ? [{ x: "período", PV: data.total_pv, OS: data.total_os }] : []}
          valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={280}
        >
          <VizPie
            slices={data ? [
              { label: "Pedido de venda", value: data.total_pv },
              { label: "Ordem de serviço", value: data.total_os },
            ] : []}
            valueFormat={brl} totalLabel="vendido"
          />
        </ChartFrame>
      </div>

      <ChartFrame
        title="Pendentes de faturamento — por etapa"
        subtitle="Etapa traduzida do código do Omie (50 = a faturar, 60/70 = fechado)"
        series={(data?.pendentes.por_etapa ?? []).map((e, i) => ({ key: e.label, label: e.label, slot: i, mark: "rect" }))}
        rows={(data?.pendentes.por_etapa ?? []).map((e) => ({ x: e.label, [e.label]: e.value }))}
        valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={260}
      >
        <VizPie slices={data?.pendentes.por_etapa ?? []} valueFormat={brl} totalLabel="pendente" />
      </ChartFrame>
    </div>
  );
}
