"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatCell,
  type Group,
  STATUS_META,
  isApproved,
} from "@/lib/columns";
import { loadPrefsFromDb, readLocalPrefs, savePrefs } from "@/lib/ui-prefs";
import DetailDrawer from "./DetailDrawer";
import EditableCell from "./EditableCell";
import EditableStatusCell from "./EditableStatusCell";
import AddRowButton from "./AddRowButton";
import PasteRcButton from "./PasteRcButton";
import RcExcelDropZone from "./RcExcelDropZone";
import FiltersBar, { applyFilters, type StatusFilter, type FacetState } from "./FiltersBar";
import PermissionsBadge from "./PermissionsBadge";
import { useUserPerms } from "./UserPermsProvider";
import { canEdit, canApprove, type BlockKey } from "@/lib/permissions";

type AnyRow = Record<string, unknown>;

type PvBucket = {
  key: string;           // pv_os_label or "__no_pv__"
  label: string;
  empresa: string;
  rows: AnyRow[];
  aprovados: number;
  pendentes: number;
  rejeitados: number;
  somaValor: number;
  somaAprovado: number;
};

export default function GroupedModuleView({
  modulo,
  title,
  groups,
  rows,
  totalCount,
  groupByPv,
  groupBy = "pv_os",
}: {
  modulo: "avulsos" | "projetos" | "pcs";
  title: string;
  groups: Group[];
  rows: AnyRow[];
  totalCount: number | null;
  groupByPv: boolean;
  /** "pv_os" agrupa por PV/OS (default). "project" agrupa por projeto_nome. */
  groupBy?: "pv_os" | "project";
}) {
  // ── Filtros ───────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [facets, setFacets] = useState<FacetState>({});

  const user = useUserPerms();
  const userCanApprove = canApprove(user, modulo);
  const userIsAdmin = user?.is_admin === true || user?.role === "admin";
  const userCanEdit = canEdit(user, modulo, "pvos") || canEdit(user, modulo, "rc") || canEdit(user, modulo, "pc");
  const userCanSelect = userCanApprove || userCanEdit;

  // ── Seleção para aprovação em lote ─────────────────────────────────────
  const [selectedBatch, setSelectedBatch] = useState<Set<string>>(new Set());
  function toggleSelect(key: string) {
    setSelectedBatch(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
  function clearSelection() { setSelectedBatch(new Set()); }
  const [batchBusy, setBatchBusy] = useState(false);
  async function batchApprove(status: "APROVADO" | "APROVADO_FAT_DIRETO" | "NAO_APROVADO" | "CANCELAR_PEDIDO") {
    if (selectedBatch.size === 0) return;
    setBatchBusy(true);
    // key = `${empresa}|${ncod_ped}|${valor_total ?? ''}`
    const rowsBatch = [...selectedBatch].map(k => {
      const [empresa, ncodStr, valorStr] = k.split("|");
      return {
        empresa,
        ncod_ped: Number(ncodStr),
        modulo,
        valorPc: valorStr ? Number(valorStr) : null,
      };
    });
    const res = await fetch("/api/approvals/batch-approve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rowsBatch, status }),
    });
    setBatchBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert(`Erro: ${j.error ?? res.statusText}`); return; }
    if (j.failed && j.failed.length > 0) {
      alert(`${j.count} alterados, ${j.failed.length} falharam.\n${j.failed.map((f: { error?: string }) => f.error).join("\n")}`);
    }
    clearSelection();
    // router.refresh
    if (typeof window !== "undefined") window.location.reload();
  }

  async function batchDelete() {
    if (selectedBatch.size === 0) return;
    const rowsBatch = [...selectedBatch].map(k => {
      const [empresa, ncodStr] = k.split("|");
      return { empresa, ncod_ped: Number(ncodStr) };
    });
    const principais = rowsBatch.filter(r => r.ncod_ped > 0).length;
    const secundarias = rowsBatch.length - principais;
    if (principais > 0 && !userIsAdmin) {
      alert(`Somente admin pode apagar linhas principais (Omie). ${principais} da sua seleção é/são principal(is). Desmarque-as e tente novamente.`);
      return;
    }
    const label = principais > 0
      ? `Apagar ${rowsBatch.length} linha(s)? (${principais} principal(is) + ${secundarias} secundária(s))`
      : `Apagar ${rowsBatch.length} linha(s) secundária(s)?`;
    if (!confirm(label)) return;
    setBatchBusy(true);
    const res = await fetch("/api/approvals/batch-delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: rowsBatch }),
    });
    setBatchBusy(false);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert(`Erro: ${j.error ?? res.statusText}`); return; }
    if (j.failed && j.failed.length > 0) {
      alert(`${j.count} apagadas, ${j.failed.length} falharam.\n${j.failed.map((f: { error?: string }) => f.error).join("\n")}`);
    }
    clearSelection();
    if (typeof window !== "undefined") window.location.reload();
  }

  // ── Grupos colapsáveis (persiste em ui_prefs) ────────────────────────
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    groups.forEach((g) => (init[g.key] = g.defaultOpen));
    if (typeof window !== "undefined") {
      const saved = readLocalPrefs().columnGroups?.[modulo];
      if (saved) Object.entries(saved).forEach(([k, v]) => { if (k in init) init[k] = v; });
    }
    return init;
  });

  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    loadPrefsFromDb().then((prefs) => {
      const saved = prefs.columnGroups?.[modulo];
      if (!saved) return;
      setOpenGroups((prev) => {
        const next = { ...prev };
        Object.entries(saved).forEach(([k, v]) => { if (k in next) next[k] = v; });
        return next;
      });
    }).catch(() => {});
  }, [modulo]);

  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      savePrefs({ columnGroups: { [modulo]: openGroups } }).catch(() => {});
    }, 400);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [openGroups, modulo]);

  // ── Drawer ───────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<{
    empresa: string; ncod_ped: number; pc_numero?: string | null; modulo?: string | null;
  } | null>(null);

  // ── Filtragem + agrupamento ──────────────────────────────────────────
  const filtered = useMemo(
    () => applyFilters(rows, { query, statusFilter, facets }),
    [rows, query, statusFilter, facets],
  );

  const buckets: PvBucket[] = useMemo(() => {
    if (!groupByPv) {
      return [{
        key: "__all__", label: "Todos", empresa: "",
        rows: filtered,
        aprovados: filtered.filter(r => isApproved(String(r.status))).length,
        pendentes: filtered.filter(r => String(r.status) === "PENDENTE").length,
        rejeitados: filtered.filter(r => {
          const s = String(r.status);
          return ["NAO_APROVADO","REJEITADO_VALIDADE","CANCELAR_PEDIDO"].includes(s);
        }).length,
        somaValor: filtered.reduce((acc, r) => acc + Number(r.valor_total ?? 0), 0),
        somaAprovado: filtered.reduce((acc, r) => acc + Number(r.valor_aprovado ?? 0), 0),
      }];
    }
    const map = new Map<string, PvBucket>();
    for (const r of filtered) {
      const empresa = String(r.empresa ?? "");
      let lbl: string;
      let keyLbl: string;
      if (groupBy === "project") {
        const proj = (r.projeto_nome as string | null | undefined) || "";
        lbl = proj || "__no_project__";
        keyLbl = lbl === "__no_project__" ? "(Sem Projeto)" : proj;
      } else {
        lbl = (r.pv_os_label as string) || "__no_pv__";
        keyLbl = lbl === "__no_pv__" ? "(Sem PV/OS)" : lbl;
      }
      const key = `${empresa}::${lbl}`;
      let b = map.get(key);
      if (!b) {
        b = {
          key, label: keyLbl, empresa,
          rows: [], aprovados: 0, pendentes: 0, rejeitados: 0,
          somaValor: 0, somaAprovado: 0,
        };
        map.set(key, b);
      }
      b.rows.push(r);
      const s = String(r.status ?? "");
      if (isApproved(s)) b.aprovados++;
      else if (s === "PENDENTE") b.pendentes++;
      else if (["NAO_APROVADO","REJEITADO_VALIDADE","CANCELAR_PEDIDO"].includes(s)) b.rejeitados++;
      b.somaValor    += Number(r.valor_total ?? 0);
      b.somaAprovado += Number(r.valor_aprovado ?? 0);
    }
    // ordena: com mais PCs primeiro, depois alpha
    return [...map.values()].sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
  }, [filtered, groupByPv, groupBy]);

  const visibleColumns = useMemo(() => {
    return groups.flatMap((g) =>
      openGroups[g.key] ? g.columns.map((c) => ({ col: c, group: g })) : [],
    );
  }, [groups, openGroups]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight">{title}</h1>
          <p className="text-slate-500 text-sm mt-1">
            {filtered.length.toLocaleString("pt-BR")} de {(totalCount ?? rows.length).toLocaleString("pt-BR")} registros
            {groupByPv && ` em ${buckets.length} ${groupBy === "project" ? "projeto(s)" : "PV/OS"}`}
          </p>
        </div>
      </div>

      {/* Permissões do usuário neste módulo */}
      <PermissionsBadge modulo={modulo} />

      {/* Filters — summary cards + facets */}
      <FiltersBar
        rows={rows}
        query={query} setQuery={setQuery}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        facets={facets} setFacets={setFacets}
      />

      {/* Group toggles */}
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <button
            key={g.key}
            onClick={() => setOpenGroups((prev) => ({ ...prev, [g.key]: !prev[g.key] }))}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition ${
              openGroups[g.key]
                ? `${g.tint} ${g.border} text-slate-800`
                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            {openGroups[g.key] ? "▼" : "▶"} {g.label}
            <span className="ml-1 text-[9px] opacity-60">{g.columns.length}</span>
          </button>
        ))}
      </div>

      {/* Toolbar flutuante de aprovação/ações em lote */}
      {userCanSelect && selectedBatch.size > 0 && (
        <div className="sticky top-2 z-30 bg-slate-900 text-white rounded-xl shadow-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <span className="text-sm font-semibold">{selectedBatch.size} selecionado(s)</span>
          <div className="flex gap-2 flex-1 flex-wrap">
            {userCanApprove && (
              <>
                <button disabled={batchBusy} onClick={() => batchApprove("APROVADO")}
                  className="px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50">
                  ✓ Aprovar
                </button>
                <button disabled={batchBusy} onClick={() => batchApprove("APROVADO_FAT_DIRETO")}
                  className="px-3 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-700 rounded-md disabled:opacity-50">
                  ✓ Aprovar Fat. Direto
                </button>
                <button disabled={batchBusy} onClick={() => batchApprove("NAO_APROVADO")}
                  className="px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 rounded-md disabled:opacity-50">
                  ✗ Não aprovar
                </button>
              </>
            )}
            {userIsAdmin && (
              <button disabled={batchBusy} onClick={() => {
                if (!confirm(`Cancelar ${selectedBatch.size} pedido(s)? Eles somem dos cards positivos (Pendentes/Atrasados).`)) return;
                batchApprove("CANCELAR_PEDIDO");
              }}
                className="px-3 py-1.5 text-xs font-semibold bg-zinc-700 hover:bg-zinc-800 rounded-md disabled:opacity-50">
                🚫 Cancelar (admin)
              </button>
            )}
            {userCanEdit && (
              <button disabled={batchBusy} onClick={batchDelete}
                className="px-3 py-1.5 text-xs font-semibold bg-rose-800 hover:bg-rose-900 rounded-md disabled:opacity-50"
                title={userIsAdmin ? "Apagar linhas selecionadas" : "Apagar linhas secundárias (admin para principais)"}>
                🗑 Apagar {userIsAdmin ? "" : "secundárias"}
              </button>
            )}
          </div>
          <button onClick={clearSelection} className="text-xs text-slate-300 hover:text-white underline-offset-2 hover:underline">
            Limpar seleção
          </button>
        </div>
      )}

      {/* Corpo: tabela única com header sticky + PV/OS como seções do tbody */}
      <SingleTableView
        buckets={buckets}
        groups={groups}
        openGroups={openGroups}
        visibleColumns={visibleColumns}
        groupByPv={groupByPv}
        defaultModulo={modulo}
        groupBy={groupBy}
        selection={userCanSelect ? { selected: selectedBatch, toggle: toggleSelect } : null}
        onRowClick={(r) =>
          setSelected({
            empresa: String(r.empresa),
            ncod_ped: Number(r.ncod_ped),
            pc_numero: (r.pc_numero as string | null) ?? null,
            modulo: (r.modulo as string | null) ?? modulo,
          })
        }
      />

      <DetailDrawer selected={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

type SelectionApi = { selected: Set<string>; toggle: (key: string) => void } | null;

// ── Tabela única com cabeçalho sticky e seções por PV/OS ────────────────
function SingleTableView({
  buckets, groups, openGroups, visibleColumns, groupByPv, defaultModulo, onRowClick, groupBy, selection,
}: {
  buckets: PvBucket[];
  groups: Group[];
  openGroups: Record<string, boolean>;
  visibleColumns: { col: import("@/lib/columns").Column; group: Group }[];
  groupByPv: boolean;
  defaultModulo: string;
  onRowClick: (r: AnyRow) => void;
  groupBy: "pv_os" | "project";
  selection: SelectionApi;
}) {
  // Estado aberto/fechado por bucket — default COLAPSADO (user expande o que interessa)
  const [bucketOpen, setBucketOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    buckets.forEach((b) => { init[b.key] = !groupByPv; });
    return init;
  });

  useEffect(() => {
    setBucketOpen((prev) => {
      const next: Record<string, boolean> = { ...prev };
      buckets.forEach((b) => {
        if (!(b.key in next)) next[b.key] = !groupByPv;
      });
      return next;
    });
  }, [buckets, groupByPv]);

  // Botões pra expandir/colapsar TUDO
  function allOpen() {
    const next: Record<string, boolean> = {};
    buckets.forEach((b) => next[b.key] = true);
    setBucketOpen(next);
  }
  function allClosed() {
    const next: Record<string, boolean> = {};
    buckets.forEach((b) => next[b.key] = false);
    setBucketOpen(next);
  }

  if (buckets.length === 0) {
    return (
      <div className="text-sm text-slate-400 italic p-6 bg-white border border-slate-200 rounded-lg text-center">
        Nenhum registro corresponde ao filtro.
      </div>
    );
  }

  const totalCols = visibleColumns.length;
  const hasGroupBanner = groups.some((g) => openGroups[g.key]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 text-xs">
        <span className="text-slate-500 mr-1">Visualização global:</span>
        <button onClick={allOpen}
          title="Expandir todos os PV/OS"
          className="w-7 h-7 rounded border border-slate-300 hover:bg-slate-50 font-bold text-base text-slate-700">+</button>
        <button onClick={allClosed}
          title="Colapsar todos os PV/OS"
          className="w-7 h-7 rounded border border-slate-300 hover:bg-slate-50 font-bold text-base text-slate-700">−</button>
      </div>

    <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-auto max-h-[calc(100vh-260px)]">
      <table className="text-xs w-full border-separate border-spacing-0">
        <thead className="sticky top-0 z-20 bg-white">
          {hasGroupBanner && (
            <tr>
              {groups.map((g) =>
                openGroups[g.key] ? (
                  <th
                    key={g.key}
                    colSpan={g.columns.length}
                    className={`${g.tint} ${g.border} border-b border-l text-xs font-semibold text-slate-700 px-3 py-1.5 text-left whitespace-nowrap`}
                  >
                    {g.label}
                  </th>
                ) : null,
              )}
            </tr>
          )}
          <tr className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
            {visibleColumns.map(({ col, group }, idx) => {
              const stickyFirst = idx === 0
                ? "sticky left-0 z-10 bg-slate-50 shadow-[2px_0_0_#e2e8f0]"
                : "";
              return (
                <th
                  key={`${group.key}.${col.key}`}
                  className={`px-3 py-2 whitespace-nowrap border-b border-slate-200 ${stickyFirst} ${
                    col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                  }`}
                >
                  {col.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {buckets.map((b, idx) => (
            <BucketSection
              key={b.key}
              bucket={b}
              bucketIndex={idx}
              totalCols={totalCols}
              visibleColumns={visibleColumns}
              isOpen={bucketOpen[b.key] ?? true}
              onToggle={() => setBucketOpen((prev) => ({ ...prev, [b.key]: !prev[b.key] }))}
              groupByPv={groupByPv}
              defaultModulo={defaultModulo}
              onRowClick={onRowClick}
              groupBy={groupBy}
              selection={selection}
            />
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}

function BucketSection({
  bucket, bucketIndex, totalCols, visibleColumns, isOpen, onToggle, groupByPv, defaultModulo, onRowClick, groupBy, selection,
}: {
  bucket: PvBucket;
  bucketIndex: number;
  totalCols: number;
  visibleColumns: { col: import("@/lib/columns").Column; group: Group }[];
  isOpen: boolean;
  onToggle: () => void;
  groupByPv: boolean;
  defaultModulo: string;
  onRowClick: (r: AnyRow) => void;
  groupBy: "pv_os" | "project";
  selection: SelectionApi;
}) {
  const user = useUserPerms();
  const modulo = defaultModulo as "avulsos" | "projetos" | "pcs";
  const canAddRc = canEdit(user, modulo, "rc");
  // Se não é grouped (ex: /pcs), renderiza cada row direto
  if (!groupByPv) {
    return (
      <>
        {bucket.rows.map((r, i) => (
          <DataRow key={`${r.empresa}-${r.ncod_ped}-${i}`}
                   row={r}
                   visibleColumns={visibleColumns}
                   defaultModulo={defaultModulo}
                   onClick={() => onRowClick(r)}
                   selection={selection}
                   showToggle={false} />
        ))}
      </>
    );
  }

  // Gap row de respiro entre buckets (não exibido no primeiro).
  // Cria separação visual sem depender de borda grossa.
  const gapRow = bucketIndex > 0 ? (
    <tr key={`gap-${bucket.key}`} aria-hidden="true">
      <td colSpan={totalCols} className="h-3 bg-slate-100/80 p-0 border-0" />
    </tr>
  ) : null;

  // Header do bucket — destaca o nome do Projeto quando agrupando por projeto.
  // (Pra PV/OS mantemos o visual atual, com a info na 1ª row via bucketInfo.)
  const projectHeader = groupBy === "project" ? (
    <tr key={`head-${bucket.key}`} className="bg-violet-50 border-y border-violet-200">
      <td colSpan={totalCols} className="px-4 py-2 sticky left-0">
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600">Projeto</span>
          <span className="text-base font-semibold text-violet-900">{bucket.label}</span>
          <span className="text-[11px] text-violet-700">
            · {bucket.rows.length} PC{bucket.rows.length !== 1 ? "s" : ""}
          </span>
          {bucket.aprovados > 0  && <span className="text-[11px] text-emerald-700 font-medium">✓ {bucket.aprovados}</span>}
          {bucket.pendentes > 0  && <span className="text-[11px] text-amber-700">⏳ {bucket.pendentes}</span>}
          {bucket.rejeitados > 0 && <span className="text-[11px] text-rose-700">✗ {bucket.rejeitados}</span>}
          <span className="ml-auto text-[11px] text-violet-700 tabular-nums">
            {bucket.somaValor > 0 ? bucket.somaValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : ""}
          </span>
        </div>
      </td>
    </tr>
  ) : null;

  // Grouped: se COLAPSADO renderiza 1 linha de resumo; se EXPANDIDO N detail rows
  if (!isOpen) {
    const summary = buildSummaryRow(bucket, visibleColumns);
    return (
      <>
        {gapRow}
        {projectHeader}
        <DataRow key={`summary-${bucket.key}`}
                 row={summary}
                 visibleColumns={visibleColumns}
                 defaultModulo={defaultModulo}
                 onClick={onToggle}
                 showToggle="closed"
                 onToggleBucket={onToggle}
                 selection={selection}
                 bucketInfo={{ qtd: bucket.rows.length, aprovados: bucket.aprovados, pendentes: bucket.pendentes, rejeitados: bucket.rejeitados }} />
      </>
    );
  }

  // Expandido
  return (
    <>
      {gapRow}
      {projectHeader}
      {bucket.rows.map((r, i) => (
        <DataRow key={`${r.empresa}-${r.ncod_ped}-${i}`}
                 row={r}
                 visibleColumns={visibleColumns}
                 defaultModulo={defaultModulo}
                 onClick={() => onRowClick(r)}
                 showToggle={i === 0 ? "open" : false}
                 onToggleBucket={onToggle}
                 selection={selection}
                 bucketInfo={i === 0 ? { qtd: bucket.rows.length, aprovados: bucket.aprovados, pendentes: bucket.pendentes, rejeitados: bucket.rejeitados } : undefined}
                 mergedInfo={{ isFirstInBucket: i === 0, bucketSize: bucket.rows.length }} />
      ))}
      {canAddRc && (
      <tr>
        <td colSpan={totalCols} className="p-0">
          <div className="flex items-center gap-2 pl-4 py-1.5 border-b border-slate-200 bg-slate-50/50">
            <AddRowButton
              empresa={bucket.empresa}
              pv_os_label={
                bucket.label.startsWith("PV") || bucket.label.startsWith("OS")
                  ? bucket.label
                  : null
              }
              modulo={String(bucket.rows[0]?.modulo ?? defaultModulo)}
              pvOsOptions={[...new Set(bucket.rows.map(r => String(r.pv_os_label ?? "")).filter(Boolean))]}
              existingNcodPeds={bucket.rows.map(r => Number(r.ncod_ped)).filter(Number.isFinite)}
            />
            <PasteRcButton
              empresa={bucket.empresa}
              pv_os_label={bucket.label === "(Sem PV/OS)" ? null : bucket.label}
              modulo={String(bucket.rows[0]?.modulo ?? defaultModulo)}
              existingNcodPeds={bucket.rows.map(r => Number(r.ncod_ped)).filter(Number.isFinite)}
            />
            <RcExcelDropZone
              empresa={bucket.empresa}
              pv_os_label={
                bucket.label.startsWith("PV") || bucket.label.startsWith("OS")
                  ? bucket.label
                  : (bucket.rows[0]?.pv_os_label as string | null) ?? null
              }
              modulo={String(bucket.rows[0]?.modulo ?? defaultModulo)}
            />
          </div>
        </td>
      </tr>
      )}
    </>
  );
}

// Colunas que renderizam com rowspan (1 célula pro bucket inteiro) no modo expandido
const MERGED_COLS = new Set<string>([
  "rc_custo_total_calc",
  "dif_pct_pc_rc",
  "rc_pc_vs_rc",
  "nova_prev_materiais",
  "nova_prev_servicos",
  "pc_custo_total_calc",
]);

// Constrói a "linha de resumo" de um bucket (versão collapsed)
// Regra: se todos rows têm o mesmo valor → mostra o valor; se diferem →
// (money/number → soma; outros → primeiro não-null; ou "—")
function buildSummaryRow(bucket: PvBucket, visibleColumns: { col: import("@/lib/columns").Column; group: Group }[]): AnyRow {
  if (!bucket.rows.length) return {};
  const summary: AnyRow = { ...bucket.rows[0] };  // PV/OS fields + metadata

  for (const { col } of visibleColumns) {
    const vals = bucket.rows.map(r => r[col.key]);
    const nonNull = vals.filter(v => v != null && v !== "");
    const uniqueCount = new Set(nonNull.map(v => String(v))).size;

    if (uniqueCount <= 1) {
      summary[col.key] = nonNull[0] ?? null;  // todos iguais → mostra único
      continue;
    }
    // Múltiplos valores:
    if (col.format === "money" || col.format === "number") {
      const sum = nonNull.reduce((acc: number, v) => acc + (Number(v) || 0), 0);
      summary[col.key] = sum;
    } else if (col.format === "status") {
      summary[col.key] = `${uniqueCount} status`;
    } else {
      // text/date/etc: mostra "(N valores)" compacto
      summary[col.key] = `(${uniqueCount})`;
    }
  }
  return summary;
}

// Mapeia a group.key das colunas (que é livre) para nosso BlockKey canônico de permissões.
function blockKeyFor(groupKey: string): BlockKey {
  switch (groupKey) {
    case "pvos":      return "pvos";
    case "rc":        return "rc";
    case "pc":        return "pc";
    case "pcs_extra": return "pc";       // Prioridade mora junto de PC
    case "aprovacao": return "aprovacao";
    case "log":       return "log";
    case "extras":    return "extras";
    default:          return "extras";
  }
}

function DataRow({ row, visibleColumns, defaultModulo: _dm, onClick, showToggle = false, onToggleBucket, bucketInfo, mergedInfo, selection }: {
  row: AnyRow;
  visibleColumns: { col: import("@/lib/columns").Column; group: Group }[];
  defaultModulo: string;
  onClick: () => void;
  showToggle?: "open" | "closed" | false;
  onToggleBucket?: () => void;
  bucketInfo?: { qtd: number; aprovados: number; pendentes: number; rejeitados: number };
  mergedInfo?: { isFirstInBucket: boolean; bucketSize: number };
  selection?: SelectionApi;
}) {
  const isSummary = showToggle === "closed";
  const user = useUserPerms();
  const modulo = String(row.modulo ?? _dm) as "avulsos" | "projetos" | "pcs";
  // Chave única pra seleção em batch — inclui valor_total pro snapshot ao aprovar
  const selKey = `${row.empresa}|${row.ncod_ped}|${row.valor_total ?? ""}`;
  const isSelectable = !!selection && !isSummary;
  const isSelected = !!selection?.selected.has(selKey);
  return (
    <tr className={`hover:bg-slate-50 cursor-pointer group transition-colors ${
        // Primeira linha de cada PV/OS (summary ou 1a expandida): fundo sutil + borda fina slate-300 no topo.
        // A separação "caixa" é feita pela gap row neutra acima dela (em BucketSection).
        showToggle
          ? "bg-slate-50 border-t border-slate-300"
          : ""
      }`}
        onClick={onClick}>
      {visibleColumns.map(({ col, group }, idx) => {
        const val = row[col.key];
        const isFirst = idx === 0;
        // bg branco pra sobrepor ao hover com sticky (só na 1a coluna)
        const stickyCls = isFirst
          ? `sticky left-0 z-[5] ${showToggle ? "bg-slate-50" : "bg-white"} group-hover:bg-slate-50 shadow-[2px_0_0_theme(colors.slate.200)]`
          : "";

        // 1ª coluna ganha o toggle ± + contador de PCs (só em linhas summary/primeira expandida)
        const toggleArrow = isFirst && showToggle ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleBucket?.(); }}
            className="mr-1.5 inline-flex items-center justify-center w-5 h-5 rounded border border-slate-300 bg-white hover:bg-slate-100 text-sm font-bold text-slate-700 align-middle"
            title={showToggle === "open" ? "Colapsar este PV/OS" : "Expandir este PV/OS"}
          >{showToggle === "open" ? "−" : "+"}</button>
        ) : null;
        // Checkbox de seleção (batch approve) na 1ª coluna — só se o user pode aprovar E não é summary
        const selectCheckbox = isFirst && isSelectable ? (
          <button
            onClick={(e) => { e.stopPropagation(); selection!.toggle(selKey); }}
            className={`mr-1.5 inline-flex items-center justify-center w-4 h-4 rounded border align-middle transition ${
              isSelected ? "bg-sky-600 border-sky-600" : "bg-white border-slate-300 hover:border-sky-400"
            }`}
            title={isSelected ? "Desmarcar" : "Selecionar pra aprovar em lote"}
          >
            {isSelected && (
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
          </button>
        ) : null;
        const bucketBadge = isFirst && bucketInfo ? (
          <span className="ml-2 inline-flex items-center gap-1.5 text-[10px] text-slate-500">
            <span>· {bucketInfo.qtd} PC{bucketInfo.qtd !== 1 ? "s" : ""}</span>
            {bucketInfo.aprovados  > 0 && <span className="text-emerald-700">✅ {bucketInfo.aprovados}</span>}
            {bucketInfo.pendentes  > 0 && <span>⏸ {bucketInfo.pendentes}</span>}
            {bucketInfo.rejeitados > 0 && <span className="text-rose-700">❌ {bucketInfo.rejeitados}</span>}
          </span>
        ) : null;

        // Colunas MERGED em modo expandido: renderiza só na 1ª linha do bucket com rowspan
        if (!isSummary && mergedInfo && MERGED_COLS.has(col.key)) {
          if (!mergedInfo.isFirstInBucket) return null;
          const blk = blockKeyFor(group.key);
          const userCanEdit = canEdit(user, modulo, blk);
          const isEditable = col.editable && col.editableField && userCanEdit;
          return (
            <td key={`${group.key}.${col.key}`}
                rowSpan={mergedInfo.bucketSize}
                className={`px-3 py-1.5 whitespace-nowrap border-b border-slate-200 ${isFirst ? stickyCls : group.tint} align-middle text-center font-semibold ring-1 ring-inset ring-amber-200/40`}
                onClick={(e) => { if (isEditable) e.stopPropagation(); }}>
              {isEditable ? (
                <EditableCell
                  empresa={String(row.empresa)}
                  ncod_ped={Number(row.ncod_ped)}
                  field={col.editableField!}
                  kind={col.editable as "date" | "text" | "number" | "money"}
                  initialValue={val}
                />
              ) : (
                <div className="bg-white/70 rounded px-2 py-1 inline-block tabular-nums">
                  {formatCell(val, col.format)}
                </div>
              )}
            </td>
          );
        }

        // Em linha summary, não edita — apenas mostra valor.
        // Status editável é tratado no branch de status (abaixo), fora do genérico.
        if (
          col.editable && col.editable !== "status" && col.editableField &&
          !isSummary && canEdit(user, modulo, blockKeyFor(group.key))
        ) {
          return (
            <td key={`${group.key}.${col.key}`}
                className={`px-2 py-1 whitespace-nowrap border-b border-slate-200 ${isFirst ? stickyCls : group.tint}`}
                onClick={(e) => e.stopPropagation()}>
              {selectCheckbox}{toggleArrow}
              <EditableCell
                empresa={String(row.empresa)}
                ncod_ped={Number(row.ncod_ped)}
                field={col.editableField}
                kind={col.editable}
                initialValue={val}
              />
              {bucketBadge}
            </td>
          );
        }

        if (col.format === "status" && val) {
          const sCode = String(row.status);
          const meta = STATUS_META[sCode] ?? STATUS_META.PENDENTE;
          // Editável (col.editable === "status"): dropdown com as opções do Smart.
          // Não editável OU linha summary OU user sem permissão: badge estático.
          if (col.editable === "status" && !isSummary && canApprove(user, modulo)) {
            return (
              <td key={`${group.key}.${col.key}`}
                  className={`px-3 py-1.5 border-b border-slate-200 ${isFirst ? stickyCls : group.tint}`}
                  onClick={(e) => e.stopPropagation()}>
                {selectCheckbox}{toggleArrow}
                <EditableStatusCell
                  empresa={String(row.empresa)}
                  ncod_ped={Number(row.ncod_ped)}
                  modulo={String(row.modulo ?? _dm)}
                  current={sCode}
                  valorPc={row.valor_total != null ? Number(row.valor_total) : null}
                />
                {bucketBadge}
              </td>
            );
          }
          return (
            <td key={`${group.key}.${col.key}`}
                className={`px-3 py-1.5 border-b border-slate-200 ${isFirst ? stickyCls : group.tint}`}>
              {selectCheckbox}{toggleArrow}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 whitespace-nowrap ${meta.tone}`}>
                {meta.emoji} {meta.label}
              </span>
              {bucketBadge}
            </td>
          );
        }

        // Bullet "novo nas últimas 24h" ao lado do PC# e V.PV/OS
        const newBullet = (
          (col.key === "pc_numero"   && row.pc_is_new) ||
          (col.key === "pv_os_label" && row.pv_is_new)
        ) ? (
          <span
            className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle animate-pulse"
            title="Entrou nas últimas 24h"
          />
        ) : null;

        return (
          <td key={`${group.key}.${col.key}`}
              className={`px-3 py-1.5 whitespace-nowrap border-b border-slate-200 ${isFirst ? stickyCls : group.tint} ${
                col.align === "right" ? "text-right tabular-nums" :
                col.align === "center" ? "text-center" : "text-left"
              } ${col.format === "mono" ? " text-slate-900" : "text-slate-700"}`}>
            {selectCheckbox}{toggleArrow}
            {formatCell(val, col.format)}
            {newBullet}
            {bucketBadge}
          </td>
        );
      })}
    </tr>
  );
}

function PvBucketView_UNUSED({
  bucket,
  groups,
  openGroups,
  visibleColumns,
  groupByPv,
  onRowClick,
}: {
  bucket: PvBucket;
  groups: Group[];
  openGroups: Record<string, boolean>;
  visibleColumns: { col: import("@/lib/columns").Column; group: Group }[];
  groupByPv: boolean;
  onRowClick: (r: AnyRow) => void;
}) {
  const [open, setOpen] = useState(groupByPv ? bucket.rows.length <= 30 : true);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm">
      {groupByPv && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 border-b border-slate-200 text-left transition"
        >
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-xs">{open ? "▼" : "▶"}</span>
            <span className="font-semibold  text-slate-900">{bucket.label}</span>
            <span className="text-xs text-slate-500">{bucket.rows.length} PC{bucket.rows.length !== 1 ? "s" : ""}</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            {bucket.aprovados > 0 && (
              <span className="text-emerald-700 font-medium">✅ {bucket.aprovados}</span>
            )}
            {bucket.pendentes > 0 && (
              <span className="text-slate-500">⏸ {bucket.pendentes}</span>
            )}
            {bucket.rejeitados > 0 && (
              <span className="text-rose-700 font-medium">❌ {bucket.rejeitados}</span>
            )}
            <span className="text-slate-600 tabular-nums">
              {bucket.somaValor > 0
                ? bucket.somaValor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                : "—"}
            </span>
          </div>
        </button>
      )}

      {open && (
        <div className="overflow-x-auto">
          <table className="text-xs w-full">
            <thead>
              {groups.some((g) => openGroups[g.key]) && (
                <tr>
                  {groups.map((g) =>
                    openGroups[g.key] ? (
                      <th
                        key={g.key}
                        colSpan={g.columns.length}
                        className={`${g.tint} ${g.border} border-b border-l text-xs font-semibold text-slate-700 px-3 py-1.5 text-left`}
                      >
                        {g.label}
                      </th>
                    ) : null,
                  )}
                </tr>
              )}
              <tr className="bg-slate-50 text-slate-600 uppercase text-[10px] tracking-wider">
                {visibleColumns.map(({ col, group }) => (
                  <th
                    key={`${group.key}.${col.key}`}
                    className={`px-3 py-2 whitespace-nowrap border-b border-slate-200 ${
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                    }`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bucket.rows.map((r, i) => (
                <tr
                  key={`${r.empresa}-${r.ncod_ped}-${i}`}
                  className="hover:bg-slate-50/70 cursor-pointer"
                  onClick={() => onRowClick(r)}
                >
                  {visibleColumns.map(({ col, group }) => {
                    const val = r[col.key];
                    if (col.format === "status" && val) {
                      const sCode = String(r.status);
                      const meta = STATUS_META[sCode] ?? STATUS_META.PENDENTE;
                      return (
                        <td key={`${group.key}.${col.key}`} className={`px-3 py-1.5 ${group.tint}`}>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 whitespace-nowrap ${meta.tone}`}>
                            {meta.emoji} {meta.label}
                          </span>
                        </td>
                      );
                    }
                    if (col.editable && col.editableField) {
                      return (
                        <td
                          key={`${group.key}.${col.key}`}
                          className={`px-2 py-1 whitespace-nowrap ${group.tint}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <EditableCell
                            empresa={String(r.empresa)}
                            ncod_ped={Number(r.ncod_ped)}
                            field={col.editableField}
                            kind={col.editable as "date" | "text" | "number" | "money"}
                            initialValue={val}
                          />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={`${group.key}.${col.key}`}
                        className={`px-3 py-1.5 whitespace-nowrap ${group.tint} ${
                          col.align === "right"
                            ? "text-right tabular-nums"
                            : col.align === "center" ? "text-center" : "text-left"
                        } ${col.format === "mono" ? " text-slate-900" : "text-slate-700"}`}
                      >
                        {formatCell(val, col.format as import("@/lib/columns").ColumnFormat | undefined)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
