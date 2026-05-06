"use client";

import { useEffect, useState } from "react";

// Faixa fullwidth no topo quando o servidor tem build mais novo. Polla /api/version
// a cada 60s + ao ganhar foco. Estilo padronizado com o do app.waterworks.com.br
// e propostas-ww.vercel.app.
export default function UpdateBanner() {
  const localBuildId = process.env.NEXT_PUBLIC_BUILD_ID ?? "?";
  const localVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? "?";
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
        if (j.buildId && j.buildId !== "?" && localBuildId !== "?" && j.buildId !== localBuildId) {
          setServerVersion(j.version ?? null);
        }
      } catch { /* offline */ }
    }
    check();
    const id = setInterval(check, 60_000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [localBuildId]);

  if (!serverVersion || dismissed) return null;
  if (serverVersion === localVersion && localBuildId === "?") return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0,
        zIndex: 9999,
        background: "linear-gradient(135deg, #f59e0b, #ef4444)",
        color: "#fff",
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        boxShadow: "0 4px 20px rgba(0,0,0,.3)",
        animation: "wwUpdatePulse 2s ease-in-out infinite",
      }}
    >
      <style>{`@keyframes wwUpdatePulse { 0%,100% { opacity: 1; } 50% { opacity: .85; } }`}</style>
      <span style={{ fontSize: 20 }}>🔄</span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>
        Nova versão disponível {serverVersion ? `(v${serverVersion})` : ""}
      </span>
      <button
        onClick={() => {
          const u = new URL(window.location.href);
          u.searchParams.set("_v", String(Date.now()));
          window.location.replace(u.toString());
        }}
        style={{
          padding: "6px 16px",
          borderRadius: 8,
          border: "2px solid #fff",
          background: "rgba(255,255,255,.2)",
          color: "#fff",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 800,
          backdropFilter: "blur(4px)",
        }}
      >
        Atualizar agora
      </button>
      <button
        onClick={() => setDismissed(true)}
        title="Fechar"
        style={{
          background: "none",
          border: "none",
          color: "rgba(255,255,255,.7)",
          cursor: "pointer",
          fontSize: 18,
          lineHeight: 1,
          padding: "0 4px",
        }}
      >
        ✕
      </button>
    </div>
  );
}
