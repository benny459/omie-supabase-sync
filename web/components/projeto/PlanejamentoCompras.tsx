"use client";

// Etapa ③ da Lista de materiais — Planejamento de compras (08/10/26, spec E).
// Regra: comprar até = necessário em − prazo do fornecedor − folga. Cartões (deveria já ter
// comprado · próximos 7 dias · dentro do prazo · já com PC) e a tabela por fornecedor e data
// de pedir, com "🧾 Gerar PC" por grupo (abre a mesma folha do Gerar pedido de compra).

import { useMemo, useState } from "react";
import { FOLGA_ENTREGA_DIAS } from "@/lib/sinal-entrega";
import type { PlanoItem } from "@/lib/planejamento-compras";

export type ItemPlano = {
  id: string; item: string; qtd: number; un: string; vu: number; fornecedor: string | null;
  necessario: string | null; temPc: boolean; pcAtrasa: boolean; plano: PlanoItem;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const d2 = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : "—");
const valor = (xs: ItemPlano[]) => xs.reduce((a, x) => a + x.qtd * x.vu, 0);

export function resumoPlano(itens: ItemPlano[]) {
  const abertos = itens.filter((x) => !x.temPc && x.necessario);
  const atr = abertos.filter((x) => x.plano.status === "atrasado");
  const ag = abertos.filter((x) => x.plano.status === "agora");
  const ok = abertos.filter((x) => x.plano.status === "ok");
  const comPc = itens.filter((x) => x.temPc);
  return { abertos, atr, ag, ok, comPc, semana: valor(atr) + valor(ag), nSemana: atr.length + ag.length, semData: itens.filter((x) => !x.temPc && !x.necessario).length };
}

/** Caixas de filtro da etapa ③ (08/10/26, Benny: "transforma isso em caixas de filtros"). */
export type FiltroPlano = "atr" | "ag" | "ok" | "pc";
const COR_FILTRO: Record<FiltroPlano, string> = { atr: "#e5484d", ag: "#f5a524", ok: "#2fb67a", pc: "#3b82f6" };

export default function PlanejamentoCompras({ itens, onGerarPc, onAbrirPrazos, podeGerar, children, onVerNaLista }: {
  itens: ItemPlano[]; onGerarPc: (ids: string[]) => void; onAbrirPrazos: () => void; podeGerar: boolean;
  /** o bloco do agente de compras (spec F) entra aqui, entre os cartões e a tabela; recebe os ids
   *  do filtro ativo (null = todos) para mostrar só os lotes com itens da caixa escolhida */
  children?: React.ReactNode | ((filtroIds: Set<string> | null) => React.ReactNode);
  /** "ver na lista →" das caixas de atrasados / próximos 7 dias */
  onVerNaLista?: () => void;
}) {
  const r = useMemo(() => resumoPlano(itens), [itens]);
  const [filtro, setFiltro] = useState<FiltroPlano | null>(null);
  const doFiltro = useMemo(() => (filtro === "atr" ? r.atr : filtro === "ag" ? r.ag : filtro === "ok" ? r.ok : filtro === "pc" ? r.comPc : null), [filtro, r]);
  const filtroIds = useMemo(() => (doFiltro ? new Set(doFiltro.map((x) => x.id)) : null), [doFiltro]);
  const grupos = useMemo(() => {
    const g = new Map<string, { forn: string; comprar: string; prazo: number; estimado: boolean; status: string; itens: ItemPlano[] }>();
    for (const x of r.abertos) {
      if (filtroIds && !filtroIds.has(x.id)) continue;
      if (!x.plano.comprarAte) continue;
      const forn = x.fornecedor || "— sem fornecedor";
      const k = `${forn}|${x.plano.comprarAte}`;
      const a = g.get(k) ?? { forn, comprar: x.plano.comprarAte, prazo: x.plano.prazo, estimado: x.plano.estimado, status: x.plano.status, itens: [] };
      a.itens.push(x); g.set(k, a);
    }
    return [...g.values()].sort((a, b) => a.comprar.localeCompare(b.comprar) || a.forn.localeCompare(b.forn));
  }, [r.abertos, filtroIds]);
  const Card = ({ k, t, n, v, sub }: { k: FiltroPlano; t: string; n: number; v?: number; sub?: string }) => {
    const on = filtro === k, cor = COR_FILTRO[k];
    return (
      <button type="button" data-filtro-plan={k} aria-pressed={on} onClick={() => setFiltro(on ? null : k)}
        title={on ? "Clique de novo para ver todos" : `Mostrar só: ${t.toLowerCase()}`}
        className={`relative text-left rounded-lg border px-3 py-2 transition hover:brightness-105 ${on ? "" : "bg-ww-rowHover/40 hover:bg-ww-rowHover/70"}`}
        style={{ borderColor: on ? cor : `color-mix(in srgb, ${cor} 45%, transparent)`, ...(on ? { background: `color-mix(in srgb, ${cor} 13%, transparent)`, boxShadow: `inset 0 0 0 1px ${cor}` } : {}) }}>
        <small className="flex items-center gap-1.5 text-[10.5px] text-ww-textMuted"><i aria-hidden className="inline-block w-2 h-2 rounded-full" style={{ background: cor }} />{t}
          {on && <span className="ml-auto text-[10px] font-semibold" style={{ color: cor }}>filtrando ✕</span>}</small>
        <b className="block text-[18px] text-ww-text tabular-nums">{n} {n === 1 ? "item" : "itens"}</b>
        <small className="block text-[11px] text-ww-textFaint">{v != null ? brl(v) : sub}
          {onVerNaLista && (k === "atr" || k === "ag") && n > 0 && <span role="link" tabIndex={0} className="ml-1.5 text-ww-accent hover:underline"
            onClick={(e) => { e.stopPropagation(); onVerNaLista(); }} onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onVerNaLista(); } }}>ver na lista →</span>}</small>
      </button>);
  };
  return (
    <div className="space-y-2.5" data-etapa-plan>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-ww-textMuted">Regra: <b className="text-ww-text">comprar até = necessário em − prazo − {FOLGA_ENTREGA_DIAS} dias de folga</b>. O prazo vem do histórico de compras (pedido → NF) e pode ser ajustado por fornecedor (⏱) ou só num item (coluna Prazo da lista). Clique numa caixa para filtrar.{r.semData ? ` ${r.semData} item(ns) sem “necessário em” ficam de fora.` : ""}</span>
        <button type="button" onClick={onAbrirPrazos} className="ml-auto px-2.5 py-1 text-[11.5px] rounded-lg border border-ww-border text-ww-text hover:border-ww-accent">⏱ Prazos por fornecedor</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" data-cards-plan>
        <Card k="atr" t="Deveria já ter comprado" n={r.atr.length} v={valor(r.atr)} />
        <Card k="ag" t="Comprar nos próximos 7 dias" n={r.ag.length} v={valor(r.ag)} />
        <Card k="ok" t="Dentro do prazo" n={r.ok.length} v={valor(r.ok)} />
        <Card k="pc" t="Já com PC" n={r.comPc.length} sub={`${r.comPc.filter((x) => x.pcAtrasa).length} com previsão depois do necessário`} />
      </div>
      {filtro && (
        <div className="flex items-center gap-2 text-[11.5px]" data-filtro-plan-ativo>
          <span className="px-2 py-0.5 rounded-full font-semibold text-white" style={{ background: COR_FILTRO[filtro] }}>
            {filtro === "atr" ? "Deveria já ter comprado" : filtro === "ag" ? "Comprar nos próximos 7 dias" : filtro === "ok" ? "Dentro do prazo" : "Já com PC"} · {doFiltro?.length ?? 0}</span>
          <span className="text-ww-textMuted">os lotes do agente e a tabela mostram só estes itens</span>
          <button type="button" onClick={() => setFiltro(null)} className="text-ww-accent hover:underline">Todos</button>
        </div>)}
      {typeof children === "function" ? children(filtroIds) : children}
      {filtro === "pc" ? (
        <div className="rounded-lg border border-ww-border overflow-auto" data-tabela-pc>
          <table className="w-full text-[11.5px] border-collapse min-w-[640px]">
            <thead className="text-left text-[10.5px] uppercase tracking-wider text-ww-textFaint bg-ww-rowHover/50">
              <tr><th className="p-1.5">Item</th><th className="p-1.5">Fornecedor</th><th className="p-1.5 text-right">Valor</th><th className="p-1.5">Necessário em</th><th className="p-1.5">Previsão do PC</th></tr>
            </thead>
            <tbody>{r.comPc.map((x) => (
              <tr key={x.id} className="border-t border-ww-border/50">
                <td className="p-1.5 text-ww-text">{x.qtd} {x.un} · {x.item}</td><td className="p-1.5 text-ww-textMuted">{x.fornecedor ?? "—"}</td>
                <td className="p-1.5 text-right tabular-nums">{brl(x.qtd * x.vu)}</td><td className="p-1.5 tabular-nums">{d2(x.necessario)}</td>
                <td className="p-1.5">{x.pcAtrasa ? <span className="text-rose-600 dark:text-rose-400">✕ chega depois do necessário</span> : <span className="text-emerald-700 dark:text-emerald-400">✓ no prazo</span>}</td>
              </tr>))}
              {!r.comPc.length && <tr><td colSpan={5} className="p-3 text-ww-textFaint">Nenhum item com PC ainda.</td></tr>}</tbody>
          </table>
        </div>
      ) : (
      <details open={!children || !!filtro} className="rounded-lg border border-ww-border">
        <summary className="cursor-pointer px-3 py-2 text-[11.5px] text-ww-textMuted">Tabela por fornecedor e data de pedir ({grupos.length})</summary>
        <div className="overflow-auto">
          <table className="w-full text-[11.5px] border-collapse min-w-[760px]" data-tabela-plan>
            <thead className="text-left text-[10.5px] uppercase tracking-wider text-ww-textFaint bg-ww-rowHover/50">
              <tr><th className="p-1.5">Quando pedir</th><th className="p-1.5">Fornecedor</th><th className="p-1.5 text-right">Itens</th><th className="p-1.5 text-right">Valor</th>
                <th className="p-1.5">Prazo</th><th className="p-1.5">Necessário em (1º)</th><th className="p-1.5" /></tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const cls = g.status === "atrasado" ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : g.status === "agora" ? "bg-amber-500/15 text-amber-800 dark:text-amber-200" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
                return (
                  <tr key={`${g.forn}|${g.comprar}`} className="border-t border-ww-border/50">
                    <td className="p-1.5 whitespace-nowrap"><span className={`px-1.5 py-0.5 rounded-full text-[10.5px] font-semibold ${cls}`}>{g.status === "atrasado" ? "atrasado" : g.status === "agora" ? "esta semana" : d2(g.comprar)}</span> <small className="text-ww-textFaint tabular-nums">{d2(g.comprar)}</small></td>
                    <td className="p-1.5">{g.forn}{g.estimado ? <small className="text-ww-textFaint"> (prazo estimado)</small> : null}
                      <small className="block text-ww-textFaint truncate max-w-[360px]" title={g.itens.map((x) => x.item).join("\n")}>{g.itens.map((x) => x.item).join(" · ")}</small></td>
                    <td className="p-1.5 text-right tabular-nums">{g.itens.length}</td>
                    <td className="p-1.5 text-right tabular-nums">{brl(valor(g.itens))}</td>
                    <td className="p-1.5 whitespace-nowrap tabular-nums">{g.prazo}d + {FOLGA_ENTREGA_DIAS}d folga</td>
                    <td className="p-1.5 tabular-nums">{d2(g.itens.map((x) => x.necessario ?? "").sort()[0])}</td>
                    <td className="p-1.5 text-right"><button type="button" disabled={!podeGerar} onClick={() => onGerarPc(g.itens.map((x) => x.id))}
                      title={podeGerar ? "Abre a folha do pedido de compra com estes itens" : "Salve a lista antes de gerar o pedido"}
                      className="px-2 py-0.5 rounded border border-ww-accent/70 text-ww-accent hover:bg-ww-accentSoft disabled:opacity-40">🧾 Gerar PC</button></td>
                  </tr>);
              })}
              {!grupos.length && <tr><td colSpan={7} className="p-3 text-ww-textFaint">{filtro ? "Nenhum item nesta caixa." : "Nada a comprar — todos os itens têm PC ou estão sem “necessário em”."}</td></tr>}
            </tbody>
          </table>
        </div>
      </details>)}
    </div>
  );
}
