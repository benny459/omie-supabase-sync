// /api/rc-projetos/fluxo-comparado — fluxo INICIAL (travado) × EM ANDAMENTO do projeto.
//   GET  ?empresa=&codigo_projeto=  → eventos dos dois fluxos (regras em lib/fluxo-comparado.ts)
//                                     + estado da aprovação do fluxo (barra da aba 4)
//   POST { empresa, codigo_projeto, acao: "redefinir" } → refaz a foto do fluxo inicial com o
//        plano atual. Só administrador; nunca automático.
// O Omie nunca é escrito.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { canApprove, canEdit } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { montarFluxoComparado } from "@/lib/fluxo-comparado";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const empresa = (u.searchParams.get("empresa") || "SF").toUpperCase();
  const codigo = Number(u.searchParams.get("codigo_projeto") ?? u.searchParams.get("codigo"));
  if (!Number.isFinite(codigo) || codigo <= 0) return NextResponse.json({ error: "codigo_projeto obrigatório" }, { status: 400 });
  try {
    const ap = supaAdmin().schema("approval");
    const [perms, fluxo, cab, eventos] = await Promise.all([
      loadPerms(),
      montarFluxoComparado(empresa, codigo, user.email ?? user.id),
      ap.from("projeto_fluxo").select("status, versao, enviado_por, enviado_em, decidido_por, decidido_em, motivo")
        .eq("empresa", empresa).eq("codigo_projeto", codigo).maybeSingle(),
      ap.from("projeto_fluxo_evento").select("versao, acao, por, em, motivo, total_entradas, total_saidas, linhas")
        .eq("empresa", empresa).eq("codigo_projeto", codigo).order("em", { ascending: false }).limit(20),
    ]);
    return NextResponse.json({
      ...fluxo,
      cabecalho: cab.data ?? { status: "rascunho", versao: 1 },
      eventos: eventos.data ?? [],
      pode: {
        editar: canEdit(perms, "projetos", "pvos"),
        aprovar: canApprove(perms, "projetos"),
        redefinir: !!(perms?.is_admin || perms?.role === "admin"),
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await loadPerms();
  if (!(perms?.is_admin || perms?.role === "admin")) {
    return NextResponse.json({ error: "Só administrador redefine o fluxo inicial" }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; codigo_projeto?: number; acao?: string };
  const empresa = String(b.empresa ?? "SF").toUpperCase();
  const codigo = Number(b.codigo_projeto);
  if (b.acao !== "redefinir" || !Number.isFinite(codigo) || codigo <= 0) {
    return NextResponse.json({ error: "acao=redefinir e codigo_projeto obrigatórios" }, { status: 400 });
  }
  const { data, error } = await supaAdmin().schema("approval").rpc("fluxo_inicial_congelar", {
    p_empresa: empresa, p_codigo: codigo, p_quem: user.email ?? user.id, p_forcar: true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...(data as object) });
}
