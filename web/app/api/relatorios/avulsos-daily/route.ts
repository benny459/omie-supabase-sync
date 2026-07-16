// /api/relatorios/avulsos-daily — report DIÁRIO compacto de Vendas Avulsas.
// GET: retorna estrutura pronta pra:
//   • Renderizar UI de preview (AvulsosDailyView)
//   • Serializar em markdown pra Webex (built by AvulsosDailyView ou cron caller)
//   • Base do PNG (rota separada consumirá /api/relatorios/avulsos-daily/png)
//
// Estrutura devolvida: seções (VENDAS / COMPRAS / SERVIÇOS / FATURAMENTO) com
// linhas { kind, label, count, val, owner, link, delta } — delta comparando
// com snapshot do dia anterior (se existir) pra sinalizar melhora/piora.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import {
  computeReportCounts,
  readSnapshots,
  buildAlarmeLink,
  ALARM_OWNERS,
  REPORT_SECTIONS,
  type AlarmKind,
} from "@/lib/avulsos-report";

export const runtime = "nodejs";
export const maxDuration = 60;

type ReportItem = {
  kind: AlarmKind;
  label: string;
  count: number;
  val: number;
  owner: string;
  link: string;
  delta_count: number | null;  // null se sem histórico
  pvs: { pv_os_label: string; cliente: string; tipo: string; valor: number }[];
};

type ReportSection = {
  title: string;
  emoji: string;
  items: ReportItem[];
};

export async function GET() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = await computeReportCounts();
  // Delta vs ontem — usa último snapshot anterior a hoje
  const snapshots = await readSnapshots(30);
  const today = new Date().toISOString().slice(0, 10);
  const previous = snapshots.filter((s) => s.date < today).slice(-1)[0];
  const prevCounts = previous?.counts ?? {};

  const sections: ReportSection[] = REPORT_SECTIONS.map((sec) => ({
    title: sec.title,
    emoji: sec.emoji,
    items: sec.items.map(({ kind, label }): ReportItem => {
      const c = now.counts[kind] ?? 0;
      const p = Number(prevCounts[kind] ?? c);  // se sem histórico, delta 0
      return {
        kind,
        label,
        count: c,
        val: now.vals[kind] ?? 0,
        owner: ALARM_OWNERS[kind] ?? "—",
        link: buildAlarmeLink(kind),
        delta_count: previous ? c - p : null,
        pvs: now.pvs_by_kind[kind] ?? [],
      };
    }),
  }));

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    total_pvs: now.total_pvs,
    sections,
    trend: snapshots.map((s) => ({ date: s.date, counts: s.counts, total_pvs: s.total_pvs })),
    previous_date: previous?.date ?? null,
  });
}
