// GET /api/relatorios/faturamento?from=YYYY-MM-DD&to=YYYY-MM-DD
// Lê approval.v_faturamento_diario (OS+PV faturados, classificados por
// codigo_categoria Omie — mesma taxonomia usada pelo Metabase).

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

export type Categoria =
  | "Contratuais"  // 1.01.01 — MRR contratual
  | "Projetos"     // 1.01.02 — faturamento de projeto (PJxxx)
  | "Revenda"      // 1.01.03 — revenda de mercadoria (PVs)
  | "Avulsos"      // 1.01.97 — OS avulsa (40_VS/41_VP)
  | "BOT/SW"       // 1.01.98 — recorrente BOT/SW
  | "Outras";      // fallback
export type Tipo = "PV" | "OS";

export type FatRow = {
  date: string;
  tipo: Tipo;
  categoria: Categoria;
  empresa: string;
  qtd: number;
  valor: number;
};

export type FatResp = {
  from: string;
  to: string;
  rows: FatRow[];
  totals: { qtd: number; valor: number };
  by_tipo: Record<Tipo, { qtd: number; valor: number }>;
  by_categoria: Record<Categoria, { qtd: number; valor: number }>;
};

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to   = url.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: "from/to devem ser YYYY-MM-DD" }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "approval" } },
  );

  // Paginação segura contra o cap de 1000 do PostgREST.
  const PAGE = 1000;
  const rows: FatRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin
      .from("v_faturamento_diario")
      .select("data_fat, tipo, categoria, empresa, qtd, valor")
      .gte("data_fat", from)
      .lte("data_fat", to)
      .order("data_fat", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as Array<{ data_fat: string; tipo: string; categoria: string; empresa: string; qtd: number; valor: string | number }>;
    for (const r of batch) {
      rows.push({
        date: r.data_fat,
        tipo: r.tipo as Tipo,
        categoria: r.categoria as Categoria,
        empresa: r.empresa,
        qtd: Number(r.qtd),
        valor: Number(r.valor),
      });
    }
    if (batch.length < PAGE) break;
    if (offset > 20_000) break;
  }

  const totals = { qtd: 0, valor: 0 };
  const by_tipo: Record<Tipo, { qtd: number; valor: number }> = {
    PV: { qtd: 0, valor: 0 }, OS: { qtd: 0, valor: 0 },
  };
  const by_categoria: Record<Categoria, { qtd: number; valor: number }> = {
    Contratuais: { qtd: 0, valor: 0 },
    Projetos:    { qtd: 0, valor: 0 },
    Revenda:     { qtd: 0, valor: 0 },
    Avulsos:     { qtd: 0, valor: 0 },
    "BOT/SW":    { qtd: 0, valor: 0 },
    Outras:      { qtd: 0, valor: 0 },
  };
  for (const r of rows) {
    totals.qtd += r.qtd;
    totals.valor += r.valor;
    by_tipo[r.tipo].qtd += r.qtd;
    by_tipo[r.tipo].valor += r.valor;
    const bucket = by_categoria[r.categoria] ?? by_categoria.Outras;
    bucket.qtd += r.qtd;
    bucket.valor += r.valor;
  }

  const resp: FatResp = { from, to, rows, totals, by_tipo, by_categoria };
  return NextResponse.json(resp);
}
