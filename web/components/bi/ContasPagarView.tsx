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
import VizTable, { type Col } from "@/components/viz/VizTable";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];

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
  { key: "contraparte", label: "FORNECEDOR", w: 240 },
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

type AgendaRow = {
  previsao: string | null; dia_semana: string; vencimento: string | null;
  fornecedor: string; titulo: string | null; nf: string | null;
  categoria: string; grupo: string; projeto: string; pedido: string;
  aprovacao: string; aprovador: string; pv_os: string;
  rc: string; rc_descricao: string;
  rc_custo: number | null; pc_custo: number | null; qtd_pcs: number;
  rc_vs_pc: string | null; fat_status: string | null;
  venda: number | null; margem_pct: number | null;
  dt_aprovacao: string | null; dt_nf_fornec: string | null; dt_lancamento: string | null;
  atraso_nf: number | null; dt_receb_nf: string | null;
  prazo_dias: number | null; material: string; valor: number;
};

// A agenda amarra COMPRA → VENDA → PAGAMENTO na mesma linha: o que vou pagar,
// de qual pedido veio, se estava aprovado, qual PV/OS vai faturar aquilo e a
// margem que sobra. É a tela que responde "posso pagar isto?" sem trocar de aba.
const COLS_AGENDA: Col<AgendaRow>[] = [
  { key: "previsao",   label: "Previsão",   tipo: "date", w: 80 },
  { key: "dia_semana", label: "D.Sem",      w: 52 },
  { key: "vencimento", label: "Vencimento", tipo: "date", w: 84 },
  { key: "fornecedor", label: "FORNECEDOR", w: 210 },
  { key: "categoria",  label: "Categoria",  w: 140 },
  { key: "projeto",    label: "Projeto",    w: 150 },
  { key: "pedido",     label: "Pedido",     w: 92 },
  { key: "aprovacao",  label: "Aprovação",  tipo: "badge", w: 110,
    tom: (v) => v === "Aprovado" ? "ok"
              : v === "Não aprovado" ? "critico"
              : v === "Pendente" || v === "Sem aprovação" ? "alerta" : "neutro" },
  { key: "aprovador",  label: "Aprovador",  w: 100 },
  { key: "pv_os",      label: "PV/OS",      w: 88 },
  { key: "rc",         label: "RC",         w: 66 },
  { key: "rc_descricao", label: "RC — descrição", w: 200 },
  { key: "rc_custo",   label: "RC orçado",  tipo: "money", w: 112 },
  { key: "pc_custo",   label: "PC real",    tipo: "money", w: 112 },
  { key: "rc_vs_pc",   label: "RC × PC",    tipo: "badge", w: 108,
    tom: (v) => v === "No orçamento" ? "ok" : v === "Acima do RC" ? "critico" : "neutro" },
  { key: "fat_status", label: "Faturado?",  tipo: "badge", w: 104,
    tom: (v) => v === "Faturado" ? "ok" : v === "Não faturado" ? "critico" : "neutro" },
  { key: "venda",      label: "Venda",      tipo: "money", w: 112 },
  { key: "margem_pct", label: "Margem",     w: 84,
    fmt: (v) => v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` },
  { key: "material",   label: "Material",   w: 110 },
  { key: "prazo_dias", label: "Prazo",      tipo: "dias", w: 68 },
  { key: "valor",      label: "A pagar",    tipo: "money", w: 118 },
];

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
  detalhe: TituloRow[];
  agenda: AgendaRow[];
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

      {/* A agenda vem ANTES do detalhe simples: ela responde "posso pagar isto?",
          que é a pergunta que se faz primeiro. O detalhe abaixo continua sendo a
          lista crua de títulos, sem o contexto de compra e venda. */}
      <VizTable
        title={`Agenda de pagamento — próximos ${horizonte} dias`}
        subtitle="Compra → venda → pagamento na mesma linha: pedido, aprovação, PV/OS que vai faturar e a margem que sobra"
        cols={COLS_AGENDA}
        rows={data?.agenda ?? []}
        ordemInicial="previsao"
        loading={loading}
        altura={480}
        totalizar={["valor", "venda", "pc_custo"]}
      />

      <VizTable
        title="Detalhe de títulos a pagar"
        subtitle="Títulos em aberto, linha a linha — mesma lista do card do Metabase"
        cols={COLS_TITULOS}
        rows={data?.detalhe ?? []}
        ordemInicial="aberto"
        loading={loading}
        altura={460}
        totalizar={["valor", "aberto"]}
      />

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
