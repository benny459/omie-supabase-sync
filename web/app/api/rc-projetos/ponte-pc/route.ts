// /api/rc-projetos/ponte-pc — Ponte PC → Lista de materiais (09/10/26, lib/ponte-pc.ts).
//   GET  ?empresa=SF&codigo=…&simular=1 → o que entraria na lista (sem gravar)
//   GET  ?empresa=SF&codigo=…            → roda (mesmo que o POST)
//   POST { empresa, codigo, simular? }   → roda a ponte do projeto
// A tela chama ao abrir a Lista de materiais; o cartão do projeto em Operação › Projetos
// chama pelo GET /api/rc-projetos/compras?ponte=1; o Compras chama no posGravar; e há o
// cron diário /api/cron/ponte-pc.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { ponteProjeto } from "@/lib/ponte-pc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function usuario() {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  return user;
}

async function rodar(empresa: string, codigo: number, simular: boolean, por: string) {
  if (!codigo) return NextResponse.json({ error: "codigo obrigatório" }, { status: 400 });
  try {
    return NextResponse.json({ ...(await ponteProjeto(empresa, codigo, { simular, por })), agora: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const u = await usuario();
  if (!u) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const simular = sp.get("simular") === "1" || sp.get("simular") === "true";
  return rodar((sp.get("empresa") ?? "SF").toUpperCase(), Number(sp.get("codigo")), simular, `ponte PC (${u.email ?? u.id})`);
}

export async function POST(req: Request) {
  const u = await usuario();
  if (!u) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  let b: { empresa?: string; codigo?: number; simular?: boolean };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  return rodar(String(b.empresa ?? "SF").toUpperCase(), Number(b.codigo), !!b.simular, `ponte PC (${u.email ?? u.id})`);
}
