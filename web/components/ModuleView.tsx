"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatCell, type Group, STATUS_BADGE } from "@/lib/columns";
import { loadPrefsFromDb, readLocalPrefs, savePrefs } from "@/lib/ui-prefs";
import DetailDrawer from "./DetailDrawer";

type AnyRow = Record<string, unknown>;

export default function ModuleView({
  modulo,
  title,
  groups,
  rows,
  totalCount,
}: {
  modulo: string;
  title: string;
  groups: Group[];
  rows: AnyRow[];
  totalCount: number | null;
}) {
  const moduleKey = modulo as "avulsos" | "projetos" | "pcs";
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    groups.forEach((g) => (init[g.key] = g.defaultOpen));
    // Sobrepõe com o que já temos em localStorage (se qualquer)
    if (typeof window !== "undefined") {
      const saved = readLocalPrefs().columnGroups?.[moduleKey];
      if (saved) Object.entries(saved).forEach(([k, v]) => { if (k in init) init[k] = v; });
    }
    return init;
  });

  // Ao montar, busca do banco (override do local) e aplica
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    loadPrefsFromDb().then((prefs) => {
      const saved = prefs.columnGroups?.[moduleKey];
      if (!saved) return;
      setOpenGroups((prev) => {
        const next = { ...prev };
        Object.entries(saved).forEach(([k, v]) => { if (k in next) next[k] = v; });
        return next;
      });
    }).catch(() => {});
  }, [moduleKey]);

  // Salva quando openGroups muda (debounced simples)
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      savePrefs({ columnGroups: { [moduleKey]: openGroups } }).catch(() => {});
    }, 400);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [openGroups, moduleKey]);

  const visibleColumns = useMemo(() => {
    return groups.flatMap((g) =>
      openGroups[g.key]
        ? g.columns.map((c) => ({ col: c, group: g }))
        : [],
    );
  }, [groups, openGroups]);

  const statusCounts = useMemo(() => {
    return rows.reduce<Record<string, number>>((acc, r) => {
      const s = (r as { status?: string }).status ?? "PENDENTE";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
  }, [rows]);

  const [selected, setSelected] = useState<{
    empresa: string; ncod_ped: number; pc_numero?: string | null; modulo?: string | null;
  } | null>(null);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 capitalize">
            {title}
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Mostrando {rows.length}
            {totalCount != null ? ` de ${totalCount}` : ""} registros
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(statusCounts).map(([s, n]) => (
            <span
              key={s}
              className={`px-2.5 py-1 rounded-full text-xs font-medium ring-1 ${
                STATUS_BADGE[s] ?? STATUS_BADGE.PENDENTE
              }`}
            >
              {s}: {n}
            </span>
          ))}
        </div>
      </div>

      {/* Group toggles */}
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.key}
            onClick={() =>
              setOpenGroups((prev) => ({ ...prev, [g.key]: !prev[g.key] }))
            }
            className={`px-3 py-1 rounded-full text-xs font-medium border transition ${
              openGroups[g.key]
                ? `${g.tint} ${g.border} text-slate-800`
                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            {openGroups[g.key] ? "▼" : "▶"} {g.label}
            <span className="ml-1.5 text-[10px] opacity-60">{g.columns.length}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="text-xs">
          <thead className="sticky top-0">
            {/* Linha 1: grupos */}
            <tr>
              {groups.map((g) =>
                openGroups[g.key] ? (
                  <th
                    key={g.key}
                    colSpan={g.columns.length}
                    className={`${g.tint} ${g.border} border-t border-b border-l text-xs font-semibold text-slate-700 px-3 py-1.5 text-left`}
                  >
                    {g.label}
                  </th>
                ) : null,
              )}
            </tr>
            {/* Linha 2: colunas */}
            <tr className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
              {visibleColumns.map(({ col, group }) => (
                <th
                  key={`${group.key}.${col.key}`}
                  className={`px-3 py-2 whitespace-nowrap border-b border-slate-200 ${
                    col.align === "right"
                      ? "text-right"
                      : col.align === "center"
                        ? "text-center"
                        : "text-left"
                  }`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr
                key={`${(r as { empresa?: string }).empresa}-${(r as { ncod_ped?: number }).ncod_ped}-${i}`}
                className="hover:bg-slate-50/60 cursor-pointer"
                onClick={() =>
                  setSelected({
                    empresa: (r as { empresa: string }).empresa,
                    ncod_ped: (r as { ncod_ped: number }).ncod_ped,
                    pc_numero: (r as { pc_numero?: string | null }).pc_numero,
                    modulo: (r as { modulo?: string | null }).modulo ?? modulo,
                  })
                }
              >
                {visibleColumns.map(({ col, group }) => {
                  const val = (r as AnyRow)[col.key];
                  const formatted = formatCell(val, col.format);

                  if (col.format === "status" && typeof val === "string") {
                    return (
                      <td
                        key={`${group.key}.${col.key}`}
                        className={`px-3 py-2 ${group.tint}`}
                      >
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium ring-1 whitespace-nowrap ${
                            STATUS_BADGE[val] ?? STATUS_BADGE.PENDENTE
                          }`}
                        >
                          {val}
                        </span>
                      </td>
                    );
                  }

                  return (
                    <td
                      key={`${group.key}.${col.key}`}
                      className={`px-3 py-2 whitespace-nowrap ${group.tint} ${
                        col.align === "right"
                          ? "text-right tabular-nums"
                          : col.align === "center"
                            ? "text-center"
                            : "text-left"
                      } ${col.format === "mono" ? " text-slate-900" : "text-slate-700"}`}
                    >
                      {formatted}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DetailDrawer selected={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
