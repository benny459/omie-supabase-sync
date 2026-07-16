// /api/cron/avulsos-snapshot — captura snapshot diário dos contadores do
// report Avulsos em platform.avulsos_daily_snapshots. Consumido pelo report
// (mini-gráfico de evolução).
//
// Vercel cron dispara ~07:55 UTC (04:55 São Paulo) — antes do report 08:00.
// Manual: /api/cron/avulsos-snapshot?secret=<CRON_SECRET>
import { NextRequest, NextResponse } from "next/server";
import { persistSnapshot } from "@/lib/avulsos-report";

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

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const r = await persistSnapshot();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
