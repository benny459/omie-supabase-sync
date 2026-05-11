import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// GET /api/sync-state → últimos syncs (qualquer user autenticado consegue ver)
export async function GET() {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // sales.sync_state não é exposto ao anon — usar service role
  const admin = supaAdmin();
  const { data, error } = await admin
    .schema("sales")
    .from("sync_state")
    .select("modulo, empresa, last_sync_at, total_registros, ultima_execucao_status, duracao_segundos, rows_inserted, rows_updated")
    .order("last_sync_at", { ascending: false, nullsFirst: false })
    .limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ syncs: data ?? [] });
}
