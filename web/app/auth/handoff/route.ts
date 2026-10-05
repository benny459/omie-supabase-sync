import { NextResponse, type NextRequest } from "next/server";
import { supaServer } from "@/lib/supabase-server";

// Login único portal → painel (03/10/26, autorizado pelo Benny). O portal
// (allka.ai, mesmo Supabase) gerou um link de uso único para o utilizador;
// aqui ele vira sessão do painel. Destino só dentro do painel.
const DESTINOS = ["/avulsos", "/projetos", "/pcs", "/erp", "/estoque", "/financeiro", "/bi", "/relatorios", "/configuracoes", "/cadastros", "/faturamento"];

function destinoValido(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/avulsos";
  const caminho = next.split(/[?#]/)[0];
  return DESTINOS.some((p) => caminho === p || caminho.startsWith(p + "/")) ? next : "/avulsos";
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const next = destinoValido(searchParams.get("next"));

  if (tokenHash) {
    const supabase = await supaServer("public");
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (!error) {
      const res = NextResponse.redirect(`${origin}${next}`);
      res.headers.set("Cache-Control", "no-store");
      return res;
    }
  }
  // Passe inválido ou já usado: login normal, voltando ao destino depois.
  return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(next)}`);
}
