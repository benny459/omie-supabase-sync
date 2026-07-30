"use client";

// Aba/página "A Pagar".
//
// A diferença mais importante em relação ao Metabase está no topo: o card
// "Total Aberto" de lá somava R$ 24,3 milhões sem nenhum limite de data —
// misturando o que está vencido com parcelas contratadas até 2050. Aqui o saldo
// vem quebrado por horizonte, porque "o que devo agora" e "o que contratei pros
// próximos 24 anos" são perguntas diferentes e a soma das duas não serve pra
// decidir nada.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizLine from "@/components/viz/VizLine";
import VizPie from "@/components/viz/VizPie";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Payload = {
  saldo_aberto: number; qtd_titulos: number; total_pago_ano: number;
  horizonte: {
    dias: number; vencido: number; no_horizonte: number; futuro: number; sem_data: number;
    qtd_vencido: number; qtd_no_horizonte: number; qtd_futuro: number;
  };
  aging: Array<{ faixa: string; ord: number; qtd: number; valor: number }>;
  mensal: Array<{ x: string; emitido: number; pago: number }>;
  grupos: Array<{ label: string; value: number; macro: string }>;
  top: Array<{ chave: string; valor: number; qtd: number }>;
};

export default function ContasPagarView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [horizonte, setHorizonte] = useState(90);
  const [base, setBase] = useState<"previsao" | "vencimento">("previsao");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to, base, horizonte: String(horizonte) });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      const r = await fetch(`/api/bi/contas-pagar?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, empresas, horizonte, base]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
  ];

  const agingSeries: SeriesDef[] = [{ key: "valor", label: "Valor aberto", slot: 0, mark: "rect" }];
  const agingRows = (data?.aging ?? []).map((a) => ({ x: a.faixa, valor: a.valor, qtd: a.qtd }));

  const mensalSeries: SeriesDef[] = [
    { key: "emitido", label: "Emitido", slot: 0, mark: "line" },
    { key: "pago",    label: "Pago",    slot: 2, mark: "line" },
  ];

  const topSeries: SeriesDef[] = [{ key: "valor", label: "Pago no período", slot: 1, mark: "rect" }];
  const topRows = (data?.top ?? []).map((t) => ({ x: t.chave, valor: t.valor, qtd: t.qtd }));

  const h = data?.horizonte;
  const acionavel = h ? h.vencido + h.no_horizonte : 0;

  return (
    <div className="space-y-4 min-w-0">
      <VizFilters
        range={range}
        onRangeChange={setRange}
        dims={dims}
        onDimChange={(_, sel) => setEmpresas(sel)}
        right={
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-ww-textMuted">horizonte</label>
            <select
              value={horizonte}
              onChange={(e) => setHorizonte(Number(e.target.value))}
              className="text-[11px] bg-ww-panel border border-ww-border rounded px-1.5 py-0.5 text-ww-text"
            >
              {[30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>{d} dias</option>)}
            </select>
            <select
              value={base}
              onChange={(e) => setBase(e.target.value as "previsao" | "vencimento")}
              className="text-[11px] bg-ww-panel border border-ww-border rounded px-1.5 py-0.5 text-ww-text"
            >
              <option value="previsao">por previsão</option>
              <option value="vencimento">por vencimento</option>
            </select>
          </div>
        }
      />

      {err && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[12px]">
          <strong>Erro:</strong> {err}
        </div>
      )}

      {/* O aviso existe porque o número equivalente no Metabase somava tudo. */}
      {h && h.futuro > 0 && (
        <p className="text-[11px] text-ww-textMuted bg-ww-rowHover border border-ww-border rounded-md px-2 py-1.5">
          Saldo aberto total é {brl(data!.saldo_aberto)} em {data!.qtd_titulos} títulos, mas{" "}
          <strong>{brl(h.futuro)}</strong> ({h.qtd_futuro} títulos) são parcelas contratadas além de{" "}
          {h.dias} dias. O acionável hoje é {brl(acionavel)}.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Vencido" value={h ? brl(h.vencido) : "—"}
                  hint={h ? `${h.qtd_vencido} títulos` : undefined} higherIsBetter={false} />
        <StatTile label={`Vence em ${h?.dias ?? 90} dias`} value={h ? brl(h.no_horizonte) : "—"}
                  hint={h ? `${h.qtd_no_horizonte} títulos` : undefined} />
        <StatTile label="Futuro contratado" value={h ? brl(h.futuro) : "—"}
                  hint={h ? `${h.qtd_futuro} parcelas além do horizonte` : undefined} />
        <StatTile label="Pago no ano" value={data ? brl(data.total_pago_ano) : "—"} />
      </div>

      <ChartFrame
        title="Aging dos títulos a pagar"
        subtitle={`Referência: ${base === "previsao" ? "data de previsão" : "data de vencimento"}`}
        series={agingSeries} rows={agingRows}
        valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={260}
      >
        <VizBar rows={agingRows} series={agingSeries} valueFormat={brl} />
      </ChartFrame>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartFrame
          title="Emitido vs pago por mês"
          subtitle="Ambos em R$ — um eixo só. No Metabase eram combos de eixo duplo."
          series={mensalSeries} rows={data?.mensal ?? []}
          valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={280}
        >
          <VizLine rows={data?.mensal ?? []} series={mensalSeries} valueFormat={brl} />
        </ChartFrame>

        <ChartFrame
          title="Saídas por grupo DRE"
          subtitle="Mesma classificação da aba DRE — uma fonte só"
          series={(data?.grupos ?? []).slice(0, 6).map((g, i) => ({ key: g.label, label: g.label, slot: i, mark: "rect" }))}
          rows={(data?.grupos ?? []).map((g) => ({ x: g.label, [g.label]: g.value }))}
          valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={280}
        >
          <VizPie slices={data?.grupos ?? []} valueFormat={brl} totalLabel="emitido" />
        </ChartFrame>
      </div>

      <ChartFrame
        title="Top fornecedores pagos no período"
        series={topSeries} rows={topRows}
        valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={400}
      >
        <VizBar rows={topRows} series={topSeries} layout="row" valueFormat={brl} />
      </ChartFrame>
    </div>
  );
}
