"use client";

import { definirAparencia, useAparencia } from "@/lib/aparencia-store";

type Theme = "light" | "dark" | "system";

/**
 * Toggle 3-states: light → dark → system (segue prefers-color-scheme).
 * Grava no mesmo sítio do painel de Aparência (lib/aparencia-store).
 */
export default function ThemeToggle() {
  const modo = useAparencia().modo;
  const theme: Theme = modo === "claro" ? "light" : modo === "sistema" ? "system" : "dark";
  const apply = (t: Theme) => definirAparencia({ modo: t === "light" ? "claro" : t === "system" ? "sistema" : "escuro" });

  function cycle() {
    const next: Theme = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    apply(next);
  }

  return (
    <button
      onClick={cycle}
      title={`Tema: ${theme} (clique pra alternar)`}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-textMuted hover:text-ww-text transition"
    >
      {theme === "light" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
      )}
      {theme === "dark" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
      {theme === "system" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <path d="M8 21h8M12 17v4"/>
        </svg>
      )}
    </button>
  );
}
