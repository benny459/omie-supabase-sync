"use client";

// /standby — força-sync pontual de qualquer PC / PV / OS.
// Tabelas com paginação client-side (100/pág). Auto-refresh 1h via router.refresh().

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useUserPerms } from "./UserPermsProvider";

export type StandbyPc = {
  empresa: string | null;
  pc_numero: string | null;
  ncod_ped: number | null;
  projeto_nome: string | null;
  nome_fornecedor: string | null;
  pc_etapa_texto: string | null;
  valor_total: number | string | null;
  dt_inclusao: string | null;
  dt_previsao: string | null;
};

export type StandbyPv = {
  empresa: string | null;
  pv_os_label: string | null;
  pv_os_tipo: string | null;
  pv_cliente_fantasia: string | null;
  projeto_nome: string | null;
  pv_data_previsao: string | null;
  pv_valor_total: number | string | null;
  pv_etapa_texto: string | null;
  pv_dt_fat: string | null;
  pv_num_nfe: string | null;
  pv_emissao: string | null;
};

const PAGE_SIZE = 100;

const fmtBRL = (v: number | string | null) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
};

const fmtDate = (s: string | null) => (s ? String(s) : "—");

export default function StandbyView({ pcs, pvs }: { pcs: StandbyPc[]; pvs: StandbyPv[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"pcs" | "pvs">("pcs");

  // Auto-refresh 1h + on tab focus (se ficou +1h fora). router.refresh() re-executa
  // o server component sem full reload — mantém filtros/seleção do usuário.
  useEffect(() => {
    let lastRefresh = Date.now();
    const HOUR = 3600_000;
    const doRefresh = () => { lastRefresh = Date.now(); router.refresh(); };
    const id = setInterval(doRefresh, HOUR);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh > HOUR) doRefresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-ww-border">
        <TabButton active={tab === "pcs"} onClick={() => setTab("pcs")}
          label={`📦 PCs (${pcs.length.toLocaleString("pt-BR")})`} tone="orange" />
        <TabButton active={tab === "pvs"} onClick={() => setTab("pvs")}
          label={`📄 PVs / OSs (${pvs.length.toLocaleString("pt-BR")})`} tone="sky" />
      </div>
      {tab === "pcs" ? <PcsTable pcs={pcs} /> : <PvsTable pvs={pvs} />}
    </div>
  );
}

function TabButton({ active, onClick, label, tone }: {
  active: boolean; onClick: () => void; label: string; tone: "orange" | "sky";
}) {
  const activeCls = tone === "orange"
    ? "border-orange-500 text-orange-700 dark:text-orange-300"
    : "border-sky-500 text-sky-700 dark:text-sky-300";
  return (
    <button type="button" onClick={onClick}
      className={`px-4 py-2 text-[13px] font-semibold border-b-2 transition ${
        active ? activeCls : "border-transparent text-ww-textMuted hover:text-ww-text"
      }`}>
      {label}
    </button>
  );
}

function PcsTable({ pcs }: { pcs: StandbyPc[] }) {
  const perms = useUserPerms();
  const isAdmin = !!perms?.is_admin;
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string; url?: string } | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return pcs;
    return pcs.filter((p) => {
      const hay = [p.pc_numero, p.nome_fornecedor, p.projeto_nome, p.pc_etapa_texto]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(query);
    });
  }, [pcs, q]);

  // Reset página quando filtro muda
  useEffect(() => { setPage(1); }, [q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageStart = (pageSafe - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const totalValor = useMemo(() =>
    filtered.reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0),
  [filtered]);

  function toggleOne(pc: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(pc) ? s.delete(pc) : s.add(pc);
      return s;
    });
  }
  // Toggle all seleciona TODAS as linhas filtradas (não só da pág atual) — user
  // tipicamente filtra pra reduzir e daí quer marcar tudo.
  function toggleAll() {
    if (selected.size === filtered.length && filtered.length > 0) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => String(p.pc_numero ?? "")).filter(Boolean)));
  }

  async function refetchSelected() {
    const list = [...selected].filter(Boolean);
    if (list.length === 0 || list.length > 500) {
      setMsg({ tone: "err", text: list.length > 500 ? "Máximo 500 por batch" : "Selecione ao menos 1" });
      return;
    }
    setSending(true); setMsg(null);
    try {
      const r = await fetch("/api/pcs/force-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pc_numeros: list }),
      });
      const j = await r.json();
      if (!r.ok) setMsg({ tone: "err", text: j.error ?? r.statusText });
      else {
        setMsg({ tone: "ok", text: `${j.message ?? "Dispatched"} Recarrega em ~1 min.`, url: j.run_url });
        setSelected(new Set());
      }
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally { setSending(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar por PC #, fornecedor, projeto…"
          className="flex-1 min-w-[260px] px-3 py-1.5 text-[12px] rounded border border-ww-border bg-ww-panel text-ww-text focus:outline-none focus:border-ww-accent" />
        <button type="button" onClick={refetchSelected}
          disabled={selected.size === 0 || sending}
          className={`px-4 py-1.5 text-[12px] font-semibold rounded transition ${
            selected.size === 0 || sending
              ? "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600"
              : "bg-orange-600 text-white hover:bg-orange-700"
          }`}>
          {sending ? "Disparando…" : `🔄 Atualizar ${selected.size > 0 ? `${selected.size} PC(s)` : "selecionados"}`}
        </button>
        <div className="ml-auto text-[11px] text-ww-textMuted">
          {filtered.length.toLocaleString("pt-BR")} de {pcs.length.toLocaleString("pt-BR")} · Total: <span className="font-mono font-bold text-ww-text">{fmtBRL(totalValor)}</span>
        </div>
      </div>

      <ResultMsg msg={msg} isAdmin={isAdmin} />

      <div className="overflow-x-auto border border-ww-border rounded-md bg-ww-panel">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-ww-bg border-b border-ww-border">
            <tr className="text-left text-[11px] uppercase tracking-[0.4px] text-ww-textMuted">
              <th className="px-2 py-2 w-8">
                <input type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  title="Selecionar tudo (todas as páginas filtradas)"
                  className="w-4 h-4 accent-orange-600 cursor-pointer" />
              </th>
              <th className="px-2 py-2 w-16">PC #</th>
              <th className="px-2 py-2 w-12">Empr.</th>
              <th className="px-2 py-2">Fornecedor</th>
              <th className="px-2 py-2 w-24">Projeto</th>
              <th className="px-2 py-2 w-32">Etapa PC</th>
              <th className="px-2 py-2 text-right w-32">Valor</th>
              <th className="px-2 py-2 w-28">Criado em</th>
              <th className="px-2 py-2 w-28">Prev. entrega</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-ww-textMuted italic">Nenhum PC.</td></tr>
            ) : pageRows.map((p) => {
              const pcNum = String(p.pc_numero ?? "");
              const isSel = selected.has(pcNum);
              return (
                <tr key={`${p.empresa}-${p.ncod_ped}`}
                    className={`border-t border-ww-border hover:bg-ww-rowHover cursor-pointer ${isSel ? "bg-orange-50 dark:bg-orange-950/30" : ""}`}
                    onClick={() => pcNum && toggleOne(pcNum)}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={isSel} onChange={() => pcNum && toggleOne(pcNum)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 accent-orange-600 cursor-pointer" />
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold text-ww-text">{pcNum || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-ww-textMuted">{p.empresa ?? "—"}</td>
                  <td className="px-2 py-1.5 truncate max-w-[280px]" title={p.nome_fornecedor ?? ""}>{p.nome_fornecedor ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-ww-textMuted">{p.projeto_nome ?? "—"}</td>
                  <td className="px-2 py-1.5 text-[11px]">{p.pc_etapa_texto ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtBRL(p.valor_total)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-ww-textMuted">{fmtDate(p.dt_inclusao)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-ww-textMuted">{fmtDate(p.dt_previsao)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Paginator page={pageSafe} totalPages={totalPages} onPage={setPage} tone="orange"
        rangeText={`${filtered.length === 0 ? 0 : pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, filtered.length).toLocaleString("pt-BR")} de ${filtered.length.toLocaleString("pt-BR")}`} />
    </div>
  );
}

function PvsTable({ pvs }: { pvs: StandbyPv[] }) {
  const perms = useUserPerms();
  const isAdmin = !!perms?.is_admin;
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "aberto" | "faturado">("aberto");
  const [tipoFilter, setTipoFilter] = useState<"todos" | "PV" | "OS">("todos");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string; url?: string } | null>(null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return pvs.filter((p) => {
      if (tipoFilter !== "todos" && p.pv_os_tipo !== tipoFilter) return false;
      const isFat = !!String(p.pv_dt_fat ?? "").trim() || !!String(p.pv_num_nfe ?? "").trim();
      if (statusFilter === "aberto" && isFat) return false;
      if (statusFilter === "faturado" && !isFat) return false;
      if (!query) return true;
      const hay = [p.pv_os_label, p.pv_cliente_fantasia, p.projeto_nome, p.pv_etapa_texto]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(query);
    });
  }, [pvs, q, statusFilter, tipoFilter]);

  useEffect(() => { setPage(1); }, [q, statusFilter, tipoFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageStart = (pageSafe - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  const totalValor = useMemo(() =>
    filtered.reduce((acc, p) => acc + (Number(p.pv_valor_total) || 0), 0),
  [filtered]);

  const extractNum = (label: string) => label.replace(/^(PV|OS)/i, "").trim();

  function toggleOne(label: string) {
    setSelected((prev) => {
      const s = new Set(prev);
      s.has(label) ? s.delete(label) : s.add(label);
      return s;
    });
  }
  function toggleAll() {
    if (selected.size === filtered.length && filtered.length > 0) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => String(p.pv_os_label ?? "")).filter(Boolean)));
  }

  async function refetchSelected() {
    const list = [...selected].filter(Boolean).map(extractNum);
    if (list.length === 0 || list.length > 500) {
      setMsg({ tone: "err", text: list.length > 500 ? "Máximo 500 por batch" : "Selecione ao menos 1" });
      return;
    }
    setSending(true); setMsg(null);
    try {
      const r = await fetch("/api/pvs/force-sync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pv_numeros: list }),
      });
      const j = await r.json();
      if (!r.ok) setMsg({ tone: "err", text: j.error ?? r.statusText });
      else {
        setMsg({ tone: "ok", text: `${j.message ?? "Dispatched"} Recarrega em ~1 min.`, url: j.run_url });
        setSelected(new Set());
      }
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally { setSending(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar por PV/OS, cliente, projeto…"
          className="flex-1 min-w-[260px] px-3 py-1.5 text-[12px] rounded border border-ww-border bg-ww-panel text-ww-text focus:outline-none focus:border-ww-accent" />
        {(["todos", "PV", "OS"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTipoFilter(k)}
            className={`px-2.5 py-1.5 text-[11.5px] font-semibold rounded border transition ${
              tipoFilter === k
                ? "bg-violet-600 text-white border-violet-700"
                : "bg-ww-panel text-ww-text border-ww-border hover:bg-ww-rowHover"
            }`}>
            {k === "todos" ? "PV+OS" : k}
          </button>
        ))}
        {(["aberto", "faturado", "todos"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setStatusFilter(k)}
            className={`px-2.5 py-1.5 text-[11.5px] font-semibold rounded border transition ${
              statusFilter === k
                ? "bg-sky-600 text-white border-sky-700"
                : "bg-ww-panel text-ww-text border-ww-border hover:bg-ww-rowHover"
            }`}>
            {k === "aberto" ? "Aberto" : k === "faturado" ? "Faturado" : "Todos"}
          </button>
        ))}
        <button type="button" onClick={refetchSelected}
          disabled={selected.size === 0 || sending}
          className={`px-4 py-1.5 text-[12px] font-semibold rounded transition ${
            selected.size === 0 || sending
              ? "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600"
              : "bg-sky-600 text-white hover:bg-sky-700"
          }`}>
          {sending ? "Disparando…" : `🔄 Atualizar ${selected.size > 0 ? `${selected.size} PV/OS` : "selecionados"}`}
        </button>
        <div className="w-full text-[11px] text-ww-textMuted mt-1">
          {filtered.length.toLocaleString("pt-BR")} de {pvs.length.toLocaleString("pt-BR")} · Total: <span className="font-mono font-bold text-ww-text">{fmtBRL(totalValor)}</span>
        </div>
      </div>

      <ResultMsg msg={msg} isAdmin={isAdmin} />

      <div className="overflow-x-auto border border-ww-border rounded-md bg-ww-panel">
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-ww-bg border-b border-ww-border">
            <tr className="text-left text-[11px] uppercase tracking-[0.4px] text-ww-textMuted">
              <th className="px-2 py-2 w-8">
                <input type="checkbox"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleAll}
                  title="Selecionar tudo (todas as páginas filtradas)"
                  className="w-4 h-4 accent-sky-600 cursor-pointer" />
              </th>
              <th className="px-2 py-2 w-20">PV/OS</th>
              <th className="px-2 py-2 w-12">Empr.</th>
              <th className="px-2 py-2 w-16">Tipo</th>
              <th className="px-2 py-2">Cliente</th>
              <th className="px-2 py-2 w-24">Projeto</th>
              <th className="px-2 py-2 w-28">Etapa</th>
              <th className="px-2 py-2 text-right w-32">Valor</th>
              <th className="px-2 py-2 w-24">Emissão</th>
              <th className="px-2 py-2 w-24">Prev.</th>
              <th className="px-2 py-2 w-24">Fat.</th>
              <th className="px-2 py-2 w-24">NFe</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={12} className="px-3 py-8 text-center text-ww-textMuted italic">Nenhum PV/OS.</td></tr>
            ) : pageRows.map((p) => {
              const label = String(p.pv_os_label ?? "");
              const isSel = selected.has(label);
              const isFat = !!String(p.pv_dt_fat ?? "").trim() || !!String(p.pv_num_nfe ?? "").trim();
              return (
                <tr key={`${p.empresa}-${label}`}
                    className={`border-t border-ww-border hover:bg-ww-rowHover cursor-pointer ${isSel ? "bg-sky-50 dark:bg-sky-950/30" : ""}`}
                    onClick={() => label && toggleOne(label)}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={isSel} onChange={() => label && toggleOne(label)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 accent-sky-600 cursor-pointer" />
                  </td>
                  <td className="px-2 py-1.5 font-mono font-semibold text-ww-text">{label || "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-ww-textMuted">{p.empresa ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    <span className={`px-1.5 py-0.5 text-[10px] rounded font-semibold ${
                      p.pv_os_tipo === "PV" ? "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                      : "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                    }`}>{p.pv_os_tipo ?? "—"}</span>
                  </td>
                  <td className="px-2 py-1.5 truncate max-w-[260px]" title={p.pv_cliente_fantasia ?? ""}>{p.pv_cliente_fantasia ?? "—"}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-ww-textMuted truncate max-w-[140px]" title={p.projeto_nome ?? ""}>{p.projeto_nome ?? "—"}</td>
                  <td className="px-2 py-1.5 text-[11px]">
                    <span className={isFat ? "text-emerald-700 dark:text-emerald-400 font-semibold" : ""}>{p.pv_etapa_texto ?? "—"}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtBRL(p.pv_valor_total)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-ww-textMuted">{fmtDate(p.pv_emissao)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-ww-textMuted">{fmtDate(p.pv_data_previsao)}</td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {p.pv_dt_fat ? <span className="text-emerald-700 dark:text-emerald-400 font-semibold">{fmtDate(p.pv_dt_fat)}</span> : "—"}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px] text-ww-textMuted">{p.pv_num_nfe ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Paginator page={pageSafe} totalPages={totalPages} onPage={setPage} tone="sky"
        rangeText={`${filtered.length === 0 ? 0 : pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, filtered.length).toLocaleString("pt-BR")} de ${filtered.length.toLocaleString("pt-BR")}`} />
    </div>
  );
}

function Paginator({ page, totalPages, onPage, tone, rangeText }: {
  page: number; totalPages: number; onPage: (n: number) => void; tone: "orange" | "sky"; rangeText: string;
}) {
  const btnBase = "px-2.5 py-1 text-[11.5px] font-semibold rounded border border-ww-border bg-ww-panel text-ww-text hover:bg-ww-rowHover disabled:opacity-40 disabled:cursor-not-allowed transition";
  const active = tone === "orange" ? "bg-orange-600 text-white border-orange-700 hover:bg-orange-700" : "bg-sky-600 text-white border-sky-700 hover:bg-sky-700";
  // Mostra até 7 páginas: primeira, ..., 3 ao redor da atual, ..., última
  const pages: (number | "…")[] = [];
  const push = (n: number | "…") => { if (pages[pages.length - 1] !== n) pages.push(n); };
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) push(i);
  } else {
    push(1);
    if (page > 3) push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) push(i);
    if (page < totalPages - 2) push("…");
    push(totalPages);
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-[11.5px]">
      <span className="text-ww-textMuted">{rangeText}</span>
      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={btnBase} onClick={() => onPage(1)} disabled={page <= 1}>«</button>
        <button type="button" className={btnBase} onClick={() => onPage(page - 1)} disabled={page <= 1}>‹</button>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-ww-textMuted">…</span>
          ) : (
            <button key={p} type="button"
              className={p === page ? `${btnBase} ${active}` : btnBase}
              onClick={() => onPage(p)}>{p}</button>
          ),
        )}
        <button type="button" className={btnBase} onClick={() => onPage(page + 1)} disabled={page >= totalPages}>›</button>
        <button type="button" className={btnBase} onClick={() => onPage(totalPages)} disabled={page >= totalPages}>»</button>
      </div>
    </div>
  );
}

// "Ver execução ↗" só pra admin — usuário comum não precisa da UI do GH Actions.
function ResultMsg({ msg, isAdmin }: { msg: { tone: "ok" | "err"; text: string; url?: string } | null; isAdmin: boolean }) {
  if (!msg) return null;
  return (
    <div className={`text-[11.5px] px-3 py-2 rounded ${
      msg.tone === "ok"
        ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
        : "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800"
    }`}>
      {msg.text}
      {isAdmin && msg.url && (
        <a href={msg.url} target="_blank" rel="noopener noreferrer" className="ml-2 underline font-semibold">Ver execução ↗</a>
      )}
    </div>
  );
}
