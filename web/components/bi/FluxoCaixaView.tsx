"use client";

// Fluxo de caixa projetado, com simulação — cards 100, 151 e 98 do Metabase.
//
// Três coisas que este componente faz e o card original não fazia:
//
// 1. EIXO ÚNICO POR PAINEL. O card era de eixo duplo: barras de entrada/saída
//    num eixo e a linha de saldo em outro. Num eixo duplo, onde a linha cruza as
//    barras depende de qual escala se escolheu pra cada lado — dá pra fazer o
//    saldo parecer cruzar o zero em qualquer dia. Aqui saem dois painéis com o
//    mesmo eixo X e zero verdadeiro em cada um.
//
// 2. SIMULAÇÃO. Toda a curva é recalculada no navegador a partir do saldo de
//    partida e da lista de títulos. Mudar a previsão de um título refaz a curva
//    na hora. Nada é gravado: é cenário, não decisão.
//
// 3. ESCOPO DA EMPRESA. A conta Omie.CASH da projeção é da SF. Sem filtro, a
//    curva descontava do caixa da Safe os títulos a pagar de CDG e Water — sem
//    contar nenhuma entrada delas.
//
// A curva de BASE e a SIMULADA saem da mesma função (projetar). Se a base viesse
// do banco e a simulação daqui, as duas divergiriam e a curva pularia ao mexer
// no primeiro título.

import { useCallback, useEffect, useMemo, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizLine from "@/components/viz/VizLine";
import VizTable, { type Col } from "@/components/viz/VizTable";

const EMPRESAS = ["SF", "CD", "WW"];
const ROTULO_EMPRESA: Record<string, string> = { SF: "Safe", CD: "CDG", WW: "Water" };
const JANELAS = [30, 60, 90, 180];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const hojeIso = () => new Date().toISOString().slice(0, 10);
const diaBr = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};
const addDias = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

type Titulo = {
  cod_titulo: number; empresa: string; natureza: "R" | "P";
  contraparte: string; categoria: string; num_titulo: string; documento: string;
  vencimento: string | null; previsao: string; previsao_original: string | null;
  tem_override: boolean; esta_vencido: boolean; dias_atraso: number | null;
  valor: number;
};
type ContaRow = {
  empresa: string; cod_conta: number; conta: string; saldo: number; dt_ultimo: string | null;
};
type Payload = {
  dias: number;
  saldo_atual: { saldo: number; dt_ref: string | null; origem: string } | null;
  titulos: Titulo[];
  contas: ContaRow[];
};

type Ponto = { dia: string; entradas: number; saidas: number; saldo: number };

/** Saldo de partida + movimento de cada dia, acumulado. É a única definição da
 *  curva no arquivo — base e simulação chamam esta função. */
function projetar(saldo0: number, titulos: Titulo[], dias: number, datas: Map<number, string>): Ponto[] {
  const inicio = hojeIso();
  const porDia = new Map<string, { e: number; s: number }>();
  for (const t of titulos) {
    const dia = datas.get(t.cod_titulo) ?? t.previsao;
    const cel = porDia.get(dia) ?? { e: 0, s: 0 };
    if (t.natureza === "R") cel.e += Number(t.valor) || 0;
    else cel.s += Number(t.valor) || 0;
    porDia.set(dia, cel);
  }
  const pontos: Ponto[] = [];
  let saldo = saldo0;
  for (let i = 0; i <= dias; i++) {
    const dia = addDias(inicio, i);
    const mov = porDia.get(dia) ?? { e: 0, s: 0 };
    saldo += mov.e - mov.s;
    pontos.push({ dia, entradas: mov.e, saidas: -mov.s, saldo });
  }
  return pontos;
}

const COLS_CONTAS: Col<ContaRow>[] = [
  { key: "empresa",   label: "Emp.",       w: 60 },
  { key: "conta",     label: "Conta",      w: 260 },
  { key: "saldo",     label: "Saldo",      tipo: "money", w: 140 },
  { key: "dt_ultimo", label: "Últ. lanç.", tipo: "date",  w: 100 },
];

export default function FluxoCaixaView() {
  const [dias, setDias] = useState(60);
  // Padrão SF: é de quem é a conta Omie.CASH que ancora a projeção.
  const [empresas, setEmpresas] = useState<Set<string>>(() => new Set(["SF"]));
  const [incluirAtraso, setIncluirAtraso] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /** Datas simuladas: cod_titulo → nova previsão. Vazio = curva de base. */
  const [simulacao, setSimulacao] = useState<Map<number, string>>(new Map());
  const [buscaSim, setBuscaSim] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ dias: String(dias) });
      qs.set("empresas", Array.from(empresas).join(",") || "SF");
      if (incluirAtraso) qs.set("atraso", "1");
      const r = await fetch(`/api/bi/fluxo-caixa?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
      // Trocar o recorte invalida a simulação: os títulos podem nem estar mais
      // na lista, e manter datas órfãs faria a curva mentir em silêncio.
      setSimulacao(new Map());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dias, empresas, incluirAtraso]);

  useEffect(() => { void load(); }, [load]);

  const saldo0 = Number(data?.saldo_atual?.saldo ?? 0);
  const titulos = useMemo(() => data?.titulos ?? [], [data]);

  const base = useMemo(
    () => projetar(saldo0, titulos, dias, new Map()),
    [saldo0, titulos, dias],
  );
  const simulada = useMemo(
    () => (simulacao.size ? projetar(saldo0, titulos, dias, simulacao) : null),
    [saldo0, titulos, dias, simulacao],
  );
  const curva = simulada ?? base;

  const rows = curva.map((p, i) => ({
    x: diaBr(p.dia),
    Entradas: p.entradas,
    Saídas: p.saidas,
    Saldo: p.saldo,
    // A curva de base fica visível ao lado da simulada pra dar a comparação —
    // sozinha, a simulada não diz se melhorou nem quanto.
    ...(simulada ? { "Saldo (base)": base[i]?.saldo ?? 0 } : {}),
  }));

  const movSeries: SeriesDef[] = [
    { key: "Entradas", label: "Entradas (a receber)", slot: 5 },
    { key: "Saídas",   label: "Saídas (a pagar)",     slot: 7 },
  ];
  const saldoSeries: SeriesDef[] = simulada
    ? [{ key: "Saldo", label: "Saldo simulado", slot: 0 },
       { key: "Saldo (base)", label: "Saldo sem simulação", slot: 4 }]
    : [{ key: "Saldo", label: "Saldo projetado", slot: 0 }];

  const resumo = useMemo(() => {
    const s = curva.map((p) => p.saldo);
    let pior = 0;
    s.forEach((v, i) => { if (v < s[pior]) pior = i; });
    const piorBase = base.reduce((acc, p, i) => (p.saldo < base[acc].saldo ? i : acc), 0);
    return {
      entradas: curva.reduce((a, p) => a + p.entradas, 0),
      saidas:   curva.reduce((a, p) => a + p.saidas, 0),
      piorDia: curva[pior]?.dia ?? null,
      piorSaldo: s[pior] ?? 0,
      negativos: s.filter((v) => v < 0).length,
      piorSaldoBase: base[piorBase]?.saldo ?? 0,
    };
  }, [curva, base]);

  const toggleEmp = (e: string) => {
    setEmpresas((prev) => {
      const n = new Set(prev);
      if (n.has(e)) n.delete(e); else n.add(e);
      // Nunca deixa vazio: sem empresa a query cairia pro padrão do servidor e
      // o botão pareceria não ter feito nada.
      return n.size ? n : new Set(["SF"]);
    });
  };

  // Só faz sentido simular o que move a agulha; 900 linhas de R$ 50 não.
  const simulaveis = useMemo(() => {
    const q = buscaSim.trim().toLowerCase();
    return titulos
      .filter((t) => !q || t.contraparte.toLowerCase().includes(q)
                        || t.categoria.toLowerCase().includes(q)
                        || t.documento.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => Number(b.valor) - Number(a.valor))
      .slice(0, 60);
  }, [titulos, buscaSim]);

  const COLS_DIAS: Col<{ rotulo: string; entradas: number; saidas: number; liquido: number; saldo: number }>[] = [
    { key: "rotulo",   label: "Dia",      w: 80 },
    { key: "entradas", label: "Entradas", tipo: "money", w: 130 },
    { key: "saidas",   label: "Saídas",   tipo: "money", w: 130 },
    { key: "liquido",  label: "Líquido",  tipo: "money", w: 130 },
    { key: "saldo",    label: simulada ? "Saldo simulado" : "Saldo projetado", tipo: "money", w: 150 },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap bg-ww-panel border border-ww-border rounded-xl p-2.5">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-ww-textMuted mr-1">Janela</span>
          {JANELAS.map((d) => (
            <button key={d} type="button" onClick={() => setDias(d)}
              className={`px-2 py-0.5 text-[11px] rounded border transition ${
                dias === d ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                           : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
              {d}d
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-ww-textMuted mr-1">Empresa</span>
          {EMPRESAS.map((e) => (
            <button key={e} type="button" onClick={() => toggleEmp(e)}
              title={e === "SF" ? "Dona da conta Omie.CASH que ancora a projeção" : undefined}
              className={`px-2 py-0.5 text-[11px] rounded border transition ${
                empresas.has(e) ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                                : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
              {ROTULO_EMPRESA[e]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-ww-textMuted cursor-pointer"
               title="Título vencido tem previsão no passado e some da janela. Ligado, ele entra ancorado em hoje.">
          <input type="checkbox" checked={incluirAtraso}
                 onChange={(e) => setIncluirAtraso(e.target.checked)}
                 className="accent-ww-accent" />
          Trazer atrasados para hoje
        </label>
        {simulacao.size > 0 && (
          <button type="button" onClick={() => setSimulacao(new Map())}
            className="ml-auto px-2 py-0.5 text-[11px] rounded border border-ww-accent text-ww-accent hover:bg-ww-accentSoft transition font-semibold">
            Limpar simulação ({simulacao.size})
          </button>
        )}
      </div>

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl p-3 text-[12px]">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Saldo de partida (Omie)"
          value={brl(saldo0)}
          hint={data?.saldo_atual
            ? `${data.saldo_atual.origem === "manual" ? "Ajuste manual" : "Extrato Omie.CASH"} de ${
                data.saldo_atual.dt_ref ? diaBr(data.saldo_atual.dt_ref) : "—"}`
            : "Sem extrato"}
        />
        <StatTile label={`Entradas previstas (${dias}d)`} value={brl(resumo.entradas)}
                  hint={`${titulos.filter((t) => t.natureza === "R").length} títulos a receber`} />
        <StatTile label={`Saídas previstas (${dias}d)`} value={brl(Math.abs(resumo.saidas))}
                  hint={`${titulos.filter((t) => t.natureza === "P").length} títulos a pagar`}
                  higherIsBetter={false} />
        <StatTile
          label={simulada ? "Dia mais apertado (simulado)" : "Dia mais apertado"}
          value={brl(resumo.piorSaldo)}
          hint={resumo.piorDia
            ? `${diaBr(resumo.piorDia)}${resumo.negativos ? ` · ${resumo.negativos} dia(s) negativo(s)` : " · nunca negativa"}`
            : "—"}
          delta={simulada && resumo.piorSaldoBase !== 0
            ? (resumo.piorSaldo - resumo.piorSaldoBase) / Math.abs(resumo.piorSaldoBase)
            : null}
          deltaLabel="vs. sem simulação"
        />
      </div>

      {resumo.negativos > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 rounded-xl px-3 py-2 text-[11.5px]">
          A projeção fura o caixa zero em {resumo.negativos} dia(s), pior ponto em{" "}
          <strong>{resumo.piorDia ? diaBr(resumo.piorDia) : "—"}</strong> ({brl(resumo.piorSaldo)}).
          Use a simulação abaixo pra testar antecipar um recebimento ou empurrar um pagamento.
        </div>
      )}

      <ChartFrame
        title={simulada ? "Saldo projetado — simulado vs. base" : "Saldo projetado, dia a dia"}
        subtitle={`Parte de ${brl(saldo0)} (saldo Omie de hoje) e acumula o líquido de cada dia`}
        series={saldoSeries}
        rows={rows}
        valueFormat={(v) => brl(Number(v))}
        loading={loading}
        height={260}
      >
        <VizLine rows={rows} series={saldoSeries} valueFormat={(v) => brl(v)} />
      </ChartFrame>

      <ChartFrame
        title="Entradas e saídas previstas por dia"
        subtitle="Mesmo eixo X do saldo acima. Saídas crescem pra baixo a partir do zero"
        series={movSeries}
        rows={rows}
        valueFormat={(v) => brl(Number(v))}
        loading={loading}
        height={240}
      >
        <VizBar rows={rows} series={movSeries} valueFormat={(v) => brl(v)} />
      </ChartFrame>

      {/* Painel de simulação. Nada aqui é gravado — é cenário. */}
      <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5">
        <header className="viz-head flex items-center gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
              Simular novas datas de previsão
            </h3>
            <p className="text-[11px] text-ww-textMuted mt-0.5 normal-case">
              Mude a data de um título e a curva acima recalcula na hora. Nada é gravado no Omie —
              é cenário. Mostrando os 60 maiores em aberto.
            </p>
          </div>
          <input
            value={buscaSim}
            onChange={(e) => setBuscaSim(e.target.value)}
            placeholder="Filtrar por cliente, categoria…"
            className="w-[200px] text-[11px] bg-ww-bg border border-ww-border rounded px-2 py-1 text-ww-text placeholder:text-ww-textFaint"
          />
        </header>

        <div className="overflow-auto" style={{ maxHeight: 380 }}>
          <table className="w-full text-[11.5px] border-collapse">
            <thead className="sticky top-0 z-10 bg-ww-panel">
              <tr className="text-[10px] uppercase tracking-wider text-ww-textMuted">
                <th className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]" style={{ width: 64 }}>Tipo</th>
                <th className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]" style={{ width: 230 }}>Contraparte</th>
                <th className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]" style={{ width: 150 }}>Categoria</th>
                <th className="p-1.5 text-right shadow-[0_1px_0_0_rgb(var(--color-ww-border))]" style={{ width: 118 }}>Valor</th>
                <th className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]" style={{ width: 96 }}>Previsão</th>
                <th className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]" style={{ width: 128 }}>Simular para</th>
                <th className="p-1.5 text-right shadow-[0_1px_0_0_rgb(var(--color-ww-border))]" style={{ width: 76 }}>Δ dias</th>
              </tr>
            </thead>
            <tbody className={loading ? "opacity-40" : ""}>
              {simulaveis.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-ww-textFaint">
                  {loading ? "Carregando…" : "Nenhum título em aberto na janela."}
                </td></tr>
              )}
              {simulaveis.map((t) => {
                const nova = simulacao.get(t.cod_titulo);
                const delta = nova
                  ? Math.round((new Date(`${nova}T12:00:00`).getTime()
                              - new Date(`${t.previsao}T12:00:00`).getTime()) / 86_400_000)
                  : 0;
                return (
                  <tr key={t.cod_titulo}
                      className={`viz-row ${nova ? "bg-ww-accentSoft/40" : ""}`}>
                    <td className="p-1.5 border-b border-ww-border/50">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        t.natureza === "R"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30"}`}>
                        {t.natureza === "R" ? "Entra" : "Sai"}
                      </span>
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-text truncate" title={t.contraparte}>
                      {t.contraparte}
                      {t.esta_vencido && t.dias_atraso != null && (
                        <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">
                          ({t.dias_atraso}d atraso)
                        </span>
                      )}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted truncate" title={t.categoria}>
                      {t.categoria}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-right tabular-nums text-ww-text">
                      {brl(Number(t.valor))}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted tabular-nums">
                      {diaBr(t.previsao)}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50">
                      <input
                        type="date"
                        value={nova ?? t.previsao}
                        min={hojeIso()}
                        onChange={(e) => {
                          const v = e.target.value;
                          setSimulacao((prev) => {
                            const n = new Map(prev);
                            // Voltar pra data original tira da simulação, em vez
                            // de gravar um "override" que não muda nada.
                            if (!v || v === t.previsao) n.delete(t.cod_titulo);
                            else n.set(t.cod_titulo, v);
                            return n;
                          });
                        }}
                        className="text-[11px] bg-ww-bg border border-ww-border rounded px-1.5 py-0.5 text-ww-text"
                      />
                    </td>
                    <td className={`p-1.5 border-b border-ww-border/50 text-right tabular-nums font-semibold ${
                      delta === 0 ? "text-ww-textFaint"
                      : (t.natureza === "R" ? delta < 0 : delta > 0)
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-rose-600 dark:text-rose-400"}`}>
                      {delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${delta}d`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <VizTable
        title="Projeção dia a dia"
        subtitle={simulada
          ? "Já com as datas simuladas aplicadas"
          : "A mesma curva em números — pra achar o título que causa o buraco"}
        cols={COLS_DIAS}
        rows={curva.map((p) => ({
          rotulo: diaBr(p.dia), entradas: p.entradas, saidas: p.saidas,
          liquido: p.entradas + p.saidas, saldo: p.saldo,
        }))}
        ordemInicial="rotulo"
        loading={loading}
        altura={340}
      />

      <VizTable
        title="Saldo por conta corrente"
        subtitle="Último lançamento de cada conta. A projeção acima ancora só na Omie.CASH"
        cols={COLS_CONTAS}
        rows={data?.contas ?? []}
        ordemInicial="saldo"
        totalizar={["saldo"]}
        loading={loading}
        altura={240}
      />
    </div>
  );
}
