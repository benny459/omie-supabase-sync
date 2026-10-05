// GET   /api/cadastros/aux/:id → cadastro + histórico
// PATCH /api/cadastros/aux/:id → edita (nome, dados, inativo)
import { NextResponse } from "next/server";
import { exigirCadastros, rpcCad, erroCad } from "@/lib/cadastros-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  try {
    const r = await rpcCad("cad_aux_obter", { p_id: id });
    if (!r) return NextResponse.json({ error: "Cadastro não encontrado" }, { status: 404 });
    return NextResponse.json(r);
  } catch (e) { return erroCad(e); }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  if (!q.editar) return NextResponse.json({ error: "Sem permissão para editar cadastros" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (!q.perms.is_admin) { delete body.forcar; delete body.forcarMotivo; }
    // registro, empresa e código não mudam numa edição
    delete body.registro; delete body.empresa; delete body.codigo;
    return NextResponse.json(await rpcCad("cad_aux_salvar", { p: { ...body, id }, p_por: q.email }));
  } catch (e) { return erroCad(e); }
}
