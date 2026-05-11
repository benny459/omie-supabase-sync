"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

/**
 * Toggle 3-states: light → dark → system (segue prefers-color-scheme).
 * Persiste em localStorage (`ww-theme`). Aplica `.dark` no <html> imediatamente.
 * Lê o valor inicial direto do <html> — o script inline em layout.tsx já
 * aplicou a classe correta antes da hidratação.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const saved = (localStorage.getItem("ww-theme") as Theme) || "system";
    setTheme(saved);
  }, []);

  function apply(t: Theme) {
    setTheme(t);
    localStorage.setItem("ww-theme", t);
    const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const wantsDark = t === "dark" || (t === "system" && sysDark);
    document.documentElement.classList.toggle("dark", wantsDark);
  }

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
