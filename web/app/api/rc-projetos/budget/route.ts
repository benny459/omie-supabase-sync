// PUT /api/rc-projetos/budget — define/atualiza o budget do projeto.
// Body: { empresa, codigo_projeto, valor_budget, observacao? }        → teto do Fluxo (custo total)
//    ou { empresa, codigo_projeto, valor_budget_materiais: n | null } → budget de MATERIAIS (Lista;
//       null volta ao total de materiais da RC). Coluna da sql/107.
// DELETE /api/rc-projetos/budget?empresa=...&codigo_projeto=... — remove budget.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function PUT(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { empresa: string; codigo_projeto: number; valor_budget: number; observacao?: string; valor_budget_materiais?: number | null };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  /* Budget de MATERIAIS (07/10/26): só a coluna própria; não mexe no valor_budget
     (custo total, teto do Fluxo). Linha que ainda não existe nasce só com ele. */
  if (body && "valor_budget_materiais" in body) {
    if (!body.empresa || !body.codigo_projeto) return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
    const vm = body.valor_budget_materiais == null ? null : Number(body.valor_budget_materiais);
    if (vm != null && (!Number.isFinite(vm) || vm < 0)) return NextResponse.json({ error: "valor deve ser número >= 0" }, { status: 400 });
    const quem = user.email || user.id;
    const campos = { valor_budget_materiais: vm, budget_materiais_por: quem, budget_materiais_em: new Date().toISOString() };
    const tb = () => supa.schema("approval" as never).from("rc_projetos_budget");
    const up = await tb().update(campos as never).eq("empresa", body.empresa).eq("codigo_projeto", Number(body.codigo_projeto)).select("codigo_projeto");
    let err = up.error;
    if (!err && !(up.data ?? []).length) {
      ({ error: err } = await tb().insert({ empresa: body.empresa, codigo_projeto: Number(body.codigo_projeto), ...campos, criado_por: quem, atualizado_por: quem } as never));
    }
    if (err) {
      const falta = /valor_budget_materiais|budget_materiais_/.test(err.message);
      return NextResponse.json({ error: falta ? "O budget de materiais ainda não pode ser editado (falta aplicar a sql/107 no banco)." : err.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, valor_budget_materiais: vm });
  }

  if (!body.empresa || !body.codigo_projeto || body.valor_budget == null) {
    return NextResponse.json({ error: "empresa, codigo_projeto, valor_budget obrigatórios" }, { status: 400 });
  }
  const valor = Number(body.valor_budget);
  if (!Number.isFinite(valor) || valor < 0) {
    return NextResponse.json({ error: "valor_budget deve ser número >= 0" }, { status: 400 });
  }

  const userEmail = user.email || user.id;
  const { error, data } = await supa
    .schema("approval" as never)
    .from("rc_projetos_budget")
    .upsert({
      empresa: body.empresa,
      codigo_projeto: Number(body.codigo_projeto),
      valor_budget: valor,
      observacao: body.observacao ?? null,
      criado_por: userEmail,
      atualizado_por: userEmail,
    }, { onConflict: "empresa,codigo_projeto" })
    .select("empresa, codigo_projeto, valor_budget")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, row: data });
}

export async function DELETE(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const empresa = url.searchParams.get("empresa");
  const codigoProjeto = url.searchParams.get("codigo_projeto");
  if (!empresa || !codigoProjeto) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }

  const { error } = await supa
    .schema("approval" as never)
    .from("rc_projetos_budget")
    .delete()
    .eq("empresa", empresa)
    .eq("codigo_projeto", Number(codigoProjeto));

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
