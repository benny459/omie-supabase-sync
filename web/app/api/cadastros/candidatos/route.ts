// GET /api/cadastros/candidatos?razao=&doc=&cidade=&telefone=&email=&excluir=
// "Já existe?" enquanto se digita (sql/59): mesmo CNPJ/CPF em qualquer empresa do
// grupo, ou nome parecido (+ cidade/telefone/e-mail). forte = é a mesma pessoa.
import { NextResponse } from "next/server";
import { exigirCadastros, rpcCad, erroCad } from "@/lib/cadastros-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  const p: Record<string, string> = {};
  for (const k of ["razao", "fantasia", "doc", "cidade", "telefone", "email", "excluir", "empresa"]) {
    const v = (sp.get(k) ?? "").trim();
    if (v) p[k] = v.slice(0, 200);
  }
  if (!p.razao && !p.fantasia && !p.doc) return NextResponse.json({ candidatos: [] });
  try {
    return NextResponse.json({ candidatos: await rpcCad("cadastros_candidatos", { p }) });
  } catch (e) { return erroCad(e); }
}
