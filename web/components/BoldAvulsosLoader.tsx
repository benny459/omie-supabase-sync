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
type Resp = { rows?: Record<string, unknown>[]; count?: number | null; ativos?: boolean };
type Etapas = { view: string; rapida: Promise<Resp> | null; completa: Promise<Resp>; t: number };

/* Busca em duas etapas (01/10/2026): a rápida desenha a tela; a completa (faturados +
   linhas manuais frescas da view viva) chega em segundo plano e substitui sem piscar.
   Projetos com "★ Só ativos" (o padrão, 08/10/26): a rápida traz só os cartões dos
   projetos ativos, filtrados no servidor — ~300 linhas em vez de ~1,7 mil. */
function iniciarEtapas(view: string, countMode: string): Etapas {
  const base = `/api/list/rows?view=${view}&count=${countMode}`;
  const buscar = async (extra: string): Promise<Resp> => {
    const r = await fetch(base + extra, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j as Resp;
  };
  const qs = new URLSearchParams(window.location.search);
  let soAtivos = false;
  if (view === "v_pc_projetos") {
    try { soAtivos = localStorage.getItem("op:projetos:soAtivos") !== "0"; } catch { soAtivos = true; }
    if (qs.has("abrir")) soAtivos = false; // vai abrir um projeto específico: melhor a lista toda
  }
  const rapida = qs.has("classica") ? null : buscar(soAtivos ? "&ativos=1&aberto=1&rapido=1" : "&aberto=1&rapido=1");
  rapida?.catch(() => { /* a completa resolve */ });
  const completa = buscar("");
  completa.catch(() => { /* tratado no efeito */ });
  return { view, rapida, completa, t: Date.now() };
}

/* 08/10/26: a busca começa quando este arquivo carrega (logo no carregamento da página), e
   não só quando a tela termina de "acordar" (hidratar) — numa carga direta de /projetos a
   hidratação pode demorar, e a lista esperava por ela para sequer pedir os dados. */
const COUNT_DA_ROTA: Record<string, [string, string]> = {
  "/projetos": ["v_pc_projetos", "exact"], "/avulsos": ["v_pc_avulsos", "estimated"], "/pcs": ["v_pc_pcs", "exact"],
};
let preBusca: Etapas | null = null;
if (typeof window !== "undefined") {
  const r = COUNT_DA_ROTA[window.location.pathname];
  if (r) { try { preBusca = iniciarEtapas(r[0], r[1]); } catch { preBusca = null; } }
}

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

  const [parcialAtivos, setParcialAtivos] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let completo = false;
    // Sem &limit — a rota pagina server-side e devolve a MV inteira.
    const fresca = preBusca && preBusca.view === view && Date.now() - preBusca.t < 20_000 ? preBusca : null;
    preBusca = null; // usa uma vez só; a próxima montagem busca de novo
    const et = fresca ?? iniciarEtapas(view, countMode);
    /* Se a rápida falhar, a completa ainda decide; se a completa falhar depois da rápida,
       fica a rápida e avisa. */
    et.rapida?.then((j) => {
      if (cancelled || completo) return;
      setRows(j.rows ?? []); setParcial(true); setParcialAtivos(!!j.ativos);
    }).catch(() => { /* a completa resolve */ });
    et.completa.then((j) => {
      completo = true;
      if (cancelled) return;
      setRows(j.rows ?? []); setCount(j.count ?? null); setParcial(false); setParcialAtivos(false);
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
  if (!classica) return <TelaOperacao modulo={modulo} title={title} rows={rows} parcial={parcial} parcialAtivos={parcialAtivos} avisoErro={avisoErro} />;
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
