// GET /api/cadastros/:id  → cadastro + ficha (o que a pessoa pode ver)
// PUT /api/cadastros/:id  → edita
import { NextResponse } from "next/server";
import { exigirCadastros, rpcCad, erroCad, filtrarFicha } from "@/lib/cadastros-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Pessoa = { id: number; cliente: boolean; fornecedor: boolean; transportadora: boolean } & Record<string, unknown>;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  try {
    const p = await rpcCad<Pessoa | null>("cadastros_obter", { p_id: id });
    if (!p) return NextResponse.json({ error: "Cadastro não encontrado" }, { status: 404 });
    const [cli, forn] = await Promise.all([
      p.cliente ? rpcCad<Record<string, unknown>>("cadastros_ficha_cliente", { p_id: id }) : null,
      p.fornecedor || p.transportadora ? rpcCad<Record<string, unknown>>("cadastros_ficha_fornecedor", { p_id: id }) : null,
    ]);
    return NextResponse.json({
      pessoa: p, podeEditar: q.editar,
      cliente: cli ? filtrarFicha("cliente", cli, q) : null,
      fornecedor: forn ? filtrarFicha("fornecedor", forn, q) : null,
      pode: { receber: q.pode["financeiro.ver_receber"], pagar: q.pode["financeiro.ver_pagar"], valores: q.pode["compras.ver_valores"] },
    });
  } catch (e) { return erroCad(e); }
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  if (!q.editar) return NextResponse.json({ error: "Sem permissão para editar cadastros" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    delete body.forcar; delete body.forcarMotivo;
    return NextResponse.json(await rpcCad("cadastros_salvar", { p: { ...body, id }, p_por: q.email }));
  } catch (e) { return erroCad(e); }
}
