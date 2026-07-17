"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { supaBrowser } from "@/lib/supabase";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  tone: string;
};

const MODULES: NavItem[] = [
  {
    href: "/avulsos",
    label: "Avulsos",
    tone: "text-sky-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2"/>
        <path d="M3 10h18M9 4v16"/>
      </svg>
    ),
  },
  {
    href: "/projetos",
    label: "Projetos",
    tone: "text-violet-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/>
      </svg>
    ),
  },
  {
    href: "/pcs",
    label: "PCs Standalone",
    tone: "text-amber-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
        <path d="M14 2v6h6M8 13h8M8 17h5"/>
      </svg>
    ),
  },
  {
    href: "/relatorios",
    label: "Relatórios",
    tone: "text-emerald-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18"/>
        <path d="M7 14l4-4 4 4 5-5"/>
      </svg>
    ),
  },
];

const ADMIN: NavItem[] = [
  {
    href: "/configuracoes",
    label: "Configurações",
    tone: "text-slate-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.33.22.69.22 1.06 0 .37-.08.73-.22 1.06z"/>
      </svg>
    ),
  },
];

export default function AppSidebar({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  // Rota pra qual o usuário acabou de clicar — usado pra dar feedback visual
  // imediato no link enquanto o server-render da próxima rota termina.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Quando o pathname muda → terminou a navegação, limpa o pending.
  useEffect(() => { setPendingHref(null); }, [pathname]);

  // Prefetch de todas as rotas de módulo na primeira render — navegação fica instantânea
  useEffect(() => {
    MODULES.forEach((m) => router.prefetch(m.href));
    ADMIN.forEach((m) => router.prefetch(m.href));
  }, [router]);

  function navigate(href: string) {
    if (href === pathname) return;
    setPendingHref(href);
    setOpen(false);
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    startTransition(() => { router.push(href); });
  }

  function openNow() {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  }
  function closeSoon() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 200);
  }

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  async function signOut() {
    const supa = supaBrowser();
    await supa.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <>
      {/* Zona invisível à esquerda — "puxa" a sidebar quando o mouse chega */}
      <div
        className="fixed top-0 left-0 h-screen w-2 z-20"
        onMouseEnter={openNow}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        className={`fixed top-0 left-0 h-screen bg-ww-panel border-r border-ww-border flex flex-col transition-[width,box-shadow] duration-200 ease-out z-30 ${
          open ? "w-[220px] shadow-xl" : "w-[54px] shadow-none"
        }`}
      >
        {/* Header: logo WaterWorks */}
        <div className="h-14 flex items-center px-2 border-b border-ww-border">
          <Link href="/" className="flex items-center gap-2 flex-1 min-w-0">
            <img
              src="/logo-waterworks.svg"
              alt="WaterWorks"
              className="w-9 h-9 object-contain shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className={`font-semibold text-ww-text tracking-tight text-sm whitespace-nowrap overflow-hidden transition-opacity duration-150 ${
              open ? "opacity-100" : "opacity-0"
            }`}>
              WaterWorks
            </span>
          </Link>
        </div>

        {/* Módulos + Admin */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
          <SectionLabel text="Módulos" open={open} />
          {MODULES.map((t) => (
            <SideLink key={t.href} item={t} active={pathname === t.href} open={open}
                      pending={pendingHref === t.href} onNavigate={navigate} />
          ))}

          <div className="h-3" />
          <SectionLabel text="Sistema" open={open} />
          {ADMIN.map((t) => (
            <SideLink key={t.href} item={t} active={pathname === t.href} open={open}
                      pending={pendingHref === t.href} onNavigate={navigate} />
          ))}
          {(userEmail ?? "").toLowerCase() === "benny@waterworks.com.br" && (
            <SideLink
              item={{
                href: "/owner",
                label: "Owner",
                tone: "text-emerald-700",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18" />
                    <path d="M7 14l4-4 4 4 5-5" />
                    <circle cx="20" cy="5" r="2" />
                  </svg>
                ),
              }}
              active={pathname === "/owner"}
              open={open}
              pending={pendingHref === "/owner"}
              onNavigate={navigate}
            />
          )}
        </nav>

        {/* Footer: user + alterar senha + sair */}
        <div className="border-t border-slate-200 p-2">
          {userEmail && open && (
            <div className="px-2 py-1 text-[10px] text-ww-textFaint truncate" title={userEmail}>
              {userEmail}
            </div>
          )}
          {open && process.env.NEXT_PUBLIC_APP_VERSION && (
            <div className="px-2 pb-1 text-[9px] text-ww-textFaint tabular-nums">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </div>
          )}
          <button
            onClick={() => setPwOpen(true)}
            title="Alterar senha"
            className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-ww-textMuted hover:bg-ww-rowHover hover:text-ww-text transition text-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span className={`transition-opacity duration-150 ${open ? "opacity-100" : "opacity-0"}`}>Alterar senha</span>
          </button>
          <button
            onClick={signOut}
            title="Sair"
            className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-ww-textMuted hover:bg-ww-rowHover hover:text-ww-text transition text-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>
            </svg>
            <span className={`transition-opacity duration-150 ${open ? "opacity-100" : "opacity-0"}`}>Sair</span>
          </button>
        </div>
      </aside>

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </>
  );
}

function SectionLabel({ text, open }: { text: string; open: boolean }) {
  if (!open) return <div className="h-2" />;
  return (
    <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ww-textFaint">
      {text}
    </div>
  );
}

function SideLink({
  item, active, open, pending, onNavigate,
}: {
  item: NavItem; active: boolean; open: boolean; pending: boolean;
  onNavigate: (href: string) => void;
}) {
  return (
    <Link
      href={item.href}
      title={item.label}
      prefetch={true}
      onClick={(e) => { e.preventDefault(); onNavigate(item.href); }}
      className={`flex items-center gap-3 px-2 py-2 rounded-lg transition text-sm whitespace-nowrap ${
        active
          ? "bg-ww-accentSoft text-ww-accent font-semibold"
          : pending
            ? "bg-ww-rowHover text-ww-text"
            : "text-ww-textMuted hover:bg-ww-rowHover hover:text-ww-text"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-ww-accent" : pending ? "text-ww-text" : "text-ww-textFaint"}`}>
        {pending ? (
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 animate-spin" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.2-8.55" />
          </svg>
        ) : item.icon}
      </span>
      <span className={`overflow-hidden transition-opacity duration-150 ${open ? "opacity-100" : "opacity-0"}`}>
        {item.label}
      </span>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ChangePasswordModal — usuário muda a própria senha (Supabase Auth)
// ─────────────────────────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw1.length < 8) { setErr("Senha precisa ter ao menos 8 caracteres."); return; }
    if (pw1 !== pw2)    { setErr("As duas senhas não conferem."); return; }
    setBusy(true);
    const supa = supaBrowser();
    const { error } = await supa.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk(true);
    setTimeout(onClose, 1400);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-ww-panel rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-4 border border-ww-border">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-ww-text">Alterar senha</h3>
            <p className="text-xs text-ww-textMuted mt-0.5">Mínimo 8 caracteres. Use uma senha forte.</p>
          </div>
          <button type="button" onClick={onClose} className="text-ww-textMuted hover:text-ww-text text-lg leading-none">×</button>
        </div>

        <div className="space-y-2">
          <div>
            <label className="block text-[11px] font-medium text-ww-textMuted mb-1">Nova senha</label>
            <input type={show ? "text" : "password"} required autoFocus
              value={pw1} onChange={(e) => setPw1(e.target.value)}
              className="w-full px-3 py-2 border border-ww-border bg-ww-bg rounded-md text-sm text-ww-text focus:outline-none focus:ring-2 focus:ring-ww-accent/40" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ww-textMuted mb-1">Confirme a nova senha</label>
            <input type={show ? "text" : "password"} required
              value={pw2} onChange={(e) => setPw2(e.target.value)}
              className="w-full px-3 py-2 border border-ww-border bg-ww-bg rounded-md text-sm text-ww-text focus:outline-none focus:ring-2 focus:ring-ww-accent/40" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-ww-textMuted cursor-pointer select-none">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Mostrar senhas
          </label>
        </div>

        {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}
        {ok  && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">Senha alterada ✓</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-ww-textMuted hover:bg-ww-rowHover rounded-md transition">Cancelar</button>
          <button type="submit" disabled={busy || ok} className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md shadow-sm transition disabled:opacity-40">
            {busy ? "Salvando…" : ok ? "Salvo" : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
