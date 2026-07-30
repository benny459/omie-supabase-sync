"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { supaBrowser } from "@/lib/supabase";
import * as XLSX from "xlsx";

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
  pc_etapa_texto: string | null;
  dt_previsao: string | null;
  nova_prev_materiais: string | null;
  mt_data_recebimento_nf: string | null;
  nome_fornecedor: string | null;
  pc_valor_total: number | null;
};

type PcSearchResult = {
  pc_numero: string;
  valor_total: number | null;
  nome_fornecedor: string | null;
  dt_previsao: string | null;
  dt_inclusao: string | null;
  projeto_nome: string | null;
};

const fmtBR = (s: string | null | undefined): string => {
  if (!s) return "—";
  const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return String(s);
};

// Slug estável pro nome de equipamento — usa como ?tab= na URL. Só ascii + dash.
function slug(s: string): string {
  return s.toString().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "eq";
}

// Excel sheet names: max 31 chars, sem \/?*[]: e não pode ser vazio nem repetir.
function sanitizeSheetName(raw: string, taken: Set<string>): string {
  let base = (raw ?? "").replace(/[\\/?*[\]:]/g, "").trim().slice(0, 31);
  if (!base) base = "Sem nome";
  let candidate = base;
  let i = 2;
  while (taken.has(candidate)) {
    const suffix = ` (${i})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
    i++;
  }
  taken.add(candidate);
  return candidate;
}

// Ordena por Fornecedor (nulls no fim) → depois Item alfabético.
function sortByFornecItem(a: ItemRow, b: ItemRow): number {
  const fa = (a.nome_fornecedor ?? "").trim();
  const fb = (b.nome_fornecedor ?? "").trim();
  if (!fa && fb) return 1;
  if (fa && !fb) return -1;
  if (fa !== fb) return fa.localeCompare(fb, "pt-BR", { sensitivity: "base" });
  return (a.item ?? "").localeCompare(b.item ?? "", "pt-BR", { sensitivity: "base" });
}

// Colore o Status Fornec (mt_status_fornecimento) por família de valor.
// "Conferido/Recebido" verde, "Aguardando" âmbar, "Cotação" cinza, etc.
function statusFornecTone(v: string): string {
  const norm = v.toLowerCase().normalize("NFD").replace(/\p{Mn}/gu, "");
  if (norm.includes("conferi") || norm.includes("recebi")) return "bg-emerald-100 text-emerald-800 border-emerald-300";
  if (norm.includes("aguard"))                             return "bg-amber-100 text-amber-800 border-amber-300";
  if (norm.includes("parcial"))                            return "bg-sky-100 text-sky-800 border-sky-300";
  if (norm.includes("cancel"))                             return "bg-rose-100 text-rose-800 border-rose-300";
  if (norm.includes("cotac"))                              return "bg-ww-bg text-ww-textMuted border-ww-border";
  return "bg-ww-bg text-ww-textMuted border-ww-border";
}

// Fallback só quando NÃO há Status Fornec no Omie: mostra flag de atraso
// baseado nas datas de previsão vs hoje. Assim a coluna nunca fica vazia
// enquanto o comprador não classifica manualmente.
function delayFallback(row: ItemRow): { label: string; tone: string } | null {
  if (row.mt_data_recebimento_nf) {
    return { label: "✓ recebido", tone: "bg-emerald-100 text-emerald-800 border-emerald-300" };
  }
  const effRaw = row.nova_prev_materiais ?? row.dt_previsao;
  if (!effRaw) return null;
  const m = String(effRaw).match(/^(\d{2})\/(\d{2})\/(\d{4})|(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (m[1]) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else { y = +m[4]; mo = +m[5]; d = +m[6]; }
  const t = new Date(y, mo - 1, d).getTime();
  const today = new Date().setHours(0, 0, 0, 0);
  const dias = Math.floor((today - t) / 86400000);
  if (dias > 0) return { label: `${dias}d atraso`, tone: "bg-rose-100 text-rose-800 border-rose-300" };
  return null;
}

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

export default function RcProjetoItensBlock({
  empresa,
  codigoProjeto,
}: {
  empresa: string;
  codigoProjeto: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<ItemRow[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingBudget, setEditingBudget] = useState(false);
  const [budgetInput, setBudgetInput] = useState<string>("");

  // Multi-select — Set de IDs marcados (persiste entre trocas de aba se o usuário
  // quiser marcar itens em vários equipamentos antes de vincular).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastCheckedIdxRef = useRef<number | null>(null); // por-tab; resetamos ao trocar
  // Contexto de abertura do picker: batch (usa selected) ou single (1 item click).
  // null = fechado. O picker consome os ids daqui, não do selected direto, pra o
  // click individual não conflitar com o multi-select em andamento.
  const [picker, setPicker] = useState<null | { mode: "batch"; ids: string[] } | { mode: "single"; id: string; itemLabel: string }>(null);

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

  // Agrupa por equipamento + calcula lista de abas
  const { groups, tabs } = useMemo(() => {
    const g = new Map<string, ItemRow[]>();
    for (const r of rows) {
      if (!g.has(r.equipamento)) g.set(r.equipamento, []);
      g.get(r.equipamento)!.push(r);
    }
    const t = Array.from(g.keys()).map((eq) => ({ eq, s: slug(eq), n: g.get(eq)!.length }));
    return { groups: g, tabs: t };
  }, [rows]);

  // Tab ativa: da URL (?tab=) ou primeira. Persiste com replace pra não empilhar histórico.
  const tabFromUrl = searchParams?.get("tab") ?? "";
  const activeSlug = useMemo(() => {
    if (tabFromUrl && tabs.some((t) => t.s === tabFromUrl)) return tabFromUrl;
    return tabs[0]?.s ?? "";
  }, [tabFromUrl, tabs]);
  const activeTab = tabs.find((t) => t.s === activeSlug);
  const activeItems = activeTab ? (groups.get(activeTab.eq) ?? []) : [];

  const setActiveTab = useCallback((s: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", s);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    lastCheckedIdxRef.current = null;
  }, [router, pathname, searchParams]);

  // Export Excel — abas: 1 por conjunto (nome literal, ex "Abrandador") +
  // aba "Completa" (Conjunto no fim) + aba "Resumo". Ordenação: fornecedor
  // → item alfabético dentro de cada aba.
  const exportExcel = useCallback(() => {
    if (rows.length === 0) return;
    const wb = XLSX.utils.book_new();
    const taken = new Set<string>();

    // Helper mapper — colunas visíveis. `withConjunto`=true adiciona no FIM.
    const rowToRecord = (r: ItemRow, withConjunto: boolean) => {
      const base = {
        "Item":       r.item ?? "",
        "Qtd":        r.qtd ?? "",
        "Modelo":     r.modelo ?? "",
        "PC #":       r.pc_numero ?? "",
        "Fornecedor": r.nome_fornecedor ?? "",
        "Prev. PC":   fmtBR(r.dt_previsao),
        "Nova Prev.": fmtBR(r.nova_prev_materiais),
        "Status":     r.pc_etapa_texto ?? r.status_fornec ?? "",
      };
      return withConjunto ? { ...base, "Conjunto": r.equipamento ?? "" } : base;
    };

    // 1) Aba "Resumo" — vem primeiro pro user abrir logo e ver o panorama.
    const resumoRows = Array.from(groups.entries())
      .map(([eq, items]) => ({
        "Conjunto":       eq,
        "Qtd itens":      items.length,
        "Qtd fornecidos": items.filter(i => i.pc_numero).length,
        "Qtd pendentes":  items.filter(i => !i.pc_numero).length,
        "Fornecedores":   Array.from(new Set(items.map(i => i.nome_fornecedor).filter(Boolean))).length,
      }))
      .sort((a, b) => (a.Conjunto as string).localeCompare(b.Conjunto as string, "pt-BR"));
    resumoRows.push({
      "Conjunto":       "TOTAL",
      "Qtd itens":      rows.length,
      "Qtd fornecidos": rows.filter(i => i.pc_numero).length,
      "Qtd pendentes":  rows.filter(i => !i.pc_numero).length,
      "Fornecedores":   Array.from(new Set(rows.map(i => i.nome_fornecedor).filter(Boolean))).length,
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumoRows), sanitizeSheetName("Resumo", taken));

    // 2) Aba "Completa" — todos ordenados por conjunto, depois fornec, depois item.
    const completa = [...rows].sort((a, b) => {
      const c = (a.equipamento ?? "").localeCompare(b.equipamento ?? "", "pt-BR");
      return c !== 0 ? c : sortByFornecItem(a, b);
    }).map(r => rowToRecord(r, true));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(completa), sanitizeSheetName("Completa", taken));

    // 3) Uma aba por conjunto (ordem alfabética do nome), ordenada por fornec→item.
    const equipamentosOrdenados = Array.from(groups.keys())
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    for (const eq of equipamentosOrdenados) {
      const items = [...(groups.get(eq) ?? [])].sort(sortByFornecItem).map(r => rowToRecord(r, false));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(items), sanitizeSheetName(eq, taken));
    }

    const dt = new Date();
    const stamp = `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,"0")}${String(dt.getDate()).padStart(2,"0")}`;
    XLSX.writeFile(wb, `lista-materiais-PJ${codigoProjeto}-${stamp}.xlsx`);
  }, [rows, groups, codigoProjeto]);

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

  // Multi-select: clique normal → toggle 1 item. Shift+click → range com o último.
  // Idx é sempre relativo à aba ativa; trocar aba reseta o âncora.
  function toggleRow(id: string, idx: number, shift: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shift && lastCheckedIdxRef.current != null) {
        const from = Math.min(lastCheckedIdxRef.current, idx);
        const to   = Math.max(lastCheckedIdxRef.current, idx);
        // Estado alvo do range = oposto do que o anchor era (mimica Gmail/GitHub):
        // se o alvo atual já está marcado, remove todos; se não, marca todos.
        const target = !next.has(id);
        for (let i = from; i <= to; i++) {
          const rowId = activeItems[i]?.id;
          if (!rowId) continue;
          if (target) next.add(rowId); else next.delete(rowId);
        }
      } else {
        if (next.has(id)) next.delete(id); else next.add(id);
      }
      lastCheckedIdxRef.current = idx;
      return next;
    });
  }

  function toggleAllInTab(check: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const it of activeItems) {
        if (check) next.add(it.id); else next.delete(it.id);
      }
      return next;
    });
  }

  async function handlePickerConfirm(pc: PcSearchResult) {
    if (!picker) return;
    const ids = picker.mode === "batch" ? picker.ids : [picker.id];
    if (ids.length === 0) return;
    const r = await fetch("/api/rc-projetos/itens/bulk-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, ids, pc_numero: pc.pc_numero }),
    });
    const j = await r.json();
    setPicker(null);
    if (!r.ok) { alert(`Falha: ${j.error ?? "erro"}`); return; }
    const sub = j.substituidos ?? 0;
    if (picker.mode === "batch") {
      alert(`✓ ${j.updated} itens vinculados a PC ${pc.pc_numero}${sub > 0 ? ` — ${sub} tinha(m) PC anterior (sobrescrito)` : ""}`);
      setSelected(new Set());
    } else {
      // Feedback discreto pra single-link — a UI já vai refletir o vínculo
      if (sub > 0) alert(`✓ Vinculado a PC ${pc.pc_numero} (PC anterior sobrescrito)`);
    }
    await load();
  }

  if (loading) {
    return <div className="text-[11px] text-ww-textFaint italic px-3 py-2">Carregando itens RC…</div>;
  }

  const budget = resumo?.valor_budget ?? null;
  const comprometido = resumo?.valor_comprometido ?? 0;
  const restante = resumo?.valor_restante ?? null;
  const overBudget = budget != null && comprometido > budget;

  const allInTabSelected = activeItems.length > 0 && activeItems.every((it) => selected.has(it.id));
  const someInTabSelected = activeItems.some((it) => selected.has(it.id));

  return (
    <div className="border-t border-ww-border bg-violet-50/30 dark:bg-violet-950/20 px-4 py-3">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div className="text-[11px] uppercase tracking-[0.6px] font-bold text-violet-900 dark:text-violet-200 flex items-center gap-2">
          <span>📦 Itens RC · {rows.length} itens em {groups.size} equipamento{groups.size !== 1 ? "s" : ""}</span>
          {rows.length > 0 && (
            <button
              onClick={exportExcel}
              title={`Exporta ${rows.length} itens em abas (Resumo + Completa + 1 por conjunto)`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-semibold border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200 normal-case tracking-normal transition"
            >
              📊 Exportar Excel
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] tabular-nums">
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
          {budget != null && (
            <div className="flex items-center gap-1.5">
              <span className="text-amber-700 dark:text-amber-300 uppercase tracking-wider font-semibold text-[10px]">Comprometido:</span>
              <span className="font-mono text-amber-900 dark:text-amber-100">{fmtBRL(comprometido)}</span>
            </div>
          )}
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

      {tabs.length === 0 && (
        <div className="text-[12px] text-ww-textMuted italic px-3 py-2 bg-ww-panel rounded border border-violet-200">
          Nenhum item cadastrado ainda. Use <strong>Lista RC (Projeto)</strong> pra subir o XLSX.
        </div>
      )}

      {tabs.length > 0 && (
        <>
          {/* TABS BAR — equipamento por aba */}
          <div className="border-b-2 border-violet-300 dark:border-violet-800 flex flex-wrap gap-0.5" role="tablist">
            {tabs.map((t) => {
              const isActive = t.s === activeSlug;
              const g = groups.get(t.eq) ?? [];
              const vinc = g.filter((i) => i.pc_numero).length;
              return (
                <button key={t.s} role="tab" aria-selected={isActive}
                  onClick={() => setActiveTab(t.s)}
                  className={`px-3 py-2 text-[12px] font-semibold rounded-t-md transition border border-b-0 ${
                    isActive
                      ? "bg-ww-panel text-violet-900 dark:text-violet-100 border-violet-300 dark:border-violet-800 -mb-px z-10"
                      : "bg-violet-100/50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-transparent hover:bg-violet-100 dark:hover:bg-violet-900/50"
                  }`}>
                  <span>{t.eq}</span>
                  <span className="ml-1.5 text-[10px] font-mono opacity-70">{vinc}/{t.n}</span>
                </button>
              );
            })}
          </div>

          {/* ACTIVE TAB TABLE — full width */}
          <div className="bg-ww-panel rounded-b-md border border-t-0 border-violet-300 dark:border-violet-800 overflow-x-auto">
            <table className="w-full text-[11.5px]">
              <thead className="bg-violet-50/60 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300">
                <tr>
                  <th className="px-2 py-1.5 w-8">
                    <input type="checkbox"
                      checked={allInTabSelected}
                      ref={(el) => { if (el) el.indeterminate = someInTabSelected && !allInTabSelected; }}
                      onChange={(e) => toggleAllInTab(e.target.checked)}
                      className="cursor-pointer accent-violet-600" />
                  </th>
                  <th className="text-left px-3 py-1.5 font-semibold">Item</th>
                  <th className="text-right px-2 py-1.5 font-semibold w-14">Qtd</th>
                  <th className="text-left px-2 py-1.5 font-semibold w-32">Modelo</th>
                  <th className="text-left px-2 py-1.5 font-semibold w-24">PC #</th>
                  <th className="text-left px-2 py-1.5 font-semibold w-40">Fornecedor</th>
                  <th className="text-left px-2 py-1.5 font-semibold w-24">Prev. PC</th>
                  <th className="text-left px-2 py-1.5 font-semibold w-24">Nova Prev.</th>
                  <th className="text-left px-2 py-1.5 font-semibold w-28">Status</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {activeItems.map((it, idx) => {
                  const fallback = delayFallback(it);
                  const isSel = selected.has(it.id);
                  return (
                    <tr key={it.id}
                      className={`border-t border-violet-100/60 dark:border-violet-900/40 transition ${
                        isSel ? "bg-violet-100/60 dark:bg-violet-900/40" : "hover:bg-violet-50/40 dark:hover:bg-violet-950/20"
                      }`}>
                      <td className="px-2 py-1.5 text-center">
                        <input type="checkbox" checked={isSel}
                          onClick={(e) => { e.stopPropagation(); toggleRow(it.id, idx, (e as React.MouseEvent).shiftKey); }}
                          onChange={() => { /* controlado por onClick */ }}
                          className="cursor-pointer accent-violet-600" />
                      </td>
                      <td className="px-3 py-1.5">{it.item}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-mono">{it.qtd ?? "—"}</td>
                      <td className="px-2 py-1.5 text-ww-textMuted truncate max-w-[128px]" title={it.modelo ?? undefined}>{it.modelo ?? "—"}</td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => setPicker({ mode: "single", id: it.id, itemLabel: it.item })}
                          title={it.pc_numero ? `PC ${it.pc_numero} — clique pra trocar` : "Vincular a um PC existente"}
                          className="font-mono text-[11px] text-blue-700 hover:underline hover:bg-violet-50 rounded px-1">
                          {it.pc_numero || <span className="text-ww-textFaint italic">vincular…</span>}
                        </button>
                      </td>
                      <td className="px-2 py-1.5 text-ww-textMuted truncate max-w-[160px]" title={it.nome_fornecedor ?? undefined}>
                        {it.nome_fornecedor ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-ww-text tabular-nums">{fmtBR(it.dt_previsao)}</td>
                      <td className="px-2 py-1.5 text-ww-text tabular-nums">
                        {it.nova_prev_materiais ? fmtBR(it.nova_prev_materiais) : <span className="text-ww-textFaint italic">—</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {/* Prioridade: Status Fornec (Logística) → fallback de
                            atraso (só quando Omie ainda não classificou). */}
                        {it.status_fornec ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-semibold border ${statusFornecTone(it.status_fornec)}`}
                                title="Status Fornec — Logística / NFe Entrada">
                            {it.status_fornec}
                          </span>
                        ) : fallback ? (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border ${fallback.tone}`}
                                title="Sem Status Fornec no Omie — cálculo por data">
                            {fallback.label}
                          </span>
                        ) : (
                          <span className="text-ww-textFaint italic text-[10.5px]">—</span>
                        )}
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
        </>
      )}

      {/* BATCH BAR flutuante */}
      {selected.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2.5 bg-violet-900 dark:bg-violet-800 text-violet-50 rounded-xl shadow-2xl">
          <span className="font-mono text-[12px] font-semibold">
            {selected.size} item{selected.size !== 1 ? "s" : ""} selecionado{selected.size !== 1 ? "s" : ""}
          </span>
          <div className="w-px h-5 bg-violet-500/60" />
          <button onClick={() => setPicker({ mode: "batch", ids: Array.from(selected) })}
            className="px-3 py-1 text-[12px] font-bold rounded bg-violet-50 text-violet-900 hover:bg-ww-panel transition">
            🔗 Vincular a PC…
          </button>
          <button onClick={() => setSelected(new Set())}
            className="text-[16px] leading-none opacity-70 hover:opacity-100" title="Limpar seleção">×</button>
        </div>
      )}

      {picker && (
        <PcPickerModal empresa={empresa}
          codigoProjeto={codigoProjeto}
          title={picker.mode === "batch"
            ? `Vincular ${picker.ids.length} item(s) a um PC`
            : `Vincular "${picker.itemLabel}" a um PC`}
          onClose={() => setPicker(null)}
          onConfirm={handlePickerConfirm} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// PcPickerModal — busca PCs existentes no Omie e retorna o escolhido.
// ─────────────────────────────────────────────────────────────────────────
function PcPickerModal({
  empresa, codigoProjeto, title, onClose, onConfirm,
}: {
  empresa: string;
  codigoProjeto: number;
  title: string;
  onClose: () => void;
  onConfirm: (pc: PcSearchResult) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PcSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `/api/pcs/search?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}&q=${encodeURIComponent(q)}&limit=50`;
        const r = await fetch(url);
        if (r.ok) {
          const j = await r.json();
          setRows((j.rows ?? []) as PcSearchResult[]);
        }
      } finally { setLoading(false); }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, empresa, codigoProjeto]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-ww-panel rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-ww-border flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ww-text text-[15px]">{title}</h3>
            <p className="text-[11px] text-ww-textMuted mt-0.5">
              Escolha um PC existente do Omie para <strong>{empresa}</strong>. Busque por número, fornecedor ou projeto.
            </p>
          </div>
          <button onClick={onClose} className="text-ww-textFaint hover:text-ww-text dark:hover:text-slate-100 text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-3 border-b border-ww-border ">
          <input autoFocus type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Nº do PC, fornecedor ou projeto…"
            className="w-full px-3 py-2 text-sm border border-ww-border rounded-md bg-ww-panel text-ww-text focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-4 text-[12px] text-ww-textMuted italic">Buscando…</div>}
          {!loading && rows.length === 0 && (
            <div className="p-4 text-[12px] text-ww-textMuted italic">Nenhum PC encontrado. Ajuste a busca.</div>
          )}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <li key={r.pc_numero}>
                <button onClick={() => onConfirm(r)}
                  className="w-full text-left px-5 py-2.5 hover:bg-violet-50 dark:hover:bg-violet-950/40 transition flex items-center gap-4">
                  <div className="min-w-[80px]">
                    <div className="font-mono text-[13px] font-bold text-violet-800 dark:text-violet-200">PC {r.pc_numero}</div>
                    <div className="text-[10px] text-ww-textMuted tabular-nums">{fmtBR(r.dt_inclusao)}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-ww-text truncate">{r.nome_fornecedor ?? "—"}</div>
                    <div className="text-[10.5px] text-ww-textMuted truncate">{r.projeto_nome ?? "—"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12px] font-bold tabular-nums text-emerald-800 dark:text-emerald-300 whitespace-nowrap">
                      {r.valor_total != null ? fmtBRL(Number(r.valor_total)) : "—"}
                    </div>
                    <div className="text-[10px] text-ww-textMuted tabular-nums">Prev: {fmtBR(r.dt_previsao)}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-5 py-3 border-t border-ww-border text-[10.5px] text-ww-textMuted ">
          Clique em um PC pra confirmar. Itens que já tinham PC serão sobrescritos.
        </div>
      </div>
    </div>
  );
}
