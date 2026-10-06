// /api/compras/aprovacao-ia — aprovação automática de PCs avulsos pelo Agente IA.
//   GET   simulação: lista dos PCs pendentes com a decisão (elegível / pulado + motivo)
//         e as últimas rodadas registradas.
//   POST  {aplicar: true} aprova os elegíveis agora (só administrador).
import { NextResponse } from "next/server";
import { exigirCompras, erro } from "@/lib/compras-server";
import { candidatosIA, rodarAprovacaoIA, ultimasRodadasIA } from "@/lib/aprovacao-ia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  if (!q.perms.is_admin && !q.pode["compras.aprovar"]) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  try {
    const [lista, ultimas] = await Promise.all([candidatosIA(), ultimasRodadasIA(60)]);
    return NextResponse.json({ lista, ultimas });
  } catch (e) { return erro(e); }
}

export async function POST(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  if (!q.perms.is_admin) return NextResponse.json({ error: "Só administrador roda a aprovação automática" }, { status: 403 });
  const b = await req.json().catch(() => ({})) as { aplicar?: boolean };
  try {
    return NextResponse.json(await rodarAprovacaoIA({ aplicar: !!b.aplicar, disparo: `manual:${q.email}` }));
  } catch (e) { return erro(e); }
}
