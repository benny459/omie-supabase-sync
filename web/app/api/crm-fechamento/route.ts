// GET /api/crm-fechamento?codigo=12580422062
// O resumo do fechamento da proposta linkada a este projeto no CRM. Existe
// para o workspace (client) poder mostrar o mesmo cartão que a página
// /projetos/[codigo]/fechamento monta no servidor.
import { NextResponse } from "next/server";
import { fetchFechamentosDoProjeto, cpmcExiste } from "@/lib/crm-fechamento";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const codigo = new URL(req.url).searchParams.get("codigo") || "";
  if (!codigo) return NextResponse.json({ error: "codigo obrigatório" }, { status: 400 });
  try {
    const fechamentos = await fetchFechamentosDoProjeto(codigo);
    const temCpmc = await Promise.all(fechamentos.map((f) => cpmcExiste(f.cpmcUrl)));
    return NextResponse.json({ fechamentos, temCpmc });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
