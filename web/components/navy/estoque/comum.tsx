"use client";

/** Peças partilhadas da lista e da ficha do Estoque: dados em cache, pílula, miniatura e a paleta ⌘K. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { normItem, situacao, type ItemEstoque, type JanelaInventario, type ParDup, type Tom } from "@/lib/estoque";

// ── Dados da lista (cache do módulo: lista ↔ ficha sem recarregar) ───────────
type Pacote = { itens: ItemEstoque[]; dups: ParDup[]; admin: boolean };
let cache: Pacote | null = null;
let emCurso: Promise<Pacote> | null = null;

function carregar(forcar = false): Promise<Pacote> {
  if (cache && !forcar) return Promise.resolve(cache);
  if (emCurso && !forcar) return emCurso;
  emCurso = fetch("/api/estoque/itens", { cache: "no-store" }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    cache = {
      itens: (j.rows as Record<string, unknown>[]).map(normItem),
      dups: (j.dups as ParDup[]).map((d) => ({ ...d, prod_a: Number(d.prod_a), prod_b: Number(d.prod_b), sim: Number(d.sim) })),
      admin: !!j.admin,
    };
    return cache;
  }).finally(() => { emCurso = null; });
  return emCurso;
}

export function useItensEstoque() {
  const [dados, setDados] = useState<Pacote | null>(cache);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    carregar().then((d) => vivo && setDados(d)).catch((e) => vivo && setErro((e as Error).message));
    return () => { vivo = false; };
  }, []);
  /** Depois de ajustar/mesclar: busca de novo (saldo e duplicidades mudam). */
  const recarregar = useCallback(async () => {
    try { setDados(await carregar(true)); } catch (e) { setErro((e as Error).message); }
  }, []);
  return { dados, erro, recarregar };
}
/** Invalida o cache da lista (a ficha ajustou algo; a lista recarrega ao voltar). */
export const invalidarItens = () => { cache = null; };

// ── Sessão de inventário: a senha fica só nesta aba do navegador até a janela vencer ──
const INV = "est-inv-v1";
export type SessaoInv = { codigo: string; janela: JanelaInventario };
export function lerSessaoInv(): SessaoInv | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(INV) || "null") as SessaoInv | null;
    if (!s || new Date(s.janela.valida_ate).getTime() <= Date.now()) { sessionStorage.removeItem(INV); return null; }
    return s;
  } catch { return null; }
}
export const gravarSessaoInv = (s: SessaoInv | null) => {
  try { if (s) sessionStorage.setItem(INV, JSON.stringify(s)); else sessionStorage.removeItem(INV); } catch {}
};
export async function entrarInventario(codigo: string): Promise<SessaoInv> {
  const r = await fetch("/api/estoque/janela/validar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo }) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  const s = { codigo: codigo.toUpperCase().replace(/[^A-Z0-9]/g, ""), janela: j.janela as JanelaInventario };
  gravarSessaoInv(s);
  return s;
}
export function useSessaoInv() {
  const [s, setS] = useState<SessaoInv | null>(null);
  useEffect(() => { setS(lerSessaoInv()); }, []);
  const set = useCallback((v: SessaoInv | null) => { gravarSessaoInv(v); setS(v); }, []);
  return [s, set] as const;
}
export const escopoTxt = (e: JanelaInventario["escopo"] | undefined, nomeLocal: (l: string) => string) =>
  e?.familia ? `família ${e.familia}` : e?.local ? nomeLocal(e.local) : "todos os itens";

/** POST JSON com erro legível. */
export async function postar<T = unknown>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? r.statusText);
  return j as T;
}

/** Aviso flutuante (substitui alert/confirm). */
export function useToast() {
  const [t, setT] = useState<{ msg: string; tom: Tom } | null>(null);
  useEffect(() => { if (!t) return; const h = setTimeout(() => setT(null), 3500); return () => clearTimeout(h); }, [t]);
  const el = t ? <div className={`est-toast t-${t.tom}`} role="status">{t.msg}</div> : null;
  return [el, (msg: string, tom: Tom = "ok") => setT({ msg, tom })] as const;
}

// ── Navegação lista → ficha (‹ ›) e estado da lista ─────────────────────────
const NAV = "est-nav-v1", REC = "est-recentes-v1";
export const guardarNavegacao = (codigos: string[]) => { try { sessionStorage.setItem(NAV, JSON.stringify(codigos)); } catch {} };
export const lerNavegacao = (): string[] => { try { return JSON.parse(sessionStorage.getItem(NAV) || "[]"); } catch { return []; } };
export const lerRecentes = (): number[] => { try { return JSON.parse(localStorage.getItem(REC) || "[]"); } catch { return []; } };
export const marcarRecente = (id: number) => {
  try { localStorage.setItem(REC, JSON.stringify([id, ...lerRecentes().filter((x) => x !== id)].slice(0, 8))); } catch {}
};

// ── Formatação ───────────────────────────────────────────────────────────────
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
export const q = (v: number | null | undefined) => NUM.format(v ?? 0);
export const brl = (v: number | null | undefined) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function kbrl(v: number) {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toFixed(2).replace(".", ",")} mi`;
  if (a >= 1e4) return `${s}R$ ${Math.round(a / 1e3)} mil`;
  return s + brl(a);
}
export const ddmmaa = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");
export const ddmm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—");
const DSEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const dsem = (iso: string) => DSEM[new Date(iso + "T12:00:00Z").getUTCDay()];

// ── Peças visuais ────────────────────────────────────────────────────────────
export const Pill = ({ t, tom, title }: { t: ReactNode; tom: Tom; title?: string }) => (
  <span className={`pill t-${tom}`} title={title}>{t}</span>
);

const ICONE = (
  <svg viewBox="0 0 40 40" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.8" opacity=".55" aria-hidden>
    <rect x="8" y="10" width="24" height="20" rx="3" /><path d="M8 16h24M16 10v6M24 10v6" />
  </svg>
);
export const IconeCaixa = () => ICONE;
export const Thumb = ({ txt }: { txt?: string }) => <div className="thumb">{txt ?? ICONE}</div>;

export const Seta = ({ dir }: { dir: "esq" | "dir" }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={dir === "esq" ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
  </svg>
);
export const Lupa = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
  </svg>
);

function Realce({ t, s }: { t: string; s: string }) {
  if (!s) return <>{t}</>;
  const i = t.toLowerCase().indexOf(s.toLowerCase());
  if (i < 0) return <>{t}</>;
  return <>{t.slice(0, i)}<mark>{t.slice(i, i + s.length)}</mark>{t.slice(i + s.length)}</>;
}

// ── Paleta ⌘K / "/" ──────────────────────────────────────────────────────────
type PcBusca = { numero: string; emissao: string | null; fornecedor: string | null; itens: { n_cod_prod: number; descricao: string }[] };
type CliBusca = { nome: string; itens: number };
type Res = { k: "item"; p: ItemEstoque } | { k: "pc"; pc: PcBusca } | { k: "cli"; c: CliBusca };

/** Abre com ⌘K / Ctrl+K em qualquer lugar e com "/" fora de campos de texto. Na tela de Estoque o ⌘K
 *  é desta paleta: o listener em captura para o evento antes da busca global (GlobalSearch). */
export function useAtalhoPaleta(abrir: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const digitando = !!alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopImmediatePropagation(); abrir(); }
      else if (e.key === "/" && !digitando) { e.preventDefault(); abrir(); }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [abrir]);
}

export function PaletaEstoque({ itens, fechar, onItem, onPc, onCliente }: {
  itens: ItemEstoque[]; fechar: () => void;
  onItem: (p: ItemEstoque) => void; onPc: (id: number) => void; onCliente: (nome: string) => void;
}) {
  const [s, setS] = useState("");
  const [sel, setSel] = useState(0);
  const [remoto, setRemoto] = useState<{ q: string; pcs: PcBusca[]; clientes: CliBusca[] }>({ q: "", pcs: [], clientes: [] });
  const inp = useRef<HTMLInputElement>(null);
  const porId = useMemo(() => new Map(itens.map((p) => [p.n_cod_prod, p])), [itens]);

  useEffect(() => { setTimeout(() => inp.current?.focus(), 10); }, []);

  // PCs e clientes vêm do servidor (debounce); itens filtram na memória.
  const sl = s.trim().toLowerCase();
  useEffect(() => {
    if (sl.length < 3) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/estoque/busca?q=${encodeURIComponent(sl)}`, { signal: ctrl.signal });
        const j = await r.json();
        if (r.ok) setRemoto({ q: sl, pcs: j.pcs ?? [], clientes: j.clientes ?? [] });
      } catch {}
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [sl]);

  const res: Res[] = useMemo(() => {
    const toks = sl.split(/\s+/).filter(Boolean);
    let its: ItemEstoque[];
    if (!sl) its = lerRecentes().map((id) => porId.get(id)).filter(Boolean).slice(0, 6) as ItemEstoque[];
    else its = itens.filter((p) => { const h = `${p.descricao} ${p.codigo}`.toLowerCase(); return toks.every((t) => h.includes(t)); })
      .sort((a, b) => Number(b.codigo.toLowerCase() === sl) - Number(a.codigo.toLowerCase() === sl)
        || Number(b.codigo.toLowerCase().startsWith(sl)) - Number(a.codigo.toLowerCase().startsWith(sl)) || b.n_mov - a.n_mov)
      .slice(0, 8);
    const ok = remoto.q === sl && sl.length >= 3;
    return [
      ...its.map((p) => ({ k: "item" as const, p })),
      ...(ok ? remoto.pcs.map((pc) => ({ k: "pc" as const, pc })) : []),
      ...(ok ? remoto.clientes.map((c) => ({ k: "cli" as const, c })) : []),
    ];
  }, [sl, itens, porId, remoto]);

  const atual = Math.min(sel, Math.max(0, res.length - 1));
  const escolher = useCallback((r: Res | undefined) => {
    if (!r) return;
    fechar();
    if (r.k === "item") { marcarRecente(r.p.n_cod_prod); onItem(r.p); }
    else if (r.k === "pc") { const id = r.pc.itens[0]?.n_cod_prod; if (id != null) onPc(Number(id)); }
    else onCliente(r.c.nome);
  }, [fechar, onItem, onPc, onCliente]);

  const tecla = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { setSel(Math.min(atual + 1, res.length - 1)); e.preventDefault(); }
    else if (e.key === "ArrowUp") { setSel(Math.max(atual - 1, 0)); e.preventDefault(); }
    else if (e.key === "Enter") { escolher(res[atual]); e.preventDefault(); }
    else if (e.key === "Escape") { fechar(); e.preventDefault(); }
  };

  let i = 0;
  const itensRes = res.filter((r) => r.k === "item") as Extract<Res, { k: "item" }>[];
  const pcsRes = res.filter((r) => r.k === "pc") as Extract<Res, { k: "pc" }>[];
  const cliRes = res.filter((r) => r.k === "cli") as Extract<Res, { k: "cli" }>[];
  const linha = (r: Res, conteudo: ReactNode) => {
    const idx = i++;
    return (
      <div key={idx} className={`it ${idx === atual ? "on" : ""}`} onMouseEnter={() => setSel(idx)} onClick={() => escolher(r)}>{conteudo}</div>
    );
  };
  const tok = sl.split(/\s+/).filter(Boolean)[0] ?? "";

  return (
    <div className="est-ov" onClick={fechar} role="dialog" aria-modal="true" aria-label="Ir para item">
      <div className="pal" onClick={(e) => e.stopPropagation()}>
        <input ref={inp} value={s} onChange={(e) => { setS(e.target.value); setSel(0); }} onKeyDown={tecla}
          placeholder="Código, nome, nº do PC ou cliente…" autoComplete="off" aria-label="Buscar item, PC ou cliente" />
        <div className="res">
          {itensRes.length > 0 && <div className="grp">{sl ? "Itens" : "Abertos recentemente"}</div>}
          {itensRes.map((r) => {
            const [st, tm]: [string, Tom] = r.p.mesclado_em_codigo ? [`mesclado em ${r.p.mesclado_em_codigo}`, "off"] : situacao(r.p);
            return linha(r, <>
              <Thumb />
              <div className="sp">
                <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><Realce t={r.p.descricao} s={tok} /></div>
                <div className="mini"><Realce t={r.p.codigo} s={s.trim()} /> · saldo {q(r.p.saldo)} {r.p.unidade.toLowerCase()}</div>
              </div>
              <Pill t={st} tom={tm} />
            </>);
          })}
          {pcsRes.length > 0 && <div className="grp">Pedidos de compra</div>}
          {pcsRes.map((r) => linha(r, <>
            <Thumb txt="PC" />
            <div className="sp">
              <div style={{ fontWeight: 600 }}>PC <Realce t={r.pc.numero} s={s.trim()} /> <span className="mini">· {r.pc.fornecedor ?? "—"} · {ddmmaa(r.pc.emissao)}</span></div>
              <div className="mini" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.pc.itens.length} item{r.pc.itens.length > 1 ? "s" : ""}: {r.pc.itens.slice(0, 2).map((x) => x.descricao).join(", ")}
              </div>
            </div>
          </>))}
          {cliRes.length > 0 && <div className="grp">Clientes — ver itens que usaram</div>}
          {cliRes.map((r) => linha(r, <>
            <Thumb txt="CL" />
            <div className="sp">
              <div style={{ fontWeight: 600 }}><Realce t={r.c.nome} s={s.trim()} /></div>
              <div className="mini">{r.c.itens} itens nos últimos 12 meses</div>
            </div>
          </>))}
          {!res.length && <div className="vazio">{sl ? (sl.length < 3 || remoto.q === sl ? `Nada para “${s.trim()}”.` : "Buscando…") : "Digite código, nome, nº do PC ou cliente."}</div>}
        </div>
        <div className="ft"><span>↑↓ navegar</span><span>↵ abrir</span><span>esc fechar</span><span style={{ marginLeft: "auto" }}>também abre com /</span></div>
      </div>
    </div>
  );
}
