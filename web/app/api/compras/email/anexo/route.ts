// GET /api/compras/email/anexo?p=<caminho> — anexo recebido do fornecedor (bucket privado
// compras-emails), servido por URL assinada para quem tem acesso a Compras.
import { NextResponse } from "next/server";
import { exigirCompras } from "@/lib/compras-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirCompras();
  if (q instanceof NextResponse) return q;
  const p = new URL(req.url).searchParams.get("p") ?? "";
  if (!/^pc\/\d+\/[^/]+\/[^/]+$/.test(p) || p.includes("..")) return NextResponse.json({ error: "arquivo inválido" }, { status: 400 });
  const { data, error } = await supaAdmin().storage.from("compras-emails").createSignedUrl(p, 300, { download: true });
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Anexo não encontrado" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
