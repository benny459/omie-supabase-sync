"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ROLE_LABELS, type Role, type PermsOverride } from "@/lib/permissions";

const MODULOS_LIST = [
  { key: "avulsos",  label: "Avulsos",         tone: "bg-blue-50 text-blue-900" },
  { key: "projetos", label: "Projetos",        tone: "bg-violet-50 text-violet-900" },
  { key: "pcs",      label: "PCs Standalone",  tone: "bg-amber-50 text-amber-900" },
] as const;
type ModuloKey = typeof MODULOS_LIST[number]["key"];

type ModuleRoleRow = {
  modulo: ModuloKey;
  can_edit_pv: boolean;
  can_edit_rc: boolean;
  can_edit_pc: boolean;
  can_approve: boolean;
  can_edit_log: boolean;
  approval_ceiling_brl: number | null;
  weekly_budget_brl: number | null;
};

type UserRow = {
  id: string;
  email: string | null;
  nome: string | null;
  role?: Role | null;
  is_admin: boolean | null;
  ativo: boolean | null;
  permissions?: PermsOverride | null;
  created_at: string | null;
};

export default function UsersAdmin({
  initialUsers,
  currentUserId,
}: {
  initialUsers: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[]>(initialUsers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ email: string; password: string } | null>(null);
  const [permsForUser, setPermsForUser] = useState<UserRow | null>(null);

  async function handleInviteSuccess(res: { email: string; password: string; userId: string; nome: string | null; role: Role }) {
    setInviteResult({ email: res.email, password: res.password });
    // Adiciona localmente
    setUsers((u) => [{
      id: res.userId, email: res.email, nome: res.nome,
      role: res.role, is_admin: res.role === "admin",
      ativo: true, permissions: null, created_at: new Date().toISOString(),
    }, ...u]);
    router.refresh();
  }

  async function updateUser(userId: string, patch: { role?: Role; is_admin?: boolean; permissions?: PermsOverride | null }) {
    const r = await fetch("/api/admin/update-permissions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...patch }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Erro: ${j.error ?? r.statusText}`);
      return false;
    }
    setUsers((u) => u.map(x => x.id === userId ? {
      ...x,
      ...(patch.role ? { role: patch.role, is_admin: patch.role === "admin" } : {}),
      ...(typeof patch.is_admin === "boolean" ? { is_admin: patch.is_admin, role: patch.is_admin ? "admin" : (x.role ?? "viewer") } : {}),
      ...(patch.permissions !== undefined ? { permissions: patch.permissions } : {}),
    } : x));
    router.refresh();
    return true;
  }

  async function resetPassword(u: UserRow) {
    if (!confirm(`Gerar uma nova senha provisória para ${u.nome || u.email}? A senha atual será invalidada.`)) return;
    const r = await fetch("/api/admin/reset-password", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: u.id }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(`Erro: ${j.error ?? r.statusText}`); return; }
    setInviteResult({ email: u.email ?? "", password: j.password });
  }

  async function deleteUser(userId: string) {
    if (!confirm("Deletar este usuário? A ação não pode ser desfeita.")) return;
    const r = await fetch("/api/admin/delete-user", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Erro: ${j.error ?? r.statusText}`);
      return;
    }
    setUsers((u) => u.filter(x => x.id !== userId));
    router.refresh();
  }

  return (
    <>
      <div className="px-5 py-2.5 border-b border-slate-200 bg-white flex items-center justify-end">
        <button
          onClick={() => setInviteOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg shadow-sm transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Convidar usuário
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 bg-slate-50/50">
              <th className="px-5 py-2 font-semibold">Nome</th>
              <th className="px-3 py-2 font-semibold">Email</th>
              <th className="px-3 py-2 font-semibold text-center">Admin</th>
              <th className="px-3 py-2 font-semibold">Permissões</th>
              <th className="px-3 py-2 font-semibold">Criado</th>
              <th className="px-3 py-2 font-semibold text-right pr-5">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              const isAdmin = u.is_admin === true;
              return (
                <tr key={u.id} className="hover:bg-slate-50/60 transition">
                  <td className="px-5 py-2.5 text-slate-900 font-medium">
                    {u.nome || <span className="text-slate-400 italic">—</span>}
                    {isSelf && <span className="ml-2 text-[9px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full">você</span>}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 text-[11px]">{u.email ?? "—"}</td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => updateUser(u.id, { is_admin: !isAdmin })}
                      disabled={isSelf}
                      title={isSelf ? "Não pode rebaixar a si mesmo" : isAdmin
                        ? "Admin tem bypass total. Clique pra remover."
                        : "Marcar como admin (bypass total das permissões)"}
                      className={`inline-flex items-center justify-center w-12 h-6 rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed ${
                        isAdmin
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                      }`}
                    >
                      {isAdmin ? "✓ ADM" : "—"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => setPermsForUser(u)}
                      className="text-[11px] font-medium text-sky-700 hover:text-sky-900 hover:underline underline-offset-2"
                    >
                      {isAdmin ? "Bypass total (admin)" : "Configurar por solução"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 text-slate-500 text-[11px]">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right pr-5">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => resetPassword(u)}
                        className="text-slate-400 hover:text-amber-600 transition p-1"
                        title="Gerar nova senha provisória"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="10" rx="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                          <circle cx="12" cy="16" r="1"/>
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteUser(u.id)}
                        disabled={isSelf}
                        className="text-slate-400 hover:text-rose-600 transition p-1 disabled:opacity-30 disabled:cursor-not-allowed"
                        title={isSelf ? "Não pode deletar a si mesmo" : "Deletar usuário"}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-400 italic text-sm">
                  Nenhum usuário cadastrado. Clique em <strong>Convidar usuário</strong> pra começar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {inviteOpen && (
        <InviteModal
          onClose={() => { setInviteOpen(false); setInviteResult(null); }}
          onSuccess={(res) => { setInviteOpen(false); handleInviteSuccess(res); }}
        />
      )}

      {inviteResult && !inviteOpen && (
        <InvitePasswordModal
          email={inviteResult.email}
          password={inviteResult.password}
          onClose={() => setInviteResult(null)}
        />
      )}

      {permsForUser && (
        <PermissionsModal
          user={permsForUser}
          onClose={() => setPermsForUser(null)}
          onSaved={() => { setPermsForUser(null); router.refresh(); }}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Modal: Convidar usuário
// ─────────────────────────────────────────────────────────────────────────

function InviteModal({
  onClose, onSuccess,
}: {
  onClose: () => void;
  onSuccess: (res: { email: string; password: string; userId: string; nome: string | null; role: Role }) => void;
}) {
  const [email, setEmail] = useState("");
  const [nome, setNome]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/invite", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, nome, role: "viewer" }),
    });
    setBusy(false);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(data.error ?? r.statusText); return; }
    onSuccess(data);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4"
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Convidar usuário</h3>
            <p className="text-xs text-slate-500 mt-0.5">O sistema cria a conta e mostra uma senha provisória pra você enviar por email.</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-800 text-lg leading-none">×</button>
        </div>

        <div className="space-y-2">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Email</label>
            <input
              type="email" required autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@waterworks.com.br"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">Nome (opcional)</label>
            <input
              type="text" value={nome} onChange={(e) => setNome(e.target.value)}
              placeholder="Maria Silva"
              className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/40"
            />
          </div>
          <div className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            O usuário será criado <strong className="text-slate-700">sem permissões</strong>. Após criar, clique em <strong className="text-slate-700">Configurar por solução</strong> na lista pra liberar Editar RC / PC / Aprovar / Logística em cada solução. Marque <strong className="text-slate-700">Admin</strong> só pra dar bypass total.
          </div>
        </div>

        {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md transition">Cancelar</button>
          <button type="submit" disabled={busy || !email.includes("@")} className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md shadow-sm transition disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? "Criando…" : "Criar conta"}
          </button>
        </div>
      </form>
    </div>
  );
}

function InvitePasswordModal({
  email, password, onClose,
}: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(`Email: ${email}\nSenha provisória: ${password}`);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-slate-900">✓ Usuário criado</h3>
          <p className="text-xs text-slate-500 mt-0.5">Copie a senha provisória e envie ao usuário. Ele deve trocá-la no primeiro acesso.</p>
        </div>
        <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-2  text-xs">
          <div><span className="text-slate-500">Email: </span><span className="text-slate-900">{email}</span></div>
          <div><span className="text-slate-500">Senha: </span><span className="text-slate-900 select-all">{password}</span></div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={copy} className="px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 rounded-md transition">
            {copied ? "✓ Copiado" : "Copiar dados"}
          </button>
          <button onClick={onClose} className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Modal: Permissões por módulo (platform.user_module_roles)
// ─────────────────────────────────────────────────────────────────────────

function blank(modulo: ModuloKey): ModuleRoleRow {
  return {
    modulo,
    can_edit_pv: false, can_edit_rc: false, can_edit_pc: false,
    can_approve: false, can_edit_log: false,
    approval_ceiling_brl: null, weekly_budget_brl: null,
  };
}

function PermissionsModal({
  user, onClose, onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<Record<ModuloKey, ModuleRoleRow>>({
    avulsos:  blank("avulsos"),
    projetos: blank("projetos"),
    pcs:      blank("pcs"),
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      const r = await fetch(`/api/admin/user-roles?userId=${user.id}`);
      const j = await r.json().catch(() => ({}));
      if (!on) return;
      if (!r.ok) { setErr(j.error ?? "Falha ao carregar"); setLoading(false); return; }
      const map: Record<ModuloKey, ModuleRoleRow> = {
        avulsos: blank("avulsos"), projetos: blank("projetos"), pcs: blank("pcs"),
      };
      for (const r of (j.roles ?? []) as ModuleRoleRow[]) {
        if (r.modulo in map) map[r.modulo] = { ...blank(r.modulo), ...r };
      }
      setRows(map);
      setLoading(false);
    })();
    return () => { on = false; };
  }, [user.id]);

  function update(mod: ModuloKey, patch: Partial<ModuleRoleRow>) {
    setRows((p) => ({ ...p, [mod]: { ...p[mod], ...patch } }));
  }

  async function save() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/user-roles", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id, roles: Object.values(rows) }),
    });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error ?? r.statusText); return; }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-xl shadow-2xl max-w-4xl w-full p-5 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Permissões — {user.nome || user.email}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Marque o que esse usuário pode fazer em cada solução. Em PCs Standalone, defina alçada e teto semanal pra liberar autonomia controlada.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-800 text-lg leading-none">×</button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-400">Carregando…</div>
        ) : (
          <div className="space-y-3">
            {MODULOS_LIST.map(({ key, label, tone }) => {
              const r = rows[key];
              return (
                <div key={key} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b border-slate-200 ${tone}`}>
                    {label}
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      <Toggle label="Editar PV"      value={r.can_edit_pv}  onChange={(v) => update(key, { can_edit_pv: v })} />
                      <Toggle label="Editar RC"      value={r.can_edit_rc}  onChange={(v) => update(key, { can_edit_rc: v })} />
                      <Toggle label="Editar PC"      value={r.can_edit_pc}  onChange={(v) => update(key, { can_edit_pc: v })} />
                      <Toggle label="Aprovar"        value={r.can_approve}  onChange={(v) => update(key, { can_approve: v })} />
                      <Toggle label="Editar Logíst." value={r.can_edit_log} onChange={(v) => update(key, { can_edit_log: v })} />
                    </div>
                    {key === "pcs" && r.can_approve && (
                      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                        <BrlInput label="Alçada por aprovação"
                          hint="Valor máximo de UM PC. Acima disso a aprovação é bloqueada."
                          value={r.approval_ceiling_brl}
                          onChange={(v) => update(key, { approval_ceiling_brl: v })} />
                        <BrlInput label="Teto semanal (rolling 7d)"
                          hint="Soma máxima aprovada nos últimos 7 dias."
                          value={r.weekly_budget_brl}
                          onChange={(v) => update(key, { weekly_budget_brl: v })} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-md transition">Cancelar</button>
          <button onClick={save} disabled={busy || loading} className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition disabled:opacity-40">
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border-2 text-[12px] font-semibold transition ${
        value
          ? "bg-emerald-50 border-emerald-500 text-emerald-900"
          : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
      }`}>
      <span>{label}</span>
      <span className={`text-[14px] ${value ? "text-emerald-600" : "text-slate-300"}`}>{value ? "●" : "○"}</span>
    </button>
  );
}

function BrlInput({ label, hint, value, onChange }: { label: string; hint?: string; value: number | null; onChange: (v: number | null) => void }) {
  const [str, setStr] = useState(value != null ? String(value).replace(".", ",") : "");
  useEffect(() => { setStr(value != null ? String(value).replace(".", ",") : ""); }, [value]);
  return (
    <div>
      <label className="block text-[11px] font-semibold text-slate-700 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-bold text-slate-400">R$</span>
        <input type="text" inputMode="decimal" placeholder="sem limite"
          value={str}
          onChange={(e) => setStr(e.target.value)}
          onBlur={() => {
            const n = Number(str.replace(/\./g, "").replace(",", "."));
            onChange(str.trim() === "" ? null : (Number.isFinite(n) ? n : null));
          }}
          className="flex-1 px-2 py-1.5 text-[12px] border border-slate-300 rounded-md font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-sky-500/40" />
      </div>
      {hint && <p className="text-[10px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}
