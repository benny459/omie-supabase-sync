"use client";

// Fluxo de caixa projetado — cards 100, 151 e 98 do Metabase.
//
// ── O que a curva mostra ────────────────────────────────────────────────────
// Só o que está A VENCER: entrada e saída com data contratada dentro da janela.
// Atrasado NÃO entra. Ancorá-lo em hoje jogaria R$ 441k de uma vez no dia 1, a
// curva nasceria em -R$ 300k e ficaria negativa os 60 dias inteiros — um degrau
// que engole o movimento real dos outros dias sem descrever nada.
//
// O atrasado entra QUANDO VOCÊ LHE DÁ UMA DATA, no painel de simulação. É a
// diferença entre "quando está contratado?" (fato → gráfico) e "quando isso vai
// de fato acontecer?" (hipótese → simulação).
//
// ── Escopo, que é padrão e não precisa ser mexido ───────────────────────────
//   ENTRADAS  só Safe  — é quem fatura, e a Omie.CASH que ancora a projeção é
//                        dela; entrada de CDG/Water cai em outro caixa.
//   SAÍDAS    as três  — o grupo paga tudo do mesmo bolso.
//
// ── Um gráfico só ───────────────────────────────────────────────────────────
// Barras de movimento e linha de saldo convivem no MESMO painel, num eixo só.
// Isso é possível porque as duas medidas estão na mesma unidade (R$) — não é o
// eixo duplo do card original, onde a escala de cada lado era escolhida à parte
// e o cruzamento entre linha e barra virava artefato do desenho.

import { useCallback, useEffect, useMemo, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizCombo from "@/components/viz/VizCombo";
import VizTable, { type Col } from "@/components/viz/VizTable";

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
  emp_receber: string[];
  emp_pagar: string[];
  atraso_max: number;
  saldo_atual: { saldo: number; dt_ref: string | null; origem: string } | null;
  titulos: Titulo[];
  atrasados: Titulo[];
  contas: ContaRow[];
};

type Ponto = { dia: string; entradas: number; saidas: number; saldo: number };

/** Saldo de partida + movimento de cada dia, acumulado.
 *  `extras` são os atrasados que ganharam data na simulação — entram no dia que
 *  o usuário escolheu. Base e simulação chamam ESTA função: se cada uma tivesse
 *  a sua, divergiriam e a curva pularia ao mexer no primeiro título. */
function projetar(
  saldo0: number, titulos: Titulo[], dias: number,
  extras: Array<{ t: Titulo; dia: string }> = [],
): Ponto[] {
  const inicio = hojeIso();
  const porDia = new Map<string, { e: number; s: number }>();
  const lancar = (dia: string, t: Titulo) => {
    const cel = porDia.get(dia) ?? { e: 0, s: 0 };
    if (t.natureza === "R") cel.e += Number(t.valor) || 0;
    else cel.s += Number(t.valor) || 0;
    porDia.set(dia, cel);
  };
  for (const t of titulos) lancar(t.previsao, t);
  for (const x of extras) lancar(x.dia, x.t);

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
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  /** Atrasados que ganharam data: cod_titulo → dia. Vazio = curva de base. */
  const [agenda, setAgenda] = useState<Map<number, string>>(new Map());
  const [buscaSim, setBuscaSim] = useState("");
  const [tipoSim, setTipoSim] = useState<"todos" | "R" | "P">("todos");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Sem parâmetros de escopo: o padrão da rota já é o escopo certo
      // (receber Safe, pagar as três, atraso até 60 dias).
      const r = await fetch(`/api/bi/fluxo-caixa?dias=${dias}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
      // Trocar a janela invalida a agenda: títulos podem ter saído da lista, e
      // manter datas órfãs faria a curva mentir em silêncio.
      setAgenda(new Map());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dias]);

  useEffect(() => { void load(); }, [load]);

  const saldo0 = Number(data?.saldo_atual?.saldo ?? 0);
  const titulos = useMemo(() => data?.titulos ?? [], [data]);
  const atrasados = useMemo(() => data?.atrasados ?? [], [data]);

  const extras = useMemo(() => {
    const porCod = new Map(atrasados.map((t) => [t.cod_titulo, t]));
    return Array.from(agenda.entries())
      .map(([cod, dia]) => ({ t: porCod.get(cod), dia }))
      .filter((x): x is { t: Titulo; dia: string } => !!x.t);
  }, [agenda, atrasados]);

  const base = useMemo(() => projetar(saldo0, titulos, dias), [saldo0, titulos, dias]);
  const comAgenda = useMemo(
    () => (extras.length ? projetar(saldo0, titulos, dias, extras) : null),
    [saldo0, titulos, dias, extras],
  );
  const curva = comAgenda ?? base;

  const rows = curva.map((p, i) => ({
    x: diaBr(p.dia),
    Entradas: p.entradas,
    Saídas: p.saidas,
    Saldo: p.saldo,
    ...(comAgenda ? { "Saldo (sem atrasados)": base[i]?.saldo ?? 0 } : {}),
  }));

  const barras: SeriesDef[] = [
    { key: "Entradas", label: "Entradas (a receber)", slot: 5 },
    { key: "Saídas",   label: "Saídas (a pagar)",     slot: 7 },
  ];
  const linhas: SeriesDef[] = comAgenda
    ? [{ key: "Saldo", label: "Saldo com atrasados agendados", slot: 0 },
       { key: "Saldo (sem atrasados)", label: "Saldo sem agendar", slot: 4 }]
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

  const atrasoTotal = useMemo(() => {
    const somar = (n: "R" | "P") =>
      atrasados.filter((t) => t.natureza === n).reduce((a, t) => a + (Number(t.valor) || 0), 0);
    const agendado = extras.reduce((a, x) => a + (Number(x.t.valor) || 0), 0);
    return { receber: somar("R"), pagar: somar("P"), agendado, qtd: atrasados.length };
  }, [atrasados, extras]);

  const listaSim = useMemo(() => {
    const q = buscaSim.trim().toLowerCase();
    return atrasados
      .filter((t) => tipoSim === "todos" || t.natureza === tipoSim)
      .filter((t) => !q || t.contraparte.toLowerCase().includes(q)
                        || t.categoria.toLowerCase().includes(q)
                        || t.documento.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => Number(b.valor) - Number(a.valor));
  }, [atrasados, tipoSim, buscaSim]);

  const COLS_DIAS: Col<{ rotulo: string; entradas: number; saidas: number; liquido: number; saldo: number }>[] = [
    { key: "rotulo",   label: "Dia",      w: 80 },
    { key: "entradas", label: "Entradas", tipo: "money", w: 130 },
    { key: "saidas",   label: "Saídas",   tipo: "money", w: 130 },
    { key: "liquido",  label: "Líquido",  tipo: "money", w: 130 },
    { key: "saldo",    label: comAgenda ? "Saldo c/ agendados" : "Saldo projetado", tipo: "money", w: 150 },
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
        {/* Escopo é fixo de propósito — não é um filtro que se mexe, é como o
            caixa funciona. Fica visível pra não virar regra escondida. */}
        <p className="text-[11px] text-ww-textFaint">
          Recebe <strong className="text-ww-textMuted">Safe</strong> · paga{" "}
          <strong className="text-ww-textMuted">Safe + CDG + Water</strong> · atrasados de até{" "}
          {data?.atraso_max ?? 60} dias vão pra simulação
        </p>
        {agenda.size > 0 && (
          <button type="button" onClick={() => setAgenda(new Map())}
            className="ml-auto px-2 py-0.5 text-[11px] rounded border border-ww-accent text-ww-accent hover:bg-ww-accentSoft transition font-semibold">
            Limpar agendamentos ({agenda.size})
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
        <StatTile label={`Entradas a vencer (${dias}d)`} value={brl(resumo.entradas)}
                  hint={`${titulos.filter((t) => t.natureza === "R").length} títulos · só Safe`} />
        <StatTile label={`Saídas a vencer (${dias}d)`} value={brl(Math.abs(resumo.saidas))}
                  hint={`${titulos.filter((t) => t.natureza === "P").length} títulos · Safe + CDG + Water`}
                  higherIsBetter={false} />
        <StatTile
          label={comAgenda ? "Dia mais apertado (c/ agendados)" : "Dia mais apertado"}
          value={brl(resumo.piorSaldo)}
          hint={resumo.piorDia
            ? `${diaBr(resumo.piorDia)}${resumo.negativos ? ` · ${resumo.negativos} dia(s) negativo(s)` : " · nunca negativa"}`
            : "—"}
          delta={comAgenda && resumo.piorSaldoBase !== 0
            ? (resumo.piorSaldo - resumo.piorSaldoBase) / Math.abs(resumo.piorSaldoBase)
            : null}
          deltaLabel="vs. sem agendar atrasados"
        />
      </div>

      {atrasoTotal.qtd > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 rounded-xl px-3 py-2 text-[11.5px]">
          Fora da curva: <strong>{brl(atrasoTotal.pagar)}</strong> a pagar e{" "}
          <strong>{brl(atrasoTotal.receber)}</strong> a receber já vencidos ({atrasoTotal.qtd} títulos).
          Não têm data de pagamento — só entram no gráfico quando você der uma, na simulação abaixo.
          {extras.length > 0 && (
            <> Já agendados: <strong>{brl(atrasoTotal.agendado)}</strong> em {extras.length} título(s).</>
          )}
        </div>
      )}

      <ChartFrame
        title="Fluxo de caixa projetado"
        subtitle={`Barras = movimento do dia · linha = saldo acumulado, partindo de ${brl(saldo0)}. Mesma unidade, um eixo só`}
        series={[...barras, ...linhas]}
        rows={rows}
        valueFormat={(v) => brl(Number(v))}
        loading={loading}
        height={340}
      >
        <VizCombo rows={rows} bars={barras} lines={linhas} valueFormat={(v) => brl(v)} />
      </ChartFrame>

      {/* Simulação: só atrasados. Título a vencer tem data contratada — não é
          hipótese a testar, e por isso não aparece aqui. */}
      <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5">
        <header className="viz-head flex items-center gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
              Agendar atrasados
            </h3>
            <p className="text-[11px] text-ww-textMuted mt-0.5 normal-case">
              Dê uma data a um título vencido e ele entra na curva naquele dia. Nada é gravado no
              Omie — é cenário. {atrasados.length} títulos vencidos, receber da Safe e pagar das três.
            </p>
          </div>
          <div className="flex items-center gap-1">
            {([["todos", "Todos"], ["R", "A receber"], ["P", "A pagar"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTipoSim(k)}
                className={`px-2 py-0.5 text-[11px] rounded border transition ${
                  tipoSim === k ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                                : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
                {l}
              </button>
            ))}
          </div>
          <input
            value={buscaSim}
            onChange={(e) => setBuscaSim(e.target.value)}
            placeholder="Filtrar…"
            className="w-[160px] text-[11px] bg-ww-bg border border-ww-border rounded px-2 py-1 text-ww-text placeholder:text-ww-textFaint"
          />
        </header>

        <div className="overflow-auto" style={{ maxHeight: 400 }}>
          <table className="w-full text-[11.5px] border-collapse">
            <thead className="sticky top-0 z-10 bg-ww-panel">
              <tr className="text-[10px] uppercase tracking-wider text-ww-textMuted">
                {[["Tipo", 64], ["Emp.", 56], ["Contraparte", 220], ["Categoria", 140],
                  ["Venceu", 76], ["Atraso", 70]].map(([l, w]) => (
                  <th key={String(l)} style={{ width: Number(w) }}
                      className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">{l}</th>
                ))}
                <th style={{ width: 118 }} className="p-1.5 text-right shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Valor</th>
                <th style={{ width: 136 }} className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Agendar para</th>
              </tr>
            </thead>
            <tbody className={loading ? "opacity-40" : ""}>
              {listaSim.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-ww-textFaint">
                  {loading ? "Carregando…" : "Nenhum título vencido no escopo."}
                </td></tr>
              )}
              {listaSim.map((t) => {
                const dia = agenda.get(t.cod_titulo);
                return (
                  <tr key={t.cod_titulo} className={`viz-row ${dia ? "bg-ww-accentSoft/40" : ""}`}>
                    <td className="p-1.5 border-b border-ww-border/50">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        t.natureza === "R"
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                          : "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30"}`}>
                        {t.natureza === "R" ? "Entra" : "Sai"}
                      </span>
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted">{t.empresa}</td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-text truncate" title={t.contraparte}>
                      {t.contraparte}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted truncate" title={t.categoria}>
                      {t.categoria}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted tabular-nums">
                      {t.vencimento ? diaBr(t.vencimento) : "—"}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 tabular-nums text-amber-600 dark:text-amber-400">
                      {t.dias_atraso != null ? `${t.dias_atraso}d` : "—"}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50 text-right tabular-nums text-ww-text">
                      {brl(Number(t.valor))}
                    </td>
                    <td className="p-1.5 border-b border-ww-border/50">
                      <div className="flex items-center gap-1">
                        <input
                          type="date"
                          value={dia ?? ""}
                          min={hojeIso()}
                          max={addDias(hojeIso(), dias)}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAgenda((prev) => {
                              const n = new Map(prev);
                              if (!v) n.delete(t.cod_titulo); else n.set(t.cod_titulo, v);
                              return n;
                            });
                          }}
                          className="text-[11px] bg-ww-bg border border-ww-border rounded px-1.5 py-0.5 text-ww-text"
                        />
                        {dia && (
                          <button type="button" title="Tirar da curva"
                            onClick={() => setAgenda((prev) => {
                              const n = new Map(prev);
                              n.delete(t.cod_titulo);
                              return n;
                            })}
                            className="text-ww-textFaint hover:text-ww-text px-1">×</button>
                        )}
                      </div>
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
        subtitle={comAgenda
          ? "Já com os atrasados agendados aplicados"
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
        subtitle="Todas as contas das três empresas. A projeção acima ancora só na Omie.CASH da Safe"
        cols={COLS_CONTAS}
        rows={data?.contas ?? []}
        ordemInicial="saldo"
        totalizar={["saldo"]}
        loading={loading}
        altura={260}
      />
    </div>
  );
}
