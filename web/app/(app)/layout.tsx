import AppSidebar from "@/components/AppSidebar";
import SyncStatusBar from "@/components/SyncStatusBar";
import ThemeToggle from "@/components/ThemeToggle";
import { UserPermsProvider } from "@/components/UserPermsProvider";
import VersionWatcher from "@/components/VersionWatcher";
import SupportWidget from "@/components/SupportWidget";
import { supaServer } from "@/lib/supabase-server";
import type { ModuleRole, PermsOverride, Role, UserPerms } from "@/lib/permissions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();

  let perms: UserPerms | null = null;
  if (user) {
    const [{ data: profile }, { data: rolesRaw }] = await Promise.all([
      supa.schema("platform" as never).from("user_profiles")
        .select("role, is_admin, permissions").eq("id", user.id).maybeSingle(),
      supa.schema("platform" as never).from("user_module_roles")
        .select("modulo, can_edit_pv, can_edit_rc, can_edit_pc, can_approve, can_edit_log, approval_ceiling_brl, weekly_budget_brl")
        .eq("user_id", user.id),
    ]);
    const row = profile as { role?: Role; is_admin?: boolean; permissions?: PermsOverride | null } | null;
    perms = {
      id: user.id,
      role: row?.role ?? (row?.is_admin ? "admin" : "viewer"),
      is_admin: !!row?.is_admin,
      permissions: row?.permissions ?? null,
      module_roles: (rolesRaw ?? []) as ModuleRole[],
    };
  }

  return (
    <UserPermsProvider user={perms}>
      <AppSidebar userEmail={user?.email} />
      <main className="ml-[54px] min-h-screen bg-ww-bg text-ww-text overflow-x-hidden">
        {/* Barra superior: versão sempre visível + último sync + theme */}
        <div className="border-b border-ww-border bg-ww-panel/70 backdrop-blur px-4 md:px-6 py-1.5 flex items-center justify-end gap-3">
          <VersionWatcher />
          <SyncStatusBar />
          <ThemeToggle />
        </div>
        <div className="p-4 md:p-6 min-w-0">{children}</div>
      </main>
      <SupportWidget
        user={user ? { email: user.email, nome: (user.user_metadata as { full_name?: string } | null)?.full_name || user.email } : null}
        isAdmin={!!perms?.is_admin}
      />
    </UserPermsProvider>
  );
}
