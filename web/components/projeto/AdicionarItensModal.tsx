"use client";

// "Adicionar itens à lista" (08/10/26, spec D) — um modal, duas abas:
//   • Do estoque / catálogo: busca por código ou descrição, marca vários com a quantidade,
//     grupo-alvo no topo. Cada item entra já com código, fornecedor e prazo do catálogo.
//   • Colar do Excel: o MESMO parser do Ctrl+V da grade (lib/colar-grade). Sem cabeçalho a
//     ordem é Código · Item · Qtd · Un · Necessário em · Valor unit. (Código pode vir vazio);
//     datas dd/mm/aaaa viram ISO; código do nosso estoque preenche descrição, fornecedor e
//     valor vazios; código que não é nosso aparece em vermelho na prévia e entra sem código.
// Quem chama monta as linhas (camposDoCatalogo) e as que vierem sem código passam pelo
// casamento automático da lista.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lerColagem, type AlvoColar } from "@/lib/colar-grade";

export type ItemCatalogo = {
  ncod_prod: number; codigo: string | null; descricao: string; unidade: string | null;
  ultimo_preco: number | null; fornecedor: string | null; entrega_dias: number | null; fat_dias: number | null;
  [k: string]: unknown;
};
export type LinhaNova = {
  equipamento: string; item: string; qtd: string; un: string; data_necessaria: string; cat_valor_unit: string;
  cat: ItemCatalogo | null; codigo_invalido?: string;
};
type Grupo = { k: string; nome: string; data: string | null };

const brl = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const dBR = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : "");
const numBR = (v: string) => {
  const t = String(v ?? "").replace(/[^\d,.-]/g, "");
  const n = t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
  return Number.isFinite(n) ? n : 0;
};

const ALVOS: AlvoColar[] = [
  { label: "Código", key: "cat_codigo" }, { label: "Cod", key: "cat_codigo" }, { label: "Item", key: "item" }, { label: "Descrição", key: "item" },
  { label: "Qtd", key: "qtd" }, { label: "Quantidade", key: "qtd" }, { label: "Un", key: "un" }, { label: "Unidade", key: "un" },
  { label: "Necessário em", key: "data_necessaria", tipo: "data" }, { label: "Data", key: "data_necessaria", tipo: "data" },
  { label: "Valor unit.", key: "cat_valor_unit" }, { label: "Valor", key: "cat_valor_unit" }, { label: "Valor unitário", key: "cat_valor_unit" },
  { label: "Grupo", key: "equipamento" }, { label: "Equipamento", key: "equipamento" },
];
const POSICIONAIS: AlvoColar[] = [
  { label: "Código", key: "cat_codigo" }, { label: "Item", key: "item" }, { label: "Qtd", key: "qtd" }, { label: "Un", key: "un" },
  { label: "Necessário em", key: "data_necessaria", tipo: "data" }, { label: "Valor unit.", key: "cat_valor_unit" },
];

export default function AdicionarItensModal({ empresa, grupos, modoInicial, onAdicionar, onFechar }: {
  empresa: string; grupos: Grupo[]; modoInicial: "cat" | "colar";
  onAdicionar: (linhas: LinhaNova[], modo: "cat" | "colar") => void; onFechar: () => void;
}) {
  const [modo, setModo] = useState(modoInicial);
  const NOVO = "__novo__";
  const [grupoSel, setGrupoSel] = useState(grupos[0]?.nome ?? "Geral");
  const [grupoNovo, setGrupoNovo] = useState("");
  const grupo = grupoSel === NOVO ? (grupoNovo.trim() || "Geral") : grupoSel;
  const dataDoGrupo = (nome: string) => grupos.find((g) => g.nome.trim().toLowerCase() === nome.trim().toLowerCase())?.data ?? "";

  // ── catálogo ──
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ItemCatalogo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [marc, setMarc] = useState<Map<number, { c: ItemCatalogo; qtd: number }>>(new Map());
  const seq = useRef(0);
  useEffect(() => {
    if (modo !== "cat") return;
    const t = q.trim();
    if (t.length < 2) { setRes([]); return; }
    const n = ++seq.current;
    const h = setTimeout(async () => {
      setBuscando(true); setErroBusca(null);
      try {
        const r = await fetch(`/api/catalogo/projeto?op=buscar&emp=${encodeURIComponent(empresa)}&q=${encodeURIComponent(t)}&lim=20`);
        const j = (await r.json()) as { itens?: ItemCatalogo[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        if (n === seq.current) setRes(j.itens ?? []);
      } catch (e) { if (n === seq.current) setErroBusca((e as Error).message); }
      finally { if (n === seq.current) setBuscando(false); }
    }, 280);
    return () => clearTimeout(h);
  }, [q, modo, empresa]);

  // ── colar ──
  const [txt, setTxt] = useState("");
  const [porCodigo, setPorCodigo] = useState<Map<string, ItemCatalogo | null>>(new Map());
  const [resolvendo, setResolvendo] = useState(false);
  const lidas = useMemo(() => (txt.trim() ? lerColagem(txt, ALVOS, POSICIONAIS).linhas.filter((l) => Object.values(l).some((v) => String(v).trim())) : []), [txt]);
  const codigos = useMemo(() => [...new Set(lidas.map((l) => String(l.cat_codigo ?? "").trim().toUpperCase()).filter(Boolean))], [lidas]);
  useEffect(() => {
    const falta = codigos.filter((c) => !porCodigo.has(c));
    if (!falta.length) return;
    let vivo = true;
    const h = setTimeout(async () => {
      setResolvendo(true);
      const achados = await Promise.all(falta.map(async (cod) => {
        try {
          const j = await fetch(`/api/catalogo/projeto?op=buscar&emp=${encodeURIComponent(empresa)}&q=${encodeURIComponent(cod)}&lim=5`).then((x) => x.json()) as { itens?: (ItemCatalogo & { via?: string | null })[] };
          const its = j.itens ?? [];
          return [cod, its.find((c) => String(c.codigo ?? "").toUpperCase() === cod)
            ?? its.find((c) => String(c.via ?? "").toUpperCase().split(/\s+/).includes(cod)) ?? null] as const;
        } catch { return [cod, undefined] as const; }
      }));
      if (!vivo) return;
      setPorCodigo((m) => { const n = new Map(m); for (const [c, it] of achados) if (it !== undefined) n.set(c, it); return n; });
      setResolvendo(false);
    }, 350);
    return () => { vivo = false; clearTimeout(h); };
  }, [codigos, porCodigo, empresa]);

  const linhasColadas: LinhaNova[] = useMemo(() => lidas.map((l) => {
    const cod = String(l.cat_codigo ?? "").trim().toUpperCase();
    const c = cod ? porCodigo.get(cod) ?? null : null;
    const eq = String(l.equipamento ?? "").trim() || grupo;
    return {
      equipamento: eq,
      item: String(l.item ?? "").trim() || c?.descricao || "",
      qtd: String(l.qtd ?? "").trim() || "1",
      un: String(l.un ?? "").trim() || c?.unidade || "",
      data_necessaria: String(l.data_necessaria ?? "") || dataDoGrupo(eq),
      cat_valor_unit: String(l.cat_valor_unit ?? "").trim() || (c?.ultimo_preco != null ? String(c.ultimo_preco).replace(".", ",") : ""),
      cat: c,
      ...(cod && porCodigo.has(cod) && !c ? { codigo_invalido: cod } : {}),
    };
  }), [lidas, porCodigo, grupo]); // eslint-disable-line react-hooks/exhaustive-deps

  const prontasCat = marc.size;
  const prontasColar = linhasColadas.filter((l) => l.item).length;
  const confirmar = () => {
    if (modo === "cat") {
      if (!marc.size) return;
      onAdicionar([...marc.values()].map(({ c, qtd }) => ({
        equipamento: grupo, item: c.descricao, qtd: String(qtd || 1), un: c.unidade ?? "", data_necessaria: dataDoGrupo(grupo),
        cat_valor_unit: c.ultimo_preco != null ? String(c.ultimo_preco).replace(".", ",") : "", cat: c,
      })), "cat");
    } else {
      const ok = linhasColadas.filter((l) => l.item);
      if (!ok.length) return;
      onAdicionar(ok, "colar");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[125] bg-black/45 flex items-end sm:items-start justify-center sm:pt-[6vh] px-0 sm:px-3"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div role="dialog" aria-label="Adicionar itens à lista" data-modal="adicionar"
        className="w-full sm:w-[min(920px,96vw)] max-h-[90vh] flex flex-col rounded-t-xl sm:rounded-xl border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl text-[12px]">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-ww-border">
          <h4 className="text-[14px] font-semibold text-ww-text">Adicionar itens à lista</h4>
          <button type="button" className="ml-auto text-ww-textMuted hover:text-ww-text" onClick={onFechar}>✕</button>
        </div>
        <div className="px-4 py-3 overflow-auto space-y-2.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            {([["cat", "Do estoque / catálogo"], ["colar", "Colar do Excel"]] as const).map(([k, rot]) => (
              <button key={k} type="button" onClick={() => setModo(k)} data-aba-modal={k}
                className={`px-3 py-1.5 rounded-lg border ${modo === k ? "border-ww-accent bg-ww-accentSoft text-ww-text" : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>{rot}</button>))}
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-ww-textMuted">Grupo:</span>
              <select value={grupoSel} onChange={(e) => setGrupoSel(e.target.value)}
                className="bg-transparent border border-ww-border rounded px-1.5 py-1 text-[12px] text-ww-text">
                {grupos.map((g) => <option key={g.k} value={g.nome}>{g.nome}{g.data ? ` · ${dBR(g.data)}` : ""}</option>)}
                {!grupos.some((g) => g.nome === "Geral") && <option value="Geral">Geral</option>}
                <option value={NOVO}>+ novo grupo…</option>
              </select>
              {grupoSel === NOVO && <input autoFocus value={grupoNovo} onChange={(e) => setGrupoNovo(e.target.value)} placeholder="nome do grupo"
                className="w-36 bg-transparent border border-ww-border rounded px-1.5 py-1 text-[12px] text-ww-text" />}
            </span>
          </div>

          {modo === "cat" ? (<>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="código ou descrição… (ex.: E020, crepina, manômetro)"
              className="w-full bg-transparent border border-ww-border rounded-lg px-2.5 py-1.5 text-[12.5px] text-ww-text outline-none focus:ring-1 focus:ring-ww-accent" />
            {erroBusca && <p className="text-rose-600 dark:text-rose-400">Não consegui buscar: {erroBusca}</p>}
            <div className="border border-ww-border rounded-lg max-h-[46vh] overflow-auto">
              {!res.length && <p className="p-3 text-ww-textFaint">{buscando ? "buscando…" : q.trim().length < 2 ? "Digite ao menos 2 letras." : "Nada encontrado no nosso estoque."}</p>}
              {res.map((c) => {
                const m = marc.get(c.ncod_prod);
                return (
                  <label key={c.ncod_prod} className="grid grid-cols-[22px_86px_minmax(0,1fr)_96px_64px] gap-2 items-center px-2.5 py-1.5 border-b border-ww-border/50 last:border-0 cursor-pointer hover:bg-ww-rowHover">
                    <input type="checkbox" checked={!!m} onChange={(e) => setMarc((x) => { const n = new Map(x); if (e.target.checked) n.set(c.ncod_prod, { c, qtd: 1 }); else n.delete(c.ncod_prod); return n; })} />
                    <span className="font-mono text-[11.5px]">{c.codigo}</span>
                    <span className="min-w-0"><span className="block truncate text-ww-text">{c.descricao}</span>
                      <small className="block truncate text-ww-textFaint">{[c.fornecedor, c.entrega_dias != null ? `${c.entrega_dias}d` : "prazo —", c.unidade].filter(Boolean).join(" · ")}</small></span>
                    <span className="text-right tabular-nums">{brl(c.ultimo_preco)}</span>
                    <input type="number" min={1} value={m?.qtd ?? 1} onClick={(e) => e.preventDefault()}
                      onChange={(e) => { const v = Number(e.target.value) || 1; setMarc((x) => { const n = new Map(x); n.set(c.ncod_prod, { c, qtd: v }); return n; }); }}
                      className="w-full bg-transparent border border-ww-border rounded px-1 py-0.5 text-right text-[12px]" title="quantidade" />
                  </label>);
              })}
            </div>
            {marc.size > 0 && <p className="text-[11px] text-ww-textMuted">Marcados: {[...marc.values()].map(({ c, qtd }) => `${qtd}× ${c.codigo}`).join(" · ")}</p>}
            <small className="block text-ww-textFaint">Marque vários (a busca pode mudar — os marcados ficam) e ajuste a quantidade. Cada item entra já com código, fornecedor e prazo do catálogo e com a data do grupo.</small>
          </>) : (<>
            <small className="block text-ww-textMuted">Cole direto do Excel. Com cabeçalho as colunas vão pelo nome (Código, Item, Qtd, Un, Necessário em, Valor unit., Grupo); sem cabeçalho a ordem é <b>Código · Item · Qtd · Un · Necessário em · Valor unit.</b> (Código pode ficar vazio). Datas em dd/mm/aaaa são aceitas. <a className="text-ww-accent hover:underline" href={`/api/rc-projetos/modelo?emp=${encodeURIComponent(empresa)}`}>⬇ modelo Excel com nossos códigos</a></small>
            <textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={7} autoFocus
              placeholder={"E02045\tCREPINA SUPERIOR\t2\tun\t30/10/2026\t40\n\tMANOMETRO C/CONEXAO LAT.0-7\t1\tun\t30/10/2026\t57,70"}
              className="w-full rounded-lg border border-ww-border bg-transparent px-2.5 py-2 font-mono text-[12px] text-ww-text outline-none focus:ring-1 focus:ring-ww-accent" />
            {linhasColadas.length > 0 && (<>
              <p className="text-[11px] text-ww-textMuted">{linhasColadas.length} linha(s) · {linhasColadas.filter((l) => l.cat).length} com código reconhecido{resolvendo ? " · conferindo códigos…" : ""}{linhasColadas.some((l) => l.codigo_invalido) ? ` · ${linhasColadas.filter((l) => l.codigo_invalido).length} código(s) que não são do nosso estoque (entram sem código)` : ""}</p>
              <div className="border border-ww-border rounded-lg max-h-[36vh] overflow-auto" data-previa="colar">
                <table className="w-full text-[11.5px] border-collapse">
                  <thead className="sticky top-0 bg-[rgb(var(--color-ww-panel))] text-ww-textMuted text-left">
                    <tr><th className="p-1.5">Código</th><th className="p-1.5">Item</th><th className="p-1.5 text-right">Qtd</th><th className="p-1.5">Un</th><th className="p-1.5">Necessário em</th><th className="p-1.5 text-right">Valor</th><th className="p-1.5">Fornecedor</th><th className="p-1.5">Grupo</th></tr>
                  </thead>
                  <tbody>{linhasColadas.map((l, i) => (
                    <tr key={i} className="border-t border-ww-border/50">
                      <td className="p-1.5 font-mono">{l.codigo_invalido ? <span className="px-1 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400" title="Não é código do nosso estoque — a linha entra sem código">{l.codigo_invalido} ?</span>
                        : l.cat ? l.cat.codigo : <span className="text-ww-textFaint font-sans">— vai casar</span>}</td>
                      <td className="p-1.5 text-ww-text">{l.item || <span className="text-rose-600">sem descrição — fica de fora</span>}</td>
                      <td className="p-1.5 text-right tabular-nums">{l.qtd}</td><td className="p-1.5">{l.un || "—"}</td>
                      <td className="p-1.5 tabular-nums">{l.data_necessaria ? dBR(l.data_necessaria) : <span className="text-ww-textFaint">data do grupo</span>}</td>
                      <td className="p-1.5 text-right tabular-nums">{l.cat_valor_unit ? brl(numBR(l.cat_valor_unit)) : "—"}</td>
                      <td className="p-1.5 text-ww-textMuted">{l.cat?.fornecedor ?? "—"}</td>
                      <td className="p-1.5 text-ww-textMuted">{l.equipamento}</td>
                    </tr>))}</tbody>
                </table>
              </div>
            </>)}
          </>)}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-ww-border">
          <small className="text-ww-textMuted">{modo === "cat" ? `${prontasCat} item(ns) marcado(s)` : `${prontasColar} linha(s) prontas`} · grupo <b>{grupo}</b>{dataDoGrupo(grupo) ? ` (necessário em ${dBR(dataDoGrupo(grupo))})` : ""}</small>
          <button type="button" className="ml-auto px-3 py-1.5 rounded-lg border border-ww-border text-ww-textMuted hover:text-ww-text" onClick={onFechar}>Cancelar</button>
          <button type="button" disabled={modo === "cat" ? !prontasCat : !prontasColar || resolvendo} onClick={confirmar} data-confirmar="adicionar"
            className="px-3 py-1.5 rounded-lg bg-ww-accent text-white font-semibold hover:brightness-110 disabled:opacity-40">Adicionar à lista</button>
        </div>
      </div>
    </div>, document.body);
}
