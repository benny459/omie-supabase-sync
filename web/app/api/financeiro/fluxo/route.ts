// Fluxo de Caixa do Financeiro (08/10/26 — financeiro-fluxo-v3-SPEC, P2).
// GET ?de=AAAA-MM-DD&ate=AAAA-MM-DD → contas (saldo de hoje), lançamentos
// realizados + em aberto (pagar, receber, contratos a faturar) e recebíveis
// vencidos. A montagem por dia/semana/mês, o saldo, os cenários e o zoom ficam
// no navegador — trocar a vista não chama a API de novo. Ver sql/140.
import { NextResponse } from "next/server";
import { fin, erroDb } from "@/lib/financeiro-baixas";
import { exigirFluxo } from "@/lib/fluxo-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const a = await exigirFluxo();
  if (a instanceof NextResponse) return a;
  const u = new URL(req.url);
  const de = u.searchParams.get("de") ?? "", ate = u.searchParams.get("ate") ?? "";
  if (!ISO.test(de) || !ISO.test(ate)) return NextResponse.json({ error: "período inválido" }, { status: 400 });
  const { data, error } = await fin().rpc("fluxo_caixa_dados", { p_de: de, p_ate: ate });
  if (error) return erroDb(error);
  return NextResponse.json({ ...(data as object), pode: { editar: !!a.pode["financeiro.editar_titulo"], usuario: a.email } },
    { headers: { "Cache-Control": "no-store" } });
}
