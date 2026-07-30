"use client";

// Dashboard "Contratos CT" portado. Usa VizLine (criado vs faturado no tempo) e
// VizBar horizontal (ranking de contratos — nome de CT é longo).
//
// Criado e faturado compartilham unidade (R$), então convivem num eixo só sem
// truque. Foi o card que no Metabase era `line` com duas séries — esse não
// precisou de redesenho; os problemáticos são os `combo` com eixo direito.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizLine from "@/components/viz/VizLine";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Payload = {
  faturado_lifetime: number;
  faturado_periodo: number;
  contratos_ativos: number;
  top: Array<{ contrato: string; receita: number }>;
  mensal: Array<{ mes: string; criado: number; faturado: number; qtd: number }>;
  ultima_sync: string | null;
};

export default function ContratosCtView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [media, setMedia] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      if (media) qs.set("media", "1");
      const r = await fetch(`/api/bi/contratos-ct?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, empresas, media]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
  ];

  const mensalSeries: SeriesDef[] = [
    { key: "criado",   label: "Criado (OS)",  slot: 0, mark: "line" },
    { key: "faturado", label: "Faturado",     slot: 2, mark: "line" },
  ];
  const mensalRows = (data?.mensal ?? []).map((m) => ({ x: m.mes, criado: m.criado, faturado: m.faturado }));

  const topSeries: SeriesDef[] = [{ key: "receita", label: "Receita lifetime", slot: 0, mark: "rect" }];
  const topRows = (data?.top ?? []).map((t) => ({ x: t.contrato, receita: t.receita }));

  const sync = data?.ultima_sync
    ? new Date(data.ultima_sync).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })
    : null;

  return (
    <div className="space-y-4 min-w-0">
      <VizFilters
        range={range}
        onRangeChange={setRange}
        dims={dims}
        onDimChange={(_, sel) => setEmpresas(sel)}
        right={
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-[11.5px] text-ww-textMuted cursor-pointer">
              <input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} />
              Média mensal
            </label>
            {sync && <span className="text-[10.5px] text-ww-textFaint">sync {sync}</span>}
          </div>
        }
      />

      {err && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[12px]">
          <strong>Erro:</strong> {err}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile
          label="Faturamento lifetime"
          value={data ? brl(data.faturado_lifetime) : "—"}
          hint="Todos os títulos a receber em categoria contratual (1.01.01)"
        />
        <StatTile
          label={media ? "Faturado — média mensal" : "Faturado no período"}
          value={data ? brl(data.faturado_periodo) : "—"}
        />
        <StatTile
          label="Contratos ativos"
          value={data ? String(data.contratos_ativos) : "—"}
          hint="Projetos cujo nome começa com CT"
        />
      </div>

      <ChartFrame
        title="Criado vs faturado por mês"
        subtitle="Ambos em R$, então um eixo só — sem eixo duplo."
        series={mensalSeries}
        rows={mensalRows}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={280}
      >
        <VizLine rows={mensalRows} series={mensalSeries} valueFormat={(v) => brl(v)} />
      </ChartFrame>

      <ChartFrame
        title="Top contratos por receita lifetime"
        subtitle={`${data?.top.length ?? 0} contratos com receita`}
        series={topSeries}
        rows={topRows}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={420}
      >
        <VizBar rows={topRows.slice(0, 18)} series={topSeries} layout="row" valueFormat={(v) => brl(v)} />
      </ChartFrame>
    </div>
  );
}
