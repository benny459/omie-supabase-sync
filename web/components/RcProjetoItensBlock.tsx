"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supaBrowser } from "@/lib/supabase";

type ItemRow = {
  id: string;
  empresa: string;
  codigo_projeto: number;
  equipamento: string;
  item: string;
  qtd: number | null;
  modelo: string | null;
  observacao: string | null;
  pc_numero: string | null;
  status_fornec: string | null;
  pc_etapa_code: string | null;
};

type Resumo = {
  valor_budget: number | null;
  valor_comprometido: number | null;
  valor_restante: number | null;
  qtd_itens: number;
  qtd_itens_com_pc: number;
};

const fmtBRL = (v: number | null | undefined): string => {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

/**
 * Bloco expansível "Itens RC" pra um bucket de projeto. Cada equipamento vira
 * 1 grupo colapsável; clicar expande pra mostrar os itens (item, qtd, modelo,
 * PC# editável inline, status_fornec auto via JOIN no PC vinculado).
 *
 * Coexiste com o "Anexar RC (Excel)" tradicional — este é específico de projetos
 * (sem valores, hierárquico, status auto do PC vinculado).
 */
export default function RcProjetoItensBlock({
  empresa,
  codigoProjeto,
}: {
  empresa: string;
  codigoProjeto: number;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    const supa = supaBrowser();
    const approval = supa.schema("approval" as never);
    const [itensRes, resumoRes] = await Promise.all([
      approval
        .from("v_rc_projetos_itens")
        .select("*")
        .eq("empresa", empresa)
        .eq("codigo_projeto", codigoProjeto)
        .order("equipamento", { ascending: true })
        .order("item", { ascending: true }),
      approval
        .from("v_rc_projetos_resumo")
        .select("valor_budget, valor_comprometido, valor_restante, qtd_itens, qtd_itens_com_pc")
        .eq("empresa", empresa)
        .eq("codigo_projeto", codigoProjeto)
        .maybeSingle(),
    ]);
    setRows((itensRes.data as ItemRow[]) ?? []);
    setResumo((resumoRes.data as Resumo | null) ?? null);
    setLoading(false);
  }, [empresa, codigoProjeto]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="text-[11px] text-ww-textFaint italic px-3 py-2">Carregando itens RC…</div>;
  }
  // Renderiza se ha itens OU se ha budget definido (caso de projeto que ainda nao subiu lista)
  if (rows.length === 0 && !resumo?.valor_budget) return null;

  // Agrupa por equipamento
  const groups = new Map<string, ItemRow[]>();
  for (const r of rows) {
    if (!groups.has(r.equipamento)) groups.set(r.equipamento, []);
    groups.get(r.equipamento)!.push(r);
  }

  function toggleGroup(eq: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(eq)) next.delete(eq); else next.add(eq);
      return next;
    });
  }

  async function savePc(id: string, value: string) {
    const r = await fetch(`/api/rc-projetos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pc_numero: value.trim() || null }),
    });
    setEditingId(null);
    if (r.ok) await load();
    else {
      const j = await r.json().catch(() => ({}));
      alert(`Falha: ${j.error ?? "erro desconhecido"}`);
    }
  }

  async function delItem(id: string, label: string) {
    if (!confirm(`Excluir item "${label}"?`)) return;
    const r = await fetch(`/api/rc-projetos/${id}`, { method: "DELETE" });
    if (r.ok) await load();
    else alert("Falha ao excluir");
  }

  async function saveBudget() {
    const valor = Number(budgetInput.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) {
      alert("Valor inválido");
      return;
    }
    const r = await fetch("/api/rc-projetos/budget", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, valor_budget: valor }),
    });
    setEditingBudget(false);
    if (r.ok) await load();
    else {
      const j = await r.json().catch(() => ({}));
      alert(`Falha: ${j.error ?? "erro"}`);
    }
  }

  const budget = resumo?.valor_budget ?? null;
  const comprometido = resumo?.valor_comprometido ?? 0;
  const restante = resumo?.valor_restante ?? null;
  const overBudget = budget != null && comprometido > budget;

  return (
    <div className="border-t border-ww-border bg-violet-50/30 dark:bg-violet-950/20 px-4 py-3">
      {/* HEADER: titulo + budget editavel + comprometido + restante */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-[11px] uppercase tracking-[0.6px] font-bold text-violet-900 dark:text-violet-200">
          📦 Itens RC · {rows.length} itens em {groups.size} equipamento{groups.size !== 1 ? "s" : ""}
        </div>
        <div className="flex items-center gap-3 text-[11px] tabular-nums">
          {/* Budget */}
          <div className="flex items-center gap-1.5">
            <span className="text-violet-700 dark:text-violet-300 uppercase tracking-wider font-semibold text-[10px]">Budget:</span>
            {editingBudget ? (
              <span className="inline-flex items-center gap-1">
                <input autoFocus type="text"
                  defaultValue={budget != null ? budget.toString().replace(".", ",") : ""}
                  onChange={(e) => setBudgetInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveBudget(); if (e.key === "Escape") setEditingBudget(false); }}
                  className="w-28 px-1.5 py-0.5 border border-violet-300 rounded font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-violet-400"
                  placeholder="0,00" />
                <button onClick={saveBudget} className="text-[10px] text-emerald-700 font-bold hover:underline">✓ salvar</button>
                <button onClick={() => setEditingBudget(false)} className="text-[10px] text-rose-600 hover:underline">✕</button>
              </span>
            ) : (
              <button onClick={() => { setEditingBudget(true); setBudgetInput(budget != null ? budget.toString().replace(".", ",") : ""); }}
                className={`font-mono font-semibold hover:underline ${budget != null ? "text-violet-900 dark:text-violet-100" : "text-violet-500 italic"}`}>
                {budget != null ? fmtBRL(budget) : "definir"}
              </button>
            )}
          </div>
          {/* Comprometido */}
          {budget != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-amber-700 dark:text-amber-300 uppercase tracking-wider font-semibold text-[10px]">Comprometido:</span>
              <span className="font-mono text-amber-900 dark:text-amber-100">{fmtBRL(comprometido)}</span>
            </div>
          )}
          {/* Restante */}
          {budget != null && restante != null && (
            <div className="flex items-center gap-1.5">
              <span className={`uppercase tracking-wider font-semibold text-[10px] ${overBudget ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                {overBudget ? "Estourou:" : "Restante:"}
              </span>
              <span className={`font-mono font-semibold ${overBudget ? "text-rose-900 dark:text-rose-100" : "text-emerald-900 dark:text-emerald-100"}`}>
                {fmtBRL(restante)}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        {[...groups.entries()].map(([eq, items]) => {
          const expanded = openGroups.has(eq);
          const vinculados = items.filter((i) => i.pc_numero).length;
          const conferidos = items.filter((i) => (i.status_fornec ?? "").toLowerCase() === "conferido").length;
          return (
            <div key={eq} className="bg-white dark:bg-slate-900 rounded-md border border-violet-200 dark:border-violet-900">
              <button
                onClick={() => toggleGroup(eq)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition">
                <span className="flex items-center gap-2 text-[12px] font-semibold text-violet-900 dark:text-violet-100">
                  <span className="text-[10px] text-violet-600">{expanded ? "▼" : "▶"}</span>
                  {eq}
                </span>
                <span className="text-[10px] text-violet-700 dark:text-violet-300 font-mono tabular-nums flex gap-3">
                  <span>{items.length} itens</span>
                  <span title="Itens com PC vinculado">{vinculados}/{items.length} c/ PC</span>
                  {conferidos > 0 && <span className="text-emerald-700 dark:text-emerald-300" title="Itens conferidos">✓ {conferidos}</span>}
                </span>
              </button>
              {expanded && (
                <div className="border-t border-violet-100 dark:border-violet-900">
                  <table className="w-full text-[11px]">
                    <thead className="bg-violet-50/60 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-semibold">Item</th>
                        <th className="text-right px-2 py-1.5 font-semibold w-16">Qtd</th>
                        <th className="text-left px-2 py-1.5 font-semibold w-32">Modelo</th>
                        <th className="text-left px-2 py-1.5 font-semibold w-28">PC #</th>
                        <th className="text-left px-2 py-1.5 font-semibold w-36">Status Fornec</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => {
                        const isEditing = editingId === it.id;
                        const statusBadgeClass = !it.status_fornec
                          ? "text-ww-textFaint"
                          : it.status_fornec.toLowerCase() === "conferido"
                          ? "text-emerald-700 dark:text-emerald-400 font-semibold"
                          : "text-amber-700 dark:text-amber-400";
                        return (
                          <tr key={it.id} className="border-t border-violet-100/60 dark:border-violet-900/40 hover:bg-violet-50/40 dark:hover:bg-violet-950/20">
                            <td className="px-3 py-1.5">{it.item}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums font-mono">{it.qtd ?? "—"}</td>
                            <td className="px-2 py-1.5 text-ww-textMuted">{it.modelo ?? "—"}</td>
                            <td className="px-2 py-1.5">
                              {isEditing ? (
                                <input
                                  autoFocus
                                  type="text" defaultValue={it.pc_numero ?? ""}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  onBlur={() => savePc(it.id, editValue)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") savePc(it.id, (e.target as HTMLInputElement).value);
                                    if (e.key === "Escape") setEditingId(null);
                                  }}
                                  className="w-24 px-1.5 py-0.5 text-[11px] border border-violet-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-violet-400" />
                              ) : (
                                <button
                                  onClick={() => { setEditingId(it.id); setEditValue(it.pc_numero ?? ""); }}
                                  className="font-mono text-[11px] text-blue-700 hover:underline">
                                  {it.pc_numero || <span className="text-ww-textFaint italic">vincular…</span>}
                                </button>
                              )}
                            </td>
                            <td className={`px-2 py-1.5 ${statusBadgeClass}`}>
                              {it.status_fornec || <span className="italic text-ww-textFaint">—</span>}
                            </td>
                            <td className="px-1">
                              <button onClick={() => delItem(it.id, it.item)}
                                className="text-rose-500 hover:text-rose-700 text-[12px] opacity-40 hover:opacity-100"
                                title="Excluir item">×</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
