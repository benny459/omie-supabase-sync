"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { brl, cartao } from "@/components/navy/tela/KitTela";
import BotaoEmitirNf from "@/components/faturamento/BotaoEmitirNf";
import type { DocFat } from "@/lib/faturamento/montar";
import { STATUS_VENDA, type VendaLinha } from "@/lib/vendas";

/* PV/OS nativos do painel (P1): lista compacta com "Emitir NF" (motor P5).
   Usada em ERP · Vendas e na tela de Faturamento. `soAbertos` mostra só a
   fila a faturar. A chave "CRM cria no painel" fica aqui para admins. */

const th: CSSProperties = { padding: "12px 10px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--ww-border)", textAlign: "left", color: "var(--ww-text-faint)" };
const td: CSSProperties = { padding: "8px 10px", fontSize: 13, color: "var(--ww-text)", verticalAlign: "middle" };

export default function FilaVendasNativas({ soAbertos = false, titulo }: { soAbertos?: boolean; titulo?: string }) {
  const [linhas, setLinhas] = useState<VendaLinha[] | null>(null);
  const [cfg, setCfg] = useState<{ pv_os_nativo: boolean } | null>(null);
  const [admin, setAdmin] = useState(false);
  const [docs, setDocs] = useState<Record<number, DocFat>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/vendas?emp=SF", { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
    if (r.error) { setMsg(r.error); setLinhas([]); return; }
    setLinhas(r.linhas ?? []); setCfg(r.config ?? null); setAdmin(!!r.admin);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const vis = (linhas ?? []).filter((l) => !soAbertos || l.status === "aberto");
  useEffect(() => {
    // documento fiscal montado no servidor, só para os abertos visíveis (até 20)
    vis.filter((l) => l.status === "aberto" && !docs[l.id]).slice(0, 20).forEach(async (l) => {
      const r = await fetch(`/api/vendas/${l.id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({}));
      if (r.docfat) setDocs((d) => ({ ...d, [l.id]: r.docfat }));
    });
  }, [linhas]); // eslint-disable-line react-hooks/exhaustive-deps

  async function alternar() {
    if (!cfg) return;
    const r = await fetch("/api/vendas/config", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa: "SF", nativo: !cfg.pv_os_nativo }) }).then((x) => x.json()).catch(() => ({}));
    if (r.error) setMsg(r.error); else setCfg(r);
  }

  if (linhas && vis.length === 0 && soAbertos) return null;
  return (
    <div style={{ ...cartao, overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>{titulo ?? "PV / OS do painel"}
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--ww-text-faint)" }}> · nascidos no painel ou pelo CRM, sem Omie</span>
        </div>
        {cfg && (
          <span style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>
            CRM cria PV/OS: <b style={{ color: cfg.pv_os_nativo ? "#3FB68B" : "#E0A93B" }}>{cfg.pv_os_nativo ? "no painel" : "no Omie"}</b>
            {admin && <button onClick={alternar} style={{ marginLeft: 8, background: "none", border: 0, color: "var(--ww-accent-text)", cursor: "pointer", fontWeight: 600, fontSize: 12 }}>
              {cfg.pv_os_nativo ? "voltar ao Omie" : "passar para o painel"}</button>}
          </span>
        )}
        {!soAbertos && <Link href="/erp/vendas/novo" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ww-accent-text)" }}>+ Novo PV / OS</Link>}
      </div>
      {msg && <div style={{ fontSize: 12, color: "#E5484D", marginBottom: 6 }}>{msg}</div>}
      {!linhas ? <div style={{ fontSize: 12.5, color: "var(--ww-text-faint)" }}>Carregando…</div> : vis.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--ww-text-faint)" }}>Nenhum PV/OS do painel ainda.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>{["Documento", "Cliente", "Proposta", "Emissão", "Valor", "Status", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {vis.map((l) => {
              const st = STATUS_VENDA[l.status];
              return (
                <tr key={l.id} style={{ borderBottom: "1px solid var(--ww-border)" }}>
                  <td style={td}><Link href={`/erp/vendas/${l.id}`} style={{ fontWeight: 700, color: "var(--ww-accent-text)" }}>{l.label}</Link>
                    {l.origem === "crm" && <span style={{ fontSize: 11, color: "var(--ww-text-faint)" }}> · CRM</span>}</td>
                  <td style={{ ...td, maxWidth: 260 }}>{l.cliente}</td>
                  <td style={td}>{l.proposta ?? "—"}</td>
                  <td style={td}>{l.emissao?.split("-").reverse().join("/")}</td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(Number(l.valor_total))}</td>
                  <td style={td}><span style={{ color: st.cor, fontWeight: 600 }}>● {st.rot}</span>{l.nf ? <span style={{ fontSize: 11, color: "var(--ww-text-faint)" }}> · NF {l.nf}</span> : null}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {l.status === "aberto" && docs[l.id] && (
                      <BotaoEmitirNf origemTipo={l.tipo === "OS" ? "os" : "pv"} origemId={String(l.id)} documento={docs[l.id]} rotulo={l.label}
                        onEmitido={(r) => { setMsg(`${l.label}: ${r.status}${r.numero ? ` nº ${r.numero}` : ""}${r.mensagem ? ` — ${r.mensagem}` : ""}`); carregar(); }} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
