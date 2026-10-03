import { NextResponse, type NextRequest } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

// Login único painel → portal (03/10/26, autorizado pelo Benny). Gera para o
// próprio utilizador um link de uso único (nenhum e-mail é enviado) e manda
// para o /auth/handoff do portal. Só membros da WaterWorks no portal; destino
// só dentro de /w/waterworks.
const PORTAL = "https://allka.ai";

function destinoValido(next: string | null): string {
  if (!next || !next.startsWith("/w/waterworks") || next.includes("\\")) return "/w/waterworks";
  return next;
}

export async function GET(request: NextRequest) {
  const next = destinoValido(request.nextUrl.searchParams.get("next"));
  const semPasse = NextResponse.redirect(`${PORTAL}${next}`);

  const supabase = await supaServer("public");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) return semPasse;

  const admin = supaAdmin();
  const { data: membro } = await admin
    .from("tenant_members").select("role").eq("tenant_slug", "waterworks").eq("user_id", user.id).maybeSingle();
  const { data: perfil } = await admin
    .from("profiles").select("is_platform_admin").eq("user_id", user.id).maybeSingle();
  if (!membro && !perfil?.is_platform_admin) return semPasse;

  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return semPasse;

  const destino = new URL("/auth/handoff", PORTAL);
  destino.searchParams.set("token_hash", tokenHash);
  destino.searchParams.set("type", "magiclink");
  destino.searchParams.set("next", next);
  const res = NextResponse.redirect(destino);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
