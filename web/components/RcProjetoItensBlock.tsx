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
  const [loading, setLoading] = useState(true);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    const supa = supaBrowser();
    const { data } = await supa
      .schema("approval" as never)
      .from("v_rc_projetos_itens")
      .select("*")
      .eq("empresa", empresa)
      .eq("codigo_projeto", codigoProjeto)
      .order("equipamento", { ascending: true })
      .order("item", { ascending: true });
    setRows((data as ItemRow[]) ?? []);
    setLoading(false);
  }, [empresa, codigoProjeto]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="text-[11px] text-ww-textFaint italic px-3 py-2">Carregando itens RC…</div>;
  }
  if (rows.length === 0) return null;  // só renderiza se há lista pra esse projeto

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

  return (
    <div className="border-t border-ww-border bg-violet-50/30 dark:bg-violet-950/20 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.6px] font-bold text-violet-900 dark:text-violet-200 mb-2">
        📦 Itens RC · {rows.length} itens em {groups.size} equipamento{groups.size !== 1 ? "s" : ""}
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
