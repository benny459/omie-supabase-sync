"use client";

// Monitor de margem por venda — nasceu pras avulsas, serve pra qualquer
// categoria.
//
// A tela existe pra responder uma pergunta só, e rápido: alguma venda saiu
// abaixo do custo? Por isso o pior caso vem primeiro, em tudo — nos chips, na
// ordenação da tabela e na cor.
//
// ── A regra do negócio que comanda o alarme ─────────────────────────────────
// Em avulsos só se aprova compra do que é MIX ou MERCANTIL. Serviço puro não
// gera pedido de compra, então não ter custo nele é o esperado — vira a faixa
// neutra "Serviço (sem compra)", fora do alarme.
//
// O alarme de verdade é "Sem custo lançado": Mix ou Mercantil sem compra
// ligada. Sem essa distinção o monitor gritava por 57 vendas quando o problema
// real eram 15.
//
// O filtro de data alterna entre EMISSÃO do PV/OS (o ciclo comercial) e
// FATURAMENTO da NF. São perguntas diferentes: "o que vendi" e "o que faturei".

import { useCallback, useEffect, useMemo, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import { FAIXAS_SEM_MARGEM, faixaDeValores } from "@/lib/margem";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizPie from "@/components/viz/VizPie";
import VizTable, { type Col } from "@/components/viz/VizTable";
import VizFilters, { resolvePreset, type DateRange, type DimFilter } from "@/components/viz/VizFilters";

const CATS = ["Avulsos", "Contratuais", "Projetos", "Revenda", "BOT/SW", "Outras"];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Uma cor por gráfico. A ordem no eixo já carrega a escala da margem, e o
// ranking já está ordenado — pintar cada barra de um tom seria cor sem
// informação nova.
const DIST_SERIES: SeriesDef[] = [{ key: "vendas", label: "Vendas", slot: 0, mark: "rect" }];
const RANK_SERIES: SeriesDef[] = [{ key: "pct", label: "Margem %", slot: 0, mark: "rect" }];

type Linha = {
  pv_os: string; dt_fat: string | null; documento: string; cliente: string;
  categoria: string; projeto: string;
  receita: number; custo_compra: number | null;
  margem: number | null; margem_pct: number | null;
  tem_custo: boolean; exige_custo: boolean; qtd_pcs: number; fornecedores: string;
  faixa: string; faixa_ord: number; tipo_omie: string; dt_emissao: string | null;
};

type Payload = {
  base: string;
  falta_custo: { vendas: number; receita: number; de: number };
  tipos: string[];
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
  "Sem custo lançado": "critico",   // Mix/Mercantil sem compra: é falha
  "0–15%": "critico",
  "15–25%": "alerta",
  "25–35%": "alerta",
  "> 35%": "ok",
  // Serviço sem compra é a regra funcionando, não um problema. Neutro de
  // propósito: pintar de vermelho treinaria a ignorar o vermelho.
  "Serviço (sem compra)": "neutro",
  "Sem receita": "neutro",
};

// Slot da paleta por faixa — vermelho no pior, verde no melhor, cinza no
// desconhecido. A cor segue a ENTIDADE (a faixa), não a posição no ranking.


const COLS: Col<Linha>[] = [
  { key: "faixa",        label: "Margem",     tipo: "badge", w: 128, tom: (v) => TOM[String(v)] ?? "neutro" },
  { key: "dt_emissao",   label: "Emissão",    tipo: "date",  w: 82 },
  { key: "dt_fat",       label: "Dt. NF",     tipo: "date",  w: 82 },
  { key: "pv_os",        label: "PV/OS",      w: 92 },
  { key: "tipo_omie",    label: "Tipo",       tipo: "badge", w: 92,
    tom: (v) => v === "Serviço" ? "neutro" : v === "(sem tipo)" ? "alerta" : "ok" },
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
  // Vazio = todas as categorias do módulo. Ver o comentário da rota: a tela
  // mede o processo de avulsos, e Revenda/Contratuais também passam por ele.
  const [cats, setCats] = useState<Set<string>>(() => new Set());
  const [faixaSel, setFaixaSel] = useState<string | null>(null);
  /** Eixo do tempo: emissão do PV/OS (ciclo comercial) ou data da NF. */
  const [base, setBase] = useState<"emissao" | "faturamento">("emissao");
  const [tiposSel, setTiposSel] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ from: range.from, to: range.to });
      if (cats.size) qs.set("cat", Array.from(cats).join(","));
      qs.set("base", base);
      const r = await fetch(`/api/bi/margem-venda?${qs}`, { cache: "no-store" });
      const j = (await r.json()) as Payload;
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null); setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [range.from, range.to, cats, base]);

  useEffect(() => { void load(); }, [load]);

  const t = data?.total;
  const faixas = data?.faixas ?? [];
  const negativa = faixas.find((f) => f.faixa === "Negativa");
  const muitoBaixa = faixas.find((f) => f.faixa === "0–15%");
  const faltaCusto = faixas.find((f) => f.faixa === "Sem custo lançado");
  const servico = faixas.find((f) => f.faixa === "Serviço (sem compra)");

  const linhas = (data?.linhas ?? [])
    .filter((l) => !faixaSel || l.faixa === faixaSel)
    .filter((l) => !tiposSel.size || tiposSel.has(l.tipo_omie));

  const margemMediaPct = t && t.receita_medida > 0
    ? (t.margem_medida / t.receita_medida) * 100 : null;

  // Distribuição = só as faixas que SÃO margem, na ordem da escala (pior →
  // melhor). "Sem custo lançado" e "Serviço (sem compra)" saem do gráfico: são
  // estados, não posições numa escala, e com 42 vendas o Serviço virava a maior
  // barra de um gráfico de margem — dominando com justamente o que não tem
  // margem. Eles continuam nos chips e nos KPIs acima, que é o lugar deles.
  const ESCALA = ["Negativa", "0–15%", "15–25%", "25–35%", "> 35%"] as const;
  const distribuicao = useMemo(() => {
    const porFaixa = new Map(faixas.map((f) => [f.faixa, f]));
    return ESCALA.map((f) => ({
      x: f,
      vendas: porFaixa.get(f)?.vendas ?? 0,
      receita: porFaixa.get(f)?.receita ?? 0,
    }));
  }, [faixas]);

  // Ranking de clientes pela FAIXA de margem em que caem. Só entra quem tem
  // custo medido — sem isso o cliente apareceria com 100% e lideraria por falta
  // de dado, o erro que este monitor existe pra evitar.
  //
  // A barra é a margem %, e não R$, porque a pergunta aqui é "em que range este
  // cliente está", não "quanto ele rendeu". A cor repete a faixa, então dá pra
  // ler o range sem consultar o eixo.
  const rankingClientes = useMemo(() => {
    const acc = new Map<string, { receita: number; custo: number; margem: number }>();
    for (const l of data?.linhas ?? []) {
      if (!l.tem_custo) continue;
      if (tiposSel.size && !tiposSel.has(l.tipo_omie)) continue;
      const k = l.cliente || "(sem cliente)";
      const a = acc.get(k) ?? { receita: 0, custo: 0, margem: 0 };
      a.receita += Number(l.receita) || 0;
      a.custo   += Number(l.custo_compra) || 0;
      a.margem  += Number(l.margem) || 0;
      acc.set(k, a);
    }
    return Array.from(acc.entries())
      .filter(([, a]) => a.receita > 0)
      .map(([cliente, a]) => {
        const pct = (a.margem / a.receita) * 100;
        return { x: cliente, ...a, pct: Number(pct.toFixed(1)), faixa: faixaDeValores(a.receita, a.custo, true) };
      })
      .sort((p, q) => q.pct - p.pct)
      .slice(0, 15);
  }, [data?.linhas, tiposSel]);

  const dims: DimFilter[] = [
    { key: "cat", label: "Categoria de venda", options: CATS, selected: cats },
    { key: "tipo", label: "Tipo Omie", options: data?.tipos ?? [], selected: tiposSel },
  ];

  return (
    <div className="space-y-3">
      <VizFilters
        range={range} onRangeChange={setRange} dims={dims}
        onDimChange={(k, sel) =>
          k === "cat" ? setCats(sel) : setTiposSel(sel)}
        right={
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-ww-textMuted">Data por</span>
            {([["emissao", "Emissão PV/OS"], ["faturamento", "Faturamento"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setBase(k)}
                title={k === "emissao" ? "Quando a venda foi criada no Omie" : "Quando a NF saiu"}
                className={`px-2 py-0.5 rounded border transition ${
                  base === k ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                             : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
                {l}
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

      {/* O alarme. Só aparece quando há o que alarmar — banner permanente vira
          paisagem e para de ser lido. */}
      {(negativa || muitoBaixa || faltaCusto) && (
        <div className="bg-rose-500/10 border border-rose-500/40 rounded-xl px-3 py-2.5">
          <ul className="text-[12px] font-semibold text-rose-800 dark:text-rose-200 space-y-0.5">
            {negativa && (
              <li>
                <button type="button" onClick={() => setFaixaSel("Negativa")} className="hover:underline text-left">
                  {negativa.vendas} venda(s) abaixo do custo — prejuízo de {brl(Math.abs(negativa.margem))}
                </button>
              </li>
            )}
            {muitoBaixa && (
              <li>
                <button type="button" onClick={() => setFaixaSel("0–15%")} className="hover:underline text-left">
                  {muitoBaixa.vendas} com margem abaixo de 15%
                </button>
              </li>
            )}
            {faltaCusto && (
              <li>
                <button type="button" onClick={() => setFaixaSel("Sem custo lançado")} className="hover:underline text-left">
                  {faltaCusto.vendas} Mix/Mercantil sem compra ligada — {brl(faltaCusto.receita)} sem custo apurado
                </button>
              </li>
            )}
          </ul>
          <p className="text-[11px] text-ww-textMuted mt-1">
            Clique num alarme pra filtrar a lista.
            {servico && ` As ${servico.vendas} de Serviço puro ficam fora: pela regra, não geram compra.`}
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
        <StatTile label="Falta custo"
                  value={data ? String(data.falta_custo.vendas) : "—"}
                  hint={data
                    ? `de ${data.falta_custo.de} que exigem compra · ${brl(data.falta_custo.receita)}`
                    : undefined}
                  higherIsBetter={false} />
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
              {/* Faixa sem margem não mostra R$ de margem: somar ali seria somar
                  o desconhecido. A condição antiga comparava contra um rótulo que
                  não existia, então nunca era verdadeira. */}
              {!FAIXAS_SEM_MARGEM.has(f.faixa) && ` · ${brl(f.margem)}`}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ChartFrame
          title="Distribuição das margens"
          subtitle='Composição das vendas com custo medido. "Sem custo lançado" e "Serviço (sem compra)" ficam fora: são estados, não posições numa escala de margem'
          series={DIST_SERIES}
          rows={distribuicao}
          valueFormat={(v) => `${Number(v) || 0}`}
          loading={loading}
          height={280}
        >
          <VizPie
            slices={distribuicao.filter((d) => d.vendas > 0).map((d) => ({ label: d.x, value: d.vendas }))}
            valueFormat={(v) => `${v} venda${v === 1 ? "" : "s"}`}
            totalLabel="vendas medidas"
          />
        </ChartFrame>

        <ChartFrame
          title="Clientes por faixa de margem"
          subtitle="Margem de cada cliente, da melhor pra pior, com a cor da faixa em que ele cai. Só clientes com custo medido — sem custo, a margem seria 100% e o ranking premiaria a falta de dado"
          series={RANK_SERIES}
          rows={rankingClientes}
          valueFormat={(v) => `${Number(v) || 0}%`}
          loading={loading}
          height={280}
        >
          {/* A cor repete a FAIXA, então o range se lê sem consultar o eixo.
              Três tons e não cinco: vermelho abaixo de 15%, âmbar de 15 a 35%,
              azul acima — agrupar por semântica em vez de dar uma cor a cada
              faixa mantém os pares distinguíveis em daltonismo.
              Azul e não verde no bom: verde×vermelho mede ΔE 7.4 em
              deuteranopia, quase a mesma cor. Medido com
              scripts/validate_palette.js, não estimado no olho. O par âmbar×
              vermelho fica em 7.9 no tema claro, no piso — aceitável porque o
              comprimento da barra e a ordenação já carregam a margem. */}
          <VizBar rows={rankingClientes} series={RANK_SERIES}
                  layout="row" categoryWidth={190} valueFormat={(v) => `${v}%`}
                  slotDaLinha={(r) => {
                    const p = Number(r.pct);
                    return p < 15 ? 3 : p < 35 ? 2 : 0;
                  }} />
        </ChartFrame>
      </div>

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
