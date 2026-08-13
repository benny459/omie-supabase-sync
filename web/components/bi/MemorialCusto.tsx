"use client";

// Memória de cálculo de um cliente: como o custo dele foi montado, item a item.
//
// Um total agregado não se audita. Quando alguém pergunta "por que este cliente
// custou R$ 28 mil?", a resposta precisa ser a lista de OS com horas × valor/hora,
// as despesas uma a uma com o que foi descontado, e o rateio de combustível com o
// km e o custo por km que o produziram. Sem isso o número é pra acreditar, não
// pra conferir.
//
// Três abas porque são três cálculos diferentes, cada um com sua própria unidade
// e sua própria fórmula. Juntá-los numa tabela só exigiria colunas vazias em dois
// terços das linhas.

import { useCallback, useEffect, useState } from "react";

const brl = (v: unknown) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const numBr = (v: unknown, casas = 1) =>
  Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const dataBr = (v: unknown) => {
  const s = String(v ?? "");
  if (!s || s === "null") return "—";
  const [a, m, d] = s.slice(0, 10).split("-");
  return d ? `${d}/${m}/${a.slice(2)}` : s;
};

type Memorial = {
  resumo: {
    qtd_os: number; horas: number; custo_mao_obra: number;
    qtd_despesas: number; despesas: number; combustivel: number; tecnicos: number;
  };
  por_tipo_despesa: Array<{ label: string; value: number }>;
  oss: Array<Record<string, unknown>>;
  despesas: Array<Record<string, unknown>>;
  combustivel: Array<Record<string, unknown>>;
  error?: string;
};

export default function MemorialCusto({
  cliente, customerIds, from, to, onFechar,
}: {
  cliente: string;
  customerIds: string[];
  from: string;
  to: string;
  onFechar: () => void;
}) {
  const [aba, setAba] = useState<"os" | "despesas" | "combustivel">("os");
  const [data, setData] = useState<Memorial | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ customer_id: customerIds.join(","), from, to });
      const r = await fetch(`/api/bi/custo-cliente/memorial?${qs}`, { cache: "no-store" });
      const j = (await r.json()) as Memorial;
      if (!r.ok) { setErr(j.error ?? r.statusText); return; }
      setErr(null); setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [customerIds, from, to]);

  useEffect(() => { void load(); }, [load]);

  // Esc fecha: um modal que só fecha no X prende quem navega por teclado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onFechar]);

  const r = data?.resumo;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
         onClick={onFechar}>
      <div className="bg-ww-drawer border border-ww-border rounded-xl shadow-2xl w-full max-w-6xl max-h-[88vh] flex flex-col"
           onClick={(e) => e.stopPropagation()}>

        <header className="flex items-start gap-3 px-4 py-3 border-b border-ww-border bg-ww-drawerHead rounded-t-xl">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-bold text-ww-text truncate">{cliente}</h2>
            <p className="text-[11px] text-ww-textMuted mt-0.5">
              Memória de cálculo · {dataBr(from)} a {dataBr(to)}
              {customerIds.length > 1 && ` · ${customerIds.length} cadastros do app`}
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar"
                  className="shrink-0 w-7 h-7 rounded-md border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition">
            ✕
          </button>
        </header>

        {err && (
          <div className="m-3 bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 rounded-lg p-3 text-[12px]">
            {err}
          </div>
        )}

        {r && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 py-3 border-b border-ww-border">
            {[
              ["Mão de obra", brl(r.custo_mao_obra), `${numBr(r.horas)} h · ${r.qtd_os} OS · ${r.tecnicos} téc.`],
              ["Despesas", brl(r.despesas), `${r.qtd_despesas} lançamentos`],
              ["Combustível", brl(r.combustivel), "rateado por km"],
              ["Custo apurado", brl(r.custo_mao_obra + r.despesas + r.combustivel), "soma das três"],
            ].map(([rot, val, hint]) => (
              <div key={rot as string}>
                <p className="text-[10px] uppercase tracking-wider text-ww-textFaint">{rot}</p>
                <p className="text-[15px] font-bold text-ww-text tabular-nums">{val}</p>
                <p className="text-[10px] text-ww-textMuted">{hint}</p>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-1 px-4 pt-2 border-b border-ww-border">
          {([["os", `OS (${data?.oss.length ?? 0})`],
             ["despesas", `Despesas (${data?.despesas.length ?? 0})`],
             ["combustivel", `Combustível (${data?.combustivel.length ?? 0})`]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setAba(k)}
              className={`relative px-3 py-1.5 text-[11.5px] transition-colors ${
                aba === k ? "text-ww-accent font-semibold" : "text-ww-textMuted hover:text-ww-text"}`}>
              {l}
              {aba === k && <span aria-hidden className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full bg-ww-accent" />}
            </button>
          ))}
        </div>

        <div className="overflow-auto flex-1 p-3">
          {loading && <p className="text-[12px] text-ww-textFaint p-4 text-center">Carregando…</p>}

          {!loading && aba === "os" && (
            <Tabela
              vazio="Nenhuma OS no período."
              cabecalho={["Dia", "OS", "Técnico", "Tipo", "Entrada", "Saída", "Horas", "R$/h", "Custo"]}
              alinhaDireita={[6, 7, 8]}
              linhas={data?.oss.map((o) => [
                dataBr(o.dia), String(o.service_id ?? "—"), String(o.technician_nome ?? "—"),
                String(o.tipo_venda ?? "—"),
                String(o.checkin_datetime ?? "").slice(11, 16) || "—",
                String(o.checkout_datetime ?? "").slice(11, 16) || "—",
                numBr(o.horas, 2), brl(o.valor_hora),
                brl(Number(o.horas ?? 0) * Number(o.valor_hora ?? 0)),
              ]) ?? []}
            />
          )}

          {!loading && aba === "despesas" && (
            <>
              {(data?.por_tipo_despesa.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {data!.por_tipo_despesa.map((t) => (
                    <span key={t.label}
                          className="text-[10.5px] px-2 py-0.5 rounded-full border border-ww-border bg-ww-rowHover text-ww-textMuted">
                      {t.label}: <strong className="text-ww-text">{brl(t.value)}</strong>
                    </span>
                  ))}
                </div>
              )}
              <Tabela
                vazio="Nenhuma despesa no período."
                cabecalho={["Data", "Tipo", "Categoria", "Descrição", "Quem", "Valor", "A descontar", "Coberto"]}
                alinhaDireita={[5, 6, 7]}
                linhas={data?.despesas.map((d) => [
                  dataBr(d.data_despesa), String(d.tipo_despesa ?? "—"),
                  String(d.categoria ?? "—"),
                  String(d.descricao ?? d.estabelecimento ?? "—"),
                  String(d.employee_nome ?? "—"),
                  brl(d.valor), brl(d.valor_a_descontar), brl(d.valor_coberto),
                ]) ?? []}
              />
            </>
          )}

          {!loading && aba === "combustivel" && (
            <Tabela
              vazio="Nenhum rateio de combustível no período."
              cabecalho={["Mês", "Técnico", "Viagens", "Km total", "Km real", "R$/litro", "Km/l", "R$/km", "Alocado"]}
              alinhaDireita={[2, 3, 4, 5, 6, 7, 8]}
              linhas={data?.combustivel.map((c) => [
                String(c.periodo_mes ?? "").slice(0, 7),
                String(c.technician_nome ?? "—"),
                numBr(c.qtd_viagens, 0), numBr(c.km_total), numBr(c.km_real),
                brl(c.preco_litro), numBr(c.consumo_km_l, 1),
                brl(c.custo_por_km), brl(c.combustivel_alocado),
              ]) ?? []}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Tabela simples do modal. Número à direita e em tabular-nums — coluna de
 *  valor só é comparável quando os dígitos alinham verticalmente. */
function Tabela({
  cabecalho, linhas, alinhaDireita = [], vazio,
}: {
  cabecalho: string[];
  linhas: string[][];
  alinhaDireita?: number[];
  vazio: string;
}) {
  if (!linhas.length) {
    return <p className="text-[12px] text-ww-textFaint p-6 text-center">{vazio}</p>;
  }
  return (
    <table className="w-full text-[11.5px] border-collapse">
      <thead className="sticky top-0 bg-ww-drawer">
        <tr>
          {cabecalho.map((h, i) => (
            <th key={h}
                className={`p-1.5 text-[10px] uppercase tracking-wider font-semibold text-ww-textMuted whitespace-nowrap
                  shadow-[0_1px_0_0_rgb(var(--color-ww-border))] ${
                  alinhaDireita.includes(i) ? "text-right" : "text-left"}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          <tr key={i} className="viz-row">
            {l.map((c, j) => (
              <td key={j}
                  className={`p-1.5 border-b border-ww-border/50 text-ww-text ${
                    alinhaDireita.includes(j) ? "text-right tabular-nums" : ""}`}
                  title={c.length > 30 ? c : undefined}>
                {c.length > 40 ? c.slice(0, 40) + "…" : c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
