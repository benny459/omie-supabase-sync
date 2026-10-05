// GET  /api/compras/avisos — RCs novas desde a última visita da pessoa e PCs
//      criados no Omie depois de 01/10/2026 (a regra é PC só no painel).
// POST /api/compras/avisos {acao: "rc_vistas"} — marca as RCs como vistas.
import { NextResponse } from "next/server";
import { exigirCompras, rpc, erro } from "@/lib/compras-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Avisos = {
  rcDesde: string; rcNovas: number; rcNovasIds: number[];
  pcsOmie: { id: number; num: string; emp: string; forn?: string; valor: number; emissao: string }[];
};

export async function GET() {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  try { return NextResponse.json(await rpc<Avisos>("compras_avisos", { p_email: q.email })); }
  catch (e) { return erro(e); }
}

export async function POST(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const b = await req.json().catch(() => ({})) as { acao?: string };
  if (b.acao !== "rc_vistas") return NextResponse.json({ error: "ação inválida" }, { status: 400 });
  try { await rpc("compras_rc_marcar_vistas", { p_email: q.email }); return NextResponse.json({ ok: true }); }
  catch (e) { return erro(e); }
}
