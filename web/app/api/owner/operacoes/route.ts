// Operações (App WW field service) — Supabase externo via WW_SUPABASE_URL.
import { NextResponse } from "next/server";
import { requireOwner } from "../_guard";
import { wwClient } from "@/lib/owner-clients";

export const runtime = "nodejs";
export const maxDuration = 30;

type Periodo = "3m" | "6m" | "12m" | "ytd";

function periodoStart(p: Periodo): Date {
  const now = new Date();
  if (p === "ytd") return new Date(now.getFullYear(), 0, 1);
  const months = p === "3m" ? 3 : p === "6m" ? 6 : 12;
  return new Date(now.getFullYear(), now.getMonth() - months, 1);
}

export async function GET(req: Request) {
  const { error: guardErr } = await requireOwner();
  if (guardErr) return guardErr;

  const ww = wwClient();
  if (!ww) {
    return NextResponse.json({
      configured: false,
      hint: "Configure WW_SUPABASE_URL e WW_SERVICE_ROLE_KEY no Vercel pra ativar dados de Operações (App WW).",
    });
  }

  const url = new URL(req.url);
  const periodo = (url.searchParams.get("periodo") ?? "12m") as Periodo;
  const fromIso = periodoStart(periodo).toISOString();

  const [{ data: oss, error: ossErr }, { data: expenses, error: expErr }] = await Promise.all([
    ww.from("service_orders")
      .select("id, status, service_type, created_at, checkin_at, checkout_at, customer_id, lider_id")
      .gte("created_at", fromIso)
      .limit(5000),
    ww.from("expenses")
      .select("id, valor, data, tipo_despesa, employee_id, aprovada")
      .gte("data", fromIso.slice(0, 10))
      .limit(5000),
  ]);
  if (ossErr || expErr) {
    return NextResponse.json({
      configured: true,
      error: ossErr?.message ?? expErr?.message ?? "Falha ao ler App WW",
    }, { status: 500 });
  }

  type OS = { id: string; status?: string; service_type?: string; checkin_at?: string; checkout_at?: string; lider_id?: string; customer_id?: string };
  type Exp = { valor?: number; tipo_despesa?: string; employee_id?: string; aprovada?: boolean };

  const ossList = (oss ?? []) as OS[];
  const expList = (expenses ?? []) as Exp[];

  const oss_total = ossList.length;
  const oss_concluidas = ossList.filter((o) => /CONCLU|FECHAD/i.test(String(o.status ?? ""))).length;
  const total_despesas = expList.reduce((s, e) => s + Number(e.valor ?? 0), 0);
  const total_despesas_aprovadas = expList.filter((e) => e.aprovada).reduce((s, e) => s + Number(e.valor ?? 0), 0);

  // Horas estimadas (delta checkin/checkout)
  let horas_campo = 0;
  for (const o of ossList) {
    if (!o.checkin_at || !o.checkout_at) continue;
    const dt = (new Date(o.checkout_at).getTime() - new Date(o.checkin_at).getTime()) / 3_600_000;
    if (dt > 0 && dt < 24) horas_campo += dt;
  }

  // Ranking técnicos: qtd OS + total despesas
  const porTecnico = new Map<string, { oss: number; despesas: number }>();
  for (const o of ossList) {
    const id = o.lider_id ?? "—";
    porTecnico.set(id, { oss: (porTecnico.get(id)?.oss ?? 0) + 1, despesas: porTecnico.get(id)?.despesas ?? 0 });
  }
  for (const e of expList) {
    const id = e.employee_id ?? "—";
    porTecnico.set(id, { oss: porTecnico.get(id)?.oss ?? 0, despesas: (porTecnico.get(id)?.despesas ?? 0) + Number(e.valor ?? 0) });
  }
  // Resolve nomes (1 query batch)
  const technicianIds = [...porTecnico.keys()].filter((k) => k !== "—");
  let nomes: Record<string, string> = {};
  if (technicianIds.length) {
    const { data: emp } = await ww.from("employees").select("id, nome").in("id", technicianIds);
    nomes = Object.fromEntries(((emp ?? []) as Array<{ id: string; nome?: string }>).map((e) => [e.id, e.nome ?? "—"]));
  }

  const ranking_tecnicos = [...porTecnico.entries()]
    .map(([id, v]) => ({ id, nome: nomes[id] ?? "—", oss: v.oss, despesas: v.despesas }))
    .sort((a, b) => b.oss - a.oss).slice(0, 20);

  // OS por tipo
  const porTipo = new Map<string, number>();
  for (const o of ossList) {
    const t = String(o.service_type ?? "?");
    porTipo.set(t, (porTipo.get(t) ?? 0) + 1);
  }

  return NextResponse.json({
    configured: true,
    oss_total,
    oss_concluidas,
    total_despesas,
    total_despesas_aprovadas,
    horas_campo,
    por_tipo: [...porTipo.entries()].map(([tipo, qtd]) => ({ tipo, qtd })).sort((a, b) => b.qtd - a.qtd),
    ranking_tecnicos,
  });
}
