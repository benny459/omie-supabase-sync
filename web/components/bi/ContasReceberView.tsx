"use client";

// Aba/página "A Receber".
//
// O recorte "só carteira" é um FILTRO EXPLÍCITO aqui, com o default em "todos".
// No Metabase ele estava colado no SQL e aplicado de forma incoerente — metade
// dos cards filtrava, metade não — então 42% do contas a receber entrava em
// alguns números e ficava fora de outros, no mesmo painel. Agora quem liga o
// recorte sabe que ligou, e o aviso abaixo diz o que está fora.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizLine from "@/components/viz/VizLine";
import VizTable, { type Col } from "@/components/viz/VizTable";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];
const CATS = ["Contratuais", "Projetos", "Revenda", "Avulsos", "BOT/SW", "Outras"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });


type TituloRow = {
  empresa: string; contraparte: string; num_titulo: string; categoria: string;
  emissao: string | null; vencimento: string | null; previsao: string | null;
  pagamento: string | null; valor: number; aberto: number; pago: number;
  dias_atraso: number | null; situacao: string;
};

// Colunas do detalhe de títulos — mesmas informações do card do Metabase.
const COLS_TITULOS: Col<TituloRow>[] = [
  { key: "empresa",     label: "Emp.",        w: 52 },
  { key: "contraparte", label: "CONTRAPARTE", w: 240 },
  { key: "num_titulo",  label: "Título",      w: 90 },
  { key: "categoria",   label: "Categoria",   w: 110 },
  { key: "emissao",     label: "Emissão",     tipo: "date", w: 82 },
  { key: "previsao",    label: "Previsão",    tipo: "date", w: 82 },
  { key: "dias_atraso", label: "Atraso",      tipo: "dias", w: 72 },
  { key: "valor",       label: "Valor",       tipo: "money", w: 110 },
  { key: "aberto",      label: "Aberto",      tipo: "money", w: 110 },
  { key: "situacao",    label: "Situação",    tipo: "badge", w: 96,
    tom: (v) => v === "Vencido" ? "critico" : v === "Liquidado" ? "ok" : "neutro" },
];

type Payload = {
  saldo_aberto: number; qtd_titulos: number; a_vencer: number;
  vence_hoje: number; vence_amanha: number; esta_semana: number; em_atraso: number;
  aging: Array<{ faixa: string; ord: number; qtd: number; valor: number }>;
  mensal: Array<{ x: string; emitido: number; recebido: number }>;
  detalhe: TituloRow[];
};

export default function ContasReceberView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [carteira, setCarteira] = useState(false);
  const [base, setBase] = useState<"previsao" | "vencimento">("previsao");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to, base });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      if (cats.size) qs.set("cat", Array.from(cats).join(","));
      if (carteira) qs.set("carteira", "1");
      const r = await fetch(`/api/bi/contas-receber?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, empresas, cats, carteira, base]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
    { key: "cat", label: "Categoria de venda", options: CATS, selected: cats },
  ];

  const agingSeries: SeriesDef[] = [{ key: "valor", label: "Valor aberto", slot: 0, mark: "rect" }];
  const agingRows = (data?.aging ?? []).map((a) => ({ x: a.faixa, valor: a.valor, qtd: a.qtd }));

  const mensalSeries: SeriesDef[] = [
    { key: "emitido",  label: "Emitido",  slot: 0, mark: "line" },
    { key: "recebido", label: "Recebido", slot: 2, mark: "line" },
  ];

  return (
    <div className="space-y-4 min-w-0">
      <VizFilters
        range={range}
        onRangeChange={setRange}
        dims={dims}
        onDimChange={(k, sel) => (k === "empresa" ? setEmpresas(sel) : setCats(sel))}
        right={
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-[11.5px] text-ww-textMuted cursor-pointer"
                   title="Recorte que no Metabase estava colado no SQL e aplicado de forma incoerente">
              <input type="checkbox" checked={carteira} onChange={(e) => setCarteira(e.target.checked)} />
              Só carteira
            </label>
            <select
              value={base}
              onChange={(e) => setBase(e.target.value as "previsao" | "vencimento")}
              className="text-[11px] bg-ww-panel border border-ww-border rounded px-1.5 py-0.5 text-ww-text"
              title="Data de referência pra vencido / a vencer"
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

      {carteira && (
        <p className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-md px-2 py-1.5">
          Recorte de carteira ativo — títulos de clientes fora dela não entram em nenhum número desta tela.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Saldo aberto" value={data ? brl(data.saldo_aberto) : "—"}
                  hint={data ? `${data.qtd_titulos} títulos` : undefined} />
        <StatTile label="Em atraso" value={data ? brl(data.em_atraso) : "—"} higherIsBetter={false} />
        <StatTile label="Vence hoje" value={data ? brl(data.vence_hoje) : "—"} />
        <StatTile label="Esta semana" value={data ? brl(data.esta_semana) : "—"}
                  hint={data ? `amanhã ${brl(data.vence_amanha)}` : undefined} />
      </div>

      <ChartFrame
        title="Aging dos títulos abertos"
        subtitle={`Referência: ${base === "previsao" ? "data de previsão" : "data de vencimento"}`}
        series={agingSeries}
        rows={agingRows}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={260}
      >
        <VizBar rows={agingRows} series={agingSeries} valueFormat={brl} />
      </ChartFrame>

      <VizTable
        title="Detalhe de títulos a receber"
        subtitle="Títulos em aberto, linha a linha — mesma lista do card do Metabase"
        cols={COLS_TITULOS}
        rows={data?.detalhe ?? []}
        ordemInicial="aberto"
        loading={loading}
        altura={460}
        totalizar={["valor", "aberto"]}
      />

      <ChartFrame
        title="Emitido vs recebido por mês"
        subtitle="Ambos em R$ — um eixo só, sem eixo duplo."
        series={mensalSeries}
        rows={data?.mensal ?? []}
        valueFormat={(v) => brl(Number(v) || 0)}
        loading={loading}
        height={280}
      >
        <VizLine rows={data?.mensal ?? []} series={mensalSeries} valueFormat={brl} />
      </ChartFrame>
    </div>
  );
}
