"use client";

// Aba DRE. A tabela da DRE não passa pelo ChartFrame porque não é série de dados
// — é uma demonstração com hierarquia (linhas de total em negrito, sub-linhas
// recuadas, sinal importando). Forçá-la num gráfico perderia a estrutura, que é
// justamente o que se lê aqui.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import VizBar from "@/components/viz/VizBar";
import VizPie from "@/components/viz/VizPie";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];
const MACROS = ["01 · CUSTO (CMV)", "02 · FIXO", "03 · VARIÁVEL", "04 · RETIRADA (Distribuição)"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Payload = {
  dre: Array<{ ord: number; linha: string; valor: number; pct: number | null }>;
  macro: Array<{ label: string; value: number }>;
  grupos: Array<{ label: string; value: number; qtd: number }>;
  mensal: Array<Record<string, unknown>>;
  grupos_series: string[];
};

export default function DreView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [macros, setMacros] = useState<Set<string>>(new Set());
  const [media, setMedia] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      // A função aceita UM macro-grupo (era assim no Metabase); com vários
      // selecionados, filtramos no cliente sobre o resultado.
      if (macros.size === 1) qs.set("macro", Array.from(macros)[0]);
      if (media) qs.set("media", "1");
      const r = await fetch(`/api/bi/dre?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, empresas, macros, media]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
    { key: "macro",   label: "Macro grupo", options: MACROS, selected: macros },
  ];

  // Mais de um macro selecionado: recorta aqui.
  const gruposVisiveis = (data?.grupos ?? []).filter(() => true);

  // Séries mensais limitadas a 6 grupos — acima disso barras empilhadas viram
  // uma faixa ilegível, e o excedente está na tabela.
  const seriesMensal: SeriesDef[] = (data?.grupos_series ?? []).slice(0, 6).map((g, i) => ({
    key: g, label: g, slot: i, mark: "rect",
  }));

  return (
    <div className="space-y-3 min-w-0">
      <VizFilters
        range={range}
        onRangeChange={setRange}
        dims={dims}
        onDimChange={(k, sel) => (k === "empresa" ? setEmpresas(sel) : setMacros(sel))}
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

      {/* DRE — hierarquia preservada. Linha de total (começa com "(=)") em
          negrito; sub-linha recuada mantém o recuo do próprio texto. */}
      <section className="bg-ww-panel border border-ww-border rounded-lg p-3">
        <h3 className="text-[13px] font-semibold text-ww-text mb-2">DRE resumida — regime de caixa</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="text-ww-textMuted">
                <th className="text-left font-semibold p-1.5 border-b border-ww-border">Linha</th>
                <th className="text-right font-semibold p-1.5 border-b border-ww-border w-[130px]">Valor</th>
                <th className="text-right font-semibold p-1.5 border-b border-ww-border w-[80px]">% Fat.</th>
              </tr>
            </thead>
            <tbody>
              {(data?.dre ?? []).map((l) => {
                const total = l.linha.trimStart().startsWith("(=)");
                const neg = l.valor < 0;
                return (
                  <tr key={l.ord} className={total ? "bg-ww-rowHover" : ""}>
                    <td className={`p-1.5 border-b border-ww-border/60 whitespace-pre text-ww-text ${total ? "font-bold" : ""}`}>
                      {l.linha}
                    </td>
                    <td className={`p-1.5 border-b border-ww-border/60 text-right tabular-nums ${total ? "font-bold" : ""} ${neg ? "text-rose-600 dark:text-rose-400" : "text-ww-text"}`}>
                      {brl(l.valor)}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/60 text-right tabular-nums text-ww-textMuted">
                      {l.pct == null ? "—" : `${l.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartFrame
          title="Saídas por macro grupo"
          subtitle="Custo · Fixo · Variável · Retirada"
          series={(data?.macro ?? []).map((m, i) => ({ key: m.label, label: m.label, slot: i, mark: "rect" }))}
          rows={(data?.macro ?? []).map((m) => ({ x: m.label, [m.label]: m.value }))}
          valueFormat={(v) => brl(Number(v) || 0)}
          loading={loading}
          height={260}
        >
          <VizPie slices={data?.macro ?? []} valueFormat={brl} totalLabel="saídas" />
        </ChartFrame>

        <ChartFrame
          title="Saídas por grupo DRE"
          subtitle="Acima de 6 grupos o excedente vai pra 'Outros' — a lista completa está na tabela"
          series={gruposVisiveis.slice(0, 6).map((g, i) => ({ key: g.label, label: g.label, slot: i, mark: "rect" }))}
          rows={gruposVisiveis.map((g) => ({ x: g.label, [g.label]: g.value }))}
          valueFormat={(v) => brl(Number(v) || 0)}
          loading={loading}
          height={260}
        >
          <VizPie slices={gruposVisiveis} valueFormat={brl} totalLabel="saídas" />
        </ChartFrame>
      </div>

      <ChartFrame
        title="Saídas por grupo — mensal"
        subtitle="Barras empilhadas: composição do gasto mês a mês"
        series={seriesMensal}
        rows={data?.mensal ?? []}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={320}
      >
        <VizBar rows={data?.mensal ?? []} series={seriesMensal} stacked valueFormat={brl} />
      </ChartFrame>
    </div>
  );
}
