// GET /api/ordem/mensagens?janela=07:30 — pré-visualização (admin): o que cada pessoa receberia
// nessa janela, filtrado pelo perfil dela. Não grava nem envia nada.
import { NextResponse } from "next/server";
import { quemOrdem } from "@/lib/ordem/servidor";
import { rodarMensagens } from "@/lib/ordem/mensagens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const q = await quemOrdem();
  if (q instanceof NextResponse) return q;
  if (!q.admin) return NextResponse.json({ error: "Só o administrador." }, { status: 403 });
  const janela = new URL(req.url).searchParams.get("janela") ?? "07:30";
  if (!/^\d{2}:\d{2}$/.test(janela)) return NextResponse.json({ error: "janela HH:MM" }, { status: 400 });
  return NextResponse.json(await rodarMensagens({ simular: true, forcarJanela: janela }));
}
