"use client";

/**
 * Projetos ativos (08/10/26, pedido do Benny): "em um menu superior, rapidamente apontar em
 * ordem decrescente os projetos ativos". A marca ★ é por projeto e compartilhada por todo mundo
 * (approval.rc_projetos_budget.ativo, sql/130 — via /api/rc-projetos/ativos).
 *
 *  • useProjetosAtivos(): carrega a lista e marca/desmarca (otimista, desfaz se o servidor recusar).
 *  • <ProjetosAtivosMenu>: botão "★ Projetos ativos (N)" + busca; escolher pula para o projeto.
 *    Digitando, também aparecem os projetos não marcados, com ☆ para marcar ali mesmo.
 *  • <EstrelaAtivo>: o ★/☆ de um projeto (no cartão e no cabeçalho da página do projeto).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUserPerms } from "../UserPermsProvider";
import { canEdit } from "@/lib/permissions";

export type ProjetoAtivoInfo = { empresa: string; codigo_projeto: number; nome: string | null; cliente: string | null };
export const chaveProjeto = (empresa: string, codigo: number | string) => `${String(empresa || "SF").toUpperCase()}|${Number(codigo)}`;

/** Número do projeto para ordenar: "PJ364_Diaverum…" → 364; sem PJ, null (vai para o fim). */
export function numeroPj(nome: string | null | undefined): number | null {
  const m = /PJ[\s_-]*(\d+)/i.exec(nome ?? "");
  return m ? Number(m[1]) : null;
}

export function useProjetosAtivos(ligado = true) {
  const [disponivel, setDisponivel] = useState<boolean | null>(null);
  const [lista, setLista] = useState<ProjetoAtivoInfo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/rc-projetos/ativos", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setDisponivel(false); setErro(j.error ?? r.statusText); return; }
      setDisponivel(!!j.disponivel);
      setLista((j.ativos ?? []) as ProjetoAtivoInfo[]);
    } catch (e) { setDisponivel(false); setErro(String(e)); }
  }, []);
  useEffect(() => { if (ligado) void carregar(); }, [carregar, ligado]);
  const chaves = useMemo(() => new Set(lista.map((p) => chaveProjeto(p.empresa, p.codigo_projeto))), [lista]);

  const alternar = useCallback(async (p: ProjetoAtivoInfo, ativo: boolean): Promise<string | null> => {
    const k = chaveProjeto(p.empresa, p.codigo_projeto);
    const antes = lista;
    setLista((l) => (ativo ? [...l.filter((x) => chaveProjeto(x.empresa, x.codigo_projeto) !== k), p] : l.filter((x) => chaveProjeto(x.empresa, x.codigo_projeto) !== k)));
    try {
      const r = await fetch("/api/rc-projetos/ativos", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ empresa: p.empresa, codigo_projeto: p.codigo_projeto, ativo }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setLista(antes); return j.error ?? r.statusText; }
      return null;
    } catch (e) { setLista(antes); return String(e); }
  }, [lista]);

  return { disponivel, lista, chaves, alternar, erro, recarregar: carregar };
}

/** ★ ativo / ☆ marcar — para no clique (o cabeçalho do cartão abre/fecha). */
export function EstrelaAtivo({ ativo, pode, onAlternar, tamanho = 15 }: {
  ativo: boolean; pode: boolean; onAlternar: () => void; tamanho?: number;
}) {
  return (
    <button type="button"
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); if (pode) onAlternar(); }}
      disabled={!pode}
      aria-pressed={ativo}
      title={ativo ? (pode ? "Projeto ativo — clique para tirar dos ativos" : "Projeto ativo")
        : (pode ? "Marcar como projeto ativo (aparece no filtro “Só ativos” e no menu de projetos ativos)" : "Projeto não marcado como ativo")}
      className={`inline-flex items-center justify-center leading-none rounded px-0.5 transition ${pode ? "cursor-pointer hover:scale-110" : "cursor-default"} ${ativo ? "text-amber-400" : "text-ww-textFaint opacity-60 hover:opacity-100"}`}
      style={{ fontSize: tamanho, background: "none", border: 0, color: ativo ? "#f5b301" : "var(--ww-text-faint, #8a94a8)" }}>
      {ativo ? "★" : "☆"}
    </button>
  );
}

export type ItemMenu = { empresa: string; codigo: number; nome: string; cliente?: string | null; ativo: boolean };

export default function ProjetosAtivosMenu({ itens, onEscolher, onAlternar, pode, disponivel, atual, direita = false }: {
  /** Todos os projetos conhecidos (os ativos vêm marcados); só os ativos se a tela não conhece os outros. */
  itens: ItemMenu[];
  onEscolher: (it: ItemMenu) => void;
  onAlternar?: (it: ItemMenu, ativo: boolean) => void;
  pode: boolean;
  disponivel: boolean | null;
  /** chave do projeto aberto (página do projeto) — destacado na lista */
  atual?: string;
  /** abre o painel alinhado à direita do botão (cabeçalho da página do projeto) */
  direita?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);
  const busca = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    setTimeout(() => busca.current?.focus(), 0);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  const ordenar = (a: ItemMenu[]) => [...a].sort((x, y) => {
    const nx = numeroPj(x.nome), ny = numeroPj(y.nome);
    if (nx != null && ny != null && nx !== ny) return ny - nx;
    if (nx != null && ny == null) return -1;
    if (nx == null && ny != null) return 1;
    return y.codigo - x.codigo;
  });
  const qq = q.trim().toLowerCase();
  const casa = (it: ItemMenu) => !qq || `${it.nome} ${it.cliente ?? ""} ${it.empresa}`.toLowerCase().includes(qq);
  const ativos = useMemo(() => ordenar(itens.filter((i) => i.ativo)), [itens]); // eslint-disable-line react-hooks/exhaustive-deps
  const vAtivos = ativos.filter(casa);
  const vOutros = qq ? ordenar(itens.filter((i) => !i.ativo && casa(i))).slice(0, 40) : [];
  const navegaveis = [...vAtivos, ...vOutros];
  useEffect(() => { setCursor(0); }, [q, aberto]);

  const escolher = (it: ItemMenu) => { setAberto(false); setQ(""); onEscolher(it); };
  const linha = (it: ItemMenu, i: number) => {
    const k = chaveProjeto(it.empresa, it.codigo);
    return (
      <div key={k} role="option" aria-selected={i === cursor}
        onMouseEnter={() => setCursor(i)}
        onClick={() => escolher(it)}
        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer ${i === cursor ? "bg-ww-rowHover" : ""} ${k === atual ? "ring-1 ring-ww-accent/60" : ""}`}>
        {onAlternar
          ? <EstrelaAtivo ativo={it.ativo} pode={pode && disponivel === true} onAlternar={() => onAlternar(it, !it.ativo)} tamanho={14} />
          : <span className="text-amber-400 text-[14px]">★</span>}
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold text-ww-text truncate">{it.nome}</span>
          {(it.cliente || it.empresa !== "SF") && (
            <span className="block text-[11px] text-ww-textMuted truncate">{[it.cliente, it.empresa !== "SF" ? it.empresa : ""].filter(Boolean).join(" · ")}</span>
          )}
        </span>
        <span className="text-[11px] text-ww-textFaint shrink-0">→</span>
      </div>
    );
  };

  return (
    <div ref={caixa} className="relative" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setAberto((x) => !x)}
        className="inline-flex items-center gap-1.5 h-[32px] px-3 rounded-lg border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-[12.5px] font-semibold text-ww-text transition"
        title="Lista os projetos marcados como ativos, do mais novo para o mais antigo — escolha um para ir direto a ele">
        <span className="text-amber-400">★</span> Projetos ativos <span className="text-ww-textMuted font-normal">({ativos.length})</span> <span className="text-ww-textFaint text-[10px]">▾</span>
      </button>
      {aberto && (
        <div className={`absolute ${direita ? "right-0" : "left-0"} top-[38px] z-50 w-[min(420px,92vw)] rounded-xl border border-ww-border bg-ww-panel shadow-2xl p-1.5`}
          role="listbox"
          onKeyDown={(e) => {
            if (e.key === "Escape") { setAberto(false); return; }
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, navegaveis.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            if (e.key === "Enter" && navegaveis[cursor]) { e.preventDefault(); escolher(navegaveis[cursor]); }
          }}>
          <input ref={busca} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={onAlternar ? "Buscar projeto ou cliente… (também os não marcados)" : "Buscar projeto ou cliente…"}
            className="w-full h-[32px] px-2.5 mb-1 rounded-md border border-ww-border bg-transparent text-[12.5px] text-ww-text outline-none focus:border-ww-accent" />
          {disponivel === false && (
            <p className="px-2.5 py-2 text-[11.5px] text-ww-warnText">A marcação de projetos ativos ainda não está ligada no banco — por enquanto aparecem todos.</p>
          )}
          <div className="max-h-[min(60vh,460px)] overflow-auto">
            {vAtivos.length > 0 && <div className="px-2.5 pt-1 pb-0.5 text-[10.5px] uppercase tracking-wider text-ww-textFaint">Ativos · mais novo primeiro</div>}
            {vAtivos.map((it, i) => linha(it, i))}
            {disponivel !== false && ativos.length === 0 && !qq && (
              <p className="px-2.5 py-2 text-[12px] text-ww-textMuted">Nenhum projeto marcado ainda. Digite acima para achar um projeto e marque com ☆, ou use a ☆ no cartão do projeto.</p>
            )}
            {vOutros.length > 0 && <div className="px-2.5 pt-2 pb-0.5 text-[10.5px] uppercase tracking-wider text-ww-textFaint">Outros projetos {pode ? "· ☆ marca como ativo" : ""}</div>}
            {vOutros.map((it, i) => linha(it, vAtivos.length + i))}
            {qq && !navegaveis.length && <p className="px-2.5 py-2 text-[12px] text-ww-textMuted">Nenhum projeto com “{q}”.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Cabeçalho da página do projeto: ★ do projeto aberto + menu para pular entre os ativos. */
export function ProjetoAtivosCabecalho({ empresa, codigo, nome, cliente }: { empresa: string; codigo: number; nome: string; cliente?: string | null }) {
  const user = useUserPerms();
  const pode = !!user && (user.is_admin || user.role === "admin" || canEdit(user, "projetos", "rc") || canEdit(user, "projetos", "pc"));
  const pa = useProjetosAtivos();
  const [aviso, setAviso] = useState<string | null>(null);
  const atual = chaveProjeto(empresa, codigo);
  const itens: ItemMenu[] = pa.lista.map((a) => ({ empresa: a.empresa, codigo: a.codigo_projeto, nome: a.nome || `Projeto ${a.codigo_projeto}`, cliente: a.cliente, ativo: true }));
  const alternar = (ativo: boolean) => {
    setAviso(null);
    void pa.alternar({ empresa: empresa.toUpperCase(), codigo_projeto: codigo, nome, cliente: cliente ?? null }, ativo).then((e) => { if (e) setAviso(e); });
  };
  if (pa.disponivel === false) return null;
  return (
    <div className="flex items-center gap-2">
      {pa.disponivel && (
        <span className="inline-flex items-center gap-1 h-[32px] px-2 rounded-lg border border-ww-border bg-ww-panel text-[12px] text-ww-textMuted">
          <EstrelaAtivo ativo={pa.chaves.has(atual)} pode={pode} onAlternar={() => alternar(!pa.chaves.has(atual))} />
          {pa.chaves.has(atual) ? "Ativo" : "Não ativo"}
        </span>
      )}
      <ProjetosAtivosMenu itens={itens} pode={pode} disponivel={pa.disponivel} atual={atual} direita
        onEscolher={(it) => { window.location.href = `/projetos/${it.codigo}/materiais?empresa=${encodeURIComponent(it.empresa)}`; }}
        onAlternar={(it, ativo) => { void pa.alternar({ empresa: it.empresa, codigo_projeto: it.codigo, nome: it.nome, cliente: it.cliente ?? null }, ativo).then((e) => { if (e) setAviso(e); }); }} />
      {aviso && <span className="text-[11.5px] text-ww-critText">{aviso}</span>}
    </div>
  );
}
