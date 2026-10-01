"use client";

/**
 * "Gerar pedido a partir da NF" — para a NF-e que chegou sem pedido. Mostra a
 * prévia (fornecedor, itens casados com o catálogo, totais, parcelas) e pede a
 * categoria (padrão: a do último pedido do fornecedor) e o projeto (opcional).
 * O pedido nasce PENDENTE, já casado com a NF; aprovado, vai direto para
 * Faturado; cancelado ou não aprovado, a NF volta para "NF sem pedido".
 */

import { useEffect, useMemo, useState } from "react";
import { money, dBR, type Refs } from "@/lib/compras";

type ItemPrevia = { desc: string; descNf: string; cod: string | null; casado: boolean; codForn: string | null; ncm: string | null;
  un: string; qtd: number; vu: number; desc0: number; ipi: number; st: number };
type Previa = { chave: string; numero: string; emissao: string; valorNf: number; forn: string; fornCod: number | null; fornCadastrado: boolean;
  cnpj: string; catCod: string | null; cat: string | null; conta: string | null; frete: { valor: number; seguro: number; outras: number };
  itens: ItemPrevia[]; parcelas: { venc: string; valor: number }[] };

export default function ModalPcDaNf({ chave, refs, onClose, onGerado, toast }: {
  chave: string; refs: Refs | null; onClose: () => void;
  onGerado: (r: { id: number; num: string }) => void; toast: (m: string, erro?: boolean) => void;
}) {
  const [d, setD] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [catCod, setCatCod] = useState("");
  const [projCod, setProjCod] = useState("");
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/compras/nf-gerar-pc?chave=${chave}`); const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setD(j); setCatCod(j.catCod ?? "");
      } catch (e) { setErro((e as Error).message); }
    })();
  }, [chave]);

  const linha = (i: ItemPrevia) => i.qtd * i.vu - (i.desc0 || 0) + (i.ipi || 0) + (i.st || 0);
  const total = useMemo(() => d ? Math.round((d.itens.reduce((a, i) => a + linha(i), 0) + d.frete.valor + d.frete.seguro + d.frete.outras) * 100) / 100 : 0, [d]);
  const cat = refs?.categorias.find((c) => c.cod === catCod);
  const proj = refs?.projetos.find((p) => String(p.cod) === projCod);
  const difere = d ? Math.abs(total - Number(d.valorNf)) > 0.05 : false;

  const gerar = async () => {
    if (!d || !catCod) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/compras/nf-gerar-pc", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave, catCod, cat: cat?.desc ?? d.cat ?? catCod, projCod: projCod || null, proj: proj?.nome ?? null }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      onGerado(j);
    } catch (e) { toast((e as Error).message, true); setOcupado(false); setConfirmar(false); }
  };

  return (
    <div className="cmp-scrim" style={{ justifyContent: "center", alignItems: "center", padding: 16, zIndex: 80 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onClose(); }}>
      <div className="modal pcnf" role="dialog" aria-label="Gerar pedido a partir da NF">
        <div className="mh">
          <b style={{ fontSize: 15 }}>Gerar pedido a partir da NF-e {d?.numero ?? ""}</b>
          <span className="faint" style={{ fontSize: 12 }}>o pedido nasce pendente e precisa ser aprovado</span>
          <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Fechar" disabled={ocupado}>✕</button>
        </div>
        {erro && <div style={{ padding: 18 }} className="pill p-crit">{erro}</div>}
        {!d && !erro && <div style={{ padding: 28, textAlign: "center" }} className="muted">Lendo a NF-e…</div>}
        {d && (
          <div style={{ padding: "14px 18px", display: "grid", gap: 14 }}>
            <div className="pcnf-cab">
              <div><small className="faint">Fornecedor</small><b>{d.forn}</b>
                <span className="faint" style={{ fontSize: 12 }}>{d.cnpj}{d.fornCadastrado ? " · cadastrado" : " · ⚠ não achei no cadastro do Omie (fica só o nome/CNPJ)"}</span></div>
              <div><small className="faint">NF-e</small><b className="num">Nº {d.numero}</b><span className="faint" style={{ fontSize: 12 }}>emitida {dBR(d.emissao, true)} · {money(Number(d.valorNf))}</span></div>
            </div>

            <div className="tbl-wrap" style={{ maxHeight: 260 }}>
              <table className="grid">
                <thead><tr><th>Item</th><th>NCM</th><th className="r">Qtd</th><th className="r">Valor unit.</th><th className="r">Desc.</th><th className="r">IPI</th><th className="r">ST</th><th className="r">Total</th></tr></thead>
                <tbody>
                  {d.itens.map((i, k) => (
                    <tr key={k}>
                      <td><div style={{ fontWeight: 600 }}>{i.desc}</div>
                        <div className="faint" style={{ fontSize: 11.5 }}>{i.casado ? <><span className="pill p-ok">catálogo {i.cod}</span> NF: {i.descNf}</> : <>sem produto no catálogo — fica a descrição da NF{i.codForn ? ` · cód. fornecedor ${i.codForn}` : ""}</>}</div></td>
                      <td className="mono">{i.ncm ?? "—"}</td>
                      <td className="r num">{Number(i.qtd).toLocaleString("pt-BR")} {i.un}</td>
                      <td className="r num">{money(i.vu)}</td>
                      <td className="r num">{i.desc0 ? money(i.desc0) : "—"}</td>
                      <td className="r num">{i.ipi ? money(i.ipi) : "—"}</td>
                      <td className="r num">{i.st ? money(i.st) : "—"}</td>
                      <td className="r num"><b>{money(linha(i))}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pcnf-tot">
              <span>Total do pedido <b className="num">{money(total)}</b></span>
              {difere && <span className="pill p-warn">NF {money(Number(d.valorNf))} — diferença de {money(Math.abs(total - Number(d.valorNf)))}</span>}
              <span className="faint">Parcelas: {d.parcelas.map((p) => `${dBR(String(p.venc).slice(0, 10), true)} ${money(Number(p.valor))}`).join(" · ")}</span>
            </div>

            <div className="pcnf-campos">
              <label><small>Categoria <span style={{ color: "var(--ww-crit-text)" }}>*</span>{d.catCod ? <span className="faint"> · padrão: último pedido do fornecedor</span> : null}</small>
                <select className="in" value={catCod} onChange={(e) => setCatCod(e.target.value)} disabled={ocupado}>
                  <option value="">Escolha…</option>
                  {d.catCod && !refs?.categorias.some((c) => c.cod === d.catCod) && <option value={d.catCod}>{d.catCod} · {d.cat}</option>}
                  {(refs?.categorias ?? []).map((c) => <option key={c.cod} value={c.cod}>{c.cod} · {c.desc}</option>)}
                </select></label>
              <label><small>Projeto (opcional)</small>
                <select className="in" value={projCod} onChange={(e) => setProjCod(e.target.value)} disabled={ocupado}>
                  <option value="">Sem projeto</option>
                  {(refs?.projetos ?? []).map((p) => <option key={p.cod} value={String(p.cod)}>{p.nome}</option>)}
                </select></label>
            </div>
            <div className="faint" style={{ fontSize: 12 }}>
              Numerado na sequência normal, com o selo “Gerado da NF” e já casado com esta NF. Fica em Pedido de Compra › Pendentes
              (o título da NF no Contas a Pagar mostra “⛔ aguardando aprovação do pedido”). Aprovado, vai direto para Faturado;
              cancelado ou não aprovado, a NF volta para “NF sem pedido”.
            </div>
          </div>
        )}
        <div className="mf">
          {confirmar && d ? <>
            <span style={{ marginRight: "auto", fontSize: 13 }}>Gerar o pedido de <b>{money(total)}</b> para <b>{d.forn}</b> ({cat?.desc ?? catCod})?</span>
            <button className="btn" onClick={() => setConfirmar(false)} disabled={ocupado}>Voltar</button>
            <button className="btn pri" data-confirmar-gerar onClick={gerar} disabled={ocupado}>{ocupado ? "Gerando…" : "Confirmar e gerar"}</button>
          </> : <>
            <button className="btn" onClick={onClose}>Cancelar</button>
            <button className="btn pri" disabled={!d || !catCod} onClick={() => setConfirmar(true)}>Gerar pedido…</button>
          </>}
        </div>
      </div>
    </div>
  );
}
