"use client";

import { useState } from "react";
import { supaBrowser } from "@/lib/supabase";

export default function RecoverPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setMsg(null);
    const supa = supaBrowser();
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const { error } = await supa.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${origin}/reset`,
    });
    setLoading(false);
    if (error) setMsg({ kind: "err", text: error.message });
    else setMsg({ kind: "ok", text: "Enviamos um link de recuperação pro seu email. Confira a caixa de entrada e spam." });
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#0a0a0c] text-white flex items-center justify-center p-6">
      <div aria-hidden className="auralis-ambient" />
      <div aria-hidden className="auralis-grid" />

      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <span className="font-mono text-[15px] tracking-[0.18em] font-medium text-white/80">WATERWORKS</span>
          <span className="text-[#06B6D4] text-[18px] leading-none">°</span>
        </div>
        <div className="bg-white/[0.04] border border-white/10 backdrop-blur-md rounded-2xl p-7 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          <h2 className="font-mono text-[11px] tracking-wider text-white/50 uppercase mb-1">Recover</h2>
          <p className="text-white text-[18px] font-medium mb-1">Recuperar acesso</p>
          <p className="text-white/50 text-[13px] mb-6">Enviamos um link pra cadastrar nova senha.</p>
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
            <button
              type="submit" disabled={loading}
              className="w-full mt-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50 shadow-[0_4px_16px_rgba(79,70,229,0.4)]">
              {loading ? "Enviando…" : "Enviar link de recuperação"}
            </button>
            <div className="text-center pt-2">
              <a href="/login" className="text-[12px] text-white/50 hover:text-white/80 transition underline-offset-2 hover:underline">
                Voltar ao login
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
    </main>
  );
}
