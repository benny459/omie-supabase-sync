// Reports do Cesar incorporados ao controle de uma tela.
//
//   GET    /api/cesar/reports?tela=/bi/fluxo-caixa  → lista os da tela
//   POST   { tela, titulo, report }                 → grava (o caminho normal é a
//                                                     ferramenta salvar_report, que
//                                                     insere direto no servidor;
//                                                     este POST existe pra qualquer
//                                                     gravação vinda do painel)
//   DELETE ?id=<uuid>                               → exclui (só admin)
//
// A régua de acesso é a MESMA da tela: quem não enxerga /bi/fluxo-caixa não
// lista os reports de /bi/fluxo-caixa. A tela é a unidade de permissão aqui —
// o report é um anexo dela, não um dado à parte.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea, type Area } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { TELAS_REPORT } from "@/lib/cesar/ferramentas";

export const runtime = "nodejs";

// Mesmo requireArea das pages correspondentes. /bi/financeiro hoje não chama
// requireArea na page (provável esquecimento), mas aqui vale a régua da área
// financeiro — melhor a API mais restrita que a tela do que o contrário.
const AREA_DA_TELA: Record<string, Area> = {
  "/bi/fluxo-caixa": "financeiro",
  "/bi/contas-pagar": "financeiro",
  "/bi/contas-receber": "financeiro",
  "/bi/financeiro": "financeiro",
  "/relatorios/faturamento": "vendas",
};

// Escrita e exclusão passam pelo service_role: a RLS de cesar_reports só abre
// SELECT pra authenticated — inserir/apagar é decisão do servidor, nunca do
// navegador direto no Supabase.
const admPublico = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false }, db: { schema: "public" } },
);

async function checarTela(tela: string | null) {
  if (!tela || !TELAS_REPORT.includes(tela)) {
    return { erro: NextResponse.json({ error: "tela inválida" }, { status: 400 }) };
  }
  const perms = await loadPerms();
  if (!perms) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canViewArea(perms, AREA_DA_TELA[tela])) {
    return { erro: NextResponse.json({ error: "Sem acesso" }, { status: 403 }) };
  }
  return { perms };
}

export async function GET(req: Request) {
  const tela = new URL(req.url).searchParams.get("tela");
  const chk = await checarTela(tela);
  if ("erro" in chk) return chk.erro;

  // Leitura pelo cliente do usuário: a RLS (select p/ authenticated) é a
  // segunda tranca depois da checagem de área acima.
  const supa = await supaServer("public");
  const { data, error } = await supa
    .from("cesar_reports")
    .select("id, tela, titulo, payload, criado_por, created_at")
    .eq("tela", tela!)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data ?? [] });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const tela = typeof body.tela === "string" ? body.tela : null;
  const chk = await checarTela(tela);
  if ("erro" in chk) return chk.erro;

  const titulo = typeof body.titulo === "string" ? body.titulo.trim().slice(0, 140) : "";
  const report = body.report;
  if (!titulo || !report || typeof report !== "object") {
    return NextResponse.json({ error: "faltou o título ou o conteúdo do report" }, { status: 400 });
  }

  const supa = await supaServer("public");
  const { data: { user } } = await supa.auth.getUser();
  const { data, error } = await admPublico()
    .from("cesar_reports")
    .insert({ tela, titulo, payload: report, criado_por: user?.email ?? "" })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Excluir é destrutivo e o report é compartilhado por todo mundo que vê a
  // tela — por isso só admin, não o autor.
  if (!perms.is_admin) return NextResponse.json({ error: "Só admin exclui reports" }, { status: 403 });

  const { error } = await admPublico().from("cesar_reports").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
