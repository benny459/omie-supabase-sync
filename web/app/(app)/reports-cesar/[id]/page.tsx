"use client";

// A página do report incorporado — destino do menu "Reports do Cesar" (v3).
// Busca o payload (área da tela + régua de visibilidade) e entrega a tela
// navegável; PDF/Excel/mini-ajuste/Ajustar-com-o-Cesar só aqui.
// Quando o Cesar atualiza o report pela conversa, o evento
// "cesar:report-atualizado" recarrega os dados sem sair da página.

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ReportView from "@/components/cesar/ReportView";
import type { ReportPayload } from "@/lib/cesar/report-pdf";

type Row = {
  id: string; tela: string; titulo: string; payload: ReportPayload;
  criado_por: string | null; visibilidade: string; shared_emails: string[] | null;
  created_at: string;
};

export default function ReportCesarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [row, setRow] = useState<Row | null>(null);
  const [podeAjustar, setPodeAjustar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    fetch(`/api/cesar/reports/${id}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "não encontrado");
        setRow(j.report as Row);
        setPodeAjustar(!!j.pode_ajustar);
        setErro(null);
      })
      .catch((e) => setErro(e instanceof Error ? e.message : "erro"));
  }, [id]);
  useEffect(carregar, [carregar]);

  // O Cesar avisa quando mexeu neste report — recarrega na hora.
  useEffect(() => {
    const ouve = (e: Event) => {
      const det = (e as CustomEvent<{ id?: string }>).detail;
      if (!det?.id || det.id === id) carregar();
    };
    window.addEventListener("cesar:report-atualizado", ouve);
    return () => window.removeEventListener("cesar:report-atualizado", ouve);
  }, [id, carregar]);

  return (
    <div className="space-y-4 max-w-[1200px]">
      <button type="button"
        onClick={() => (row?.tela ? router.push(row.tela) : router.back())}
        className="inline-flex items-center gap-1 text-[12px] text-ww-textMuted hover:text-ww-text transition -ml-1 px-1 py-0.5">
        ← Voltar
      </button>
      {erro && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12.5px] text-ww-text">
          Este report não está disponível para você ({erro}).
        </p>
      )}
      {!erro && !row && <p className="py-10 text-[12.5px] text-ww-textFaint">carregando o report…</p>}
      {row && (
        <ReportView
          report={row.payload}
          meta={{ id: row.id, tela: row.tela, criado_por: row.criado_por, visibilidade: row.visibilidade,
                  shared_emails: row.shared_emails ?? [], created_at: row.created_at }}
          podeAjustar={podeAjustar}
          onMudou={carregar}
        />
      )}
    </div>
  );
}
