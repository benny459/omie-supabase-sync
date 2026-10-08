"use client";

// Filtro por coluna, estilo Excel (08/10/26, Benny) — o ▾ no cabeçalho da grade.
//
//   texto  → ordenar A→Z / Z→A, "contém…" e a lista de valores distintos (com a contagem),
//            "Selecionar todos"
//   num    → ordenar, de / até, só vazias
//   data   → ordenar, de / até, atalhos (até hoje, próximos 7 dias), só vazias
//
// O popover vai para o <body> (portal, posição fixa sob o ▾): a grade tem overflow e o
// cabeçalho é preso — dentro dela o menu ficaria cortado. Opaco também no modo vidro.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type TipoFiltro = "texto" | "num" | "data";
/** `valores` ausente = todos marcados. Vazio ("") é um valor como outro ("(vazio)"). */
export type FiltroCol = { valores?: string[]; texto?: string; de?: string; ate?: string; soVazias?: boolean };
export type Ordem = { key: string; dir: 1 | -1 } | null;

export const filtroAtivo = (f?: FiltroCol | null) =>
  !!f && (f.valores != null || !!f.texto?.trim() || !!f.de || !!f.ate || !!f.soVazias);

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A linha passa no filtro desta coluna? `v` = texto (texto), número ou data ISO (num/data). */
export function passaFiltro(tipo: TipoFiltro, f: FiltroCol | undefined, v: string | number | null): boolean {
  if (!filtroAtivo(f)) return true;
  const ff = f!;
  if (tipo === "texto") {
    const s = v == null ? "" : String(v);
    if (ff.texto?.trim() && !semAcento(s).includes(semAcento(ff.texto.trim()))) return false;
    if (ff.valores && !ff.valores.includes(s)) return false;
    return true;
  }
  const vazio = v == null || v === "";
  if (ff.soVazias) return vazio;
  if (!ff.de && !ff.ate) return true;
  if (vazio) return false;
  if (tipo === "num") {
    const n = Number(v);
    if (ff.de !== undefined && ff.de !== "" && n < Number(ff.de.replace(",", "."))) return false;
    if (ff.ate !== undefined && ff.ate !== "" && n > Number(ff.ate.replace(",", "."))) return false;
    return true;
  }
  const d = String(v).slice(0, 10);
  if (ff.de && d < ff.de) return false;
  if (ff.ate && d > ff.ate) return false;
  return true;
}

/** Popover em posição fixa, preso a um elemento (abre embaixo; sem espaço, para cima). */
export function PopoverFixo({ ancora, onFechar, largura = 280, children, alinhar = "esq", rotulo }: {
  ancora: HTMLElement; onFechar: () => void; largura?: number; children: React.ReactNode; alinhar?: "esq" | "dir"; rotulo?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((t) => t + 1);
    const fora = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || ancora.contains(t)) return;
      onFechar();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("scroll", f, true);
    window.addEventListener("resize", f);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("scroll", f, true); window.removeEventListener("resize", f);
      document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc);
    };
  }, [ancora, onFechar]);
  const [alt, setAlt] = useState(0);
  useLayoutEffect(() => { setAlt(ref.current?.offsetHeight ?? 0); });
  const r = ancora.getBoundingClientRect();
  const w = Math.min(largura, window.innerWidth - 16);
  const left = Math.max(8, Math.min(alinhar === "dir" ? r.right - w : r.left, window.innerWidth - w - 8));
  const embaixo = window.innerHeight - r.bottom - 8;
  const paraCima = alt > embaixo && r.top > embaixo;
  const estilo: React.CSSProperties = paraCima
    ? { position: "fixed", left, bottom: window.innerHeight - r.top + 4, width: w, zIndex: 320, maxHeight: Math.max(160, r.top - 12) }
    : { position: "fixed", left, top: r.bottom + 4, width: w, zIndex: 320, maxHeight: Math.max(160, embaixo) };
  return createPortal(
    <div ref={ref} role="menu" aria-label={rotulo} style={estilo}
      className="overflow-auto rounded-lg border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl text-[11.5px] text-ww-text normal-case tracking-normal font-normal text-left">
      {children}
    </div>, document.body);
}

const hojeIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const maisDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** O ▾ do cabeçalho + o popover do filtro da coluna. `valores` é calculado só ao abrir. */
export function BotaoFiltro({ colKey, rotulo, tipo, filtro, ordemDir, valores, onFiltro, onOrdem }: {
  colKey: string; rotulo: string; tipo: TipoFiltro; filtro?: FiltroCol; ordemDir: 1 | -1 | null;
  /** Valores distintos com a contagem (só para texto), já considerando os OUTROS filtros. */
  valores: () => { v: string; n: number }[];
  onFiltro: (f: FiltroCol | undefined) => void; onOrdem: (dir: 1 | -1 | null) => void;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [aberto, setAberto] = useState(false);
  const ativo = filtroAtivo(filtro);
  return (<>
    <button ref={btn} type="button" data-filtro-col={colKey} aria-label={`Filtrar ${rotulo}`} aria-haspopup="menu" aria-expanded={aberto}
      title={ativo ? `Filtro ativo em ${rotulo} — clique para mudar` : ordemDir ? `Ordenado por ${rotulo}` : `Filtrar / ordenar ${rotulo}`}
      onClick={(e) => { e.stopPropagation(); setAberto((v) => !v); }}
      className={`shrink-0 inline-flex items-center justify-center min-w-[15px] h-[15px] rounded text-[9px] leading-none transition ${
        ativo ? "bg-ww-accent text-white" : ordemDir ? "bg-[rgb(var(--color-ww-panel))] text-ww-accent" : `bg-[rgb(var(--color-ww-panel))] text-ww-textMuted hover:text-ww-text ${aberto ? "" : "opacity-0 group-hover/th:opacity-100 focus:opacity-100"}`}`}>
      {ordemDir === 1 ? "▲" : ordemDir === -1 ? "▼" : ""}{ativo ? "⏷" : !ordemDir ? "▾" : ""}
    </button>
    {aberto && btn.current && (
      <PopoverFixo ancora={btn.current} onFechar={() => setAberto(false)} largura={tipo === "texto" ? 290 : 250} rotulo={`Filtro de ${rotulo}`}>
        <PainelFiltro tipo={tipo} rotulo={rotulo} filtro={filtro} ordemDir={ordemDir} valores={valores} onFiltro={onFiltro} onOrdem={onOrdem} onFechar={() => setAberto(false)} />
      </PopoverFixo>)}
  </>);
}

function PainelFiltro({ tipo, rotulo, filtro, ordemDir, valores, onFiltro, onOrdem, onFechar }: {
  tipo: TipoFiltro; rotulo: string; filtro?: FiltroCol; ordemDir: 1 | -1 | null; valores: () => { v: string; n: number }[];
  onFiltro: (f: FiltroCol | undefined) => void; onOrdem: (dir: 1 | -1 | null) => void; onFechar: () => void;
}) {
  const todos = useMemo(() => (tipo === "texto" ? valores() : []), [tipo, valores]);
  const f = filtro ?? {};
  const set = (p: Partial<FiltroCol>) => {
    const n = { ...f, ...p };
    for (const k of Object.keys(n) as (keyof FiltroCol)[]) if (n[k] === undefined || n[k] === "" || n[k] === false) delete n[k];
    onFiltro(filtroAtivo(n) ? n : undefined);
  };
  const busca = f.texto ?? "";
  const lista = todos.filter((x) => !busca.trim() || semAcento(x.v).includes(semAcento(busca.trim())));
  const marcado = (v: string) => !f.valores || f.valores.includes(v);
  const todosVis = lista.length > 0 && lista.every((x) => marcado(x.v));
  const normValores = (s: Set<string>) => (todos.every((x) => s.has(x.v)) ? undefined : [...s]);
  const alternar = (v: string) => {
    const s = new Set(f.valores ?? todos.map((x) => x.v));
    if (s.has(v)) s.delete(v); else s.add(v);
    set({ valores: normValores(s) });
  };
  const alternarTodos = () => {
    const s = new Set(f.valores ?? todos.map((x) => x.v));
    for (const x of lista) { if (todosVis) s.delete(x.v); else s.add(x.v); }
    set({ valores: normValores(s) });
  };
  const rotA = tipo === "texto" ? ["A → Z", "Z → A"] : tipo === "num" ? ["Menor → maior", "Maior → menor"] : ["Mais antiga → recente", "Mais recente → antiga"];
  const BT = "px-2 py-1 rounded-md border text-[11px] transition";
  return (
    <div className="p-2 space-y-2" data-painel-filtro={rotulo}>
      <div className="flex items-center gap-1.5">
        <b className="text-[11px] text-ww-textMuted uppercase tracking-wider">{rotulo}</b>
        <span className="flex-1" />
        {filtroAtivo(filtro) && <button type="button" className="text-[11px] text-ww-accent hover:underline" data-limpar-col onClick={() => onFiltro(undefined)}>limpar filtro</button>}
      </div>
      <div className="flex gap-1.5" role="group" aria-label="Ordenar">
        {([1, -1] as const).map((d, i) => (
          <button key={d} type="button" role="menuitemradio" aria-checked={ordemDir === d} data-ordem={d === 1 ? "asc" : "desc"}
            onClick={() => onOrdem(ordemDir === d ? null : d)}
            className={`${BT} flex-1 ${ordemDir === d ? "border-ww-accent bg-ww-accentSoft text-ww-text font-semibold" : "border-ww-border text-ww-textMuted hover:text-ww-text"}`}>
            {i === 0 ? "↑" : "↓"} {rotA[i]}
          </button>))}
      </div>
      {tipo === "texto" ? (<>
        <input autoFocus value={busca} placeholder="contém… (procura e filtra)" data-filtro-busca
          onChange={(e) => set({ texto: e.target.value })}
          className="w-full rounded-md border border-ww-border bg-transparent px-2 py-1 text-[12px] text-ww-text outline-none focus:ring-1 focus:ring-ww-accent" />
        <div role="listbox" aria-multiselectable="true" aria-label={`Valores de ${rotulo}`}
          className="max-h-[230px] overflow-auto rounded-md border border-ww-border/70 bg-[rgb(var(--color-ww-panel))] py-0.5">
          <label className="flex items-center gap-2 px-2 py-1 border-b border-ww-border/50 cursor-pointer hover:bg-ww-rowHover font-semibold" data-sel-todos>
            <input type="checkbox" checked={todosVis} onChange={alternarTodos} />
            Selecionar todos{busca.trim() ? " (da busca)" : ""}
            <span className="ml-auto text-[10.5px] text-ww-textFaint font-normal">{lista.reduce((a, x) => a + x.n, 0)}</span>
          </label>
          {lista.map((x) => (
            <label key={x.v || "∅"} role="option" aria-selected={marcado(x.v)} data-valor={x.v}
              className="flex items-center gap-2 px-2 py-0.5 cursor-pointer hover:bg-ww-rowHover min-w-0">
              <input type="checkbox" checked={marcado(x.v)} onChange={() => alternar(x.v)} />
              <span className={`truncate min-w-0 ${x.v ? "" : "italic text-ww-textFaint"}`} title={x.v || "(vazio)"}>{x.v || "(vazio)"}</span>
              <span className="ml-auto shrink-0 text-[10.5px] text-ww-textFaint tabular-nums">{x.n}</span>
            </label>))}
          {!lista.length && <div className="px-2 py-1.5 text-ww-textFaint">nenhum valor com “{busca}”</div>}
        </div>
      </>) : (<>
        <div className="grid grid-cols-2 gap-1.5">
          <label className="text-[10.5px] text-ww-textMuted">de
            <input type={tipo === "data" ? "date" : "number"} value={f.de ?? ""} data-filtro-de disabled={!!f.soVazias}
              onChange={(e) => set({ de: e.target.value })}
              className="mt-0.5 block w-full rounded-md border border-ww-border bg-transparent px-1.5 py-1 text-[12px] text-ww-text disabled:opacity-40" />
          </label>
          <label className="text-[10.5px] text-ww-textMuted">até
            <input type={tipo === "data" ? "date" : "number"} value={f.ate ?? ""} data-filtro-ate disabled={!!f.soVazias}
              onChange={(e) => set({ ate: e.target.value })}
              className="mt-0.5 block w-full rounded-md border border-ww-border bg-transparent px-1.5 py-1 text-[12px] text-ww-text disabled:opacity-40" />
          </label>
        </div>
        {tipo === "data" && (
          <div className="flex flex-wrap gap-1">
            <button type="button" className={`${BT} border-ww-border text-ww-textMuted hover:text-ww-text`} onClick={() => set({ de: undefined, ate: hojeIso(), soVazias: undefined })}>até hoje</button>
            <button type="button" className={`${BT} border-ww-border text-ww-textMuted hover:text-ww-text`} onClick={() => set({ de: hojeIso(), ate: maisDias(7), soVazias: undefined })}>próx. 7 dias</button>
            <button type="button" className={`${BT} border-ww-border text-ww-textMuted hover:text-ww-text`} onClick={() => set({ de: hojeIso(), ate: maisDias(30), soVazias: undefined })}>próx. 30 dias</button>
          </div>)}
        <label className="flex items-center gap-2 text-[11px] text-ww-textMuted cursor-pointer">
          <input type="checkbox" checked={!!f.soVazias} onChange={(e) => set({ soVazias: e.target.checked || undefined, ...(e.target.checked ? { de: undefined, ate: undefined } : {}) })} />
          só as vazias
        </label>
        <p className="text-[10.5px] text-ww-textFaint">Com de/até preenchido, as linhas sem valor ficam de fora.</p>
      </>)}
      <div className="flex justify-end">
        <button type="button" onClick={onFechar} className="px-2.5 py-0.5 rounded-md bg-ww-accent text-white text-[11px] font-semibold">ok</button>
      </div>
    </div>
  );
}
