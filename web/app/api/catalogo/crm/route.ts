// /api/catalogo/crm — servidor-a-servidor para o CRM (Propostas-WW), P7 05/10/26.
// A CP e a RC do CRM usam o código NATIVO do item e o custo do painel.
//   POST { acao: "buscar", q, limite?, historico? } → { itens: ItemCrm[] }
//   POST { acao: "resolver", codigos: string[], historico? } → { itens: { [codigo]: ItemCrm } }  (propostas antigas)
//   POST { acao: "casar", textos: string[], historico? }     → { itens: (ItemCrm|null)[] }       (linhas sem código)
//   historico > 0 traz as últimas compras (fornecedor, data, preço) de cada item — a RC usa.
// Autenticação: header x-compras-secret = COMPRAS_RC_SECRET (o mesmo da RC e do PV/OS).
// Rota pública no middleware; a guarda é o segredo. Só leitura.
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { buscarItensCrm, casarItensCrm, resolverCodigosCrm } from "@/lib/catalogo-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function autorizado(req: Request) {
  const esperado = process.env.COMPRAS_RC_SECRET ?? "";
  const veio = req.headers.get("x-compras-secret") ?? "";
  if (!esperado || esperado.length !== veio.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(veio));
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as {
    acao?: string; q?: string; limite?: number; historico?: number; codigos?: string[]; textos?: string[]; empresa?: string;
  } | null;
  const empresa = (b?.empresa ?? "SF").toUpperCase();
  const hist = Math.max(0, Math.min(Number(b?.historico ?? 0) || 0, 10));
  try {
    if (b?.acao === "buscar") {
      const itens = await buscarItensCrm(String(b.q ?? ""), Number(b.limite) || 10, Math.max(0, Math.min(Number(b.historico ?? 3), 10)), empresa);
      return NextResponse.json({ itens });
    }
    if (b?.acao === "resolver") {
      if (!Array.isArray(b.codigos)) return NextResponse.json({ error: "codigos[] obrigatório" }, { status: 400 });
      return NextResponse.json({ itens: await resolverCodigosCrm(b.codigos.map(String), empresa, hist) });
    }
    if (b?.acao === "casar") {
      if (!Array.isArray(b.textos)) return NextResponse.json({ error: "textos[] obrigatório" }, { status: 400 });
      return NextResponse.json({ itens: await casarItensCrm(b.textos.map(String), empresa, hist) });
    }
    return NextResponse.json({ error: "acao inválida (buscar | resolver | casar)" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
