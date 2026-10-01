"use client";

/**
 * Novo Recebimento. A NF chega pela Focus NFe (orders.focus_recebidos) e
 * aparece aqui como candidata do pedido — a pessoa confirma ("é esta") em vez
 * de digitar o número. Sem candidata, digita como antes. Recebimento parcial
 * deixa o pedido em "Faturado pelo Fornecedor" com saldo a receber.
 */

import { useEffect, useState } from "react";
import { money, num2, qtd as fq, parseNum, hoje, dBR, type Pedido, type PedidoLista } from "@/lib/compras";

type NfCand = {
  chave: string; origem: "xped" | "texto" | "resumo"; score: number; motivo: string; status: string;
  numero: string | null; emissao: string; valor: number; emitente: string; cnpj: string; completa: boolean | null;
  outrosPedidos: string[];
  itens: { n: string; cod: string; desc: string; ncm: string; un: string; qtd: number; vu: number; total: number; xped: string | null }[];
};

const json = async <T,>(r: Response): Promise<T> => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? r.statusText);
  return j as T;
};

export default function FolhaRecebimento({ id, candidatos, onClose, onFeito, toast }: {
  id: number | null; candidatos: PedidoLista[]; onClose: () => void;
  onFeito: (msg: string) => void; toast: (m: string, erro?: boolean) => void;
}) {
  const [pid, setPid] = useState<number | null>(id ?? candidatos[0]?.id ?? null);
  const [p, setP] = useState<Pedido | null>(null);
  const [nfs, setNfs] = useState<NfCand[] | null>(null);
  const [nfSel, setNfSel] = useState<string | null>(null);
  const [nf, setNf] = useState(""); const [chave, setChave] = useState(""); const [dt, setDt] = useState(hoje());
  const [rec, setRec] = useState<Record<number, number>>({});
  const [ocupado, setOcupado] = useState(false);
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!pid) return;
    let vivo = true;
    setP(null); setNfs(null); setNfSel(null);
    (async () => {
      try {
        const [ped, cand] = await Promise.all([
          json<Pedido>(await fetch(`/api/compras/pedido?id=${pid}`)),
          json<NfCand[]>(await fetch(`/api/compras/nfs?id=${pid}`)).catch(() => [] as NfCand[]),
        ]);
        if (!vivo) return;
        setP(ped); setNfs(cand);
        setNf(ped.nf ?? ""); setChave(ped.chave ?? "");
        setRec(Object.fromEntries((ped.itens ?? []).map((i) => [i.id!, Number(i.qtd) || 0])));
      } catch (e) { toast((e as Error).message, true); }
    })();
    return () => { vivo = false; };
  }, [pid, toast]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const usarNf = (c: NfCand) => {
    setNfSel(c.chave); setNf(c.numero ?? c.chave.slice(25, 34).replace(/^0+/, "")); setChave(c.chave);
    setDt(hoje());
    // Com o XML completo, puxa a quantidade da NF para os itens de mesmo código.
    if (p && c.itens.length) {
      setRec((r) => {
        const n = { ...r };
        p.itens.forEach((it) => {
          const hit = c.itens.find((x) => x.cod && it.cod && x.cod.trim().toLowerCase() === it.cod.trim().toLowerCase());
          if (hit) n[it.id!] = Number(hit.qtd) || 0;
        });
        return n;
      });
    }
  };

  const descartar = async (c: NfCand) => {
    if (!p) return;
    try {
      await json(await fetch("/api/compras/acao", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "nf", chave: c.chave, pedido: p.id, status: "descartado" }) }));
      setNfs((l) => (l ?? []).filter((x) => x.chave !== c.chave));
      if (nfSel === c.chave) { setNfSel(null); setNf(""); setChave(""); }
      toast("NF descartada para este pedido");
    } catch (e) { toast((e as Error).message, true); }
  };

  const registrar = async (final: boolean) => {
    if (!p || ocupado) return;
    if (!nf.trim()) { toast("Informe o número da NF-e (ou escolha a que chegou pela Focus)", true); return; }
    setOcupado(true);
    try {
      const r = await json<{ etapa: string; parcial: boolean }>(await fetch("/api/compras/acao", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "receber", id: p.id, nf: nf.trim(), chave: chave.trim() || null, dt, final,
          qtds: Object.entries(rec).map(([id, q]) => ({ id: Number(id), qtd: q })), chaveFocus: nfSel }),
      }));
      onFeito(r.etapa === "60" ? `Pedido ${p.num} recebido` : `Pedido ${p.num} em Faturado pelo Fornecedor${r.parcial ? " — saldo a receber" : ""}`);
    } catch (e) { toast((e as Error).message, true); }
    finally { setOcupado(false); }
  };

  const lista = candidatos.some((c) => c.id === pid) || !p ? candidatos
    : [{ id: p.id!, num: p.num, forn: p.forn, valor: p.valor } as PedidoLista, ...candidatos];
  const bloqueado = p?.origem === "painel" && p.aprov !== "aprovado";

  return (
    <div className="cmp-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmp" style={{ display: "contents" }}>
        <div className="sheet" style={{ width: "min(900px,100%)" }} role="dialog" aria-modal="true" aria-label="Novo Recebimento">
          <div className="sh-head"><h2>Novo Recebimento</h2><span className="sp" /><button className="btn ghost" onClick={onClose}>Fechar ✕</button></div>
          <div style={{ padding: "16px 20px", overflow: "auto", display: "grid", gap: 14 }}>
            <section className="card2"><div className="gridf">
              <div className="f s12"><label>Pedido de Compra</label>
                <select className="in" value={pid ?? ""} onChange={(e) => setPid(Number(e.target.value) || null)}>
                  {!lista.length && <option value="">Nenhum pedido aprovado aguardando entrega</option>}
                  {lista.map((x) => <option key={x.id} value={x.id}>Pedido {x.num} · {x.forn || "—"} · {money(x.valor)}</option>)}
                </select></div>
            </div></section>

            {bloqueado && <div className="aviso p-warn">Este pedido ainda não foi aprovado — aprove antes de registrar o recebimento.</div>}

            {p && (
              <section className="card2">
                <h4 style={{ margin: "0 0 8px", fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--tx-4)" }}>NF chegou pela Focus</h4>
                {nfs == null && <div className="empty">Procurando NF-e…</div>}
                {nfs?.length === 0 && <div className="inline-note">Nenhuma NF-e da Focus parece ser deste pedido ainda. Se a nota já chegou por outro caminho, digite o número abaixo.</div>}
                <div style={{ display: "grid", gap: 8 }}>
                  {nfs?.map((c) => (
                    <div key={c.chave} className={`nfcard${nfSel === c.chave ? " on" : ""}`}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <b>NF-e {c.numero ?? c.chave.slice(25, 34)}</b>
                        <span className={`pill ${c.score >= 1 ? "p-ok" : c.score >= 0.7 ? "p-sky" : "p-warn"}`}>
                          {c.origem === "resumo" ? `provável · ${Math.round(c.score * 100)}%` : c.score >= 1 ? "cita este pedido" : "cita este pedido · confira"}</span>
                        {c.status === "confirmado" && <span className="pill p-acc">confirmada</span>}
                        <span className="faint">{dBR(c.emissao?.slice(0, 10))}</span>
                        <span style={{ flex: 1 }} /><b className="num">{money(c.valor)}</b>
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>{c.emitente} · {c.cnpj}</div>
                      <div className="hint">{c.motivo}{c.outrosPedidos.length ? ` · também pode ser de ${c.outrosPedidos.map((n) => "PC " + n).join(", ")}` : ""}
                        {c.completa === false ? " · só o resumo (sem itens)" : ""}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn sm pri" onClick={() => usarNf(c)}>{nfSel === c.chave ? "✓ Usando esta NF" : "É esta — usar esta NF"}</button>
                        {c.itens.length > 0 && <button className="btn sm ghost" onClick={() => setAbertos((a) => ({ ...a, [c.chave]: !a[c.chave] }))}>
                          {abertos[c.chave] ? "Ocultar itens" : `Ver ${c.itens.length} item(ns) da NF`}</button>}
                        <button className="btn sm ghost" onClick={() => descartar(c)}>Não é deste pedido</button>
                      </div>
                      {abertos[c.chave] && (
                        <div className="items-wrap"><table className="items" style={{ minWidth: 560 }}>
                          <thead><tr><th>Código</th><th>Descrição</th><th className="r">Qtde</th><th>Un</th><th className="r">Valor unit.</th><th className="r">Total</th><th>Pedido citado</th></tr></thead>
                          <tbody>{c.itens.map((x, i) => (
                            <tr key={i}><td className="mono">{x.cod}</td><td>{x.desc}</td><td className="r num">{fq(x.qtd)}</td><td>{x.un}</td>
                              <td className="r num">{money(x.vu)}</td><td className="r num">{money(x.total)}</td><td>{x.xped ?? "—"}</td></tr>
                          ))}</tbody></table></div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {p && (
              <section className="card2">
                <div className="gridf" style={{ marginBottom: 12 }}>
                  <div className="f s4"><label>NF-e nº</label><input className="in" value={nf} onChange={(e) => { setNf(e.target.value); setNfSel(null); }} placeholder="000123456" /></div>
                  <div className="f s3"><label>Recebido em</label><input className="in" type="date" value={dt} onChange={(e) => setDt(e.target.value)} /></div>
                  <div className="f s5"><label>Chave de acesso (opcional)</label><input className="in mono" value={chave} onChange={(e) => setChave(e.target.value.replace(/\s/g, ""))} placeholder="44 dígitos" /></div>
                </div>
                <div className="items-wrap"><table className="items" style={{ minWidth: 560 }}>
                  <thead><tr><th>Produto</th><th className="r">Pedido</th><th className="r">Recebido</th><th>Un</th></tr></thead>
                  <tbody>{p.itens.map((it) => (
                    <tr key={it.id}>
                      <td style={{ paddingTop: 11 }}>{it.desc}<div className="hint mono">{it.cod}</div></td>
                      <td className="r num" style={{ paddingTop: 11 }}>{fq(it.qtd)}</td>
                      <td style={{ width: 130 }}><input className="in r" key={`${it.id}-${rec[it.id!]}`} defaultValue={num2(rec[it.id!] ?? 0)}
                        onBlur={(e) => setRec((r) => ({ ...r, [it.id!]: parseNum(e.target.value) }))} /></td>
                      <td style={{ paddingTop: 11 }}>{it.un}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
                <div className="hint" style={{ marginTop: 6 }}>Recebimento parcial mantém o pedido em “Faturado pelo Fornecedor” com saldo a receber.</div>
              </section>
            )}
            <div className="addrow">
              <button className="btn pri" disabled={!p || bloqueado || ocupado} onClick={() => registrar(true)}>📦 Registrar recebimento</button>
              <button className="btn ghost" disabled={!p || bloqueado || ocupado} onClick={() => registrar(false)}>Só marcar como faturado pelo fornecedor</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
