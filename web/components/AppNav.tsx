"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { supaBrowser } from "@/lib/supabase";

const TABS = [
  { href: "/avulsos",  label: "Avulsos",  tone: "hover:bg-blue-50 data-[active=true]:bg-blue-100 data-[active=true]:text-blue-800" },
  { href: "/projetos", label: "Projetos", tone: "hover:bg-violet-50 data-[active=true]:bg-violet-100 data-[active=true]:text-violet-800" },
  { href: "/pcs",      label: "PCs Standalone", tone: "hover:bg-amber-50 data-[active=true]:bg-amber-100 data-[active=true]:text-amber-800" },
];

export default function AppNav({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();

  async function signOut() {
    const supa = supaBrowser();
    await supa.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <nav className="bg-white border-b border-slate-200 px-4 md:px-8 h-14 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-6">
        <Link href="/" className="font-semibold text-slate-900 tracking-tight">
          Waterworks · Aprovações
        </Link>
        <div className="flex gap-1">
          {TABS.map((t) => {
            const active = pathname === t.href;
            return (
              <Link
                key={t.href}
                href={t.href}
                data-active={active}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 transition ${t.tone}`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {userEmail && (
          <span className="text-xs text-slate-500 hidden sm:block">{userEmail}</span>
        )}
        <button
          onClick={signOut}
          className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2"
        >
          sair
        </button>
      </div>
    </nav>
  );
}
