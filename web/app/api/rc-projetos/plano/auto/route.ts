// POST /api/rc-projetos/plano/auto  { empresa, codigo_projeto }
//
// Chamado quando a tela do projeto abre: se o CRM publicou um CP/MC novo para
// este projeto, importa antes de o usuário precisar do botão. O cron
// /api/cron/planos-crm faz o mesmo para todos, de 15 em 15 minutos.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { sincronizarPlano } from "@/lib/plano-auto";
import { fetchFechamentosDoProjeto } from "@/lib/crm-fechamento";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const b = (await req.json().catch(() => null)) as { empresa?: string; codigo_projeto?: number } | null;
  const empresa = b?.empresa ? String(b.empresa) : null;
  const codigo = Number(b?.codigo_projeto);
  if (!empresa || !Number.isFinite(codigo) || codigo <= 0) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }
  try {
    const fechamentos = await fetchFechamentosDoProjeto(codigo);
    const r = await sincronizarPlano(empresa, codigo,
      fechamentos.map((f) => ({ numero: f.numero, valor: Number(f.valor) || 0, cpmcUrl: f.cpmcUrl })));
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
