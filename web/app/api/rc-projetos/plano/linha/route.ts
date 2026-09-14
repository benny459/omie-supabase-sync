// PUT    /api/rc-projetos/plano/linha   edita UMA parcela ou UMA saída do plano
// POST   /api/rc-projetos/plano/linha   acrescenta uma saída à mão
// DELETE /api/rc-projetos/plano/linha?...&tipo=saida&id=1   remove uma saída
//
// ── O que se edita e o que não ─────────────────────────────────────────────
// Na PARCELA só a previsão ajustada, o título e a observação. Evento, % e valor
// vieram do fechamento e mudá-los na tela faria o baseline deixar de ser o que
// foi acordado — para isso existe reimportar a revisão nova.
//
// Na SAÍDA edita-se tudo, porque a saída sem pedido de compra é estimativa: a
// mão de obra é orçada antes de existir escala, e a despesa antes da passagem
// ser comprada. É o número que mais muda entre o fechamento e a obra.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { canEdit } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";

export const runtime = "nodejs";

const ehData = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dt = (v: unknown) => (v === "" || v == null ? null : ehData(v) ? (v as string) : undefined);
const s = (v: unknown, max = 300) => (v == null ? null : String(v).slice(0, max));
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

async function autorizar() {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const perms = await loadPerms();
  if (!canEdit(perms, "projetos", "pvos")) {
    return { erro: NextResponse.json({ error: "Sem permissão no projeto" }, { status: 403 }) };
  }
  return { quem: user.email ?? user.id };
}

export async function PUT(req: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b?.empresa || !Number.isFinite(Number(b.codigo_projeto))) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }
  const empresa = String(b.empresa);
  const codigo = Number(b.codigo_projeto);
  const agora = new Date().toISOString();
  const admin = supaAdmin().schema("approval");

  if (b.tipo === "parcela") {
    const parcela = Number(b.parcela);
    if (!Number.isFinite(parcela)) {
      return NextResponse.json({ error: "parcela inválida" }, { status: 400 });
    }
    const campos: Record<string, unknown> = {
      atualizado_em: agora, atualizado_por: auth.quem,
    };
    if ("dt_ajustada" in b) {
      const v = dt(b.dt_ajustada);
      if (v === undefined) return NextResponse.json({ error: "dt_ajustada inválida" }, { status: 400 });
      campos.dt_ajustada = v;
    }
    if ("num_titulo" in b) campos.num_titulo = s(b.num_titulo, 60);
    if ("observacao" in b) campos.observacao = s(b.observacao, 500);

    const { error } = await admin.from("projeto_plano_parcela").update(campos)
      .eq("empresa", empresa).eq("codigo_projeto", codigo).eq("parcela", parcela);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (b.tipo === "saida") {
    const id = Number(b.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
    const campos: Record<string, unknown> = { atualizado_em: agora, atualizado_por: auth.quem };
    if ("descricao" in b)  campos.descricao = s(b.descricao);
    if ("fornecedor" in b) campos.fornecedor = s(b.fornecedor, 200);
    if ("etapa" in b)      campos.etapa = s(b.etapa, 120);
    if ("valor" in b)      campos.valor = n(b.valor) ?? 0;
    if ("no_fluxo" in b)   campos.no_fluxo = b.no_fluxo !== false;
    if ("dt_prevista" in b) {
      const v = dt(b.dt_prevista);
      if (v === undefined) return NextResponse.json({ error: "dt_prevista inválida" }, { status: 400 });
      campos.dt_prevista = v;
    }
    if ("dias_apos_base" in b) campos.dias_apos_base = n(b.dias_apos_base);

    const { error } = await admin.from("projeto_plano_saida").update(campos)
      .eq("empresa", empresa).eq("codigo_projeto", codigo).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "tipo deve ser 'parcela' ou 'saida'" }, { status: 400 });
}

export async function POST(req: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b?.empresa || !Number.isFinite(Number(b.codigo_projeto))) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }
  const v = dt(b.dt_prevista);
  if (v === undefined) return NextResponse.json({ error: "dt_prevista inválida" }, { status: 400 });

  const { data, error } = await supaAdmin().schema("approval").from("projeto_plano_saida")
    .insert({
      empresa: String(b.empresa), codigo_projeto: Number(b.codigo_projeto),
      // Linha criada na tela é sempre 'sem_pc': a agenda de materiais vem da
      // planilha, e uma compra digitada aqui viraria pedido de compra depois —
      // aí apareceria duas vezes no fluxo.
      origem: "sem_pc",
      descricao: s(b.descricao) ?? "(sem descrição)",
      fornecedor: s(b.fornecedor, 200), etapa: s(b.etapa, 120),
      dias_apos_base: n(b.dias_apos_base), dt_prevista: v,
      valor: n(b.valor) ?? 0, no_fluxo: b.no_fluxo !== false,
      atualizado_em: new Date().toISOString(), atualizado_por: auth.quem,
    })
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id });
}

export async function DELETE(req: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;

  const u = new URL(req.url);
  const empresa = u.searchParams.get("empresa");
  const codigo = Number(u.searchParams.get("codigo_projeto"));
  const id = Number(u.searchParams.get("id"));
  if (!empresa || !Number.isFinite(codigo) || !Number.isFinite(id)) {
    return NextResponse.json({ error: "empresa, codigo_projeto e id obrigatórios" }, { status: 400 });
  }
  const { error } = await supaAdmin().schema("approval").from("projeto_plano_saida")
    .delete().eq("empresa", empresa).eq("codigo_projeto", codigo).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
