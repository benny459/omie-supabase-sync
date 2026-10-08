// Prazo de entrega ajustado POR ITEM na lista de materiais (08/10/26 — sql/141).
//   GET ?empresa=SF → { pode, ativo }  pode = quem tem acesso a Compras (o mesmo do ⏱ Prazos por
//        fornecedor); ativo = a migração sql/141 já está no banco (sem ela a célula só mostra).
//   PUT { empresa, codigo_projeto, id, prazo_dias | null } → grava o prazo do item (null = volta
//        ao automático) com quem e quando. Devolve { prazo_dias_manual, prazo_por, prazo_em }.

import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirCompras } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const falta = (e: { code?: string; message: string } | null) => !!e && /does not exist|schema cache|PGRST204|42703/i.test(`${e.code} ${e.message}`);

async function migracaoAplicada() {
  const { error } = await supaAdmin().schema("approval").from("rc_projetos_itens").select("prazo_dias_manual").limit(1);
  return !error;
}

export async function GET() {
  const q = await exigirCompras();
  const pode = !(q instanceof NextResponse);
  return NextResponse.json({ pode, ativo: await migracaoAplicada() });
}

export async function PUT(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; codigo_projeto?: number; id?: string; prazo_dias?: number | string | null };
  const empresa = String(b.empresa ?? "").toUpperCase().slice(0, 4);
  const codigo = Number(b.codigo_projeto);
  const id = String(b.id ?? "");
  if (!empresa || !Number.isFinite(codigo) || !UUID.test(id)) return NextResponse.json({ error: "empresa, codigo_projeto e id obrigatórios" }, { status: 400 });
  const bruto = b.prazo_dias;
  const prazo = bruto == null || String(bruto).trim() === "" ? null : Math.round(Number(bruto));
  if (prazo != null && !(prazo >= 0 && prazo <= 365)) return NextResponse.json({ error: "prazo entre 0 e 365 dias" }, { status: 400 });
  const patch = prazo == null
    ? { prazo_dias_manual: null, prazo_por: null, prazo_em: null }
    : { prazo_dias_manual: prazo, prazo_por: q.nome || q.email, prazo_em: new Date().toISOString() };
  const { data, error } = await supaAdmin().schema("approval").from("rc_projetos_itens")
    .update(patch).eq("id", id).eq("empresa", empresa).eq("codigo_projeto", codigo)
    .select("id, prazo_dias_manual, prazo_por, prazo_em");
  if (error) {
    if (falta(error)) return NextResponse.json({ error: "Prazo por item ainda não ativado (migração sql/141 pendente)" }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data?.length) return NextResponse.json({ error: "linha não encontrada neste projeto — salve a lista e tente de novo" }, { status: 404 });
  return NextResponse.json({ ok: true, ...(data[0] as object) });
}
