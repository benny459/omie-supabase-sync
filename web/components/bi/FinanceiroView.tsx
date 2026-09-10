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
import PainelRedim from "@/components/viz/PainelRedim";
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
type Atraso  = { contraparte: string; cnpj: string | null; titulos: number; valor: number;
                 atraso_max: number; atraso_medio: number;
                 ate_30: number; de_31_90: number; mais_90: number;
                 vencimento_mais_antigo: string | null };

type Payload = {
  periodo: { from: string; to: string };
  aging:     { sai: Faixa[]; entra: Faixa[] };
  horizonte: { sai: Horiz[]; entra: Horiz[] };
  mensal:    { sai: Mensal[]; entra: Mensal[] };
  resumo:    { sai: Resumo | null; entra: Resumo | null };
  coorte: Coorte[];
  coorte_categoria: CoorteCat[];
  top: { sai: Top[]; entra: Top[] };
  atraso: { sai: Atraso[]; entra: Atraso[] };
  error?: string;
};

/** "Receber" e "Pagar", não "Entra" e "Sai".
 *
 *  Entra/sai descreve o movimento no caixa; receber/pagar é como o financeiro
 *  chama, e é o nome das telas que esta substitui. Usar o vocabulário de quem
 *  opera evita a tradução mental a cada leitura. */
type Lado = "ambos" | "receber" | "pagar";
/** Cores translúcidas por natureza: vermelho paga, verde recebe. Fundo com
 *  alpha em vez de sólido porque o chip fica sobre painel escuro — cor cheia
 *  competiria com os gráficos, que são o conteúdo. */
const LADOS = [
  { k: "ambos" as const, label: "Ambos",
    on:  "border-ww-accent/70 text-ww-accent bg-ww-accent/15 font-semibold shadow-[0_0_0_3px_rgb(var(--color-ww-accent)/0.08)]",
    off: "border-ww-border/70 text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover" },
  { k: "receber" as const, label: "Receber",
    on:  "border-emerald-500/70 text-emerald-600 dark:text-emerald-300 bg-emerald-500/15 font-semibold shadow-[0_0_0_3px_rgba(16,185,129,0.10)]",
    off: "border-ww-border/70 text-ww-textMuted hover:text-emerald-600 dark:hover:text-emerald-300 hover:border-emerald-500/40 hover:bg-emerald-500/[0.07]" },
  { k: "pagar" as const, label: "Pagar",
    on:  "border-rose-500/70 text-rose-600 dark:text-rose-300 bg-rose-500/15 font-semibold shadow-[0_0_0_3px_rgba(244,63,94,0.10)]",
    off: "border-ww-border/70 text-ww-textMuted hover:text-rose-600 dark:hover:text-rose-300 hover:border-rose-500/40 hover:bg-rose-500/[0.07]" },
];

type Aba  = "fluxo" | "analise" | "recebiveis";

/** Cada aba com a própria cor, e um ponto que aparece mesmo na aba inativa.
 *
 *  Três botões cinzas num trilho cinza só diziam "sou o do meio". Com cor, a
 *  aba passa a ser reconhecida antes de ser lida — e o ponto sempre visível é o
 *  que faz a cor servir também pra escolher, não só pra confirmar o que já foi
 *  escolhido. Recebíveis herda o verde de "Receber", que já é o vocabulário da
 *  tela; Fluxo fica no azul do caixa; Análise no violeta, que não é status. */
const ABAS = [
  { k: "fluxo" as const, label: "Fluxo",
    hint: "quando o caixa aperta — e a mesa pra reagendar",
    ponto: "bg-sky-500",
    on:  "bg-sky-500/15 text-sky-700 dark:text-sky-300 font-semibold ring-1 ring-sky-500/45 shadow-sm",
    off: "text-ww-textMuted hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-500/[0.08]" },
  { k: "analise" as const, label: "Análise",
    hint: "por que aperta — aging, horizonte, mês a mês",
    ponto: "bg-violet-500",
    on:  "bg-violet-500/15 text-violet-700 dark:text-violet-300 font-semibold ring-1 ring-violet-500/45 shadow-sm",
    off: "text-ww-textMuted hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-500/[0.08]" },
  { k: "recebiveis" as const, label: "Recebíveis",
    hint: "onde o dinheiro trava, por tipo de venda",
    ponto: "bg-emerald-500",
    on:  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-semibold ring-1 ring-emerald-500/45 shadow-sm",
    off: "text-ww-textMuted hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-500/[0.08]" },
];

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
      <div className="flex items-center gap-3 flex-wrap bg-ww-panel/80 backdrop-blur-sm border border-ww-border rounded-xl px-2.5 py-2 shadow-sm">
        {/* Abas em controle segmentado: um trilho só, com a ativa em relevo.
            Botões soltos lado a lado não diziam que eram alternativas entre si. */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-ww-bg/60 border border-ww-border/60">
          {ABAS.map(({ k, label, hint, ponto, on, off }) => (
            <button key={k} type="button" onClick={() => setAba(k)} title={hint}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] rounded-md transition-all duration-150 ${
                aba === k ? on : off}`}>
              <span aria-hidden className={`w-1.5 h-1.5 rounded-full transition-opacity ${ponto} ${
                aba === k ? "opacity-100" : "opacity-45"}`} />
              {label}
            </button>
          ))}
        </div>

        {/* O seletor que substituiu duas telas. Só faz sentido onde há os dois
            lados — no Fluxo a curva já mostra entrada e saída junto. */}
        {aba !== "fluxo" && (
          <>
            <span className="h-6 w-px bg-ww-border" />
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint mr-0.5">Mostrar</span>
              {LADOS.map(({ k, label, on, off }) => (
                <button key={k} type="button" onClick={() => setLado(k)}
                  className={`px-3 py-1.5 text-[11.5px] rounded-lg border transition-all duration-150 ${
                    lado === k ? on : off}`}>
                  {label}
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

      {/* Resumo do que está em aberto. Faltava: as abas novas mostravam gráficos
          sem nenhum número âncora, e "quanto é isso no total" ficava sem
          resposta. Respeita o seletor — é o mesmo recorte dos gráficos. */}
      {aba !== "fluxo" && data && <Resumo data={data} lado={lado} />}

      {/* A tela de fluxo INTEIRA, sem alteração. Todas as funções continuam. */}
      {aba === "fluxo" && <FluxoCaixaView />}

      {aba === "analise" && <Analise data={data} lado={lado} loading={loading} />}
      {aba === "recebiveis" && <Recebiveis data={data} loading={loading} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** Faixa de resumo. Verde e vermelho translúcidos, e o número em tinta de texto
 *  quando é neutro — cor só onde ela significa algo. */
function Resumo({ data, lado }: { data: Payload; lado: Lado }) {
  const r = data.resumo.entra, p = data.resumo.sai;
  const cards: Array<{ rot: string; val: string; sub: string; tom: "receber" | "pagar" | "neutro" }> = [];

  if (lado !== "pagar" && r) {
    cards.push(
      { rot: "A receber — em aberto", val: brl(r.saldo_aberto),
        sub: `${r.qtd_titulos} títulos`, tom: "receber" },
      { rot: "A receber — vencido", val: brl(r.em_atraso),
        sub: `${brlK(r.prox_30_dias)} vencem em 30 dias`, tom: "receber" },
    );
  }
  if (lado !== "receber" && p) {
    cards.push(
      { rot: "A pagar — em aberto", val: brl(p.saldo_aberto),
        sub: `${p.qtd_titulos} títulos`, tom: "pagar" },
      { rot: "A pagar — vencido", val: brl(p.em_atraso),
        sub: `${brlK(p.prox_30_dias)} vencem em 30 dias`, tom: "pagar" },
    );
  }
  if (lado === "ambos" && r && p) {
    cards.push({
      rot: "Saldo líquido em aberto",
      val: brl(r.saldo_aberto - p.saldo_aberto),
      sub: "a receber menos a pagar, sem prazo",
      tom: "neutro",
    });
  }

  const estilo = {
    receber: "border-emerald-500/25 bg-emerald-500/[0.06]",
    pagar:   "border-rose-500/25 bg-rose-500/[0.06]",
    neutro:  "border-ww-border bg-ww-panel",
  };
  const tinta = {
    receber: "text-emerald-600 dark:text-emerald-300",
    pagar:   "text-rose-600 dark:text-rose-300",
    neutro:  "text-ww-text",
  };

  return (
    <div className={`grid gap-3 ${cards.length >= 5 ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-4"}`}>
      {cards.map((c) => (
        <div key={c.rot} className={`rounded-xl border p-3 transition-colors ${estilo[c.tom]}`}>
          <div className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">{c.rot}</div>
          <div className={`text-[19px] font-bold tabular-nums tracking-[-0.5px] mt-1 ${tinta[c.tom]}`}>
            {c.val}
          </div>
          <div className="text-[10.5px] text-ww-textMuted mt-0.5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

function Analise({ data, lado, loading }: { data: Payload | null; lado: Lado; loading: boolean }) {
  const mostraEntra = lado !== "pagar";
  const mostraSai   = lado !== "receber";

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
    const fonte = lado === "receber" ? data.mensal.entra
                : lado === "pagar"   ? data.mensal.sai
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
    ...(mostraEntra ? [{ key: "Entra", label: "A receber", slot: 5, mark: "rect" } as SeriesDef] : []),
    ...(mostraSai   ? [{ key: "Sai",   label: "A pagar",  slot: 3, mark: "rect" } as SeriesDef] : []),
  ];
  const serieMensal: SeriesDef[] = lado === "ambos" ? serieLado() : [
    { key: "Emitido",   label: "Emitido", slot: 0, mark: "rect" },
    { key: "Liquidado", label: lado === "receber" ? "Recebido" : "Pago", slot: 5, mark: "rect" },
  ];

  const top = lado === "receber" ? data?.top.entra : data?.top.sai;
  const topRows = (top ?? []).map((t) => ({ x: t.contraparte, valor: t.valor }));

  // Um painel por linha, largura cheia.
  //
  // Antes eram dois por linha. Num monitor comum isso dava ~600px a cada um, e a
  // tabela da direita passava a rolar horizontalmente pra caber oito colunas de
  // valor — ou seja: metade do dado ficava fora da tela e só aparecia a quem
  // soubesse que dava pra rolar. Empilhado, cada painel recebe a largura toda e
  // o ajuste de tamanho vira vertical, que é o eixo que o scroll da página já
  // resolve naturalmente.
  return (
    <div className="space-y-3.5">
      <PainelRedim id="fin-aging" padrao={260}>
        {(h) => (
          <ChartFrame
            title="Vencido — por idade do atraso"
            subtitle="Um gráfico para os dois lados. Antes eram dois idênticos — um em Contas a Pagar, outro em Contas a Receber."
            series={serieLado()} rows={aging} valueFormat={(v) => brl(Number(v))}
            loading={loading} height={h}
          >
            {(vis) => <VizBar rows={aging} series={serieLado().filter((s) => vis.some((v) => v.key === s.key))}
                              valueFormat={(v) => brlK(v)} />}
          </ChartFrame>
        )}
      </PainelRedim>

      <PainelRedim id="fin-horizonte" padrao={260}>
        {(h) => (
          <ChartFrame
            title="Onde está o saldo aberto"
            subtitle="Vencido · o que vence em 90 dias · o que está contratado além disso. O futuro contratado é grande e não é problema — só não é caixa de curto prazo."
            series={serieLado()} rows={horizonte} valueFormat={(v) => brl(Number(v))}
            loading={loading} height={h}
          >
            {(vis) => <VizBar rows={horizonte} series={serieLado().filter((s) => vis.some((v) => v.key === s.key))}
                              valueFormat={(v) => brlK(v)} />}
          </ChartFrame>
        )}
      </PainelRedim>

      <PainelRedim id="fin-mensal" padrao={280}>
        {(h) => (
          <ChartFrame
            title={lado === "ambos" ? "Emitido por mês — receber × pagar" : "Emitido × liquidado por mês"}
            subtitle={lado === "ambos"
              ? "Com os dois lados, comparar o EMITIDO de cada um. Somar a receber com a pagar num total só não significaria nada."
              : "O passado, mês a mês. A diferença entre emitir e liquidar é o que a curva do fluxo projeta pra frente."}
            series={serieMensal} rows={mensal} valueFormat={(v) => brl(Number(v))}
            loading={loading} height={h}
          >
            {(vis) => <VizBar rows={mensal} series={serieMensal.filter((s) => vis.some((v) => v.key === s.key))}
                              valueFormat={(v) => brlK(v)} />}
          </ChartFrame>
        )}
      </PainelRedim>

      <PainelRedim id="fin-top" padrao={330}>
        {(h) => (
          <ChartFrame
            title={lado === "receber" ? "Maiores clientes — recebido no período" : "Maiores fornecedores — pago no período"}
            subtitle="Liquidado de fato, não contratado. Responde para onde o dinheiro foi."
            series={[{ key: "valor", label: "Valor", slot: lado === "receber" ? 5 : 3, mark: "rect" }]}
            rows={topRows} valueFormat={(v) => brl(Number(v))} loading={loading} height={h}
          >
            <VizBar rows={topRows}
              series={[{ key: "valor", label: "Valor", slot: lado === "receber" ? 5 : 3, mark: "rect" }]}
              layout="row" categoryWidth={230} valueFormat={(v) => brlK(v)} />
          </ChartFrame>
        )}
      </PainelRedim>

      <EmAtraso data={data} lado={lado} loading={loading} />
    </div>
  );
}

const COLS_ATRASO: Col<Record<string, unknown>>[] = [
  { key: "contraparte", label: "Contraparte", w: 260 },
  { key: "titulos",     label: "Títulos",     tipo: "num",   w: 74 },
  { key: "valor",       label: "Em atraso",   tipo: "money", w: 128 },
  { key: "ate_30",      label: "Até 30d",     tipo: "money", w: 118 },
  { key: "de_31_90",    label: "31–90d",      tipo: "money", w: 118 },
  { key: "mais_90",     label: "90d+",        tipo: "money", w: 128 },
  { key: "atraso_max",  label: "Pior atraso", tipo: "dias",  w: 96 },
  { key: "vencimento_mais_antigo", label: "Mais antigo", tipo: "date", w: 100 },
];

/** Quem concentra o vencido, dos dois lados.
 *
 *  Gráfico e lista juntos de propósito: o gráfico mostra a CONCENTRAÇÃO (dois ou
 *  três nomes costumam responder pela maior parte) e a lista mostra a IDADE, que
 *  é o que separa atraso operacional de passivo morto. Um sem o outro engana. */
function EmAtraso({ data, lado, loading }: { data: Payload | null; lado: Lado; loading: boolean }) {
  const linhas = useMemo(() => {
    if (!data) return [];
    const r = lado === "pagar" ? [] : data.atraso.entra;
    const p = lado === "receber" ? [] : data.atraso.sai;
    // Em "ambos", os dois lados na mesma lista ficariam somados sem sentido —
    // cliente que deve e fornecedor a quem devo não se compensam num ranking.
    // Então a lista mostra o lado com mais dinheiro parado e diz qual é.
    const somaR = r.reduce((a, x) => a + Number(x.valor || 0), 0);
    const somaP = p.reduce((a, x) => a + Number(x.valor || 0), 0);
    return (lado === "ambos" ? (somaP >= somaR ? p : r) : (lado === "receber" ? r : p))
      .map((x) => ({ ...x, valor: Number(x.valor) || 0 }));
  }, [data, lado]);

  const ehPagar = useMemo(() => {
    if (lado === "pagar") return true;
    if (lado === "receber") return false;
    const somaR = (data?.atraso.entra ?? []).reduce((a, x) => a + Number(x.valor || 0), 0);
    const somaP = (data?.atraso.sai ?? []).reduce((a, x) => a + Number(x.valor || 0), 0);
    return somaP >= somaR;
  }, [data, lado]);

  const topN = linhas.slice(0, 12).map((x) => ({
    x: x.contraparte,
    "Até 30d": Number(x.ate_30) || 0,
    "31–90d": Number(x.de_31_90) || 0,
    "90d+":   Number(x.mais_90) || 0,
  }));

  // Empilhado por idade: a altura é o total daquele nome, e a composição diz se
  // é atraso recente ou dívida antiga.
  const serie: SeriesDef[] = [
    { key: "Até 30d", label: "Até 30d", slot: 2, mark: "rect" },
    { key: "31–90d",  label: "31–90d",  slot: 0, mark: "rect" },
    { key: "90d+",    label: "90d+",    slot: 3, mark: "rect" },
  ];

  const total = linhas.reduce((a, x) => a + x.valor, 0);
  const velho = linhas.reduce((a, x) => a + (Number(x.mais_90) || 0), 0);

  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-3 flex-wrap px-3.5 py-2.5 rounded-xl border text-[11.5px] ${
        ehPagar ? "border-rose-500/25 bg-rose-500/[0.06] text-rose-800 dark:text-rose-200"
                : "border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-800 dark:text-emerald-200"}`}>
        <strong>{ehPagar ? "Fornecedores a quem devo" : "Clientes que me devem"}</strong>
        <span className="tabular-nums">{brl(total)} em atraso · {linhas.length} contrapartes</span>
        {velho > 0 && (
          <span className="ml-auto tabular-nums">
            <strong>{brl(velho)}</strong> com mais de 90 dias
            {total > 0 && ` (${Math.round((velho / total) * 100)}%)`}
          </span>
        )}
        {lado === "ambos" && (
          <span className="text-ww-textFaint">— use o seletor para ver o outro lado</span>
        )}
      </div>

      <PainelRedim id="fin-atraso-graf" padrao={330}>
        {(h) => (
          <ChartFrame
            title={`Concentração do vencido — ${ehPagar ? "fornecedores" : "clientes"}`}
            subtitle="Empilhado por idade do atraso: a altura é o total do nome, e a composição diz se é atraso recente ou dívida antiga."
            series={serie} rows={topN} valueFormat={(v) => brl(Number(v))}
            loading={loading} height={h}
          >
            {(vis) => (
              <VizBar rows={topN} stacked layout="row" categoryWidth={240}
                series={serie.filter((sr) => vis.some((v) => v.key === sr.key))}
                valueFormat={(v) => brlK(v)} />
            )}
          </ChartFrame>
        )}
      </PainelRedim>

      <PainelRedim id="fin-atraso-tab" padrao={340}>
        {(h) => (
          <VizTable
            title={`${ehPagar ? "Fornecedores" : "Clientes"} em atraso — detalhe`}
            subtitle="Ordenado pelo valor parado. A coluna 90d+ separa o que é operacional do que virou passivo."
            cols={COLS_ATRASO}
            rows={linhas as unknown as Record<string, unknown>[]}
            ordemInicial="valor"
            loading={loading}
            altura={h}
            totalizar={["valor", "ate_30", "de_31_90", "mais_90"]}
          />
        )}
      </PainelRedim>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** As parcelas em que o faturamento se reparte. A chave é a coluna da tabela E
 *  o p_bucket da função — manter o mesmo nome nos dois lados é o que evita um
 *  mapeamento no meio que ninguém lembra de atualizar. */
const BUCKETS: Record<string, string> = {
  faturado:   "Faturado",
  recebido:   "Recebido",
  a_vencer:   "A vencer",
  vencido:    "Vencido",
  sem_titulo: "Sem título",
};

const pctFmt = (v: unknown) =>
  v == null ? "—" : `${Number(v).toFixed(1).replace(".", ",")}%`;

/** A lista por trás de um número.
 *
 *  Abre sobre a tela em vez de empurrar o conteúdo: quem clica num valor quer
 *  ver quem o compõe e voltar, não perder o lugar na página. O cabeçalho repete
 *  o número clicado e o total da lista lado a lado — se algum dia divergirem, a
 *  divergência aparece aqui, não numa conferência manual. */
function DrillDetalhe({
  categoria, bucket, from, to, valorEsperado, onFechar,
}: {
  categoria: string | null;
  bucket: string;
  from: string;
  to: string;
  valorEsperado: number;
  onFechar: () => void;
}) {
  const [linhas, setLinhas] = useState<Record<string, unknown>[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /** Altura da lista em função da janela, medida depois da montagem — ler
   *  window durante o render quebraria qualquer render de servidor. */
  const [alturaLista, setAlturaLista] = useState(420);

  useEffect(() => {
    const medir = () => setAlturaLista(Math.max(240, Math.round(window.innerHeight * 0.55)));
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const q = new URLSearchParams({ from, to, bucket });
      if (categoria) q.set("categoria", categoria);
      try {
        const r = await fetch(`/api/bi/financeiro/detalhe?${q}`, { cache: "no-store" });
        const j = await r.json();
        if (!vivo) return;
        if (!r.ok) { setErro(j.error ?? r.statusText); return; }
        setLinhas(j.linhas as Record<string, unknown>[]);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { vivo = false; };
  }, [categoria, bucket, from, to]);

  // A coluna do bucket só existe quando acrescenta algo: em "faturado" ela
  // repetiria a coluna Faturado, e coluna duplicada faz duvidar de qual é a boa.
  const cols: Col<Record<string, unknown>>[] = [
    { key: "cliente",     label: "Cliente",     w: 300 },
    { key: "numero_doc",  label: "Doc",         w: 92 },
    { key: "dt_fat",      label: "Faturado em", tipo: "date",  w: 106 },
    ...(bucket === "faturado" ? [] : [
      { key: "valor", label: BUCKETS[bucket], tipo: "money" as const, w: 130 }]),
    { key: "faturado",    label: "Faturado",    tipo: "money", w: 122 },
    { key: "recebido",    label: "Recebido",    tipo: "money", w: 122 },
    { key: "a_vencer",    label: "A vencer",    tipo: "money", w: 122 },
    { key: "vencido",     label: "Vencido",     tipo: "money", w: 122 },
    { key: "atraso_dias", label: "Atraso",      tipo: "dias",  w: 84 },
    { key: "pct_recebido", label: "% recebido", w: 100, fmt: pctFmt },
  ];

  const somado = (linhas ?? []).reduce(
    (a, l) => a + (Number(l[bucket === "faturado" ? "faturado" : "valor"]) || 0), 0);
  const bate = Math.abs(somado - valorEsperado) < 0.5;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/55 backdrop-blur-sm"
      onClick={onFechar} role="dialog" aria-modal="true"
    >
      <div
        className="w-full max-w-[1240px] max-h-[88vh] flex flex-col gap-2.5 bg-ww-bg border border-ww-border rounded-2xl shadow-2xl p-3.5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold text-ww-text">
              {BUCKETS[bucket]} — {categoria ?? "todos os tipos de venda"}
            </h2>
            <p className="text-[11px] text-ww-textMuted mt-0.5">
              Cada linha é um documento faturado. Período {from.slice(0, 10)} a {to.slice(0, 10)}.
            </p>
          </div>
          <div className="ml-auto text-right shrink-0">
            <div className="text-[17px] font-bold tabular-nums text-ww-text">{brl(valorEsperado)}</div>
            <div className={`text-[10.5px] tabular-nums ${
              linhas == null ? "text-ww-textFaint"
                : bate ? "text-emerald-600 dark:text-emerald-400"
                       : "text-amber-600 dark:text-amber-400"}`}>
              {linhas == null ? "carregando…"
                : bate ? `✓ a lista soma o mesmo · ${linhas.length} documentos`
                       : `⚠ lista soma ${brl(somado)}`}
            </div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar"
            className="shrink-0 w-7 h-7 rounded-lg border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition">
            ✕
          </button>
        </div>

        {erro && (
          <div className="p-3 rounded-lg border border-rose-500/40 bg-rose-500/10 text-[12px] text-rose-700 dark:text-rose-300">
            <strong>Erro:</strong> {erro}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          <VizTable
            title="Documentos"
            subtitle="Ordenado pelo valor da parcela. Busque por cliente ou número do documento; o CSV baixa o que está filtrado."
            cols={cols}
            rows={linhas ?? []}
            ordemInicial={bucket === "faturado" ? "faturado" : "valor"}
            loading={linhas == null}
            altura={alturaLista}
            totalizar={["faturado", "recebido", "a_vencer", "vencido"]}
          />
        </div>
      </div>
    </div>
  );
}

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
  /** Qual número está aberto. `categoria: null` = a linha de total, que é o
   *  mesmo recorte sem o filtro de tipo. */
  const [drill, setDrill] = useState<{ categoria: string | null; bucket: string; valor: number } | null>(null);

  /** O detalhe tem que respeitar o mês escolhido, senão abriria a lista do ano
   *  inteiro por trás de um número que é de julho. */
  const periodo = useMemo(() => {
    const cheio = data?.periodo ?? { from: "", to: "" };
    if (!mesSel) return cheio;
    const ini = mesSel.slice(0, 10);
    const d = new Date(`${ini}T12:00:00`);
    const fim = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const p2 = (n: number) => String(n).padStart(2, "0");
    return { from: ini, to: `${fim.getFullYear()}-${p2(fim.getMonth() + 1)}-${p2(fim.getDate())}` };
  }, [mesSel, data]);

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
      <PainelRedim id="fin-coorte" padrao={300}>
        {(h) => (
          <ChartFrame
            title="Do que faturei, quanto virou dinheiro"
            subtitle="Cada coluna é um mês de FATURAMENTO, repartido no destino do recebível. A altura é o faturado do mês — as partes somam o total, por isso empilha. Clique num mês pra abrir por tipo de venda."
            series={serieCoorte} rows={coorte} valueFormat={(v) => brl(Number(v))}
            loading={loading} height={h}
          >
            {(vis) => (
              <VizBar rows={coorte} stacked totalNoTopo
                series={serieCoorte.filter((s) => vis.some((v) => v.key === s.key))}
                valueFormat={(v) => brlK(v)} />
            )}
          </ChartFrame>
        )}
      </PainelRedim>

      <div className="flex items-center gap-2 flex-wrap px-1">
        <span className="text-[10px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">Mês</span>
        <button type="button" onClick={() => setMesSel(null)}
          className={`px-3 py-1 text-[11px] rounded-lg border transition-all duration-150 ${
            !mesSel ? "border-ww-accent/70 text-ww-accent bg-ww-accent/15 font-semibold"
                    : "border-ww-border/70 text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover"}`}>
          Todos
        </button>
        {coorte.map((c) => (
          <button key={c.mesIso} type="button" onClick={() => setMesSel(c.mesIso)}
            title={`${brl(c.faturado)} faturado · ${c.pct ?? "—"}% recebido`}
            className={`inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 text-[11px] rounded-lg border transition-all duration-150 tabular-nums ${
              mesSel === c.mesIso
                ? "border-ww-accent/70 text-ww-accent bg-ww-accent/15 font-semibold"
                : "border-ww-border/70 text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover"}`}>
            {c.x}
            {c.pct != null && (
              // O % colorido pela conversão: é a informação que faz escolher o mês.
              <span className={`px-1.5 py-px rounded text-[10px] font-semibold ${
                c.pct >= 95 ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300"
                : c.pct >= 70 ? "bg-amber-500/20 text-amber-600 dark:text-amber-300"
                :               "bg-rose-500/20 text-rose-600 dark:text-rose-300"}`}>
                {Math.round(c.pct)}%
              </span>
            )}
          </button>
        ))}
      </div>

      {pior && (
        <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] text-[11.5px] text-amber-800 dark:text-amber-200">
          <span aria-hidden className="text-[13px] leading-none mt-px">⚠</span>
          <span>Pior conversão {mesSel ? `em ${mesBr(mesSel)}` : "no período"}:{" "}
          <strong>{pior.categoria}</strong> — {pior.pct?.toFixed(1).replace(".", ",")}% recebido de{" "}
          {brl(pior.faturado)}, com <strong>{brl(pior.vencido)}</strong> vencido.</span>
        </div>
      )}

      <PainelRedim id="fin-portipo-graf" padrao={280}>
        {(h) => (
          <ChartFrame
            title={`Por tipo de venda${mesSel ? ` — ${mesBr(mesSel)}` : ""}`}
            subtitle="Onde o recebível trava. Projetos atrasam diferente de avulsos, e o total escondia isso."
            series={serieCoorte} rows={porCategoria} valueFormat={(v) => brl(Number(v))}
            loading={loading} height={h}
          >
            {(vis) => (
              <VizBar rows={porCategoria.map((c) => ({
                  x: c.categoria, Recebido: c.recebido, "A vencer": c.a_vencer,
                  Vencido: c.vencido, "Sem título": c.sem_titulo }))}
                stacked layout="row" categoryWidth={160}
                series={serieCoorte.filter((s) => vis.some((v) => v.key === s.key))}
                valueFormat={(v) => brlK(v)} />
            )}
          </ChartFrame>
        )}
      </PainelRedim>

      <PainelRedim id="fin-portipo-tab" padrao={300}>
        {(h) => (
          <VizTable
            title={`Detalhe por tipo${mesSel ? ` — ${mesBr(mesSel)}` : ""}`}
            subtitle="Os mesmos números do gráfico. Todo valor é clicável: abre a lista de clientes e documentos por trás dele."
            cols={COLS_COORTE}
            rows={porCategoria as unknown as Record<string, unknown>[]}
            ordemInicial="faturado"
            loading={loading}
            altura={h}
            totalizar={["faturado", "recebido", "a_vencer", "vencido", "sem_titulo"]}
            // Só as colunas de dinheiro abrem detalhe. "% recebido" é razão, não
            // soma — não existe lista de clientes por trás de um percentual.
            celulaClicavel={(_l, c) => c.key in BUCKETS}
            onCelulaClick={(l, c) =>
              setDrill({ categoria: String(l.categoria), bucket: c.key, valor: Number(l[c.key]) || 0 })}
            onTotalClick={(c) =>
              setDrill({ categoria: null, bucket: c.key,
                         valor: porCategoria.reduce((a, r) => a + (Number((r as Record<string, unknown>)[c.key]) || 0), 0) })}
          />
        )}
      </PainelRedim>

      {drill && (
        <DrillDetalhe
          categoria={drill.categoria} bucket={drill.bucket} valorEsperado={drill.valor}
          from={periodo.from} to={periodo.to}
          onFechar={() => setDrill(null)}
        />
      )}
    </div>
  );
}
