// GET  /api/rc-projetos/lixeira?empresa=SF&codigo_projeto=123
//   O que foi removido da lista de materiais deste projeto, por remoção.
// POST /api/rc-projetos/lixeira   { empresa, codigo_projeto, apagado_em }
//   Devolve à lista tudo que saiu naquela remoção.
//
// ── Por que existe ─────────────────────────────────────────────────────────
// O upload de materiais faz sync destrutivo: item que não vem na planilha nova
// é apagado. É a regra certa — a planilha define o que existe. O erro era ser
// irreversível: em 31/07/2026 o PJ358_Brasterapica perdeu equipamentos
// inteiros porque alguém subiu um arquivo só com a aba "Eletrica", e 48 dias
// depois já não havia de onde recuperar.
//
// ── Restaurar não sobrescreve ──────────────────────────────────────────────
// Só volta o item que NÃO existe hoje. Se alguém já redigitou o mesmo item, o
// que está na tela vale — restaurar é desfazer uma perda, não reverter o
// trabalho de quem veio depois.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { canEdit } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";

export const runtime = "nodejs";
export const maxDuration = 60;

type LinhaLixeira = {
  id: string; item_id: string | null;
  equipamento: string | null; item: string | null; item_norm: string | null;
  qtd: number | null; modelo: string | null; observacao: string | null;
  pc_numero: string | null; criado_em: string | null; criado_por: string | null;
  apagado_em: string; apagado_por: string | null; apagado_por_upload: string | null;
};

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const u = new URL(req.url);
  const empresa = u.searchParams.get("empresa");
  const codigo = Number(u.searchParams.get("codigo_projeto"));
  if (!empresa || !Number.isFinite(codigo)) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }

  const { data, error } = await supaAdmin().schema("approval")
    .from("rc_projetos_itens_lixeira")
    .select("*")
    .eq("empresa", empresa).eq("codigo_projeto", codigo)
    .order("apagado_em", { ascending: false })
    .limit(5000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Agrupa por REMOÇÃO, não por item. Quem vai restaurar pensa "desfaz o
  // upload de terça", não "devolve o disjuntor" — e um upload que apagou 412
  // itens seria uma lista de 412 linhas para decidir uma coisa só.
  const porRemocao = new Map<string, {
    apagado_em: string; apagado_por: string | null; contexto: string | null;
    itens: number; equipamentos: string[];
  }>();
  for (const l of (data ?? []) as LinhaLixeira[]) {
    const k = l.apagado_em;
    const g = porRemocao.get(k) ?? {
      apagado_em: k, apagado_por: l.apagado_por, contexto: l.apagado_por_upload,
      itens: 0, equipamentos: [],
    };
    g.itens += 1;
    if (l.equipamento && !g.equipamentos.includes(l.equipamento)) g.equipamentos.push(l.equipamento);
    porRemocao.set(k, g);
  }

  return NextResponse.json({
    remocoes: Array.from(porRemocao.values()),
    total: (data ?? []).length,
  });
}

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await loadPerms();
  if (!canEdit(perms, "projetos", "pvos")) {
    return NextResponse.json({ error: "Sem permissão no projeto" }, { status: 403 });
  }

  const b = (await req.json().catch(() => null)) as
    { empresa?: string; codigo_projeto?: number; apagado_em?: string } | null;
  if (!b?.empresa || !Number.isFinite(Number(b.codigo_projeto)) || !b.apagado_em) {
    return NextResponse.json(
      { error: "empresa, codigo_projeto e apagado_em obrigatórios" }, { status: 400 });
  }
  const empresa = String(b.empresa);
  const codigo = Number(b.codigo_projeto);
  const admin = supaAdmin().schema("approval");

  const { data: arquivados, error: e1 } = await admin
    .from("rc_projetos_itens_lixeira")
    .select("*")
    .eq("empresa", empresa).eq("codigo_projeto", codigo)
    .eq("apagado_em", b.apagado_em);
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!arquivados?.length) {
    return NextResponse.json({ error: "Nada arquivado nessa remoção" }, { status: 404 });
  }

  // O que já existe hoje fica como está: restaurar desfaz uma perda, não
  // reverte o trabalho de quem veio depois.
  const { data: atuais } = await admin
    .from("rc_projetos_itens")
    .select("equipamento, item_norm")
    .eq("empresa", empresa).eq("codigo_projeto", codigo);
  const existe = new Set(
    (atuais ?? []).map((r) => `${r.equipamento}\x01${r.item_norm}`));

  const voltar = (arquivados as LinhaLixeira[])
    .filter((l) => !existe.has(`${l.equipamento}\x01${l.item_norm}`));
  const jaExistiam = arquivados.length - voltar.length;

  if (!voltar.length) {
    return NextResponse.json({
      ok: true, restaurados: 0, ja_existiam: jaExistiam,
      aviso: "Todos os itens dessa remoção já estão na lista — nada a restaurar.",
    });
  }

  const quem = user.email ?? user.id;
  const { error: e2 } = await admin.from("rc_projetos_itens").insert(
    voltar.map((l) => ({
      empresa, codigo_projeto: codigo,
      equipamento: l.equipamento, item: l.item,
      qtd: l.qtd, modelo: l.modelo, observacao: l.observacao,
      pc_numero: l.pc_numero,
      // Preserva quem criou originalmente — a autoria é do Marcelo, não de
      // quem apertou "restaurar".
      criado_por: l.criado_por ?? quem,
      atualizado_por: quem,
    })));
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  // Sai da lixeira só o que voltou. O que não voltou continua arquivado —
  // ainda é a única cópia daquele item.
  const { error: e3 } = await admin.from("rc_projetos_itens_lixeira")
    .delete().in("id", voltar.map((l) => l.id));
  if (e3) {
    return NextResponse.json({
      ok: true, restaurados: voltar.length, ja_existiam: jaExistiam,
      aviso: `Itens restaurados, mas não consegui limpar a lixeira: ${e3.message}`,
    });
  }

  return NextResponse.json({
    ok: true, restaurados: voltar.length, ja_existiam: jaExistiam,
  });
}
