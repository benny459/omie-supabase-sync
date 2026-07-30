// GET /api/clientes-omie?q=texto
// Autocomplete busca em finance.clientes por razão/fantasia/CNPJ. Top 30.
// Filtra sempre por empresa=SF (Safe Water Brasil) — CD/WW não interessam pra atribuição de PCs.

import { NextRequest, NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });

  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );

  const filter = `razao_social.ilike.*${q}*,nome_fantasia.ilike.*${q}*,cnpj_cpf.ilike.*${q}*`;
  const { data, error } = await svc
    .from("clientes")
    .select("codigo_cliente_omie, razao_social, nome_fantasia, cnpj_cpf")
    .eq("empresa", "SF")
    .or(filter)
    .neq("inativo", "S")
    .order("razao_social")
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ items: data ?? [] });
}
