"use client";

import { useEffect, useState } from "react";

type Periodo = "3m" | "6m" | "12m" | "ytd";
type Tab = "pl" | "compras" | "pipeline" | "operacoes" | "clientes";

const fmtBRL = (v: number | null | undefined) =>
  v == null || !isFinite(Number(v)) ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtNum = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const fmtPct = (v: number | null | undefined) =>
  v == null ? "—" : `${Number(v).toFixed(1).replace(".", ",")}%`;

type Summary = {
  pl: { receita_realizada: number; receita_contratada: number; custo_compras: number; margem_bruta: number; margem_pct: number; tendencia_mom: number };
  compras: { total_aprovado: number; qtd_pcs: number; top_fornecedores: { nome: string; total: number }[]; top_categorias: { nome: string; total: number }[]; top_projetos: { nome: string; total: number }[]; por_mes: { mes: string; total: number }[] };
  serie_mensal: { mes: string; receita: number; receita_contratada: number; compras: number }[];
};

type Pipeline = {
  configured: boolean; hint?: string; error?: string;
  total_em_aberto?: number; forecast_ponderado?: number; taxa_conversao?: number; ativas?: number;
  por_fase?: { fase: string; qtd: number; valor: number }[];
  por_tipo?: { tipo: string; qtd: number; valor: number }[];
  propostas?: Array<{ numero?: string; tipo?: string; status?: string; valor?: number; probabilidade?: number; prev_fechamento?: string; empresa_nome?: string; projeto?: string; responsavel?: string }>;
};

type Operacoes = {
  configured: boolean; hint?: string; error?: string;
  oss_total?: number; oss_concluidas?: number;
  total_despesas?: number; total_despesas_aprovadas?: number;
  horas_campo?: number;
  por_tipo?: { tipo: string; qtd: number }[];
  ranking_tecnicos?: { id: string; nome: string; oss: number; despesas: number }[];
};

export default function OwnerDashboard() {
  const [periodo, setPeriodo] = useState<Periodo>("12m");
  const [tab, setTab] = useState<Tab>("pl");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [operacoes, setOperacoes] = useState<Operacoes | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? (localStorage.getItem("owner_periodo") as Periodo) : null;
    if (saved && ["3m","6m","12m","ytd"].includes(saved)) setPeriodo(saved);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("owner_periodo", periodo);
    setLoading(true); setErr(null);
    Promise.all([
      fetch(`/api/owner/summary?periodo=${periodo}`).then((r) => r.ok ? r.json() : Promise.reject(r.statusText)),
      fetch(`/api/owner/pipeline?periodo=${periodo}`).then((r) => r.ok ? r.json() : { configured: false, error: r.statusText }),
      fetch(`/api/owner/operacoes?periodo=${periodo}`).then((r) => r.ok ? r.json() : { configured: false, error: r.statusText }),
    ]).then(([s, p, o]) => { setSummary(s); setPipeline(p); setOperacoes(o); })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [periodo]);

  return (
    <div className="space-y-4 max-w-[1400px]">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight">Owner Dashboard</h1>
          <p className="text-slate-500 text-sm mt-1">Visão consolidada — Painel WW + CRM + App WW</p>
        </div>
        <div className="flex items-center gap-1">
          {(["3m", "6m", "12m", "ytd"] as Periodo[]).map((p) => (
            <button key={p} onClick={() => setPeriodo(p)}
              className={`px-3 py-1.5 text-[11px] font-semibold rounded-md border transition ${
                periodo === p ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}>{p === "ytd" ? "YTD" : p.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {err && <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-2 rounded-md text-sm">❌ {err}</div>}

      {/* KPI cards */}
      <KpiCards summary={summary} pipeline={pipeline} loading={loading} />

      {/* Tabs */}
      <div className="border-b border-slate-200 flex items-center gap-1 overflow-x-auto">
        {([
          { k: "pl", label: "P&L" },
          { k: "compras", label: "Compras" },
          { k: "pipeline", label: "Pipeline CRM" },
          { k: "operacoes", label: "Operações" },
          { k: "clientes", label: "Clientes" },
        ] as { k: Tab; label: string }[]).map(({ k, label }) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition ${
              tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}>{label}</button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "pl" && <PLTab summary={summary} loading={loading} />}
      {tab === "compras" && <ComprasTab summary={summary} loading={loading} />}
      {tab === "pipeline" && <PipelineTab pipeline={pipeline} loading={loading} />}
      {tab === "operacoes" && <OperacoesTab operacoes={operacoes} loading={loading} />}
      {tab === "clientes" && <ClientesTab />}
    </div>
  );
}

function KpiCards({ summary, pipeline, loading }: { summary: Summary | null; pipeline: Pipeline | null; loading: boolean }) {
  const margemColor = (summary?.pl.margem_pct ?? 0) > 30 ? "text-emerald-700" : (summary?.pl.margem_pct ?? 0) > 0 ? "text-amber-700" : "text-rose-700";
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi label="💰 Receita realizada" value={fmtBRL(summary?.pl.receita_realizada)}
        delta={summary ? `${summary.pl.tendencia_mom >= 0 ? "↑" : "↓"} ${fmtPct(Math.abs(summary.pl.tendencia_mom))} MoM` : "—"}
        deltaColor={summary && summary.pl.tendencia_mom >= 0 ? "text-emerald-700" : "text-rose-700"}
        loading={loading} />
      <Kpi label="🛒 Compras aprovadas" value={fmtBRL(summary?.pl.custo_compras)}
        delta={summary ? `${fmtNum(summary.compras.qtd_pcs)} PCs` : "—"} loading={loading} />
      <Kpi label="📊 Pipeline CRM" value={pipeline?.configured ? fmtBRL(pipeline.forecast_ponderado) : "—"}
        delta={pipeline?.configured ? `${fmtNum(pipeline.ativas ?? 0)} propostas ativas` : "Configurar CRM env"}
        loading={loading} />
      <Kpi label="📈 Margem bruta" value={fmtPct(summary?.pl.margem_pct)}
        delta={fmtBRL(summary?.pl.margem_bruta)}
        deltaColor={margemColor} loading={loading} />
    </div>
  );
}

function Kpi({ label, value, delta, deltaColor = "text-slate-500", loading }: { label: string; value: string; delta?: string; deltaColor?: string; loading?: boolean }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
      <div className="text-[22px] font-semibold tabular-nums tracking-tight text-slate-900 mt-1">
        {loading ? <span className="text-slate-300">…</span> : value}
      </div>
      {delta && <div className={`text-[11px] mt-0.5 ${deltaColor}`}>{delta}</div>}
    </div>
  );
}

function PLTab({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  if (loading) return <div className="text-slate-400 text-sm py-8 text-center">Carregando…</div>;
  if (!summary || !summary.serie_mensal.length) return <div className="text-slate-500 text-sm py-8 text-center">Sem dados no período.</div>;
  const max = Math.max(...summary.serie_mensal.map((m) => Math.max(m.receita, m.compras))) || 1;

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Receita × Compras por mês</h3>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${summary.serie_mensal.length}, minmax(0, 1fr))` }}>
          {summary.serie_mensal.map((m) => (
            <div key={m.mes} className="flex flex-col items-center gap-1">
              <div className="w-full flex items-end gap-0.5 h-32">
                <div className="flex-1 bg-emerald-400 rounded-t" style={{ height: `${(m.receita / max) * 100}%` }} title={`Receita ${fmtBRL(m.receita)}`} />
                <div className="flex-1 bg-rose-400 rounded-t" style={{ height: `${(m.compras / max) * 100}%` }} title={`Compras ${fmtBRL(m.compras)}`} />
              </div>
              <div className="text-[9px] font-mono text-slate-500">{m.mes.slice(2)}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 text-[11px] mt-3 text-slate-600">
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-400 rounded inline-block" /> Receita realizada</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-rose-400 rounded inline-block" /> Compras aprovadas</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Receita realizada</div>
          <div className="text-[18px] font-semibold tabular-nums">{fmtBRL(summary.pl.receita_realizada)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Receita contratada (PVs no período): {fmtBRL(summary.pl.receita_contratada)}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Custo de compras</div>
          <div className="text-[18px] font-semibold tabular-nums">{fmtBRL(summary.pl.custo_compras)}</div>
          <div className="text-[11px] text-slate-500 mt-1">Margem bruta: {fmtBRL(summary.pl.margem_bruta)} ({fmtPct(summary.pl.margem_pct)})</div>
        </div>
      </div>

      <p className="text-[10px] text-slate-400">⚠ Receita estimada usando <code>contas_receber.valor_documento</code> com <code>status_titulo=LIQUIDADO</code>. <code>valor_pago</code> não existe nessa tabela. Pra precisão real, cruzar com extratos.</p>
    </div>
  );
}

function ComprasTab({ summary, loading }: { summary: Summary | null; loading: boolean }) {
  if (loading) return <div className="text-slate-400 text-sm py-8 text-center">Carregando…</div>;
  if (!summary) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="Total aprovado" value={fmtBRL(summary.compras.total_aprovado)} />
        <Kpi label="Qtd PCs" value={fmtNum(summary.compras.qtd_pcs)} />
        <Kpi label="Ticket médio" value={summary.compras.qtd_pcs ? fmtBRL(summary.compras.total_aprovado / summary.compras.qtd_pcs) : "—"} />
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <RankingTable title="Top 10 fornecedores" items={summary.compras.top_fornecedores} />
        <RankingTable title="Top 10 categorias"   items={summary.compras.top_categorias} />
        <RankingTable title="Top 10 projetos"     items={summary.compras.top_projetos} />
      </div>
    </div>
  );
}

function RankingTable({ title, items }: { title: string; items: { nome: string; total: number }[] }) {
  const max = items.reduce((m, x) => Math.max(m, x.total), 0) || 1;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">{title}</h3>
      {items.length === 0 ? <p className="text-xs text-slate-400">Sem dados</p> : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.nome} className="text-[11px]">
              <div className="flex justify-between gap-2">
                <span className="truncate text-slate-700" title={it.nome}>{it.nome}</span>
                <span className="font-mono tabular-nums text-slate-900 font-semibold">{fmtBRL(it.total)}</span>
              </div>
              <div className="h-1 bg-slate-100 rounded mt-0.5 overflow-hidden">
                <div className="h-full bg-emerald-400" style={{ width: `${(it.total / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineTab({ pipeline, loading }: { pipeline: Pipeline | null; loading: boolean }) {
  if (loading) return <div className="text-slate-400 text-sm py-8 text-center">Carregando…</div>;
  if (!pipeline?.configured) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-900">
        <p className="font-semibold mb-2">⚠ CRM não configurado</p>
        <p className="text-xs">{pipeline?.hint ?? "Configure CRM_SUPABASE_URL e CRM_SERVICE_ROLE_KEY no Vercel pra ativar dados do CRM."}</p>
      </div>
    );
  }
  if (pipeline.error) {
    return <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-2 rounded-md text-sm">❌ {pipeline.error}</div>;
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Em pipeline (bruto)" value={fmtBRL(pipeline.total_em_aberto)} />
        <Kpi label="Forecast ponderado" value={fmtBRL(pipeline.forecast_ponderado)} />
        <Kpi label="Conversão (90d)" value={fmtPct(pipeline.taxa_conversao)} />
        <Kpi label="Propostas ativas" value={fmtNum(pipeline.ativas)} />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <RankingTable title="Por fase" items={(pipeline.por_fase ?? []).map((f) => ({ nome: f.fase, total: f.valor }))} />
        <RankingTable title="Por tipo" items={(pipeline.por_tipo ?? []).map((f) => ({ nome: f.tipo, total: f.valor }))} />
      </div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <h3 className="text-sm font-semibold text-slate-800 p-4 border-b border-slate-100">Propostas ativas (top 100)</h3>
        <table className="w-full text-[11.5px]">
          <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
            <tr>
              <th className="text-left px-3 py-2">#</th>
              <th className="text-left px-2 py-2">Empresa</th>
              <th className="text-left px-2 py-2">Projeto</th>
              <th className="text-left px-2 py-2">Status</th>
              <th className="text-right px-2 py-2">Valor</th>
              <th className="text-right px-2 py-2">Prob.</th>
              <th className="text-left px-2 py-2">Resp.</th>
            </tr>
          </thead>
          <tbody>
            {(pipeline.propostas ?? []).map((p, i) => (
              <tr key={String(p.numero) + i} className="border-b border-slate-100">
                <td className="px-3 py-1.5 font-mono">{p.numero}</td>
                <td className="px-2 py-1.5 truncate max-w-[180px]">{p.empresa_nome}</td>
                <td className="px-2 py-1.5 truncate max-w-[140px]">{p.projeto}</td>
                <td className="px-2 py-1.5"><span className="px-1.5 py-0.5 text-[10px] bg-slate-100 rounded">{p.status}</span></td>
                <td className="px-2 py-1.5 text-right font-mono tabular-nums">{fmtBRL(p.valor)}</td>
                <td className="px-2 py-1.5 text-right">{p.probabilidade ?? 0}%</td>
                <td className="px-2 py-1.5 truncate max-w-[120px]">{p.responsavel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OperacoesTab({ operacoes, loading }: { operacoes: Operacoes | null; loading: boolean }) {
  if (loading) return <div className="text-slate-400 text-sm py-8 text-center">Carregando…</div>;
  if (!operacoes?.configured) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-900">
        <p className="font-semibold mb-2">⚠ App WW não configurado</p>
        <p className="text-xs">{operacoes?.hint ?? "Configure WW_SUPABASE_URL e WW_SERVICE_ROLE_KEY no Vercel pra ativar dados de Operações."}</p>
      </div>
    );
  }
  if (operacoes.error) {
    return <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-2 rounded-md text-sm">❌ {operacoes.error}</div>;
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="OSs no período" value={fmtNum(operacoes.oss_total)} delta={`${fmtNum(operacoes.oss_concluidas)} concluídas`} />
        <Kpi label="Despesas (total)" value={fmtBRL(operacoes.total_despesas)} delta={`${fmtBRL(operacoes.total_despesas_aprovadas)} aprovadas`} />
        <Kpi label="Horas em campo" value={`${(operacoes.horas_campo ?? 0).toFixed(0)}h`} />
        <Kpi label="Técnicos ativos" value={fmtNum((operacoes.ranking_tecnicos ?? []).length)} />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <RankingTable title="OSs por tipo de serviço" items={(operacoes.por_tipo ?? []).map((t) => ({ nome: t.tipo, total: t.qtd }))} />
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-800 mb-3">Ranking técnicos</h3>
          <table className="w-full text-[11.5px]">
            <thead className="text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-1.5">Técnico</th>
                <th className="text-right py-1.5">OSs</th>
                <th className="text-right py-1.5">Despesas</th>
              </tr>
            </thead>
            <tbody>
              {(operacoes.ranking_tecnicos ?? []).slice(0, 15).map((t) => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="py-1.5 truncate">{t.nome}</td>
                  <td className="py-1.5 text-right font-mono">{fmtNum(t.oss)}</td>
                  <td className="py-1.5 text-right font-mono tabular-nums">{fmtBRL(t.despesas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ClientesTab() {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-900">
      <p className="font-semibold mb-2">📊 Em construção</p>
      <p className="text-xs">Tab de Clientes (cross-system) precisa das envs do CRM e do App WW configuradas no Vercel pra fazer o join por <code>codigo_cliente_omie</code>. Depois implementamos ranking por rentabilidade + drawer com timeline.</p>
    </div>
  );
}
