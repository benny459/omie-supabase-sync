// Pipeline CRM (Supabase externo via CRM_SUPABASE_URL).
import { NextResponse } from "next/server";
import { requireOwner } from "../_guard";
import { crmClient, CRM_EMPRESA_ID } from "@/lib/owner-clients";

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

  const crm = crmClient();
  if (!crm) {
    return NextResponse.json({
      configured: false,
      hint: "Configure CRM_SUPABASE_URL e CRM_SERVICE_ROLE_KEY no Vercel pra ativar o pipeline CRM.",
    });
  }

  const url = new URL(req.url);
  const periodo = (url.searchParams.get("periodo") ?? "12m") as Periodo;
  const fromIso = periodoStart(periodo).toISOString();

  const { data, error } = await crm
    .from("propostas")
    .select("numero, tipo, status, valor, probabilidade, prev_fechamento, fase_doc, empresa_nome, projeto, responsavel, owner, updated_at, cliente_id")
    .eq("empresa_id", CRM_EMPRESA_ID)
    .gte("updated_at", fromIso)
    .limit(2000);

  if (error) return NextResponse.json({ configured: true, error: error.message }, { status: 500 });

  const ativos = (data ?? []).filter((p) =>
    !["PERDIDA", "CANCELADA"].includes(String((p as { status?: string }).status ?? "").toUpperCase())
  );

  let total_em_aberto = 0;
  let forecast_ponderado = 0;
  const porFase = new Map<string, { qtd: number; valor: number }>();
  const porTipo = new Map<string, { qtd: number; valor: number }>();
  for (const p of ativos as Array<{
    valor?: number; probabilidade?: number; status?: string; tipo?: string;
  }>) {
    const v = Number(p.valor ?? 0);
    total_em_aberto += v;
    forecast_ponderado += v * (Number(p.probabilidade ?? 0) / 100);
    const fase = String(p.status ?? "?");
    const tipo = String(p.tipo ?? "?");
    porFase.set(fase, { qtd: (porFase.get(fase)?.qtd ?? 0) + 1, valor: (porFase.get(fase)?.valor ?? 0) + v });
    porTipo.set(tipo, { qtd: (porTipo.get(tipo)?.qtd ?? 0) + 1, valor: (porTipo.get(tipo)?.valor ?? 0) + v });
  }

  // Taxa conversão últimos 90d
  const d90 = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data: ultimos } = await crm
    .from("propostas")
    .select("status, updated_at")
    .eq("empresa_id", CRM_EMPRESA_ID)
    .gte("updated_at", d90)
    .limit(1000);
  const aprovadas = (ultimos ?? []).filter((p) => /APROVADA|GANHA/i.test(String((p as { status?: string }).status ?? ""))).length;
  const perdidas = (ultimos ?? []).filter((p) => /PERDIDA|CANCELADA/i.test(String((p as { status?: string }).status ?? ""))).length;
  const taxa_conversao = (aprovadas + perdidas) > 0 ? (aprovadas / (aprovadas + perdidas)) * 100 : 0;

  return NextResponse.json({
    configured: true,
    total_em_aberto,
    forecast_ponderado,
    por_fase: [...porFase.entries()].map(([fase, v]) => ({ fase, ...v })).sort((a, b) => b.valor - a.valor),
    por_tipo: [...porTipo.entries()].map(([tipo, v]) => ({ tipo, ...v })),
    taxa_conversao,
    ativas: ativos.length,
    propostas: ativos.slice(0, 100),
  });
}
