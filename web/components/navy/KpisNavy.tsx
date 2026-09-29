"use client";

/**
 * KPIs do topo, com as definições do handoff.
 *
 * Do handoff, literalmente: "Se algum KPI não for desejado, remover — não
 * inventar métrica nova sem fonte." Por isso aqui só há o que tem origem
 * declarada, e cada card diz de onde vem no subtítulo.
 *
 * Tudo é calculado sobre os buckets JÁ FILTRADOS: os cards respondem ao
 * filtro de cima, senão diriam uma coisa e a lista outra.
 */

import { useMemo } from "react";
import { STATUS_META } from "@/lib/columns";
import { KpiCard, ProgressBar, tom, type Tom } from "./primitivos";

type AnyRow = Record<string, unknown>;
type Bucket = { pv_os_label: string; rows: AnyRow[]; pv_valor_total?: number | null };

const s = (v: unknown) => String(v ?? "").trim();

/** Mesma regra de lib/alarmes.ts: dt_fat OU num_nfe OU etapa Faturado/Cancelado.
 *  A redundância é intencional lá, para imunizar contra lag de sync do Omie —
 *  copiar a regra pela metade daria uma carteira maior do que a real. */
export function pedidoEncerrado(head: AnyRow): boolean {
  const etapa = s(head.pv_etapa_texto);
  return s(head.pv_dt_fat) !== "" || s(head.pv_num_nfe) !== ""
      || etapa === "Faturado" || etapa === "Cancelado";
}

const aprovado = (st: string) => STATUS_META[st]?.isApproved === true;
const PENDENTES = new Set(["PENDENTE", "PRE_SELECAO"]);
const BLOQUEADOS = new Set(["NAO_APROVADO", "REJEITADO_VALIDADE"]);

export default function KpisNavy({
  buckets, formatarValor, rotuloPedido = "pedido",
}: {
  buckets: Bucket[];
  formatarValor: (v: number) => string;
  rotuloPedido?: string;
}) {
  const kpi = useMemo(() => {
    let carteira = 0, pedidosAbertos = 0, lotes = 0;
    let apr = 0, pend = 0, bloq = 0, semPc = 0;
    // Recebimento por semana ISO, últimas 6.
    const porSemana = new Map<string, number>();

    for (const b of buckets) {
      const head = b.rows[0] ?? {};
      const encerrado = pedidoEncerrado(head);
      if (!encerrado) {
        carteira += Number(head.pv_valor_total ?? 0);
        pedidosAbertos += 1;
      }
      let temAlgumPc = false;
      for (const r of b.rows) {
        lotes += 1;
        const pc = s(r.pc_numero) || s(r.pc_numero_manual);
        if (pc) {
          temAlgumPc = true;
          const st = s(r.status);
          if (aprovado(st)) apr += 1;
          else if (PENDENTES.has(st)) pend += 1;
          else if (BLOQUEADOS.has(st)) bloq += 1;
        }
        const rec = s(r.mt_data_recebimento_nf);
        if (rec) {
          const d = new Date(rec);
          if (!Number.isNaN(d.getTime())) {
            // Segunda-feira da semana, como chave estável.
            const seg = new Date(d);
            seg.setDate(d.getDate() - ((d.getDay() + 6) % 7));
            const chave = seg.toISOString().slice(0, 10);
            porSemana.set(chave, (porSemana.get(chave) ?? 0) + Number(r.valor_total ?? 0));
          }
        }
      }
      if (!temAlgumPc) semPc += 1;
    }

    const semanas = [...porSemana.entries()].sort((a, b2) => a[0].localeCompare(b2[0])).slice(-6);
    const totalPcs = apr + pend + bloq;
    return { carteira, pedidosAbertos, lotes, apr, pend, bloq, semPc, semanas, totalPcs };
  }, [buckets]);

  const maxSemana = Math.max(1, ...kpi.semanas.map(([, v]) => v));
  const fatia = (n: number): { pct: number; t: Tom } =>
    ({ pct: kpi.totalPcs ? (n / kpi.totalPcs) * 100 : 0, t: "info" });

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
      gap: 16, marginBottom: 12,
    }}>
      {/* Hero — carteira em aberto */}
      <KpiCard
        hero
        label="Carteira em aberto"
        value={formatarValor(kpi.carteira)}
        sub={`${kpi.pedidosAbertos} ${rotuloPedido}${kpi.pedidosAbertos === 1 ? "" : "s"} não encerrado${kpi.pedidosAbertos === 1 ? "" : "s"} · ${kpi.lotes} lote${kpi.lotes === 1 ? "" : "s"}`}
      />

      {/* Aprovação de PCs — as quatro fatias do handoff, em barras. */}
      <div style={{
        borderRadius: "var(--radius-card)", padding: "16px 18px",
        background: "var(--ww-panel-grad)", border: "1px solid var(--ww-border)",
        boxShadow: "var(--shadow-card)", display: "flex", flexDirection: "column", gap: 8,
      }}>
        <span style={{ fontSize: "var(--text-body-sm)", fontWeight: 700, color: "var(--ww-text)" }}>
          Aprovação de PCs
        </span>
        {([
          ["Aprovados", kpi.apr, "ok"],
          ["Pendentes", kpi.pend, "warn"],
          ["Bloqueados", kpi.bloq, "crit"],
          [`Sem PC (${rotuloPedido}s)`, kpi.semPc, "off"],
        ] as [string, number, Tom][]).map(([rotulo, n, t]) => (
          <span key={rotulo} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-meta)" }}>
              <span style={{ color: "var(--ww-text-muted)" }}>{rotulo}</span>
              <span style={{ color: tom(t).fg, fontWeight: 700 }}>{n}</span>
            </span>
            <ProgressBar value={fatia(n).pct} tone={t} height={4} />
          </span>
        ))}
      </div>

      {/* Recebimento semanal — últimas 6 semanas com NF recebida. */}
      <div style={{
        borderRadius: "var(--radius-card)", padding: "16px 18px",
        background: "var(--ww-panel-grad)", border: "1px solid var(--ww-border)",
        boxShadow: "var(--shadow-card)", display: "flex", flexDirection: "column", gap: 8,
      }}>
        <span style={{ fontSize: "var(--text-body-sm)", fontWeight: 700, color: "var(--ww-text)" }}>
          Recebimento semanal
        </span>
        {kpi.semanas.length === 0 ? (
          <span style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-faint)" }}>
            Nenhuma NF recebida no que está filtrado.
          </span>
        ) : (
          <>
            <span style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 56 }}>
              {kpi.semanas.map(([semana, v]) => (
                <span key={semana} title={`semana de ${semana.slice(8)}/${semana.slice(5, 7)} · ${formatarValor(v)}`}
                  style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                  <span style={{
                    width: "100%", borderRadius: "var(--radius-bar) var(--radius-bar) 0 0",
                    height: `${Math.max(3, (v / maxSemana) * 42)}px`,
                    background: "var(--ww-ok)", boxShadow: "var(--ww-glow-ok)",
                  }} />
                  <span style={{ fontSize: "var(--text-micro)", color: "var(--ww-text-faint)" }}>
                    {semana.slice(8)}/{semana.slice(5, 7)}
                  </span>
                </span>
              ))}
            </span>
            <span style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-muted)" }}>
              Última: {formatarValor(kpi.semanas[kpi.semanas.length - 1][1])}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
