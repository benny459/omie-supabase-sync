// GET /api/rc-projetos/grupos?codigo_projeto=… (07/10/26) — o que a faixa "Grupos de
// equipamento" da lista de materiais precisa: nomes padrão do cadastro (null = migração
// sql/100 pendente), nomes já usados nos projetos e o prazo da proposta do CRM para
// sugerir o "necessário em" dos grupos (a CP não traz data por equipamento).
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { gruposEmUso, lerCadastroGrupos, prazoDaProposta } from "@/lib/grupos-equipamento";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const codigo = Number(new URL(req.url).searchParams.get("codigo_projeto"));
  try {
    const [cadastro, emUso, prazo] = await Promise.all([
      lerCadastroGrupos(),
      gruposEmUso(),
      codigo > 0 ? prazoDaProposta(codigo).catch(() => ({ data: null, fonte: null, grupos: [] as string[] })) : Promise.resolve({ data: null, fonte: null, grupos: [] as string[] }),
    ]);
    return NextResponse.json({ cadastro: cadastro?.map((c) => c.nome) ?? null, emUso, prazo });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
