import "server-only";
import { supaServer } from "@/lib/supabase-server";

/**
 * Verifica se o caller é admin. Retorna o user se ok, ou resposta 401/403.
 */
export async function requireAdmin() {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) {
    return { error: new Response("Unauthorized", { status: 401 }), user: null };
  }
  const { data: me } = await supa
    .schema("platform" as never)
    .from("user_profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  const isAdmin = (me as { is_admin?: boolean } | null)?.is_admin === true;
  if (!isAdmin) {
    return { error: new Response("Forbidden — admin only", { status: 403 }), user: null };
  }
  return { error: null, user };
}
