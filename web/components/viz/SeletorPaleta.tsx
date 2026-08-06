"use client";

// Seletor de paleta — o "tema de cores" do Excel, para os gráficos.
//
// Escreve `data-palette` no <html> e persiste em localStorage. Todos os gráficos
// observam esse atributo (useVizTema), então a troca repinta o painel inteiro na
// hora, sem recarregar e sem que cada tela precise saber que o seletor existe.
//
// Por que só três opções e não um color picker: cada rampa aqui PASSOU no
// validador de daltonismo. Deixar o usuário montar a própria paleta
// transformaria uma escolha de gosto num bug de leitura que ninguém rastreia —
// as cores mudam, a acessibilidade cai junto e nada avisa.

import { useEffect, useRef, useState } from "react";
import { TEMAS, TEMA_PADRAO, temaValido, type VizTema } from "@/lib/viz/palette";

const CHAVE = "ww-viz-palette";

export default function SeletorPaleta() {
  const [tema, setTema] = useState<VizTema>(TEMA_PADRAO);
  const [aberto, setAberto] = useState(false);
  const [escuro, setEscuro] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const salvo = temaValido(localStorage.getItem(CHAVE));
    setTema(salvo);
    root.setAttribute("data-palette", salvo);

    // A amostra tem que mostrar a rampa do modo em que o painel está — no claro,
    // exibir os hexes do escuro faria o usuário escolher por uma cor que não vai
    // ver.
    const lerModo = () => setEscuro(root.classList.contains("dark"));
    lerModo();
    const obs = new MutationObserver(lerModo);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Fecha ao clicar fora: sem isso o menu fica preso quando o usuário desiste.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  const aplicar = (t: VizTema) => {
    setTema(t);
    localStorage.setItem(CHAVE, t);
    document.documentElement.setAttribute("data-palette", t);
    setAberto(false);
  };

  const amostra = (t: VizTema) => (escuro ? TEMAS[t].dark : TEMAS[t].light);

  return (
    <div className="relative" ref={caixa}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        title={`Paleta dos gráficos: ${TEMAS[tema].nome}`}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-textMuted hover:text-ww-text transition"
      >
        {/* A própria rampa é o ícone — diz mais que qualquer símbolo de paleta. */}
        <span className="flex gap-[2px]" aria-hidden>
          {amostra(tema).slice(0, 5).map((c, i) => (
            <span key={i} className="w-[5px] h-3.5 rounded-[1px]" style={{ background: c }} />
          ))}
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
             className="w-3 h-3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {aberto && (
        <div role="listbox"
             className="absolute right-0 mt-1 z-50 w-[260px] rounded-lg border border-ww-border bg-ww-drawer shadow-xl p-1 animate-in fade-in-0 slide-in-from-top-1">
          <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-ww-textFaint">
            Paleta dos gráficos
          </p>
          {(Object.keys(TEMAS) as VizTema[]).map((t) => {
            const on = t === tema;
            return (
              <button
                key={t}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => aplicar(t)}
                className={`w-full text-left px-2 py-1.5 rounded-md transition flex items-start gap-2 ${
                  on ? "bg-ww-accentSoft" : "hover:bg-ww-rowHover"}`}
              >
                <span className="flex gap-[2px] mt-0.5 shrink-0" aria-hidden>
                  {amostra(t).map((c, i) => (
                    <span key={i} className="w-[7px] h-4 rounded-[1px]" style={{ background: c }} />
                  ))}
                </span>
                <span className="min-w-0">
                  <span className={`block text-[11.5px] ${on ? "text-ww-accent font-semibold" : "text-ww-text"}`}>
                    {TEMAS[t].nome}
                  </span>
                  <span className="block text-[10.5px] text-ww-textMuted leading-tight">
                    {TEMAS[t].descricao}
                  </span>
                </span>
              </button>
            );
          })}
          <p className="px-2 py-1 mt-0.5 text-[10px] text-ww-textFaint border-t border-ww-border">
            As três passaram no teste de daltonismo. Vale para todos os gráficos.
          </p>
        </div>
      )}
    </div>
  );
}
