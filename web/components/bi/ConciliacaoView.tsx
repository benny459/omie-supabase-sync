"use client";

// Aba "Conciliação" — porte dos cards 63, 88, 108 e 167 do Metabase.
//
// A tela responde uma pergunta só: o faturamento que as vendas registram virou
// título no contas a receber, pelo mesmo valor? Quando não vira, ou vira em
// outro mês, o fechamento não bate — e até aqui isso só era investigável
// abrindo quatro cards separados no Metabase.
//
// Ordem de leitura deliberada, do agregado pro caso:
//   1. tiles      — o tamanho do problema em R$
//   2. resumo     — em quantos baldes ele se divide
//   3. sem título — o balde que exige ação, aberto NF a NF
//   4. anomalias  — o que atravessa a virada do mês (explica o gap)
//   5. detalhe    — os dois lados linha a linha, pra auditoria fina
//
// Nenhum gráfico aqui. São 4 tabelas de conferência caso a caso; barra não
// ajuda a achar QUAL nota ficou sem título — a lista ajuda.

import { useCallback, useEffect, useMemo, useState } from "react";
import StatTile from "@/components/viz/StatTile";
import VizTable, { type Col } from "@/components/viz/VizTable";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];
const CATS = ["Contratuais", "Projetos", "Revenda", "Avulsos", "BOT/SW", "Outras"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type ResumoRow = {
  bucket: string; qtd_os: number | null;
  soma_faturado: number; soma_emitido: number; diferenca: number;
};
type SemTituloRow = {
  dt_fat: string | null; documento: string; cliente: string; categoria: string;
  valor_faturado: number; dias_sem_titulo: number | null;
};
type AnomaliaRow = {
  tipo: string; situacao: string; documento: string; cliente: string; categoria: string;
  dt_nf: string | null; dt_titulo: string | null; gap_dias: number | null;
  valor: number; contrib_gap: number;
};
type DetalheRow = {
  status: string; documento: string; cliente: string; categoria: string;
  dt_fat: string | null; dt_emissao: string | null; primeiro_venc: string | null;
  primeiro_pgto: string | null; gap_dias: number | null; parcelas: number | null;
  valor: number; pago: number | null; aberto: number | null;
};

type Payload = {
  resumo: ResumoRow[];
  sem_titulo: SemTituloRow[];
  detalhe: DetalheRow[];
  anomalias: AnomaliaRow[];
};

// "Conciliado" é o único bucket bom. Todo o resto pede alguma ação, e os dois
// que representam dinheiro sem contrapartida no AR são críticos.
const tomBucket = (b: unknown): "ok" | "alerta" | "critico" | "neutro" => {
  const s = String(b ?? "");
  if (s.startsWith("Conciliado")) return "ok";
  if (s.startsWith("Sem título")) return "critico";
  if (s.startsWith("Títulos sem OS")) return "alerta";
  return "alerta";
};

const COLS_RESUMO: Col<ResumoRow>[] = [
  { key: "bucket",        label: "Situação",   tipo: "badge", w: 230, tom: tomBucket },
  { key: "qtd_os",        label: "Qtd OS",     tipo: "num",   w: 80 },
  { key: "soma_faturado", label: "Faturado",   tipo: "money", w: 130 },
  { key: "soma_emitido",  label: "Emitido AR", tipo: "money", w: 130 },
  { key: "diferenca",     label: "Diferença",  tipo: "money", w: 130 },
];

const COLS_SEM_TITULO: Col<SemTituloRow>[] = [
  { key: "dt_fat",          label: "Dt. NF",   tipo: "date",  w: 82 },
  { key: "documento",       label: "PV/OS",    w: 90 },
  { key: "cliente",         label: "Cliente",  w: 260 },
  { key: "categoria",       label: "Categoria", w: 110 },
  { key: "valor_faturado",  label: "Faturado", tipo: "money", w: 120 },
  // Quanto mais velha a NF sem título, pior — 200 dias é dinheiro que nunca
  // entrou na régua de cobrança.
  { key: "dias_sem_titulo", label: "Parado há", tipo: "dias", w: 92 },
];

const COLS_ANOMALIAS: Col<AnomaliaRow>[] = [
  { key: "tipo",        label: "Anomalia",  tipo: "badge", w: 190,
    tom: (v) => String(v ?? "").startsWith("Sem título") ? "critico"
              : String(v ?? "").includes("órfão") ? "critico" : "alerta" },
  { key: "documento",   label: "PV/OS",     w: 90 },
  { key: "cliente",     label: "Cliente",   w: 230 },
  { key: "categoria",   label: "Categoria", w: 105 },
  { key: "dt_nf",       label: "Dt. NF",    tipo: "date", w: 82 },
  { key: "dt_titulo",   label: "Dt. título", tipo: "date", w: 84 },
  { key: "gap_dias",    label: "Gap",       tipo: "dias", w: 70 },
  { key: "situacao",    label: "Situação",  tipo: "badge", w: 96,
    tom: (v) => v === "Pago" ? "ok" : v === "Vencido" ? "critico" : "neutro" },
  { key: "contrib_gap", label: "Contrib.",  tipo: "money", w: 118 },
];

const COLS_DETALHE: Col<DetalheRow>[] = [
  { key: "status",        label: "Status",    tipo: "badge", w: 165,
    tom: (v) => v === "Conciliado" ? "ok"
              : v === "Faturado sem título" ? "critico" : "alerta" },
  { key: "documento",     label: "PV/OS",     w: 90 },
  { key: "cliente",       label: "Cliente",   w: 230 },
  { key: "categoria",     label: "Categoria", w: 105 },
  { key: "dt_fat",        label: "Dt. NF",    tipo: "date", w: 82 },
  { key: "dt_emissao",    label: "Emissão",   tipo: "date", w: 82 },
  { key: "primeiro_venc", label: "1º venc.",  tipo: "date", w: 82 },
  { key: "primeiro_pgto", label: "1º pgto.",  tipo: "date", w: 82 },
  { key: "parcelas",      label: "Parc.",     tipo: "num",  w: 62 },
  { key: "valor",         label: "Valor",     tipo: "money", w: 118 },
  { key: "aberto",        label: "Aberto",    tipo: "money", w: 118 },
];

export default function ConciliacaoView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      if (cats.size) qs.set("cat", Array.from(cats).join(","));
      const r = await fetch(`/api/bi/conciliacao?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, empresas, cats]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
    { key: "cat", label: "Categoria de venda", options: CATS, selected: cats },
  ];
  const onDim = (key: string, sel: Set<string>) => {
    if (key === "empresa") setEmpresas(sel); else setCats(sel);
  };

  // Os tiles saem do resumo, não de uma quinta consulta: qualquer número que
  // eu recalculasse aqui por fora poderia divergir da tabela logo abaixo.
  const kpis = useMemo(() => {
    const rs = data?.resumo ?? [];
    const soma = (pred: (b: string) => boolean, campo: keyof ResumoRow) =>
      rs.filter((r) => pred(r.bucket)).reduce((s, r) => s + (Number(r[campo]) || 0), 0);

    const faturado = rs.reduce((s, r) => s + (Number(r.soma_faturado) || 0), 0);
    const emitido  = rs.reduce((s, r) => s + (Number(r.soma_emitido) || 0), 0);
    const conciliado = soma((b) => b.startsWith("Conciliado"), "soma_faturado");
    const semTitulo  = soma((b) => b.startsWith("Sem título"), "soma_faturado");
    const qtdSemTitulo = rs.filter((r) => r.bucket.startsWith("Sem título"))
                           .reduce((s, r) => s + (Number(r.qtd_os) || 0), 0);
    return {
      faturado, emitido, semTitulo, qtdSemTitulo,
      gap: faturado - emitido,
      pctConciliado: faturado > 0 ? (conciliado / faturado) * 100 : null,
    };
  }, [data]);

  return (
    <div className="space-y-3">
      <VizFilters range={range} onRangeChange={setRange} dims={dims} onDimChange={onDim} />

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl p-3 text-[12px]">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Faturado no período" value={brl(kpis.faturado)}
                  hint="Vendas, categoria de receita" />
        <StatTile label="Emitido no AR" value={brl(kpis.emitido)}
                  hint="Títulos a receber, não cancelados" />
        <StatTile
          label="Gap faturado − emitido"
          value={brl(kpis.gap)}
          hint={Math.abs(kpis.gap) < 1 ? "Fechado" : "Diferença a explicar abaixo"}
        />
        <StatTile
          label="Faturado sem título"
          value={brl(kpis.semTitulo)}
          hint={kpis.qtdSemTitulo > 0
            ? `${kpis.qtdSemTitulo} nota(s) — nunca entrou na cobrança`
            : "Nenhuma nota sem título"}
          higherIsBetter={false}
        />
      </div>

      <VizTable
        title="Conciliação — resumo por situação"
        subtitle="Cada NF do período comparada com a soma dos títulos da mesma OS"
        cols={COLS_RESUMO}
        rows={data?.resumo ?? []}
        ordemInicial="soma_faturado"
        totalizar={["qtd_os", "soma_faturado", "soma_emitido", "diferenca"]}
        loading={loading}
        altura={220}
      />

      <VizTable
        title="Faturado sem título no contas a receber"
        subtitle="NF emitida nas vendas que não gerou título — dinheiro fora da régua de cobrança"
        cols={COLS_SEM_TITULO}
        rows={data?.sem_titulo ?? []}
        ordemInicial="valor_faturado"
        totalizar={["valor_faturado"]}
        loading={loading}
        altura={300}
      />

      <VizTable
        title="Anomalias faturamento × título"
        subtitle="Só o que não fecha dentro do mês. Contrib. positiva = faturei e não emiti; negativa = emiti sem NF no período"
        cols={COLS_ANOMALIAS}
        rows={data?.anomalias ?? []}
        ordemInicial="contrib_gap"
        totalizar={["valor", "contrib_gap"]}
        loading={loading}
        altura={380}
      />

      <VizTable
        title="Conciliação — detalhe linha a linha"
        subtitle="Os dois lados cruzados por OS, inclusive título sem NF no período"
        cols={COLS_DETALHE}
        rows={data?.detalhe ?? []}
        ordemInicial="valor"
        totalizar={["valor", "aberto"]}
        loading={loading}
        altura={460}
      />
    </div>
  );
}
