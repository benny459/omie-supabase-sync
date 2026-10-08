import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// "/mockup" é público APENAS em desenvolvimento: é a tela de aprovação de
// desenho, sem dado real. Em produção ela cai no login como qualquer outra —
// deixar aberta em prod seria expor layout interno sem motivo.
// /api/compras/rc, /api/vendas/crm, /api/catalogo/crm e /api/crm/erp: servidor-a-servidor (CRM), protegidas por COMPRAS_RC_SECRET na própria rota.
// /auth/handoff: login único vindo do portal (chega sem sessão, com passe de uso único).
const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/handoff", "/recover", "/reset", "/api/cron", "/api/compras/rc", "/api/compras/alerta", "/api/compras/email/entrada", "/api/vendas/crm", "/api/cadastros/sync", "/api/aparencia/sync", "/api/catalogo/crm", "/api/crm/erp",
  ...(process.env.NODE_ENV === "development" ? ["/mockup"] : [])];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(pairs) {
          pairs.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          pairs.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // 08/10/26 — getClaims() em vez de getUser(): o projeto assina os JWT com chave
  // ASSIMÉTRICA (ES256, JWKS em /auth/v1/.well-known/jwks.json), então a assinatura é
  // conferida aqui mesmo, com a chave pública em cache (10 min, por instância) — sem a ida
  // ao Supabase Auth a cada request. Token vencido: getClaims chama getSession, que renova
  // a sessão pelo refresh token e grava os cookies novos (setAll acima), como antes.
  // O que ele NÃO vê é sessão revogada antes de o token vencer (≤ 1 h): por isso as rotas
  // que gravam continuam a validar com getUser() no servidor (loadPerms, exigirCompras,
  // set-status…). Aqui é só o porteiro: quem não tem sessão vai para o /login.
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims ?? null;
  const user = claims?.sub ? { id: claims.sub, user_metadata: (claims.user_metadata ?? {}) as Record<string, unknown> } : null;

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + "/"));

  // API sem sessão: 401 em JSON (o fetch da tela trata), não o HTML do /login.
  if (!user && !isPublic && pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Acesso com senha provisória (05/10/26): até criar a própria senha, tudo leva
  // a /reset (que limpa a marca ao gravar). APIs ficam de fora.
  if (user && user.user_metadata?.must_change_password === true && !pathname.startsWith("/api/") && pathname !== "/reset") {
    const url = request.nextUrl.clone();
    url.pathname = "/reset";
    url.search = "?primeiro=1";
    return NextResponse.redirect(url);
  }

  // Evita que usuário autenticado fique no /login
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = request.nextUrl.searchParams.get("next") || "/avulsos";
    url.searchParams.delete("next");
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
