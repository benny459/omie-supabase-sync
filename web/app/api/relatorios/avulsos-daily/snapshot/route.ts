// POST /api/relatorios/avulsos-daily/snapshot — trigger manual do snapshot
// diário a partir do painel (sem depender do CRON_SECRET). Só usuário auth.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { persistSnapshot } from "@/lib/avulsos-report";

export const runtime = "nodejs";

export async function POST() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const r = await persistSnapshot();
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
