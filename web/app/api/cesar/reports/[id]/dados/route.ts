// Dados VIVOS de um report do Cesar: a tela manda os valores dos filtros e o
// servidor reexecuta as consultas gravadas via bi.cesar_consulta_livre
// (read-only, sql-guard de novo a cada execução). O payload vem do BANCO —
// o cliente nunca manda SQL.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea, type Area } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { visivelPara, type ReportLinha } from "@/lib/cesar/report-config";
import { executarFontes, type ValoresFiltro } from "@/lib/cesar/report-fontes";
import type { ReportPayload } from "@/lib/cesar/report-pdf";

export const runtime = "nodejs";

const AREA_DA_TELA: Record<string, Area> = {
  "/bi/fluxo-caixa": "financeiro",
  "/bi/contas-pagar": "financeiro",
  "/bi/contas-receber": "financeiro",
  "/bi/financeiro": "financeiro",
  "/relatorios/faturamento": "vendas",
};

const adm = (schema: "public" | "bi") => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false }, db: { schema } },
);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: row } = await adm("public")
    .from("cesar_reports")
    .select("id, tela, titulo, payload, criado_por, visibilidade, shared_emails, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Report não encontrado" }, { status: 404 });
  if (!canViewArea(perms, AREA_DA_TELA[(row as ReportLinha).tela])) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const supa = await supaServer("public");
  const { data: { user } } = await supa.auth.getUser();
  const email = (user?.email || "").toLowerCase();
  if (!visivelPara(row as ReportLinha, email)) {
    return NextResponse.json({ error: "Report não encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const valores = (body?.filtros && typeof body.filtros === "object" ? body.filtros : {}) as ValoresFiltro;
  const dados = await executarFontes(adm("bi"), (row as { payload: ReportPayload }).payload, valores);
  return NextResponse.json({ data: dados });
}
