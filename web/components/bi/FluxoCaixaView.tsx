"use client";

// Fluxo de caixa projetado — cards 100, 151 e 98 do Metabase.
//
// O card original era de EIXO DUPLO: barras de entrada/saída num eixo e a linha
// de saldo em outro, com escalas diferentes. Aqui sai desdobrado em dois painéis
// empilhados, compartilhando o eixo X.
//
// Não é preferência: num eixo duplo a relação visual entre a barra e a linha
// depende de qual escala o desenhista escolheu pra cada lado. Dá pra fazer a
// linha cruzar as barras onde se quiser. Desdobrado, cada painel tem um zero
// verdadeiro e a comparação entre dias continua honesta em ambos.
//
// A linha de saldo é a que decide ação — por isso ela vem ANTES das barras, e o
// dia mais apertado da janela está num tile, não escondido na curva.

import { useCallback, useEffect, useState } from "react";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import StatTile from "@/components/viz/StatTile";
import VizBar from "@/components/viz/VizBar";
import VizLine from "@/components/viz/VizLine";
import VizTable, { type Col } from "@/components/viz/VizTable";

const EMPRESAS = ["SF", "CD", "WW"];
const JANELAS = [30, 60, 90, 180];

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const diaBr = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};

type DiaRow = {
  dia: string; entradas: number; saidas: number; liquido: number; saldo_projetado: number;
};
type ContaRow = {
  empresa: string; cod_conta: number; conta: string; saldo: number; dt_ultimo: string | null;
};
type Payload = {
  dias: number;
  saldo_atual: { saldo: number; dt_ref: string | null; origem: string } | null;
  fluxo: DiaRow[];
  contas: ContaRow[];
  resumo: {
    total_entradas: number; total_saidas: number;
    pior_dia: string | null; pior_saldo: number; dias_negativos: number;
  };
};

const COLS_CONTAS: Col<ContaRow>[] = [
  { key: "empresa",   label: "Emp.",       w: 60 },
  { key: "conta",     label: "Conta",      w: 260 },
  { key: "saldo",     label: "Saldo",      tipo: "money", w: 140 },
  { key: "dt_ultimo", label: "Últ. lanç.", tipo: "date",  w: 100 },
];

const COLS_DIAS: Col<DiaRow & { rotulo: string }>[] = [
  { key: "rotulo",          label: "Dia",      w: 80 },
  { key: "entradas",        label: "Entradas", tipo: "money", w: 130 },
  { key: "saidas",          label: "Saídas",   tipo: "money", w: 130 },
  { key: "liquido",         label: "Líquido",  tipo: "money", w: 130 },
  { key: "saldo_projetado", label: "Saldo projetado", tipo: "money", w: 150 },
];

export default function FluxoCaixaView() {
  const [dias, setDias] = useState(60);
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ dias: String(dias) });
      if (empresas.size) qs.set("empresas", Array.from(empresas).join(","));
      const r = await fetch(`/api/bi/fluxo-caixa?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null);
      setData(j as Payload);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dias, empresas]);

  useEffect(() => { void load(); }, [load]);

  const fluxo = data?.fluxo ?? [];
  const rows = fluxo.map((f) => ({
    x: diaBr(f.dia),
    Entradas: Number(f.entradas) || 0,
    Saídas: Number(f.saidas) || 0,
    Saldo: Number(f.saldo_projetado) || 0,
  }));

  const movSeries: SeriesDef[] = [
    { key: "Entradas", label: "Entradas (a receber)", slot: 5 },
    { key: "Saídas",   label: "Saídas (a pagar)",     slot: 7 },
  ];
  const saldoSeries: SeriesDef[] = [{ key: "Saldo", label: "Saldo projetado", slot: 0 }];

  const r = data?.resumo;
  const negativo = (r?.dias_negativos ?? 0) > 0;

  const toggleEmp = (e: string) => {
    setEmpresas((prev) => {
      const n = new Set(prev);
      if (n.has(e)) n.delete(e); else n.add(e);
      return n;
    });
  };

  return (
    <div className="space-y-3">
      {/* Filtros próprios: aqui não existe range de datas — a janela é sempre
          "de hoje pra frente", que é o que projeção significa. */}
      <div className="flex items-center gap-3 flex-wrap bg-ww-panel border border-ww-border rounded-xl p-2.5">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-ww-textMuted mr-1">Janela</span>
          {JANELAS.map((d) => (
            <button
              key={d} type="button" onClick={() => setDias(d)}
              className={`px-2 py-0.5 text-[11px] rounded border transition ${
                dias === d ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                           : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}
            >
              {d}d
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-ww-textMuted mr-1">Empresa</span>
          {EMPRESAS.map((e) => (
            <button
              key={e} type="button" onClick={() => toggleEmp(e)}
              className={`px-2 py-0.5 text-[11px] rounded border transition ${
                empresas.has(e) ? "border-ww-accent text-ww-accent bg-ww-accentSoft font-semibold"
                                : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}
            >
              {e}
            </button>
          ))}
          {empresas.size > 0 && (
            <button type="button" onClick={() => setEmpresas(new Set())}
                    className="ml-1 text-[10.5px] text-ww-textFaint hover:text-ww-text underline">
              limpar
            </button>
          )}
        </div>
      </div>

      {err && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-xl p-3 text-[12px]">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile
          label="Saldo hoje"
          value={brl(data?.saldo_atual?.saldo ?? 0)}
          hint={data?.saldo_atual
            ? `${data.saldo_atual.origem === "manual" ? "Ajuste manual" : "Extrato"} de ${
                data.saldo_atual.dt_ref ? diaBr(data.saldo_atual.dt_ref) : "—"}`
            : "Sem extrato"}
        />
        <StatTile label={`Entradas previstas (${dias}d)`} value={brl(r?.total_entradas ?? 0)}
                  hint="Títulos a receber em aberto, pela previsão" />
        <StatTile label={`Saídas previstas (${dias}d)`} value={brl(Math.abs(r?.total_saidas ?? 0))}
                  hint="Títulos a pagar em aberto, pela previsão" higherIsBetter={false} />
        <StatTile
          label="Dia mais apertado"
          value={brl(r?.pior_saldo ?? 0)}
          hint={r?.pior_dia
            ? `${diaBr(r.pior_dia)}${negativo ? ` · ${r.dias_negativos} dia(s) no negativo` : " · sempre positivo"}`
            : "—"}
          higherIsBetter
        />
      </div>

      {negativo && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 rounded-xl px-3 py-2 text-[11.5px]">
          A projeção fura o caixa zero em {r?.dias_negativos} dia(s) da janela, com o pior ponto em{" "}
          <strong>{r?.pior_dia ? diaBr(r.pior_dia) : "—"}</strong> ({brl(r?.pior_saldo ?? 0)}). A projeção
          assume que todo título entra e sai na data de previsão — antecipar recebimento ou empurrar
          pagamento muda a curva.
        </div>
      )}

      <ChartFrame
        title="Saldo projetado, dia a dia"
        subtitle="Saldo de hoje somado ao líquido acumulado de cada dia. Abaixo de zero = caixa furado"
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
        height={260}
      >
        <VizBar rows={rows} series={movSeries} valueFormat={(v) => brl(v)} />
      </ChartFrame>

      <VizTable
        title="Projeção dia a dia"
        subtitle="A mesma curva em números — pra achar o título que causa o buraco"
        cols={COLS_DIAS}
        rows={fluxo.map((f) => ({ ...f, rotulo: diaBr(f.dia) }))}
        ordemInicial="rotulo"
        loading={loading}
        altura={360}
      />

      <VizTable
        title="Saldo por conta corrente"
        subtitle="Último lançamento de cada conta. A projeção acima usa só a Omie.CASH"
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
