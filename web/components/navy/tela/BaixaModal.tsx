"use client";

/**
 * Baixa manual de um título do painel (05/10/26, sql/52).
 *  - pagar: previsão de PC (finance.pagar_previsto) — só "liberado" se paga,
 *    salvo "forçar" com motivo (pagamento que já aconteceu no banco);
 *  - receber: conta nascida no painel (finance.receber).
 * Mostra o histórico de baixas e permite estornar (com motivo). Baixa parcial
 * é permitida: o saldo fica em aberto.
 */

import { useCallback, useEffect, useState } from "react";
import { brl, ddmmaa, hojeISO } from "./KitTela";

type Titulo = {
  natureza: "P" | "R"; titulo: string; empresa: string; contraparte: string | null; documento: string | null;
  vencimento: string | null; valor: number; valor_pago: number; saldo: number; fase: string | null; cod_cc: number | null;
};
type Baixa = {
  id: number; data: string; valor: number; conta: string | null; origem: string; forcada: boolean; observacao: string | null;
  criado_por: string | null; criado_em: string; estornado_em: string | null; estornado_por: string | null;
  estorno_motivo: string | null; memo: string | null;
};
type Conta = { empresa: string; cod_cc: number; descricao: string };

const campo: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 10, fontSize: 13,
  border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
};
const rotulo: React.CSSProperties = { fontSize: 11.5, color: "var(--ww-text-muted)", fontWeight: 600, marginBottom: 4, display: "block" };

export default function BaixaModal({ natureza, titulo, onClose, onFeito }: {
  natureza: "P" | "R"; titulo: string; onClose: () => void; onFeito: () => void;
}) {
  const [t, setT] = useState<Titulo | null>(null);
  const [baixas, setBaixas] = useState<Baixa[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [pode, setPode] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [data, setData] = useState(hojeISO());
  const [valor, setValor] = useState("");
  const [codCc, setCodCc] = useState("");
  const [obs, setObs] = useState("");
  const [forcar, setForcar] = useState(false);
  const [estornoId, setEstornoId] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");

  const carregar = useCallback(async () => {
    setErro(null);
    const r = await fetch(`/api/financeiro/baixa?natureza=${natureza}&titulo=${encodeURIComponent(titulo)}`);
    const j = await r.json();
    if (!r.ok) { setErro(j.error ?? `HTTP ${r.status}`); return; }
    setT(j.titulo); setBaixas(j.baixas ?? []); setContas(j.contas ?? []); setPode(!!j.pode_baixar);
    if (j.titulo) {
      setValor(Number(j.titulo.saldo).toFixed(2));
      setCodCc(j.titulo.cod_cc ? String(j.titulo.cod_cc) : "");
    }
  }, [natureza, titulo]);
  useEffect(() => { carregar(); }, [carregar]);

  async function enviar(corpo: object) {
    setSalvando(true); setErro(null);
    try {
      const r = await fetch("/api/financeiro/baixa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      await carregar(); onFeito();
      return true;
    } catch (e) { setErro((e as Error).message); return false; }
    finally { setSalvando(false); }
  }

  const precisaForcar = natureza === "P" && t && t.fase !== "liberado";
  const verbo = natureza === "P" ? "Pagamento" : "Recebimento";
  const contasEmp = contas.filter((c) => !t || c.empresa === t.empresa);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(5,10,20,.55)", backdropFilter: "blur(3px)",
                                     display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(620px, 100%)", maxHeight: "90vh", overflow: "auto", borderRadius: 16,
             background: "var(--ww-panel)", border: "1px solid var(--ww-border)", boxShadow: "0 24px 60px rgba(0,0,0,.45)", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--ww-text-faint)", fontWeight: 600 }}>{natureza === "P" ? "Baixa de conta a pagar" : "Baixa de conta a receber"}</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: "var(--ww-text)" }}>{t?.contraparte ?? "…"}</div>
            <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>
              {t?.documento ?? ""}{t?.vencimento ? ` · venc. ${ddmmaa(t.vencimento)}` : ""}{t?.empresa ? ` · ${t.empresa}` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar"
            style={{ border: 0, background: "transparent", color: "var(--ww-text-muted)", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>

        {t && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 14 }}>
            {[["Valor", t.valor], [natureza === "P" ? "Pago" : "Recebido", t.valor_pago], ["Saldo", t.saldo]].map(([k, v]) => (
              <div key={k as string} style={{ border: "1px solid var(--ww-border)", borderRadius: 12, padding: "8px 12px" }}>
                <div style={{ fontSize: 11, color: "var(--ww-text-faint)" }}>{k}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "var(--ww-text)" }}>{brl(Number(v))}</div>
              </div>
            ))}
          </div>
        )}
        {!t && !erro && <div style={{ marginTop: 14, fontSize: 13, color: "var(--ww-text-muted)" }}>Carregando…</div>}
        {erro && <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--ww-crit-text)" }}>{erro}</div>}

        {t && pode && t.saldo > 0 && (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--ww-border)", paddingTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ww-text)", marginBottom: 10 }}>Registar {verbo.toLowerCase()}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label><span style={rotulo}>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} style={campo} /></label>
              <label><span style={rotulo}>Valor (parcial permitido)</span>
                <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} style={campo} /></label>
              <label style={{ gridColumn: "1 / -1" }}><span style={rotulo}>Conta</span>
                <select value={codCc} onChange={(e) => setCodCc(e.target.value)} style={campo}>
                  <option value="">—</option>
                  {contasEmp.map((c) => <option key={`${c.empresa}:${c.cod_cc}`} value={c.cod_cc}>{c.descricao}</option>)}
                </select></label>
              <label style={{ gridColumn: "1 / -1" }}><span style={rotulo}>Observação{forcar ? " (motivo obrigatório)" : ""}</span>
                <input value={obs} onChange={(e) => setObs(e.target.value)} style={campo} placeholder="comprovante, nº da transferência…" /></label>
            </div>
            {precisaForcar && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 12.5, color: "var(--ww-warn-text, var(--ww-text-muted))" }}>
                <input type="checkbox" checked={forcar} onChange={(e) => setForcar(e.target.checked)} />
                Ainda não liberado para pagar (fase {t.fase}) — registar mesmo assim (pagamento já feito)
              </label>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" disabled={salvando || (!!precisaForcar && !forcar)}
                onClick={async () => {
                  const ok = await enviar({ acao: "baixar", natureza, titulo, data, valor: Number(valor.replace(",", ".")),
                                            cod_cc: codCc ? Number(codCc) : null, obs, forcar });
                  if (ok) { setObs(""); setForcar(false); }
                }}
                style={{ padding: "8px 16px", borderRadius: 12, border: 0, fontWeight: 600, fontSize: 13.5, color: "#fff",
                         cursor: salvando ? "default" : "pointer", opacity: salvando || (!!precisaForcar && !forcar) ? 0.5 : 1,
                         background: "linear-gradient(180deg,var(--ww-brand-2),var(--ww-brand-1))" }}>
                {salvando ? "Gravando…" : `Registar ${verbo.toLowerCase()}`}
              </button>
            </div>
          </div>
        )}
        {t && !pode && <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--ww-text-muted)" }}>Sem permissão para baixar títulos (Usuários e acessos → Financeiro).</div>}

        <div style={{ marginTop: 16, borderTop: "1px solid var(--ww-border)", paddingTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ww-text)", marginBottom: 6 }}>Histórico de baixas</div>
          {!baixas.length && <div style={{ fontSize: 12.5, color: "var(--ww-text-faint)" }}>Nenhuma baixa registada.</div>}
          {baixas.map((b) => (
            <div key={b.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--ww-border)", opacity: b.estornado_em ? 0.55 : 1 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
                <b style={{ color: "var(--ww-text)", textDecoration: b.estornado_em ? "line-through" : "none" }}>{brl(Number(b.valor))}</b>
                <span style={{ color: "var(--ww-text-muted)" }}>{ddmmaa(b.data)} · {b.conta ?? "sem conta"} · {b.origem === "conciliacao" ? "conciliação" : "manual"}{b.forcada ? " · forçada" : ""}</span>
                <span style={{ flex: 1 }} />
                {!b.estornado_em && pode && estornoId !== b.id && (
                  <button type="button" onClick={() => { setEstornoId(b.id); setMotivo(""); }}
                    style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, cursor: "pointer", border: "1px solid var(--ww-border-strong)",
                             background: "transparent", color: "var(--ww-crit-text)" }}>estornar</button>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>
                {b.criado_por ?? ""}{b.observacao ? ` · ${b.observacao}` : ""}{b.memo ? ` · extrato: ${b.memo}` : ""}
                {b.estornado_em ? ` · estornada por ${b.estornado_por ?? "?"}: ${b.estorno_motivo ?? ""}` : ""}
              </div>
              {estornoId === b.id && (
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <input autoFocus value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo do estorno" style={{ ...campo, flex: 1 }} />
                  <button type="button" disabled={salvando || !motivo.trim()}
                    onClick={async () => { if (await enviar({ acao: "estornar", baixa_id: b.id, motivo })) setEstornoId(null); }}
                    style={{ padding: "6px 12px", borderRadius: 10, border: "1px solid var(--ww-border-strong)", background: "transparent",
                             color: "var(--ww-crit-text)", cursor: "pointer", opacity: !motivo.trim() ? 0.5 : 1 }}>Confirmar</button>
                  <button type="button" onClick={() => setEstornoId(null)}
                    style={{ padding: "6px 12px", borderRadius: 10, border: 0, background: "transparent", color: "var(--ww-text-muted)", cursor: "pointer" }}>Cancelar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
