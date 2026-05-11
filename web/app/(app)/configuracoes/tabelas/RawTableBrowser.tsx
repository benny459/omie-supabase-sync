"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type Result = {
  rows: Record<string, unknown>[];
  columns: string[];
  count: number | null;
  error?: string;
} | null;

export default function RawTableBrowser({
  groups,
  selectedSchema,
  selectedTable,
  page,
  limit,
  orderBy,
  orderDir,
  result,
}: {
  groups: { schema: string; tables: string[] }[];
  selectedSchema: string;
  selectedTable: string;
  page: number;
  limit: number;
  orderBy: string;
  orderDir: "asc" | "desc";
  result: Result;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  function buildHref(overrides: Record<string, string | number | null>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === undefined || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    return `?${next.toString()}`;
  }

  function setOrder(col: string) {
    const isCurrent = orderBy === col;
    const nextDir = isCurrent && orderDir === "desc" ? "asc" : "desc";
    router.push(buildHref({ order: col, dir: nextDir, page: 0 }));
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Sidebar — lista de tabelas agrupadas por schema */}
      <aside className="col-span-12 md:col-span-3 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden self-start">
        <header className="px-4 py-2.5 border-b border-slate-200 bg-slate-50/60">
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Tabelas</h2>
        </header>
        <div className="p-2 max-h-[680px] overflow-y-auto">
          {groups.map((g) => (
            <div key={g.schema} className="mb-3">
              <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 px-2 py-1">
                {g.schema}
              </div>
              <ul className="space-y-0.5">
                {g.tables.map((t) => {
                  const active = g.schema === selectedSchema && t === selectedTable;
                  return (
                    <li key={t}>
                      <Link
                        href={`/configuracoes/tabelas?schema=${g.schema}&table=${t}`}
                        className={`block px-2 py-1.5 text-xs rounded-md transition ${
                          active
                            ? "bg-sky-50 text-sky-900 font-semibold ring-1 ring-sky-200"
                            : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        {t}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </aside>

      {/* Main — tabela */}
      <main className="col-span-12 md:col-span-9 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {!selectedTable && (
          <div className="p-8 text-center text-sm text-slate-400">
            ← Selecione uma tabela à esquerda
          </div>
        )}

        {selectedTable && result?.error && (
          <div className="m-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
            <strong>Erro:</strong> {result.error}
          </div>
        )}

        {selectedTable && result && !result.error && (
          <>
            <header className="px-5 py-3 border-b border-slate-200 bg-slate-50/60 flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  {selectedSchema}.{selectedTable}
                </h2>
                <p className="text-xs text-slate-500">
                  {result.count != null
                    ? `${result.count.toLocaleString("pt-BR")} registros · página ${page + 1}`
                    : `página ${page + 1}`}
                  {orderBy && (
                    <span className="ml-2 text-sky-700">
                      ordenado por <strong>{orderBy}</strong> ({orderDir})
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={buildHref({ page: page - 1 })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border ${
                    page <= 0
                      ? "bg-slate-50 text-slate-300 border-slate-200 pointer-events-none"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  ← Anterior
                </Link>
                <Link
                  href={buildHref({ page: page + 1 })}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border ${
                    result.rows.length < limit
                      ? "bg-slate-50 text-slate-300 border-slate-200 pointer-events-none"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  Próxima →
                </Link>
              </div>
            </header>

            <div className="overflow-x-auto max-h-[640px]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0 z-10">
                  <tr>
                    {result.columns.map((c) => (
                      <th
                        key={c}
                        onClick={() => setOrder(c)}
                        className="px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold text-slate-600 whitespace-nowrap cursor-pointer hover:bg-slate-100 transition"
                        title="Clique pra ordenar"
                      >
                        <span className="inline-flex items-center gap-1">
                          {c}
                          {orderBy === c && (
                            <span className="text-sky-600">{orderDir === "asc" ? "▲" : "▼"}</span>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.rows.length === 0 && (
                    <tr>
                      <td colSpan={result.columns.length || 1} className="px-3 py-8 text-center text-slate-400">
                        Nenhum registro nesta página.
                      </td>
                    </tr>
                  )}
                  {result.rows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50/60 transition">
                      {result.columns.map((c) => (
                        <td key={c} className="px-3 py-1.5 text-slate-700 whitespace-nowrap max-w-[260px] truncate" title={fmt(row[c])}>
                          {fmt(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="px-5 py-2 border-t border-slate-200 bg-slate-50/40 flex items-center justify-between text-xs text-slate-500">
              <span>
                Mostrando {result.rows.length} de {result.count?.toLocaleString("pt-BR") ?? "?"} registros
              </span>
              <span className="font-mono">{result.columns.length} colunas</span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  if (typeof v === "string" && v.length > 100) return v.slice(0, 100) + "…";
  return String(v);
}
