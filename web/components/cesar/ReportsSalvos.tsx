"use client";

// "Reports do Cesar" — a seção no fim das telas de BI com os reports que
// alguém pediu ao Cesar e mandou incorporar ao controle da tela.
//
// Montado UMA vez no layout do grupo (app), não página a página: o componente
// lê a pathname e só existe nas telas suportadas. Cinco montagens idênticas em
// cinco pages seriam cinco lugares pra esquecer quando a lista mudar.
//
// Quem vê: qualquer pessoa com acesso à tela (a API repete a régua de área da
// própria tela). Quem exclui: só admin — o report é compartilhado por todo
// mundo que vê a tela, não é rascunho pessoal.

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useUserPerms } from "@/components/UserPermsProvider";
import { TELAS_REPORT } from "@/lib/cesar/ferramentas";
import type { ReportPayload } from "@/lib/cesar/report-pdf";

type Rep = {
  id: string;
  tela: string;
  titulo: string;
  payload: ReportPayload;
  criado_por: string | null;
  created_at: string;
};

export default function ReportsSalvos() {
  const pathname = usePathname();
  const perms = useUserPerms();
  const suportada = TELAS_REPORT.includes(pathname ?? "");

  const [reports, setReports] = useState<Rep[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  const carregar = useCallback(async (tela: string) => {
    try {
      const r = await fetch(`/api/cesar/reports?tela=${encodeURIComponent(tela)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 403 = a pessoa vê a tela por outra régua mas não a área da API —
        // nesse caso a seção simplesmente não aparece, sem alarde.
        setReports([]);
        if (r.status !== 401 && r.status !== 403) setErro(j.error ?? r.statusText);
        return;
      }
      setReports((j.reports ?? []) as Rep[]);
    } catch (e) {
      setReports([]);
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    setErro(null);
    if (!suportada || !pathname) { setReports(null); return; }
    void carregar(pathname);
  }, [pathname, suportada, carregar]);

  if (!suportada || !reports || reports.length === 0) {
    // Sem reports não há seção — uma moldura vazia no fim de toda tela de BI
    // seria ruído permanente por um recurso ocasional.
    return erro && suportada
      ? <p className="mt-6 text-[11px] text-rose-500">Reports do Cesar: {erro}</p>
      : null;
  }

  const baixar = async (rep: Rep) => {
    setBaixando(rep.id);
    try {
      const { gerarReportPDF } = await import("@/lib/cesar/report-pdf");
      gerarReportPDF(rep.payload);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setBaixando(null);
    }
  };

  const excluir = async (rep: Rep) => {
    if (!window.confirm(`Excluir o report "${rep.titulo}"? Ele some para todo mundo que vê esta tela.`)) return;
    const anterior = reports;
    setReports(reports.filter((r) => r.id !== rep.id));
    const resp = await fetch(`/api/cesar/reports?id=${rep.id}`, { method: "DELETE" });
    if (!resp.ok) {
      setReports(anterior);   // desfaz o otimismo
      const j = await resp.json().catch(() => ({}));
      setErro(j.error ?? resp.statusText);
    }
  };

  return (
    <section className="mt-8 rounded-xl border border-ww-border bg-ww-panel/60">
      <header className="flex items-center gap-2 px-3.5 py-2.5 border-b border-ww-border">
        <span aria-hidden className="w-5 h-5 rounded-full bg-gradient-to-br from-sky-500 to-violet-500
                                      text-white text-[9px] font-bold grid place-items-center shrink-0">C</span>
        <h2 className="text-[12.5px] font-semibold text-ww-text">Reports do Cesar</h2>
        <span className="text-[10.5px] text-ww-textFaint">
          incorporados ao controle desta tela · os números são os do dia em que o report foi gerado
        </span>
      </header>

      {erro && <p className="px-3.5 pt-2 text-[11px] text-rose-500">{erro}</p>}

      <ul className="divide-y divide-ww-border">
        {reports.map((rep) => (
          <li key={rep.id} className="flex items-center gap-3 px-3.5 py-2 hover:bg-ww-rowHover transition-colors">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-ww-text truncate">{rep.titulo}</div>
              <div className="text-[10px] text-ww-textFaint truncate">
                {new Date(rep.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                {rep.criado_por ? ` · pedido por ${rep.criado_por}` : ""}
              </div>
            </div>
            <button type="button" onClick={() => void baixar(rep)} disabled={baixando === rep.id}
              className="shrink-0 px-2.5 py-1 text-[11px] rounded-lg border border-ww-border text-ww-textMuted
                         hover:text-ww-text hover:border-ww-accent/50 hover:bg-ww-rowHover transition
                         disabled:opacity-40">
              {baixando === rep.id ? "gerando…" : "Baixar PDF"}
            </button>
            {perms?.is_admin && (
              <button type="button" onClick={() => void excluir(rep)} title="Excluir este report (só admin)"
                className="shrink-0 px-2 py-1 text-[11px] rounded-lg text-ww-textFaint
                           hover:text-rose-500 hover:bg-rose-500/10 transition">
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
