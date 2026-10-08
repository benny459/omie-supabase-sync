"use client";

// "⏱ Prazos por fornecedor" (08/10/26, spec E): histórico (média pedido → NF) × prazo usado
// no planejamento. Vazio = vale o histórico. Grava em compras.fornecedor_prazo (sql/128).

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { normFornecedor, PRAZO_ESTIMADO_DIAS, type PrazoFornecedor } from "@/lib/planejamento-compras";

export default function PrazosFornecedorModal({ empresa, prazos, daLista, onSalvo, onFechar }: {
  empresa: string; prazos: Map<string, PrazoFornecedor>;
  /** fornecedores das linhas da lista (aparecem primeiro), com quantos itens sem PC */
  daLista: { nome: string; itens: number }[];
  onSalvo: (alterados: { norm: string; nome: string; manual: number | null }[]) => void; onFechar: () => void;
}) {
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const linhas = useMemo(() => {
    const vistos = new Set<string>();
    const out: { norm: string; nome: string; itens: number; p?: PrazoFornecedor }[] = [];
    for (const f of daLista) {
      const k = normFornecedor(f.nome); if (!k || vistos.has(k)) continue; vistos.add(k);
      out.push({ norm: k, nome: f.nome, itens: f.itens, p: prazos.get(k) });
    }
    for (const p of prazos.values()) {
      if (vistos.has(p.norm) || (p.manual == null && !mostrarTodos)) continue; vistos.add(p.norm);
      out.push({ norm: p.norm, nome: p.nome, itens: 0, p });
    }
    return out;
  }, [daLista, prazos, mostrarTodos]);
  const mudou = Object.entries(edit).filter(([k, v]) => {
    const atual = prazos.get(k)?.manual;
    return (v.trim() === "" ? null : Number(v)) !== (atual ?? null);
  });

  const salvar = async () => {
    setSalvando(true); setErro(null);
    const feitos: { norm: string; nome: string; manual: number | null }[] = [];
    try {
      for (const [k, v] of mudou) {
        const l = linhas.find((x) => x.norm === k); if (!l) continue;
        const manual = v.trim() === "" ? null : Math.max(0, Math.round(Number(v)));
        const r = await fetch("/api/compras/fornecedor-prazo", { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ emp: empresa, fornecedor: l.p?.nome || l.nome, prazo_dias: manual }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as { error?: string }).error ?? r.statusText);
        feitos.push({ norm: k, nome: l.nome, manual });
      }
      onSalvo(feitos);
    } catch (e) { setErro((e as Error).message); if (feitos.length) onSalvo(feitos); }
    finally { setSalvando(false); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[125] bg-black/45 flex items-end sm:items-start justify-center sm:pt-[8vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div role="dialog" aria-label="Prazos por fornecedor" data-modal="prazos"
        className="w-full sm:w-[min(680px,96vw)] max-h-[86vh] flex flex-col rounded-t-xl sm:rounded-xl border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl text-[12px]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-ww-border">
          <h4 className="text-[14px] font-semibold text-ww-text">Prazos de entrega por fornecedor</h4>
          <button type="button" className="ml-auto text-ww-textMuted hover:text-ww-text" onClick={onFechar}>✕</button>
        </div>
        <div className="px-4 py-3 overflow-auto">
          <div className="grid grid-cols-[minmax(0,1fr)_90px_130px] gap-2 text-[10.5px] uppercase tracking-wider text-ww-textFaint pb-1 border-b border-ww-border">
            <span>Fornecedor</span><span className="text-right">Histórico</span><span>Prazo usado (dias)</span>
          </div>
          {linhas.map((l) => {
            const h = l.p?.historico ?? null;
            const v = edit[l.norm] ?? (l.p?.manual != null ? String(l.p.manual) : "");
            return (
              <div key={l.norm} className="grid grid-cols-[minmax(0,1fr)_90px_130px] gap-2 items-center py-1.5 border-b border-ww-border/50" data-forn={l.norm}>
                <span className="min-w-0"><span className="block truncate text-ww-text" title={l.nome}>{l.nome}</span>
                  {l.itens > 0 && <small className="text-ww-textFaint">{l.itens} item(ns) sem PC nesta lista</small>}</span>
                <span className={`text-right tabular-nums ${h != null && h > 60 ? "text-amber-700 dark:text-amber-300" : "text-ww-textMuted"}`}
                  title={h != null && h > 60 ? "Média do histórico acima de 60 dias — pode ter NF lançada muito depois do pedido; confira e ajuste" : undefined}>
                  {h != null ? `${h}d${h > 60 ? " ⚠" : ""}` : "—"}</span>
                <span className="flex items-center gap-1">
                  <input type="number" min={0} max={365} value={v} placeholder={h != null ? String(h) : String(PRAZO_ESTIMADO_DIAS)}
                    onChange={(e) => setEdit((x) => ({ ...x, [l.norm]: e.target.value }))}
                    className="w-20 bg-transparent border border-ww-border rounded px-1.5 py-0.5 text-right text-[12px] text-ww-text" />
                  <small className="text-ww-textFaint">dias</small>
                </span>
              </div>);
          })}
          {!linhas.length && <p className="py-3 text-ww-textFaint">Nenhum fornecedor nas linhas sem PC da lista.</p>}
          <button type="button" className="mt-2 text-[11px] text-ww-accent hover:underline" onClick={() => setMostrarTodos((x) => !x)}>
            {mostrarTodos ? "mostrar só os da lista e os ajustados" : "mostrar todos os fornecedores com histórico"}</button>
          <small className="block mt-2 text-ww-textFaint">Histórico = média pedido → NF de entrada das compras. O prazo usado prevalece no planejamento de todos os projetos; vazio usa o histórico. Item sem fornecedor usa {PRAZO_ESTIMADO_DIAS} dias e fica marcado “prazo estimado”.</small>
          {erro && <p className="mt-2 text-rose-600 dark:text-rose-400">Não gravou: {erro}</p>}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-ww-border">
          <small className="text-ww-textMuted">{mudou.length ? `${mudou.length} alteração(ões)` : "sem alterações"}</small>
          <button type="button" className="ml-auto px-3 py-1.5 rounded-lg border border-ww-border text-ww-textMuted hover:text-ww-text" onClick={onFechar}>Cancelar</button>
          <button type="button" disabled={!mudou.length || salvando} onClick={() => void salvar()} data-salvar="prazos"
            className="px-3 py-1.5 rounded-lg bg-ww-accent text-white font-semibold hover:brightness-110 disabled:opacity-40">{salvando ? "Salvando…" : "Salvar"}</button>
        </div>
      </div>
    </div>, document.body);
}
