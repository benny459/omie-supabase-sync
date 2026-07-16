// GET /api/projeto-etapas?empresa=X&codigo_projeto=N — lista etapas do projeto
// POST /api/projeto-etapas — cria etapa nova
// Body POST: { empresa, codigo_projeto, etapa, data_prevista?, ordem? }

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const empresa = url.searchParams.get("empresa");
  const codigoProjeto = Number(url.searchParams.get("codigo_projeto"));
  if (!empresa || !codigoProjeto) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }
  const { data, error } = await supa
    .schema("approval" as never)
    .from("projeto_etapas")
    .select("id, etapa, ordem, data_prevista, data_conclusao, alteracoes_count, historico, atualizado_em, atualizado_por")
    .eq("empresa", empresa)
    .eq("codigo_projeto", codigoProjeto)
    .order("ordem", { ascending: true })
    .order("criado_em", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { empresa?: string; codigo_projeto?: number; etapa?: string; data_prevista?: string | null; ordem?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const empresa = String(body.empresa ?? "").trim();
  const codigoProjeto = Number(body.codigo_projeto);
  const etapa = String(body.etapa ?? "").trim();
  if (!empresa || !codigoProjeto || !etapa) {
    return NextResponse.json({ error: "empresa, codigo_projeto, etapa obrigatórios" }, { status: 400 });
  }
  const userEmail = user.email || user.id;

  const { data, error } = await supa
    .schema("approval" as never)
    .from("projeto_etapas")
    .insert({
      empresa, codigo_projeto: codigoProjeto, etapa,
      data_prevista: body.data_prevista ?? null,
      ordem: body.ordem ?? 0,
      criado_por: userEmail,
      atualizado_por: userEmail,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id });
}
