"use client";

// Aba "Cadeia de Compras" — porte dos cards 43, 83, 136, 145, 166 e 172.
//
// A tela segue o dinheiro de compra de ponta a ponta: título a pagar → pedido
// de compra → aprovação → PV/OS → nota pro cliente → recebimento. No Metabase
// isso eram 6 cards espalhados, cada um repetindo as mesmas CTEs.
//
// Um gráfico só (status de aprovação, uma barra por status). O resto é tabela:
// a pergunta aqui é sempre "qual compra travou onde", e barra não responde qual.
//
// AVISO sobre a coluna "Faturado" no detalhe: quando dois PCs alimentam a mesma
// venda, o valor da venda aparece nas duas linhas. É contexto da linha, não
// parcela somável — por isso ela NÃO entra no rodapé de totais. O total correto
// está no tile "Faturado p/ cliente", que soma sobre PV/OS distintos.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizTable, { type Col } from "@/components/viz/VizTable";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const EMPRESAS = ["SF", "CD", "WW"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Resumo = {
  qtd_titulos: number; total_comprado: number; total_pago: number; total_aberto: number;
  qtd_pv_os: number; total_faturado: number; total_recebido: number; aberto_ar: number;
};
type AprovRow = { status: string; qtd: number; valor: number; pct_total: number };
type CadeiaRow = {
  empresa: string; cod_titulo: number;
  emissao: string | null; vencimento: string | null; previsao: string | null; pagamento: string | null;
  fornecedor: string; categoria: string; nf_fornecedor: string | null; projeto_compra: string;
  pc: string; aprovacao: string; aprovador: string; pv_os: string;
  cliente_venda: string; projeto_venda: string;
  valor: number; val_pago: number; val_aberto: number;
  status_pgto: string; dias_atraso: number | null;
  status_fat: string; val_faturado: number | null;
  status_ar: string; val_recebido: number | null; aberto_ar: number | null; atraso_ar: number | null;
};
type NaoFatRow = {
  pv_os: string; qtd_pcs: number; qtd_pagamentos: number; total_pago: number;
  fornecedores: string; primeiro_pgto: string | null; ultimo_pgto: string | null;
  dias_desde_pgto: number | null;
};
type CoberturaRow = {
  projeto: string; cod_projeto: string; comprado: number; faturado: number;
  pago: number; recebido: number; gap_competencia: number; exposicao_caixa: number;
  pct_cobertura: number | null;
};

type Payload = {
  resumo: Resumo | null;
  aprovacao: AprovRow[];
  cadeia: CadeiaRow[];
  rastreio: CadeiaRow[];
  nao_faturadas: NaoFatRow[];
  cobertura: CoberturaRow[];
};

const tomAprov = (v: unknown) => {
  const s = String(v ?? "");
  if (s === "Aprovado") return "ok" as const;
  if (s === "Não aprovado") return "critico" as const;
  if (s === "Pendente" || s === "Sem aprovação") return "alerta" as const;
  return "neutro" as const;
};
const tomPgto = (v: unknown) =>
  v === "Pago" ? "ok" as const : v === "Vencido" ? "critico" as const
  : v === "Parcial" ? "alerta" as const : "neutro" as const;
const tomFat = (v: unknown) =>
  v === "Faturado" ? "ok" as const : v === "Não faturado" ? "critico" as const : "neutro" as const;
const tomAr = (v: unknown) =>
  v === "Recebido" ? "ok" as const : v === "Vencido" ? "critico" as const
  : v === "Parcial" ? "alerta" as const : "neutro" as const;

// Detalhe completo da cadeia (card 166): a linha responde "esta compra virou
// venda? a venda virou recebimento?" sem precisar abrir outra tela.
const COLS_CADEIA: Col<CadeiaRow>[] = [
  { key: "previsao",     label: "Previsão",   tipo: "date",  w: 82 },
  { key: "fornecedor",   label: "Fornecedor", w: 200 },
  { key: "categoria",    label: "Categoria",  w: 150 },
  { key: "pc",           label: "PC",         w: 90 },
  { key: "aprovacao",    label: "Aprovação",  tipo: "badge", w: 122, tom: tomAprov },
  { key: "valor",        label: "Valor",      tipo: "money", w: 112 },
  { key: "status_pgto",  label: "Pgto",       tipo: "badge", w: 86,  tom: tomPgto },
  { key: "val_aberto",   label: "Aberto",     tipo: "money", w: 108 },
  { key: "pv_os",        label: "PV/OS",      w: 110 },
  { key: "cliente_venda",label: "Cliente",    w: 190 },
  { key: "status_fat",   label: "Faturado?",  tipo: "badge", w: 108, tom: tomFat },
  { key: "val_faturado", label: "Faturado",   tipo: "money", w: 112 },
  { key: "status_ar",    label: "Receb.",     tipo: "badge", w: 92,  tom: tomAr },
  { key: "val_recebido", label: "Recebido",   tipo: "money", w: 112 },
];

// Rastreio (card 145): mesmo dado, ancorado no que JÁ saiu do caixa.
const COLS_RASTREIO: Col<CadeiaRow>[] = [
  { key: "pagamento",    label: "Dt. pgto",   tipo: "date",  w: 82 },
  { key: "fornecedor",   label: "Fornecedor", w: 200 },
  { key: "categoria",    label: "Categoria",  w: 150 },
  { key: "val_pago",     label: "Pago",       tipo: "money", w: 112 },
  { key: "nf_fornecedor",label: "NF compra",  w: 92 },
  { key: "pc",           label: "PC",         w: 90 },
  { key: "pv_os",        label: "PV/OS",      w: 110 },
  { key: "projeto_venda",label: "Projeto",    w: 170 },
  { key: "cliente_venda",label: "Cliente",    w: 190 },
  { key: "status_fat",   label: "Faturado?",  tipo: "badge", w: 108, tom: tomFat },
  { key: "val_faturado", label: "Valor venda", tipo: "money", w: 112 },
  { key: "status_ar",    label: "Status AR",  tipo: "badge", w: 92, tom: tomAr },
  { key: "val_recebido", label: "Recebido",   tipo: "money", w: 112 },
  { key: "aberto_ar",    label: "Aberto AR",  tipo: "money", w: 108 },
];

const COLS_NAO_FAT: Col<NaoFatRow>[] = [
  { key: "pv_os",           label: "PV/OS",       w: 130 },
  { key: "fornecedores",    label: "Fornecedores", w: 300 },
  { key: "qtd_pcs",         label: "PCs",         tipo: "num", w: 60 },
  { key: "qtd_pagamentos",  label: "Pgtos",       tipo: "num", w: 68 },
  { key: "total_pago",      label: "Pago ao forn.", tipo: "money", w: 130 },
  { key: "primeiro_pgto",   label: "1º pgto",     tipo: "date", w: 82 },
  { key: "ultimo_pgto",     label: "Últ. pgto",   tipo: "date", w: 82 },
  { key: "dias_desde_pgto", label: "Parado há",   tipo: "dias", w: 92 },
];

const COLS_COBERTURA: Col<CoberturaRow>[] = [
  { key: "projeto",         label: "Projeto",     w: 240 },
  { key: "comprado",        label: "Comprado",    tipo: "money", w: 120 },
  { key: "faturado",        label: "Faturado",    tipo: "money", w: 120 },
  { key: "pago",            label: "Pago",        tipo: "money", w: 120 },
  { key: "recebido",        label: "Recebido",    tipo: "money", w: 120 },
  { key: "gap_competencia", label: "Gap compet.", tipo: "money", w: 122 },
  { key: "exposicao_caixa", label: "Exposição caixa", tipo: "money", w: 132 },
  { key: "pct_cobertura",   label: "Cobertura",   w: 96,
    fmt: (v) => v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` },
];

export default function ComprasCadeiaView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [base, setBase] = useState<"previsao" | "emissao">("previsao");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to, base });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      const r = await fetch(`/api/bi/compras-cadeia?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, empresas, base]);

  useEffect(() => { void load(); }, [load]);

  const dims: DimFilter[] = [
    { key: "empresa", label: "Empresa", options: EMPRESAS, selected: empresas },
  ];

  const r = data?.resumo;
  const aprovRows = (data?.aprovacao ?? []).map((a) => ({ x: a.status, valor: a.valor }));
  const aprovSeries: SeriesDef[] = [{ key: "valor", label: "Valor comprado", slot: 0 }];

  return (
    <div className="space-y-3">
      <VizFilters
        range={range}
        onRangeChange={setRange}
        dims={dims}
        onDimChange={(_, sel) => setEmpresas(sel)}
        right={
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-ww-textMuted">Data por</span>
            {(["previsao", "emissao"] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBase(b)}
                className={`px-2 py-0.5 rounded border transition ${
                  base === b
                    ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                    : "border-ww-border text-ww-textMuted hover:text-ww-text"
                }`}
              >
                {b === "previsao" ? "Previsão" : "Emissão"}
              </button>
            ))}
          </div>
        }
      />

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl p-3 text-[12px]">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Comprado (com PC)" value={brl(r?.total_comprado ?? 0)}
                  hint={`${r?.qtd_titulos ?? 0} títulos a pagar`} />
        <StatTile label="Pago ao fornecedor" value={brl(r?.total_pago ?? 0)}
                  hint={`${brl(r?.total_aberto ?? 0)} ainda em aberto`} />
        <StatTile label="Faturado p/ cliente" value={brl(r?.total_faturado ?? 0)}
                  hint={`${r?.qtd_pv_os ?? 0} PV/OS distintos na cadeia`} />
        <StatTile label="Recebido do cliente" value={brl(r?.total_recebido ?? 0)}
                  hint={`${brl(r?.aberto_ar ?? 0)} em aberto no AR`} />
      </div>

      <ChartFrame
        title="Compras por status de aprovação"
        subtitle="Valor dos títulos a pagar conforme a aprovação do pedido de compra"
        series={aprovSeries}
        rows={aprovRows}
        valueFormat={(v) => brl(Number(v))}
        loading={loading}
        height={230}
      >
        <VizBar rows={aprovRows} series={aprovSeries} layout="row"
                categoryWidth={150} valueFormat={(v) => brl(v)} />
      </ChartFrame>

      <VizTable
        title="Compras pagas que não viraram faturamento"
        subtitle="Saiu do caixa pro fornecedor e não voltou como nota pro cliente — quanto mais velho, pior"
        cols={COLS_NAO_FAT}
        rows={data?.nao_faturadas ?? []}
        ordemInicial="total_pago"
        totalizar={["total_pago"]}
        loading={loading}
        altura={320}
      />

      <VizTable
        title="Rastreio: compra paga → venda → recebimento"
        subtitle="Ancorado na data de pagamento — o que já saiu do caixa e onde parou"
        cols={COLS_RASTREIO}
        rows={data?.rastreio ?? []}
        ordemInicial="pagamento"
        totalizar={["val_pago", "val_recebido", "aberto_ar"]}
        loading={loading}
        altura={420}
      />

      <VizTable
        title="Cadeia de compras — detalhe"
        subtitle="Título a pagar → PC → aprovação → PV/OS → NF → recebimento, linha a linha"
        cols={COLS_CADEIA}
        rows={data?.cadeia ?? []}
        ordemInicial="valor"
        totalizar={["valor", "val_aberto"]}
        loading={loading}
        altura={440}
      />

      <VizTable
        title="Cobertura compra ↔ venda por projeto"
        subtitle="Vitalício por projeto, sem recorte de período: comprar em março e faturar em junho é o normal. Gap de competência ≠ exposição de caixa"
        cols={COLS_COBERTURA}
        rows={data?.cobertura ?? []}
        ordemInicial="exposicao_caixa"
        totalizar={["comprado", "faturado", "pago", "recebido", "gap_competencia", "exposicao_caixa"]}
        loading={loading}
        altura={420}
      />
    </div>
  );
}
