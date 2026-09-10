"use client";

// Financeiro consolidado — substitui Fluxo de Caixa + Contas a Pagar + Contas a
// Receber por uma tela com abas.
//
// ── O que estava errado ──────────────────────────────────────────────────────
// A mesma pergunta era respondida em três telas com nomes diferentes: aging em
// Pagar e em Receber, "emitido vs pago" e "emitido vs recebido" (o mesmo gráfico
// com uma palavra trocada), duas tabelas de detalhe com as mesmas colunas.
//
// A causa era estrutural: a NATUREZA do título tinha virado TELA. Como havia uma
// tela por natureza, cada gráfico precisava existir duas vezes.
//
// ── A correção ───────────────────────────────────────────────────────────────
// A natureza vira FILTRO. As funções bi.tit_* já eram simétricas (todas recebem
// p_natureza), então unificar não custou SQL novo — só parar de duplicar a
// leitura.
//
// ── O que NÃO mudou, de propósito ────────────────────────────────────────────
// A aba Fluxo monta o FluxoCaixaView existente, inteiro e sem alteração. Ali
// estão a curva com e sem agendamento, a simulação de receber os atrasos, o
// envio ao Omie, o rateio em datas, a renegociação e os relatórios. Reescrever
// aquilo para "encaixar no layout novo" seria a maneira mais fácil de perder
// função sem perceber.

import { useCallback, useEffect, useMemo, useState } from "react";
import FluxoCaixaView from "./FluxoCaixaView";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import VizBar from "@/components/viz/VizBar";
import VizTable, { type Col } from "@/components/viz/VizTable";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlK = (v: number) =>
  Math.abs(v) >= 1000
    ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`
    : brl(v);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesBr = (iso: string) => {
  const [a, m] = iso.slice(0, 7).split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
};

type Faixa   = { faixa: string; ord: number; qtd: number; valor: number };
type Horiz   = { vencido: number; vence_no_horizonte: number; futuro_contratado: number;
                 qtd_vencido: number; qtd_no_horizonte: number; qtd_futuro: number };
type Mensal  = { mes: string; emitido: number; pago: number };
type Resumo  = { saldo_aberto: number; qtd_titulos: number; a_vencer: number;
                 em_atraso: number; esta_semana: number; prox_30_dias: number;
                 total_pago_periodo: number };
type Coorte  = { mes: string; faturado: number; recebido: number; a_vencer: number;
                 vencido: number; sem_titulo: number; pct_recebido: number | null };
type CoorteCat = Coorte & { categoria: string };
type Top     = { contraparte: string; valor: number; qtd: number };

type Payload = {
  periodo: { from: string; to: string };
  aging:     { sai: Faixa[]; entra: Faixa[] };
  horizonte: { sai: Horiz[]; entra: Horiz[] };
  mensal:    { sai: Mensal[]; entra: Mensal[] };
  resumo:    { sai: Resumo | null; entra: Resumo | null };
  coorte: Coorte[];
  coorte_categoria: CoorteCat[];
  top: { sai: Top[]; entra: Top[] };
  error?: string;
};

type Lado = "ambos" | "entra" | "sai";
type Aba  = "fluxo" | "analise" | "recebiveis";

export default function FinanceiroView() {
  const [aba, setAba] = useState<Aba>("fluxo");
  const [lado, setLado] = useState<Lado>("ambos");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  /** Carrega uma vez e só quando a aba precisa: a de Fluxo tem a própria rota,
   *  e buscar isto no primeiro render atrasaria a tela que abre por padrão. */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/bi/financeiro", { cache: "no-store" });
      const j = (await r.json()) as Payload;
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null); setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (aba !== "fluxo" && !data) void load();
  }, [aba, data, load]);

  return (
    <div className="space-y-3.5">
      <div className="flex items-center gap-3 flex-wrap bg-ww-panel border border-ww-border rounded-xl p-2">
        <div className="flex items-center gap-1">
          {([["fluxo", "Fluxo", "quando o caixa aperta — e a mesa pra reagendar"],
             ["analise", "Análise", "por que aperta — aging, horizonte, mês a mês"],
             ["recebiveis", "Recebíveis", "onde o dinheiro trava, por tipo de venda"]] as const)
            .map(([k, l, hint]) => (
              <button key={k} type="button" onClick={() => setAba(k)} title={hint}
                className={`px-3 py-1.5 text-[12px] rounded-lg border transition ${
                  aba === k ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                            : "border-transparent text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover"}`}>
                {l}
              </button>
          ))}
        </div>

        {/* O seletor que substituiu duas telas. Só faz sentido onde há os dois
            lados — no Fluxo a curva já mostra entrada e saída junto. */}
        {aba !== "fluxo" && (
          <>
            <span className="h-6 w-px bg-ww-border" />
            <div className="flex items-center gap-1">
              <span className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint mr-1">Lado</span>
              {([["ambos", "Ambos"], ["entra", "Entra"], ["sai", "Sai"]] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => setLado(k)}
                  className={`px-2.5 py-1 text-[11.5px] rounded-md border transition ${
                    lado === k
                      ? k === "entra" ? "border-emerald-500 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 font-semibold"
                      : k === "sai"   ? "border-rose-500 text-rose-700 dark:text-rose-300 bg-rose-500/10 font-semibold"
                      :                 "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                      : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
                  {l}
                </button>
              ))}
            </div>
          </>
        )}

        <span className="ml-auto text-[10.5px] text-ww-textFaint">
          Recebe <strong className="text-ww-textMuted">Safe</strong> · paga{" "}
          <strong className="text-ww-textMuted">Safe + CDG + Water</strong>
        </span>
      </div>

      {err && (
        <div className="p-3 rounded-lg border border-rose-500/40 bg-rose-500/10 text-[12px] text-rose-700 dark:text-rose-300">
          <strong>Erro:</strong> {err}
        </div>
      )}

      {/* A tela de fluxo INTEIRA, sem alteração. Todas as funções continuam. */}
      {aba === "fluxo" && <FluxoCaixaView />}

      {aba === "analise" && <Analise data={data} lado={lado} loading={loading} />}
      {aba === "recebiveis" && <Recebiveis data={data} loading={loading} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Analise({ data, lado, loading }: { data: Payload | null; lado: Lado; loading: boolean }) {
  const mostraEntra = lado !== "sai";
  const mostraSai   = lado !== "entra";

  /** Aging dos dois lados no MESMO eixo de faixas. As funções devolvem faixas
   *  iguais por construção, então casar por nome é seguro. */
  const aging = useMemo(() => {
    if (!data) return [];
    const chaves = new Map<string, { ord: number }>();
    for (const f of [...data.aging.sai, ...data.aging.entra]) {
      if (!chaves.has(f.faixa)) chaves.set(f.faixa, { ord: f.ord });
    }
    return Array.from(chaves.entries())
      .sort((a, b) => a[1].ord - b[1].ord)
      .map(([faixa]) => ({
        x: faixa,
        Sai:   data.aging.sai.find((f) => f.faixa === faixa)?.valor ?? 0,
        Entra: data.aging.entra.find((f) => f.faixa === faixa)?.valor ?? 0,
      }))
      // "A vencer" e "Futuro" não são atraso — o gráfico é do que JÁ venceu.
      .filter((r) => !/^a vencer|futuro/i.test(r.x));
  }, [data]);

  const horizonte = useMemo(() => {
    if (!data) return [];
    const s = data.horizonte.sai[0], e = data.horizonte.entra[0];
    return [
      { x: "Vencido",   Sai: s?.vencido ?? 0,           Entra: e?.vencido ?? 0 },
      { x: "No horizonte (90d)", Sai: s?.vence_no_horizonte ?? 0, Entra: e?.vence_no_horizonte ?? 0 },
      { x: "Futuro contratado",  Sai: s?.futuro_contratado ?? 0,  Entra: e?.futuro_contratado ?? 0 },
    ];
  }, [data]);

  /** Emitido × liquidado. O rótulo muda com o lado; o gráfico, não — era essa
   *  diferença de uma palavra que sustentava dois gráficos em duas telas. */
  const mensal = useMemo(() => {
    if (!data) return [];
    const fonte = lado === "entra" ? data.mensal.entra
                : lado === "sai"   ? data.mensal.sai
                : null;
    if (fonte) return fonte.map((m) => ({ x: mesBr(`${m.mes}-01`), Emitido: m.emitido, Liquidado: m.pago }));
    // "Ambos": soma os dois lados por mês seria misturar entrada com saída, o
    // que não significa nada. Mostra os dois emitidos lado a lado.
    const meses = Array.from(new Set([...data.mensal.entra, ...data.mensal.sai].map((m) => m.mes))).sort();
    return meses.map((m) => ({
      x: mesBr(`${m}-01`),
      Entra: data.mensal.entra.find((x) => x.mes === m)?.emitido ?? 0,
      Sai:   data.mensal.sai.find((x) => x.mes === m)?.emitido ?? 0,
    }));
  }, [data, lado]);

  const serieLado = (): SeriesDef[] => [
    ...(mostraEntra ? [{ key: "Entra", label: "Entra", slot: 5, mark: "rect" } as SeriesDef] : []),
    ...(mostraSai   ? [{ key: "Sai",   label: "Sai",   slot: 3, mark: "rect" } as SeriesDef] : []),
  ];
  const serieMensal: SeriesDef[] = lado === "ambos" ? serieLado() : [
    { key: "Emitido",   label: "Emitido", slot: 0, mark: "rect" },
    { key: "Liquidado", label: lado === "entra" ? "Recebido" : "Pago", slot: 5, mark: "rect" },
  ];

  const top = lado === "entra" ? data?.top.entra : data?.top.sai;
  const topRows = (top ?? []).map((t) => ({ x: t.contraparte, valor: t.valor }));

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
        <ChartFrame
          title="Vencido — por idade do atraso"
          subtitle="Um gráfico para os dois lados. Antes eram dois idênticos, um em Contas a Pagar e outro em Contas a Receber."
          series={serieLado()} rows={aging} valueFormat={(v) => brl(Number(v))}
          loading={loading} height={260}
        >
          {(vis) => <VizBar rows={aging} series={serieLado().filter((s) => vis.some((v) => v.key === s.key))}
                            valueFormat={(v) => brlK(v)} />}
        </ChartFrame>

        <ChartFrame
          title="Onde está o saldo aberto"
          subtitle="Vencido · o que vence em 90 dias · o que está contratado além disso. O futuro contratado é grande e não é problema — só não é caixa de curto prazo."
          series={serieLado()} rows={horizonte} valueFormat={(v) => brl(Number(v))}
          loading={loading} height={260}
        >
          {(vis) => <VizBar rows={horizonte} series={serieLado().filter((s) => vis.some((v) => v.key === s.key))}
                            valueFormat={(v) => brlK(v)} />}
        </ChartFrame>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
        <ChartFrame
          title={lado === "ambos" ? "Emitido por mês — entra × sai" : "Emitido × liquidado por mês"}
          subtitle={lado === "ambos"
            ? "Com os dois lados, comparar o EMITIDO de cada um: somar entrada com saída num total não significaria nada."
            : "O passado, mês a mês. A diferença entre emitir e liquidar é o que a curva do fluxo projeta pra frente."}
          series={serieMensal} rows={mensal} valueFormat={(v) => brl(Number(v))}
          loading={loading} height={260}
        >
          {(vis) => <VizBar rows={mensal} series={serieMensal.filter((s) => vis.some((v) => v.key === s.key))}
                            valueFormat={(v) => brlK(v)} />}
        </ChartFrame>

        <ChartFrame
          title={lado === "entra" ? "Maiores clientes — recebido no período" : "Maiores fornecedores — pago no período"}
          subtitle="Liquidado de fato, não contratado. Responde para onde o dinheiro foi."
          series={[{ key: "valor", label: "Valor", slot: lado === "entra" ? 5 : 3, mark: "rect" }]}
          rows={topRows} valueFormat={(v) => brl(Number(v))} loading={loading} height={260}
        >
          <VizBar rows={topRows}
            series={[{ key: "valor", label: "Valor", slot: lado === "entra" ? 5 : 3, mark: "rect" }]}
            layout="row" categoryWidth={190} valueFormat={(v) => brlK(v)} />
        </ChartFrame>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const COLS_COORTE: Col<Record<string, unknown>>[] = [
  { key: "categoria", label: "Tipo de venda", w: 140 },
  { key: "faturado",  label: "Faturado",  tipo: "money", w: 120 },
  { key: "recebido",  label: "Recebido",  tipo: "money", w: 120 },
  { key: "a_vencer",  label: "A vencer",  tipo: "money", w: 120 },
  { key: "vencido",   label: "Vencido",   tipo: "money", w: 120 },
  { key: "sem_titulo", label: "Sem título", tipo: "money", w: 110 },
  { key: "pct",       label: "% recebido", w: 96,
    fmt: (v) => v == null ? "—" : `${Number(v).toFixed(1).replace(".", ",")}%` },
];

function Recebiveis({ data, loading }: { data: Payload | null; loading: boolean }) {
  const [mesSel, setMesSel] = useState<string | null>(null);

  /** Coorte total: do que faturei em cada mês, quanto virou dinheiro. É a
   *  pergunta "o que aconteceu com o faturamento de julho", que nenhuma das três
   *  telas antigas respondia. */
  const coorte = useMemo(() => (data?.coorte ?? []).map((c) => ({
    x: mesBr(c.mes),
    mesIso: c.mes,
    Recebido: Number(c.recebido) || 0,
    "A vencer": Number(c.a_vencer) || 0,
    Vencido: Number(c.vencido) || 0,
    "Sem título": Number(c.sem_titulo) || 0,
    faturado: Number(c.faturado) || 0,
    pct: c.pct_recebido,
  })), [data]);

  /** Por tipo de venda — no mês escolhido, ou no período todo. */
  const porCategoria = useMemo(() => {
    const linhas = (data?.coorte_categoria ?? [])
      .filter((c) => !mesSel || c.mes.slice(0, 7) === mesSel.slice(0, 7));
    const acc = new Map<string, { faturado: number; recebido: number; a_vencer: number;
                                  vencido: number; sem_titulo: number }>();
    for (const c of linhas) {
      const a = acc.get(c.categoria) ?? { faturado: 0, recebido: 0, a_vencer: 0, vencido: 0, sem_titulo: 0 };
      a.faturado += Number(c.faturado) || 0;
      a.recebido += Number(c.recebido) || 0;
      a.a_vencer += Number(c.a_vencer) || 0;
      a.vencido  += Number(c.vencido)  || 0;
      a.sem_titulo += Number(c.sem_titulo) || 0;
      acc.set(c.categoria, a);
    }
    return Array.from(acc.entries())
      .map(([categoria, v]) => ({
        x: categoria, categoria, ...v,
        pct: v.faturado > 0 ? (v.recebido / v.faturado) * 100 : null,
      }))
      .sort((a, b) => b.faturado - a.faturado);
  }, [data, mesSel]);

  // Empilhado: as três parcelas somam o faturado do mês, então empilhar é a
  // forma honesta — a altura total É o faturamento.
  const serieCoorte: SeriesDef[] = [
    { key: "Recebido",   label: "Recebido",   slot: 5, mark: "rect" },
    { key: "A vencer",   label: "A vencer",   slot: 0, mark: "rect" },
    { key: "Vencido",    label: "Vencido",    slot: 3, mark: "rect" },
    { key: "Sem título", label: "Sem título", slot: 2, mark: "rect" },
  ];

  const pior = useMemo(
    () => porCategoria.length ? porCategoria.reduce((m, c) => ((c.pct ?? 100) < (m.pct ?? 100) ? c : m)) : null,
    [porCategoria],
  );

  return (
    <div className="space-y-3.5">
      <ChartFrame
        title="Do que faturei, quanto virou dinheiro"
        subtitle="Cada coluna é um mês de FATURAMENTO, repartido no destino do recebível. A altura é o faturado do mês — as partes somam o total, por isso empilha. Clique num mês pra abrir por tipo de venda."
        series={serieCoorte} rows={coorte} valueFormat={(v) => brl(Number(v))}
        loading={loading} height={300}
      >
        {(vis) => (
          <VizBar rows={coorte} stacked totalNoTopo
            series={serieCoorte.filter((s) => vis.some((v) => v.key === s.key))}
            valueFormat={(v) => brlK(v)} />
        )}
      </ChartFrame>

      <div className="flex items-center gap-2 flex-wrap px-1">
        <span className="text-[10px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">Mês</span>
        <button type="button" onClick={() => setMesSel(null)}
          className={`px-2 py-0.5 text-[11px] rounded border transition ${
            !mesSel ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                    : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
          Todos
        </button>
        {coorte.map((c) => (
          <button key={c.mesIso} type="button" onClick={() => setMesSel(c.mesIso)}
            title={`${brl(c.faturado)} faturado · ${c.pct ?? "—"}% recebido`}
            className={`px-2 py-0.5 text-[11px] rounded border transition tabular-nums ${
              mesSel === c.mesIso ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                                  : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
            {c.x}{c.pct != null && <span className="ml-1 opacity-70">{Math.round(c.pct)}%</span>}
          </button>
        ))}
      </div>

      {pior && (
        <div className="px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-[11.5px] text-amber-800 dark:text-amber-200">
          Pior conversão {mesSel ? `em ${mesBr(mesSel)}` : "no período"}:{" "}
          <strong>{pior.categoria}</strong> — {pior.pct?.toFixed(1).replace(".", ",")}% recebido de{" "}
          {brl(pior.faturado)}, com <strong>{brl(pior.vencido)}</strong> vencido.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
        <ChartFrame
          title={`Por tipo de venda${mesSel ? ` — ${mesBr(mesSel)}` : ""}`}
          subtitle="Onde o recebível trava. Projetos atrasam diferente de avulsos, e o total escondia isso."
          series={serieCoorte} rows={porCategoria} valueFormat={(v) => brl(Number(v))}
          loading={loading} height={280}
        >
          {(vis) => (
            <VizBar rows={porCategoria.map((c) => ({
                x: c.categoria, Recebido: c.recebido, "A vencer": c.a_vencer,
                Vencido: c.vencido, "Sem título": c.sem_titulo }))}
              stacked layout="row" categoryWidth={130}
              series={serieCoorte.filter((s) => vis.some((v) => v.key === s.key))}
              valueFormat={(v) => brlK(v)} />
          )}
        </ChartFrame>

        <VizTable
          title={`Detalhe por tipo${mesSel ? ` — ${mesBr(mesSel)}` : ""}`}
          subtitle="Os mesmos números do gráfico, para conferir e exportar."
          cols={COLS_COORTE}
          rows={porCategoria as unknown as Record<string, unknown>[]}
          ordemInicial="faturado"
          loading={loading}
          altura={280}
          totalizar={["faturado", "recebido", "a_vencer", "vencido", "sem_titulo"]}
        />
      </div>
    </div>
  );
}
