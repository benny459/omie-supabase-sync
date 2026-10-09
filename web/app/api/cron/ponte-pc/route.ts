// /api/cron/ponte-pc — Ponte PC → Lista de materiais, todo dia às 06:30 de Brasília
// (09:30 UTC, vercel.json). Pega o PC do Omie que foi ligado ao projeto depois (o sync do
// Omie não passa pelo posGravar) e o PC cancelado depois da última abertura da lista.
// Projetos: os marcados ★ ativos (rc_projetos_budget.ativo) + os que tiveram PC criado ou
// mexido nos últimos 30 dias.
// Manual: /api/cron/ponte-pc?secret=<CRON_SECRET>[&simular=1][&projeto=<código>][&empresa=SF]
import { NextRequest, NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { ponteProjeto, type ResultadoPonte } from "@/lib/ponte-pc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if ((req.headers.get("authorization") ?? "") === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const simular = sp.get("simular") === "1";
  const so = Number(sp.get("projeto")) || null;
  const alvo = new Map<string, { empresa: string; codigo: number }>();
  if (so) alvo.set(`${(sp.get("empresa") ?? "SF").toUpperCase()}|${so}`, { empresa: (sp.get("empresa") ?? "SF").toUpperCase(), codigo: so });
  else {
    const desde = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [ativos, recentes] = await Promise.all([
      supaAdmin().schema("approval").from("rc_projetos_budget").select("empresa, codigo_projeto").eq("ativo", true),
      supaAdmin().schema("compras").from("pedidos").select("empresa, projeto_cod").eq("tipo", "PC").not("projeto_cod", "is", null)
        .or(`updated_at.gte.${desde},created_at.gte.${desde}`).limit(5000),
    ]);
    for (const a of (ativos.data ?? []) as { empresa: string; codigo_projeto: number }[]) alvo.set(`${a.empresa}|${a.codigo_projeto}`, { empresa: a.empresa, codigo: Number(a.codigo_projeto) });
    for (const p of (recentes.data ?? []) as { empresa: string; projeto_cod: number }[]) alvo.set(`${p.empresa}|${p.projeto_cod}`, { empresa: p.empresa, codigo: Number(p.projeto_cod) });
  }
  const inicio = Date.now();
  const out: (Pick<ResultadoPonte, "empresa" | "codigo" | "itens_pc" | "inseridos" | "ligados" | "removidos_cancelado" | "pcs"> & { erro?: string })[] = [];
  let parou = false;
  for (const { empresa, codigo } of alvo.values()) {
    if (Date.now() - inicio > 270_000) { parou = true; break; }
    try {
      const r = await ponteProjeto(empresa, codigo, { simular, por: "ponte PC (cron)" });
      if (!r.disponivel) return NextResponse.json({ ok: false, disponivel: false, motivo: "sql/156 não aplicada" });
      out.push({ empresa, codigo, itens_pc: r.itens_pc, inseridos: r.inseridos, ligados: r.ligados, removidos_cancelado: r.removidos_cancelado, pcs: r.pcs });
    } catch (e) {
      out.push({ empresa, codigo, itens_pc: 0, inseridos: 0, ligados: 0, removidos_cancelado: 0, pcs: [], erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ ok: true, simulado: simular, projetos: alvo.size, tratados: out.length, parou_por_tempo: parou,
    inseridos: out.reduce((a, r) => a + r.inseridos, 0), ligados: out.reduce((a, r) => a + r.ligados, 0),
    removidos_cancelado: out.reduce((a, r) => a + r.removidos_cancelado, 0),
    detalhe: out.filter((r) => r.inseridos || r.ligados || r.removidos_cancelado || r.erro) });
}
