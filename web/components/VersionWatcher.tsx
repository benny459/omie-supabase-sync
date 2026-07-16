"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Duas UIs pra novo build:
//   1. Badge pequeno da versão atual sempre visível na top bar
//      → quando há update, vira botão verde animado "Atualizar v?"
//   2. FAIXA (banner) full-width no topo da tela quando há update
//      → chamada clara pra ação. Fixed no top do body (portal), sobrepõe tudo.
//
// Polla /api/version a cada 60s + ao ganhar foco.
export default function VersionWatcher() {
  const localVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "?";
  const localBuildId = process.env.NEXT_PUBLIC_BUILD_ID ?? "?";
  const [hasUpdate, setHasUpdate] = useState(false);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        // Detecta update quando o buildId difere. Se o cliente não tem build_id
        // válido (dev local), pula pra evitar false-positive.
        if (j.buildId && j.buildId !== "unknown" && j.buildId !== "?"
            && localBuildId !== "?" && !localBuildId.startsWith("local-")
            && j.buildId !== localBuildId) {
          setHasUpdate(true);
          setServerVersion(j.version ?? null);
        }
      } catch { /* network blip */ }
    }
    // Poll agressivo: check imediato + a cada 30s + em focus/visibilitychange.
    check();
    const id = setInterval(check, 30_000);
    const onFocus = () => check();
    const onVisibility = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [localBuildId]);

  const reload = () => {
    const u = new URL(window.location.href);
    u.searchParams.set("_v", String(Date.now()));
    window.location.replace(u.toString());
  };

  // Banner via portal — grude no top do body pra não brigar com layout do main.
  const banner = hasUpdate && !dismissed && typeof document !== "undefined"
    ? createPortal(
        <div className="fixed top-0 left-0 right-0 z-[200] bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-lg">
          <div className="px-4 md:px-6 py-2.5 flex items-center gap-3 max-w-full">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}
              className="w-5 h-5 shrink-0 animate-spin" strokeLinecap="round" strokeLinejoin="round"
              style={{ animationDuration: "3s" }}>
              <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/>
              <path d="M21 3v5h-5"/>
              <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16"/>
              <path d="M3 21v-5h5"/>
            </svg>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold leading-tight">
                🎉 Nova versão disponível{serverVersion ? ` — v${serverVersion}` : ""}
              </div>
              <div className="text-[11.5px] opacity-90 leading-tight mt-0.5">
                Atualize agora pra pegar as últimas melhorias e correções.
              </div>
            </div>
            <button onClick={reload}
              className="shrink-0 px-4 py-1.5 rounded-md bg-white text-emerald-700 hover:bg-emerald-50 font-bold text-[12px] transition shadow-sm">
              🔄 Atualizar agora
            </button>
            <button onClick={() => setDismissed(true)}
              title="Fechar (aviso reaparece no próximo check)"
              className="shrink-0 w-7 h-7 rounded flex items-center justify-center text-white/80 hover:text-white hover:bg-white/10 text-[18px] leading-none">
              ×
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {banner}
      {hasUpdate ? (
        <button
          onClick={reload}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition animate-pulse"
          title={`Nova versão${serverVersion ? ` v${serverVersion}` : ""} disponível. Clique pra atualizar.`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-3 h-3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 0 1 15.4-6.4L21 8"/>
            <path d="M21 3v5h-5"/>
            <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16"/>
            <path d="M3 21v-5h5"/>
          </svg>
          <span>Atualizar v{serverVersion ?? "?"}</span>
        </button>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold text-ww-textMuted bg-ww-bg border border-ww-border"
          title={`Versão atual do painel: v${localVersion}`}
        >
          v{localVersion}
        </span>
      )}
    </>
  );
}
