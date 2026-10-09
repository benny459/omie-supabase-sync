// /api/cron/ordem — Central de Ordem, a cada 15 min (vercel.json):
//  1) corre os detetores (só leitura dos módulos; regrava ordem.item);
//  2) escada da cobrança e mensagens das 07:30 / 11:30 / 16:00 / 18:00 (lib/ordem/mensagens.ts),
//     no modo configurado (desligado | ensaio | teste | ligado — começa desligado).
// Manual: /api/cron/ordem?secret=<CRON_SECRET>[&simular=1] — simular não grava nem envia nada.
import { NextRequest, NextResponse } from "next/server";
import { sincronizar } from "@/lib/ordem/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function autorizado(req: NextRequest) {
  const s = process.env.CRON_SECRET;
  if (!s) return false;
  if ((req.headers.get("authorization") ?? "") === `Bearer ${s}`) return true;
  return new URL(req.url).searchParams.get("secret") === s;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const simular = new URL(req.url).searchParams.get("simular") === "1";
  const out: Record<string, unknown> = {};
  if (!simular) {
    // pesados (Operação/Projetos) só na primeira passagem de cada hora
    const minuto = new Date().getUTCMinutes();
    try { out.sync = await sincronizar({ pesados: minuto < 15 }); } catch (e) { out.sync = { erro: e instanceof Error ? e.message : String(e) }; }
  }
  try {
    const { rodarMensagens } = await import("@/lib/ordem/mensagens");
    out.mensagens = await rodarMensagens({ simular });
  } catch (e) { out.mensagens = { erro: e instanceof Error ? e.message : String(e) }; }
  // Resumo no log da Vercel (sem dados de negócio: só contagens e erros por detetor).
  const sy = out.sync as { detetados?: number; novos?: number; fechados?: number; erros?: Record<string, string>; ms?: number } | undefined;
  console.log(`[ordem/cron] detetados=${sy?.detetados} novos=${sy?.novos} fechados=${sy?.fechados} ms=${sy?.ms} erros=${JSON.stringify(sy?.erros ?? (out.sync as { erro?: string })?.erro ?? {})}`);
  return NextResponse.json({ ok: true, simular, ...out });
}
