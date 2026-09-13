// Um report incorporado, para a página navegável /reports-cesar/[id].
//
//   GET   → o report, se a pessoa pode vê-lo (área da tela + régua de
//           visibilidade: todos | proprio | custom/shared_emails)
//   PATCH → o mini-ajuste de compartilhamento (visibilidade/shared_emails)
//           e/ou payload — só o dono ou admin.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea, type Area } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { visivelPara, type ReportLinha } from "@/lib/cesar/report-config";

export const runtime = "nodejs";

const AREA_DA_TELA: Record<string, Area> = {
  "/bi/fluxo-caixa": "financeiro",
  "/bi/contas-pagar": "financeiro",
  "/bi/contas-receber": "financeiro",
  "/bi/financeiro": "financeiro",
  "/relatorios/faturamento": "vendas",
};

const admPublico = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false }, db: { schema: "public" } },
);

async function carregar(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const { data } = await admPublico()
    .from("cesar_reports")
    .select("id, tela, titulo, payload, criado_por, visibilidade, shared_emails, created_at")
    .eq("id", id)
    .maybeSingle();
  return (data as ReportLinha | null) ?? null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await carregar(id);
  if (!row) return NextResponse.json({ error: "Report não encontrado" }, { status: 404 });
  if (!canViewArea(perms, AREA_DA_TELA[row.tela])) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const supa = await supaServer("public");
  const { data: { user } } = await supa.auth.getUser();
  const email = (user?.email || "").toLowerCase();
  if (!visivelPara(row, email)) return NextResponse.json({ error: "Report não encontrado" }, { status: 404 });

  const dono = String(row.criado_por || "").toLowerCase() === email;
  return NextResponse.json({ report: row, pode_ajustar: dono || !!perms.is_admin });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await carregar(id);
  if (!row) return NextResponse.json({ error: "Report não encontrado" }, { status: 404 });

  const supa = await supaServer("public");
  const { data: { user } } = await supa.auth.getUser();
  const email = (user?.email || "").toLowerCase();
  const dono = String(row.criado_por || "").toLowerCase() === email;
  if (!dono && !perms.is_admin) {
    return NextResponse.json({ error: "Só o dono do report ou admin ajusta" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.visibilidade === "string") {
    if (!["todos", "proprio", "custom"].includes(body.visibilidade)) {
      return NextResponse.json({ error: "visibilidade inválida" }, { status: 400 });
    }
    patch.visibilidade = body.visibilidade;
  }
  if (Array.isArray(body.shared_emails)) {
    const emails = body.shared_emails
      .map((e: unknown) => String(e || "").toLowerCase().trim())
      .filter((e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      .slice(0, 30);
    patch.shared_emails = emails;
  }
  if (body.report && typeof body.report === "object") patch.payload = body.report;
  if (typeof body.titulo === "string" && body.titulo.trim()) patch.titulo = body.titulo.trim().slice(0, 140);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nada para ajustar" }, { status: 400 });

  const { error } = await admPublico().from("cesar_reports").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
