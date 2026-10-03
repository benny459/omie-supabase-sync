import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/avulsos";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(pairs) {
            pairs.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Login com Google (03/10/26): só entra quem já é da equipe no painel
      // (perfil ativo). Uma conta Google qualquer cria usuário no Supabase,
      // mas aqui é barrada e a sessão é encerrada.
      if (searchParams.get("via") === "google") {
        const { supaAdmin } = await import("@/lib/supabase-admin");
        const { data: perfil } = await supaAdmin()
          .schema("platform").from("user_profiles")
          .select("ativo").eq("id", data.user?.id ?? "").maybeSingle();
        if (!perfil || perfil.ativo === false) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?error=sem_acesso`);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
