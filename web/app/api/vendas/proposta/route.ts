// GET /api/vendas/proposta?q=texto         → propostas do CRM (nº, cliente, título, status, valor)
// GET /api/vendas/proposta?numero=X&emp=SF → dados da proposta prontos para o PV/OS / emissão
//   (cliente do cadastro do painel, itens com código nativo, condição, projeto)
// Lê o CRM por /api/propostas-painel (servidor-a-servidor). Se o CRM ainda não
// tiver o endpoint publicado, devolve { disponivel: false } e a tela segue.
import { NextResponse } from "next/server";
import { erro, exigirVendas } from "@/lib/vendas-server";
import { buscarPropostas, prefillProposta } from "@/lib/crm-propostas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const q = await exigirVendas();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  try {
    const numero = sp.get("numero");
    if (numero) return NextResponse.json(await prefillProposta(numero.trim(), (sp.get("emp") ?? "SF").toUpperCase()));
    return NextResponse.json(await buscarPropostas((sp.get("q") ?? "").trim()));
  } catch (e) { return erro(e); }
}
