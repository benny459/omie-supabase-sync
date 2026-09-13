// Reports do Cesar incorporados ao controle de uma tela.
//
//   GET    /api/cesar/reports?tela=/bi/fluxo-caixa  → lista os visíveis pra pessoa
//   POST   { tela, titulo, report, visibilidade }   → grava (botão Incorporar do
//                                                     drawer; a conversa usa a
//                                                     ferramenta salvar_report)
//   DELETE ?id=<uuid>                               → exclui (admin ou o dono)
//
// Régua de leitura (v3): quem não enxerga a ÁREA da tela não vê nada; dentro
// dela, o report aparece se visibilidade='todos', se a pessoa é a dona, ou se
// foi compartilhado com o e-mail dela (visibilidade='custom' + shared_emails).
// Quem decide a visibilidade é o servidor, pelo teto do usuário
// (cesar_report_user_config — exceção por e-mail; sem exceção, pode tudo).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea, type Area } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { TELAS_REPORT } from "@/lib/cesar/ferramentas";
import { modoReportDoUsuario, visivelPara, type ReportLinha } from "@/lib/cesar/report-config";
import { validarFontesDoReport } from "@/lib/cesar/report-fontes";

export const runtime = "nodejs";

const AREA_DA_TELA: Record<string, Area> = {
  "/bi/fluxo-caixa": "financeiro",
  "/bi/contas-pagar": "financeiro",
  "/bi/contas-receber": "financeiro",
  "/bi/financeiro": "financeiro",
  "/relatorios/faturamento": "vendas",
};

// Escrita/exclusão pelo service_role: a RLS de cesar_reports só abre SELECT
// pra authenticated — inserir/apagar é decisão do servidor.
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

  const supa = await supaServer("public");
  const { data: { user } } = await supa.auth.getUser();
  const email = (user?.email || "").toLowerCase();

  const { data, error } = await admPublico()
    .from("cesar_reports")
    .select("id, tela, titulo, payload, criado_por, visibilidade, shared_emails, created_at")
    .eq("tela", tela!)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: ((data ?? []) as ReportLinha[]).filter((r) => visivelPara(r, email)) });
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
  const email = (user?.email || "").toLowerCase();
  const adm = admPublico();

  // Teto do usuário: exceção 'nenhum' bloqueia; 'proprio' força só-para-si.
  const modo = await modoReportDoUsuario(adm, email);
  if (modo === "nenhum") {
    return NextResponse.json({ error: "Você não pode incorporar reports (regra do admin)." }, { status: 403 });
  }
  const fontes = validarFontesDoReport(report, !!chk.perms?.is_admin);
  if (!fontes.ok) return NextResponse.json({ error: `report dinâmico recusado: ${fontes.motivo}` }, { status: 403 });
  const pedida = body.visibilidade === "proprio" ? "proprio" : "todos";
  const visibilidade = modo === "todos" ? pedida : "proprio";

  const { data, error } = await adm
    .from("cesar_reports")
    .insert({ tela, titulo, payload: report, criado_por: user?.email ?? "", visibilidade })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data?.id, visibilidade });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supa = await supaServer("public");
  const { data: { user } } = await supa.auth.getUser();
  const email = (user?.email || "").toLowerCase();

  const adm = admPublico();
  const { data: alvo } = await adm.from("cesar_reports").select("criado_por").eq("id", id).maybeSingle();
  if (!alvo) return NextResponse.json({ ok: true });
  const dono = String(alvo.criado_por || "").toLowerCase() === email;
  if (!dono && !perms.is_admin) {
    return NextResponse.json({ error: "Só o dono do report ou admin exclui" }, { status: 403 });
  }

  const { error } = await adm.from("cesar_reports").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
