// GET /api/bi/financeiro/detalhe?from=&to=&categoria=&bucket=
//
// A lista por trás de um número da coorte por tipo de venda.
//
// Rota separada da /api/bi/financeiro de propósito: aquela carrega uma vez e
// serve a tela inteira, esta só é chamada quando alguém clica num número. Juntar
// as duas faria toda abertura da aba pagar por um detalhe que talvez ninguém
// peça — e são 5 tipos × 5 parcelas × N meses de combinações possíveis.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";
import { rpcPaginado } from "@/lib/supabase-paginado";

export const runtime = "nodejs";
export const maxDuration = 60;

/** O mesmo recorte do agregado. Divergir aqui produziria um detalhe que não
 *  soma o número clicado, que é o único jeito de esta tela mentir. */
const EMP_RECEBER = ["SF"];

const BUCKETS = new Set(["faturado", "recebido", "a_vencer", "vencido", "sem_titulo"]);

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const url = new URL(req.url);
  const ano  = new Date().getFullYear();
  const from = url.searchParams.get("from") || `${ano}-01-01`;
  const to   = url.searchParams.get("to")   || `${ano}-12-31`;
  const cat  = url.searchParams.get("categoria");        // null = todos os tipos
  const bucket = url.searchParams.get("bucket") || "faturado";

  if (!BUCKETS.has(bucket)) {
    return NextResponse.json({ error: `bucket inválido: ${bucket}` }, { status: 400 });
  }

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  // Paginado: o PostgREST corta em 1000 linhas em silêncio, e "faturado" sem
  // filtro de tipo passa disso num ano cheio. Um detalhe truncado sem aviso
  // somaria menos que o número clicado — exatamente o defeito que a função foi
  // escrita pra não ter.
  const { data, error } = await rpcPaginado(adm, "fat_coorte_detalhe", {
    p_from: from, p_to: to, p_categoria: cat, p_bucket: bucket,
    p_empresas: EMP_RECEBER,
  });
  if (error) {
    return NextResponse.json({ error: `fat_coorte_detalhe: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    periodo: { from, to }, categoria: cat, bucket, linhas: data ?? [],
  });
}
