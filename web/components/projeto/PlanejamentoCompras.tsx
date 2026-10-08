"use client";

// Etapa ③ da Lista de materiais — Planejamento de compras (08/10/26, spec E).
// Regra: comprar até = necessário em − prazo do fornecedor − folga. Cartões (deveria já ter
// comprado · próximos 7 dias · dentro do prazo · já com PC) e a tabela por fornecedor e data
// de pedir, com "🧾 Gerar PC" por grupo (abre a mesma folha do Gerar pedido de compra).

import { useMemo } from "react";
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

export default function PlanejamentoCompras({ itens, onGerarPc, onAbrirPrazos, podeGerar, children }: {
  itens: ItemPlano[]; onGerarPc: (ids: string[]) => void; onAbrirPrazos: () => void; podeGerar: boolean;
  /** o bloco do agente de compras (spec F) entra aqui, entre os cartões e a tabela */
  children?: React.ReactNode;
}) {
  const r = useMemo(() => resumoPlano(itens), [itens]);
  const grupos = useMemo(() => {
    const g = new Map<string, { forn: string; comprar: string; prazo: number; estimado: boolean; status: string; itens: ItemPlano[] }>();
    for (const x of r.abertos) {
      if (!x.plano.comprarAte) continue;
      const forn = x.fornecedor || "— sem fornecedor";
      const k = `${forn}|${x.plano.comprarAte}`;
      const a = g.get(k) ?? { forn, comprar: x.plano.comprarAte, prazo: x.plano.prazo, estimado: x.plano.estimado, status: x.plano.status, itens: [] };
      a.itens.push(x); g.set(k, a);
    }
    return [...g.values()].sort((a, b) => a.comprar.localeCompare(b.comprar) || a.forn.localeCompare(b.forn));
  }, [r.abertos]);
  const Card = ({ t, n, v, sub, cls }: { t: string; n: number; v?: number; sub?: string; cls: string }) => (
    <div className={`rounded-lg border px-3 py-2 bg-ww-rowHover/40 ${cls}`}>
      <small className="block text-[10.5px] text-ww-textMuted">{t}</small>
      <b className="block text-[18px] text-ww-text tabular-nums">{n} {n === 1 ? "item" : "itens"}</b>
      <small className="block text-[11px] text-ww-textFaint">{v != null ? brl(v) : sub}</small>
    </div>);
  return (
    <div className="space-y-2.5" data-etapa-plan>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-ww-textMuted">Regra: <b className="text-ww-text">comprar até = necessário em − prazo do fornecedor − {FOLGA_ENTREGA_DIAS} dias de folga</b>. O prazo vem do histórico de compras (pedido → NF) e pode ser ajustado por fornecedor.{r.semData ? ` ${r.semData} item(ns) sem “necessário em” ficam de fora.` : ""}</span>
        <button type="button" onClick={onAbrirPrazos} className="ml-auto px-2.5 py-1 text-[11.5px] rounded-lg border border-ww-border text-ww-text hover:border-ww-accent">⏱ Prazos por fornecedor</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" data-cards-plan>
        <Card t="Deveria já ter comprado" n={r.atr.length} v={valor(r.atr)} cls="border-rose-500/50" />
        <Card t="Comprar nos próximos 7 dias" n={r.ag.length} v={valor(r.ag)} cls="border-amber-500/50" />
        <Card t="Dentro do prazo" n={r.ok.length} v={valor(r.ok)} cls="border-ww-border" />
        <Card t="Já com PC" n={r.comPc.length} sub={`${r.comPc.filter((x) => x.pcAtrasa).length} com previsão depois do necessário`} cls="border-ww-border" />
      </div>
      {children}
      <details open={!children} className="rounded-lg border border-ww-border">
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
              {!grupos.length && <tr><td colSpan={7} className="p-3 text-ww-textFaint">Nada a comprar — todos os itens têm PC ou estão sem “necessário em”.</td></tr>}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
