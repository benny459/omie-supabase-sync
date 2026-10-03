// Janelas de inventário (ajuste de saldo SÓ no painel — nunca vai ao Omie).
// GET  /api/estoque/janela  (admin) → janelas com totais de ajustes
// POST /api/estoque/janela  (admin) { nome, horas, escopo? } → cria e devolve a senha UMA vez.
//      A senha (6 caracteres) não é guardada: só sha256(sal:senha) em platform.estoque_janela.

import { NextResponse } from "next/server";
import { exigirAdminEstoque, gerarCodigo, hashCodigo, novoSal, platform } from "@/lib/estoque-server";

export const runtime = "nodejs";

const MAX_HORAS = 30 * 24;

export async function GET() {
  const q = await exigirAdminEstoque("estoque.senha_inventario");
  if (q instanceof NextResponse) return q;
  const db = platform();
  const [jr, ar] = await Promise.all([
    db.from("estoque_janela").select("id, nome, escopo, valida_ate, revogada_em, revogada_por_email, created_by_email, created_at")
      .order("created_at", { ascending: false }).limit(100),
    db.from("estoque_ajuste").select("janela_id, diferenca, valor, revisao, status").eq("tipo", "inventario").not("janela_id", "is", null),
  ]);
  if (jr.error) return NextResponse.json({ error: jr.error.message }, { status: 500 });
  if (ar.error) return NextResponse.json({ error: ar.error.message }, { status: 500 });
  const tot = new Map<number, { n: number; valor: number; pendentes: number; contestados: number }>();
  for (const a of (ar.data ?? []) as { janela_id: number; valor: number; revisao: string; status: string }[]) {
    if (a.status !== "aplicado") continue;
    const t = tot.get(a.janela_id) ?? { n: 0, valor: 0, pendentes: 0, contestados: 0 };
    t.n++; t.valor += Number(a.valor) || 0;
    if (a.revisao === "pendente") t.pendentes++;
    if (a.revisao === "contestado") t.contestados++;
    tot.set(a.janela_id, t);
  }
  const janelas = (jr.data ?? []).map((j) => ({ ...j, totais: tot.get(j.id as number) ?? { n: 0, valor: 0, pendentes: 0, contestados: 0 } }));
  return NextResponse.json({ janelas });
}

export async function POST(req: Request) {
  const q = await exigirAdminEstoque("estoque.senha_inventario");
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { nome?: string; horas?: number; escopo?: { familia?: string; local?: string } };
  const nome = String(b.nome ?? "").trim();
  const horas = Number(b.horas);
  if (!nome) return NextResponse.json({ error: "Dê um nome à janela (ex.: Inventário outubro)" }, { status: 400 });
  if (!Number.isFinite(horas) || horas < 1 || horas > MAX_HORAS) return NextResponse.json({ error: "Validade entre 1 hora e 30 dias" }, { status: 400 });
  const escopo: Record<string, string> = {};
  if (b.escopo?.familia) escopo.familia = String(b.escopo.familia);
  if (b.escopo?.local) escopo.local = String(b.escopo.local);

  const codigo = gerarCodigo(), sal = novoSal();
  const { data, error } = await platform().from("estoque_janela").insert({
    nome, codigo_salt: sal, codigo_hash: hashCodigo(sal, codigo), escopo,
    valida_ate: new Date(Date.now() + horas * 3600_000).toISOString(),
    created_by: q.id || null, created_by_email: q.email,
  }).select("id, nome, escopo, valida_ate, created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ janela: data, codigo });
}
