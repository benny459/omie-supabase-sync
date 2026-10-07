// /api/cadastros/grupos-equipamento (07/10/26, sql/100) — cadastro dos grupos de equipamento.
//  GET                                   → { grupos, emUso, pendente?, podeEditar }
//  POST { id?, nome, descricao?, ativo? } → cria/edita (inativar = ativo:false)
import { NextResponse } from "next/server";
import { exigirCadastros } from "@/lib/cadastros-server";
import { gruposEmUso, lerCadastroGrupos, salvarGrupo } from "@/lib/grupos-equipamento";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  try {
    const [grupos, emUso] = await Promise.all([lerCadastroGrupos(true), gruposEmUso()]);
    return NextResponse.json({ grupos: grupos ?? [], pendente: grupos == null, emUso, podeEditar: q.editar });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); }
}

export async function POST(req: Request) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  if (!q.editar) return NextResponse.json({ error: "Sem permissão para cadastrar" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { id?: number; nome?: string; descricao?: string | null; ativo?: boolean };
  try {
    await salvarGrupo({ id: b.id ?? null, nome: String(b.nome ?? ""), descricao: b.descricao ?? null, ativo: b.ativo, por: q.email });
    return NextResponse.json({ ok: true });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}
