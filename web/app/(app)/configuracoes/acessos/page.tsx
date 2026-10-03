import { supaServer } from "@/lib/supabase-server";
import UsuariosAcessos from "@/components/UsuariosAcessos";

export const dynamic = "force-dynamic";

export default async function UsuariosAcessosPage() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  const { data: me } = await supa.schema("platform" as never).from("user_profiles")
    .select("is_admin").eq("id", user?.id ?? "").maybeSingle();
  if ((me as { is_admin?: boolean } | null)?.is_admin !== true) {
    return (
      <div className="max-w-2xl mx-auto mt-16 bg-ww-panel rounded-xl border border-ww-border p-8 text-center">
        <h1 className="text-xl font-semibold text-ww-text mb-1">Acesso restrito</h1>
        <p className="text-sm text-ww-textMuted">Usuários e acessos é só para administradores.</p>
      </div>
    );
  }
  return <UsuariosAcessos meuId={user?.id ?? ""} />;
}
