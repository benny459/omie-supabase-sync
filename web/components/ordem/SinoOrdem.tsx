"use client";

/**
 * Barra do topo: "✦ Meu dia" (Central de Ordem) + sino de avisos + diálogo de entrada.
 * Só aparece para quem a Central está visível (/api/ordem/estado). Sino e diálogo só
 * quando o administrador os liga. O diálogo abre uma vez por dia, ou quando há aviso novo.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MODULO_POR_ID } from "@/lib/ordem/modulos";
import type { ModuloOrdem } from "@/lib/ordem/tipos";

export type EstadoOrdem = { central: boolean; modulos: ModuloOrdem[]; admin?: boolean; sino: boolean; dialogo: boolean };
type Aviso = { id: number; tipo: string; item_id: string | null; texto: string; criado_em: string; lido_em: string | null };
type Avisos = { ligado: boolean; dialogo?: boolean; nome?: string; n: number; avisos: Aviso[];
  resumo?: { total: number; porModulo: Record<string, number>; primeiro: { id: string; modulo: ModuloOrdem; titulo: string; acao: string } | null } };

const CHAVE = "ordem-estado";

/** Estado da Central para a barra (cache de 2 min na sessão do navegador). */
export function useEstadoOrdem(pathname: string): EstadoOrdem | null {
  const [e, setE] = useState<EstadoOrdem | null>(null);
  useEffect(() => {
    let vivo = true;
    try {
      const c = JSON.parse(sessionStorage.getItem(CHAVE) ?? "null") as { em: number; e: EstadoOrdem } | null;
      if (c?.e) { setE(c.e); if (Date.now() - c.em < 120_000) return; }
    } catch { /* sem cache */ }
    fetch("/api/ordem/estado", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!vivo || !j) return;
      setE(j as EstadoOrdem);
      try { sessionStorage.setItem(CHAVE, JSON.stringify({ em: Date.now(), e: j })); } catch { /* ok */ }
    }).catch(() => null);
    return () => { vivo = false; };
  }, [pathname]);
  return e;
}

export default function SinoOrdem({ estado }: { estado: EstadoOrdem }) {
  const [av, setAv] = useState<Avisos | null>(null);
  const [aberto, setAberto] = useState(false);
  const [dialogo, setDialogo] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    if (!estado.sino && !estado.dialogo) return;
    const r = await fetch("/api/ordem/avisos", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const j = (await r.json()) as Avisos;
    setAv(j);
    // diálogo de entrada: uma vez por dia, ou quando há aviso novo não lido
    if (j.dialogo) {
      const hoje = new Date().toISOString().slice(0, 10);
      let visto = ""; let ultimo = 0;
      try { visto = localStorage.getItem("ordem-dialogo-dia") ?? ""; ultimo = Number(localStorage.getItem("ordem-dialogo-aviso") ?? 0); } catch { /* ok */ }
      const maior = Math.max(0, ...j.avisos.filter((a) => !a.lido_em).map((a) => a.id));
      if (visto !== hoje || maior > ultimo) setDialogo(true);
    }
  }, [estado.sino, estado.dialogo]);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    if (!aberto) return;
    const f = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f);
  }, [aberto]);

  function fecharDialogo() {
    setDialogo(false);
    try {
      localStorage.setItem("ordem-dialogo-dia", new Date().toISOString().slice(0, 10));
      localStorage.setItem("ordem-dialogo-aviso", String(Math.max(0, ...(av?.avisos ?? []).map((a) => a.id))));
    } catch { /* ok */ }
  }
  async function marcarLidos() {
    await fetch("/api/ordem/avisos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lidos: "todos" }) }).catch(() => null);
    void carregar();
  }

  return (
    <div ref={caixa} style={{ position: "relative", display: "flex", gap: 4, alignItems: "center" }}>
      <a className="ab-icone" href="/ordem" title="Meu dia — Central de Ordem (Aria)" aria-label="Meu dia — Central de Ordem"
        style={{ display: "grid", placeItems: "center", textDecoration: "none", fontWeight: 700 }}>✦</a>
      {estado.sino && (
        <button type="button" className="ab-icone" aria-label={`Avisos${av?.n ? ` (${av.n} novos)` : ""}`} title="Avisos da Central de Ordem"
          data-aberto={aberto ? "1" : undefined} onClick={() => setAberto((v) => !v)} style={{ position: "relative" }}>
          <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
          </svg>
          {!!av?.n && <em className="ab-contador" style={{ position: "absolute", top: -4, right: -4 }}>{av.n}</em>}
        </button>
      )}
      {aberto && av && (
        <div className="ab-painel" style={{ display: "block", right: 0, width: 340 }}>
          <div className="ab-titulo">Avisos</div>
          {av.avisos.length === 0 && <div className="ab-nota" style={{ padding: "6px 10px" }}>Sem avisos.</div>}
          {av.avisos.slice(0, 12).map((a) => (
            <a key={a.id} className="ab-item" href={a.item_id ? `/ordem?item=${a.item_id}` : "/ordem"} style={{ fontWeight: a.lido_em ? 400 : 600, whiteSpace: "normal", alignItems: "flex-start" }}>
              <span style={{ fontSize: 12.5 }}>{a.texto}{a.item_id ? " · Ir para o item ↗" : ""}</span>
            </a>
          ))}
          <div className="ab-sep" />
          <div className="ab-linha" style={{ gap: 8 }}>
            <a className="ab-item" href="/ordem" style={{ flex: 1 }}>Abrir Meu dia</a>
            {!!av.n && <button type="button" className="ab-item" onClick={marcarLidos}>Marcar lidos</button>}
          </div>
        </div>
      )}
      {dialogo && av && <DialogoEntrada av={av} onFechar={fecharDialogo} />}
    </div>
  );
}

function DialogoEntrada({ av, onFechar }: { av: Avisos; onFechar: () => void }) {
  const btn = useRef<HTMLAnchorElement | HTMLButtonElement | null>(null);
  useEffect(() => {
    btn.current?.focus();
    const f = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  }, [onFechar]);
  const r = av.resumo;
  const novos = av.avisos.filter((a) => !a.lido_em).slice(0, 4);
  const hora = new Date().getHours();
  const saud = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const partes = Object.entries(r?.porModulo ?? {}).map(([m, n]) => `${n} em ${MODULO_POR_ID[m as ModuloOrdem]?.rotulo ?? m}`);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(5,10,20,.45)", display: "grid", placeItems: "center", padding: 16 }} onClick={onFechar}>
      <div role="dialog" aria-modal="true" aria-labelledby="ordem-entrada-t" onClick={(e) => e.stopPropagation()} style={{
        width: "min(520px, 100%)", borderRadius: 16, padding: "20px 22px", background: "var(--ww-panel)", color: "var(--ww-text)",
        border: "1px solid var(--ww-border-strong)", boxShadow: "var(--shadow-float)", display: "flex", flexDirection: "column", gap: 12,
      }}>
        <div style={{ fontSize: 12, color: "var(--ww-violet-text)", fontWeight: 700 }}>✦ Aria</div>
        <h2 id="ordem-entrada-t" style={{ margin: 0, fontSize: 20 }}>{saud}, {av.nome}</h2>
        {novos.map((a) => <div key={a.id} style={{ fontSize: 13.5 }}>🔔 {a.texto}</div>)}
        {r && r.total > 0 ? (
          <>
            <div style={{ fontSize: 13.5 }}>Tem <b>{r.total}</b> item(ns) para pôr em ordem: {partes.join(", ")}.</div>
            {r.primeiro && (
              <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--ww-violet-soft)", fontSize: 13.5 }}>
                <b>Comece por aqui:</b> {r.primeiro.titulo}<div style={{ color: "var(--ww-text-2)", marginTop: 3 }}>{r.primeiro.acao}</div>
              </div>
            )}
          </>
        ) : <div style={{ fontSize: 13.5 }}>✓ Tudo em ordem nos seus módulos. A Aria avisa quando entrar algo novo.</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button type="button" onClick={onFechar} style={{ height: 34, padding: "0 14px", borderRadius: 10, border: "1px solid var(--ww-border-strong)", background: "transparent", color: "var(--ww-text-2)", cursor: "pointer" }}>Mais tarde</button>
          {r?.primeiro && (
            <a ref={(el) => { btn.current = el; }} href={`/ordem?m=${r.primeiro.modulo}&item=${r.primeiro.id}`} onClick={onFechar} style={{
              height: 34, padding: "0 16px", borderRadius: 10, display: "inline-flex", alignItems: "center", fontWeight: 600, textDecoration: "none",
              background: "linear-gradient(180deg,var(--ww-brand-2),var(--ww-brand-1))", color: "#fff",
            }}>Resolver agora</a>
          )}
        </div>
      </div>
    </div>
  );
}
