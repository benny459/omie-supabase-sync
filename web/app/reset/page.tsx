"use client";

import { useEffect, useState } from "react";
import { supaBrowser } from "@/lib/supabase";

type Msg = { kind: "ok" | "err" | "info"; text: string };

export default function ResetPage() {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  // Ao chegar via link do email, Supabase @supabase/ssr detecta a session no hash
  // e persiste em cookie/localStorage. Verificamos se temos uma session válida.
  useEffect(() => {
    const supa = supaBrowser();
    // Permite ao Supabase processar o hash (access_token, refresh_token) e confirmar session
    supa.auth.getSession().then(({ data }) => {
      if (data.session) {
        setReady(true);
      } else {
        // Tenta esperar um pouco — às vezes o hash ainda não foi processado
        setTimeout(async () => {
          const { data: d2 } = await supa.auth.getSession();
          if (d2.session) setReady(true);
          else setMsg({
            kind: "err",
            text: "Link inválido ou expirado. Solicite um novo em /recover.",
          });
        }, 500);
      }
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pw1.length < 8) { setMsg({ kind: "err", text: "A senha precisa ter no mínimo 8 caracteres." }); return; }
    if (pw1 !== pw2) { setMsg({ kind: "err", text: "As senhas não conferem." }); return; }
    setLoading(true); setMsg(null);
    const supa = supaBrowser();
    const { error } = await supa.auth.updateUser({ password: pw1 });
    setLoading(false);
    if (error) { setMsg({ kind: "err", text: error.message }); return; }
    setMsg({ kind: "ok", text: "Senha alterada com sucesso. Redirecionando…" });
    setTimeout(() => { window.location.href = "/avulsos"; }, 1200);
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
          <h2 className="font-mono text-[11px] tracking-wider text-white/50 uppercase mb-1">Reset</h2>
          <p className="text-white text-[18px] font-medium mb-1">Nova senha</p>
          <p className="text-white/50 text-[13px] mb-6">Escolha uma senha forte.</p>
          {ready ? (
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] font-mono tracking-wider text-white/40 uppercase mb-1.5">Nova senha</label>
                <input
                  type="password" required minLength={8}
                  placeholder="mín. 8 caracteres"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white/[0.06] border border-white/10 rounded-lg text-[14px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#4F46E5] focus:bg-white/[0.08] transition"
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono tracking-wider text-white/40 uppercase mb-1.5">Confirmar</label>
                <input
                  type="password" required minLength={8}
                  placeholder="repita a nova senha"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white/[0.06] border border-white/10 rounded-lg text-[14px] text-white placeholder:text-white/30 focus:outline-none focus:border-[#4F46E5] focus:bg-white/[0.08] transition"
                />
              </div>
              <button
                type="submit" disabled={loading}
                className="w-full mt-2 bg-[#4F46E5] hover:bg-[#4338CA] text-white font-medium py-2.5 rounded-lg transition disabled:opacity-50 shadow-[0_4px_16px_rgba(79,70,229,0.4)]">
                {loading ? "Salvando…" : "Salvar nova senha"}
              </button>
            </form>
          ) : (
            <div className="text-center py-6 text-[13px] text-white/50">
              {msg ? null : "Validando link…"}
            </div>
          )}
          {msg && (
            <div className={`mt-4 px-3 py-2 rounded-lg text-[12px] border ${
              msg.kind === "ok"
                ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                : msg.kind === "err"
                ? "bg-rose-500/10 text-rose-300 border-rose-500/20"
                : "bg-sky-500/10 text-sky-300 border-sky-500/20"
            }`}>
              {msg.text}
              {msg.kind === "err" && (
                <div className="mt-2 text-[11px]">
                  <a href="/recover" className="underline underline-offset-2 hover:text-white">Reenviar link</a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
