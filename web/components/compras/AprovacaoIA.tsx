"use client";
// Aprovação automática (Aria) — 06/10/26. Mostra a simulação (o que seria
// aprovado e por quê) e, para administrador, "Aprovar agora". A mesma regra roda
// sozinha 3× ao dia (08h, 12h e 17h de Brasília). Regra: lib/aprovacao-ia.ts.
import { useState } from "react";

type Linha = {
  pc: string; fornecedor: string | null; cmp_pc: number | null; cmp_rc: number | null; base: string;
  condicao: string | null; pv_os: string | null; elegivel: boolean; motivo: string; decisao?: string; detalhe?: string;
};
type Rodada = { quando: string; modo: string; origem_disparo: string; pc: string; decisao: string; motivo: string };

const brl = (n: number | null) => (n == null ? "—" : Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export default function AprovacaoIA({ aoAprovar }: { aoAprovar?: () => void }) {
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<Linha[] | null>(null);
  const [ultimas, setUltimas] = useState<Rodada[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function abrir() {
    setAberto(true); setLista(null); setMsg(null);
    const r = await fetch("/api/compras/aprovacao-ia", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg(j.error ?? "Não consegui carregar"); setLista([]); return; }
    setLista(j.lista ?? []); setUltimas((j.ultimas ?? []).filter((u: Rodada) => u.modo === "aplicado" && u.decisao === "aprovado").slice(0, 15));
  }
  async function aplicar() {
    setOcupado(true); setMsg(null);
    const r = await fetch("/api/compras/aprovacao-ia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ aplicar: true }) });
    const j = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) { setMsg(j.error ?? "Falhou"); return; }
    setLista(j.linhas ?? []);
    setMsg(`${j.aprovados} aprovado(s) pela Aria${j.falhas ? ` · ${j.falhas} falha(s)` : ""}.`);
    aoAprovar?.();
  }
  const elegiveis = (lista ?? []).filter((l) => l.elegivel && l.decisao !== "aprovado").length;

  return (
    <>
      <button className="btn" onClick={abrir} title="PCs avulsos com valor ≤ RC e condição faturada são aprovados pela Aria (08h, 12h e 17h)">🤖 Aprovação automática</button>
      {aberto && (
        <div className="cmp-scrim" style={{ justifyContent: "center", alignItems: "center", zIndex: 100 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setAberto(false); }}>
          <div className="card2" role="dialog" aria-modal="true" style={{ width: "min(980px,96vw)", maxHeight: "88vh", overflow: "auto", display: "grid", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <b style={{ fontSize: 16 }}>✨ Aprovação automática — Aria</b>
              <span style={{ flex: 1 }} />
              <button className="btn sm" onClick={() => setAberto(false)}>Fechar</button>
            </div>
            <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              PC de <b>Vendas avulsas</b> dos últimos 30 dias, ainda pendente, com <b>valor ≤ RC</b> e condição <b>faturada</b> (prazo depois da NF:
              “Para N dias”, “28/56/84”… — nunca “A Vista”). Roda sozinho às <b>08h, 12h e 17h</b>; aqui você vê a simulação e pode aprovar agora.
            </div>
            {msg && <div className="pill p-sky" style={{ justifySelf: "start" }}>{msg}</div>}
            {!lista ? <div className="faint">Carregando…</div> : lista.length === 0 ? <div className="faint">Nenhum PC avulso pendente nos últimos 30 dias.</div> : (
              <table className="tb" style={{ width: "100%", fontSize: 12.5 }}>
                <thead><tr><th>PC</th><th>Fornecedor</th><th>Venda</th><th className="r">PC</th><th className="r">RC</th><th>Condição</th><th>Decisão</th></tr></thead>
                <tbody>
                  {lista.map((l) => (
                    <tr key={l.pc}>
                      <td><b>{l.pc}</b></td><td>{l.fornecedor ?? "—"}</td><td>{l.pv_os ?? "—"}</td>
                      <td className="r">{brl(l.cmp_pc)}</td><td className="r">{brl(l.cmp_rc)}{l.base === "venda" ? <small className="faint"> (venda)</small> : null}</td>
                      <td>{l.condicao ?? "—"}</td>
                      <td>{l.decisao === "aprovado" ? <span className="pill p-ok">✓ aprovado pela Aria</span>
                        : l.decisao === "falhou" ? <span className="pill p-crit" title={l.detalhe}>falhou</span>
                        : l.elegivel ? <span className="pill p-ok">elegível</span> : <span className="faint">{l.motivo}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn pri" disabled={ocupado || elegiveis === 0} onClick={aplicar}>{ocupado ? "Aprovando…" : `Aprovar ${elegiveis} elegível(is) agora`}</button>
            </div>
            {ultimas.length > 0 && (
              <div style={{ fontSize: 12 }}>
                <b>Últimas aprovações do Aria</b>
                {ultimas.map((u, i) => <div key={i} className="faint">{new Date(u.quando).toLocaleString("pt-BR")} · PC {u.pc} · {u.motivo} · {u.origem_disparo}</div>)}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
