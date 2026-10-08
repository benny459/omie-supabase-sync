// Projetos ativos (08/10/26, Benny): "★ ativo" por projeto, compartilhado por todo mundo.
// GET   /api/rc-projetos/ativos → { disponivel, ativos: [{ empresa, codigo_projeto, nome, cliente }] }
// PATCH /api/rc-projetos/ativos { empresa, codigo_projeto, ativo } → marca/desmarca um
// PUT   /api/rc-projetos/ativos { itens: [...] } → salva a seleção do painel ⚙ Ativos
//
// Mora em approval.rc_projetos_budget.ativo (sql/130), a mesma linha por projeto das flags de
// escopo. Enquanto a coluna não existe, GET responde disponivel:false e a tela mostra tudo.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Linha = { empresa: string; codigo_projeto: number; ativo_por?: string | null; ativo_em?: string | null };
const semColuna = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /ativo/.test(e.message ?? "") && /column|coluna/i.test(e.message ?? ""));

export async function GET() {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "operacao") && !canViewArea(perms, "compras")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supa = await supaServer();
  const { data, error } = await supa.schema("approval" as never).from("rc_projetos_budget")
    .select("empresa, codigo_projeto, ativo_por, ativo_em").eq("ativo", true);
  if (semColuna(error)) return NextResponse.json({ disponivel: false, ativos: [] });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const linhas = (data ?? []) as Linha[];
  const cods = [...new Set(linhas.map((l) => Number(l.codigo_projeto)))];
  const nomes = new Map<string, string>(), clientes = new Map<string, string>();
  if (cods.length) {
    const [{ data: cad }, { data: planos }] = await Promise.all([
      supa.schema("finance" as never).from("projetos").select("empresa, codigo, nome").in("codigo", cods),
      supa.schema("approval" as never).from("projeto_plano").select("empresa, codigo_projeto, cliente").in("codigo_projeto", cods),
    ]);
    for (const c of (cad ?? []) as { empresa: string; codigo: number; nome: string }[]) nomes.set(`${c.empresa}|${c.codigo}`, String(c.nome ?? "").trim());
    for (const p of (planos ?? []) as { empresa: string; codigo_projeto: number; cliente: string }[]) if (p.cliente) clientes.set(`${p.empresa}|${p.codigo_projeto}`, String(p.cliente).trim());
  }
  const ativos = linhas.map((l) => {
    const k = `${l.empresa}|${l.codigo_projeto}`;
    return { empresa: l.empresa, codigo_projeto: Number(l.codigo_projeto), nome: nomes.get(k) || null, cliente: clientes.get(k) || null, por: l.ativo_por ?? null, em: l.ativo_em ?? null };
  });
  return NextResponse.json({ disponivel: true, ativos });
}

export async function PATCH(req: Request) {
  let body: { empresa?: string; codigo_projeto?: number; ativo?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const r = await gravar([body]);
  return NextResponse.json(r.erro ? { error: r.erro } : { ok: true }, { status: r.status });
}

// PUT { itens: [{ empresa, codigo_projeto, ativo }] } — o painel "⚙ Ativos" salva tudo de uma vez.
export async function PUT(req: Request) {
  let body: { itens?: { empresa?: string; codigo_projeto?: number; ativo?: boolean }[] };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  const itens = Array.isArray(body.itens) ? body.itens : [];
  if (!itens.length) return NextResponse.json({ ok: true, gravados: 0 });
  if (itens.length > 1000) return NextResponse.json({ error: "itens demais" }, { status: 400 });
  const r = await gravar(itens);
  return NextResponse.json(r.erro ? { error: r.erro, gravados: r.gravados } : { ok: true, gravados: r.gravados }, { status: r.status });
}

async function gravar(itens: { empresa?: string; codigo_projeto?: number; ativo?: boolean }[]): Promise<{ status: number; erro?: string; gravados: number }> {
  const perms = await loadPerms();
  if (!perms) return { status: 401, erro: "Unauthorized", gravados: 0 };
  if (!canViewArea(perms, "operacao") || (perms.role === "viewer" && !perms.is_admin)) {
    return { status: 403, erro: "Sem permissão para marcar projetos ativos", gravados: 0 };
  }
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  const quem = user?.email || user?.id || null;
  const tab = () => supa.schema("approval" as never).from("rc_projetos_budget");
  let gravados = 0;
  for (const body of itens) {
    const empresa = String(body.empresa ?? "").trim().toUpperCase();
    const codigo = Number(body.codigo_projeto);
    if (!empresa || !Number.isFinite(codigo) || codigo <= 0 || typeof body.ativo !== "boolean") {
      return { status: 400, erro: "empresa, codigo_projeto e ativo (true/false) obrigatórios", gravados };
    }
    const patch = { ativo: body.ativo, ativo_por: quem, ativo_em: new Date().toISOString() };
    // Atualiza a linha que já existe (não mexe em criado_por / budget); sem linha, cria uma só com a flag.
    const { data: upd, error: eUpd } = await tab().update(patch as never)
      .eq("empresa", empresa).eq("codigo_projeto", codigo).select("codigo_projeto");
    if (semColuna(eUpd)) return { status: 409, erro: "A marcação de projeto ativo ainda não foi ligada no banco (sql/130).", gravados };
    if (eUpd) return { status: 500, erro: eUpd.message, gravados };
    if (!(upd as unknown[] | null)?.length && body.ativo) {
      const { error: eIns } = await tab().insert({ empresa, codigo_projeto: codigo, criado_por: quem, ...patch } as never);
      if (eIns) return { status: /row-level security/i.test(eIns.message) ? 403 : 500, erro: eIns.message, gravados };
    }
    gravados++;
  }
  return { status: 200, gravados };
}
