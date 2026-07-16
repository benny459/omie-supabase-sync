// /api/cron/avulsos-daily-send — envia o daily Avulsos ao canal Webex de
// Reports automaticamente. Vercel cron seg-sex 11:00 UTC = 08:00 BRT.
//
// Fluxo:
//   1) Persist snapshot do dia
//   2) Fetch counts + snapshots via helpers do lib/avulsos-report
//   3) Monta markdown compacto (mesmo formato do preview) com link pro painel
//   4) Posta no Webex (target=report). Gráfico fica no /relatorios/avulsos-daily.
//
// Auth: CRON_SECRET (bearer header) OU ?secret= querystring.

import { NextRequest, NextResponse } from "next/server";
import {
  ALARM_OWNERS,
  REPORT_SECTIONS,
  buildAlarmeLink,
  computeReportCounts,
  persistSnapshot,
  readSnapshots,
} from "@/lib/avulsos-report";
import { postWebexMessage } from "@/lib/webex";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${secret}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("secret") === secret;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v || 0);

// Mesmo formato de markdown do preview em AvulsosDailyView (buildWebexMarkdown).
// Mantidos em paralelo pra evitar cross-import client/server — mudanças devem
// ser feitas nos dois lugares.
type Counts = Awaited<ReturnType<typeof computeReportCounts>>;
function buildMarkdown(
  now: Counts,
  prevCounts: Record<string, number> | null,
  totalPvs: number,
): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const lines: string[] = [];
  lines.push(`### 📊 Report Avulsos — ${dd}/${mm}`);
  lines.push("");
  for (const sec of REPORT_SECTIONS) {
    lines.push(`**${sec.emoji} ${sec.title}**`);
    for (const { kind, label } of sec.items) {
      const c = now.counts[kind] ?? 0;
      const v = now.vals[kind] ?? 0;
      const owner = ALARM_OWNERS[kind] ?? "—";
      const link = buildAlarmeLink(kind);
      let delta = "";
      if (prevCounts) {
        const p = Number(prevCounts[kind] ?? c);
        const d = c - p;
        delta = d > 0 ? ` (📈 +${d})` : d < 0 ? ` (📉 ${d})` : " (=)";
      }
      const val = v > 0 ? ` · ${fmtBRL(v)}` : "";
      lines.push(`- ${label}: **${c}**${val}${delta} · [ver](${link}) — ${owner}`);
    }
    lines.push("");
  }
  lines.push(`_Total PVs abertos: ${totalPvs}_`);
  lines.push("");
  lines.push(`📈 [Ver evolução (gráfico + histórico) →](https://painel.waterworks.com.br/relatorios/avulsos-daily)`);
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const started = Date.now();
  const debug: Record<string, unknown> = {};

  try {
    // 1. Snapshot do dia (idempotente — updates existing se ja tem)
    try { await persistSnapshot(); debug.snapshot = "ok"; }
    catch (e) { debug.snapshot = e instanceof Error ? e.message : String(e); }

    // 2. Counts + previous snapshot pra delta
    const now = await computeReportCounts();
    const snaps = await readSnapshots(30);
    const today = new Date().toISOString().slice(0, 10);
    const previous = snaps.filter((s) => s.date < today).slice(-1)[0];
    const prevCounts = previous?.counts ?? null;

    // 3. Markdown
    const md = buildMarkdown(now, prevCounts, now.total_pvs);
    debug.markdown_length = md.length;

    // 4. Envia ao Webex (só markdown com link — sem anexo PNG)
    const webexRes = await postWebexMessage(md, { target: "report" });
    if (!webexRes.ok) {
      return NextResponse.json(
        { ok: false, error: webexRes.error, ...debug },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      total_pvs: now.total_pvs,
      elapsed_ms: Date.now() - started,
      ...debug,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), ...debug },
      { status: 500 },
    );
  }
}
