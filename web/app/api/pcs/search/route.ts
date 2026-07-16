// GET /api/pcs/search?empresa=SF&q=<texto>&limit=20
// Busca PCs existentes no Omie (via v_pc_pcs) — usado pelo picker de vincular
// itens da Lista de Materiais a um PC. Retorna nº, fornecedor, valor, previsão.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const empresa = url.searchParams.get("empresa") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim();
  const codigoProjeto = Number(url.searchParams.get("codigo_projeto") ?? 0);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20) || 20, 100);
  if (!empresa) return NextResponse.json({ error: "empresa obrigatório" }, { status: 400 });

  // v_pc_projetos: PCs de projetos "PJ*". Se codigo_projeto vier, filtra pra só
  // trazer PCs do mesmo projeto (evita puxar PCs de estoque/contratos/outros).
  // Se codigo_projeto=0 → cai em v_pc_pcs (busca livre, útil pra debug).
  const approval = supa.schema("approval" as never);
  const table = codigoProjeto > 0 ? "v_pc_projetos" : "v_pc_pcs";
  let query = approval
    .from(table)
    .select("pc_numero, valor_total, nome_fornecedor, dt_previsao, dt_inclusao, projeto_nome")
    .eq("empresa", empresa)
    .not("pc_numero", "is", null)
    .order("dt_inclusao", { ascending: false })
    .limit(limit);

  if (codigoProjeto > 0) {
    query = query.eq("codigo_projeto", codigoProjeto);
  }

  if (q) {
    // Busca por PC# exato, fornecedor (ilike) ou projeto (ilike)
    if (/^\d+$/.test(q)) {
      query = query.eq("pc_numero", q);
    } else {
      query = query.or(`nome_fornecedor.ilike.%${q}%,projeto_nome.ilike.%${q}%`);
    }
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Dedup por pc_numero (view pode ter 1 row/item)
  const seen = new Set<string>();
  type Row = { pc_numero: string; valor_total: number | null; nome_fornecedor: string | null; dt_previsao: string | null; dt_inclusao: string | null; projeto_nome: string | null };
  const rows: Row[] = [];
  for (const r of ((data ?? []) as Row[])) {
    if (seen.has(r.pc_numero)) continue;
    seen.add(r.pc_numero);
    rows.push(r);
  }
  return NextResponse.json({ rows });
}
