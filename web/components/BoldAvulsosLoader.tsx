"use client";

// Client-side loader com skeleton — permite que /pcs, /avulsos, /projetos
// façam paint imediato (shell) e busquem os dados em paralelo, em vez do SSR
// bloqueante que travava por 10-12s.

import { useEffect, useState } from "react";
import BoldAvulsosView from "./BoldAvulsosViewClient";

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Sem &limit — a rota pagina server-side e devolve a MV inteira. Passar
        // limit=1000 era o que truncava /avulsos (1776 rows) e subestimava os
        // alarmes, que são calculados client-side em cima desse dataset.
        const r = await fetch(`/api/list/rows?view=${view}&count=${countMode}`, { cache: "no-store" });
        const j = await r.json();
        if (cancelled) return;
        if (!r.ok) { setErr(j.error ?? r.statusText); setRows([]); return; }
        setRows(j.rows ?? []);
        setCount(j.count ?? null);
      } catch (e) {
        if (!cancelled) { setErr(e instanceof Error ? e.message : String(e)); setRows([]); }
      }
    })();
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
