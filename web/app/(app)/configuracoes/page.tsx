import { supaServer } from "@/lib/supabase-server";
import UsersAdmin from "@/components/UsersAdmin";
import SyncPanel from "@/components/SyncPanel";
import RunDetailsPanel from "@/components/RunDetailsPanel";
import FetchOmieButton from "@/components/FetchOmieButton";
import QuickRunButtons from "@/components/QuickRunButtons";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();

  // Checa se é admin
  const { data: me } = await supa
    .schema("platform" as never)
    .from("user_profiles")
    .select("is_admin, nome, email")
    .eq("id", user?.id ?? "")
    .maybeSingle();

  const isAdmin = (me as { is_admin?: boolean } | null)?.is_admin === true;

  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto mt-16 bg-ww-panel rounded-xl border border-ww-border shadow-sm p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 mx-auto flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-ww-text mb-1">Acesso restrito</h1>
        <p className="text-sm text-ww-textMuted">As configurações só estão disponíveis para administradores.</p>
      </div>
    );
  }

  // Lista usuários — só admin passa daqui
  const { data: users } = await supa
    .schema("platform" as never)
    .from("user_profiles")
    .select("id, email, nome, is_admin, ativo, created_at")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6 max-w-[1200px]">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold text-ww-text tracking-tight">Configurações</h1>
          <p className="text-ww-textMuted text-sm mt-1">Administração de usuários, permissões e sincronização.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <QuickRunButtons />
          <FetchOmieButton />
          <a
            href="/configuracoes/tabelas"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-textMuted shadow-sm transition"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M3 5v14a9 3 0 0 0 18 0V5"/>
              <path d="M3 12a9 3 0 0 0 18 0"/>
            </svg>
            Browse de tabelas →
          </a>
        </div>
      </div>

      {/* Usuários */}
      <section className="bg-ww-panel rounded-xl border border-ww-border shadow-sm overflow-hidden">
        <header className="px-5 py-3 border-b border-ww-border bg-ww-rowHover/60 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ww-text">Usuários & Perfis</h2>
            <p className="text-xs text-ww-textMuted">Ativar/desativar acesso, promover a admin.</p>
          </div>
          <span className="text-[10px] font-medium text-ww-textMuted bg-ww-panel px-2 py-0.5 rounded-full border border-ww-border">
            {users?.length ?? 0} usuário(s)
          </span>
        </header>
        <UsersAdmin initialUsers={(users ?? []) as UserRow[]} currentUserId={user?.id ?? ""} />
      </section>

      {/* Painel de Sync — status individual dos workflows + horários */}
      <section className="bg-ww-panel rounded-xl border border-ww-border shadow-sm overflow-hidden">
        <header className="px-5 py-3 border-b border-ww-border bg-ww-rowHover/60">
          <h2 className="text-sm font-semibold text-ww-text">Workflows: horários e status</h2>
          <p className="text-xs text-ww-textMuted">
            Lê o YAML ao vivo no GitHub. Os horários abaixo são o que o GitHub Actions realmente vai disparar.
            Use <strong>Rodar agora</strong> pra disparar manualmente, <strong>Editar agenda</strong> pra mudar o cron pelo painel, ou edite direto em <code>.github/workflows/master_*.yml</code>.
          </p>
        </header>
        <SyncPanel />
      </section>

      {/* Detalhes de execução por função/script — fonte: sales.sync_state */}
      <section className="bg-ww-panel rounded-xl border border-ww-border shadow-sm overflow-hidden">
        <header className="px-5 py-3 border-b border-ww-border bg-ww-rowHover/60">
          <h2 className="text-sm font-semibold text-ww-text">Detalhes de execução por função</h2>
          <p className="text-xs text-ww-textMuted">Cada importer Python gravou: status, linhas inseridas/atualizadas, total, duração e mensagem. Use pra detectar erros silenciosos.</p>
        </header>
        <div className="p-5">
          <RunDetailsPanel />
        </div>
      </section>
    </div>
  );
}

type UserRow = {
  id: string;
  email: string | null;
  nome: string | null;
  is_admin: boolean | null;
  ativo: boolean | null;
  created_at: string | null;
};
