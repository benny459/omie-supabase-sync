"use client";

// "Faturei X no mês. Quando isso entra?" — cards 142 e 130 do Metabase.
//
// Três perguntas encadeadas, nesta ordem:
//   1. de cada mês faturado, quanto já entrou e quanto falta  (coorte)
//   2. o que falta entra quando, e veio de qual mês           (calendário)
//   3. qual título é cada um desses                            (detalhe)
//
// A coorte é empilhada porque as três faixas SOMAM o faturamento do mês —
// empilhar mostra composição de um total, que é exatamente o caso. O calendário
// também empilha, mas por origem: a altura da coluna é o que entra naquele mês,
// e as faixas dizem de qual faturamento veio.

import { useCallback, useEffect, useMemo, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizTable, { type Col } from "@/components/viz/VizTable";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];
const CATS = ["Contratuais", "Projetos", "Revenda", "Avulsos", "BOT/SW", "Outras"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (iso: string | null) => {
  if (!iso) return "Sem NF";
  const [a, m] = iso.slice(0, 7).split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
};

type CoorteRow = {
  mes: string; faturado: number; emitido: number; recebido: number;
  a_vencer: number; vencido: number; sem_titulo: number; pct_recebido: number | null;
};
type DetalheRow = {
  origem_mes: string | null; dt_fat: string | null; documento: string; num_titulo: string;
  cliente: string; categoria: string; emissao: string | null; vencimento: string | null;
  pagamento: string | null; valor: number; recebido: number; aberto: number;
  dias_atraso: number | null; situacao: string; prazo_dias: number | null;
};
type Payload = {
  coorte: CoorteRow[];
  calendario: Array<Record<string, unknown>>;
  origens: string[];
  origens_agrupadas: number;
  detalhe: DetalheRow[];
};

const COLS_COORTE: Col<CoorteRow & { rotulo: string }>[] = [
  { key: "rotulo",       label: "Mês faturado", w: 100 },
  { key: "faturado",     label: "Faturado",     tipo: "money", w: 130 },
  { key: "recebido",     label: "Recebido",     tipo: "money", w: 130 },
  { key: "a_vencer",     label: "A vencer",     tipo: "money", w: 130 },
  { key: "vencido",      label: "Vencido",      tipo: "money", w: 130 },
  { key: "sem_titulo",   label: "Sem título",   tipo: "money", w: 120 },
  { key: "pct_recebido", label: "% recebido",   w: 100,
    fmt: (v) => v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` },
];

const COLS_DETALHE: Col<DetalheRow & { origem: string }>[] = [
  { key: "origem",     label: "Origem",     w: 84 },
  { key: "dt_fat",     label: "Dt. NF",     tipo: "date", w: 82 },
  { key: "documento",  label: "PV/OS",      w: 88 },
  { key: "num_titulo", label: "Título",     w: 100 },
  { key: "cliente",    label: "Cliente",    w: 240 },
  { key: "categoria",  label: "Categoria",  w: 110 },
  { key: "vencimento", label: "Vence",      tipo: "date", w: 82 },
  { key: "prazo_dias", label: "Prazo",      tipo: "dias", w: 72 },
  { key: "pagamento",  label: "Pago em",    tipo: "date", w: 82 },
  { key: "valor",      label: "Valor",      tipo: "money", w: 118 },
  { key: "recebido",   label: "Recebido",   tipo: "money", w: 118 },
  { key: "aberto",     label: "Aberto",     tipo: "money", w: 118 },
  { key: "dias_atraso",label: "Atraso",     tipo: "dias", w: 76 },
  { key: "situacao",   label: "Situação",   tipo: "badge", w: 92,
    tom: (v) => v === "Recebido" ? "ok" : v === "Vencido" ? "critico"
              : v === "Parcial" ? "alerta" : "neutro" },
];

export default function RecebimentoView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [soAbertos, setSoAbertos] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      if (cats.size) qs.set("cat", Array.from(cats).join(","));
      if (soAbertos) qs.set("abertos", "1");
      const r = await fetch(`/api/bi/recebimento?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, empresas, cats, soAbertos]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
    { key: "cat", label: "Categoria de venda", options: CATS, selected: cats },
  ];
  const onDim = (key: string, sel: Set<string>) => {
    if (key === "empresa") setEmpresas(sel); else setCats(sel);
  };

  const coorte = data?.coorte ?? [];
  const coorteRows = coorte.map((c) => ({
    x: rotuloMes(c.mes),
    Recebido: Number(c.recebido) || 0,
    "A vencer": Number(c.a_vencer) || 0,
    Vencido: Number(c.vencido) || 0,
    "Sem título": Number(c.sem_titulo) || 0,
  }));
  // Ordem das séries = ordem de gravidade, do bom pro ruim. A pilha lê de baixo
  // pra cima, então "recebido" fica na base.
  const coorteSeries: SeriesDef[] = [
    { key: "Recebido",   label: "Recebido",   slot: 5 },
    { key: "A vencer",   label: "A vencer",   slot: 0 },
    { key: "Vencido",    label: "Vencido",    slot: 7 },
    { key: "Sem título", label: "Sem título", slot: 3 },
  ];

  const origens = data?.origens ?? [];
  const calSeries: SeriesDef[] = origens.map((o, i) => ({ key: o, label: o, slot: i }));

  const totais = useMemo(() => {
    const s = (k: keyof CoorteRow) => coorte.reduce((a, c) => a + (Number(c[k]) || 0), 0);
    const fat = s("faturado");
    return {
      faturado: fat, recebido: s("recebido"), aVencer: s("a_vencer"), vencido: s("vencido"),
      pct: fat > 0 ? (s("recebido") / fat) * 100 : 0,
    };
  }, [coorte]);

  return (
    <div className="space-y-3">
      <VizFilters
        range={range} onRangeChange={setRange} dims={dims} onDimChange={onDim}
        right={
          <label className="flex items-center gap-1.5 text-[11px] text-ww-textMuted cursor-pointer">
            <input type="checkbox" checked={soAbertos}
                   onChange={(e) => setSoAbertos(e.target.checked)}
                   className="accent-ww-accent" />
            Só títulos em aberto
          </label>
        }
      />

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl p-3 text-[12px]">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Faturado no período" value={brl(totais.faturado)}
                  hint={`${coorte.length} mês(es) na coorte`} />
        <StatTile label="Já recebido" value={brl(totais.recebido)}
                  hint={`${totais.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do faturado`} />
        <StatTile label="A vencer" value={brl(totais.aVencer)}
                  hint="Ainda dentro do prazo" />
        <StatTile label="Vencido" value={brl(totais.vencido)}
                  hint="Passou do vencimento e não entrou" higherIsBetter={false} />
      </div>

      <ChartFrame
        title="Coorte de faturamento — quanto de cada mês já entrou"
        subtitle="A coluna é o faturamento do mês; as faixas dizem em que estágio ele está hoje"
        series={coorteSeries}
        rows={coorteRows}
        valueFormat={(v) => brl(Number(v))}
        loading={loading}
        height={280}
      >
        <VizBar rows={coorteRows} series={coorteSeries} stacked valueFormat={(v) => brl(v)} />
      </ChartFrame>

      <ChartFrame
        title="Calendário de entrada — quando o que está aberto entra"
        subtitle={
          "Altura da coluna = o que entra naquele mês; faixas = de qual mês de faturamento veio" +
          (data?.origens_agrupadas ? ` · ${data.origens_agrupadas} origem(ns) menor(es) agrupada(s) em "Outros"` : "")
        }
        series={calSeries}
        rows={data?.calendario ?? []}
        valueFormat={(v) => brl(Number(v))}
        loading={loading}
        height={280}
      >
        <VizBar rows={data?.calendario ?? []} series={calSeries} stacked valueFormat={(v) => brl(v)} />
      </ChartFrame>

      <VizTable
        title="Coorte — mês a mês"
        subtitle='"Sem título" é faturamento que não virou contas a receber — a aba Conciliação abre nota a nota'
        cols={COLS_COORTE}
        rows={coorte.map((c) => ({ ...c, rotulo: rotuloMes(c.mes) }))}
        ordemInicial="rotulo"
        totalizar={["faturado", "recebido", "a_vencer", "vencido", "sem_titulo"]}
        loading={loading}
        altura={300}
      />

      <VizTable
        title="Títulos a receber — de qual faturamento cada um veio"
        subtitle="Coluna Origem = mês da nota que gerou o título. Prazo = dias entre a nota e o vencimento"
        cols={COLS_DETALHE}
        rows={(data?.detalhe ?? []).map((d) => ({ ...d, origem: rotuloMes(d.origem_mes) }))}
        ordemInicial="valor"
        totalizar={["valor", "recebido", "aberto"]}
        loading={loading}
        altura={460}
      />
    </div>
  );
}
