"use client";

/**
 * Caixa "NF sem pedido" — NF-e (modelo 55) que chegaram pela Focus e não
 * casaram com nenhum pedido de compra. Enquanto estiver aqui, a NF não deve
 * ser paga (o título no Contas a Pagar mostra "⛔ NF sem pedido").
 * Ações: casar com uma sugestão, casar com um pedido procurado à mão, ou
 * dispensar (motivo obrigatório; mesma permissão de aprovar compra).
 */

import { useMemo, useState } from "react";
import { money, dBR, type PedidoLista } from "@/lib/compras";

export type NfSugestao = { pedidoId: number; num: string; forn: string | null; valor: number; emissao: string | null;
  aprov: string | null; etapa: string; origem: string; score: number; motivo: string };
export type NfSemPedido = { chave: string; numero: string; emissao: string; chegou: string | null; valor: number;
  emitente: string | null; cnpj: string | null; completa: boolean | null; sugestoes: NfSugestao[] };
export type NfDoPedido = { n: string; valor: number; em: string; chave: string; como: string | null; por: string | null };

const so = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export default function CaixaNfSemPedido({ nfs, pedidos, foco, onAcao, onClose }: {
  nfs: NfSemPedido[]; pedidos: PedidoLista[]; foco?: string | null;
  onAcao: (body: Record<string, unknown>, msg: string) => Promise<boolean>; onClose: () => void;
}) {
  const [aberta, setAberta] = useState<string | null>(foco ?? nfs[0]?.chave ?? null);
  const [busca, setBusca] = useState("");
  const [dispensa, setDispensa] = useState<{ chave: string; motivo: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const total = nfs.reduce((a, n) => a + Number(n.valor || 0), 0);
  const nf = nfs.find((n) => n.chave === aberta) ?? null;

  const achados = useMemo(() => {
    if (!nf) return [];
    const t = busca.toLowerCase().trim();
    const pcs = pedidos.filter((p) => p.tipo === "PC");
    const l = t ? pcs.filter((p) => [p.num, p.forn, p.cnpj, p.proj].join(" ").toLowerCase().includes(t))
      : pcs.filter((p) => so(p.cnpj) && so(p.cnpj) === so(nf.cnpj)); // sem busca: pedidos do mesmo fornecedor
    return l.slice(0, 15);
  }, [busca, pedidos, nf]);

  const exec = async (body: Record<string, unknown>, msg: string) => {
    setOcupado(true);
    const ok = await onAcao(body, msg);
    setOcupado(false);
    if (ok) { setDispensa(null); setBusca(""); const resto = nfs.filter((n) => n.chave !== body.chave); setAberta(resto[0]?.chave ?? null); }
  };
  const casar = (pedidoId: number, num: string) => nf && exec({ acao: "nf_casar", chave: nf.chave, pedido: pedidoId }, `NF-e ${nf.numero} casada com o pedido ${num}`);

  return (
    <div className="cmp-scrim" style={{ justifyContent: "center", alignItems: "center", padding: 16 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal nfsp" role="dialog" aria-label="NF sem pedido">
        <div className="mh">
          <b style={{ fontSize: 15 }}>⛔ NF-e sem pedido</b>
          <span className="pill p-crit">{nfs.length} · {money(total)}</span>
          <span className="faint" style={{ fontSize: 12 }}>não pagar até casar com um pedido ou dispensar</span>
          <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        {!nfs.length ? <div style={{ padding: 28, textAlign: "center" }} className="muted">Nenhuma NF-e sem pedido. 🎉</div> : (
          <div className="nfsp-body">
            <ul className="nfsp-lista">
              {nfs.map((n) => (
                <li key={n.chave}><button className={n.chave === aberta ? "on" : ""} onClick={() => { setAberta(n.chave); setBusca(""); setDispensa(null); }}>
                  <b>NF-e {n.numero}</b><span className="num">{money(n.valor)}</span>
                  <small>{n.emitente ?? "Emitente?"} · {dBR(String(n.emissao).slice(0, 10), true)}</small>
                  {n.sugestoes?.length ? <small className="sug">{n.sugestoes.length} sugestão(ões)</small> : null}
                </button></li>
              ))}
            </ul>
            {nf && (
              <div className="nfsp-det">
                <div className="nfsp-cab">
                  <div><b>NF-e Nº {nf.numero}</b> · {money(nf.valor)}</div>
                  <div className="muted">{nf.emitente} {nf.cnpj ? `· ${nf.cnpj}` : ""}</div>
                  <div className="faint" style={{ fontSize: 12 }}>Emitida {dBR(String(nf.emissao).slice(0, 10), true)}{nf.chegou ? ` · chegou pela Focus ${dBR(String(nf.chegou).slice(0, 10), true)}` : ""}
                    {nf.completa === false ? " · só resumo (XML completo ainda não veio)" : ""}</div>
                  <div className="faint mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{nf.chave}</div>
                </div>

                <h4>Sugestões</h4>
                {nf.sugestoes?.length ? nf.sugestoes.map((s) => (
                  <div key={s.pedidoId} className="nfsp-sug">
                    <div><b>Pedido {s.num}</b> · {money(s.valor)} <span className="faint">· {s.forn}</span>
                      <div className="faint" style={{ fontSize: 11.5 }}>{s.motivo} · confiança {Math.round(Number(s.score) * 100)}%{s.origem === "omie" ? " · Omie (histórico)" : ""}{s.aprov === "aprovado" ? " · aprovado" : ""}</div></div>
                    <button className="btn sm ok" disabled={ocupado} onClick={() => casar(s.pedidoId, s.num)}>Casar</button>
                  </div>
                )) : <div className="faint" style={{ fontSize: 12.5 }}>Nenhum pedido parecido (fornecedor, valor e data).</div>}

                <h4>Procurar pedido</h4>
                <input className="in" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nº do pedido, fornecedor, CNPJ…" />
                {!busca && achados.length > 0 && <div className="faint" style={{ fontSize: 11.5, margin: "4px 0" }}>Pedidos do mesmo fornecedor:</div>}
                {achados.map((p) => (
                  <div key={p.id} className="nfsp-sug">
                    <div><b>Pedido {p.num}</b> · {money(p.valor)} <span className="faint">· {p.forn}</span>
                      <div className="faint" style={{ fontSize: 11.5 }}>{p.emissao ? dBR(p.emissao, true) : ""} · {p.origem === "omie" ? "Omie (histórico)" : p.aprov === "aprovado" ? "aprovado" : "pendente de aprovação"}</div></div>
                    <button className="btn sm" disabled={ocupado} onClick={() => casar(p.id, p.num)}>Casar</button>
                  </div>
                ))}
                {busca && !achados.length && <div className="faint" style={{ fontSize: 12.5 }}>Nenhum pedido encontrado.</div>}

                <h4>Dispensar</h4>
                {dispensa?.chave === nf.chave ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <textarea className="in" style={{ height: 64 }} autoFocus value={dispensa.motivo} placeholder="Motivo (obrigatório): ex. devolução, bonificação, NF de serviço lançada como produto…"
                      onChange={(e) => setDispensa({ chave: nf.chave, motivo: e.target.value })} />
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn sm crit" disabled={ocupado || dispensa.motivo.trim().length < 5}
                        onClick={() => exec({ acao: "nf_dispensar", chave: nf.chave, motivo: dispensa.motivo.trim() }, `NF-e ${nf.numero} dispensada`)}>Dispensar NF</button>
                      <button className="btn sm ghost" onClick={() => setDispensa(null)}>Cancelar</button>
                    </div>
                  </div>
                ) : <button className="btn sm ghost" onClick={() => setDispensa({ chave: nf.chave, motivo: "" })}>Não tem pedido — dispensar…</button>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
