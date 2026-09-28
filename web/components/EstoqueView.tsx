"use client";

// Estoque — posição atual + movimentação (Kardex), dados do Omie via
// estoque.posicao/movimentos. Clicar num produto da posição abre o Kardex dele.

import { useEffect, useMemo, useState } from "react";

type PosRow = {
  empresa: string; n_cod_prod: number; codigo_local_estoque: number;
  codigo: string | null; descricao: string | null;
  saldo: number | string | null; fisico: number | string | null;
  reservado: number | string | null; pendente: number | string | null;
  cmc: number | string | null; preco_unitario: number | string | null;
  estoque_minimo: number | string | null; data_posicao: string | null;
};
type MovRow = {
  empresa: string; id_mov: number; id_prod: number | null;
  dt_mov: string | null; des_origem: string | null; operacao: string | null;
  tipo: string | null; num_doc: string | null; num_pedido: string | null;
  qtde: number | string | null; valor: number | string | null;
  saldo: number | string | null; cmc: number | string | null;
  descricao: string | null; cancelamento: string | null;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const money = (v: number | string | null) => BRL.format(Number(v ?? 0));
const num = (v: number | string | null) => NUM.format(Number(v ?? 0));
function dataBR(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}
function diasAtras(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}
const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

const PAGE_SIZE = 100;

export default function EstoqueView() {
  const [aba, setAba] = useState<"posicao" | "movimentos">("posicao");
  const [pos, setPos] = useState<PosRow[]>([]);
  const [movs, setMovs] = useState<MovRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [soComSaldo, setSoComSaldo] = useState(true);
  const [page, setPage] = useState(0);
  const [de, setDe] = useState(diasAtras(30));
  const [ate, setAte] = useState(hojeISO());
  const [tipoSel, setTipoSel] = useState("");

  // Kardex do produto selecionado
  const [kardexDe, setKardexDe] = useState<PosRow | null>(null);
  const [kardexRows, setKardexRows] = useState<MovRow[] | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true); setErr(null);
      try {
        const params = aba === "posicao"
          ? new URLSearchParams({ view: "posicao" })
          : new URLSearchParams({ view: "movimentos", de, ate });
        const r = await fetch(`/api/estoque?${params}`, { signal: ctrl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        if (aba === "posicao") setPos(j.rows as PosRow[]);
        else setMovs(j.rows as MovRow[]);
        setPage(0);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr((e as Error).message);
      } finally { setLoading(false); }
    })();
    return () => ctrl.abort();
  }, [aba, de, ate]);

  useEffect(() => {
    if (!kardexDe) { setKardexRows(null); return; }
    (async () => {
      setKardexRows(null);
      try {
        const r = await fetch(`/api/estoque?view=movimentos&produto=${kardexDe.n_cod_prod}`);
        const j = await r.json();
        if (r.ok) setKardexRows(j.rows as MovRow[]);
      } catch { setKardexRows([]); }
    })();
  }, [kardexDe]);

  const posFiltrada = useMemo(() => {
    let rows = pos;
    if (soComSaldo) rows = rows.filter((r) => Number(r.saldo ?? 0) !== 0);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((r) =>
        (r.descricao ?? "").toLowerCase().includes(needle) ||
        (r.codigo ?? "").toLowerCase().includes(needle));
    }
    return rows;
  }, [pos, q, soComSaldo]);

  const movFiltrados = useMemo(() => {
    let rows = movs;
    if (tipoSel) rows = rows.filter((r) => (r.tipo ?? "") === tipoSel);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      rows = rows.filter((r) =>
        (r.descricao ?? "").toLowerCase().includes(needle) ||
        (r.num_doc ?? "").toLowerCase().includes(needle) ||
        (r.des_origem ?? "").toLowerCase().includes(needle) ||
        (r.num_pedido ?? "").toLowerCase().includes(needle));
    }
    return rows;
  }, [movs, q, tipoSel]);

  const resumoPos = useMemo(() => {
    const comSaldo = pos.filter((r) => Number(r.saldo ?? 0) !== 0);
    const valor = comSaldo.reduce((s, r) => s + Number(r.saldo ?? 0) * Number(r.cmc ?? 0), 0);
    const reservado = pos.reduce((s, r) => s + Number(r.reservado ?? 0), 0);
    const abaixoMin = pos.filter((r) =>
      Number(r.estoque_minimo ?? 0) > 0 && Number(r.saldo ?? 0) < Number(r.estoque_minimo ?? 0)).length;
    const dataPos = pos[0]?.data_posicao ?? null;
    return { itens: comSaldo.length, valor, reservado, abaixoMin, dataPos };
  }, [pos]);

  const listaAtiva = aba === "posicao" ? posFiltrada : movFiltrados;
  const pages = Math.max(1, Math.ceil(listaAtiva.length / PAGE_SIZE));
  const thCls = "px-3 py-2 text-left text-[10px] uppercase tracking-wide text-ww-textFaint";
  const tdCls = "px-3 py-1.5";

  return (
    <div className="space-y-3">
      {/* Resumo (posição) */}
      {aba === "posicao" && !loading && !err && (
        <div className="rounded-xl border border-ww-border bg-ww-panel px-4 py-3 flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint">Valor do estoque (CMC)</div>
            <div className="text-[19px] font-bold tracking-[-0.5px] text-ww-text">{money(resumoPos.valor)}</div>
            <div className="text-[11px] text-ww-textMuted">{resumoPos.itens} itens com saldo{resumoPos.dataPos ? ` · posição ${dataBR(resumoPos.dataPos)}` : ""}</div>
          </div>
          <div className="w-px self-stretch bg-ww-border hidden sm:block" />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint">Reservado</div>
            <div className="text-[19px] font-bold tracking-[-0.5px] text-amber-600">{num(resumoPos.reservado)}</div>
            <div className="text-[11px] text-ww-textMuted">unidades</div>
          </div>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint">Abaixo do mínimo</div>
            <div className={`text-[19px] font-bold tracking-[-0.5px] ${resumoPos.abaixoMin ? "text-rose-500" : "text-emerald-600"}`}>{resumoPos.abaixoMin}</div>
            <div className="text-[11px] text-ww-textMuted">produtos</div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-ww-border overflow-hidden">
          {([["posicao", "Posição"], ["movimentos", "Movimentação"]] as const).map(([k, lbl]) => (
            <button key={k} onClick={() => { setAba(k); setQ(""); setPage(0); }}
              className={`px-3 py-1.5 text-[12px] font-medium transition ${aba === k ? "bg-ww-accent text-white" : "text-ww-textMuted hover:bg-ww-rowHover"}`}>
              {lbl}
            </button>
          ))}
        </div>
        {aba === "movimentos" && (
          <>
            <div className="flex items-center gap-1 text-[12px] text-ww-textMuted">
              <input type="date" value={de} onChange={(e) => setDe(e.target.value)}
                className="px-2 py-1 border border-ww-border rounded-md bg-ww-panel text-ww-text text-[12px]" />
              <span>→</span>
              <input type="date" value={ate} onChange={(e) => setAte(e.target.value)}
                className="px-2 py-1 border border-ww-border rounded-md bg-ww-panel text-ww-text text-[12px]" />
            </div>
            <div className="flex gap-1">
              {["entrada", "saida"].map((t) => (
                <button key={t} onClick={() => { setTipoSel(tipoSel === t ? "" : t); setPage(0); }}
                  className={`px-2 py-1 text-[11px] font-medium rounded-md border capitalize ${tipoSel === t
                    ? (t === "entrada" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" : "bg-rose-500/15 text-rose-500 border-rose-500/30")
                    : "border-ww-border text-ww-textMuted hover:bg-ww-rowHover"}`}>
                  {t}
                </button>
              ))}
            </div>
          </>
        )}
        {aba === "posicao" && (
          <button onClick={() => { setSoComSaldo(!soComSaldo); setPage(0); }}
            className={`px-2 py-1 text-[11px] font-medium rounded-md border ${soComSaldo ? "border-ww-accent text-ww-accent" : "border-ww-border text-ww-textMuted"}`}>
            {soComSaldo ? "Com saldo" : "Todos"}
          </button>
        )}
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }}
          placeholder={aba === "posicao" ? "Filtrar: código, descrição…" : "Filtrar: produto, doc, origem…"}
          className="flex-1 min-w-[220px] px-3 py-1.5 border border-ww-border rounded-lg bg-ww-panel text-[12px] text-ww-text focus:outline-none focus:ring-2 focus:ring-ww-accent/40" />
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-ww-border bg-ww-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            {aba === "posicao" ? (
              <>
                <thead>
                  <tr className="border-b border-ww-border">
                    <th className={thCls}>Código</th><th className={thCls}>Descrição</th>
                    <th className={`${thCls} text-right`}>Saldo</th>
                    <th className={`${thCls} text-right`}>Reserv.</th>
                    <th className={`${thCls} text-right`}>Pend.</th>
                    <th className={`${thCls} text-right`}>Mín.</th>
                    <th className={`${thCls} text-right`}>CMC</th>
                    <th className={`${thCls} text-right`}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-ww-textMuted">Carregando posição…</td></tr>}
                  {!loading && err && <tr><td colSpan={8} className="px-3 py-8 text-center text-rose-500">Erro: {err}</td></tr>}
                  {!loading && !err && posFiltrada.length === 0 &&
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-ww-textFaint">Nada com esses filtros.</td></tr>}
                  {!loading && posFiltrada.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((r) => {
                    const abaixo = Number(r.estoque_minimo ?? 0) > 0 && Number(r.saldo ?? 0) < Number(r.estoque_minimo ?? 0);
                    return (
                      <tr key={`${r.empresa}-${r.n_cod_prod}-${r.codigo_local_estoque}`}
                          onClick={() => setKardexDe(r)}
                          className="border-b border-ww-border/60 hover:bg-ww-rowHover/60 cursor-pointer transition-colors">
                        <td className={`${tdCls} whitespace-nowrap text-ww-textMuted`}>{r.codigo ?? r.n_cod_prod}</td>
                        <td className={`${tdCls} max-w-[420px] truncate font-medium text-ww-text`} title={r.descricao ?? undefined}>{r.descricao ?? "—"}</td>
                        <td className={`${tdCls} text-right font-semibold ${Number(r.saldo ?? 0) < 0 ? "text-rose-500" : "text-ww-text"}`}>{num(r.saldo)}</td>
                        <td className={`${tdCls} text-right text-ww-textMuted`}>{num(r.reservado)}</td>
                        <td className={`${tdCls} text-right text-ww-textMuted`}>{num(r.pendente)}</td>
                        <td className={`${tdCls} text-right ${abaixo ? "text-rose-500 font-semibold" : "text-ww-textFaint"}`}>{num(r.estoque_minimo)}</td>
                        <td className={`${tdCls} text-right text-ww-textMuted whitespace-nowrap`}>{money(r.cmc)}</td>
                        <td className={`${tdCls} text-right font-semibold text-ww-text whitespace-nowrap`}>{money(Number(r.saldo ?? 0) * Number(r.cmc ?? 0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            ) : (
              <>
                <thead>
                  <tr className="border-b border-ww-border">
                    <th className={thCls}>Data</th><th className={thCls}>Produto</th>
                    <th className={thCls}>Origem</th><th className={thCls}>Doc</th>
                    <th className={`${thCls} text-right`}>Qtde</th>
                    <th className={`${thCls} text-right`}>Valor</th>
                    <th className={`${thCls} text-right`}>Saldo</th>
                    <th className={thCls}>Tipo</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-ww-textMuted">Carregando movimentos…</td></tr>}
                  {!loading && err && <tr><td colSpan={8} className="px-3 py-8 text-center text-rose-500">Erro: {err}</td></tr>}
                  {!loading && !err && movFiltrados.length === 0 &&
                    <tr><td colSpan={8} className="px-3 py-8 text-center text-ww-textFaint">Nenhum movimento no período.</td></tr>}
                  {!loading && movFiltrados.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((r) => (
                    <tr key={`${r.empresa}-${r.id_mov}`}
                        className={`border-b border-ww-border/60 hover:bg-ww-rowHover/60 transition-colors ${r.cancelamento === "S" ? "opacity-40 line-through" : ""}`}>
                      <td className={`${tdCls} whitespace-nowrap font-medium text-ww-text`}>{dataBR(r.dt_mov)}</td>
                      <td className={`${tdCls} max-w-[340px] truncate text-ww-text`} title={r.descricao ?? undefined}>{r.descricao ?? r.id_prod}</td>
                      <td className={`${tdCls} max-w-[180px] truncate text-ww-textMuted`} title={r.des_origem ?? undefined}>{r.des_origem ?? "—"}</td>
                      <td className={`${tdCls} whitespace-nowrap text-ww-textMuted`}>{r.num_doc ?? r.num_pedido ?? "—"}</td>
                      <td className={`${tdCls} text-right font-semibold ${r.tipo === "saida" ? "text-rose-500" : "text-emerald-600"}`}>
                        {r.tipo === "saida" ? "−" : "+"}{num(r.qtde)}
                      </td>
                      <td className={`${tdCls} text-right text-ww-textMuted whitespace-nowrap`}>{money(r.valor)}</td>
                      <td className={`${tdCls} text-right text-ww-text`}>{num(r.saldo)}</td>
                      <td className={tdCls}>
                        <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold capitalize ${r.tipo === "saida"
                          ? "bg-rose-500/15 text-rose-500 border-rose-500/30" : "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"}`}>
                          {r.tipo ?? "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-ww-border text-[11px] text-ww-textMuted">
          <span>{listaAtiva.length} linha(s)</span>
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

      {/* Kardex drawer */}
      {kardexDe && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setKardexDe(null)}>
          <div onClick={(e) => e.stopPropagation()}
               className="bg-ww-panel border border-ww-border rounded-xl shadow-2xl max-w-3xl w-full p-5 space-y-3 max-h-[88vh] flex flex-col">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-ww-text text-[14px]">Kardex — {kardexDe.descricao ?? kardexDe.n_cod_prod}</h3>
                <p className="text-[11px] text-ww-textMuted mt-0.5">
                  Saldo atual {num(kardexDe.saldo)} · CMC {money(kardexDe.cmc)}
                </p>
              </div>
              <button onClick={() => setKardexDe(null)} className="text-ww-textFaint hover:text-ww-text text-xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto border border-ww-border rounded-lg">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-ww-border sticky top-0 bg-ww-panel">
                    <th className={thCls}>Data</th><th className={thCls}>Origem</th><th className={thCls}>Doc</th>
                    <th className={`${thCls} text-right`}>Qtde</th>
                    <th className={`${thCls} text-right`}>Valor</th>
                    <th className={`${thCls} text-right`}>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {kardexRows === null && <tr><td colSpan={6} className="px-3 py-6 text-center text-ww-textMuted">Carregando…</td></tr>}
                  {kardexRows?.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-ww-textFaint">Sem movimentos sincronizados.</td></tr>}
                  {kardexRows?.map((r) => (
                    <tr key={r.id_mov} className={`border-b border-ww-border/60 ${r.cancelamento === "S" ? "opacity-40 line-through" : ""}`}>
                      <td className={`${tdCls} whitespace-nowrap`}>{dataBR(r.dt_mov)}</td>
                      <td className={`${tdCls} max-w-[220px] truncate text-ww-textMuted`} title={r.des_origem ?? undefined}>{r.des_origem ?? "—"}</td>
                      <td className={`${tdCls} whitespace-nowrap text-ww-textMuted`}>{r.num_doc ?? r.num_pedido ?? "—"}</td>
                      <td className={`${tdCls} text-right font-semibold ${r.tipo === "saida" ? "text-rose-500" : "text-emerald-600"}`}>
                        {r.tipo === "saida" ? "−" : "+"}{num(r.qtde)}
                      </td>
                      <td className={`${tdCls} text-right text-ww-textMuted whitespace-nowrap`}>{money(r.valor)}</td>
                      <td className={`${tdCls} text-right`}>{num(r.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
