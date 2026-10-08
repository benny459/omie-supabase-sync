// Arquivo da nota na confirmação de provisão (08/10/26, sql/144).
// POST multipart { arquivo, empresa } → guarda no storage e lê os campos (XML direto; PDF/foto pela IA)
//      → { path, nome, dados, aviso }
// GET ?id=<confirmação>&i=<n> → redireciona para o arquivo n (0 = o primeiro; link assinado de 10 min)
import { NextResponse } from "next/server";
import { exigir, fin } from "@/lib/financeiro-baixas";
import { linkNota, receberNota } from "@/lib/provisao-doc";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const a = await exigir("financeiro.editar_titulo");
  if (a instanceof NextResponse) return a;
  const form = await req.formData().catch(() => null);
  const f = form?.get("arquivo");
  const empresa = String(form?.get("empresa") || "").toUpperCase();
  if (!(f instanceof File)) return NextResponse.json({ error: "Envie o arquivo da nota" }, { status: 400 });
  if (!/^(CD|SF|WW)$/.test(empresa)) return NextResponse.json({ error: "Empresa inválida" }, { status: 400 });
  try {
    return NextResponse.json(await receberNota(f, empresa));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 422 });
  }
}

export async function GET(req: Request) {
  const a = await exigir("financeiro.ver_pagar");
  if (a instanceof NextResponse) return a;
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!(id > 0)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
  const i = Math.max(0, Number(new URL(req.url).searchParams.get("i")) || 0);
  const { data, error } = await fin().from("provisao_confirmacoes").select("arquivo_path, arquivos").eq("id", id).maybeSingle();
  const lista = Array.isArray(data?.arquivos) && data.arquivos.length ? (data.arquivos as { path: string }[]).map((x) => x.path) : data?.arquivo_path ? [data.arquivo_path] : [];
  if (error || !lista[i]) return NextResponse.json({ error: "Esta confirmação não tem arquivo" }, { status: 404 });
  try {
    return NextResponse.redirect(await linkNota(lista[i]));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 404 });
  }
}
