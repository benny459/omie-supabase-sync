// Provisionado × Real (08/10/26 — financeiro-fluxo-v3-SPEC, P1). Ver sql/141.
// GET → mapa ref → { nat: provisionado|real, serie, ult {nf,data}, media3, conf } dos títulos
//       recorrentes / estimados em aberto (Títulos a Pagar desenha selo, média e botão)
// POST { acao: "confirmar", empresa, cod_titulo | pagar_id, tipo_doc, numero_doc, valor_real, venc_real?, emissao (obrigatória), codigo_barras?, chave_nfe?, escopo, motivo? }
//      { acao: "desfazer", id }
// Permissão: financeiro.editar_titulo (a mesma do "+ Nova conta"). Erro da regra → 422 com a mensagem.
import { NextResponse } from "next/server";
import { exigir, fin } from "@/lib/financeiro-baixas";

export const runtime = "nodejs";

const msg = (e: { message?: string }) => String(e.message ?? e).replace(/^.*?ERROR:\s*/, "");

export async function GET() {
  const a = await exigir("financeiro.ver_pagar");
  if (a instanceof NextResponse) return a;
  const { data, error } = await fin().rpc("pagar_provisoes");
  if (error) return NextResponse.json({ error: msg(error) }, { status: 500 });
  return NextResponse.json({ provisoes: data ?? {}, pode: !!a.pode["financeiro.editar_titulo"] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const a = await exigir("financeiro.editar_titulo");
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.acao === "confirmar") {
    const { acao: _x, ...p } = b;
    const { data, error } = await fin().rpc("provisao_confirmar", { p, p_usuario: a.email });
    return error ? NextResponse.json({ error: msg(error) }, { status: 422 }) : NextResponse.json(data);
  }
  if (b.acao === "desfazer" && Number(b.id) > 0) {
    const { data, error } = await fin().rpc("provisao_desfazer", { p_id: Number(b.id), p_usuario: a.email });
    return error ? NextResponse.json({ error: msg(error) }, { status: 422 }) : NextResponse.json(data);
  }
  return NextResponse.json({ error: "ação inválida" }, { status: 400 });
}
