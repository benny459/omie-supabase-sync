"use client";

// Preview do daily Avulsos que vai ao Webex. Estrutura compacta com counts +
// valores + owner + link deep-filtered pro painel. Botão pra enviar agora.

import { useEffect, useMemo, useState, type ReactNode } from "react";

type Pv = { pv_os_label: string; cliente: string; tipo: string; valor: number };
type Item = {
  kind: string;
  label: string;
  count: number;
  val: number;
  owner: string;
  link: string;
  delta_count: number | null;
  pvs: Pv[];
};
type Section = { title: string; emoji: string; items: Item[] };
type ApiResp = {
  generated_at: string;
  total_pvs: number;
  sections: Section[];
  previous_date: string | null;
  trend: { date: string; counts: Record<string, number>; total_pvs: number }[];
};

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);

function buildWebexMarkdown(data: ApiResp): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const lines: string[] = [];
  lines.push(`### 📊 Report Avulsos — ${dd}/${mm}`);
  lines.push("");
  for (const sec of data.sections) {
    lines.push(`**${sec.emoji} ${sec.title}**`);
    for (const it of sec.items) {
      const delta =
        it.delta_count == null ? ""
        : it.delta_count > 0 ? ` (📈 +${it.delta_count})`
        : it.delta_count < 0 ? ` (📉 ${it.delta_count})`
        : ` (=)`;
      const val = it.val > 0 ? ` · ${fmtBRL(it.val)}` : "";
      lines.push(`- ${it.label}: **${it.count}**${val}${delta} · [ver](${it.link}) — ${it.owner}`);
    }
    lines.push("");
  }
  lines.push(`_Total PVs abertos: ${data.total_pvs}_`);
  lines.push("");
  lines.push(`📈 [Ver evolução (gráfico + histórico) →](https://painel.waterworks.com.br/relatorios/avulsos-daily)`);
  return lines.join("\n");
}

// ─── Chart SVG — gráfico de evolução por série (multi-linha) ────────────
// Renderiza séries por AlarmKind ao longo dos snapshots. Só dados reais.
// Cada série tem toggle (checkbox na legenda) — click liga/desliga.
const CHART_COLORS: Record<string, string> = {
  pvos_incompl:      "#dc2626", // red-600 — cadastro faltando
  sem_projeto:       "#be123c", // rose-800 — projeto não marcado
  aguarda_liberacao: "#d97706", // amber-600 — cliente sem PC formal
  venda:             "#f43f5e", // rose
  compra:            "#f97316", // orange — "Previsão atrasada" (unificado)
  sem_rc:            "#8b5cf6", // violet
  sem_pc:            "#a855f7", // purple
  aprov_pend:        "#f59e0b", // amber
  defas_omie:        "#ec4899", // pink
  sem_vinculo:       "#14b8a6", // teal
  agend_vazio:       "#06b6d4", // cyan
  agend_venc:        "#0ea5e9", // sky
  pode_faturar:      "#10b981", // emerald
};
const CHART_KIND_LABEL: Record<string, string> = {
  pvos_incompl:      "PV/OS incompl.",
  sem_projeto:       "Sem Projeto",
  aguarda_liberacao: "Aguard. Liberação",
  venda: "Vendas atraso", compra: "Previsão atrasada",
  sem_rc: "RC ausente/incompl", sem_pc: "PC ausente/incompl", aprov_pend: "Aprov pend",
  defas_omie: "Defas Omie", sem_vinculo: "Sem Vínculo",
  agend_vazio: "Sem prev.", agend_venc: "Prev vencida",
  pode_faturar: "Faturável",
};

function TrendChart({ trend }: {
  trend: { date: string; counts: Record<string, number> }[];
}) {
  // Todas as séries com pelo menos 1 ponto > 0
  const availableKinds = useMemo(
    () => Object.keys(CHART_COLORS).filter((k) => trend.some((d) => (d.counts[k] ?? 0) > 0)),
    [trend]
  );
  const [visible, setVisible] = useState<Set<string>>(new Set(availableKinds));
  // Sincroniza visible quando availableKinds muda (novo snapshot)
  useEffect(() => { setVisible(new Set(availableKinds)); }, [availableKinds.join(",")]);
  const toggle = (k: string) => setVisible((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const allOn = () => setVisible(new Set(availableKinds));
  const allOff = () => setVisible(new Set());

  if (trend.length === 0) {
    return (
      <div className="border border-ww-border rounded-lg overflow-hidden bg-ww-panel">
        <div className="px-4 py-2 border-b border-ww-border bg-ww-bg">
          <span className="text-[13px] font-bold uppercase tracking-[0.5px] text-ww-text">📈 Evolução</span>
        </div>
        <div className="p-8 text-center text-[12px] text-ww-textMuted">
          Sem snapshots ainda. Aguarde o cron 07:55 SP ou os dados começarão a aparecer conforme forem sendo capturados.
        </div>
      </div>
    );
  }

  const W = 780, H = 320, PAD_L = 34, PAD_R = 16, PAD_T = 16, PAD_B = 32;
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B;
  const visibleKinds = availableKinds.filter((k) => visible.has(k));
  const maxY = Math.max(1, ...trend.flatMap((d) => visibleKinds.map((k) => d.counts[k] ?? 0)));
  const yTicks = 4;
  const xStep = trend.length > 1 ? innerW / (trend.length - 1) : innerW;
  const xy = (i: number, v: number) => ({
    x: PAD_L + i * xStep,
    y: PAD_T + innerH - (v / maxY) * innerH,
  });

  return (
    <div className="border border-ww-border rounded-lg overflow-hidden bg-ww-panel">
      <div className="px-4 py-2 border-b border-ww-border bg-ww-bg flex items-center justify-between">
        <span className="text-[13px] font-bold uppercase tracking-[0.5px] text-ww-text">
          📈 Evolução ({trend.length}d)
        </span>
        <div className="flex items-center gap-1 avulsos-daily-noprint">
          <button type="button" onClick={allOn}
            className="text-[10px] font-semibold px-2 py-0.5 rounded border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-textMuted hover:text-ww-text">
            Todos
          </button>
          <button type="button" onClick={allOff}
            className="text-[10px] font-semibold px-2 py-0.5 rounded border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-textMuted hover:text-ww-text">
            Nenhum
          </button>
        </div>
      </div>

      {/* Legenda-toggles em cima do chart — cada uma clicável */}
      <div className="flex flex-wrap gap-1.5 px-3 pt-3 avulsos-daily-noprint">
        {availableKinds.map((k) => {
          const isOn = visible.has(k);
          const last = trend[trend.length - 1].counts[k] ?? 0;
          return (
            <button key={k} type="button" onClick={() => toggle(k)}
              className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold px-2 py-0.5 rounded-md border transition ${
                isOn
                  ? "border-ww-border bg-ww-panel text-ww-text hover:bg-ww-rowHover"
                  : "border-ww-border bg-ww-bg text-ww-textFaint opacity-50 hover:opacity-100"
              }`}>
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CHART_COLORS[k] }} />
              <span>{CHART_KIND_LABEL[k]}</span>
              <span className="tabular-nums text-ww-textMuted">{last}</span>
            </button>
          );
        })}
      </div>

      <div className="p-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
          {/* Y grid + labels */}
          {Array.from({ length: yTicks + 1 }, (_, i) => {
            const v = Math.round((maxY / yTicks) * i);
            const y = PAD_T + innerH - (v / maxY) * innerH;
            return (
              <g key={i}>
                <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y}
                  stroke="currentColor" strokeOpacity={0.08} strokeDasharray="2,3" />
                <text x={PAD_L - 6} y={y + 3} fontSize="10" fill="currentColor" fillOpacity={0.5}
                  textAnchor="end" fontFamily="ui-sans-serif">{v}</text>
              </g>
            );
          })}
          {/* X labels — primeira/meio/última */}
          {trend.map((d, i) => {
            const showLabel = i === 0 || i === trend.length - 1 || i === Math.floor(trend.length / 2);
            if (!showLabel) return null;
            const { x } = xy(i, 0);
            const [, mm, dd] = d.date.split("-");
            return (
              <text key={i} x={x} y={H - PAD_B + 14} fontSize="10" fill="currentColor" fillOpacity={0.6}
                textAnchor="middle" fontFamily="ui-monospace">
                {dd}/{mm}
              </text>
            );
          })}
          {/* Séries visíveis */}
          {visibleKinds.map((k) => {
            const pts = trend.map((d, i) => xy(i, d.counts[k] ?? 0));
            const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
            return (
              <g key={k}>
                <path d={path} fill="none" stroke={CHART_COLORS[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={2.6} fill={CHART_COLORS[k]} />
                ))}
              </g>
            );
          })}
          {visibleKinds.length === 0 && (
            <text x={W / 2} y={H / 2} fontSize="12" fill="currentColor" fillOpacity={0.5}
              textAnchor="middle" fontFamily="ui-sans-serif">
              Nenhuma série selecionada — clique nas tags acima
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}

export default function AvulsosDailyView() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);

  async function fetchReport() {
    setLoading(true); setError(null);
    // Timeout de 55s (a rota tem maxDuration=60s). Sem isso, request travada
    // deixava a página em branco indefinidamente ("ora abre ora não").
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 55_000);
    try {
      const res = await fetch("/api/relatorios/avulsos-daily", { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? res.statusText);
      }
      const j = (await res.json()) as ApiResp;
      setData(j);
    } catch (e) {
      const msg = e instanceof Error
        ? (e.name === "AbortError" ? "Timeout (55s) — a view v_pc_avulsos demorou demais. Tente atualizar." : e.message)
        : String(e);
      setError(msg);
    } finally {
      clearTimeout(to);
      setLoading(false);
    }
  }
  // Fetch inicial + revalida quando usuário volta à aba (dados frescos ao reabrir)
  useEffect(() => {
    fetchReport();
    function onFocus() { if (!document.hidden) fetchReport(); }
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, []);

  // Auto-trigger print dialog quando URL tem ?print=1 (usado pelo botão "PDF"
  // do painel /avulsos — abre em nova aba já direto no dialog de impressão).
  useEffect(() => {
    if (!data || typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search).get("print");
    if (p !== "1") return;
    // Espera 1 tick pro DOM/chart terminarem de renderizar
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [data]);

  const markdown = useMemo(() => (data ? buildWebexMarkdown(data) : ""), [data]);

  async function copyText() {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { alert("Não consegui copiar. Selecione manualmente."); }
  }


  async function sendWebex() {
    if (!markdown) return;
    setSending(true);
    try {
      const res = await fetch("/api/relatorios/avulsos-daily/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setSentAt(new Date().toLocaleTimeString("pt-BR"));
    } catch (e) {
      alert(`Falha: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4 avulsos-daily-root">
      <div className="flex items-center justify-between avulsos-daily-noprint">
        <div>
          <h1 className="text-[20px] font-bold text-ww-text tracking-[-0.4px]">Daily Avulsos · Preview Webex</h1>
          <p className="text-[12px] text-ww-textMuted mt-0.5">
            Contadores atuais + delta vs último snapshot. Links abrem painel filtrado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchReport}
            className="px-3 py-1.5 text-[12px] font-semibold rounded-md border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-text">
            {loading ? "Atualizando…" : "🔄 Atualizar"}
          </button>
          <button onClick={copyText} disabled={!data}
            className="px-3 py-1.5 text-[12px] font-semibold rounded-md border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-text disabled:opacity-40">
            {copied ? "✓ Copiado" : "📋 Copiar markdown"}
          </button>
          <button onClick={sendWebex} disabled={!data || sending}
            className="px-3 py-1.5 text-[12px] font-semibold rounded-md border border-ww-accent bg-ww-accent text-white hover:opacity-90 disabled:opacity-40">
            {sending ? "Enviando…" : "📤 Enviar ao Webex"}
          </button>
          <button onClick={() => window.print()} disabled={!data}
            className="px-3 py-1.5 text-[12px] font-semibold rounded-md border border-slate-700 bg-slate-800 text-white hover:opacity-90 disabled:opacity-40">
            📄 PDF completo
          </button>
        </div>
      </div>

      {/* CSS pra impressão: esconde tudo fora do report, quebra páginas
          entre seções e formata pra A4. window.print() abre o dialog do
          browser onde o usuário escolhe "Salvar como PDF". */}
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
          .avulsos-daily-noprint { display: none !important; }
          .avulsos-daily-root { max-width: none !important; padding: 0 !important; }
          .avulsos-daily-report { box-shadow: none !important; border: none !important; break-inside: auto; }
          .avulsos-daily-section { break-inside: avoid; page-break-inside: avoid; }
          .avulsos-daily-report * { color: black !important; }
          /* Força todos os <details> abertos no PDF pra mostrar a lista de PVs */
          details > summary { list-style: none; }
          details > summary::-webkit-details-marker { display: none; }
          details > *:not(summary) { display: block !important; }
        }
      `}</style>

      {error && (
        <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-lg text-rose-800 dark:text-rose-200 text-[13px]">
          <strong>Erro:</strong> {error}
        </div>
      )}
      {sentAt && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-lg text-emerald-800 dark:text-emerald-200 text-[13px]">
          ✓ Enviado ao Webex às {sentAt}
        </div>
      )}
      {loading && !data && !error && <LoadingSkeleton />}
      {data && <WebexPreview markdown={markdown} />}
      {data && <TrendChart trend={data.trend ?? []} />}

      {data && (
        <>
          <div className="text-[12.5px] text-ww-textMuted">
            Total PVs abertos: <span className="font-bold text-ww-text tabular-nums">{data.total_pvs}</span>
            {data.previous_date && (
              <span className="ml-3">Comparativo com <span className="font-mono text-[11px]">{data.previous_date}</span></span>
            )}
          </div>

          <div className="space-y-4 avulsos-daily-report">
            {data.sections.map((sec) => (
              <div key={sec.title} className="border border-ww-border rounded-lg overflow-hidden bg-ww-panel avulsos-daily-section">
                <div className="px-4 py-2 border-b border-ww-border bg-ww-bg">
                  <span className="text-[13px] font-bold uppercase tracking-[0.5px] text-ww-text">
                    {sec.emoji} {sec.title}
                  </span>
                </div>
                <div className="divide-y divide-ww-border">
                  {sec.items.map((it) => (
                    <details key={it.kind} className="group">
                      <summary className="px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-ww-rowHover list-none">
                        <span className="text-ww-textFaint text-[10px] w-3 shrink-0 group-open:rotate-90 transition-transform">▶</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-ww-text truncate">{it.label}</div>
                          <div className="text-[11px] text-ww-textFaint mt-0.5">
                            Responsável: <span className="font-semibold">{it.owner}</span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-[16px] font-bold tabular-nums text-ww-text">{it.count}</div>
                          {it.val > 0 && (
                            <div className="text-[11px] tabular-nums text-ww-textMuted">{fmtBRL(it.val)}</div>
                          )}
                        </div>
                        {it.delta_count != null && (
                          <div className={`shrink-0 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded ${
                            it.delta_count > 0 ? "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                            : it.delta_count < 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                            : "bg-ww-bg text-ww-textMuted "
                          }`}>
                            {it.delta_count > 0 ? `+${it.delta_count}` : it.delta_count === 0 ? "=" : it.delta_count}
                          </div>
                        )}
                        <a href={it.link} target="_blank" rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 text-[11px] font-semibold text-blue-700 dark:text-blue-400 hover:underline avulsos-daily-noprint">
                          ver →
                        </a>
                      </summary>
                      {/* Lista de PVs afetados — o print inclui, o preview mostra ao expandir */}
                      {it.pvs.length > 0 ? (
                        <div className="px-6 pb-3 pt-1">
                          <table className="w-full text-[11.5px]">
                            <thead>
                              <tr className="text-[10px] uppercase tracking-[0.4px] text-ww-textFaint border-b border-ww-border">
                                <th className="text-left py-1 font-semibold">PV/OS</th>
                                <th className="text-left py-1 font-semibold">Cliente</th>
                                <th className="text-left py-1 font-semibold w-20">Tipo</th>
                                <th className="text-right py-1 font-semibold w-24">Valor</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-ww-border/40">
                              {it.pvs.map((p) => (
                                <tr key={p.pv_os_label}>
                                  <td className="py-1 font-mono text-[11px] text-ww-text">
                                    <a href={`https://painel.waterworks.com.br/avulsos?q=${encodeURIComponent(p.pv_os_label)}`}
                                       target="_blank" rel="noopener noreferrer"
                                       className="text-blue-700 dark:text-blue-400 hover:underline">
                                      {p.pv_os_label}
                                    </a>
                                  </td>
                                  <td className="py-1 text-ww-text truncate max-w-[280px]">{p.cliente}</td>
                                  <td className="py-1 text-ww-textMuted text-[10.5px]">{p.tipo}</td>
                                  <td className="py-1 tabular-nums text-right text-ww-text">{fmtBRL(p.valor)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="px-6 pb-3 pt-1 text-[11px] text-ww-textFaint italic">
                          Nenhum PV neste alarme.
                        </div>
                      )}
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <details className="border border-ww-border rounded-lg bg-ww-bg avulsos-daily-noprint">
            <summary className="px-4 py-2 text-[12px] font-semibold text-ww-text cursor-pointer">
              Markdown bruto (o que é enviado à API do Webex)
            </summary>
            <pre className="p-4 text-[11px] font-mono leading-[1.6] text-ww-text whitespace-pre-wrap">{markdown}</pre>
          </details>

          <div className="text-[10.5px] text-ww-textFaint italic">
            Gerado em {new Date(data.generated_at).toLocaleString("pt-BR")}. Cron diário 07:55 SP grava snapshot;
            envio automático ao Webex será agendado quando o PNG do gráfico for finalizado (próxima entrega).
          </div>
        </>
      )}
    </div>
  );
}

// Skeleton exibido enquanto a primeira request está em voo. Sem isso, a
// página ficava totalmente em branco por 10-30s enquanto v_pc_avulsos carrega.
function LoadingSkeleton() {
  return (
    <div className="space-y-4 avulsos-daily-noprint">
      <div className="border border-ww-border rounded-lg bg-ww-panel p-4">
        <div className="flex items-center gap-2 text-[12.5px] text-ww-textMuted">
          <span className="inline-block w-3 h-3 rounded-full bg-ww-accent animate-pulse" />
          <span>Puxando dados frescos do painel Avulsos…</span>
          <span className="ml-auto text-[10.5px] text-ww-textFaint">
            v_pc_avulsos costuma responder em ~10-25s
          </span>
        </div>
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="border border-ww-border rounded-lg bg-ww-panel overflow-hidden">
          <div className="px-4 py-2 border-b border-ww-border bg-ww-bg">
            <div className="h-3 w-32 rounded bg-ww-border animate-pulse" />
          </div>
          <div className="divide-y divide-ww-border">
            {[1, 2, 3].map((j) => (
              <div key={j} className="px-4 py-3 flex items-center gap-3">
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-2/3 rounded bg-ww-border animate-pulse" />
                  <div className="h-2 w-24 rounded bg-ww-border/50 animate-pulse" />
                </div>
                <div className="h-6 w-10 rounded bg-ww-border animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Renderiza o markdown do Webex como o Webex mostraria — permite conferir
// visualmente o que os destinatários vão receber ANTES de clicar "Enviar".
// Parser propositalmente restrito ao subset que buildWebexMarkdown emite:
// ### heading, **bold**, - lista, [texto](url), _italic_.
function WebexPreview({ markdown }: { markdown: string }) {
  const nodes = useMemo(() => renderWebexMarkdown(markdown), [markdown]);
  return (
    <div className="border-2 border-emerald-400 dark:border-emerald-700 rounded-lg overflow-hidden bg-ww-panel shadow-sm">
      <div className="px-4 py-2 border-b border-ww-border bg-emerald-50 dark:bg-emerald-950/30 flex items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.5px] text-emerald-800 dark:text-emerald-200">
          👀 Assim vai chegar no Webex
        </span>
        <span className="text-[10.5px] text-emerald-700 dark:text-emerald-300 ml-auto">
          confira antes de enviar
        </span>
      </div>
      <div className="p-4 text-[13px] leading-[1.55] text-ww-text">{nodes}</div>
    </div>
  );
}

// Mini renderer: percorre linhas e faz o parse do subset conhecido.
function renderWebexMarkdown(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  const lines = md.split("\n");
  let listBuf: ReactNode[] = [];
  const flushList = () => {
    if (listBuf.length === 0) return;
    out.push(<ul key={`ul-${out.length}`} className="list-disc pl-5 space-y-1 mb-2">{listBuf}</ul>);
    listBuf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();
    if (line === "") { flushList(); continue; }
    if (line.startsWith("### ")) {
      flushList();
      out.push(<h3 key={`h-${i}`} className="text-[15px] font-bold text-ww-text mb-2">{renderInline(line.slice(4))}</h3>);
      continue;
    }
    // Linhas soltas com só **bold** viram subtítulo (seções do report)
    if (/^\*\*.+\*\*$/.test(line)) {
      flushList();
      const inner = line.slice(2, -2);
      out.push(<div key={`s-${i}`} className="text-[13px] font-bold text-ww-text mt-3 mb-1">{renderInline(inner)}</div>);
      continue;
    }
    if (line.startsWith("- ")) {
      listBuf.push(<li key={`li-${i}`}>{renderInline(line.slice(2))}</li>);
      continue;
    }
    // Linha comum — pode ter italic (_..._) ou texto puro
    flushList();
    out.push(<p key={`p-${i}`} className="text-[12.5px] text-ww-textMuted mb-1">{renderInline(line)}</p>);
  }
  flushList();
  return out;
}

// Inline: **bold**, [texto](url), _italic_. Ordem importa (bold antes de italic).
function renderInline(s: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = s;
  let key = 0;
  // Regex combinado: link | bold | italic
  const re = /(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(_[^_]+_)/;
  while (rest.length > 0) {
    const m = rest.match(re);
    if (!m || m.index === undefined) { nodes.push(rest); break; }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (linkMatch) {
        nodes.push(
          <a key={`a-${key++}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
             className="text-blue-700 dark:text-blue-400 hover:underline">
            {linkMatch[1]}
          </a>
        );
      }
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={`b-${key++}`} className="font-bold text-ww-text">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("_")) {
      nodes.push(<em key={`i-${key++}`} className="italic text-ww-textMuted">{tok.slice(1, -1)}</em>);
    }
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}
