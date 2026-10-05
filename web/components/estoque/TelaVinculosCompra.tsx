"use client";

import { useEffect, useMemo, useState } from "react";
import AcertoItemEstoque from "@/components/faturamento/AcertoItemEstoque";
import "@/components/faturamento/nova-emissao.css";

/* Estoque › Códigos de compra (05/10/26). Produtos comprados (PCs do Omie dos
   últimos 12 meses) que não são item do nosso estoque. Enquanto não forem
   vinculados a um item nosso (ou cadastrados), não entram em nota que movimenta
   estoque. Sugestões pela descrição; vínculo em lote só para as muito parecidas. */

type Sug = { n_cod_prod: number; codigo: string; descricao: string; saldo: number | null; sim: number };
type Pend = { n_cod_prod: number; codigo: string | null; descricao: string; n_pcs: number; ultima: string | null; preco: number | null;
  fornecedor: string | null; sugestoes: Sug[] };
type Feito = { id: number; n_cod_prod_origem: number; codigo_origem: string | null; descricao_origem: string | null; fornecedor: string | null;
  n_cod_prod_destino: number; origem: string; criado_por: string; criado_em: string };

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—");

export default function TelaVinculosCompra() {
  const [aba, setAba] = useState<"pend" | "feitos">("pend");
  const [pend, setPend] = useState<Pend[] | null>(null);
  const [feitos, setFeitos] = useState<Feito[] | null>(null);
  const [q, setQ] = useState("");
  const [acerto, setAcerto] = useState<Pend | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function carregar() {
    fetch("/api/estoque/vinculos?op=pendentes", { cache: "no-store" }).then((x) => x.json()).then((j) => setPend(j.pendentes ?? [])).catch(() => setPend([]));
    fetch("/api/estoque/vinculos?op=feitos", { cache: "no-store" }).then((x) => x.json()).then((j) => setFeitos(j.vinculos ?? [])).catch(() => setFeitos([]));
  }
  useEffect(carregar, []);

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (pend ?? []).filter((p) => !t || p.descricao.toLowerCase().includes(t) || (p.codigo ?? "").toLowerCase().includes(t) || (p.fornecedor ?? "").toLowerCase().includes(t));
  }, [pend, q]);
  const fortes = useMemo(() => (pend ?? []).filter((p) => p.sugestoes?.[0] && Number(p.sugestoes[0].sim) >= 0.9 && !(p.sugestoes[1] && Number(p.sugestoes[1].sim) >= 0.9)), [pend]);

  async function vincular(origem: number, destino: number) {
    const r = await fetch("/api/estoque/vinculos", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "vincular", origem, destino }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) { setMsg(r.error); return false; }
    return true;
  }
  async function vincularUm(p: Pend, s: Sug) {
    setOcupado(true);
    if (await vincular(p.n_cod_prod, s.n_cod_prod)) { setMsg(`${p.codigo ?? p.n_cod_prod} vinculado a ${s.codigo}.`); carregar(); }
    setOcupado(false);
  }
  async function vincularFortes() {
    if (!window.confirm(`Vincular ${fortes.length} código(s) à sugestão com semelhança ≥ 90% (e sem outra parecida)? Dá para desfazer na aba Vinculados.`)) return;
    setOcupado(true);
    let ok = 0;
    for (const p of fortes) if (await vincular(p.n_cod_prod, p.sugestoes[0].n_cod_prod)) ok++;
    setOcupado(false); setMsg(`${ok} de ${fortes.length} vinculados.`); carregar();
  }
  async function desfazer(id: number) {
    setOcupado(true);
    await fetch("/api/estoque/vinculos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "desfazer", id }) });
    setOcupado(false); carregar();
  }

  const porOrigem = (o: string) => (feitos ?? []).filter((f) => f.origem === o).length;
  return (
    <div style={{ padding: "18px 22px", maxWidth: 1400, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>Estoque › Códigos de compra</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "2px 0" }}>Códigos de compra sem item nosso</h1>
          <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>Produtos comprados nos últimos 12 meses que não são item do nosso estoque. Enquanto não forem vinculados (ou cadastrados), não entram em nota que movimenta estoque.</div>
        </div>
        {aba === "pend" && fortes.length > 0 && <button className="ne-btn pri" disabled={ocupado} onClick={vincularFortes}>Vincular {fortes.length} muito parecidos (≥ 90%)</button>}
      </div>

      <div style={{ display: "flex", gap: 12, margin: "14px 0", flexWrap: "wrap" }}>
        {[["Pendentes", pend?.length ?? "…"], ["Vinculados à mão", porOrigem("manual")], ["Cadastrados no estoque", porOrigem("cadastro")], ["Automáticos (descrição idêntica)", porOrigem("auto_desc")]].map(([l, v]) => (
          <div key={String(l)} style={{ border: "1px solid var(--ww-border)", borderRadius: 12, padding: "10px 14px", minWidth: 170 }}>
            <div style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700 }}>{v}</div></div>))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <button className={aba === "pend" ? "ne-btn pri" : "ne-btn"} onClick={() => setAba("pend")}>Pendentes</button>
        <button className={aba === "feitos" ? "ne-btn pri" : "ne-btn"} onClick={() => setAba("feitos")}>Vinculados</button>
        {aba === "pend" && <input className="ne-in" style={{ flex: 1, maxWidth: 420 }} placeholder="Buscar código, descrição ou fornecedor…" value={q} onChange={(e) => setQ(e.target.value)} />}
      </div>
      {msg && <div className="ne-aviso" style={{ marginBottom: 10 }}>{msg}</div>}
      {acerto && <AcertoItemEstoque empresa="SF" compra={{ n_cod_prod: acerto.n_cod_prod, codigo: acerto.codigo, descricao: acerto.descricao, unidade: null,
        ultimo_preco: acerto.preco, fornecedor: acerto.fornecedor, ncm: null }} onFechar={() => setAcerto(null)}
        onPronto={(cod) => { setAcerto(null); setMsg(`${acerto.codigo ?? acerto.n_cod_prod} agora é o item ${cod}.`); carregar(); }} />}

      {aba === "pend" ? (
        <table className="ne-tab" style={{ width: "100%" }}>
          <thead><tr><th>Código de compra</th><th>Descrição</th><th>Fornecedor</th><th className="r">PCs</th><th>Última</th><th className="r">Preço</th><th>Sugestões do estoque</th><th /></tr></thead>
          <tbody>{pend == null ? <tr><td colSpan={8}>Carregando…</td></tr> : lista.length === 0 ? <tr><td colSpan={8}>Nada pendente.</td></tr> : lista.map((p) => (
            <tr key={p.n_cod_prod}>
              <td><span className="ne-comp-cod">{p.codigo ?? p.n_cod_prod}</span></td>
              <td style={{ maxWidth: 340 }}>{p.descricao}</td>
              <td>{p.fornecedor ?? "—"}</td>
              <td className="r">{p.n_pcs}</td>
              <td>{dt(p.ultima)}</td>
              <td className="r">{p.preco != null ? fmt(Number(p.preco)) : "—"}</td>
              <td>{(p.sugestoes ?? []).length === 0 ? <small style={{ color: "var(--ww-text-faint)" }}>sem parecido</small> : p.sugestoes.map((s) => (
                <div key={s.n_cod_prod} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
                  <button className="ne-lk" disabled={ocupado} onClick={() => vincularUm(p, s)} title="vincular a este item">vincular</button>
                  <b>{s.codigo}</b> <span style={{ color: "var(--ww-text-muted)" }}>{s.descricao.slice(0, 60)} · {Math.round(Number(s.sim) * 100)}%</span>
                </div>))}</td>
              <td><button className="ne-btn" onClick={() => setAcerto(p)}>Acertar…</button></td>
            </tr>))}</tbody>
        </table>
      ) : (
        <table className="ne-tab" style={{ width: "100%" }}>
          <thead><tr><th>Código de compra</th><th>Descrição</th><th>Fornecedor</th><th>Como</th><th>Por</th><th>Quando</th><th /></tr></thead>
          <tbody>{(feitos ?? []).map((f) => (
            <tr key={f.id}>
              <td><span className="ne-comp-cod">{f.codigo_origem ?? f.n_cod_prod_origem}</span></td>
              <td>{f.descricao_origem}</td><td>{f.fornecedor ?? "—"}</td>
              <td>{f.origem === "auto_desc" ? "automático" : f.origem === "cadastro" ? "cadastrado" : "à mão"}</td>
              <td>{f.criado_por}</td><td>{new Date(f.criado_em).toLocaleString("pt-BR")}</td>
              <td><button className="ne-lk" disabled={ocupado} onClick={() => desfazer(f.id)}>desfazer</button></td>
            </tr>))}</tbody>
        </table>
      )}
    </div>
  );
}
