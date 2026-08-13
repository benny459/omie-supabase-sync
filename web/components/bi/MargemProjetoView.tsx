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

type Proj = {
  projeto: string; receita: number; custo: number; margem: number;
  margem_pct: number | null; tem_custo: boolean;
};
type Payload = {
  margem_total: number;
  projetos: Proj[];          // só quem tem custo vinculado — os gráficos vivem daqui
  prejuizo: Proj[];
  total_projetos: number;
  sem_custo: { projetos: Proj[]; total: number; receita: number };
  cobertura: {
    titulos: number; titulos_com_projeto: number;
    valor: number; valor_com_projeto: number; pct_valor: number | null;
  } | null;
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

  // Slot 3 (âmbar) e não o verde da margem: é alerta de cadastro, não resultado.
  const semCustoRows = (data?.sem_custo.projetos ?? []).slice(0, 15)
    .map((p) => ({ x: p.projeto, receita: p.receita }));
  const semCustoSeries: SeriesDef[] = [{ key: "receita", label: "Receita sem custo", slot: 3, mark: "rect" }];

  const tabSeries: SeriesDef[] = [
    { key: "receita", label: "Receita", slot: 0, mark: "rect" },
    { key: "custo",   label: "Custo",   slot: 1, mark: "rect" },
    { key: "margem",  label: "Margem",  slot: 2, mark: "rect" },
  ];

  return (
    <div className="space-y-4 min-w-0">
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

      {/* O aviso vem ANTES dos números. Com 30% de cobertura, ler a margem por
          projeto sem saber disso é pior do que não ler. */}
      {data && data.sem_custo.total > 0 && (
        <div className="p-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-[12px] text-amber-900 dark:text-amber-100">
          <strong>{data.sem_custo.total} projetos sem custo vinculado</strong>
          {" "}({brl(data.sem_custo.receita)} de receita) estão fora dos gráficos abaixo.
          {data.cobertura?.pct_valor != null && (
            <> Apenas <strong>{data.cobertura.pct_valor.toString().replace(".", ",")}%</strong> do
            valor a pagar do período carrega código de projeto
            {" "}({brl(data.cobertura.valor_com_projeto)} de {brl(data.cobertura.valor)}).</>
          )}
          {" "}Sem título a pagar apontando pro projeto, a margem dele seria a receita
          inteira — resultado de cadastro faltando, não de lucro.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatTile
          label={media ? "Margem — média mensal" : "Margem total no período"}
          value={data ? brl(data.margem_total) : "—"}
          hint="Receita (itens vendidos + OS faturadas) − títulos a pagar, no total da empresa"
        />
        <StatTile
          label="Projetos com custo vinculado"
          value={data ? String(data.total_projetos) : "—"}
          hint="os únicos em que a margem é calculável"
        />
        <StatTile
          label="Sem custo vinculado"
          value={data ? String(data.sem_custo.total) : "—"}
          hint={data ? `${brl(data.sem_custo.receita)} de receita sem contrapartida` : undefined}
          higherIsBetter={false}
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
        subtitle="Só projetos com custo vinculado. Barra horizontal porque nome de projeto é longo; a lista completa está na tabela."
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
        subtitle={`${data?.projetos.length ?? 0} projetos com custo vinculado`}
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

      {/* A lista acionável: onde ligar custo renderia mais informação. Ordenada
          por receita, porque é ali que a margem desconhecida custa mais caro. */}
      {data && data.sem_custo.total > 0 && (
        <ChartFrame
          title="Projetos sem custo vinculado — 15 maiores por receita"
          subtitle="Receita sem nenhum título a pagar apontando pro projeto. Não é margem: é margem desconhecida."
          series={semCustoSeries}
          rows={semCustoRows}
          valueFormat={(v) => brl(Number(v) || 0)}
          loading={loading}
          height={360}
        >
          <VizBar rows={semCustoRows} series={semCustoSeries} layout="row" valueFormat={(v) => brl(v)} />
        </ChartFrame>
      )}
    </div>
  );
}
