import AppSidebar from "@/components/AppSidebar";
import TopNav from "@/components/navy/TopNav";
import { permissoesDe } from "@/lib/acessos";
import SyncStatusBar from "@/components/SyncStatusBar";
import ThemeToggle from "@/components/ThemeToggle";
import SeletorPaleta from "@/components/viz/SeletorPaleta";
import { UserPermsProvider } from "@/components/UserPermsProvider";
import VersionWatcher from "@/components/VersionWatcher";
import BotaoCesar from "@/components/cesar/BotaoCesar";
import ReportsSalvos from "@/components/cesar/ReportsSalvos";
import SupportWidget from "@/components/SupportWidget";
import { supaServer } from "@/lib/supabase-server";
import type { AreaAccess, ModuleRole, PermsOverride, Role, UserPerms } from "@/lib/permissions";

/* Botão "Suporte" do canto inferior direito.
   Oculto em 28/09/2026 a pedido do Benny, para voltar mais à frente — trocar
   para true e está de volta, nada mais. (Já tinha sido desligado antes e
   reativado em 12/09/2026, junto do upgrade do Cesar.) */
const SUPORTE_VISIVEL = false;

/* Navegacao horizontal do Allka Navy. O handoff escolhe-a como padrao e o
   AppSidebar fica como alternativa — mas a troca mexe em quem ve o que, por
   isso vive num interruptor: false devolve a sidebar de sempre, sem deploy.
   As duas leem as MESMAS listas e o MESMO canViewArea; o que muda e o layout. */
const NAV_HORIZONTAL = true;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();

  let perms: UserPerms | null = null;
  if (user) {
    const [{ data: profile }, { data: rolesRaw }, { data: areasRaw }] = await Promise.all([
      supa.schema("platform" as never).from("user_profiles")
        .select("role, is_admin, permissions, ativo").eq("id", user.id).maybeSingle(),
      supa.schema("platform" as never).from("user_module_roles")
        .select("modulo, can_edit_pv, can_edit_rc, can_edit_pc, can_approve, can_edit_log, can_release_pv, approval_ceiling_brl, weekly_budget_brl")
        .eq("user_id", user.id),
      supa.schema("platform" as never).from("user_area_access")
        .select("area, can_view").eq("user_id", user.id),
    ]);
    const row = profile as { role?: Role; is_admin?: boolean; permissions?: PermsOverride | null; ativo?: boolean } | null;
    // Desativado em Usuários e acessos: não entra em tela nenhuma.
    if (row?.ativo === false) {
      return (
        <main className="min-h-screen bg-ww-bg text-ww-text flex items-center justify-center p-6">
          <div className="max-w-md text-center bg-ww-panel border border-ww-border rounded-xl p-8">
            <h1 className="text-lg font-semibold mb-1">Acesso desativado</h1>
            <p className="text-sm text-ww-textMuted">O seu acesso ao painel foi desativado. Fale com o administrador.</p>
          </div>
        </main>
      );
    }
    perms = {
      id: user.id,
      role: row?.role ?? (row?.is_admin ? "admin" : "viewer"),
      is_admin: !!row?.is_admin,
      permissions: row?.permissions ?? null,
      module_roles: (rolesRaw ?? []) as ModuleRole[],
      area_access: (areasRaw ?? []) as AreaAccess[],
    };
    try { perms.pode = await permissoesDe(perms); } catch { /* menu cai no comportamento por área */ }
  }

  return (
    <UserPermsProvider user={perms}>
      {NAV_HORIZONTAL ? <TopNav userEmail={user?.email} /> : <AppSidebar userEmail={user?.email} />}
      {/* A margem de 54px existe para o trilho da sidebar; sem sidebar nao ha
          trilho, e mante-la deixava uma faixa morta a esquerda. */}
      <main className={`${NAV_HORIZONTAL ? "" : "ml-[54px]"} min-h-screen bg-ww-bg text-ww-text overflow-x-hidden`}>
        {/* Barra superior: versão sempre visível + último sync + paleta + theme */}
        <div className="border-b border-ww-border bg-ww-panel/70 backdrop-blur px-4 md:px-6 py-1.5 flex items-center justify-end gap-3">
          <VersionWatcher />
          <SyncStatusBar />
          <BotaoCesar />
          <SeletorPaleta />
          <ThemeToggle />
        </div>
        <div className="p-4 md:p-6 min-w-0">
          {/* Menu "Reports do Cesar" no TOPO das telas de BI suportadas (v3).
              Montagem única aqui: o componente lê a pathname e só renderiza
              onde deve — em linha própria, sem sobrepor os botões da tela. */}
          <ReportsSalvos userEmail={user?.email} />
          {children}
        </div>
      </main>
      {SUPORTE_VISIVEL && (
        <SupportWidget
          user={user ? { email: user.email, nome: (user.user_metadata as { full_name?: string } | null)?.full_name || user.email } : null}
          isAdmin={!!perms?.is_admin}
        />
      )}
    </UserPermsProvider>
  );
}
