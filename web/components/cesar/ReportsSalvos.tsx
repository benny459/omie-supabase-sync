"use client";

// Menu "Reports do Cesar" no TOPO das telas de BI suportadas (v3, 13/09):
// um botão alinhado à direita, em LINHA PRÓPRIA no fluxo normal — nunca
// flutuando por cima dos botões da tela (lição do FMEF v1.75.20). Cada item
// NAVEGA para a página do report (/reports-cesar/[id]); é lá que vivem os
// downloads, o mini-ajuste de compartilhamento e o "Ajustar com o Cesar".
//
// Montado UMA vez no layout do grupo (app): o componente lê a pathname e só
// existe nas telas suportadas. Some quando a tela não tem report visível.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useUserPerms } from "@/components/UserPermsProvider";
import { TELAS_REPORT } from "@/lib/cesar/ferramentas";
import type { ReportPayload } from "@/lib/cesar/report-pdf";

type Rep = {
  id: string;
  tela: string;
  titulo: string;
  payload: ReportPayload;
  criado_por: string | null;
  visibilidade: string;
  created_at: string;
};

export default function ReportsSalvos({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const perms = useUserPerms();
  const suportada = TELAS_REPORT.includes(pathname ?? "");

  const [reports, setReports] = useState<Rep[] | null>(null);
  const [aberto, setAberto] = useState(false);
  // Dropdown em PORTAL no body: nenhum botão da página vaza por cima.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);
  const email = (userEmail || "").toLowerCase();

  const carregar = useCallback(async (tela: string) => {
    try {
      const r = await fetch(`/api/cesar/reports?tela=${encodeURIComponent(tela)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      setReports(r.ok ? ((j.reports ?? []) as Rep[]) : []);
    } catch {
      setReports([]);
    }
  }, []);

  useEffect(() => {
    setAberto(false);
    if (!suportada || !pathname) { setReports(null); return; }
    void carregar(pathname);
  }, [pathname, suportada, carregar]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || painelRef.current?.contains(t)) return;
      setAberto(false);
    };
    const fecha = () => setAberto(false);
    document.addEventListener("mousedown", fora);
    window.addEventListener("scroll", fecha, true);
    window.addEventListener("resize", fecha);
    return () => {
      document.removeEventListener("mousedown", fora);
      window.removeEventListener("scroll", fecha, true);
      window.removeEventListener("resize", fecha);
    };
  }, [aberto]);

  if (!suportada || !reports || reports.length === 0) return null;

  const excluir = async (rep: Rep) => {
    if (!window.confirm(`Excluir o report "${rep.titulo}"?`)) return;
    const anterior = reports;
    setReports(reports.filter((r) => r.id !== rep.id));
    const resp = await fetch(`/api/cesar/reports?id=${rep.id}`, { method: "DELETE" });
    if (!resp.ok) setReports(anterior);
  };

  return (
    <div className="relative z-40 mb-3 flex justify-end">
      <div ref={boxRef} className="relative inline-block">
        <button type="button"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
            setAberto((a) => !a);
          }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11.5px] rounded-lg border border-ww-border
                     bg-ww-panel text-ww-textMuted hover:text-ww-text hover:border-ww-accent/50 shadow-sm transition">
          <span aria-hidden className="w-4 h-4 rounded-full bg-gradient-to-br from-sky-500 to-violet-500
                                        text-white text-[8px] font-bold grid place-items-center shrink-0">C</span>
          Reports do Cesar
          <span className="rounded-full bg-ww-accent/15 px-1.5 text-[10px] font-bold text-ww-accent">{reports.length}</span>
          <span aria-hidden className={`text-[9px] transition-transform ${aberto ? "rotate-180" : ""}`}>▾</span>
        </button>
        {aberto && pos && createPortal(
          <div ref={painelRef}
            className="fixed z-[45] w-[340px] max-h-[60vh] overflow-y-auto rounded-xl border
                       border-ww-border bg-ww-panel shadow-2xl p-1.5"
            style={{ top: pos.top, right: pos.right }}>
            {reports.map((rep) => {
              const dono = (rep.criado_por || "").toLowerCase() === email;
              return (
                <div key={rep.id} className="group flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-ww-rowHover transition-colors">
                  <button type="button" className="min-w-0 flex-1 text-left" title="Abrir o report na tela"
                    onClick={() => { setAberto(false); router.push(`/reports-cesar/${rep.id}`); }}>
                    <span className="flex items-center gap-1.5 text-[12px] text-ww-text">
                      <span className="truncate group-hover:text-ww-accent">{rep.titulo}</span>
                      {rep.visibilidade === "proprio" && (
                        <span title="Visível só para você" className="shrink-0 text-[10px] text-amber-500">🔒</span>
                      )}
                      {rep.visibilidade === "custom" && (
                        <span title="Compartilhado com pessoas específicas" className="shrink-0 text-[10px] text-sky-500">◉</span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-ww-textFaint truncate">
                      {new Date(rep.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                      {rep.criado_por ? ` · ${rep.criado_por.split("@")[0]}` : ""}
                    </span>
                  </button>
                  {(perms?.is_admin || dono) && (
                    <button type="button" onClick={() => void excluir(rep)} title="Excluir este report"
                      className="shrink-0 px-1.5 py-0.5 text-[11px] rounded text-ww-textFaint opacity-0
                                 group-hover:opacity-100 hover:text-rose-500 hover:bg-rose-500/10 transition">
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>,
          document.body
        )}
      </div>
    </div>
  );
}
