// POST /api/rc-projetos/upload/preflight — calcula diff SEM aplicar.
// Retorna: { novos, atualizados, removidos, total_atual }.
// Usado pelo dialog de upload pra confirmar destructive-sync antes de gravar.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

type Item = { equipamento: string; item: string };
type Body = { empresa: string; codigo_projeto: number; items: Item[] };

function itemNorm(s: string): string {
  return s.toLowerCase().trim();
}

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.empresa || !body.codigo_projeto || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "empresa, codigo_projeto e items[] obrigatórios" }, { status: 400 });
  }

  const empresa = String(body.empresa);
  const codigoProjeto = Number(body.codigo_projeto);

  // Set de natural keys da planilha nova
  const incomingKeys = new Set<string>();
  for (const raw of body.items) {
    const eq = String(raw.equipamento ?? "").trim();
    const it = String(raw.item ?? "").trim();
    if (!eq || !it) continue;
    incomingKeys.add(`${eq}\x01${itemNorm(it)}`);
  }

  // Existente no DB
  const { data, error } = await supa
    .schema("approval" as never)
    .from("rc_projetos_itens")
    .select("equipamento, item_norm")
    .eq("empresa", empresa)
    .eq("codigo_projeto", codigoProjeto);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { equipamento: string; item_norm: string };
  const existingKeys = new Set<string>();
  for (const r of (data ?? []) as Row[]) {
    existingKeys.add(`${r.equipamento}\x01${r.item_norm}`);
  }

  let novos = 0, atualizados = 0;
  for (const k of incomingKeys) {
    if (existingKeys.has(k)) atualizados++;
    else novos++;
  }
  let removidos = 0;
  for (const k of existingKeys) {
    if (!incomingKeys.has(k)) removidos++;
  }

  return NextResponse.json({
    novos,
    atualizados,
    removidos,
    total_atual: existingKeys.size,
    total_novo: incomingKeys.size,
  });
}
