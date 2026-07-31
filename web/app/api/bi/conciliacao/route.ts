// GET /api/bi/conciliacao?from=&to=&empresas=SF&cat=Projetos,Avulsos
//
// Porte dos 4 cards de conciliação do Metabase (63, 88, 108, 167): a pergunta
// "toda NF que faturei virou título no contas a receber, pelo mesmo valor?".
//
// Os quatro se sustentam: o resumo diz o tamanho de cada bucket, a lista "sem
// título" abre o pior deles, o detalhe mostra os dois lados linha a linha e as
// anomalias isolam o que atravessa a virada do mês. Por isso vêm juntos numa
// requisição só — abrir a tela e ter que escolher qual carregar não ajuda
// ninguém a fechar o mês.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  // Cruza faturamento com contas a receber — é financeiro, não só BI.
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso a conciliação" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const empRaw = (url.searchParams.get("empresas") ?? "").trim();
  const catRaw = (url.searchParams.get("cat") ?? "").trim();
  const empresas = empRaw ? empRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const cat      = catRaw ? catRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const base = { p_from: from, p_to: to, p_empresas: empresas, p_cat_venda: cat };

  const [resumo, semTitulo, detalhe, anomalias] = await Promise.all([
    adm.rpc("concil_resumo", base),
    adm.rpc("concil_sem_titulo", { ...base, p_limit: 500 }),
    adm.rpc("concil_detalhe",   { ...base, p_limit: 800 }),
    adm.rpc("concil_anomalias", { ...base, p_limit: 500 }),
  ]);

  for (const [nome, r] of [
    ["concil_resumo", resumo], ["concil_sem_titulo", semTitulo],
    ["concil_detalhe", detalhe], ["concil_anomalias", anomalias],
  ] as const) {
    if (r.error) return NextResponse.json({ error: `${nome}: ${r.error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    resumo:      resumo.data ?? [],
    sem_titulo:  semTitulo.data ?? [],
    detalhe:     detalhe.data ?? [],
    anomalias:   anomalias.data ?? [],
  });
}
