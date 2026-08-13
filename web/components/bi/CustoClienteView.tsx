"use client";

// Custo por cliente — despesas, combustível, pedágio e tempo, lidos direto do
// app de serviços.
//
// A tela responde três perguntas, nesta ordem:
//   1. quanto custa operar, e de que é feito esse custo      (tiles + pizza)
//   2. como isso evolui no tempo                              (barras mensais)
//   3. quanto custa CADA cliente, e sobra margem?             (tabela)
//
// A repartição do topo é o aviso mais importante da tela: parte do custo não
// pertence a cliente nenhum (overhead da empresa) e parte pertence a cliente que
// nunca foi vinculado ao Omie — esse segundo grupo tem custo e não tem receita
// pra comparar, então sumiria da conta de rentabilidade sem deixar rastro.

import { useCallback, useEffect, useMemo, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizPie from "@/components/viz/VizPie";
import VizTable, { type Col } from "@/components/viz/VizTable";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";
import MemorialCusto from "./MemorialCusto";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlExato = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

type LinhaCusto = {
  codigo: number | null; nome: string; is_bucket: boolean; sem_link: boolean;
  customer_ids: string[];
  diretas: number; combustivel: number; pedagio: number; mao_obra: number;
  custo_total: number; qtd_os: number; tecnicos: number;
  receita: number; compras: number;
  margem: number | null; margem_pct: number | null;
};

type Payload = {
  fonte: string;
  total: {
    diretas: number; combustivel: number; pedagio: number; mao_obra: number;
    custo_total: number; qtd_os: number; receita: number; clientes: number;
  };
  reparticao: { cliente_real: number; sem_link: number; buckets: number };
  tipos: Array<{ label: string; value: number }>;
  mensal: Array<{ x: string; diretas: number; combustivel: number; pedagio: number; mao_obra: number }>;
  linhas: LinhaCusto[];
  error?: string; hint?: string;
};

// "Origem" separa as três naturezas de linha. É badge e não só cor porque a
// distinção muda a leitura de tudo: bucket não tem receita por definição, e
// cliente sem link tem receita que existe mas não dá pra casar.
const COLS: Col<LinhaCusto & { origem: string }>[] = [
  { key: "nome",        label: "Cliente",     w: 250 },
  { key: "origem",      label: "Origem",      tipo: "badge", w: 118,
    tom: (v) => v === "Cliente" ? "ok" : v === "Sem link Omie" ? "alerta" : "neutro" },
  { key: "qtd_os",      label: "OS",          tipo: "num",   w: 62 },
  { key: "tecnicos",    label: "Téc.",        tipo: "num",   w: 58 },
  { key: "diretas",     label: "Despesas",    tipo: "money", w: 112 },
  { key: "combustivel", label: "Combustível", tipo: "money", w: 112 },
  { key: "pedagio",     label: "Pedágio",     tipo: "money", w: 96 },
  { key: "mao_obra",    label: "Mão de obra", tipo: "money", w: 112 },
  { key: "custo_total", label: "Custo total", tipo: "money", w: 118 },
  { key: "receita",     label: "Receita",     tipo: "money", w: 118 },
  { key: "margem",      label: "Margem",      tipo: "money", w: 118 },
  { key: "margem_pct",  label: "%",           w: 76,
    fmt: (v) => v == null ? "—"
      : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` },
];

export default function CustoClienteView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [tipos, setTipos] = useState<Set<string>>(new Set());
  const [soComReceita, setSoComReceita] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  /** Linha aberta na memória de cálculo. null = modal fechado. */
  const [memorial, setMemorial] = useState<{ nome: string; ids: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (tipos.size === 1) qs.set("tipo", Array.from(tipos)[0]);
      const r = await fetch(`/api/bi/custo-cliente?${qs}`, { cache: "no-store" });
      const j = (await r.json()) as Payload;
      if (!r.ok) { setErr(j.hint ? `${j.error} — ${j.hint}` : (j.error ?? r.statusText)); return; }
      setErr(null);
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, tipos]);

  useEffect(() => { void load(); }, [load]);

  const t = data?.total;
  const rep = data?.reparticao;

  const linhas = useMemo(() => {
    const base = (data?.linhas ?? []).map((l) => ({
      ...l,
      origem: l.is_bucket ? "Overhead" : l.sem_link ? "Sem link Omie" : "Cliente",
    }));
    return soComReceita ? base.filter((l) => l.receita > 0) : base;
  }, [data, soComReceita]);

  // Composição do custo: as quatro parcelas, cada uma um slot fixo.
  const composicao = t ? [
    { label: "Despesas diretas", value: t.diretas },
    { label: "Combustível",      value: t.combustivel },
    { label: "Mão de obra",      value: t.mao_obra },
    { label: "Pedágio",          value: t.pedagio },
  ].filter((x) => x.value > 0) : [];

  const mensalSeries: SeriesDef[] = [
    { key: "diretas",     label: "Despesas diretas", slot: 0, mark: "rect" },
    { key: "combustivel", label: "Combustível",      slot: 3, mark: "rect" },
    { key: "mao_obra",    label: "Mão de obra",      slot: 5, mark: "rect" },
    { key: "pedagio",     label: "Pedágio",          slot: 2, mark: "rect" },
  ];

  const dims: DimFilter[] = [
    { key: "tipo", label: "Tipo de venda",
      options: (data?.tipos ?? []).map((x) => x.label), selected: tipos },
  ];

  return (
    <div className="space-y-3">
      <VizFilters
        range={range} onRangeChange={setRange} dims={dims}
        onDimChange={(_, sel) => setTipos(sel)}
        right={
          <label className="flex items-center gap-1.5 text-[11px] text-ww-textMuted cursor-pointer">
            <input type="checkbox" checked={soComReceita}
                   onChange={(e) => setSoComReceita(e.target.checked)}
                   className="accent-ww-accent" />
            Só quem tem receita
          </label>
        }
      />

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl p-3 text-[12px]">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile label="Despesas diretas" value={t ? brl(t.diretas) : "—"}
                  hint="Lançadas na OS, já aprovadas" higherIsBetter={false} />
        <StatTile label="Combustível" value={t ? brl(t.combustivel) : "—"}
                  hint="Rateado por km rodado" higherIsBetter={false} />
        <StatTile label="Pedágio" value={t ? brl(t.pedagio) : "—"}
                  hint="Rateado por km rodado" higherIsBetter={false} />
        <StatTile label="Mão de obra" value={t ? brl(t.mao_obra) : "—"}
                  hint="Horas de OS × valor/hora do técnico" higherIsBetter={false} />
        <StatTile label="Custo total" value={t ? brl(t.custo_total) : "—"}
                  hint={t ? `${t.qtd_os.toLocaleString("pt-BR")} OS` : undefined}
                  higherIsBetter={false} />
        <StatTile label="Clientes atendidos" value={t ? String(t.clientes) : "—"}
                  hint="Com código Omie vinculado" />
      </div>

      {/* A repartição é o aviso central: nem todo custo pertence a um cliente. */}
      {rep && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
            <p className="text-[10.5px] uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
              Cliente identificado
            </p>
            <p className="text-[15px] font-bold text-ww-text mt-0.5">{brlExato(rep.cliente_real)}</p>
            <p className="text-[10.5px] text-ww-textMuted">entra na conta de rentabilidade</p>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <p className="text-[10.5px] uppercase tracking-wider text-amber-800 dark:text-amber-300">
              Sem vínculo com o Omie
            </p>
            <p className="text-[15px] font-bold text-ww-text mt-0.5">{brlExato(rep.sem_link)}</p>
            <p className="text-[10.5px] text-ww-textMuted">tem custo, mas não há receita pra comparar</p>
          </div>
          <div className="rounded-lg border border-ww-border bg-ww-rowHover px-3 py-2">
            <p className="text-[10.5px] uppercase tracking-wider text-ww-textMuted">Overhead</p>
            <p className="text-[15px] font-bold text-ww-text mt-0.5">{brlExato(rep.buckets)}</p>
            <p className="text-[10.5px] text-ww-textMuted">empresa, comercial, não atribuído</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartFrame
          title="De que é feito o custo"
          subtitle="As quatro parcelas que a origem calcula"
          series={composicao.map((c, i) => ({ key: c.label, label: c.label, slot: i, mark: "rect" as const }))}
          rows={composicao.map((c) => ({ x: c.label, [c.label]: c.value }))}
          valueFormat={(v) => brl(Number(v) || 0)}
          loading={loading}
          height={280}
        >
          <VizPie slices={composicao} valueFormat={brl} totalLabel="custo" />
        </ChartFrame>

        <ChartFrame
          title="Custo por tipo de venda"
          subtitle="Contrato, projeto, avulso, overhead"
          series={[{ key: "valor", label: "Custo", slot: 0, mark: "rect" }]}
          rows={(data?.tipos ?? []).map((x) => ({ x: x.label, valor: x.value }))}
          valueFormat={(v) => brl(Number(v) || 0)}
          loading={loading}
          height={280}
        >
          <VizBar rows={(data?.tipos ?? []).map((x) => ({ x: x.label, valor: x.value }))}
                  series={[{ key: "valor", label: "Custo", slot: 0, mark: "rect" }]}
                  layout="row" categoryWidth={185} valueFormat={brl} />
        </ChartFrame>
      </div>

      <ChartFrame
        title="Custo mês a mês"
        subtitle="Empilhado: a altura é o custo total do mês, as faixas dizem de que ele é feito"
        series={mensalSeries}
        rows={data?.mensal ?? []}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={300}
      >
        <VizBar rows={data?.mensal ?? []} series={mensalSeries} stacked totalNoTopo valueFormat={brl} />
      </ChartFrame>

      <VizTable
        title="Custo por cliente — linha a linha"
        subtitle="Cada cliente com as quatro parcelas de custo e, quando há receita casada, a margem que sobra. Clique na lupa pra ver como o número foi montado"
        cols={COLS}
        rows={linhas}
        ordemInicial="custo_total"
        loading={loading}
        altura={520}
        totalizar={["qtd_os", "diretas", "combustivel", "pedagio", "mao_obra", "custo_total", "receita", "margem"]}
        // Só linha com cadastro do app tem o que abrir: bucket de overhead não
        // tem OS nem despesa individual, e uma lupa que abre vazio irrita.
        podeClicar={(l) => l.customer_ids.length > 0}
        onLinhaClick={(l) => setMemorial({ nome: l.nome, ids: l.customer_ids })}
      />

      {memorial && (
        <MemorialCusto
          cliente={memorial.nome}
          customerIds={memorial.ids}
          from={range.from}
          to={range.to}
          onFechar={() => setMemorial(null)}
        />
      )}

      <p className="text-[10.5px] text-ww-textFaint px-1">
        Custo vem do app de serviços em tempo real ({data?.fonte === "app-direto" ? "leitura direta" : data?.fonte}).
        Receita vem do Omie. O cruzamento é pelo código do cliente — por isso quem não tem vínculo
        aparece com custo e sem margem.
      </p>
    </div>
  );
}
