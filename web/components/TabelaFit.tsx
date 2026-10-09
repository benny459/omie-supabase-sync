"use client";

/**
 * Peças do utilitário .tbl-fit (app/tbl-fit.css, 09/10/26):
 * - TblFit: o contentor que rola, marca .tf-rola quando há rolagem
 *   horizontal (a sombra da coluna presa só aparece aí).
 * - useTblFit: o mesmo, para quem já tem o seu próprio <div> contentor.
 * - MenuMais: o "⋯" das ações secundárias, em position: fixed para não ser
 *   cortado pelo overflow da tabela.
 */
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";

export function useTblFit<T extends HTMLElement>(ref: RefObject<T | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ver = () => el.classList.toggle("tf-rola", el.scrollWidth > el.clientWidth + 1);
    ver();
    const ro = new ResizeObserver(ver);
    ro.observe(el);
    const t = el.querySelector("table");
    if (t) ro.observe(t);
    return () => ro.disconnect();
  }, [ref]);
}

export function TblFit({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useTblFit(ref);
  return <div ref={ref} className={`tbl-fit${className ? ` ${className}` : ""}`} style={style}>{children}</div>;
}

export type AcaoMais = { label: string; onClick: () => void; disabled?: boolean; title?: string; tom?: string };

export function MenuMais({ acoes, titulo = "Mais ações" }: { acoes: AcaoMais[]; titulo?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const fechar = () => setPos(null);
    const fora = (e: globalThis.MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) fechar();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", fechar, true);
    window.addEventListener("resize", fechar);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", fechar, true);
      window.removeEventListener("resize", fechar);
    };
  }, [pos]);
  if (acoes.length === 0) return null;
  const abrir = (e: MouseEvent) => {
    e.stopPropagation();
    if (pos) { setPos(null); return; }
    const r = btn.current!.getBoundingClientRect();
    const larg = 220, alt = acoes.length * 36 + 14;
    const top = r.bottom + 4 + alt > window.innerHeight ? Math.max(8, r.top - 4 - alt) : r.bottom + 4;
    setPos({ top, left: Math.max(8, Math.min(r.right - larg, window.innerWidth - larg - 8)) });
  };
  return (
    <>
      <button ref={btn} type="button" className="tf-mais-btn" aria-haspopup="menu" aria-expanded={!!pos} title={titulo} aria-label={titulo} onClick={abrir}>⋯</button>
      {pos && (
        <div ref={menu} className="tf-mais-menu" role="menu" style={{ top: pos.top, left: pos.left, width: 220 }} onClick={(e) => e.stopPropagation()}>
          {acoes.map((a) => (
            <button key={a.label} type="button" role="menuitem" disabled={a.disabled} title={a.title} style={a.tom ? { color: a.tom } : undefined}
              onClick={() => { setPos(null); a.onClick(); }}>{a.label}</button>
          ))}
        </div>
      )}
    </>
  );
}
