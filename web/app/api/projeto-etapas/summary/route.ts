// GET /api/projeto-etapas/summary — resumo de cronograma pra vários projetos.
// Body via query: ?keys=SF|9829491988,SF|1234... — máximo ~200 keys.
// Retorna: [{ key, total, concluidas, atrasadas, proxima_data, proxima_nome }]
//   • concluidas = count(data_conclusao is not null)
//   • atrasadas  = count(data_prevista < today AND data_conclusao is null)
//   • proxima_*  = etapa não concluída com menor data_prevista

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const raw = url.searchParams.get("keys") ?? "";
  const keys = raw.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 300);
  if (keys.length === 0) return NextResponse.json({ rows: [] });

  const empresas = new Set<string>();
  const codigos  = new Set<number>();
  for (const k of keys) {
    const [emp, cod] = k.split("|");
    if (!emp || !cod) continue;
    empresas.add(emp);
    const n = Number(cod);
    if (Number.isFinite(n)) codigos.add(n);
  }
  if (codigos.size === 0) return NextResponse.json({ rows: [] });

  const { data, error } = await supa
    .schema("approval" as never)
    .from("projeto_etapas")
    .select("empresa, codigo_projeto, etapa, data_prevista, data_conclusao")
    .in("empresa", Array.from(empresas))
    .in("codigo_projeto", Array.from(codigos));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  type Row = { empresa: string; codigo_projeto: number; etapa: string; data_prevista: string | null; data_conclusao: string | null };
  type Agg = { total: number; concluidas: number; atrasadas: number; proxima_ms: number | null; proxima_data: string | null; proxima_nome: string | null };
  const agg = new Map<string, Agg>();
  for (const r of (data ?? []) as Row[]) {
    const key = `${r.empresa}|${r.codigo_projeto}`;
    // Filtra: só considera se a combinação foi pedida (evita cross-empresa)
    if (!keys.includes(key)) continue;
    let a = agg.get(key);
    if (!a) { a = { total: 0, concluidas: 0, atrasadas: 0, proxima_ms: null, proxima_data: null, proxima_nome: null }; agg.set(key, a); }
    a.total++;
    if (r.data_conclusao) a.concluidas++;
    else {
      // Não concluída → checa atraso e próxima
      if (r.data_prevista) {
        const [y, m, d] = r.data_prevista.split("-").map(Number);
        const dt = new Date(y, m - 1, d).getTime();
        if (dt < todayMs) a.atrasadas++;
        if (a.proxima_ms == null || dt < a.proxima_ms) {
          a.proxima_ms = dt;
          a.proxima_data = r.data_prevista;
          a.proxima_nome = r.etapa;
        }
      }
    }
  }

  const rows = Array.from(agg.entries()).map(([key, a]) => ({
    key,
    total: a.total,
    concluidas: a.concluidas,
    atrasadas: a.atrasadas,
    proxima_data: a.proxima_data,
    proxima_nome: a.proxima_nome,
  }));
  return NextResponse.json({ rows });
}
