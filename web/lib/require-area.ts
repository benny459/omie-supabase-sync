// Guarda de área no SERVIDOR.
//
// Filtrar o menu (AppSidebar) é UX, não segurança: a rota continua acessível
// por URL direta. Toda página de área restrita precisa chamar requireArea() —
// sem isso, esconder "Contas a Pagar" do menu não impede ninguém de digitar
// /financeiro/pagar no navegador.
//
// Uso numa page.tsx (server component):
//   export default async function Page() {
//     await requireArea("financeiro");
//     return <MinhaView />;
//   }

import { redirect } from "next/navigation";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea, type Area, type AreaAccess, type Role, type UserPerms } from "@/lib/permissions";

// Carrega as permissões do usuário logado (ou null se não houver sessão).
export async function loadPerms(): Promise<UserPerms | null> {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: areasRaw }] = await Promise.all([
    supa.schema("platform" as never).from("user_profiles")
      .select("role, is_admin").eq("id", user.id).maybeSingle(),
    supa.schema("platform" as never).from("user_area_access")
      .select("area, can_view").eq("user_id", user.id),
  ]);
  const row = profile as { role?: Role; is_admin?: boolean } | null;
  return {
    id: user.id,
    role: row?.role ?? (row?.is_admin ? "admin" : "viewer"),
    is_admin: !!row?.is_admin,
    area_access: (areasRaw ?? []) as AreaAccess[],
  };
}

// Redireciona quem não tem a área. Sem sessão → /login; sem permissão → home,
// e NÃO uma página de erro: expor "existe algo aqui que você não pode ver" já é
// informação. Chamar no topo da page.tsx, antes de qualquer fetch de dado.
export async function requireArea(area: Area): Promise<UserPerms> {
  const perms = await loadPerms();
  if (!perms) redirect("/login");
  if (!canViewArea(perms, area)) redirect("/");
  return perms;
}
