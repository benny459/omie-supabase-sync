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
import VizPie from "@/components/viz/VizPie";
import VizTable, { type Col } from "@/components/viz/VizTable";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });



// Colunas do detalhe de títulos — mesmas informações do card do Metabase.

type AgendaRow = {
  /** 'Vencido' | 'A vencer' — separa os dois blocos da lista única. */
  lado: string;
  previsao: string | null; dia_semana: string; vencimento: string | null;
  emissao: string | null; dias_atraso: number | null;
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
  { key: "lado",       label: "Situação",   tipo: "badge", w: 92,
    tom: (v) => v === "Vencido" ? "critico" : "neutro" },
  { key: "previsao",   label: "Previsão",   tipo: "date", w: 80 },
  { key: "dia_semana", label: "D.Sem",      w: 52 },
  { key: "vencimento", label: "Vencimento", tipo: "date", w: 84 },
  { key: "dias_atraso",label: "Atraso",     tipo: "dias", w: 72 },
  { key: "emissao",    label: "Emissão",    tipo: "date", w: 82 },
  { key: "titulo",     label: "Título",     w: 96 },
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
  agenda: AgendaRow[];
  faixas: Array<{ lado: string; faixa: string; ord: number; qtd: number; valor: number }>;
  horizonte_mes: {
    vencido: number; qtd_vencido: number;
    mes_atual: number; qtd_mes_atual: number;
    mes_proximo: number; qtd_mes_proximo: number;
    depois: number; qtd_depois: number;
  } | null;
};

export default function ContasPagarView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [horizonte, setHorizonte] = useState(90);
  // Padrão VENCIMENTO: o tile "Vencido" precisa dizer o que passou da data
  // contratada. Por previsão, um título repactuado deixa de contar como vencido
  // e o número perde o sentido de "onde devo focar".
  const [base, setBase] = useState<"previsao" | "vencimento">("vencimento");
  /** Recorte da lista única: tudo, só o vencido ou só o que está por vir. */
  const [lado, setLado] = useState<"todos" | "Vencido" | "hoje" | "A vencer">("todos");
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

  // Duas séries independentes: vencido usa vermelho (é dívida furada), a vencer
  // usa azul (é compromisso normal). Cada uma no próprio painel e no próprio eixo.
  const faixasDe = (lado: string) =>
    (data?.faixas ?? []).filter((f) => f.lado === lado)
      .sort((a, b) => a.ord - b.ord)
      .map((f) => ({ x: f.faixa, valor: Number(f.valor) || 0, qtd: f.qtd }));

  const foraDoCorte = (data?.faixas ?? []).filter((f) => f.lado === "Além do corte");
  const vencidoRows = faixasDe("Vencido");
  const vencidoSeries: SeriesDef[] = [{ key: "valor", label: "Vencido", slot: 3, mark: "rect" }];
  const aVencerRows = faixasDe("A vencer");
  const aVencerSeries: SeriesDef[] = [{ key: "valor", label: "A vencer", slot: 0, mark: "rect" }];

  const hojeIso = new Date().toISOString().slice(0, 10);
  const agendaFiltrada = (data?.agenda ?? []).filter((r) =>
    lado === "todos" ? true
    : lado === "hoje" ? (r.previsao ?? "").slice(0, 10) === hojeIso
    : r.lado === lado);

  const mensalSeries: SeriesDef[] = [
    { key: "emitido", label: "Emitido", slot: 0, mark: "line" },
    { key: "pago",    label: "Pago",    slot: 2, mark: "line" },
  ];

  const topSeries: SeriesDef[] = [{ key: "valor", label: "Pago no período", slot: 1, mark: "rect" }];
  const topRows = (data?.top ?? []).map((t) => ({ x: t.chave, valor: t.valor, qtd: t.qtd }));

  const h = data?.horizonte;
  const hm = data?.horizonte_mes;

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

      {/* O aviso existe porque o número equivalente no Metabase somava tudo num
          valor só — incluindo parcela contratada pra 2050, que não cabe em
          decisão nenhuma. Aqui ele diz explicitamente o que está fora do foco. */}
      {hm && hm.depois > 0 && (
        <p className="text-[11px] text-ww-textMuted bg-ww-rowHover border border-ww-border rounded-md px-2 py-1.5">
          Saldo aberto total é {brl(data!.saldo_aberto)} em {data!.qtd_titulos} títulos, mas{" "}
          <strong>{brl(hm.depois)}</strong> ({hm.qtd_depois} parcelas) só vencem depois do mês que
          vem. O que exige decisão agora é {brl(hm.vencido + hm.mes_atual)} — vencido mais o que
          vence até o fim do mês.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Vencido" value={hm ? brl(hm.vencido) : "—"}
                  hint={hm ? `${hm.qtd_vencido} títulos · por data de vencimento` : undefined}
                  higherIsBetter={false} />
        <StatTile label="Pago no ano" value={data ? brl(data.total_pago_ano) : "—"} />
        <StatTile label="Vence este mês" value={hm ? brl(hm.mes_atual) : "—"}
                  hint={hm ? `${hm.qtd_mes_atual} títulos · de hoje até o fim do mês` : undefined} />
        <StatTile label="Vence no mês que vem" value={hm ? brl(hm.mes_proximo) : "—"}
                  hint={hm ? `${hm.qtd_mes_proximo} títulos` : undefined} />
      </div>

      {/* Duas visões, dois eixos. Juntas numa escala só, a barra do "a vencer"
          (R$ 17M em parcelas até 2050) achatava TODO o atraso — R$ 287k — numa
          linha rente ao zero. São perguntas diferentes: há quanto tempo devo, e
          quando vence o que ainda não venceu.
          Nenhuma das duas respeita o filtro de período do topo: dívida vencida
          não deixa de existir porque a tela está em "ano até hoje". */}
      {foraDoCorte.length > 0 && (
        <p className="text-[11px] text-ww-textMuted bg-ww-rowHover border border-ww-border rounded-md px-2 py-1.5">
          Fora dos dois gráficos abaixo:{" "}
          {foraDoCorte.map((f, i) => (
            <span key={f.faixa}>
              {i > 0 && " · "}
              <strong>{brl(Number(f.valor))}</strong> {f.faixa.toLowerCase()} ({f.qtd} títulos)
            </span>
          ))}
          . Ficam de fora porque a escala deles esconde tudo o que é acionável — seguem na lista
          abaixo.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartFrame
          title="Vencido — por tempo de atraso"
          subtitle={`Até 120 dias de atraso · referência: ${base === "previsao" ? "previsão" : "vencimento"} · sem filtro de período`}
          series={vencidoSeries} rows={vencidoRows}
          valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={260}
        >
          <VizBar rows={vencidoRows} series={vencidoSeries} valueFormat={brl} />
        </ChartFrame>

        <ChartFrame
          title="A vencer — por horizonte"
          subtitle="Até 12 meses à frente — o que passa disso está no aviso acima"
          series={aVencerSeries} rows={aVencerRows}
          valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={260}
        >
          <VizBar rows={aVencerRows} series={aVencerSeries} valueFormat={brl} />
        </ChartFrame>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartFrame
          title="Emitido vs pago por mês"
          subtitle="Ambos em R$ — um eixo só. No Metabase eram combos de eixo duplo."
          series={mensalSeries} rows={data?.mensal ?? []}
          valueFormat={(v) => brl(Number(v) || 0)} loading={loading} height={280}
        >
          {/* Barra e não linha: são valores mensais discretos, não uma série
              contínua. Linha sugere interpolação entre os meses, que não existe. */}
          <VizBar rows={data?.mensal ?? []} series={mensalSeries} valueFormat={brl} />
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

      {/* Uma lista só. Eram duas — "agenda" e "detalhe de títulos" — mostrando a
          mesma linha por dois ângulos, e responder "esta conta veio de qual
          compra?" exigia procurar o fornecedor de uma na outra.
          Inclui os VENCIDOS: a tela serve pra decidir o que pagar, e a dívida
          vencida é a primeira coisa dessa decisão. */}
      <div className="flex items-center gap-1 justify-end -mb-1">
        <span className="text-[11px] text-ww-textMuted mr-1">Mostrar</span>
        {([["todos", "Tudo"], ["Vencido", "Só vencido"], ["hoje", "Vence hoje"],
           ["A vencer", "Só a vencer"]] as const)
          .map(([k, l]) => (
          <button key={k} type="button" onClick={() => setLado(k)}
            className={`px-2 py-0.5 text-[11px] rounded border transition ${
              lado === k ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                         : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
            {l}
          </button>
        ))}
      </div>

      <VizTable
        title="Contas a pagar — vencido e a vencer"
        subtitle={`Vencido inteiro + a vencer nos próximos ${horizonte} dias. Compra → venda → pagamento na mesma linha`}
        cols={COLS_AGENDA}
        rows={agendaFiltrada}
        ordemInicial="previsao"
        loading={loading}
        altura={520}
        totalizar={["valor", "venda", "pc_custo"]}
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
