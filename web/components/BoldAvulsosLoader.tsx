"use client";

// Client-side loader com skeleton — permite que /pcs, /avulsos, /projetos
// façam paint imediato (shell) e busquem os dados em paralelo, em vez do SSR
// bloqueante que travava por 10-12s.

import { useEffect, useState } from "react";
import BoldAvulsosView from "./BoldAvulsosViewClient";
import dynamic from "next/dynamic";

/* Tela de Operação no desenho do mockup de 30/09/2026 (Lista, Tabela-planilha,
   Kanban, Linha do tempo, edição na linha). A grade antiga continua em
   ?classica=1 até a conferência final. Sem SSR pelo mesmo motivo da antiga. */
const TelaOperacao = dynamic(() => import("./operacao/TelaOperacao"), {
  ssr: false,
  loading: () => <div className="p-8 text-center text-sm text-ww-textMuted">Carregando…</div>,
});

type Modulo = "avulsos" | "pcs" | "projetos";

type Props = {
  view: "v_pc_avulsos" | "v_pc_pcs" | "v_pc_projetos";
  modulo: Modulo;
  title: string;
  countMode?: "exact" | "estimated";
};

export default function BoldAvulsosLoader({ view, modulo, title, countMode = "exact" }: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [parcial, setParcial] = useState(false);
  const [avisoErro, setAvisoErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let completo = false;
    // Sem &limit — a rota pagina server-side e devolve a MV inteira. Passar
    // limit=1000 era o que truncava /avulsos (1776 rows) e subestimava os
    // alarmes, que são calculados client-side em cima desse dataset.
    const base = `/api/list/rows?view=${view}&count=${countMode}`;
    const buscar = async (extra: string) => {
      const r = await fetch(base + extra, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      return j as { rows?: Record<string, unknown>[]; count?: number | null };
    };
    /* Duas etapas (01/10/2026): a tela abre em "Em aberto", então primeiro
       vêm só os não faturados direto da MV (rápido) e a tela desenha; o
       conjunto completo (faturados + linhas manuais frescas da view viva)
       chega em segundo plano e substitui sem piscar. Se a rápida falhar, a
       completa ainda decide; se a completa falhar depois da rápida, fica a
       rápida e avisa. */
    const tela = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("classica");
    if (!tela) {
      buscar("&aberto=1&rapido=1").then((j) => {
        if (cancelled || completo) return;
        setRows(j.rows ?? []); setParcial(true);
      }).catch(() => { /* a completa resolve */ });
    }
    buscar("").then((j) => {
      completo = true;
      if (cancelled) return;
      setRows(j.rows ?? []); setCount(j.count ?? null); setParcial(false);
    }).catch((e) => {
      completo = true;
      if (cancelled) return;
      const msg = e instanceof Error ? e.message : String(e);
      setRows((atual) => { if (atual == null) { setErr(msg); return []; } setAvisoErro(msg); return atual; });
    });
    return () => { cancelled = true; };
  }, [view, countMode]);

  if (err) {
    return (
      <div className="p-4 mb-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm">
        <strong>Erro ao carregar:</strong> {err}
      </div>
    );
  }
  if (rows == null) {
    return <ListSkeleton title={title} />;
  }
  const classica = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("classica");
  if (!classica) return <TelaOperacao modulo={modulo} title={title} rows={rows} parcial={parcial} avisoErro={avisoErro} />;
  return (
    <BoldAvulsosView modulo={modulo} title={title} rows={rows as never} totalCount={count} />
  );
}

function ListSkeleton({ title }: { title: string }) {
  return (
    <div data-loader-skeleton className="animate-pulse">
      <div className="mb-4">
        <div className="h-6 w-56 bg-ww-border/60 rounded" />
        <div className="h-3 w-80 bg-ww-border/40 rounded mt-2" />
      </div>
      {/* facets skeleton */}
      <div className="flex gap-2 mb-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 w-32 bg-ww-border/40 rounded-lg" />
        ))}
      </div>
      {/* cards skeleton */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 bg-ww-border/30 rounded-lg" />
        ))}
      </div>
      <div className="sr-only">Carregando {title}…</div>
    </div>
  );
}
