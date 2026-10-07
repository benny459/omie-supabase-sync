// /api/rc-projetos/comentarios (07/10/26, sql/101) — o balão 💬 das linhas da lista de materiais.
//   GET  ?empresa=SF&codigo_projeto=…  → { comentarios: { [item_id]: [{ id, autor, texto, criado_em, origem }] }, pendente? }
//   POST { empresa, codigo_projeto, item_id, texto } → { comentario }
// pendente = a tabela ainda não existe (migração sql/101 não aplicada): a tela mostra só
// a observação da linha e não deixa comentar.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const approval = () => supaAdmin().schema("approval");
const faltaTabela = (e: { code?: string; message?: string }) => /does not exist|schema cache|PGRST205|42P01/i.test(`${e.code} ${e.message}`);

async function usuario() {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  return user;
}

export async function GET(req: Request) {
  if (!(await usuario())) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const empresa = (sp.get("empresa") ?? "SF").toUpperCase();
  const codigo = Number(sp.get("codigo_projeto"));
  if (!codigo) return NextResponse.json({ error: "codigo_projeto obrigatório" }, { status: 400 });
  const itens = await approval().from("rc_projetos_itens").select("id").eq("empresa", empresa).eq("codigo_projeto", codigo);
  if (itens.error) return NextResponse.json({ error: itens.error.message }, { status: 500 });
  const ids = ((itens.data ?? []) as { id: string }[]).map((i) => i.id);
  if (!ids.length) return NextResponse.json({ comentarios: {} });
  const { data, error } = await approval().from("rc_projetos_itens_comentarios")
    .select("id, item_id, autor, texto, criado_em, origem").in("item_id", ids).order("criado_em");
  if (error) {
    if (faltaTabela(error)) return NextResponse.json({ comentarios: {}, pendente: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const out: Record<string, unknown[]> = {};
  for (const c of (data ?? []) as { item_id: string }[]) (out[c.item_id] ??= []).push(c);
  return NextResponse.json({ comentarios: out });
}

export async function POST(req: Request) {
  const user = await usuario();
  if (!user) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; codigo_projeto?: number; item_id?: string; texto?: string };
  const texto = String(b.texto ?? "").trim().slice(0, 2000);
  if (!texto) return NextResponse.json({ error: "Escreva o comentário" }, { status: 400 });
  // a linha tem de ser deste projeto
  const it = await approval().from("rc_projetos_itens").select("id").eq("id", String(b.item_id ?? ""))
    .eq("empresa", String(b.empresa ?? "SF").toUpperCase()).eq("codigo_projeto", Number(b.codigo_projeto)).maybeSingle();
  if (it.error || !it.data) return NextResponse.json({ error: "Linha não encontrada neste projeto — salve a lista antes de comentar" }, { status: 400 });
  const { data, error } = await approval().from("rc_projetos_itens_comentarios")
    .insert({ item_id: String(b.item_id), autor: user.email ?? user.id, texto }).select("id, item_id, autor, texto, criado_em, origem").single();
  if (error) {
    if (faltaTabela(error)) return NextResponse.json({ error: "Comentários ainda não ativados (migração sql/101 pendente)" }, { status: 503 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ comentario: data });
}
