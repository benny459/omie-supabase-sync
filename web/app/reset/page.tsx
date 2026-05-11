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
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200 p-8 shadow-sm">
        <div className="flex flex-col items-center mb-6">
          <img
            src="/logo-waterworks.svg"
            alt="WaterWorks"
            className="h-16 w-auto object-contain mb-3"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <h1 className="text-xl font-semibold text-slate-900">Nova senha</h1>
          <p className="text-sm text-slate-500 mt-1">Escolha uma senha forte.</p>
        </div>
        {ready ? (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="password"
              required minLength={8}
              placeholder="Nova senha (mín. 8 caracteres)"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <input
              type="password"
              required minLength={8}
              placeholder="Confirmar nova senha"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-2 rounded-lg transition disabled:opacity-50"
            >
              {loading ? "Salvando…" : "Salvar nova senha"}
            </button>
          </form>
        ) : (
          <div className="text-center py-6 text-sm text-slate-500">
            {msg ? null : "Validando link…"}
          </div>
        )}
        {msg && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm ${
              msg.kind === "ok"
                ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
                : msg.kind === "err"
                ? "bg-rose-50 text-rose-800 border border-rose-200"
                : "bg-sky-50 text-sky-800 border border-sky-200"
            }`}
          >
            {msg.text}
            {msg.kind === "err" && (
              <div className="mt-2 text-[11px]">
                <a href="/recover" className="underline underline-offset-2">Reenviar link</a>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
