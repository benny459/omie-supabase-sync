"use client";

// Módulos ERP · Omie — Vendas (PV/OS) e Compras (PC/RC), espelho completo.
// Todos os campos das views ficam disponíveis no controle "Colunas" (o Benny
// vai redesenhar em cima); um conjunto enxuto vem ligado por default e a
// escolha fica no localStorage, por módulo. Clique na linha abre os itens.

import { useEffect, useMemo, useState } from "react";
import { ehNativo, idDoCodigo } from "@/lib/vendas";
import { TblFit } from "./TabelaFit";
import { OcAnexosPainel } from "@/components/vendas/OcAnexos";
/** 09/10/26: colunas que somem primeiro quando a tabela estreita (.tbl-fit). */
const PRIO: Record<string, string> = {
  previsao: "tf-p3", categoria: "tf-p3", contato: "tf-p3", cnpj_cpf: "tf-p3", cliente_cidade: "tf-p3", cliente_uf: "tf-p3", codigo_vendedor: "tf-p3",
  codigo_parcela: "tf-p3", numero_contrato: "tf-p3", natureza_operacao: "tf-p3", chave_nfe: "tf-p3", dt_registro: "tf-p3", serie: "tf-p3",
  projeto: "tf-p1", empresa: "tf-p2", qtd_itens: "tf-p2", valor_mercadorias: "tf-p2", valor_desconto: "tf-p2", valor_frete: "tf-p2", dt_fat: "tf-p2",
  qtd_parcelas: "tf-p2", num_pedido_cliente: "tf-p2", total_produtos: "tf-p2", vlr_frete: "tf-p2", vlr_icms: "tf-p2", vlr_ipi: "tf-p2",
};

type Row = Record<string, unknown>;
type Item = {
  codigo_produto?: string | number | null; descricao?: string | null; unidade?: string | null;
  quantidade?: number | string | null; valor_unitario?: number | string | null;
  valor_total?: number | string | null; qtd_recebida?: number | string | null; ncm?: string | null;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const money = (v: unknown) => BRL.format(Number(v ?? 0));
const num = (v: unknown) => NUM.format(Number(v ?? 0));
function dataBR(iso: unknown): string {
  if (!iso || typeof iso !== "string") return "—";
  const [y, m, d] = iso.split("-");
  return d ? `${d}/${m}/${y.slice(2)}` : "—";
}
const texto = (v: unknown) => (v == null || v === "" ? "—" : String(v));
const hojeISO = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

type Col = {
  key: string; label: string; on?: boolean; align?: "right";
  render?: (r: Row) => React.ReactNode; largura?: string;
};

const COLS_VENDAS: Col[] = [
  { key: "label", label: "Nº", on: true, render: r => <span className="font-semibold">{texto(r.label)}</span> },
  { key: "empresa", label: "Emp." },
  { key: "cliente", label: "Cliente", on: true, largura: "max-w-[260px]" },
  { key: "cnpj_cpf", label: "CNPJ" },
  { key: "cliente_cidade", label: "Cidade" },
  { key: "cliente_uf", label: "UF" },
  { key: "projeto", label: "Projeto", on: true, largura: "max-w-[170px]" },
  { key: "emissao", label: "Emissão", on: true, render: r => dataBR(r.emissao) },
  { key: "previsao", label: "Previsão", on: true, render: r => dataBR(r.previsao) },
  { key: "valor_total", label: "Valor", on: true, align: "right", render: r => <span className="font-semibold">{money(r.valor_total)}</span> },
  { key: "qtd_itens", label: "Itens", align: "right", render: r => num(r.qtd_itens) },
  { key: "valor_mercadorias", label: "Mercadorias", align: "right", render: r => Number(r.valor_mercadorias ?? 0) ? money(r.valor_mercadorias) : "—" },
  { key: "valor_desconto", label: "Desconto", align: "right", render: r => Number(r.valor_desconto ?? 0) ? money(r.valor_desconto) : "—" },
  { key: "valor_frete", label: "Frete", align: "right", render: r => Number(r.valor_frete ?? 0) ? money(r.valor_frete) : "—" },
  { key: "etapa_desc", label: "Etapa", on: true, render: r => texto(r.etapa_desc ?? r.etapa) },
  { key: "dt_fat", label: "Faturado em", render: r => dataBR(r.dt_fat) },
  { key: "nf", label: "NF / Recibo", on: true },
  { key: "categoria", label: "Categoria", largura: "max-w-[170px]" },
  { key: "numero_contrato", label: "Contrato" },
  { key: "qtd_parcelas", label: "Parc.", align: "right", render: r => Number(r.qtd_parcelas ?? 0) ? num(r.qtd_parcelas) : "—" },
  { key: "codigo_parcela", label: "Cond. pgto" },
  { key: "num_pedido_cliente", label: "Ped. cliente" },
  { key: "contato", label: "Contato", largura: "max-w-[140px]" },
  { key: "codigo_vendedor", label: "Vendedor (cód.)" },
];

const COLS_NF_ENTRADA: Col[] = [
  { key: "numero", label: "NF", on: true, render: r => <span className="font-semibold">{texto(r.numero)}</span> },
  { key: "serie", label: "Série" },
  { key: "empresa", label: "Emp." },
  { key: "status", label: "Status", on: true },
  { key: "fornecedor", label: "Fornecedor", on: true, largura: "max-w-[240px]" },
  { key: "cnpj_cpf", label: "CNPJ" },
  { key: "emissao", label: "Emissão", on: true, render: r => dataBR(r.emissao) },
  { key: "dt_recebimento", label: "Recebida em", on: true, render: r => dataBR(r.dt_recebimento) },
  { key: "dt_registro", label: "Registrada em", render: r => dataBR(r.dt_registro) },
  { key: "valor_total", label: "Valor", on: true, align: "right", render: r => <span className="font-semibold">{money(r.valor_total)}</span> },
  { key: "total_produtos", label: "Produtos", align: "right", render: r => Number(r.total_produtos ?? 0) ? money(r.total_produtos) : "—" },
  { key: "vlr_frete", label: "Frete", align: "right", render: r => Number(r.vlr_frete ?? 0) ? money(r.vlr_frete) : "—" },
  { key: "vlr_icms", label: "ICMS", align: "right", render: r => Number(r.vlr_icms ?? 0) ? money(r.vlr_icms) : "—" },
  { key: "vlr_ipi", label: "IPI", align: "right", render: r => Number(r.vlr_ipi ?? 0) ? money(r.vlr_ipi) : "—" },
  { key: "pc_numero", label: "PC", on: true },
  { key: "projeto", label: "Projeto", on: true, largura: "max-w-[170px]" },
  { key: "categoria", label: "Categoria", largura: "max-w-[170px]" },
  { key: "natureza_operacao", label: "Natureza", largura: "max-w-[200px]" },
  { key: "chave_nfe", label: "Chave", largura: "max-w-[160px]" },
];

const COLS_COMPRAS: Col[] = [
  { key: "numero", label: "Nº", on: true, render: r => <span className="font-semibold">{texto(r.numero)}</span> },
  { key: "empresa", label: "Emp." },
  { key: "etapa_desc", label: "Etapa", on: true, render: r => texto(r.etapa_desc ?? r.etapa) },
  { key: "fornecedor", label: "Fornecedor", on: true, largura: "max-w-[240px]" },
  { key: "projeto", label: "Projeto", on: true, largura: "max-w-[170px]" },
  { key: "emissao", label: "Emissão", on: true, render: r => dataBR(r.emissao) },
  { key: "previsao", label: "Previsão", on: true, render: r => dataBR(r.previsao) },
  { key: "valor_total", label: "Valor", on: true, align: "right", render: r => <span className="font-semibold">{money(r.valor_total)}</span> },
  { key: "qtd_itens", label: "Itens", align: "right", render: r => num(r.qtd_itens) },
  { key: "pv_os_vinculado", label: "PV/OS", on: true,
    render: r => r.pv_os_vinculado
      ? <span title={`vínculo por ${r.vinculo_metodo}`}>{texto(r.pv_os_vinculado)}{r.vinculo_metodo === "triangulacao" ? " ⚙" : ""}</span>
      : texto(r.pv_origem) },
  { key: "recebido", label: "Recebido", render: r => r.recebido ? "✓" : "—" },
  { key: "dt_recebimento", label: "Recebido em", render: r => dataBR(r.dt_recebimento) },
  { key: "numero_nf", label: "NF entrada" },
  { key: "categoria", label: "Categoria", largura: "max-w-[170px]" },
  { key: "cobs_int", label: "Obs. interna", largura: "max-w-[220px]" },
];

const PAGE_SIZE = 100;

export default function ErpListaView({ modulo }: { modulo: "vendas" | "compras" }) {
  const [aba, setAbaRaw] = useState<string>(modulo === "vendas" ? "abertos" : "rcs");
  const emNf = modulo === "compras" && aba === "nfs";
  const cols = emNf ? COLS_NF_ENTRADA : modulo === "vendas" ? COLS_VENDAS : COLS_COMPRAS;
  const lsKey = `erp-cols-${modulo}${emNf ? "-nf" : ""}`;

  const [rows, setRows] = useState<Row[]>([]);
  const [rowsNf, setRowsNf] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const setAba = (k: string) => { setAbaRaw(k); setEtapaSel(""); };
  const [tipoSel, setTipoSel] = useState("");
  const [empresaSel, setEmpresaSel] = useState("");
  const [page, setPage] = useState(0);
  const [colsOn, setColsOn] = useState<string[]>(() => cols.filter(c => c.on).map(c => c.key));
  const [colsOnNf, setColsOnNf] = useState<string[]>(() => COLS_NF_ENTRADA.filter(c => c.on).map(c => c.key));
  const [colsAberto, setColsAberto] = useState(false);
  const [drawer, setDrawer] = useState<Row | null>(null);
  const [itens, setItens] = useState<Item[] | null>(null);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(lsKey) ?? "null");
      if (Array.isArray(v) && v.length) {
        const filtrado = v.filter((k: string) => cols.some(c => c.key === k));
        (emNf ? setColsOnNf : setColsOn)(filtrado);
      }
    } catch { /* default */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lsKey]);
  const salvarCols = (next: string[]) => {
    setColsAtuais(next);
    try { localStorage.setItem(lsKey, JSON.stringify(next)); } catch { /* sem storage */ }
  };

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setLoading(true); setErr(null);
      try {
        const r = await fetch(`/api/erp/lista?view=${modulo}`, { signal: ctrl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setRows(j.rows as Row[]);
        setPage(0);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErr((e as Error).message);
      } finally { setLoading(false); }
    })();
    return () => ctrl.abort();
  }, [modulo]);

  // NFs de entrada: busca uma vez, quando a aba abre pela primeira vez.
  useEffect(() => {
    if (!emNf || rowsNf !== null) return;
    (async () => {
      try {
        const r = await fetch(`/api/erp/lista?view=nfentrada`);
        const j = await r.json();
        setRowsNf(r.ok ? (j.rows as Row[]) : []);
      } catch { setRowsNf([]); }
    })();
  }, [emNf, rowsNf]);

  useEffect(() => {
    if (!drawer) { setItens(null); return; }
    (async () => {
      setItens(null);
      const tipo = modulo === "compras" ? "PC" : String(drawer.tipo);
      const chave = modulo === "compras" ? String(drawer.ncod_ped) : String(drawer.numero);
      try {
        const r = await fetch(`/api/erp/itens?tipo=${tipo}&empresa=${drawer.empresa}&chave=${encodeURIComponent(chave)}`);
        const j = await r.json();
        setItens(r.ok ? (j.itens as Item[]) : []);
      } catch { setItens([]); }
    })();
  }, [drawer, modulo]);

  const base = emNf ? (rowsNf ?? []) : rows;
  const empresas = useMemo(() => [...new Set(base.map(r => String(r.empresa)))].sort(), [base]);
  const [etapaSel, setEtapaSel] = useState("");
  const etapas = useMemo(() => {
    const m = new Map<string, string>();
    base.forEach(r => {
      if (emNf) m.set(String(r.status ?? ""), String(r.status ?? ""));
      else m.set(String(r.etapa ?? ""), String(r.etapa_desc ?? r.etapa ?? ""));
    });
    return [...m.entries()].sort();
  }, [base, emNf]);

  const filtrados = useMemo(() => {
    let out = base;
    if (emNf) {
      if (etapaSel) out = out.filter(r => String(r.status ?? "") === etapaSel);
    } else if (modulo === "vendas") {
      if (aba === "abertos") out = out.filter(r => !r.faturado && !r.cancelado);
      if (aba === "faturados") out = out.filter(r => !!r.faturado);
      if (tipoSel) out = out.filter(r => r.tipo === tipoSel);
      if (etapaSel) out = out.filter(r => String(r.etapa ?? "") === etapaSel);
    } else {
      if (aba === "rcs") out = out.filter(r => !!r.eh_requisicao);
      if (aba === "pedidos") out = out.filter(r => !r.eh_requisicao);
      if (etapaSel) out = out.filter(r => String(r.etapa ?? "") === etapaSel);
    }
    if (empresaSel) out = out.filter(r => r.empresa === empresaSel);
    if (q.trim()) {
      const t = q.trim().toLowerCase();
      out = out.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(t)));
    }
    return out;
  }, [base, emNf, modulo, aba, tipoSel, empresaSel, etapaSel, q]);

  const resumo = useMemo(() => {
    const mes = hojeISO().slice(0, 7);
    if (emNf) {
      const nfs = rowsNf ?? [];
      const receb = nfs.filter(r => !!r.recebida && !r.cancelada);
      const recMes = receb.filter(r => String(r.dt_recebimento ?? "").startsWith(mes));
      const pend = nfs.filter(r => !r.recebida && !r.cancelada);
      return [
        { label: "NFs recebidas", valor: receb.reduce((s, r) => s + Number(r.valor_total ?? 0), 0), qtd: receb.length, tone: "text-emerald-600" },
        { label: "Recebidas no mês", valor: recMes.reduce((s, r) => s + Number(r.valor_total ?? 0), 0), qtd: recMes.length, tone: "text-sky-600" },
        { label: "Pendentes", valor: pend.reduce((s, r) => s + Number(r.valor_total ?? 0), 0), qtd: pend.length, tone: "text-amber-600" },
      ];
    }
    if (modulo === "vendas") {
      const abertos = rows.filter(r => !r.faturado && !r.cancelado);
      const fatMes = rows.filter(r => String(r.dt_fat ?? "").startsWith(mes));
      return [
        { label: "Em aberto", valor: abertos.reduce((s, r) => s + Number(r.valor_total ?? 0), 0), qtd: abertos.length, tone: "text-sky-600" },
        { label: "Faturado no mês", valor: fatMes.reduce((s, r) => s + Number(r.valor_total ?? 0), 0), qtd: fatMes.length, tone: "text-emerald-600" },
        { label: "Total de documentos", valor: rows.reduce((s, r) => s + Number(r.valor_total ?? 0), 0), qtd: rows.length, tone: "text-ww-text" },
      ];
    }
    const rcs = rows.filter(r => !!r.eh_requisicao);
    const aReceber = rows.filter(r => !r.eh_requisicao && !r.recebido);
    const recMes = rows.filter(r => String(r.dt_recebimento ?? "").startsWith(mes));
    return [
      { label: "RCs / em compra", valor: rcs.reduce((s, r) => s + Number(r.valor_total ?? 0), 0), qtd: rcs.length, tone: "text-amber-600" },
      { label: "A receber", valor: aReceber.reduce((s, r) => s + Number(r.valor_total ?? 0), 0), qtd: aReceber.length, tone: "text-sky-600" },
      { label: "Recebido no mês", valor: recMes.reduce((s, r) => s + Number(r.valor_total ?? 0), 0), qtd: recMes.length, tone: "text-emerald-600" },
    ];
  }, [rows, rowsNf, emNf, modulo]);

  const colsAtuais = emNf ? colsOnNf : colsOn;
  const setColsAtuais = emNf ? setColsOnNf : setColsOn;
  const ativas = cols.filter(c => colsAtuais.includes(c.key));
  const pages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const totalFiltrado = filtrados.reduce((s, r) => s + Number(r.valor_total ?? 0), 0);
  const abas = modulo === "vendas"
    ? [["abertos", "Em aberto"], ["faturados", "Faturados"], ["todos", "Todos"]]
    : [["rcs", "RCs / em compra"], ["pedidos", "Pedidos"], ["nfs", "NF de entrada"], ["todos", "Todos"]];

  return (
    <div className="space-y-3">
      {/* Resumo */}
      <div className="rounded-xl border border-ww-border bg-ww-panel px-4 py-3 flex flex-wrap gap-x-8 gap-y-3">
        {loading ? <div className="h-[46px] flex items-center text-[12px] text-ww-textMuted">Carregando…</div>
        : err ? <div className="text-[12px] text-rose-500">Erro: {err}</div>
        : resumo.map(s => (
          <div key={s.label} className="min-w-[150px]">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint">{s.label}</div>
            <div className={`text-[19px] font-bold tracking-[-0.5px] ${s.tone}`}>{money(s.valor)}</div>
            <div className="text-[11px] text-ww-textMuted">{s.qtd} doc(s)</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* 09/10/26: a busca vem sempre primeiro, à esquerda (regra do painel) */}
        <input value={q} onChange={e => { setQ(e.target.value); setPage(0); }}
          placeholder="Buscar nº, cliente, projeto, NF… (qualquer campo)"
          className="w-[320px] max-w-full h-8 px-3 border border-ww-borderStrong rounded-lg bg-ww-panel text-[13px] text-ww-text focus:outline-none focus:ring-2 focus:ring-ww-accent/40" />
        <div className="inline-flex rounded-lg border border-ww-border overflow-hidden">
          {abas.map(([k, lbl]) => (
            <button key={k} onClick={() => { setAba(k); setPage(0); }}
              className={`px-3 py-1.5 text-[12px] font-medium transition ${aba === k ? "bg-ww-accent text-white" : "text-ww-textMuted hover:bg-ww-rowHover"}`}>
              {lbl}
            </button>
          ))}
        </div>
        {modulo === "vendas" && (
          <div className="flex gap-1">
            {["PV", "OS"].map(t => (
              <button key={t} onClick={() => { setTipoSel(tipoSel === t ? "" : t); setPage(0); }}
                className={`px-2 py-1 text-[11px] font-medium rounded-md border ${tipoSel === t ? "border-ww-accent text-ww-accent" : "border-ww-border text-ww-textMuted"}`}>{t}</button>
            ))}
          </div>
        )}
        <select value={etapaSel} onChange={e => { setEtapaSel(e.target.value); setPage(0); }}
          className="px-2 py-1.5 border border-ww-border rounded-md bg-ww-panel text-[12px] text-ww-textMuted">
          <option value="">Todas as etapas</option>
          {etapas.map(([cod, desc]) => <option key={cod} value={cod}>{cod} · {desc}</option>)}
        </select>
        {empresas.length > 1 && (
          <div className="flex gap-1">
            {empresas.map(e => (
              <button key={e} onClick={() => { setEmpresaSel(empresaSel === e ? "" : e); setPage(0); }}
                className={`px-2 py-1 text-[11px] font-medium rounded-md border ${empresaSel === e ? "border-ww-accent text-ww-accent" : "border-ww-border text-ww-textMuted"}`}>{e}</button>
            ))}
          </div>
        )}
        <div className="relative">
          <button onClick={() => setColsAberto(!colsAberto)}
            className="px-2.5 py-1.5 text-[11px] font-medium rounded-md border border-ww-border text-ww-textMuted hover:bg-ww-rowHover">
            Colunas ({ativas.length}/{cols.length})
          </button>
          {colsAberto && (
            <div className="absolute right-0 z-30 mt-1 w-60 max-h-72 overflow-y-auto rounded-lg border border-ww-border bg-ww-panel shadow-xl p-2">
              {cols.map(c => (
                <label key={c.key} className="flex items-center gap-2 px-1.5 py-1 text-[12px] text-ww-text hover:bg-ww-rowHover rounded cursor-pointer">
                  <input type="checkbox" checked={colsAtuais.includes(c.key)}
                    onChange={() => salvarCols(colsAtuais.includes(c.key) ? colsAtuais.filter(k => k !== c.key) : [...colsAtuais, c.key])} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-ww-border bg-ww-panel overflow-hidden">
        <TblFit className="tf-col1" style={{ maxHeight: "calc(100vh - 200px)" }}>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-ww-border">
                {ativas.map(c => (
                  <th key={c.key} className={`px-3 py-2 text-[10px] uppercase tracking-wide text-ww-textFaint ${c.align === "right" ? "text-right" : "text-left"} ${PRIO[c.key] ?? ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(loading || (emNf && rowsNf === null)) && <tr><td colSpan={ativas.length} className="px-3 py-8 text-center text-ww-textMuted">Carregando…</td></tr>}
              {!loading && filtrados.length === 0 && <tr><td colSpan={ativas.length} className="px-3 py-8 text-center text-ww-textFaint">Nada com esses filtros.</td></tr>}
              {!loading && filtrados.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((r, i) => (
                <tr key={`${r.empresa}-${r.label ?? r.ncod_ped ?? r.id_receb}-${i}`}
                    onClick={() => { if (!emNf) setDrawer(r); }}
                    className={`border-b border-ww-border/60 hover:bg-ww-rowHover/60 cursor-pointer transition-colors ${r.cancelado ? "opacity-40 line-through" : ""}`}>
                  {ativas.map(c => (
                    <td key={c.key}
                        className={`px-3 py-1.5 ${c.align === "right" ? "text-right" : ""} ${c.largura ? `${c.largura} truncate` : "whitespace-nowrap"} text-ww-text ${PRIO[c.key] ?? ""}`}
                        title={c.largura ? String(r[c.key] ?? "") : undefined}>
                      {c.render ? c.render(r) : texto(r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TblFit>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t border-ww-border text-[11px] text-ww-textMuted">
          <span>{filtrados.length} doc(s) · <span className="font-semibold text-ww-text">{money(totalFiltrado)}</span></span>
          {pages > 1 && (
            <span className="flex items-center gap-2">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="px-2 py-0.5 rounded border border-ww-border disabled:opacity-30 hover:bg-ww-rowHover">‹</button>
              pág. {page + 1} / {pages}
              <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}
                className="px-2 py-0.5 rounded border border-ww-border disabled:opacity-30 hover:bg-ww-rowHover">›</button>
            </span>
          )}
        </div>
      </div>

      {/* Drawer de itens */}
      {drawer && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDrawer(null)}>
          <div onClick={e => e.stopPropagation()}
               className="bg-ww-panel border border-ww-border rounded-xl shadow-2xl max-w-3xl w-full p-5 space-y-3 max-h-[88vh] flex flex-col overflow-y-auto">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-ww-text text-[14px]">
                  {modulo === "compras" ? `PC ${drawer.numero}` : String(drawer.label)} — {texto(modulo === "compras" ? drawer.fornecedor : drawer.cliente)}
                </h3>
                <p className="text-[11px] text-ww-textMuted mt-0.5">
                  {texto(drawer.etapa_desc)} · emissão {dataBR(drawer.emissao)} · {money(drawer.valor_total)}
                  {drawer.projeto ? ` · ${drawer.projeto}` : ""}
                </p>
                {modulo === "vendas" && ehNativo(drawer.codigo) && (
                  <a href={`/erp/vendas/${idDoCodigo(drawer.codigo)}`} className="text-[12px] font-semibold text-ww-accent underline underline-offset-2">
                    Nascido no painel — abrir, editar ou emitir NF
                  </a>
                )}
              </div>
              <button onClick={() => setDrawer(null)} className="text-ww-textFaint hover:text-ww-text text-xl leading-none">×</button>
            </div>
            {modulo === "vendas" && /^(PV|OS)\d+$/i.test(String(drawer.label ?? "")) && (
              <details className="border border-ww-border rounded-lg px-3 py-2" open>
                <summary className="cursor-pointer text-[12px] font-semibold text-ww-text">OC do cliente e anexos</summary>
                <div className="mt-2"><OcAnexosPainel empresa={String(drawer.empresa ?? "SF")} label={String(drawer.label)} /></div>
              </details>
            )}
            <div className="overflow-y-auto border border-ww-border rounded-lg">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-ww-border sticky top-0 bg-ww-panel">
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-ww-textFaint">Código</th>
                    <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wide text-ww-textFaint">Descrição</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide text-ww-textFaint">Qtde</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide text-ww-textFaint">Unitário</th>
                    <th className="px-3 py-2 text-right text-[10px] uppercase tracking-wide text-ww-textFaint">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {itens === null && <tr><td colSpan={5} className="px-3 py-6 text-center text-ww-textMuted">Carregando itens…</td></tr>}
                  {itens?.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-ww-textFaint">Sem itens sincronizados.</td></tr>}
                  {itens?.map((it, k) => (
                    <tr key={k} className="border-b border-ww-border/60">
                      <td className="px-3 py-1.5 whitespace-nowrap text-ww-textFaint">{texto(it.codigo_produto)}</td>
                      <td className="px-3 py-1.5 text-ww-text">{texto(it.descricao)}</td>
                      <td className="px-3 py-1.5 text-right">{num(it.quantidade)}{it.qtd_recebida != null && Number(it.qtd_recebida) > 0 ? ` (${num(it.qtd_recebida)} rec.)` : ""}</td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap">{money(it.valor_unitario)}</td>
                      <td className="px-3 py-1.5 text-right whitespace-nowrap font-medium">{money(it.valor_total)}</td>
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
