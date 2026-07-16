"use client";

// /standby — versão tabela flat com abas (PCs / PVs). Cada linha tem
// checkbox pra seleção em batch; botão "Refetch selecionados" dispara
// workflow_dispatch pontual (ConsultarPedCompra / ConsultarPedidoVenda).

import { useMemo, useState } from "react";

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

const fmtBRL = (v: number | string | null) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
};

const fmtDate = (s: string | null) => {
  if (!s) return "—";
  // já vem BR-format do view (dd/mm/yyyy). Retorna direto.
  return String(s);
};

export default function StandbyView({ pcs }: { pcs: StandbyPc[] }) {
  const [tab, setTab] = useState<"pcs" | "pvs">("pcs");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string; url?: string } | null>(null);

  // Filtro busca — pc_numero, fornecedor, projeto
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return pcs;
    return pcs.filter((p) => {
      const hay = [p.pc_numero, p.nome_fornecedor, p.projeto_nome, p.pc_etapa_texto]
        .filter(Boolean).join(" ").toLowerCase();
      return hay.includes(query);
    });
  }, [pcs, q]);

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
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((p) => String(p.pc_numero ?? "")).filter(Boolean)));
  }

  async function refetchSelected() {
    const list = [...selected].filter(Boolean);
    if (list.length === 0) return;
    if (list.length > 500) {
      setMsg({ tone: "err", text: "Máximo 500 por batch" });
      return;
    }
    setSending(true);
    setMsg(null);
    try {
      const r = await fetch("/api/pcs/force-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-ww-border">
        <TabButton active={tab === "pcs"} onClick={() => setTab("pcs")}
          label={`⏸ PCs Standby (${pcs.length})`} tone="orange" />
        <TabButton active={tab === "pvs"} onClick={() => setTab("pvs")}
          label="🔄 Forçar sync PVs" tone="sky" />
      </div>

      {tab === "pcs" ? (
        <>
          {/* Toolbar */}
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
              {sending ? "Disparando…" : `🔄 Refetch ${selected.size > 0 ? `${selected.size} PC(s)` : "selecionados"}`}
            </button>
            <div className="ml-auto text-[11px] text-ww-textMuted">
              {filtered.length} de {pcs.length} · Total: <span className="font-mono font-bold text-ww-text">{fmtBRL(totalValor)}</span>
            </div>
          </div>

          {msg && (
            <div className={`text-[11.5px] px-3 py-2 rounded ${
              msg.tone === "ok"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
                : "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800"
            }`}>
              {msg.text}
              {msg.url && <a href={msg.url} target="_blank" rel="noopener noreferrer" className="ml-2 underline font-semibold">Ver execução ↗</a>}
            </div>
          )}

          {/* Tabela */}
          <div className="overflow-x-auto border border-ww-border rounded-md bg-ww-panel">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-ww-bg border-b border-ww-border">
                <tr className="text-left text-[11px] uppercase tracking-[0.4px] text-ww-textMuted">
                  <th className="px-2 py-2 w-8">
                    <input type="checkbox"
                      checked={filtered.length > 0 && selected.size === filtered.length}
                      onChange={toggleAll}
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
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-ww-textMuted italic">Nenhum PC standby.</td></tr>
                ) : filtered.map((p) => {
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
        </>
      ) : (
        <PvForceSyncPanel />
      )}
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

function PvForceSyncPanel() {
  const [pvInput, setPvInput] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string; url?: string } | null>(null);

  async function dispatch() {
    const nums = pvInput.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (nums.length === 0) { setMsg({ tone: "err", text: "Digite ao menos 1 PV number" }); return; }
    if (nums.length > 500) { setMsg({ tone: "err", text: "Máx 500 por batch" }); return; }
    setSending(true); setMsg(null);
    try {
      const r = await fetch("/api/pvs/force-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pv_numeros: nums }),
      });
      const j = await r.json();
      if (!r.ok) setMsg({ tone: "err", text: j.error ?? r.statusText });
      else {
        setMsg({ tone: "ok", text: `${j.message ?? "Dispatched"} Recarrega em ~1 min.`, url: j.run_url });
        setPvInput("");
      }
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : String(e) });
    } finally { setSending(false); }
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-3 p-3 rounded-lg border border-sky-300 bg-sky-50 dark:bg-sky-950/40 dark:border-sky-800">
        <div className="text-[12px] font-bold text-sky-900 dark:text-sky-100 mb-1">
          Forçar sync de PVs específicos
        </div>
        <div className="text-[11px] text-sky-800 dark:text-sky-200 opacity-90">
          Cole os números dos PVs (ex: 1760, 1733). Máx 500 por batch. Chama <code>ConsultarPedido</code> no Omie
          e refaz o upsert em <code>sales.pedidos_venda</code> + <code>sales.etapas_pedidos</code>.
          Útil quando o sync incremental não pegou uma atualização recente (faturamento, etapa etc).
        </div>
      </div>

      <div className="flex gap-2">
        <textarea value={pvInput} onChange={(e) => setPvInput(e.target.value)}
          placeholder="Ex: 1760, 1733, 1798"
          rows={3}
          className="flex-1 text-[12px] font-mono px-3 py-2 rounded border border-ww-border bg-ww-panel text-ww-text focus:outline-none focus:border-sky-500 resize-y"
          disabled={sending} />
        <button type="button" onClick={dispatch}
          disabled={sending || pvInput.trim() === ""}
          className={`shrink-0 px-4 py-2 rounded text-[12px] font-semibold transition ${
            sending || pvInput.trim() === ""
              ? "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600"
              : "bg-sky-600 text-white hover:bg-sky-700"
          }`}>
          {sending ? "Disparando…" : "🔄 Refetch"}
        </button>
      </div>
      {msg && (
        <div className={`mt-3 text-[11.5px] px-3 py-2 rounded ${
          msg.tone === "ok"
            ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-800"
            : "bg-rose-50 text-rose-800 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800"
        }`}>
          {msg.text}
          {msg.url && <a href={msg.url} target="_blank" rel="noopener noreferrer" className="ml-2 underline font-semibold">Ver execução ↗</a>}
        </div>
      )}
    </div>
  );
}
