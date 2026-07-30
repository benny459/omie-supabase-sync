"use client";

// Primeiro dashboard portado do Metabase. Serve de MOLDE pros outros 7:
// filtros numa linha acima escopando tudo · StatTile pro scalar · VizBar
// horizontal pro ranking (nome de projeto é comprido, barra vertical não caberia)
// · ChartFrame com toggle de tabela cobrindo o alívio de contraste.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Proj = { projeto: string; receita: number; custo: number; margem: number; margem_pct: number | null };
type Payload = {
  margem_total: number;
  projetos: Proj[];
  prejuizo: Proj[];
  total_projetos: number;
};

export default function MargemProjetoView() {
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
      const r = await fetch(`/api/bi/margem-projeto?${qs}`, { cache: "no-store" });
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

  // Ranking: 15 primeiros. Acima disso a barra fica fina e o nome ilegível — o
  // resto está na tabela, que é o lugar certo pra lista longa.
  const rankRows = (data?.projetos ?? []).slice(0, 15).map((p) => ({ x: p.projeto, margem: p.margem }));
  const rankSeries: SeriesDef[] = [{ key: "margem", label: "Margem", slot: 0, mark: "rect" }];

  const tabSeries: SeriesDef[] = [
    { key: "receita", label: "Receita", slot: 0, mark: "rect" },
    { key: "custo",   label: "Custo",   slot: 1, mark: "rect" },
    { key: "margem",  label: "Margem",  slot: 2, mark: "rect" },
  ];

  return (
    <div className="space-y-3 min-w-0">
      <VizFilters
        range={range}
        onRangeChange={setRange}
        dims={dims}
        onDimChange={(_, sel) => setEmpresas(sel)}
        right={
          <label className="inline-flex items-center gap-1.5 text-[11.5px] text-ww-textMuted cursor-pointer">
            <input type="checkbox" checked={media} onChange={(e) => setMedia(e.target.checked)} />
            Média mensal
          </label>
        }
      />

      {err && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[12px]">
          <strong>Erro:</strong> {err}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatTile
          label={media ? "Margem — média mensal" : "Margem total no período"}
          value={data ? brl(data.margem_total) : "—"}
          hint="Receita (itens vendidos + OS faturadas) − títulos a pagar"
        />
        <StatTile
          label="Projetos com receita"
          value={data ? String(data.total_projetos) : "—"}
        />
        <StatTile
          label="Projetos no prejuízo"
          value={data ? String(data.prejuizo.length) : "—"}
          hint={data?.prejuizo.length ? `Pior: ${data.prejuizo[0].projeto}` : undefined}
          higherIsBetter={false}
        />
      </div>

      <ChartFrame
        title="Margem por projeto — 15 maiores"
        subtitle="Barra horizontal porque nome de projeto é longo. A lista completa está na tabela."
        series={rankSeries}
        rows={rankRows}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={360}
      >
        <VizBar rows={rankRows} series={rankSeries} layout="row" valueFormat={(v) => brl(v)} />
      </ChartFrame>

      <ChartFrame
        title="Receita, custo e margem por projeto"
        subtitle={`${data?.projetos.length ?? 0} projetos no período`}
        series={tabSeries}
        rows={(data?.projetos ?? []).map((p) => ({ x: p.projeto, ...p }))}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={320}
      >
        <VizBar
          rows={(data?.projetos ?? []).slice(0, 15).map((p) => ({ x: p.projeto, receita: p.receita, custo: p.custo }))}
          series={tabSeries.slice(0, 2)}
          layout="row"
          valueFormat={(v) => brl(v)}
        />
      </ChartFrame>
    </div>
  );
}
