// POST /api/ordem/sincronizar — corre os detetores agora (admin). Só lê os módulos e
// regrava o cache ordem.item; nunca mexe nos dados dos módulos.
import { NextResponse } from "next/server";
import { quemOrdem, sincronizar } from "@/lib/ordem/servidor";
import { ehModulo } from "@/lib/ordem/modulos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const q = await quemOrdem();
  if (q instanceof NextResponse) return q;
  if (!q.admin) return NextResponse.json({ error: "Só o administrador atualiza à mão (o sistema atualiza sozinho a cada 15 min)." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { modulos?: string[] };
  const modulos = Array.isArray(b.modulos) ? b.modulos.filter(ehModulo) : undefined;
  try { return NextResponse.json(await sincronizar({ modulos })); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}
