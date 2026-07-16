// GET  /api/rc-projetos/escopo?empresa=X&codigo_projeto=N — lê flags de escopo
// PATCH /api/rc-projetos/escopo — atualiza 1 ou mais flags (upsert em rc_projetos_budget)
// Flags (todas boolean, marcadas = despesa/serviço por nossa conta):
//   frete_incluso, faturamento_direto, despesas_estadia, despesas_deslocamento

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

const FLAGS = ["frete_incluso", "faturamento_direto", "despesas_estadia", "despesas_deslocamento"] as const;
type FlagKey = typeof FLAGS[number];

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const empresa = url.searchParams.get("empresa") ?? "";
  const codigoProjeto = Number(url.searchParams.get("codigo_projeto") ?? 0);
  if (!empresa || !codigoProjeto) return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });

  const { data, error } = await supa
    .schema("approval" as never)
    .from("rc_projetos_budget")
    .select("frete_incluso, faturamento_direto, despesas_estadia, despesas_deslocamento")
    .eq("empresa", empresa)
    .eq("codigo_projeto", codigoProjeto)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sem row = tudo false (default)
  const defaults: Record<FlagKey, boolean> = { frete_incluso: false, faturamento_direto: false, despesas_estadia: false, despesas_deslocamento: false };
  return NextResponse.json({ escopo: { ...defaults, ...(data ?? {}) } });
}

export async function PATCH(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { empresa?: string; codigo_projeto?: number } & Partial<Record<FlagKey, boolean>>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const empresa = String(body.empresa ?? "").trim();
  const codigoProjeto = Number(body.codigo_projeto);
  if (!empresa || !codigoProjeto) return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });

  // Só aceita as flags conhecidas — evita gravar keys arbitrárias via body.
  const patch: Record<string, boolean | string> = {
    atualizado_por: user.email || user.id,
    atualizado_em: new Date().toISOString(),
  };
  for (const k of FLAGS) if (typeof body[k] === "boolean") patch[k] = body[k]!;

  // Upsert (row pode não existir ainda se o Fluxo Financeiro nunca foi subido).
  const { error } = await supa
    .schema("approval" as never)
    .from("rc_projetos_budget")
    .upsert(
      { empresa, codigo_projeto: codigoProjeto, criado_por: user.email || user.id, ...patch },
      { onConflict: "empresa,codigo_projeto" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
