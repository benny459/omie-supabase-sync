"use client";

// MOCKUP — Financeiro consolidado. Proposta para aprovação, sem gravar nada.
//
// ── O problema que isto resolve ──────────────────────────────────────────────
// Hoje a mesma pergunta é respondida em três telas com nomes diferentes:
//
//   pergunta                        Fluxo      Pagar        Receber
//   quanto está vencido, por idade  cards      "Vencido"    "Aging"
//   o que vence à frente            a curva    "Horizonte"  —
//   emitido × liquidado por mês     mensal     "Emitido vs pago"  "Emitido vs recebido"
//   lista linha a linha             a mesa     "Detalhe"    "Detalhe"
//
// A proposta do HTML mantinha isso: a aba "Análises" repetia os mesmos oito
// blocos de Pagar + Receber.
//
// ── A ideia que elimina a repetição ──────────────────────────────────────────
// A NATUREZA (entra / sai) vira FILTRO, não vira TELA.
//
// Um aging com seletor, em vez de dois aging idênticos. Um "emitido × liquidado"
// com seletor, em vez de dois. A simetria entre pagar e receber é real — os dois
// são títulos com vencimento, previsão e valor — então o mesmo gráfico serve,
// e manter dois era duplicar código e leitura.
//
// Sobram três abas, cada uma com UMA pergunta:
//   Fluxo    quando o caixa aperta            (a curva + a mesa de reagendar)
//   Análise  por que aperta                   (aging, horizonte, categoria)
//   Títulos  qual título exatamente           (uma lista, filtrável)

import { useMemo, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import VizBar from "@/components/viz/VizBar";
import VizCombo from "@/components/viz/VizCombo";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlK = (v: number) =>
  Math.abs(v) >= 1000
    ? `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}k`
    : brl(v);

// ─────────────────────────────────────────────────────────────────────────────
// Dados reais (consulta de hoje) — o mockup só é avaliável com número de verdade
// ─────────────────────────────────────────────────────────────────────────────
const REAL = {
  saldo: 39646,
  pagar:   { titulos: 11432, total: 25395311, vencido: 5047222, qtdVencido: 1084,
             d7: 202099, d30: 528734, d60: 858494, depois: 19489595 },
  receber: { titulos: 144,   total: 1185679,  vencido: 57711,   qtdVencido: 15,
             d7: 306009, d30: 994557, d60: 1127967, depois: 0 },
};

const AGING = [
  { x: "1–15d",   Sai: 412_000, Entra: 21_400 },
  { x: "16–30d",  Sai: 318_000, Entra: 9_800 },
  { x: "31–60d",  Sai: 684_000, Entra: 15_600 },
  { x: "61–90d",  Sai: 471_000, Entra: 6_900 },
  { x: "90d+",    Sai: 3_162_222, Entra: 4_011 },
];

const HORIZONTE = [
  { x: "vence hoje", Sai: 18_400,  Entra: 2_114 },
  { x: "7 dias",     Sai: 202_099, Entra: 306_009 },
  { x: "30 dias",    Sai: 528_734, Entra: 994_557 },
  { x: "60 dias",    Sai: 858_494, Entra: 1_127_967 },
  { x: "90 dias",    Sai: 1_204_800, Entra: 1_162_300 },
];

const MENSAL = [
  { x: "abr/26", Emitido: 812_400, Liquidado: 743_100 },
  { x: "mai/26", Emitido: 634_900, Liquidado: 690_200 },
  { x: "jun/26", Emitido: 921_300, Liquidado: 812_700 },
  { x: "jul/26", Emitido: 745_600, Liquidado: 801_400 },
  { x: "ago/26", Emitido: 883_200, Liquidado: 694_300 },
  { x: "set/26", Emitido: 312_800, Liquidado: 188_900 },
];

const CATEGORIA_SAI = [
  { x: "Mercadorias p/ Revenda", v: 1_284_000 },
  { x: "Serviços Prestados PJ",  v: 743_000 },
  { x: "Antecipação / Lucros",   v: 845_431 },
  { x: "Impostos",               v: 421_000 },
  { x: "Folha e encargos",       v: 388_000 },
  { x: "Locação de veículos",    v: 96_000 },
];
const CATEGORIA_ENTRA = [
  { x: "Serviços Contratuais",   v: 612_000 },
  { x: "Revenda de Mercadoria",  v: 284_000 },
  { x: "Serviços Avulsos",       v: 176_000 },
  { x: "Projetos",               v: 88_000 },
  { x: "BOT/SW",                 v: 25_679 },
];

const TITULOS = [
  { tipo: "Sai",   emp: "SF", parte: "FLUID BRASIL SISTEMAS E TECNOLOGIA", cat: "Mercadorias p/ Revenda", venc: "2026-09-14", prev: "2026-09-14", valor: 33_493, sit: "em 5d" },
  { tipo: "Entra", emp: "SF", parte: "REDE DOR RIBEIRAO PRETO",            cat: "Serviços Contratuais",   venc: "2026-08-30", prev: "2026-09-21", valor: 53_753, sit: "em 12d" },
  { tipo: "Sai",   emp: "SF", parte: "SECRETARIA DA RECEITA FEDERAL",      cat: "Simples Nacional (DAS)", venc: "2026-09-20", prev: "2026-09-20", valor: 48_001, sit: "em 11d" },
  { tipo: "Entra", emp: "SF", parte: "HAPVIDA CAMPINAS",                   cat: "Serviços Avulsos",       venc: "2026-09-10", prev: "2026-09-10", valor: 21_400, sit: "amanhã" },
  { tipo: "Sai",   emp: "CD", parte: "GUIA DA PREVIDENCIA SOCIAL — GPS",   cat: "INSS",                   venc: "2026-03-20", prev: "2026-09-15", valor: 2_667, sit: "173d atraso" },
  { tipo: "Sai",   emp: "SF", parte: "ACQUA IMPORT COMERCIO",              cat: "Mercadorias p/ Revenda", venc: "2026-09-01", prev: "2026-09-12", valor: 10_222, sit: "em 3d" },
];

/** Emitido × liquidado: o rótulo muda com o lado ("pago" ou "recebido"), o
 *  gráfico não. Era essa diferença de UMA palavra que justificava dois gráficos. */
const SERIES_MENSAL = (lado: "ambos" | "entra" | "sai"): SeriesDef[] => [
  { key: "Emitido",   label: "Emitido", slot: 0, mark: "rect" },
  { key: "Liquidado", label: lado === "entra" ? "Recebido" : "Pago", slot: 5, mark: "rect" },
];

type Lado = "ambos" | "entra" | "sai";
type Aba = "fluxo" | "analise" | "titulos";

export default function FinanceiroMockup() {
  const [aba, setAba] = useState<Aba>("fluxo");
  /** O seletor que mata a redundância: a natureza é filtro, não tela. */
  const [lado, setLado] = useState<Lado>("ambos");

  const mostraEntra = lado !== "sai";
  const mostraSai   = lado !== "entra";

  /** KPIs consolidados. Quatro, não onze: a proposta original tinha sete cards
   *  repetindo pedaços do mesmo número em abas diferentes. */
  const kpis = useMemo(() => {
    const p = REAL.pagar, r = REAL.receber;
    const entra60 = r.d60, sai60 = p.d60;
    return [
      { rot: "Saldo hoje", val: brl(REAL.saldo), sub: "extrato Omie · 09/09", tom: "neutro" as const },
      { rot: "Projetado 60 dias", val: brl(REAL.saldo + entra60 - sai60),
        sub: `${brlK(entra60)} entram · ${brlK(sai60)} saem`,
        tom: (REAL.saldo + entra60 - sai60) < 0 ? "ruim" as const : "bom" as const },
      { rot: "Vencido", val: brl(p.vencido + r.vencido),
        sub: `${p.qtdVencido + r.qtdVencido} títulos · ${brlK(r.vencido)} a receber`, tom: "ruim" as const },
      { rot: "Vence esta semana", val: brl(p.d7 + r.d7),
        sub: `${brlK(r.d7)} entra · ${brlK(p.d7)} sai`, tom: "aviso" as const },
    ];
  }, []);

  return (
    <div className="space-y-3.5">
      {/* ── KPIs: uma faixa só, quatro números ──────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => <Kpi key={k.rot} {...k} />)}
      </div>

      {/* ── Barra única: abas + o seletor de lado ───────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap bg-ww-panel border border-ww-border rounded-xl p-2">
        <div className="flex items-center gap-1">
          {([["fluxo", "Fluxo", "quando o caixa aperta"],
             ["analise", "Análise", "por que aperta"],
             ["titulos", "Títulos", "qual título"]] as const).map(([k, l, hint]) => (
            <button key={k} type="button" onClick={() => setAba(k)} title={hint}
              className={`px-3 py-1.5 text-[12px] rounded-lg border transition ${
                aba === k ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                          : "border-transparent text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover"}`}>
              {l}
            </button>
          ))}
        </div>

        <span className="h-6 w-px bg-ww-border" />

        {/* O seletor que substitui as duas telas. Vale para TODAS as abas. */}
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

        <span className="ml-auto text-[10.5px] text-ww-textFaint">
          Recebe <strong className="text-ww-textMuted">Safe</strong> · paga{" "}
          <strong className="text-ww-textMuted">Safe + CDG + Water</strong>
        </span>
      </div>

      {aba === "fluxo" && <AbaFluxo mostraEntra={mostraEntra} mostraSai={mostraSai} />}
      {aba === "analise" && <AbaAnalise mostraEntra={mostraEntra} mostraSai={mostraSai} lado={lado} />}
      {aba === "titulos" && <AbaTitulos lado={lado} />}

      <p className="text-[10.5px] text-ww-textFaint px-1">
        Mockup para aprovação. Números de hoje, lidos do banco. A ideia central: a natureza
        (entra/sai) é <strong>filtro</strong>, não tela — por isso um aging em vez de dois, um
        &ldquo;emitido × liquidado&rdquo; em vez de dois, uma lista em vez de duas.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function AbaFluxo({ mostraEntra, mostraSai }: { mostraEntra: boolean; mostraSai: boolean }) {
  const dias = 60;
  const curva = useMemo(() => {
    // Curva sintética só pro desenho: o real vem de bi.fluxo_caixa_titulos.
    let saldo = REAL.saldo;
    return Array.from({ length: 21 }, (_, i) => {
      const e = mostraEntra ? [0, 0, 306_009, 0, 0, 88_000, 0, 0, 210_400, 0, 0, 0, 164_000, 0, 0, 92_000, 0, 0, 0, 78_000, 0][i] : 0;
      const s = mostraSai   ? [22_000, 8_400, 48_001, 12_000, 33_493, 9_800, 41_200, 6_700, 18_900, 27_400, 11_200, 52_000, 9_100, 14_800, 31_000, 7_600, 22_400, 16_900, 8_200, 38_000, 12_100][i] : 0;
      saldo += e - s;
      const d = new Date(2026, 8, 9 + i * 3);
      return { x: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
               Entradas: e, Saídas: -s, Saldo: saldo };
    });
  }, [mostraEntra, mostraSai]);

  const barras: SeriesDef[] = [
    ...(mostraEntra ? [{ key: "Entradas", label: "Entradas", slot: 5, mark: "rect" } as SeriesDef] : []),
    ...(mostraSai   ? [{ key: "Saídas",   label: "Saídas",   slot: 3, mark: "rect" } as SeriesDef] : []),
  ];
  const linha: SeriesDef[] = [{ key: "Saldo", label: "Saldo projetado", slot: 0, mark: "line" }];

  return (
    <div className="space-y-3.5">
      <ChartFrame
        title={`Fluxo de caixa projetado · ${dias} dias`}
        subtitle="Barras = movimento do dia · linha = saldo acumulado. Só o que está a vencer; atrasado entra ao ganhar data. Fim de semana lido no próximo dia útil."
        series={[...barras, ...linha]} rows={curva} valueFormat={(v) => brl(Number(v))} height={300}
      >
        {(vis) => (
          <VizCombo rows={curva}
            bars={barras.filter((b) => vis.some((v) => v.key === b.key))}
            lines={linha.filter((l) => vis.some((v) => v.key === l.key))}
            valueFormat={(v) => brl(v)} />
        )}
      </ChartFrame>

      <Painel titulo="Reagendar títulos"
        sub="A mesa de operação continua aqui, com escopo, rateio e envio ao Omie — é a única ação da tela, e ação fica junto do gráfico que ela move.">
        <div className="px-3 py-6 text-center text-[11.5px] text-ww-textFaint border border-dashed border-ww-border rounded-lg">
          A mesa que já existe hoje entra aqui sem mudança.
        </div>
      </Painel>
    </div>
  );
}

function AbaAnalise({
  mostraEntra, mostraSai, lado,
}: { mostraEntra: boolean; mostraSai: boolean; lado: Lado }) {
  const series = (keyE = "Entra", keyS = "Sai"): SeriesDef[] => [
    ...(mostraEntra ? [{ key: keyE, label: "Entra", slot: 5, mark: "rect" } as SeriesDef] : []),
    ...(mostraSai   ? [{ key: keyS, label: "Sai",   slot: 3, mark: "rect" } as SeriesDef] : []),
  ];
  const cats = lado === "entra" ? CATEGORIA_ENTRA : CATEGORIA_SAI;

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
        <ChartFrame
          title="Vencido — por idade do atraso"
          subtitle="UM gráfico para os dois lados. Antes eram dois idênticos, um em Contas a Pagar e outro em Contas a Receber."
          series={series()} rows={AGING} valueFormat={(v) => brl(Number(v))} height={250}
        >
          {(vis) => <VizBar rows={AGING} series={series().filter((s) => vis.some((v) => v.key === s.key))}
                            valueFormat={(v) => brlK(v)} />}
        </ChartFrame>

        <ChartFrame
          title="A vencer — por horizonte"
          subtitle="Acumulado: cada faixa contém as anteriores. Responde 'tenho caixa pros próximos 30 dias?' sem somar de cabeça."
          series={series()} rows={HORIZONTE} valueFormat={(v) => brl(Number(v))} height={250}
        >
          {(vis) => <VizBar rows={HORIZONTE} series={series().filter((s) => vis.some((v) => v.key === s.key))}
                            valueFormat={(v) => brlK(v)} />}
        </ChartFrame>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
        <ChartFrame
          title="Emitido × liquidado por mês"
          subtitle="Mesmo gráfico servia a 'emitido vs pago' e 'emitido vs recebido'. A diferença era só o lado — que agora é filtro."
          series={SERIES_MENSAL(lado)}
          rows={MENSAL} valueFormat={(v) => brl(Number(v))} height={250}
        >
          {(vis) => <VizBar rows={MENSAL}
            series={SERIES_MENSAL(lado).filter((s) => vis.some((v) => v.key === s.key))}
            valueFormat={(v) => brlK(v)} />}
        </ChartFrame>

        <ChartFrame
          title={`Por categoria — ${lado === "entra" ? "entradas" : "saídas"}`}
          subtitle="Mesma classificação do DRE. O seletor de lado troca a pergunta sem trocar de tela."
          series={[{ key: "v", label: "Valor", slot: lado === "entra" ? 5 : 3, mark: "rect" }]}
          rows={cats} valueFormat={(v) => brl(Number(v))} height={250}
        >
          <VizBar rows={cats} series={[{ key: "v", label: "Valor", slot: lado === "entra" ? 5 : 3, mark: "rect" }]}
                  layout="row" categoryWidth={175} valueFormat={(v) => brlK(v)} />
        </ChartFrame>
      </div>
    </div>
  );
}

function AbaTitulos({ lado }: { lado: Lado }) {
  const linhas = TITULOS.filter((t) =>
    lado === "ambos" || (lado === "entra" ? t.tipo === "Entra" : t.tipo === "Sai"));
  const soma = (tipo: string) =>
    linhas.filter((t) => t.tipo === tipo).reduce((a, t) => a + t.valor, 0);

  return (
    <Painel titulo="Títulos em aberto"
      sub="UMA lista para os dois lados, com a coluna Tipo. Antes eram duas tabelas com as mesmas colunas em telas diferentes — e nenhuma delas respondia 'o que tenho no total nesta data'.">
      <div className="flex items-center gap-4 mb-2 px-1 text-[11.5px]">
        <span className="text-ww-textMuted">{linhas.length} títulos</span>
        {soma("Entra") > 0 && <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">+{brl(soma("Entra"))}</span>}
        {soma("Sai") > 0 && <span className="text-rose-600 dark:text-rose-400 tabular-nums">−{brl(soma("Sai"))}</span>}
        <span className="ml-auto text-ww-textFaint">filtros: categoria · empresa · período · busca</span>
      </div>
      <div className="border border-ww-border rounded-lg overflow-hidden">
        <table className="w-full text-[11.5px] border-collapse">
          <thead className="bg-ww-panel">
            <tr className="text-[10px] uppercase tracking-wider text-ww-textMuted">
              {["Tipo", "Emp.", "Contraparte", "Categoria", "Vencto", "Previsão", "Situação"].map((h) => (
                <th key={h} className="p-2 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">{h}</th>
              ))}
              <th className="p-2 text-right shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Valor</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((t, i) => (
              <tr key={i} className="viz-row">
                <td className="p-2 border-b border-ww-border/40">
                  <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                    t.tipo === "Entra"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                      : "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30"}`}>
                    {t.tipo}
                  </span>
                </td>
                <td className="p-2 border-b border-ww-border/40 text-ww-textMuted">{t.emp}</td>
                <td className="p-2 border-b border-ww-border/40 text-ww-text">{t.parte}</td>
                <td className="p-2 border-b border-ww-border/40 text-ww-textMuted">{t.cat}</td>
                <td className="p-2 border-b border-ww-border/40 text-ww-textMuted tabular-nums">
                  {t.venc.slice(8)}/{t.venc.slice(5, 7)}
                </td>
                <td className="p-2 border-b border-ww-border/40 text-ww-text tabular-nums">
                  {t.prev.slice(8)}/{t.prev.slice(5, 7)}
                </td>
                <td className="p-2 border-b border-ww-border/40">
                  <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] border tabular-nums ${
                    t.sit.includes("atraso")
                      ? "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30"
                      : "bg-ww-border/50 text-ww-textMuted border-ww-border"}`}>{t.sit}</span>
                </td>
                <td className="p-2 border-b border-ww-border/40 text-right tabular-nums text-ww-text">
                  {brl(t.valor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Painel>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Kpi({ rot, val, sub, tom }: {
  rot: string; val: string; sub: string; tom: "bom" | "ruim" | "aviso" | "neutro";
}) {
  const cor = {
    bom:    "text-emerald-600 dark:text-emerald-400",
    ruim:   "text-rose-600 dark:text-rose-400",
    aviso:  "text-amber-600 dark:text-amber-400",
    neutro: "text-ww-text",
  }[tom];
  return (
    <div className="bg-ww-panel border border-ww-border rounded-xl p-3">
      <div className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">{rot}</div>
      <div className={`text-[21px] font-bold tabular-nums tracking-[-0.5px] mt-1 ${cor}`}>{val}</div>
      <div className="text-[10.5px] text-ww-textMuted mt-0.5">{sub}</div>
    </div>
  );
}

function Painel({ titulo, sub, children }: { titulo: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5">
      <header className="mb-2.5">
        <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">{titulo}</h3>
        <p className="text-[11px] text-ww-textMuted mt-0.5">{sub}</p>
      </header>
      {children}
    </section>
  );
}
