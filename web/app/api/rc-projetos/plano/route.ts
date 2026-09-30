// GET    /api/rc-projetos/plano?empresa=SF&codigo_projeto=123   lê o plano
// POST   /api/rc-projetos/plano                                  importa (substitui)
// PUT    /api/rc-projetos/plano                                  edita o cabeçalho
// DELETE /api/rc-projetos/plano?empresa=..&codigo_projeto=..     apaga o plano
//
// O plano de fechamento é a FOTO do que foi combinado: parcelas, condições e
// custos previstos, vindos da planilha CP-MC. É contra ele que o previsto (o
// que o Omie sabe hoje) e o realizado medem desvio.
//
// ── Por que o POST substitui em vez de mesclar ─────────────────────────────
// Reimportar é o gesto de "a proposta foi revisada". Mesclar deixaria parcela
// de uma revisão convivendo com parcela de outra, e ninguém saberia qual plano
// está na tela. A revisão importada fica gravada em `importado_de`.
//
// As datas AJUSTADAS sobrevivem à reimportação, e é de propósito: elas são
// cronograma de obra, não proposta. Perder o ajuste do Marcelo porque o
// comercial mexeu no preço seria apagar trabalho de outra pessoa.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { canEdit } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { importarPlano } from "@/lib/plano-importar";

export const runtime = "nodejs";
export const maxDuration = 60;

type Parcela = {
  parcela: number; evento?: string | null; pct?: number | null;
  dias?: number | null; dt_plano?: string | null; valor: number;
};
type Saida = {
  origem: "material" | "sem_pc"; descricao?: string | null;
  fornecedor?: string | null; etapa?: string | null;
  dias_apos_base?: number | null; dt_prevista?: string | null;
  valor: number; no_fluxo?: boolean;
};

const ehData = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dt = (v: unknown) => (ehData(v) ? (v as string) : null);
const s = (v: unknown, max = 400) => (v == null ? null : String(v).slice(0, max));
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Quem pode mexer no plano é quem pode mexer no projeto. */
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

function chave(u: URL) {
  const empresa = u.searchParams.get("empresa");
  const codigo = Number(u.searchParams.get("codigo_projeto"));
  if (!empresa || !Number.isFinite(codigo)) return null;
  return { empresa, codigo };
}

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const k = chave(new URL(req.url));
  if (!k) return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });

  const admin = supaAdmin().schema("approval");
  const [cab, parc, said, cust] = await Promise.all([
    admin.from("projeto_plano").select("*")
      .eq("empresa", k.empresa).eq("codigo_projeto", k.codigo).maybeSingle(),
    admin.from("projeto_plano_parcela").select("*")
      .eq("empresa", k.empresa).eq("codigo_projeto", k.codigo).order("parcela"),
    admin.from("projeto_plano_saida").select("*")
      .eq("empresa", k.empresa).eq("codigo_projeto", k.codigo).order("dt_prevista"),
    admin.from("projeto_plano_custo").select("*")
      .eq("empresa", k.empresa).eq("codigo_projeto", k.codigo).order("ordem"),
  ]);
  const err = cab.error ?? parc.error ?? said.error ?? cust.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  return NextResponse.json({
    plano: cab.data ?? null,
    parcelas: parc.data ?? [],
    saidas: said.data ?? [],
    custos: cust.data ?? [],
  });
}

export async function POST(req: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;

  const b = (await req.json().catch(() => null)) as
    (Record<string, unknown> & {
      empresa?: string; codigo_projeto?: number;
      parcelas?: Parcela[]; saidas?: Saida[];
    }) | null;
  if (!b?.empresa || !Number.isFinite(Number(b.codigo_projeto))) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }
  const empresa = String(b.empresa);
  const codigo = Number(b.codigo_projeto);
  const parcelas = Array.isArray(b.parcelas) ? b.parcelas : [];
  const saidas = Array.isArray(b.saidas) ? b.saidas : [];
  if (!parcelas.length && !saidas.length) {
    return NextResponse.json(
      { error: "A planilha não trouxe nem parcela nem saída — nada a importar." }, { status: 400 });
  }
  if (parcelas.length > 200 || saidas.length > 2000) {
    return NextResponse.json({ error: "Planilha grande demais para um plano" }, { status: 400 });
  }

  const { data, error } = await importarPlano(empresa, codigo, b, auth.quem!);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? { ok: true });
}

export async function PUT(req: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b?.empresa || !Number.isFinite(Number(b.codigo_projeto))) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }

  // Só os campos editáveis na tela. O que veio da planilha e não está aqui
  // (custos da MC, procedência) não se mexe à mão — mudou a proposta, reimporta.
  const campos: Record<string, unknown> = {};
  for (const k of ["frete", "deslocamento", "instalacao", "impostos", "garantia",
                   "forma_pagamento", "faturamento", "observacoes", "cliente", "proposta"]) {
    if (k in b) campos[k] = s(b[k], k === "observacoes" ? 2000 : 200);
  }
  for (const k of ["data_base", "entrega_prevista", "eixo_pagamento"]) {
    if (k in b) campos[k] = dt(b[k]);
  }
  for (const k of ["valor_venda", "valor_fechado", "prazo_entrega_dias"]) {
    if (k in b) campos[k] = n(b[k]);
  }
  if (!Object.keys(campos).length) {
    return NextResponse.json({ error: "nada para atualizar" }, { status: 400 });
  }
  campos.atualizado_em = new Date().toISOString();
  campos.atualizado_por = auth.quem;

  const { error } = await supaAdmin().schema("approval").from("projeto_plano")
    .update(campos)
    .eq("empresa", String(b.empresa)).eq("codigo_projeto", Number(b.codigo_projeto));
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;

  const k = chave(new URL(req.url));
  if (!k) return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });

  const admin = supaAdmin().schema("approval");
  for (const t of ["projeto_plano_parcela", "projeto_plano_saida", "projeto_plano"]) {
    const { error } = await admin.from(t).delete()
      .eq("empresa", k.empresa).eq("codigo_projeto", k.codigo);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
