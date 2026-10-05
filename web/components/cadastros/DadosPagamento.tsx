"use client";

/**
 * Dados para pagamento do fornecedor (05/10/26, sql/73): chave Pix e/ou banco,
 * agência e conta. Usados pela remessa do C6 (Contas a Pagar › Arquivo C6).
 * Fica em cadastros.pessoas_pagamento; nada vai ao Omie.
 */
import { useEffect, useState } from "react";

type Banco = { compe: string; ispb: string; nome: string };
type Dados = { pix_tipo: string; pix_chave: string; banco_compe: string; agencia: string; conta: string; conta_tipo: string; titular_nome: string; titular_doc: string };
const VAZIO: Dados = { pix_tipo: "", pix_chave: "", banco_compe: "", agencia: "", conta: "", conta_tipo: "Conta Corrente", titular_nome: "", titular_doc: "" };

export default function DadosPagamento({ pessoaId }: { pessoaId: number }) {
  const [d, setD] = useState<Dados | null>(null);
  const [bancos, setBancos] = useState<Banco[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  const [semPerm, setSemPerm] = useState(false);

  useEffect(() => {
    fetch(`/api/financeiro/remessa?pagamento=${pessoaId}`, { cache: "no-store" }).then(async (r) => {
      if (r.status === 403) { setSemPerm(true); return; }
      const j = await r.json();
      setBancos(j.bancos ?? []);
      setD({ ...VAZIO, ...Object.fromEntries(Object.entries(j.dados ?? {}).map(([k, v]) => [k, v ?? ""])) } as Dados);
    }).catch(() => setD(VAZIO));
  }, [pessoaId]);

  if (semPerm) return null;
  if (!d) return <div className="mini" style={{ padding: 8 }}>Carregando dados de pagamento…</div>;
  const set = (p: Partial<Dados>) => setD({ ...d, ...p });

  async function salvar() {
    setIndo(true); setMsg(null);
    const r = await fetch("/api/financeiro/remessa", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "salvar_pagamento", pessoa_id: pessoaId, dados: Object.fromEntries(Object.entries(d!).map(([k, v]) => [k, String(v).trim() || null])) }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Dados de pagamento salvos." : j.error ?? "Erro ao salvar");
    setIndo(false);
  }

  return (
    <div id="pagamento" className="form-grid" style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--ww-border, #2a3858)" }}>
      <div className="f s12" style={{ fontSize: 12, fontWeight: 600, color: "var(--ww-text-2)" }}>
        Dados para pagamento <span className="mini">· usados no arquivo de pagamentos do C6 (Pix ou transferência)</span></div>
      <label className="f s3">Tipo da chave Pix
        <select className="inp" value={d.pix_tipo} onChange={(e) => set({ pix_tipo: e.target.value })}>
          <option value="">—</option><option value="cpf_cnpj">CPF/CNPJ</option><option value="email">E-mail</option>
          <option value="telefone">Celular (+55…)</option><option value="aleatoria">Aleatória</option>
        </select></label>
      <label className="f s9">Chave Pix<input className="inp mono" value={d.pix_chave} onChange={(e) => set({ pix_chave: e.target.value })}
        placeholder={d.pix_tipo === "telefone" ? "+5511912345678" : "chave do favorecido"} /></label>
      <label className="f s4">Banco
        <select className="inp" value={d.banco_compe} onChange={(e) => set({ banco_compe: e.target.value })}>
          <option value="">—</option>{bancos.map((b) => <option key={b.compe} value={b.compe}>{b.compe} · {b.nome}</option>)}
        </select></label>
      <label className="f s2">Agência<input className="inp mono" value={d.agencia} onChange={(e) => set({ agencia: e.target.value })} /></label>
      <label className="f s3">Conta e dígito<input className="inp mono" value={d.conta} onChange={(e) => set({ conta: e.target.value })} /></label>
      <label className="f s3">Tipo de conta
        <select className="inp" value={d.conta_tipo} onChange={(e) => set({ conta_tipo: e.target.value })}>
          <option>Conta Corrente</option><option>Conta Poupança</option><option>Conta Pagamento</option>
        </select></label>
      <label className="f s6">Titular (se diferente)<input className="inp" value={d.titular_nome} onChange={(e) => set({ titular_nome: e.target.value })} /></label>
      <label className="f s3">CPF/CNPJ do titular<input className="inp mono" value={d.titular_doc} onChange={(e) => set({ titular_doc: e.target.value })} /></label>
      <div className="f s3" style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
        <button type="button" className="btn" disabled={indo} onClick={salvar}>{indo ? "Salvando…" : "Salvar dados de pagamento"}</button>
      </div>
      {msg && <div className="f s12 mini">{msg}</div>}
    </div>
  );
}
