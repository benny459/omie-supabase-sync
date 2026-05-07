import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

// POST /api/admin/pc-lookup
// Body: { empresa: "SF"|"CD"|"WW", cnumero: string }
// Retorna { found: true, empresa, ncod_ped } ou { found: false }
export async function POST(req: Request) {
  const { error: guardErr } = await requireAdmin();
  if (guardErr) return guardErr;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const empresa = String((body as Record<string, unknown>).empresa ?? "");
  const cnumero = String((body as Record<string, unknown>).cnumero ?? "").trim();
  if (!empresa || !cnumero) {
    return NextResponse.json({ error: "empresa e cnumero obrigatórios" }, { status: 400 });
  }

  const admin = supaAdmin();
  const { data, error } = await admin
    .schema("orders")
    .from("pedidos_compra")
    .select("empresa, ncod_ped, cnumero")
    .eq("empresa", empresa)
    .eq("cnumero", cnumero)
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ found: false });
  return NextResponse.json({
    found: true,
    empresa: data.empresa,
    ncod_ped: data.ncod_ped,
  });
}
