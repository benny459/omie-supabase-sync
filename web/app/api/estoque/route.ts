// GET /api/estoque?view=posicao            → posição atual (todas as linhas)
// GET /api/estoque?view=movimentos&de=&ate=[&produto=ID] → movimentação
// Lê estoque.posicao / estoque.movimentos (sync do Omie via import_estoque.py).
// Área "compras" — estoque é operação de compras, não dado financeiro consolidado.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const PAGE = 1000;
const MAX_ROWS = 30_000;

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "compras")) {
    return NextResponse.json({ error: "Sem acesso à área compras" }, { status: 403 });
  }

  const url = new URL(req.url);
  const view = url.searchParams.get("view") === "movimentos" ? "movimentos" : "posicao";

  // PostgREST do projeto não expõe schema próprio "estoque" (config de
  // dashboard) — tabelas vivem em orders.estoque_*.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "orders" } },
  );

  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    let q;
    if (view === "posicao") {
      q = admin.from("estoque_posicao").select("*")
        .order("descricao", { ascending: true })
        .order("n_cod_prod", { ascending: true });
    } else {
      const de = url.searchParams.get("de");
      const ate = url.searchParams.get("ate");
      const produto = url.searchParams.get("produto");
      q = admin.from("estoque_movimentos").select("*");
      if (produto) q = q.eq("id_prod", Number(produto));
      else {
        if (!de || !ate) return NextResponse.json({ error: "movimentos sem produto exige de e ate" }, { status: 400 });
        q = q.gte("dt_mov", de).lte("dt_mov", ate);
      }
      q = q.order("dt_mov", { ascending: false }).order("id_mov", { ascending: false });
    }
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: `${view}: ${error.message}` }, { status: 500 });
    const batch = (data ?? []) as Record<string, unknown>[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  return NextResponse.json({ rows, count: rows.length, truncated: rows.length >= MAX_ROWS });
}
