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
    const { error } = await supa.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) {
      setMsg({ kind: "err", text: error.message });
    } else {
      window.location.href = "/avulsos";
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0a0c] text-white">
      {/* Camada ambient — gradientes radiais animados (CSS puro, zero bundle) */}
      <div aria-hidden className="auralis-ambient" />
      <div aria-hidden className="auralis-grid" />

      {/* Header minimal */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-12 py-5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[15px] tracking-[0.18em] font-medium">WATERWORKS</span>
          <span className="text-[#06B6D4] text-[18px] leading-none">°</span>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-[13px] text-white/60 font-medium">
          <span className="hover:text-white transition cursor-default">Painel</span>
          <span className="hover:text-white transition cursor-default">Aprovações</span>
          <span className="hover:text-white transition cursor-default">Omie</span>
          <a href="#login" className="text-white hover:text-white/80 transition">Sign in</a>
        </nav>
      </header>

      {/* Hero + Login — grid 2 col em desktop, stack em mobile */}
      <section className="relative z-10 px-6 md:px-12 pt-12 md:pt-24 pb-20 grid md:grid-cols-2 gap-12 max-w-7xl mx-auto items-center">
        {/* Display */}
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/15 text-[11px] font-mono tracking-wider text-white/70 uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-[#06B6D4] animate-pulse" />
            Aprovação operacional
          </div>
          <h1 className="auralis-display text-white">
            Tratamento de água.<br/>
            <span className="auralis-gradient">Aprovado em segundos.</span><br/>
            Pra quem não pode parar.
          </h1>
          <p className="text-white/60 text-[15px] leading-relaxed max-w-md">
            Painel de aprovação de pedidos de compra integrado ao Omie. Sem fricção, sem espera, sem erro silencioso.
          </p>
        </div>

        {/* Card de login */}
        <div id="login" className="md:justify-self-end w-full max-w-md">
          <div className="bg-white/[0.04] border border-white/10 backdrop-blur-md rounded-2xl p-7 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
            <h2 className="font-mono text-[11px] tracking-wider text-white/50 uppercase mb-1">Sign in</h2>
            <p className="text-white text-[18px] font-medium mb-6">Entre na sua conta.</p>
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] font-mono tracking-wider text-white/40 uppercase mb-1.5">Email</label>
                <input
                  type="email" required autoFocus
                  placeholder="email@waterworks.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white/[0.06] border border-white/10 rounded-lg text-[14px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#4F46E5] focus:bg-white/[0.08] transition"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono tracking-wider text-white/40 uppercase mb-1.5">Senha</label>
                <input
                  type="password" required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white/[0.06] border border-white/10 rounded-lg text-[14px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#4F46E5] focus:bg-white/[0.08] transition"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full mt-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50 shadow-[0_4px_16px_rgba(79,70,229,0.4)]">
                {loading ? "Entrando…" : "Entrar"}
              </button>
              <div className="text-center pt-2">
                <a href="/recover" className="text-[12px] text-white/50 hover:text-white/80 transition underline-offset-2 hover:underline">
                  Esqueci a senha
                </a>
              </div>
            </form>
            {msg && (
              <div className={`mt-4 px-3 py-2 rounded-lg text-[12px] border ${
                msg.kind === "ok"
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-300 border-rose-500/20"
              }`}>
                {msg.text}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Footer mínimo */}
      <footer className="relative z-10 px-6 md:px-12 pb-6 text-[10px] font-mono tracking-wider text-white/30 uppercase">
        © WaterWorks · Painel de Aprovações
      </footer>
    </main>
  );
}
