// GET  /api/vendas/config?emp=SF                → chave "PV/OS do CRM nascem no painel"
// POST /api/vendas/config { empresa, nativo }   → liga/desliga (só admin)
import { NextResponse } from "next/server";
import { rpc } from "@/lib/compras-server";
import { erro, exigirVendas } from "@/lib/vendas-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirVendas();
  if (q instanceof NextResponse) return q;
  const emp = (new URL(req.url).searchParams.get("emp") ?? "SF").toUpperCase();
  try { return NextResponse.json(await rpc("vendas_config", { p_empresa: emp })); } catch (e) { return erro(e); }
}

export async function POST(req: Request) {
  const q = await exigirVendas();
  if (q instanceof NextResponse) return q;
  if (!q.admin) return NextResponse.json({ error: "Só administradores mudam esta chave" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; nativo?: boolean };
  try {
    return NextResponse.json(await rpc("vendas_config_definir", {
      p_empresa: (b.empresa ?? "SF").toUpperCase(), p_nativo: !!b.nativo, p_por: q.email }));
  } catch (e) { return erro(e); }
}
