// GET /api/operacao/propostas?empresa=SF → { "PV1967": "OPS0610261008", … }
// De que proposta do CRM veio cada PV/OS (06/10/26) — chip na linha de Operação
// que abre a proposta no CRM do portal. Fonte: orders.operacao_propostas (sql/86).
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "operacao") && !canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  const empresa = (new URL(req.url).searchParams.get("empresa") ?? "SF").toUpperCase();
  const { data, error } = await supaAdmin().schema("orders").rpc("operacao_propostas", { p_empresa: empresa });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? {}, { headers: { "Cache-Control": "private, max-age=60" } });
}
