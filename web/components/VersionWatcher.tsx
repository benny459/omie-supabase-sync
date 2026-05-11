"use client";

import { useEffect, useState } from "react";

// Mostra a versão atual SEMPRE visível na top bar (badge pequeno).
// Quando o servidor tem build novo, vira botão verde animado "atualizar".
// Polla /api/version a cada 60s + ao ganhar foco.
export default function VersionWatcher() {
  const localVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "?";
  const localBuildId = process.env.NEXT_PUBLIC_BUILD_ID ?? "?";
  const [hasUpdate, setHasUpdate] = useState(false);
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        if (j.buildId && j.buildId !== "?" && localBuildId !== "?" && j.buildId !== localBuildId) {
          setHasUpdate(true);
          setServerVersion(j.version ?? null);
        }
      } catch { /* network blip — tenta de novo no próximo ciclo */ }
    }
    check();
    const id = setInterval(check, 60_000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [localBuildId]);

  if (hasUpdate) {
    return (
      <button
        onClick={() => {
          const u = new URL(window.location.href);
          u.searchParams.set("_v", String(Date.now()));
          window.location.replace(u.toString());
        }}
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
    );
  }

  // Estado normal: badge subtle com versão atual
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold text-ww-textMuted bg-ww-bg border border-ww-border"
      title={`Versão atual do painel: v${localVersion}`}
    >
      v{localVersion}
    </span>
  );
}
