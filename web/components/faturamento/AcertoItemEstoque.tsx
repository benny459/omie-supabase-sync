"use client";

import { useEffect, useState } from "react";

/* Acertar um código de compra na hora da emissão (05/10/26). Pedido do Benny:
   "assim a gente acerta o nosso estoque". Código de compra (produto do Omie que
   nunca entrou no estoque nosso) não vai para a nota; aqui ele vira item nosso:
   - "Já existe?" — prováveis itens do estoque (mais parecidos primeiro) + busca → vincular;
   - "Cadastrar no estoque" — próximo código da família (sugerida pelo item mais
     parecido), descrição/NCM/unidade/último preço já preenchidos → cria e vincula.
   A trava de duplicados roda no cadastro: parecido demais → "já existe, usar este". */

type Compra = { n_cod_prod: number; codigo: string | null; descricao: string; unidade: string | null; ultimo_preco: number | null;
  fornecedor: string | null; ncm: string | null };
type Parecido = { n_cod_prod: number; codigo_novo: string | null; descricao: string; saldo: number | null; sim: number; igual?: boolean };
type Familia = { id: number; nome: string; prefixo: string | null };
type Nativo = { n_cod_prod?: number; codigo: string; descricao: string; saldo: number | null };
type Info = { em_estoque: boolean; saldo: number | null; cmc: number | null; comprado: number; pcs: number; saldo_estimado: number;
  compras_recebidas: number; saidas_omie: number };

export default function AcertoItemEstoque({ empresa, compra, onFechar, onPronto }: {
  empresa: string; compra: Compra; onFechar: () => void; onPronto: (codigoNovo: string) => void;
}) {
  const [parecidos, setParecidos] = useState<Parecido[] | null>(null);
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [familia, setFamilia] = useState<number | "">("");
  const [descricao, setDescricao] = useState(compra.descricao);
  const [ncm, setNcm] = useState(compra.ncm ?? "");
  const [unidade, setUnidade] = useState((compra.unidade ?? "UN").toUpperCase());
  const [preco, setPreco] = useState<number | "">(compra.ultimo_preco ?? "");
  const [q, setQ] = useState("");
  const [busca, setBusca] = useState<Nativo[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    fetch(`/api/estoque/vinculos?op=preparar&emp=${empresa}&origem=${compra.n_cod_prod}&descricao=${encodeURIComponent(compra.descricao)}`, { cache: "no-store" })
      .then((x) => x.json()).then((j) => {
        setParecidos(j.parecidos ?? []); setFamilias(j.familias ?? []); setInfo(j.info ?? null);
        if (j.familia_sugerida) setFamilia(j.familia_sugerida);
      }).catch(() => setParecidos([]));
  }, [empresa, compra.descricao]);

  useEffect(() => {
    if (q.trim().length < 2) { setBusca([]); return; }
    const t = window.setTimeout(() => {
      fetch(`/api/faturamento/nova?op=itens&emp=${empresa}&q=${encodeURIComponent(q.trim())}&estoque=1`, { cache: "no-store" })
        .then((x) => x.json()).then((j) => setBusca(j.itens ?? [])).catch(() => setBusca([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, empresa]);

  async function vincular(destino: number, codigo: string) {
    // sem produto de compra identificado (código digitado/antigo): só troca a linha pelo item nosso
    if (!compra.n_cod_prod) { onPronto(codigo); return; }
    setOcupado(true); setErro(null);
    const r = await fetch("/api/estoque/vinculos", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "vincular", emp: empresa, origem: compra.n_cod_prod, destino }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcupado(false);
    if (r.error) { setErro(r.error); return; }
    onPronto(codigo);
  }

  async function cadastrar(forcar = false) {
    if (!familia) { setErro("Escolha a família do item."); return; }
    setOcupado(true); setErro(null);
    const res = await fetch("/api/estoque/vinculos", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "cadastrar", emp: empresa, origem: compra.n_cod_prod, codigo_origem: compra.codigo, familia_id: familia,
        descricao, ncm: ncm || null, unidade, preco: preco === "" ? null : preco, forcar }) });
    const r = await res.json().catch((e) => ({ error: String(e) }));
    setOcupado(false);
    if (res.status === 409 && r.candidatos) { setParecidos(r.candidatos); setErro("Já existe item parecido no estoque — use um destes (ou, sendo admin, cadastre mesmo assim)."); return; }
    if (r.error) { setErro(r.error); return; }
    onPronto(r.codigo);
  }

  const pr = (parecidos ?? []).filter((p) => p.codigo_novo);
  return (
    <div className="ne-acerto" role="dialog" aria-label="Acertar item do estoque">
      <div className="ne-acerto-cab">
        <div>
          <b>Código de compra {compra.codigo ?? compra.n_cod_prod}</b> — {compra.descricao}
          <small>{[compra.fornecedor && `forn. ${compra.fornecedor}`, "não existe no nosso estoque — escolha o item nosso ou cadastre"].filter(Boolean).join(" · ")}</small>
        </div>
        <button className="ne-lk" onClick={onFechar}>fechar</button>
      </div>

      <div className="ne-acerto-sec">
        <div className="ne-acerto-tit">1. Já existe no estoque? <small>(mais parecidos primeiro — evite duplicar)</small></div>
        {parecidos == null ? <div className="ne-dica">procurando…</div> : pr.length === 0 ? <div className="ne-dica">Nenhum item parecido no estoque.</div> : pr.map((p) => (
          <div key={p.n_cod_prod} className="ne-comp-it">
            <div style={{ flex: 1 }}><b>{p.codigo_novo}</b> — {p.descricao}<small style={{ display: "block" }}>semelhança {Math.round(Number(p.sim) * 100)}%{p.igual ? " · descrição igual" : ""}{p.saldo != null ? ` · disp. ${p.saldo}` : ""}</small></div>
            <button className="ne-btn" disabled={ocupado} onClick={() => vincular(p.n_cod_prod, p.codigo_novo!)}>Usar este</button>
          </div>))}
        <input className="ne-in" style={{ width: "100%", marginTop: 6 }} placeholder="ou procure outro item do estoque (nome ou código)…" value={q} onChange={(e) => setQ(e.target.value)} />
        {busca.map((b) => (
          <div key={b.codigo} className="ne-comp-it">
            <div style={{ flex: 1 }}><b>{b.codigo}</b> — {b.descricao}{b.saldo != null ? <small> · disp. {b.saldo}</small> : null}</div>
            <button className="ne-btn" disabled={ocupado || !b.n_cod_prod} onClick={() => b.n_cod_prod && vincular(b.n_cod_prod, b.codigo)}>Vincular</button>
          </div>))}
      </div>

      <div className="ne-acerto-sec">
        <div className="ne-acerto-tit">2. Não existe? Cadastrar no estoque <small>(ganha o próximo código da família)</small></div>
        <div className="ne-acerto-grid">
          <label className="ne-rot">Família<select className="ne-in" value={familia} onChange={(e) => setFamilia(e.target.value ? Number(e.target.value) : "")}>
            <option value="">— escolha —</option>
            {familias.map((f) => <option key={f.id} value={f.id}>{f.prefixo ? `${f.prefixo} · ` : ""}{f.nome}</option>)}
          </select></label>
          <label className="ne-rot" style={{ gridColumn: "span 2" }}>Descrição<input className="ne-in" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
          <label className="ne-rot">NCM<input className="ne-in" value={ncm} onChange={(e) => setNcm(e.target.value)} /></label>
          <label className="ne-rot">Unidade<input className="ne-in" value={unidade} onChange={(e) => setUnidade(e.target.value.toUpperCase())} /></label>
          <label className="ne-rot">Preço de referência<input className="ne-in num" type="number" step="0.01" value={preco} onChange={(e) => setPreco(e.target.value === "" ? "" : Number(e.target.value))} /></label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <button className="ne-btn pri" disabled={ocupado} onClick={() => cadastrar(false)}>{ocupado ? "Gravando…" : "Cadastrar e usar na nota"}</button>
          {erro?.startsWith("Já existe") && <button className="ne-lk" disabled={ocupado} onClick={() => cadastrar(true)}>cadastrar mesmo assim (admin)</button>}
        </div>
        {info && (info.em_estoque
          ? <div className="ne-dica" style={{ color: "#86efac" }}>Este produto já tem estoque registrado ({info.saldo ?? 0}{info.cmc != null ? ` · CMC ${info.cmc.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}) — ele só ganha o código novo; saldo e custo continuam.</div>
          : <div className="ne-dica">Saldo estimado pelas compras: {info.compras_recebidas > 0 ? `${info.saldo_estimado} recebidos em ${info.compras_recebidas} PC(s)` : `${info.comprado} comprados em ${info.pcs} PC(s), sem recebimento registrado no Omie`}
              {info.saidas_omie > 0 ? ` · ${info.saidas_omie} saídas registradas` : ""}. O item nasce com saldo 0 — registre o saldo inicial conferido em <a href="/estoque/inventario" target="_blank" rel="noreferrer">Estoque › Inventário</a> (a nota não é bloqueada por isso).</div>)}
        <div className="ne-dica">O código de compra fica vinculado ao item novo (de-para): nas próximas notas e compras ele já vem como item nosso.</div>
      </div>
      {erro && <div className="ne-aviso" style={{ marginTop: 6 }}>{erro}</div>}
    </div>
  );
}
