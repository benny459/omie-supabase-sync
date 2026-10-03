"use client";

import { useState } from "react";
import { supaBrowser } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(() => {
    if (typeof window === "undefined") return null;
    const e = new URLSearchParams(window.location.search).get("error");
    if (e === "sem_acesso") return { kind: "err", text: "Esta conta Google não tem acesso ao painel. Fale com o administrador." };
    if (e === "auth") return { kind: "err", text: "Não foi possível entrar. Tente de novo." };
    return null;
  });

  // Login com Google (03/10/26): os e-mails @waterworks.com.br são Google.
  async function entrarComGoogle() {
    setMsg(null);
    const next = new URLSearchParams(window.location.search).get("next") || "/avulsos";
    const destino = next.startsWith("/") && !next.startsWith("//") ? next : "/avulsos";
    const { error } = await supaBrowser().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?via=google&next=${encodeURIComponent(destino)}`,
        queryParams: { hd: "waterworks.com.br", prompt: "select_account" },
      },
    });
    if (error) setMsg({ kind: "err", text: error.message });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const supa = supaBrowser();
    const { error } = await supa.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) {
      setMsg({ kind: "err", text: error.message });
    } else {
      // middleware vai redirecionar automaticamente
      window.location.href = "/avulsos";
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-ww-rowHover p-6">
      <div className="w-full max-w-md bg-ww-panel rounded-xl border border-ww-border p-8 shadow-sm">
        <div className="flex flex-col items-center mb-6">
          <img
            src="/logo-waterworks.svg"
            alt="WaterWorks"
            className="h-16 w-auto object-contain mb-3"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <h1 className="text-xl font-semibold text-ww-text">Aprovações · Omie</h1>
          <p className="text-sm text-ww-textMuted mt-1">
            Entre com seu email e senha.
          </p>
        </div>
        <button
          type="button"
          onClick={entrarComGoogle}
          className="w-full flex items-center justify-center gap-2 border border-ww-border bg-white hover:bg-ww-rowHover text-ww-text font-medium py-2 rounded-lg transition mb-3"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.5z"/></svg>
          Entrar com Google
        </button>
        <div className="flex items-center gap-3 mb-3 text-[11px] text-ww-textMuted">
          <span className="flex-1 h-px bg-ww-border" /> ou com e-mail e senha <span className="flex-1 h-px bg-ww-border" />
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="email@waterworks.com.br"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-ww-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            type="password"
            required
            placeholder="senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-ww-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-2 rounded-lg transition disabled:opacity-50"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
          <div className="text-center pt-1">
            <a href="/recover" className="text-xs text-ww-textMuted hover:text-ww-text underline underline-offset-2">
              Esqueci a senha
            </a>
          </div>
        </form>
        {msg && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm ${
              msg.kind === "ok"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : "bg-rose-50 text-rose-800 border border-rose-200"
            }`}
          >
            {msg.text}
          </div>
        )}
      </div>
    </main>
  );
}
