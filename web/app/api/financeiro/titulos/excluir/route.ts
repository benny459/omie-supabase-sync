// POST /api/financeiro/titulos/excluir — exclui um título no OMIE (write-back)
// e remove do espelho local. Par do /incluir: mesmo contrato de credenciais
// por empresa e mesma regra de área.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) {
    return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  }

  let body: { tipo?: string; empresa?: string; codigo_lancamento_omie?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const tipo = body.tipo === "receber" ? "receber" : "pagar";
  const empresa = (body.empresa ?? "SF").toUpperCase();
  const codigo = Number(body.codigo_lancamento_omie ?? 0);
  if (!codigo) return NextResponse.json({ error: "codigo_lancamento_omie obrigatório" }, { status: 400 });

  const appKey = process.env[`OMIE_APP_KEY_${empresa}`];
  const appSecret = process.env[`OMIE_APP_SECRET_${empresa}`];
  if (!appKey || !appSecret) {
    return NextResponse.json({ error: `Credencial Omie da empresa ${empresa} não configurada` }, { status: 422 });
  }

  const endpoint = tipo === "pagar"
    ? "https://app.omie.com.br/api/v1/financas/contapagar/"
    : "https://app.omie.com.br/api/v1/financas/contareceber/";
  const call = tipo === "pagar" ? "ExcluirContaPagar" : "ExcluirContaReceber";

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key: appKey.trim(), app_secret: appSecret.trim(), param: [{ codigo_lancamento_omie: codigo }] }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j as { faultstring?: string }).faultstring) {
      return NextResponse.json({ error: `Omie recusou: ${(j as { faultstring?: string }).faultstring ?? `HTTP ${r.status}`}` }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: `Falha ao falar com o Omie: ${(e as Error).message}` }, { status: 502 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );
  await admin.from(tipo === "pagar" ? "contas_pagar" : "contas_receber")
    .delete().eq("empresa", empresa).eq("codigo_lancamento_omie", codigo);

  return NextResponse.json({ ok: true });
}
