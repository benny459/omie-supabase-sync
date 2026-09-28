"use client";

// Contas a Pagar / Receber — dados do Omie espelhados em finance.v_titulos.
// Desenho inspirado no financeiro do FMEF: card de resumo com StatCells,
// breakdowns por categoria/contraparte/projeto e tabela densa paginada.

import { useEffect, useMemo, useState } from "react";
import NovoTituloModal from "./NovoTituloModal";

type Agg = { total: number; qtd: number };
type Breakdown = { nome: string; total: number; qtd: number };
type Row = {
  empresa: string;
  codigo_lancamento_omie: number;
  contraparte: string | null;
  cnpj_cpf: string | null;
  vencimento: string | null;
  previsao: string | null;
  emissao: string | null;
  valor_documento: number | string | null;
  valor_pago: number | string | null;
  status_titulo: string | null;
  numero_documento: string | null;
  numero_parcela: string | null;
  numero_documento_fiscal: string | null;
  numero_pedido: string | null;
  categoria: string | null;
  projeto: string | null;
  conta_corrente: string | null;
  observacao: string | null;
  boleto_numero: string | null;
};
type ApiResp = {
  rows: Row[];
  count: number;
  truncated: boolean;
  resumo: { total: Agg; vencido: Agg; vence_hoje: Agg; vence_7d: Agg; vence_30d: Agg; baixado: Agg };
  breakdowns: { categoria: Breakdown[]; contraparte: Breakdown[]; projeto: Breakdown[] };
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function money(v: number | string | null): string {
  return BRL.format(Number(v ?? 0));
}
function dataBR(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
function primeiroDiaDoMes(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-01`;
}
function hojeISO(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  "ATRASADO":   { label: "Atrasado",   cls: "bg-rose-500/15 text-rose-500 border-rose-500/30" },
  "VENCE HOJE": { label: "Vence hoje", cls: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  "A VENCER":   { label: "A vencer",   cls: "bg-sky-500/15 text-sky-600 border-sky-500/30" },
  "PAGO":       { label: "Pago",       cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  "RECEBIDO":   { label: "Recebido",   cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  "CANCELADO":  { label: "Cancelado",  cls: "bg-slate-500/15 text-slate-500 border-slate-500/30" },
};

function StatCell({ label, agg, tone }: { label: string; agg: Agg; tone: string }) {
  return (
    <div className="min-w-[130px]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint">{label}</div>
      <div className={`text-[19px] font-bold tracking-[-0.5px] ${tone}`}>{money(agg.total)}</div>
      <div className="text-[11px] text-ww-textMuted">{agg.qtd} título{agg.qtd === 1 ? "" : "s"}</div>
    </div>
  );
}

function BreakdownCol({ titulo, items }: { titulo: string; items: Breakdown[] }) {
  const max = Math.max(1, ...items.map((i) => i.total));
  return (
    <div className="flex-1 min-w-[220px]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint mb-2">{titulo}</div>
      <div className="space-y-1.5">
        {items.slice(0, 8).map((i) => (
          <div key={i.nome}>
            <div className="flex justify-between gap-2 text-[11px]">
              <span className="truncate text-ww-textMuted" title={i.nome}>{i.nome}</span>
              <span className="font-medium text-ww-text whitespace-nowrap">{money(i.total)}</span>
            </div>
            <div className="h-1 rounded-full bg-ww-border/60 mt-0.5">
              <div className="h-1 rounded-full bg-ww-accent/70" style={{ width: `${(i.total / max) * 100}%` }} />
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="text-[11px] text-ww-textFaint">—</div>}
      </div>
    </div>
  );
}

const PAGE_SIZE = 100;

export default function TitulosView({ tipo }: { tipo: "pagar" | "receber" }) {
  const [modo, setModo] = useState<"aberto" | "baixado" | "todos">("aberto");
  const [de, setDe] = useState(primeiroDiaDoMes());
  const [ate, setAte] = useState(hojeISO());
  const [data, setData] = useState<ApiResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [statusSel, setStatusSel] = useState<string>("");
  const [empresaSel, setEmpresaSel] = useState<string>("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ key: "vencimento" | "valor" | "contraparte"; asc: boolean }>({ key: "vencimento", asc: true });
  const [novoAberto, setNovoAberto] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true); setErr(null);
      try {
        const params = new URLSearchParams({ tipo, modo });
        if (modo !== "aberto") { params.set("de", de); params.set("ate", ate); }
        const r = await fetch(`/api/financeiro/titulos?${params}`, { signal: ctrl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setData(j as ApiResp);
        setPage(0);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr((e as Error).message);
      } finally { setLoading(false); }
    })();
    return () => ctrl.abort();
  }, [tipo, modo, de, ate, refresh]);

  const empresas = useMemo(
    () => [...new Set((data?.rows ?? []).map((r) => r.empresa))].sort(),
    [data],
  );

  const filtered = useMemo(() => {
    let rows = data?.rows ?? [];
    if (empresaSel) rows = rows.filter((r) => r.empresa === empresaSel);
    if (statusSel) rows = rows.filter((r) => (r.status_titulo ?? "") === statusSel);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((r) =>
        (r.contraparte ?? "").toLowerCase().includes(needle) ||
        (r.numero_documento ?? "").toLowerCase().includes(needle) ||
        (r.numero_documento_fiscal ?? "").toLowerCase().includes(needle) ||
        (r.numero_pedido ?? "").toLowerCase().includes(needle) ||
        (r.categoria ?? "").toLowerCase().includes(needle) ||
        (r.projeto ?? "").toLowerCase().includes(needle) ||
        (r.observacao ?? "").toLowerCase().includes(needle));
    }
    const dir = sort.asc ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (sort.key === "valor") return (Number(a.valor_documento ?? 0) - Number(b.valor_documento ?? 0)) * dir;
      if (sort.key === "contraparte") return (a.contraparte ?? "").localeCompare(b.contraparte ?? "") * dir;
      return (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999") * dir;
    });
    return rows;
  }, [data, q, statusSel, empresaSel, sort]);

  const totalFiltrado = useMemo(
    () => filtered.reduce((s, r) => s + (r.status_titulo === "CANCELADO" ? 0 : Number(r.valor_documento ?? 0)), 0),
    [filtered],
  );

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const r = data?.resumo;
  const label = tipo === "pagar" ? "Fornecedor" : "Cliente";
  const baixadoLabel = tipo === "pagar" ? "Pago" : "Recebido";
  const statusChips = modo === "aberto"
    ? ["ATRASADO", "VENCE HOJE", "A VENCER"]
    : modo === "todos" ? ["ATRASADO", "VENCE HOJE", "A VENCER", tipo === "pagar" ? "PAGO" : "RECEBIDO", "CANCELADO"] : [];

  return (
    <div className="space-y-3">
      {/* ── Resumo ── */}
      <div className="rounded-xl border border-ww-border bg-ww-panel px-4 py-3">
        {loading ? (
          <div className="h-[52px] flex items-center text-[12px] text-ww-textMuted">Carregando…</div>
        ) : err ? (
          <div className="text-[12px] text-rose-500">Erro ao carregar: {err}</div>
        ) : r && (
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            {modo === "aberto" ? (
              <>
                <StatCell label="Em aberto" agg={r.total} tone="text-ww-text" />
                <div className="w-px self-stretch bg-ww-border hidden sm:block" />
                <StatCell label="Vencido" agg={r.vencido} tone="text-rose-500" />
                <StatCell label="Vence hoje" agg={r.vence_hoje} tone="text-amber-500" />
                <StatCell label="Próx. 7 dias" agg={r.vence_7d} tone="text-amber-600" />
                <StatCell label="8–30 dias" agg={r.vence_30d} tone="text-sky-600" />
              </>
            ) : (
              <>
                <StatCell label={`Total no período`} agg={r.total} tone="text-ww-text" />
                <div className="w-px self-stretch bg-ww-border hidden sm:block" />
                <StatCell label={baixadoLabel} agg={r.baixado} tone="text-emerald-600" />
                <StatCell label="Vencido" agg={r.vencido} tone="text-rose-500" />
              </>
            )}
          </div>
        )}
        {!loading && !err && data && (
          <div className="mt-3 pt-3 border-t border-ww-border flex flex-wrap gap-6">
            <BreakdownCol titulo="Por categoria" items={data.breakdowns.categoria} />
            <BreakdownCol titulo={`Por ${label.toLowerCase()}`} items={data.breakdowns.contraparte} />
            <BreakdownCol titulo="Por projeto" items={data.breakdowns.projeto} />
          </div>
        )}
      </div>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setNovoAberto(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-ww-accent hover:opacity-90 shadow-sm transition">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Nova conta
        </button>
        <div className="inline-flex rounded-lg border border-ww-border overflow-hidden">
          {([["aberto", "Em aberto"], ["baixado", baixadoLabel + "s"], ["todos", "Todos"]] as const).map(([k, lbl]) => (
            <button key={k}
              onClick={() => { setModo(k); setStatusSel(""); }}
              className={`px-3 py-1.5 text-[12px] font-medium transition ${modo === k ? "bg-ww-accent text-white" : "text-ww-textMuted hover:bg-ww-rowHover"}`}>
              {lbl}
            </button>
          ))}
        </div>
        {modo !== "aberto" && (
          <div className="flex items-center gap-1 text-[12px] text-ww-textMuted">
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)}
              className="px-2 py-1 border border-ww-border rounded-md bg-ww-panel text-ww-text text-[12px]" />
            <span>→</span>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)}
              className="px-2 py-1 border border-ww-border rounded-md bg-ww-panel text-ww-text text-[12px]" />
          </div>
        )}
        <input
          value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }}
          placeholder={`Filtrar: ${label.toLowerCase()}, doc, NF, categoria, projeto…`}
          className="flex-1 min-w-[220px] px-3 py-1.5 border border-ww-border rounded-lg bg-ww-panel text-[12px] text-ww-text focus:outline-none focus:ring-2 focus:ring-ww-accent/40"
        />
        {empresas.length > 1 && (
          <div className="flex gap-1">
            <button onClick={() => setEmpresaSel("")}
              className={`px-2 py-1 text-[11px] font-medium rounded-md border ${empresaSel === "" ? "border-ww-accent text-ww-accent" : "border-ww-border text-ww-textMuted"}`}>Todas</button>
            {empresas.map((e) => (
              <button key={e} onClick={() => { setEmpresaSel(empresaSel === e ? "" : e); setPage(0); }}
                className={`px-2 py-1 text-[11px] font-medium rounded-md border ${empresaSel === e ? "border-ww-accent text-ww-accent" : "border-ww-border text-ww-textMuted"}`}>{e}</button>
            ))}
          </div>
        )}
        {statusChips.length > 0 && (
          <div className="flex gap-1">
            {statusChips.map((s) => (
              <button key={s} onClick={() => { setStatusSel(statusSel === s ? "" : s); setPage(0); }}
                className={`px-2 py-1 text-[11px] font-medium rounded-md border transition ${statusSel === s ? STATUS_META[s]?.cls ?? "" : "border-ww-border text-ww-textMuted hover:bg-ww-rowHover"}`}>
                {STATUS_META[s]?.label ?? s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Tabela ── */}
      <div className="rounded-xl border border-ww-border bg-ww-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-ww-border text-left text-[10px] uppercase tracking-wide text-ww-textFaint">
                <th className="px-3 py-2 cursor-pointer select-none whitespace-nowrap"
                    onClick={() => setSort((s) => ({ key: "vencimento", asc: s.key === "vencimento" ? !s.asc : true }))}>
                  Venc. {sort.key === "vencimento" ? (sort.asc ? "↑" : "↓") : ""}
                </th>
                <th className="px-3 py-2">Emp.</th>
                <th className="px-3 py-2 cursor-pointer select-none"
                    onClick={() => setSort((s) => ({ key: "contraparte", asc: s.key === "contraparte" ? !s.asc : true }))}>
                  {label} {sort.key === "contraparte" ? (sort.asc ? "↑" : "↓") : ""}
                </th>
                <th className="px-3 py-2">Doc / Parc</th>
                <th className="px-3 py-2">NF</th>
                <th className="px-3 py-2">Categoria</th>
                <th className="px-3 py-2">Projeto</th>
                <th className="px-3 py-2">Conta</th>
                <th className="px-3 py-2 text-right cursor-pointer select-none whitespace-nowrap"
                    onClick={() => setSort((s) => ({ key: "valor", asc: s.key === "valor" ? !s.asc : false }))}>
                  Valor {sort.key === "valor" ? (sort.asc ? "↑" : "↓") : ""}
                </th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-ww-textMuted">Carregando títulos…</td></tr>
              )}
              {!loading && pageRows.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-ww-textFaint">Nenhum título com esses filtros.</td></tr>
              )}
              {!loading && pageRows.map((row) => {
                const meta = STATUS_META[row.status_titulo ?? ""] ?? { label: row.status_titulo ?? "—", cls: "border-ww-border text-ww-textMuted" };
                return (
                  <tr key={`${row.empresa}-${row.codigo_lancamento_omie}`}
                      className="border-b border-ww-border/60 hover:bg-ww-rowHover/60 transition-colors"
                      title={row.observacao ?? undefined}>
                    <td className="px-3 py-1.5 whitespace-nowrap font-medium text-ww-text">{dataBR(row.vencimento)}</td>
                    <td className="px-3 py-1.5 text-ww-textFaint">{row.empresa}</td>
                    <td className="px-3 py-1.5 max-w-[260px] truncate font-medium text-ww-text" title={row.contraparte ?? undefined}>
                      {row.contraparte ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-ww-textMuted">
                      {row.numero_documento ?? "—"}{row.numero_parcela ? ` · ${row.numero_parcela}` : ""}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-ww-textMuted">{row.numero_documento_fiscal ?? "—"}</td>
                    <td className="px-3 py-1.5 max-w-[180px] truncate text-ww-textMuted" title={row.categoria ?? undefined}>{row.categoria ?? "—"}</td>
                    <td className="px-3 py-1.5 max-w-[160px] truncate text-ww-textMuted" title={row.projeto ?? undefined}>{row.projeto ?? "—"}</td>
                    <td className="px-3 py-1.5 max-w-[140px] truncate text-ww-textFaint" title={row.conta_corrente ?? undefined}>{row.conta_corrente ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-ww-text whitespace-nowrap">{money(row.valor_documento)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap ${meta.cls}`}>{meta.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Rodapé */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-ww-border text-[11px] text-ww-textMuted">
          <span>
            {filtered.length} título(s) · <span className="font-semibold text-ww-text">{money(totalFiltrado)}</span>
            {data?.truncated ? " · lista truncada em 30 mil linhas" : ""}
          </span>
          {pages > 1 && (
            <span className="flex items-center gap-2">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
                className="px-2 py-0.5 rounded border border-ww-border disabled:opacity-30 hover:bg-ww-rowHover">‹</button>
              pág. {page + 1} / {pages}
              <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}
                className="px-2 py-0.5 rounded border border-ww-border disabled:opacity-30 hover:bg-ww-rowHover">›</button>
            </span>
          )}
        </div>
      </div>

      {novoAberto && (
        <NovoTituloModal
          tipo={tipo}
          onClose={() => setNovoAberto(false)}
          onCreated={() => setRefresh((n) => n + 1)}
        />
      )}
    </div>
  );
}
