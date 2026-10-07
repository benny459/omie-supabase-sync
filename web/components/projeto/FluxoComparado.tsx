"use client";
// Projeto › 4 Fluxo de caixa — o gráfico "fluxo inicial × fluxo em andamento" (07/10/26, Benny).
//
// "Um é o fluxo inicial travado; o outro muda conforme compro e mudo previsões, e eu
//  comparo com o inicial." As regras de cada fluxo vivem em lib/fluxo-comparado.ts; aqui
// só se agrupa por semana/mês, acumula o saldo e desenha.
//
//   barras   entradas (+) e saídas (−) por período: CONTORNO = inicial, CHEIA = em andamento
//   linhas   saldo acumulado inicial (tracejada, neutra) × em andamento (cheia, azul)
//   marcas   menor saldo de cada linha, maior desvio entre as duas, e hoje
//
// No topo, a barra de aprovação do fluxo (antes no Resumo): enviar / aprovar / rejeitar /
// reabrir, que é o que libera a aprovação dos PCs do projeto.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHROME, seriesColor } from "@/lib/viz/palette";
import { useVizTema } from "@/components/viz/useVizMode";

export type EvFluxo = {
  tipo: "entrada" | "saida"; data: string | null; valor: number; descricao: string;
  origem: string; status: "previsto" | "realizado" | "vencido"; ref?: string | null; data_original?: string | null;
};
export type ParcelaDelta = {
  parcela: number; descricao: string; inicial_data: string | null; inicial_valor: number;
  atual_data: string | null; atual_valor: number; fonte_data: string;
};
type Cab = { status: "rascunho" | "pendente" | "aprovado" | "rejeitado"; versao: number;
  decidido_por?: string | null; decidido_em?: string | null; motivo?: string | null };
type Evento = { versao: number; acao: string; por: string | null; em: string; motivo: string | null;
  total_entradas: number | null; total_saidas: number | null };
export type DadosComparado = {
  inicial: EvFluxo[]; atual: EvFluxo[];
  inicial_fonte: "congelado" | "plano_vivo" | "vazio"; inicial_em: string | null; inicial_proposta: string | null;
  plano_mudou: boolean; parcelas: ParcelaDelta[];
  saidas_plano: { descricao: string; origem: string; inicial_data: string | null; inicial_valor: number }[];
  regra_material: "substituido" | "mantido"; avisos: string[]; hoje: string;
  cabecalho: Cab; eventos: Evento[]; pode: { editar: boolean; aprovar: boolean; redefinir: boolean };
  error?: string;
};

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brlK = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${v < 0 ? "−" : ""}R$ ${(a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `${v < 0 ? "−" : ""}R$ ${(a / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return brl(v);
};
const dBr = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a.slice(2)}`;
};
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const difDias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
const dias = (n: number) => `${n > 0 ? "+" : ""}${n} d`;

type Periodo = "semana" | "mes";
/** Chave do período: segunda-feira da semana, ou dia 1 do mês. */
const chaveDe = (iso: string, p: Periodo) => {
  if (p === "mes") return `${iso.slice(0, 7)}-01`;
  const t = new Date(`${iso}T12:00:00Z`);
  const dw = (t.getUTCDay() + 6) % 7; // 0 = segunda
  t.setUTCDate(t.getUTCDate() - dw);
  return t.toISOString().slice(0, 10);
};
const proxima = (k: string, p: Periodo) => {
  const t = new Date(`${k}T12:00:00Z`);
  if (p === "mes") t.setUTCMonth(t.getUTCMonth() + 1); else t.setUTCDate(t.getUTCDate() + 7);
  return t.toISOString().slice(0, 10);
};
const rotuloDe = (k: string, p: Periodo) =>
  p === "mes" ? `${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}` : `${k.slice(8, 10)}/${k.slice(5, 7)}`;

type Linha = {
  k: string; x: string;
  entIni: number; saiIni: number; entAt: number; saiAt: number;
  /** saídas negativas para desenhar abaixo do zero */
  saiIniNeg: number; saiAtNeg: number;
  saldoIni: number; saldoAt: number;
};

/** Agrupa os dois fluxos no mesmo eixo de períodos e acumula o saldo. */
export function agrupar(ini: EvFluxo[], at: EvFluxo[], p: Periodo): Linha[] {
  const datas = [...ini, ...at].map((e) => e.data).filter(Boolean) as string[];
  if (!datas.length) return [];
  datas.sort();
  const mapa = new Map<string, Linha>();
  let k = chaveDe(datas[0], p);
  const fim = chaveDe(datas[datas.length - 1], p);
  for (let guard = 0; k <= fim && guard < 400; guard++, k = proxima(k, p)) {
    mapa.set(k, { k, x: rotuloDe(k, p), entIni: 0, saiIni: 0, entAt: 0, saiAt: 0, saiIniNeg: 0, saiAtNeg: 0, saldoIni: 0, saldoAt: 0 });
  }
  const soma = (l: EvFluxo[], ent: "entIni" | "entAt", sai: "saiIni" | "saiAt") => {
    for (const e of l) {
      if (!e.data) continue;
      const c = mapa.get(chaveDe(e.data, p));
      if (!c) continue;
      c[e.tipo === "entrada" ? ent : sai] += Number(e.valor) || 0;
    }
  };
  soma(ini, "entIni", "saiIni");
  soma(at, "entAt", "saiAt");
  let aI = 0, aA = 0;
  return [...mapa.values()].map((c) => {
    aI += c.entIni - c.saiIni; aA += c.entAt - c.saiAt;
    return { ...c, saiIniNeg: -c.saiIni, saiAtNeg: -c.saiAt, saldoIni: aI, saldoAt: aA };
  });
}

/** Totais e indicadores — o que vai nos KPIs. Exportado para conferência. */
export function indicadores(d: Pick<DadosComparado, "inicial" | "atual" | "parcelas">, linhas: Linha[]) {
  const t = (l: EvFluxo[], tipo: string) => l.filter((e) => e.tipo === tipo).reduce((a, e) => a + (Number(e.valor) || 0), 0);
  const entIni = t(d.inicial, "entrada"), saiIni = t(d.inicial, "saida");
  const entAt = t(d.atual, "entrada"), saiAt = t(d.atual, "saida");
  const minDe = (key: "saldoIni" | "saldoAt") => linhas.reduce<{ v: number; x: string; k: string } | null>(
    (m, l) => (m == null || l[key] < m.v ? { v: l[key], x: l.x, k: l.k } : m), null);
  const desvio = linhas.reduce<{ v: number; x: string; k: string } | null>((m, l) => {
    const g = l.saldoAt - l.saldoIni;
    return m == null || Math.abs(g) > Math.abs(m.v) ? { v: g, x: l.x, k: l.k } : m;
  }, null);
  // prazo das ENTRADAS: média ponderada pelo valor, parcela a parcela (atual − inicial)
  const pe = d.parcelas.filter((p) => p.inicial_data && p.atual_data);
  const pesoE = pe.reduce((a, p) => a + (p.inicial_valor || p.atual_valor || 0), 0);
  const prazoEnt = pesoE ? Math.round(pe.reduce((a, p) => a + difDias(p.atual_data!, p.inicial_data!) * (p.inicial_valor || p.atual_valor || 0), 0) / pesoE) : null;
  // prazo das SAÍDAS: centro de massa no tempo (data média ponderada) atual − inicial —
  // as saídas do plano viram PCs/lista e não há par linha a linha
  const centro = (l: EvFluxo[]) => {
    const s = l.filter((e) => e.tipo === "saida" && e.data);
    const peso = s.reduce((a, e) => a + e.valor, 0);
    return peso ? s.reduce((a, e) => a + Date.parse(`${e.data}T12:00:00Z`) * e.valor, 0) / peso : null;
  };
  const cI = centro(d.inicial), cA = centro(d.atual);
  const prazoSai = cI != null && cA != null ? Math.round((cA - cI) / 86400000) : null;
  return { entIni, saiIni, entAt, saiAt, resIni: entIni - saiIni, resAt: entAt - saiAt,
    minIni: minDe("saldoIni"), minAt: minDe("saldoAt"), desvio, prazoEnt, prazoSai };
}

const TOM: Record<Cab["status"], { rot: string; ponto: string; dica: string }> = {
  rascunho:  { rot: "Rascunho", ponto: "bg-ww-textFaint", dica: "ainda não foi enviado para aprovação" },
  pendente:  { rot: "Aguardando aprovação", ponto: "bg-amber-500", dica: "as compras do projeto ficam travadas até a decisão" },
  aprovado:  { rot: "Aprovado", ponto: "bg-emerald-500", dica: "as compras deste projeto já podem ser aprovadas" },
  rejeitado: { rot: "Rejeitado", ponto: "bg-rose-500", dica: "ajuste o plano e envie de novo" },
};

function Kpi({ rot, ini, at, fmt = brl, melhorMaior = true, sub }: {
  rot: string; ini?: number | null; at: number | null; fmt?: (v: number) => string; melhorMaior?: boolean; sub?: string;
}) {
  const dif = ini != null && at != null ? at - ini : null;
  const corAt = ini === undefined && at != null && Math.abs(at) >= 1
    ? ((at > 0) === melhorMaior ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300") : "text-ww-text";
  const bom = dif == null || Math.abs(dif) < 0.5 ? null : (dif > 0) === melhorMaior;
  return (
    <div className="min-w-0 rounded-lg border border-ww-border bg-ww-panel px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-[0.6px] font-bold text-ww-textFaint truncate">{rot}</div>
      <div className={`mt-1 text-[16px] font-bold tabular-nums truncate ${corAt}`}>{at == null ? "—" : fmt(at)}</div>
      {ini !== undefined && <div className="text-[11px] tabular-nums text-ww-textMuted truncate">
        inicial {ini == null ? "—" : fmt(ini)}
        {dif != null && Math.abs(dif) >= 0.5 && (
          <span className={`ml-1 font-semibold ${bom ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}`}>
            {dif > 0 ? "▲" : "▼"} {fmt(Math.abs(dif))}
          </span>
        )}
      </div>}
      {sub && <div className="text-[10.5px] text-ww-textFaint truncate">{sub}</div>}
    </div>
  );
}

export default function FluxoComparado({ empresa, codigoProjeto, onDados }: {
  empresa: string; codigoProjeto: number; onDados?: (d: DadosComparado) => void;
}) {
  const [d, setD] = useState<DadosComparado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<"auto" | Periodo>("auto");
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const { mode, tema } = useVizTema();
  const c = CHROME[mode];

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/rc-projetos/fluxo-comparado?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}`, { cache: "no-store" });
      const j = (await r.json()) as DadosComparado;
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setErro(null); setD(j); onDados?.(j);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }, [empresa, codigoProjeto, onDados]);
  useEffect(() => { void carregar(); }, [carregar]);

  /* Semana em projeto curto, mês quando passa de ~4 meses: 30 barras semanais num
     projeto de um ano viram traço; 3 barras mensais num de 6 semanas não dizem nada. */
  const p: Periodo = useMemo(() => {
    if (periodo !== "auto") return periodo;
    const ds = [...(d?.inicial ?? []), ...(d?.atual ?? [])].map((e) => e.data).filter(Boolean).sort() as string[];
    if (ds.length < 2) return "semana";
    return difDias(ds[ds.length - 1], ds[0]) > 120 ? "mes" : "semana";
  }, [periodo, d]);
  const linhas = useMemo(() => (d ? agrupar(d.inicial, d.atual, p) : []), [d, p]);
  const k = useMemo(() => (d ? indicadores(d, linhas) : null), [d, linhas]);
  const xHoje = useMemo(() => (d ? linhas.find((l) => l.k === chaveDe(d.hoje, p))?.x ?? null : null), [d, linhas, p]);

  const decidir = async (acao: string, motivo?: string) => {
    setOcupado(true); setAviso(null);
    try {
      const r = await fetch("/api/rc-projetos/fluxo", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, acao, motivo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setAviso(`Erro: ${j.error ?? r.statusText}`); return; }
      setAviso(acao === "enviar" ? "Enviado para aprovação." : acao === "aprovar" ? "Fluxo aprovado — as compras do projeto já podem ser aprovadas."
        : acao === "rejeitar" ? "Fluxo rejeitado." : "Fluxo reaberto.");
      await carregar();
    } finally { setOcupado(false); }
  };
  const redefinir = async () => {
    if (!window.confirm("Refazer o fluxo INICIAL com o plano que está no projeto agora?\n\nA foto atual (a que serve de comparação) é substituída. Use só quando a proposta foi revisada e o novo plano passa a ser a referência.")) return;
    setOcupado(true); setAviso(null);
    try {
      const r = await fetch("/api/rc-projetos/fluxo-comparado", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, acao: "redefinir" }) });
      const j = await r.json().catch(() => ({}));
      setAviso(r.ok ? `Fluxo inicial redefinido (${j.linhas ?? 0} lançamentos).` : `Erro: ${j.error ?? r.statusText}`);
      if (r.ok) await carregar();
    } finally { setOcupado(false); }
  };

  if (erro) return <div className="text-[12px] text-rose-600 dark:text-rose-300">Não consegui montar o gráfico do fluxo: {erro}</div>;
  if (!d || !k) {
    return (
      <section className="rounded-xl border border-ww-border bg-ww-panel p-4">
        <div className="h-[360px] animate-pulse rounded-lg bg-ww-rowHover/60" />
        <p className="mt-2 text-[11.5px] text-ww-textMuted">Montando o fluxo inicial e o em andamento…</p>
      </section>
    );
  }

  const cab = d.cabecalho ?? { status: "rascunho", versao: 1 };
  const tom = TOM[cab.status] ?? TOM.rascunho;
  const corEnt = seriesColor(5, mode, tema);
  const corSai = seriesColor(3, mode, tema);
  const corAt = seriesColor(0, mode, tema);
  const corIni = c.inkMuted;
  const vazio = !linhas.length;

  return (
    <div className="space-y-3">
      {/* ── Aprovação do fluxo (veio do Resumo) ─────────────────────────────── */}
      <div className="flex items-center gap-2.5 flex-wrap rounded-xl border border-ww-border bg-ww-panel px-3 py-2 text-[12px]">
        <span aria-hidden className={`w-2 h-2 rounded-full shrink-0 ${tom.ponto}`} />
        <div className="min-w-0">
          <span className="text-[10px] uppercase tracking-[0.6px] font-bold text-ww-textFaint mr-1.5">Aprovação do fluxo</span>
          <strong className="text-ww-text">{tom.rot}</strong>
          {cab.versao > 1 && <span className="text-ww-textFaint"> · v{cab.versao}</span>}
          <span className="text-ww-textMuted"> — {tom.dica}
            {cab.status === "aprovado" && cab.decidido_por ? ` · por ${cab.decidido_por}${cab.decidido_em ? ` em ${new Date(cab.decidido_em).toLocaleDateString("pt-BR")}` : ""}` : ""}
            {cab.status === "rejeitado" && cab.motivo ? ` · motivo: ${cab.motivo}` : ""}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          {d.pode.editar && cab.status !== "pendente" && (
            <button type="button" disabled={ocupado} onClick={() => void decidir("enviar")}
              title="Manda o fluxo para aprovação do administrador"
              className="px-2.5 py-1 text-[11.5px] rounded-lg border border-ww-border text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40">
              Enviar para aprovação
            </button>
          )}
          {d.pode.aprovar && cab.status === "pendente" && (
            <>
              <button type="button" disabled={ocupado} onClick={() => void decidir("aprovar")}
                className="px-2.5 py-1 text-[11.5px] rounded-lg bg-emerald-600 text-white font-semibold hover:brightness-110 transition disabled:opacity-40">
                Aprovar fluxo
              </button>
              <button type="button" disabled={ocupado}
                onClick={() => { const m = window.prompt("Motivo da rejeição:"); if (m?.trim()) void decidir("rejeitar", m.trim()); }}
                className="px-2.5 py-1 text-[11.5px] rounded-lg border border-rose-500/50 text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 transition disabled:opacity-40">
                Rejeitar
              </button>
            </>
          )}
          {d.pode.aprovar && cab.status === "aprovado" && (
            <button type="button" disabled={ocupado} onClick={() => void decidir("reabrir")}
              title="Volta para rascunho — as compras do projeto voltam a ficar travadas"
              className="px-2.5 py-1 text-[11.5px] rounded-lg border border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40">
              Reabrir
            </button>
          )}
          {d.eventos.length > 0 && (
            <details className="relative">
              <summary className="list-none cursor-pointer px-2 py-1 text-[11px] text-ww-textMuted hover:text-ww-text">Histórico ({d.eventos.length})</summary>
              <ul className="absolute right-0 z-20 mt-1 w-[min(420px,85vw)] max-h-[260px] overflow-auto rounded-lg border border-ww-border bg-ww-panel p-2 shadow-lg space-y-1">
                {d.eventos.map((e, i) => (
                  <li key={i} className="text-[11px] text-ww-textMuted">
                    <span className="tabular-nums text-ww-textFaint">{new Date(e.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>{" "}
                    <strong className="text-ww-text">{e.acao}</strong> v{e.versao} · {e.por ?? "—"}
                    {e.total_entradas != null && <> · {brl(Number(e.total_entradas))} entra · {brl(Number(e.total_saidas ?? 0))} sai</>}
                    {e.motivo && <em className="text-ww-textFaint"> “{e.motivo}”</em>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
      {aviso && <div className={`px-3 py-1.5 rounded-lg text-[12px] ${aviso.startsWith("Erro") ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>{aviso}</div>}

      {/* ── KPIs: inicial × em andamento ───────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Kpi rot="Entradas" ini={k.entIni} at={k.entAt} />
        <Kpi rot="Saídas" ini={k.saiIni} at={k.saiAt} melhorMaior={false} />
        <Kpi rot="Resultado" ini={k.resIni} at={k.resAt} />
        <Kpi rot="Menor saldo" ini={k.minIni?.v ?? null} at={k.minAt?.v ?? null}
          sub={k.minAt ? `em andamento: ${k.minAt.x}${k.minIni ? ` · inicial: ${k.minIni.x}` : ""}` : undefined} />
        <Kpi rot="Prazo das entradas" at={k.prazoEnt} fmt={(v) => dias(Math.round(v))} melhorMaior={false}
          sub="atual − inicial, média ponderada (+ = atrasou)" />
        <Kpi rot="Prazo das saídas" at={k.prazoSai} fmt={(v) => dias(Math.round(v))}
          sub="data média, atual − inicial (+ = pagar depois)" />
      </div>

      {/* ── Gráfico ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-ww-border bg-ww-panel p-3.5 min-w-0">
        <header className="flex items-start gap-3 flex-wrap mb-2">
          <div className="min-w-0">
            <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">Fluxo inicial × em andamento</h3>
            <p className="text-[11px] text-ww-textMuted mt-0.5">
              Barra com contorno = <strong>inicial</strong> (travado{d.inicial_em ? ` em ${dBr(d.inicial_em)}` : ""}{d.inicial_proposta ? ` · ${d.inicial_proposta}` : ""});
              barra cheia = <strong>em andamento</strong> (PCs, lista sem PC, previsões novas e o que já foi baixado).
              Linhas: saldo acumulado.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-ww-border p-0.5 text-[11px]">
            {(["auto", "semana", "mes"] as const).map((o) => (
              <button key={o} type="button" onClick={() => setPeriodo(o)}
                className={`px-2 py-0.5 rounded-md transition ${periodo === o ? "bg-ww-accent text-white font-semibold" : "text-ww-textMuted hover:text-ww-text"}`}>
                {o === "auto" ? `Auto (${p === "mes" ? "mês" : "semana"})` : o === "mes" ? "Mês" : "Semana"}
              </button>
            ))}
          </div>
        </header>

        {d.inicial_fonte !== "congelado" && (
          <p className="mb-2 text-[11px] text-amber-700 dark:text-amber-300">
            {d.inicial_fonte === "vazio" ? "Sem plano do fechamento: não há fluxo inicial para comparar." : "O fluxo inicial ainda não está travado — usando o plano atual."}
          </p>
        )}
        {d.plano_mudou && (
          <p className="mb-2 text-[11px] text-ww-textMuted">
            O plano do CRM mudou depois da foto inicial (proposta revisada). O inicial continua o de antes
            {d.pode.redefinir ? <> — <button type="button" disabled={ocupado} onClick={() => void redefinir()} className="text-ww-accent underline disabled:opacity-40">redefinir fluxo inicial</button> (administrador).</> : "; só um administrador pode redefini-lo."}
          </p>
        )}

        {/* Legenda própria: diz o que é contorno e o que é cheio, o que a do recharts não sabe dizer. */}
        <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-ww-textMuted mb-1.5">
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: corEnt }} />Entradas</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-sm" style={{ background: corSai }} />Saídas</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-3 rounded-sm border-[1.5px]" style={{ borderColor: c.inkMuted }} />contorno = inicial · cheio = em andamento</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: corIni }} />Saldo inicial</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-5 border-t-2" style={{ borderColor: corAt }} />Saldo em andamento</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c.surface, border: `2px solid ${corAt}` }} />menor saldo</span>
        </div>

        {vazio ? (
          <div className="h-[200px] grid place-items-center text-[12px] text-ww-textMuted">Nenhum lançamento com data para desenhar.</div>
        ) : (
          <div className="h-[340px] sm:h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={linhas} margin={{ top: 18, right: 10, bottom: 0, left: 0 }} barCategoryGap="18%" stackOffset="sign">
                <CartesianGrid horizontal vertical={false} stroke={c.gridline} />
                {/* Dois eixos X com as MESMAS categorias: o inicial (largo, contorno) fica
                    por baixo do em andamento (estreito, cheio) — a barra se compara com a
                    sua própria sombra, sem dobrar a largura do gráfico. */}
                <XAxis dataKey="x" xAxisId="ini" tick={{ fontSize: 10.5, fill: c.inkMuted }} stroke={c.axis} interval="preserveStartEnd" minTickGap={8} />
                <XAxis dataKey="x" xAxisId="at" hide />
                <YAxis tick={{ fontSize: 10.5, fill: c.inkMuted }} stroke={c.axis} width={78} tickFormatter={(v) => brlK(Number(v))} />
                <ReferenceLine y={0} xAxisId="ini" stroke={c.axis} />
                <Tooltip content={<Dica c={c} />} cursor={{ fill: mode === "dark" ? "#ffffff10" : "#0000000a" }} />
                <Bar xAxisId="ini" dataKey="entIni" stackId="ini" fill={corEnt} fillOpacity={0.12} stroke={corEnt} strokeWidth={1.25} strokeDasharray="3 2" isAnimationActive={false} />
                <Bar xAxisId="ini" dataKey="saiIniNeg" stackId="ini" fill={corSai} fillOpacity={0.12} stroke={corSai} strokeWidth={1.25} strokeDasharray="3 2" isAnimationActive={false} />
                <Bar xAxisId="at" dataKey="entAt" stackId="at" fill={corEnt} barSize={linhas.length > 40 ? 4 : linhas.length > 20 ? 8 : 14} isAnimationActive={false} />
                <Bar xAxisId="at" dataKey="saiAtNeg" stackId="at" fill={corSai} barSize={linhas.length > 40 ? 4 : linhas.length > 20 ? 8 : 14} isAnimationActive={false} />
                <Line xAxisId="ini" dataKey="saldoIni" stroke={corIni} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                <Line xAxisId="ini" dataKey="saldoAt" stroke={corAt} strokeWidth={2.5} dot={false} activeDot={{ r: 4.5, strokeWidth: 2, stroke: c.surface }} isAnimationActive={false} />
                {xHoje && (
                  <ReferenceLine xAxisId="ini" x={xHoje} stroke={c.inkMuted} strokeDasharray="3 3"
                    label={{ value: "HOJE", position: "insideTopRight", fill: c.inkMuted, fontSize: 10 }} />
                )}
                {k.desvio && Math.abs(k.desvio.v) >= 1 && (
                  <ReferenceLine xAxisId="ini" x={k.desvio.x} stroke={corSai} strokeOpacity={0.55} strokeDasharray="2 3"
                    label={{ value: `maior desvio ${brlK(k.desvio.v)}`, position: "insideTopLeft", fill: c.inkMuted, fontSize: 10 }} />
                )}
                {k.minIni && (
                  <ReferenceDot xAxisId="ini" x={k.minIni.x} y={k.minIni.v} r={5} fill={c.surface} stroke={corIni} strokeWidth={2}
                    label={{ value: `mín. inicial ${brlK(k.minIni.v)}`, position: "bottom", fill: c.inkMuted, fontSize: 10 }} />
                )}
                {k.minAt && (
                  <ReferenceDot xAxisId="ini" x={k.minAt.x} y={k.minAt.v} r={5.5} fill={c.surface} stroke={corAt} strokeWidth={2.5}
                    label={{ value: `mín. ${brlK(k.minAt.v)}`, position: "top", fill: corAt, fontSize: 10.5, fontWeight: 700 }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        <details className="mt-2 text-[11px] text-ww-textMuted">
          <summary className="cursor-pointer select-none">Como cada fluxo é montado</summary>
          <ul className="mt-1.5 space-y-1 list-disc pl-4">
            <li><strong className="text-ww-text">Inicial</strong>: foto do plano do fechamento na primeira importação — parcelas pela data inicial de recebimento e a agenda de saídas da planilha. Não muda quando o CRM reimporta.</li>
            <li><strong className="text-ww-text">Entradas em andamento</strong>: cada parcela pela data atual — vencimento do título se o PV/OS já faturou, senão a nova previsão de recebimento (Operação › Projetos), senão a inicial.</li>
            <li><strong className="text-ww-text">Saídas em andamento</strong>: PCs do projeto (sem escondidos, cancelados e reprovados) pelas parcelas do PC, ou previsão de entrega + prazo da condição; linhas da Lista ainda sem PC pelo estimado em “necessário em”; e as saídas do plano que não são material (obra, despesas).</li>
            <li><strong className="text-ww-text">Sem contar duas vezes</strong>: {d.regra_material === "substituido"
              ? "este projeto já tem PC ou Lista, então a saída de MATERIAL do plano sai do andamento — quem a representa são os PCs e a Lista."
              : "este projeto ainda não tem PC nem Lista, então a saída de material do plano continua no andamento."}</li>
            <li><strong className="text-ww-text">Realizado</strong>: título baixado entra na data da baixa e abate o previsto em ordem de data. Previsto vencido e não baixado conta como hoje.</li>
          </ul>
        </details>
        {d.avisos.length > 0 && <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">{d.avisos.join(" ")}</p>}
      </section>
    </div>
  );
}

/** Tooltip por período: inicial × em andamento × diferença. */
function Dica({ c, active, payload, label }: {
  c: Record<"surface" | "gridline" | "ink" | "inkMuted" | "inkFaint", string>; active?: boolean; label?: string;
  payload?: { payload: Linha }[];
}) {
  if (!active || !payload?.length) return null;
  const l = payload[0].payload;
  const linha = (rot: string, a: number, b: number, inverso = false) => {
    const dif = b - a;
    const cor = Math.abs(dif) < 0.5 ? c.inkMuted : (dif > 0) !== inverso ? "#16a34a" : "#dc2626";
    return (
      <tr>
        <td style={{ color: c.inkMuted, paddingRight: 10 }}>{rot}</td>
        <td style={{ textAlign: "right", paddingRight: 10 }}>{brl(a)}</td>
        <td style={{ textAlign: "right", paddingRight: 10, fontWeight: 600 }}>{brl(b)}</td>
        <td style={{ textAlign: "right", color: cor }}>{Math.abs(dif) < 0.5 ? "—" : `${dif > 0 ? "+" : "−"}${brl(Math.abs(dif))}`}</td>
      </tr>
    );
  };
  return (
    <div style={{ background: c.surface, border: `1px solid ${c.gridline}`, borderRadius: 8, padding: "8px 10px", fontSize: 11.5, color: c.ink, boxShadow: "0 6px 20px rgba(0,0,0,.12)" }}>
      <div style={{ color: c.inkMuted, fontSize: 10.5, marginBottom: 4 }}>{label}</div>
      <table style={{ fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr style={{ color: c.inkFaint, fontSize: 10 }}>
            <th /><th style={{ textAlign: "right", paddingRight: 10 }}>inicial</th>
            <th style={{ textAlign: "right", paddingRight: 10 }}>atual</th><th style={{ textAlign: "right" }}>Δ</th>
          </tr>
        </thead>
        <tbody>
          {linha("Entradas", l.entIni, l.entAt)}
          {linha("Saídas", l.saiIni, l.saiAt, true)}
          {linha("Saldo acum.", l.saldoIni, l.saldoAt)}
        </tbody>
      </table>
    </div>
  );
}
