"use client";

import { useState } from "react";
import { supaBrowser } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

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
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-8 shadow-sm">
        <div className="flex flex-col items-center mb-6">
          <img
            src="/logo-waterworks.svg"
            alt="WaterWorks"
            className="h-16 w-auto object-contain mb-3"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <h1 className="text-xl font-semibold text-slate-900">Aprovações · Omie</h1>
          <p className="text-sm text-slate-500 mt-1">
            Entre com seu email e senha.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="email@waterworks.com.br"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            type="password"
            required
            placeholder="senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-2 rounded-lg transition disabled:opacity-50"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
          <div className="text-center pt-1">
            <a href="/recover" className="text-xs text-slate-500 hover:text-slate-800 underline underline-offset-2">
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
