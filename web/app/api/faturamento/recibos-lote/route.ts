// Recibos já emitidos de várias OS numa página só (05/10/26): recebe os rótulos
// (OS4738,OS4735…) e redireciona para /api/faturamento/arquivo com os recibos do
// painel. As OS faturadas por recibo do Omie voltam na lista `omie` para o
// cliente abrir à parte (documento-omie gera cada uma).
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  const u = new URL(req.url);
  const empresa = (u.searchParams.get("empresa") ?? "SF").toUpperCase();
  const rotulos = (u.searchParams.get("os") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^OS\d+$/.test(s)).slice(0, 100);
  if (!rotulos.length) return NextResponse.json({ error: "nenhuma OS" }, { status: 400 });
  const { data, error } = await supaAdmin().schema("orders").from("fat_emissoes")
    .select("origem_rotulo, pdf_path, autorizada_em")
    .eq("empresa", empresa).eq("tipo", "recibo").eq("status", "autorizada").eq("ambiente", "producao")
    .in("origem_rotulo", rotulos).not("pdf_path", "is", null).order("autorizada_em");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const caminhos = new Map<string, string>();
  for (const r of (data ?? []) as { origem_rotulo: string; pdf_path: string }[]) caminhos.set(r.origem_rotulo, r.pdf_path);
  const painel = rotulos.filter((r) => caminhos.has(r)).map((r) => caminhos.get(r)!);
  const omie = rotulos.filter((r) => !caminhos.has(r));
  if (u.searchParams.get("fmt") === "json") return NextResponse.json({ painel, omie });
  if (!painel.length) return NextResponse.json({ error: "Nenhum recibo do painel para estas OS", omie }, { status: 404 });
  return NextResponse.redirect(new URL(`/api/faturamento/arquivo?${painel.map((p) => `p=${encodeURIComponent(p)}`).join("&")}`, u.origin));
}
