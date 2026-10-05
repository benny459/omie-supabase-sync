// POST /api/financeiro/titulos/excluir — par do /incluir.
//  · pagar   — desde 05/10/26 (sql/65) só a conta lançada à mão no painel
//              (finance.pagar_manual_excluir); nada vai ao Omie. Títulos do
//              Omie e previsões de PC não se excluem daqui.
//  · receber — desde 01/10/26 apaga só a linha NOSSA (finance.receber) criada
//              no painel e ainda sem título do Omie ligado. O que veio do Omie
//              ou já está ligado a ele não se apaga daqui: sumiria da tela e
//              voltaria no próximo ciclo da conciliação.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { permissoesDe } from "@/lib/acessos";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) {
    return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  }
  if (!(await permissoesDe(perms))["financeiro.editar_titulo"]) {
    return NextResponse.json({ error: "Sem permissão para excluir títulos" }, { status: 403 });
  }

  let body: { tipo?: string; empresa?: string; codigo_lancamento_omie?: number; id?: string; pagar_id?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const tipo = body.tipo === "receber" ? "receber" : "pagar";
  if (tipo === "receber") return excluirReceber(body.id);
  const pagarId = Number(body.pagar_id ?? 0);
  if (!pagarId) {
    return NextResponse.json({
      error: "Só contas lançadas no painel se excluem daqui. Títulos antigos do Omie não são mais alterados no Omie pelo painel.",
    }, { status: 409 });
  }
  const { data: { user } } = await (await supaServer()).auth.getUser();
  const { error } = await supaAdmin().schema("finance").rpc("pagar_manual_excluir", { p_id: pagarId, p_usuario: user?.email ?? "?" });
  if (error) return NextResponse.json({ error: (error.message ?? "Erro").replace(/^.*?ERROR:\s*/, "") }, { status: 422 });
  return NextResponse.json({ ok: true });
}

async function excluirReceber(id: string | undefined) {
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );
  const { data: row, error } = await admin.from("receber")
    .select("id, origem, omie_codigo_lancamento").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  if (row.origem !== "painel" || row.omie_codigo_lancamento) {
    return NextResponse.json({
      error: "Esta conta está ligada a um título do Omie — exclua-a no Omie (ou cancele o faturamento) para ela sair daqui.",
    }, { status: 409 });
  }
  const { error: delErr } = await admin.from("receber").delete().eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
