// GET  /api/cadastros?papel=cliente|fornecedor&emp=SF&q=&todos=1&off=0  → lista
// POST /api/cadastros  { ...pessoa }                                     → cria
import { NextResponse } from "next/server";
import { exigirCadastros, rpcCad, erroCad } from "@/lib/cadastros-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  const pp = sp.get("papel"); const papel = pp === "fornecedor" || pp === "cliente" || pp === "transportadora" ? pp : "todos";
  try {
    const r = await rpcCad("cadastros_listar", {
      p_papel: papel, p_empresa: (sp.get("emp") ?? "SF").toUpperCase(), p_q: (sp.get("q") ?? "").trim() || null,
      p_ativos: sp.get("todos") !== "1", p_lim: 50, p_off: Math.max(0, Number(sp.get("off")) || 0),
    });
    return NextResponse.json({ ...(r as object), podeEditar: q.editar });
  } catch (e) { return erroCad(e); }
}

export async function POST(req: Request) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  if (!q.editar) return NextResponse.json({ error: "Sem permissão para cadastrar" }, { status: 403 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    delete body.id;
    // Criar mesmo havendo um cadastro parecido: só administrador, e com motivo (fica no histórico).
    if (!q.perms.is_admin) { delete body.forcar; delete body.forcarMotivo; }
    return NextResponse.json(await rpcCad("cadastros_salvar", { p: body, p_por: q.email }));
  } catch (e) { return erroCad(e); }
}
