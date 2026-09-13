"use client";

/**
 * O report do Cesar como TELA navegável (v3, 13/09/2026): KPIs em cards,
 * tabelas com ordenação/busca/totais, gráfico de barras de verdade (Recharts).
 * Os botões de PDF/Excel vivem AQUI, com o report na frente da pessoa — e mais
 * dois pedidos do Benny:
 *   · um mini-ajuste DISCRETO de quem vê o report (equipe / só eu / pessoas
 *     específicas), editável depois de criado, só pro dono/admin;
 *   · "Ajustar com o Cesar" — abre o assistente com o report como contexto
 *     para pedir inclusões/mudanças por conversa (a tela recarrega sozinha).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { useCesar } from "@/components/cesar/CesarProvider";
import type { ReportPayload, ReportTabela } from "@/lib/cesar/report-pdf";

const pareceNumero = (s: string) => /^[\sR$\-+]*[\d.,%\s]+$/.test(String(s || "").trim()) && /\d/.test(s);
const numeroDe = (s: string) => Number(String(s).replace(/[^\d,-]/g, "").replace(/\./g, "").replace(",", "."));
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/* ------------------------- tabela interativa ------------------------- */

function TabelaInterativa({ t }: { t: ReportTabela }) {
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<{ col: number; asc: boolean } | null>(null);

  const numericas = useMemo(() =>
    t.colunas.map((_, i) => i > 0 && (t.linhas || []).some((l) => pareceNumero(String(l[i] ?? "")))),
  [t]);

  const linhas = useMemo(() => {
    let ls = [...(t.linhas || [])];
    const termo = busca.trim().toLowerCase();
    if (termo) ls = ls.filter((l) => l.some((c) => String(c ?? "").toLowerCase().includes(termo)));
    if (ordem) {
      const { col, asc } = ordem;
      ls.sort((a, b) => {
        const av = String(a[col] ?? ""), bv = String(b[col] ?? "");
        const cmp = numericas[col] ? numeroDe(av) - numeroDe(bv) : av.localeCompare(bv, "pt-BR");
        return asc ? cmp : -cmp;
      });
    }
    return ls;
  }, [t, busca, ordem, numericas]);

  // Totais das colunas que carregam moeda — a linha que o Excel faria.
  const totais = useMemo(() => t.colunas.map((_, i) => {
    if (!numericas[i]) return null;
    const moeda = (t.linhas || []).some((l) => /R\$/.test(String(l[i] ?? "")));
    if (!moeda) return null;
    return brl(linhas.reduce((s, l) => s + (numeroDe(String(l[i] ?? "")) || 0), 0));
  }), [t, linhas, numericas]);

  return (
    <section className="rounded-xl border border-ww-border bg-ww-panel/60 p-4">
      <div className="mb-3 flex items-center gap-3">
        {t.titulo && <h3 className="text-[13px] font-semibold text-ww-text">{t.titulo}</h3>}
        {(t.linhas || []).length > 5 && (
          <input
            className="ml-auto h-8 w-56 rounded-lg border border-ww-border bg-ww-bg px-2.5 text-[11.5px]
                       text-ww-text placeholder:text-ww-textFaint focus:outline-none focus:border-ww-accent/60"
            placeholder="Filtrar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        )}
      </div>
      <div className="overflow-x-auto rounded-lg border border-ww-border">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-ww-rowHover text-[11px]">
              {t.colunas.map((c, i) => (
                <th key={i}
                  className={`cursor-pointer select-none px-3 py-2 font-semibold text-ww-textMuted hover:text-ww-accent ${
                    i > 0 && numericas[i] ? "text-right" : "text-left"}`}
                  onClick={() => setOrdem((o) => (o?.col === i ? { col: i, asc: !o.asc } : { col: i, asc: true }))}
                  title="Clique para ordenar">
                  {c}{ordem?.col === i ? (ordem.asc ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, r) => (
              <tr key={r} className={`border-t border-ww-border ${r % 2 === 1 ? "bg-ww-rowHover/40" : ""}`}>
                {l.map((cel, i) => (
                  <td key={i} className={`px-3 py-1.5 text-ww-text ${i > 0 && numericas[i] ? "text-right font-mono tabular-nums" : ""}`}>
                    {String(cel ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {totais.some(Boolean) && (
              <tr className="border-t border-ww-border bg-ww-rowHover font-semibold">
                {t.colunas.map((_, i) => (
                  <td key={i} className={`px-3 py-1.5 text-ww-text ${i > 0 ? "text-right font-mono tabular-nums" : ""}`}>
                    {i === 0 ? `Total (${linhas.length})` : totais[i] ?? ""}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* --------------------- mini-ajuste de compartilhamento --------------------- */

const OPCOES_VIS = [
  { value: "todos", rotulo: "Equipe toda" },
  { value: "proprio", rotulo: "Só para mim" },
  { value: "custom", rotulo: "Pessoas específicas" },
];

function MiniCompartilhar({ reportId, visibilidade, sharedEmails, onMudou }: {
  reportId: string; visibilidade: string; sharedEmails: string[]; onMudou: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [vis, setVis] = useState(visibilidade);
  const [emails, setEmails] = useState<string[]>(sharedEmails);
  const [novo, setNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setVis(visibilidade); setEmails(sharedEmails); }, [visibilidade, sharedEmails]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);

  const salvar = async (v: string, es: string[]) => {
    setSalvando(true);
    await fetch(`/api/cesar/reports/${reportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibilidade: v, shared_emails: es }),
    }).catch(() => {});
    setSalvando(false);
    onMudou();
  };

  const rotulo = OPCOES_VIS.find((o) => o.value === vis)?.rotulo ?? vis;

  return (
    <div ref={boxRef} className="relative">
      {/* Discreto de propósito: um chip pequeno, não um botão de destaque. */}
      <button type="button" onClick={() => setAberto((a) => !a)} title="Quem pode ver este report"
        className="inline-flex items-center gap-1 rounded-full border border-ww-border px-2 py-0.5
                   text-[10.5px] text-ww-textMuted hover:text-ww-text hover:border-ww-accent/50 transition">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" />
        </svg>
        {rotulo}{vis === "custom" ? ` (${emails.length})` : ""}
      </button>
      {aberto && (
        <div className="absolute right-0 z-50 mt-1.5 w-[280px] rounded-xl border border-ww-border bg-ww-panel shadow-xl p-3 space-y-2">
          <p className="text-[10px] uppercase tracking-wide font-bold text-ww-textFaint">Quem vê este report</p>
          {OPCOES_VIS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-[12px] text-ww-text cursor-pointer">
              <input type="radio" name={`vis-${reportId}`} checked={vis === o.value} disabled={salvando}
                onChange={() => { setVis(o.value); void salvar(o.value, emails); }} />
              {o.rotulo}
            </label>
          ))}
          {vis === "custom" && (
            <div className="space-y-1.5 pt-1">
              {emails.map((e) => (
                <div key={e} className="flex items-center gap-2 rounded-md border border-ww-border px-2 py-1 text-[11px] text-ww-text">
                  <span className="min-w-0 flex-1 truncate">{e}</span>
                  <button type="button" className="text-ww-textFaint hover:text-rose-500" disabled={salvando}
                    onClick={() => { const es = emails.filter((x) => x !== e); setEmails(es); void salvar(vis, es); }}>✕</button>
                </div>
              ))}
              <form className="flex gap-1.5" onSubmit={(ev) => {
                ev.preventDefault();
                const e = novo.trim().toLowerCase();
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) || emails.includes(e)) return;
                const es = [...emails, e]; setEmails(es); setNovo(""); void salvar(vis, es);
              }}>
                <input className="h-7 flex-1 rounded-md border border-ww-border bg-ww-bg px-2 text-[11px]
                                  text-ww-text placeholder:text-ww-textFaint focus:outline-none"
                  placeholder="e-mail@…" value={novo} onChange={(e) => setNovo(e.target.value)} />
                <button type="submit" className="h-7 rounded-md border border-ww-border px-2 text-[11px]
                                                 text-ww-textMuted hover:text-ww-text">+</button>
              </form>
            </div>
          )}
          {salvando && <p className="text-[10px] text-ww-textFaint">salvando…</p>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ view ------------------------------ */

export default function ReportView({ report, meta, podeAjustar, onMudou }: {
  report: ReportPayload;
  meta: { id: string; tela: string; criado_por: string | null; visibilidade: string;
          shared_emails: string[]; created_at: string };
  podeAjustar: boolean;
  onMudou: () => void;
}) {
  const { abrir } = useCesar();
  const [baixando, setBaixando] = useState<string | null>(null);

  const baixar = async (tipo: "pdf" | "excel") => {
    setBaixando(tipo);
    try {
      if (tipo === "pdf") {
        const { gerarReportPDF } = await import("@/lib/cesar/report-pdf");
        gerarReportPDF(report);
      } else {
        const { gerarReportExcel } = await import("@/lib/cesar/report-excel");
        await gerarReportExcel(report);
      }
    } catch { /* silencioso */ }
    setBaixando(null);
  };

  const ajustarComCesar = () => {
    const contexto = [
      `Report incorporado aberto na tela ${meta.tela}.`,
      `report_id: ${meta.id}`,
      `Conteúdo atual (JSON): ${JSON.stringify(report).slice(0, 9000)}`,
    ].join("\n");
    abrir({
      contexto,
      origem: `report: ${report.titulo}`,
      pergunta: "Quero ajustar este report: ",
      novaConversa: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl md:text-2xl font-semibold text-ww-text tracking-tight">
            <span aria-hidden className="w-6 h-6 rounded-full bg-gradient-to-br from-sky-500 to-violet-500
                                          text-white text-[10px] font-bold grid place-items-center shrink-0">C</span>
            <span className="min-w-0 break-words">{report.titulo}</span>
          </h1>
          <p className="mt-0.5 text-[12px] text-ww-textMuted">
            {report.subtitulo ? `${report.subtitulo} · ` : ""}
            incorporado em {new Date(meta.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
            {meta.criado_por ? ` por ${meta.criado_por.split("@")[0]}` : ""}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          {podeAjustar && (
            <MiniCompartilhar reportId={meta.id} visibilidade={meta.visibilidade}
              sharedEmails={meta.shared_emails} onMudou={onMudou} />
          )}
          <button type="button" onClick={() => void baixar("pdf")} disabled={baixando !== null}
            className="px-2.5 py-1.5 text-[11.5px] rounded-lg border border-ww-border text-ww-textMuted
                       hover:text-ww-text hover:border-ww-accent/50 hover:bg-ww-rowHover transition disabled:opacity-40">
            {baixando === "pdf" ? "gerando…" : "Baixar PDF"}
          </button>
          <button type="button" onClick={() => void baixar("excel")} disabled={baixando !== null}
            className="px-2.5 py-1.5 text-[11.5px] rounded-lg border border-ww-border text-ww-textMuted
                       hover:text-ww-text hover:border-ww-accent/50 hover:bg-ww-rowHover transition disabled:opacity-40">
            {baixando === "excel" ? "gerando…" : "Baixar Excel"}
          </button>
          <button type="button" onClick={ajustarComCesar}
            className="px-2.5 py-1.5 text-[11.5px] rounded-lg font-semibold bg-ww-accent text-white
                       hover:brightness-110 transition">
            Ajustar com o Cesar
          </button>
        </div>
      </div>

      {!!report.kpis?.length && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {report.kpis.slice(0, 8).map((k, i) => (
            <div key={i} className="rounded-xl border border-ww-border bg-ww-panel/60 px-3.5 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-ww-textFaint">{k.rotulo}</p>
              <p className="mt-1 truncate text-lg font-semibold text-ww-text tabular-nums" title={k.valor}>{k.valor}</p>
            </div>
          ))}
        </div>
      )}

      {(report.tabelas || []).map((t, i) => <TabelaInterativa key={i} t={t} />)}

      {(report.barras || []).map((g, i) => {
        const dados = (g.itens || []).slice(0, 14).map((it) => ({ nome: it.rotulo, valor: Number(it.valor) || 0, texto: it.texto }));
        const moeda = dados.some((d) => d.texto && /R\$/.test(d.texto));
        return (
          <section key={`g-${i}`} className="rounded-xl border border-ww-border bg-ww-panel/60 p-4">
            <h3 className="mb-3 text-[13px] font-semibold text-ww-text">{g.titulo}</h3>
            <div style={{ height: Math.max(180, dados.length * 34) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dados} layout="vertical" margin={{ left: 8, right: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} className="opacity-30" />
                  <XAxis type="number" tickFormatter={(v: number) => (moeda ? brl(v) : String(v))} fontSize={11} />
                  <YAxis type="category" dataKey="nome" width={160} fontSize={11} />
                  <Tooltip formatter={(v) => (moeda ? brl(Number(v ?? 0)) : String(v ?? ""))} />
                  <Bar dataKey="valor" fill="#1d4ed8" radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        );
      })}
    </div>
  );
}
