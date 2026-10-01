"use client";

/**
 * Conferência do pedido (→ Conferido, libera o pagamento). Cada item da NF do
 * fornecedor aparece como "na NF: <xProd> (cód. fornecedor X)" → "nosso item:"
 * com o de-para já conhecido (compras.item_fornecedor_alias, sql/37) ou uma
 * sugestão; a pessoa confirma/corrige e o de-para fica gravado para as
 * próximas NFs do mesmo fornecedor. Estoque movimenta sempre o NOSSO item.
 */

import { useEffect, useState } from "react";
import Autocompletar from "./Autocompletar";
import { money, qtd as fq } from "@/lib/compras";

type Nosso = { ncodProd: number; cod: string | null; desc: string; un?: string | null };
type ItemNf = { chave: string; nf: string; n: string; cprod: string | null; xprod: string; ncm: string | null; un: string;
  qtd: number | null; vu: number | null; total: number | null;
  alias: (Nosso & { fator: number; por: string; em: string; pc: string | null; vezes: number }) | null;
  sugestao: (Nosso & { como: string }) | null };
type Dados = { pedido: { id: number; num: string; forn: string; cnpj: string; etapa: string; aprov: string };
  itensPc: { seq: number; ncodProd: number | null; cod: string | null; desc: string; un: string; qtd: number; qtdRec: number | null }[];
  itensNf: ItemNf[] };
type Linha = { nosso: Nosso | null; fator: number; tocado: boolean };
type ItemCat = { ncod_prod: number; codigo: string | null; descricao: string; unidade: string | null };

export default function FolhaConferencia({ id, onClose, onConferido, toast }: {
  id: number; onClose: () => void; onConferido: (msg: string) => void; toast: (m: string, erro?: boolean) => void;
}) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<Record<string, Linha>>({});
  const [busca, setBusca] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const k = (i: ItemNf) => `${i.chave}:${i.n}`;

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/compras/conferencia?id=${id}`); const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setD(j);
        const l: Record<string, Linha> = {};
        for (const i of j.itensNf as ItemNf[]) {
          const n = i.alias ?? i.sugestao;
          l[`${i.chave}:${i.n}`] = { nosso: n ? { ncodProd: n.ncodProd, cod: n.cod, desc: n.desc, un: n.un } : null, fator: i.alias?.fator ?? 1, tocado: false };
        }
        setLinhas(l);
      } catch (e) { setErro((e as Error).message); }
    })();
  }, [id]);

  const set = (key: string, p: Partial<Linha>) => setLinhas((l) => ({ ...l, [key]: { ...l[key], ...p, tocado: true } }));
  const faltam = d ? d.itensNf.filter((i) => !linhas[k(i)]?.nosso).length : 0;

  const conferir = async () => {
    if (!d) return;
    setOcupado(true);
    try {
      const mapeamentos = d.itensNf.map((i) => {
        const l = linhas[k(i)];
        return l?.nosso ? { chave: i.chave, nf: i.nf, cprod: i.cprod, xprod: i.xprod, ncm: i.ncm, unForn: i.un,
          ncodProd: l.nosso.ncodProd, cod: l.nosso.cod, desc: l.nosso.desc, un: l.nosso.un, fator: l.fator } : null;
      }).filter(Boolean);
      if (mapeamentos.length) {
        const r = await fetch("/api/compras/conferencia", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, mapeamentos }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText);
      }
      const r2 = await fetch("/api/compras/acao", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "mover", id, etapa: "80" }) });
      const j2 = await r2.json(); if (!r2.ok) throw new Error(j2.error ?? r2.statusText);
      onConferido(`PC ${d.pedido.num} conferido${mapeamentos.length ? ` · ${mapeamentos.length} de-para gravado(s)` : ""} — liberado para pagar`);
    } catch (e) { toast((e as Error).message, true); setOcupado(false); }
  };

  const opcoesPc = (d?.itensPc ?? []).filter((x) => x.ncodProd);

  return (
    <div className="cmp-scrim" style={{ justifyContent: "center", alignItems: "center", padding: 16, zIndex: 80 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !ocupado) onClose(); }}>
      <div className="modal confer" role="dialog" aria-label="Conferência do pedido">
        <div className="mh">
          <b style={{ fontSize: 15 }}>Conferência · PC {d?.pedido.num ?? ""}</b>
          <span className="faint" style={{ fontSize: 12 }}>{d?.pedido.forn} · confira cada item da NF com o nosso item</span>
          <button className="btn sm ghost" style={{ marginLeft: "auto" }} onClick={onClose} aria-label="Fechar" disabled={ocupado}>✕</button>
        </div>
        {erro && <div style={{ padding: 18 }}><span className="pill p-crit">{erro}</span></div>}
        {!d && !erro && <div style={{ padding: 28, textAlign: "center" }} className="muted">Lendo as NFs do pedido…</div>}
        {d && (
          <div style={{ padding: "12px 18px", display: "grid", gap: 10, maxHeight: "68vh", overflow: "auto" }}>
            {!d.itensNf.length && <div className="muted">Este pedido não tem NF-e casada com itens (Focus) — confira pelos itens do pedido e confirme.</div>}
            {d.itensNf.map((i) => {
              const key = k(i); const l = linhas[key]; const difUn = l?.nosso?.un && i.un && l.nosso.un.toUpperCase() !== i.un.toUpperCase();
              return (
                <div key={key} className={`confer-linha${l?.nosso ? "" : " falta"}`}>
                  <div className="lado nf">
                    <small className="faint">na NF {i.nf} · item {i.n}</small>
                    <b>{i.xprod}</b>
                    <span className="faint" style={{ fontSize: 12 }}>{i.cprod ? `cód. fornecedor ${i.cprod}` : "sem código do fornecedor"}{i.ncm ? ` · NCM ${i.ncm}` : ""}</span>
                    <span className="num" style={{ fontSize: 12.5 }}>{i.qtd != null ? fq(i.qtd) : "—"} {i.un} · {i.vu != null ? money(i.vu) : "—"} · <b>{i.total != null ? money(i.total) : "—"}</b></span>
                  </div>
                  <div className="seta">→</div>
                  <div className="lado nosso">
                    <small className="faint">nosso item
                      {i.alias && !l?.tocado ? <span className="pill p-ok" style={{ marginLeft: 6 }}>de-para conhecido{i.alias.vezes > 1 ? ` · ${i.alias.vezes}×` : ""}</span>
                        : i.sugestao && !l?.tocado ? <span className="pill p-warn" style={{ marginLeft: 6 }}>sugestão ({i.sugestao.como}) — confirme</span> : null}</small>
                    <select className="in" disabled={ocupado} value={l?.nosso ? String(l.nosso.ncodProd) : ""}
                      onChange={(e) => {
                        const v = Number(e.target.value); const pc = opcoesPc.find((x) => x.ncodProd === v);
                        set(key, { nosso: pc ? { ncodProd: v, cod: pc.cod, desc: pc.desc, un: pc.un } : l?.nosso && l.nosso.ncodProd === v ? l.nosso : null });
                      }}>
                      <option value="">Escolha o nosso item…</option>
                      {l?.nosso && !opcoesPc.some((x) => x.ncodProd === l.nosso!.ncodProd) &&
                        <option value={String(l.nosso.ncodProd)}>{l.nosso.desc}{l.nosso.cod ? ` (${l.nosso.cod})` : ""}</option>}
                      {opcoesPc.map((x) => <option key={x.seq} value={String(x.ncodProd)}>Item {x.seq} do PC · {x.desc}{x.cod ? ` (${x.cod})` : ""}</option>)}
                    </select>
                    <Autocompletar<ItemCat> value={busca[key] ?? ""} minimo={2} placeholder="…ou outro item do catálogo (código ou descrição)" disabled={ocupado}
                      onChange={(v) => setBusca((b) => ({ ...b, [key]: v }))}
                      fonte={async (q) => ((await (await fetch(`/api/compras/buscar?tipo=produto&q=${encodeURIComponent(q)}`)).json()) as ItemCat[])
                        .map((p) => ({ label: p.descricao, sub: `${p.codigo ?? "—"} · ${p.unidade ?? "UN"}`, v: p }))}
                      onPick={(o) => { set(key, { nosso: { ncodProd: o.v.ncod_prod, cod: o.v.codigo, desc: o.v.descricao, un: o.v.unidade } }); setBusca((b) => ({ ...b, [key]: "" })); }} />
                    {(difUn || (l && l.fator !== 1)) && (
                      <label className="faint" style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center" }}>
                        1 {i.un || "un."} da NF = <input className="in r" style={{ width: 80, height: 28 }} defaultValue={String(l?.fator ?? 1)} disabled={ocupado}
                          onBlur={(e) => { const f = Number(e.target.value.replace(",", ".")); if (f > 0) set(key, { fator: f }); }} /> {l?.nosso?.un ?? "un."} nossas
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="mf">
          {d && faltam > 0 && <span className="pill p-warn" style={{ marginRight: "auto" }}>{faltam} item(ns) da NF sem o nosso item — escolha para gravar o de-para</span>}
          <button className="btn" onClick={onClose} disabled={ocupado}>Cancelar</button>
          <button className="btn pri" disabled={!d || ocupado || d.pedido.aprov !== "aprovado"} onClick={conferir}
            title={d && d.pedido.aprov !== "aprovado" ? "Só pedido aprovado é conferido" : "Grava o de-para e marca o pedido como Conferido (libera o pagamento)"}>
            {ocupado ? "Conferindo…" : "✓ Conferir e liberar pagamento"}</button>
        </div>
      </div>
    </div>
  );
}
