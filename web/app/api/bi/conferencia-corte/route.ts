// Conferência do corte financeiro (05/10/26) — DRE e saldo por conta calculados
// sobre o razão bancário nativo (arquivo do Omie antes do corte; OFX/Omie Cash
// + baixas do painel depois dele) lado a lado com os números atuais (extrato do
// Omie). Nada aqui muda as telas do BI: a troca é uma decisão do Benny.
//
//   GET  ?meses=3                         → bi.conferencia_corte
//   POST { acao: "corte", data }          → muda a data de corte (admin)
//        { acao: "abertura", empresa, cod_cc, saldo | null } → saldo de abertura manual (admin; null volta ao do Omie)
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

async function quem() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const perms = await loadPerms();
  return perms ? { perms, email: user.email ?? "?" } : null;
}

export async function GET(req: Request) {
  const q = await quem();
  if (!q) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(q.perms, "bi") && !canViewArea(q.perms, "financeiro")) return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  const meses = Math.min(12, Math.max(1, Number(new URL(req.url).searchParams.get("meses")) || 3));
  const { data, error } = await supaAdmin().schema("bi").rpc("conferencia_corte", { p_meses: meses });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...(data as object), pode_editar: !!q.perms.is_admin });
}

export async function POST(req: Request) {
  const q = await quem();
  if (!q) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!q.perms.is_admin) return NextResponse.json({ error: "Só administradores mudam o corte" }, { status: 403 });
  let b: { acao?: string; data?: string; empresa?: string; cod_cc?: number; saldo?: number | null };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const fin = supaAdmin().schema("finance");
  if (b.acao === "corte") {
    if (!b.data || !ISO.test(b.data)) return NextResponse.json({ error: "data (YYYY-MM-DD) obrigatória" }, { status: 400 });
    const { error } = await fin.from("config").upsert({ chave: "corte_financeiro", valor: { data: b.data }, atualizado_em: new Date().toISOString(), atualizado_por: q.email });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await fin.from("financeiro_audit").insert({ usuario: q.email, acao: "corte_financeiro", entidade: "config", entidade_id: "corte_financeiro", detalhe: { data: b.data } });
    // o Omie Cash passa a entrar no banco nativo a partir da nova data
    await fin.rpc("omie_cash_sincronizar", { p_desde: b.data });
    return NextResponse.json({ ok: true });
  }
  if (b.acao === "abertura") {
    const empresa = String(b.empresa ?? "").toUpperCase(); const cod = Number(b.cod_cc ?? 0);
    if (!empresa || !cod) return NextResponse.json({ error: "empresa e cod_cc obrigatórios" }, { status: 400 });
    if (b.saldo === null || b.saldo === undefined) {
      const { error } = await fin.from("saldo_abertura").delete().eq("empresa", empresa).eq("cod_cc", cod);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const saldo = Math.round(Number(b.saldo) * 100) / 100;
      if (!Number.isFinite(saldo)) return NextResponse.json({ error: "saldo inválido" }, { status: 400 });
      const { data: c } = await fin.from("config").select("valor").eq("chave", "corte_financeiro").maybeSingle();
      const { error } = await fin.from("saldo_abertura").upsert({ empresa, cod_cc: cod, data: (c?.valor as { data?: string })?.data ?? new Date().toISOString().slice(0, 10), saldo, fonte: "manual", atualizado_por: q.email, atualizado_em: new Date().toISOString() });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    await fin.from("financeiro_audit").insert({ usuario: q.email, acao: "saldo_abertura", entidade: "conta", entidade_id: `${empresa}:${cod}`, detalhe: { saldo: b.saldo ?? null } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "acao inválida" }, { status: 400 });
}
