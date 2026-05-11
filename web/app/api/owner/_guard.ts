// Guard de owner: SÓ benny@waterworks.com.br entra. Mais estrito que admin —
// nem outros admins veem essa rota.
import "server-only";
import { supaServer } from "@/lib/supabase-server";

export const OWNER_EMAIL = "benny@waterworks.com.br";

export async function requireOwner() {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) {
    return { error: new Response("Unauthorized", { status: 401 }), user: null };
  }
  if ((user.email ?? "").toLowerCase() !== OWNER_EMAIL) {
    return { error: new Response("Forbidden", { status: 403 }), user: null };
  }
  return { user, error: null };
}
