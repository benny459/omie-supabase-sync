"use client";

// Exceções por usuário dos reports do Cesar (v3): sem exceção, todo mundo com
// a tela incorpora para a equipe; aqui o admin rebaixa (só para si) ou trava
// (não incorpora) pessoas específicas. A página de Configurações já é
// admin-only — a API confere de novo por conta própria.

import { useEffect, useState } from "react";

const MODOS = [
  { value: "todos", label: "Disponibiliza para todos" },
  { value: "proprio", label: "Incorpora só para si" },
  { value: "nenhum", label: "Não pode incorporar" },
];

export default function CesarReportsConfig() {
  const [excecoes, setExcecoes] = useState<{ email: string; modo: string }[] | null>(null);
  const [novoEmail, setNovoEmail] = useState("");
  const [novoModo, setNovoModo] = useState("nenhum");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = () => {
    fetch("/api/cesar/report-config", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setExcecoes(Array.isArray(d?.excecoes) ? d.excecoes : []))
      .catch(() => setExcecoes([]));
  };
  useEffect(carregar, []);

  const salvar = async (email: string, modo: string) => {
    setSalvando(true); setErro(null);
    const r = await fetch("/api/cesar/report-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, modo }),
    }).catch(() => null);
    if (r && !r.ok) setErro((await r.json().catch(() => ({})))?.error ?? "não deu");
    setSalvando(false);
    carregar();
  };

  const remover = async (email: string) => {
    await fetch(`/api/cesar/report-config?email=${encodeURIComponent(email)}`, { method: "DELETE" }).catch(() => {});
    carregar();
  };

  return (
    <section className="bg-ww-panel rounded-xl border border-ww-border shadow-sm p-5 space-y-3">
      <div>
        <h2 className="text-[15px] font-semibold text-ww-text">Reports do Cesar</h2>
        <p className="text-[11.5px] text-ww-textMuted mt-0.5">
          Padrão: qualquer pessoa com acesso à tela incorpora reports para a equipe.
          As exceções abaixo rebaixam ou travam usuários específicos.
        </p>
      </div>

      {excecoes === null && <p className="text-[11.5px] text-ww-textFaint">carregando…</p>}

      {(excecoes ?? []).map((e) => (
        <div key={e.email} className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ww-text">{e.email}</span>
          <select
            className="h-8 rounded-lg border border-ww-border bg-ww-bg px-2 text-[12px] text-ww-text"
            value={e.modo} disabled={salvando}
            onChange={(ev) => void salvar(e.email, ev.target.value)}>
            {MODOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button type="button" title="Remover exceção (volta ao padrão)"
            className="text-ww-textFaint hover:text-rose-500 transition text-[13px]"
            onClick={() => void remover(e.email)}>
            ✕
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <input
          className="h-8 flex-1 rounded-lg border border-ww-border bg-ww-bg px-2.5 text-[12px]
                     text-ww-text placeholder:text-ww-textFaint focus:outline-none focus:border-ww-accent/60"
          placeholder="e-mail do usuário"
          value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} />
        <select className="h-8 rounded-lg border border-ww-border bg-ww-bg px-2 text-[12px] text-ww-text"
          value={novoModo} onChange={(e) => setNovoModo(e.target.value)}>
          {MODOS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <button type="button"
          className="h-8 rounded-lg border border-ww-border px-2.5 text-[12px] text-ww-textMuted
                     hover:text-ww-text hover:bg-ww-rowHover transition disabled:opacity-40"
          disabled={!novoEmail.includes("@") || salvando}
          onClick={() => { void salvar(novoEmail.toLowerCase().trim(), novoModo); setNovoEmail(""); }}>
          + Exceção
        </button>
      </div>
      {erro && <p className="text-[11px] text-rose-500">{erro}</p>}
    </section>
  );
}
