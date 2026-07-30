"use client";

// Aba "Compras". Sufixo Bi porque já existe ComprasPorClienteView, que responde
// outra pergunta (rateio de compra por cliente).
//
// Compras aqui = títulos a pagar em 2.01.% (CMV / custo direto). Não é o mesmo
// que "tudo que sai" — o resto das saídas está na aba DRE, classificado por
// grupo. Misturar os dois dá dupla contagem.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Item = { chave: string; valor: number; qtd: number };
type Payload = {
  total: number; qtd: number;
  mensal: Array<Record<string, unknown>>; categorias: string[];
  projetos: Item[]; fornecedores: Item[];
};

export default function ComprasBiView() {
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
      const r = await fetch(`/api/bi/compras?${qs}`, { cache: "no-store" });
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

  const catSeries: SeriesDef[] = (data?.categorias ?? []).slice(0, 6)
    .map((c, i) => ({ key: c, label: c, slot: i, mark: "rect" }));
  const projSeries: SeriesDef[] = [{ key: "valor", label: "Comprado", slot: 0, mark: "rect" }];
  const fornSeries: SeriesDef[] = [{ key: "valor", label: "Pago", slot: 1, mark: "rect" }];

  return (
    <div className="space-y-4 min-w-0">
      <VizFilters range={range} onRangeChange={setRange} dims={dims}
                  onDimChange={(_, sel) => setEmpresas(sel)} />

      {err && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[12px]">
          <strong>Erro:</strong> {err}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatTile label="Comprado no período" value={data ? brl(data.total) : "—"}
                  hint={data ? `${data.qtd} títulos em CMV (2.01)` : undefined} />
        <StatTile label="Projetos com compra" value={data ? String(data.projetos.length) : "—"} />
        <StatTile label="Fornecedores pagos" value={data ? String(data.fornecedores.length) : "—"} />
      </div>

      <ChartFrame
        title="Compras mensais por grupo"
        subtitle="Somente CMV / custo direto (2.01) — o resto das saídas está na aba DRE"
        series={catSeries} rows={data?.mensal ?? []}
        valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={300}
      >
        <VizBar rows={data?.mensal ?? []} series={catSeries} stacked valueFormat={brl} />
      </ChartFrame>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartFrame
          title="Compras por projeto"
          series={projSeries}
          rows={data?.projetos.map((p) => ({ x: p.chave, valor: p.valor, qtd: p.qtd })) ?? []}
          valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={400}
        >
          <VizBar rows={data?.projetos.map((p) => ({ x: p.chave, valor: p.valor })) ?? []}
                  series={projSeries} layout="row" valueFormat={brl} />
        </ChartFrame>

        <ChartFrame
          title="Top fornecedores pagos"
          series={fornSeries}
          rows={data?.fornecedores.map((f) => ({ x: f.chave, valor: f.valor, qtd: f.qtd })) ?? []}
          valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={400}
        >
          <VizBar rows={data?.fornecedores.map((f) => ({ x: f.chave, valor: f.valor })) ?? []}
                  series={fornSeries} layout="row" valueFormat={brl} />
        </ChartFrame>
      </div>
    </div>
  );
}
