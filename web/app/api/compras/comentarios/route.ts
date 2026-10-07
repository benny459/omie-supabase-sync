// Comentários do pedido de compra (07/10/26, Benny — Operação › Projetos, 💬 por PC).
//
// Não há tabela nova: o comentário é uma linha do histórico do pedido (compras.historico,
// via orders.compras_registrar) com o texto começando por "💬 " — por isso aparece também
// no Histórico da folha do PC no Compras.
//
//   GET  ?emp=SF&pcs=7241,7274   → { contagem: { "7241": 2, … } }
//   GET  ?emp=SF&pc=7241         → { comentarios: [{ texto, por, em }] }
//   POST { emp, pc, texto }       → grava
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
const MARCA = "💬 ";

async function idDoPc(emp: string, pc: string): Promise<number | null> {
  const { data } = await supaAdmin().schema("orders").rpc("compras_id_por_numero", { p_empresa: emp, p_numero: pc, p_tipo: "PC" });
  return data ? Number(data) : null;
}
async function comentarios(id: number) {
  const { data } = await supaAdmin().schema("orders").rpc("compras_pedido", { p_id: id });
  const hist = (((data ?? {}) as { hist?: { t?: string; em?: string; por?: string }[] }).hist ?? []);
  return hist.filter((h) => String(h.t ?? "").startsWith(MARCA))
    .map((h) => ({ texto: String(h.t).slice(MARCA.length), por: h.por ?? null, em: h.em ?? null }))
    .sort((a, b) => String(a.em ?? "").localeCompare(String(b.em ?? "")));
}

export async function GET(req: Request) {
  if (!(await loadPerms())) return NextResponse.json({ error: "Sessão expirada" }, { status: 401 });
  const u = new URL(req.url);
  const emp = (u.searchParams.get("emp") || "SF").toUpperCase();
  const pc = u.searchParams.get("pc");
  if (pc) {
    const id = await idDoPc(emp, pc);
    if (!id) return NextResponse.json({ comentarios: [], achado: false });
    return NextResponse.json({ comentarios: await comentarios(id), achado: true });
  }
  const pcs = (u.searchParams.get("pcs") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 80);
  const contagem: Record<string, number> = {};
  await Promise.all(pcs.map(async (n) => {
    const id = await idDoPc(emp, n);
    contagem[n] = id ? (await comentarios(id)).length : 0;
  }));
  return NextResponse.json({ contagem });
}

export async function POST(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada" }, { status: 401 });
  const supa = await supaServer("platform");
  const { data: { user } } = await supa.auth.getUser();
  const b = (await req.json().catch(() => ({}))) as { emp?: string; pc?: string; texto?: string };
  const emp = String(b.emp ?? "SF").toUpperCase();
  const texto = String(b.texto ?? "").trim().slice(0, 2000);
  if (!b.pc || !texto) return NextResponse.json({ error: "pc e texto obrigatórios" }, { status: 400 });
  const id = await idDoPc(emp, String(b.pc));
  if (!id) return NextResponse.json({ error: `PC ${b.pc} não encontrado` }, { status: 404 });
  const { error } = await supaAdmin().schema("orders").rpc("compras_registrar", { p_id: id, p_texto: MARCA + texto, p_por: user?.email ?? "painel" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, comentarios: await comentarios(id) });
}
