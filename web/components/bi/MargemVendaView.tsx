"use client";

// Monitor de margem por venda — nasceu pras avulsas, serve pra qualquer
// categoria.
//
// A tela existe pra responder uma pergunta só, e rápido: alguma venda saiu
// abaixo do custo? Por isso o pior caso vem primeiro, em tudo — nos chips, na
// ordenação da tabela e na cor.
//
// ── O aviso que não pode sumir ──────────────────────────────────────────────
// "Sem custo ligado" NÃO é margem alta. É venda cujo custo não foi identificado,
// e ela fica fora da escala de propósito: se entrasse como custo zero, cairia em
// "Alta" e o painel diria que está tudo ótimo justamente onde não se sabe nada.
// O tile de cobertura mostra que fração das vendas tem custo medido.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizTable, { type Col } from "@/components/viz/VizTable";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const CATS = ["Avulsos", "Contratuais", "Projetos", "Revenda", "BOT/SW", "Outras"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type Linha = {
  pv_os: string; dt_fat: string | null; documento: string; cliente: string;
  categoria: string; projeto: string;
  receita: number; custo_compra: number | null;
  margem: number | null; margem_pct: number | null;
  tem_custo: boolean; qtd_pcs: number; fornecedores: string;
  faixa: string; faixa_ord: number;
};

type Payload = {
  total: {
    vendas: number; receita: number;
    receita_medida: number; custo_medido: number; margem_medida: number;
    cobertura_pct: number;
  };
  faixas: Array<{ faixa: string; vendas: number; receita: number; custo: number; margem: number }>;
  linhas: Linha[];
  error?: string;
};

// Tom por faixa. Negativa e muito baixa gritam; "sem custo" é neutro porque não
// é bom nem ruim — é desconhecido, e pintá-lo de verde ou vermelho mentiria.
const TOM: Record<string, "ok" | "alerta" | "critico" | "neutro"> = {
  "Negativa": "critico",
  "Muito baixa": "critico",
  "Baixa": "alerta",
  "Média": "alerta",
  "Alta": "ok",
  "Sem custo ligado": "neutro",
  "Sem receita": "neutro",
};

// Slot da paleta por faixa — vermelho no pior, verde no melhor, cinza no
// desconhecido. A cor segue a ENTIDADE (a faixa), não a posição no ranking.
const SLOT: Record<string, number> = {
  "Negativa": 3, "Muito baixa": 3, "Baixa": 2, "Média": 0, "Alta": 5,
  "Sem custo ligado": 6, "Sem receita": 6,
};

const COLS: Col<Linha>[] = [
  { key: "faixa",        label: "Margem",     tipo: "badge", w: 128, tom: (v) => TOM[String(v)] ?? "neutro" },
  { key: "dt_fat",       label: "Dt. NF",     tipo: "date",  w: 82 },
  { key: "pv_os",        label: "PV/OS",      w: 92 },
  { key: "cliente",      label: "Cliente",    w: 230 },
  { key: "projeto",      label: "Projeto",    w: 170 },
  { key: "receita",      label: "Receita",    tipo: "money", w: 118 },
  { key: "custo_compra", label: "Custo compra", tipo: "money", w: 122 },
  { key: "margem",       label: "Margem",     tipo: "money", w: 118 },
  { key: "margem_pct",   label: "%",          w: 76,
    fmt: (v) => v == null ? "—"
      : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` },
  { key: "qtd_pcs",      label: "PCs",        tipo: "num",   w: 58 },
  { key: "fornecedores", label: "Fornecedores", w: 240 },
];

export default function MargemVendaView() {
  const [range, setRange] = useState<DateRange>(() => ({ ...resolvePreset("ytd"), preset: "ytd" }));
  const [cats, setCats] = useState<Set<string>>(() => new Set(["Avulsos"]));
  const [faixaSel, setFaixaSel] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      qs.set("cat", Array.from(cats).join(",") || "Avulsos");
      const r = await fetch(`/api/bi/margem-venda?${qs}`, { cache: "no-store" });
      const j = (await r.json()) as Payload;
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null); setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [range.from, range.to, cats]);

  useEffect(() => { void load(); }, [load]);

  const t = data?.total;
  const faixas = data?.faixas ?? [];
  const negativa = faixas.find((f) => f.faixa === "Negativa");
  const muitoBaixa = faixas.find((f) => f.faixa === "Muito baixa");
  const semCusto = faixas.find((f) => f.faixa === "Sem custo ligado");

  const linhas = faixaSel ? (data?.linhas ?? []).filter((l) => l.faixa === faixaSel) : (data?.linhas ?? []);

  const margemMediaPct = t && t.receita_medida > 0
    ? (t.margem_medida / t.receita_medida) * 100 : null;

  const dims: DimFilter[] = [
    { key: "cat", label: "Categoria de venda", options: CATS, selected: cats },
  ];

  return (
    <div className="space-y-3">
      <VizFilters range={range} onRangeChange={setRange} dims={dims}
                  onDimChange={(_, sel) => setCats(sel.size ? sel : new Set(["Avulsos"]))} />

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl p-3 text-[12px]">
          {err}
        </div>
      )}

      {/* O alarme. Só aparece quando há o que alarmar — banner permanente vira
          paisagem e para de ser lido. */}
      {(negativa || muitoBaixa) && (
        <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl px-3 py-2.5">
          <p className="text-[12px] font-semibold text-rose-800 dark:text-rose-200">
            {negativa && `${negativa.vendas} venda(s) abaixo do custo — prejuízo de ${brl(Math.abs(negativa.margem))}`}
            {negativa && muitoBaixa && " · "}
            {muitoBaixa && `${muitoBaixa.vendas} com margem abaixo de 15%`}
          </p>
          <p className="text-[11px] text-ww-textMuted mt-0.5">
            Clique na faixa abaixo pra ver quais. O custo considerado é o de compra ligada ao PV/OS.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Vendas no período" value={t ? String(t.vendas) : "—"}
                  hint={t ? brl(t.receita) : undefined} />
        <StatTile label="Margem média" value={margemMediaPct != null
                    ? `${margemMediaPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}
                  hint="Só das vendas com custo medido" />
        <StatTile label="Resultado medido" value={t ? brl(t.margem_medida) : "—"}
                  hint={t ? `${brl(t.receita_medida)} de receita − ${brl(t.custo_medido)} de custo` : undefined} />
        <StatTile label="Cobertura do custo"
                  value={t ? `${t.cobertura_pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%` : "—"}
                  hint={semCusto ? `${semCusto.vendas} venda(s) sem compra ligada` : "todas medidas"}
                  higherIsBetter />
      </div>

      {/* Chips clicáveis: são o filtro e o resumo ao mesmo tempo. */}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setFaixaSel(null)}
          className={`px-2.5 py-1 text-[11px] rounded-full border transition ${
            faixaSel === null ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                              : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
          Todas ({data?.linhas.length ?? 0})
        </button>
        {faixas.map((f) => {
          const on = faixaSel === f.faixa;
          const tom = TOM[f.faixa] ?? "neutro";
          const cor = tom === "critico" ? "border-rose-500/50 text-rose-700 dark:text-rose-300"
                    : tom === "alerta"  ? "border-amber-500/50 text-amber-700 dark:text-amber-300"
                    : tom === "ok"      ? "border-emerald-500/50 text-emerald-700 dark:text-emerald-300"
                    : "border-ww-border text-ww-textMuted";
          return (
            <button key={f.faixa} type="button"
              onClick={() => setFaixaSel(on ? null : f.faixa)}
              className={`px-2.5 py-1 text-[11px] rounded-full border transition ${cor} ${
                on ? "font-semibold ring-1 ring-ww-accent bg-ww-accentSoft" : "hover:bg-ww-rowHover"}`}>
              {f.faixa}: <strong>{f.vendas}</strong>
              {f.faixa !== "Sem custo ligado" && ` · ${brl(f.margem)}`}
            </button>
          );
        })}
      </div>

      <ChartFrame
        title="Vendas por faixa de margem"
        subtitle='Negativa · até 15% · 15–25% · 25–35% · acima de 35%. "Sem custo ligado" fica fora da escala — é desconhecido, não bom'
        series={[{ key: "vendas", label: "Vendas", slot: 0, mark: "rect" }]}
        rows={faixas.map((f) => ({ x: f.faixa, vendas: f.vendas }))}
        valueFormat={(v) => `${Number(v) || 0}`}
        loading={loading}
        height={250}
      >
        <VizBar rows={faixas.map((f) => ({ x: f.faixa, vendas: f.vendas }))}
                series={[{ key: "vendas", label: "Vendas", slot: 0, mark: "rect" }]}
                layout="row" categoryWidth={140} valueFormat={(v) => `${v}`} />
      </ChartFrame>

      <VizTable
        title={faixaSel ? `Vendas — ${faixaSel}` : "Vendas do período"}
        subtitle="Ordenado pela pior margem. O custo é o dos pedidos de compra ligados àquele PV/OS"
        cols={COLS}
        rows={linhas}
        ordemInicial="margem"
        loading={loading}
        altura={520}
        totalizar={["receita", "custo_compra", "margem"]}
      />

      <p className="text-[10.5px] text-ww-textFaint px-1">
        Margem aqui é receita menos <strong>custo de compra</strong>. Despesas operacionais,
        combustível e mão de obra existem por cliente e mês, não por venda — ratear por NF inventaria
        precisão que o dado não tem. Esses custos estão em Custo por Cliente.
      </p>
    </div>
  );
}
