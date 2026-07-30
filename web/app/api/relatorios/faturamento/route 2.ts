// GET /api/relatorios/faturamento?from=YYYY-MM-DD&to=YYYY-MM-DD
// Lê approval.v_faturamento_diario (OS+PV faturados, classificados por
// codigo_categoria Omie — mesma taxonomia usada pelo Metabase).

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

// 4 grupos consolidados (taxonomia real da base):
// - Contrato: Contratuais (só OS)
// - BOT: BOT/SW (só OS)
// - Projeto: Projetos (PV Mercantil + OS Serviço)
// - Avulso: Avulsos + Revenda + Outras (PV Mercantil + OS Serviço)
export type Grupo = "Contrato" | "BOT" | "Projeto" | "Avulso";
export type Tipo = "PV" | "OS";

const CAT_TO_GRUPO: Record<string, Grupo> = {
  "Contratuais": "Contrato",
  "BOT/SW":      "BOT",
  "Projetos":    "Projeto",
  "Avulsos":     "Avulso",
  "Revenda":     "Avulso",
  "Outras":      "Avulso",
};
const GRUPO_OF = (cat: string): Grupo => CAT_TO_GRUPO[cat] ?? "Avulso";

export type FatRow = {
  date: string;
  tipo: Tipo;
  grupo: Grupo;
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
  by_grupo: Record<Grupo, { qtd: number; valor: number }>;
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
        grupo: GRUPO_OF(r.categoria),
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
  const by_grupo: Record<Grupo, { qtd: number; valor: number }> = {
    Contrato: { qtd: 0, valor: 0 },
    BOT:      { qtd: 0, valor: 0 },
    Projeto:  { qtd: 0, valor: 0 },
    Avulso:   { qtd: 0, valor: 0 },
  };
  for (const r of rows) {
    totals.qtd += r.qtd;
    totals.valor += r.valor;
    by_tipo[r.tipo].qtd += r.qtd;
    by_tipo[r.tipo].valor += r.valor;
    by_grupo[r.grupo].qtd += r.qtd;
    by_grupo[r.grupo].valor += r.valor;
  }

  const resp: FatResp = { from, to, rows, totals, by_tipo, by_grupo };
  return NextResponse.json(resp);
}
