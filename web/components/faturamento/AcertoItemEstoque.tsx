"use client";

import { useEffect, useState } from "react";

/* Acertar um código de compra na hora da emissão (05/10/26). Pedido do Benny:
   "assim a gente acerta o nosso estoque". Código de compra (produto do Omie que
   nunca entrou no estoque nosso) não vai para a nota; aqui ele vira item nosso:
   - "Já existe?" — prováveis itens do estoque (mais parecidos primeiro) + busca → vincular;
   - "Cadastrar no estoque" — próximo código da família (sugerida pelo item mais
     parecido), descrição/NCM/unidade/último preço já preenchidos → cria e vincula.
   A trava de duplicados roda no cadastro: parecido demais → "já existe, usar este".

   modo "lista" (07/10/26): o mesmo seletor na lista de materiais do projeto (linha
   da CP sem item nosso). Fontes abertas a quem vê o projeto (/api/catalogo/projeto),
   a escolha volta inteira por onEscolhido (a lista grava o de-para) e, sem código
   de compra, o cadastro nasce do texto da CP — serviço sugere a família SV. */

export type Compra = { n_cod_prod: number; codigo: string | null; descricao: string; unidade: string | null; ultimo_preco: number | null;
  fornecedor: string | null; ncm: string | null };
type Parecido = { n_cod_prod: number; codigo_novo: string | null; descricao: string; saldo: number | null; sim: number; igual?: boolean; fraco?: boolean };
type Familia = { id: number; nome: string; prefixo: string | null };
type Nativo = { n_cod_prod?: number; codigo: string; descricao: string; saldo: number | null; via?: string | null };
type Info = { em_estoque: boolean; saldo: number | null; cmc: number | null; comprado: number; pcs: number; saldo_estimado: number;
  compras_recebidas: number; saidas_omie: number };

export type Escolhido = { n_cod_prod: number; codigo: string; descricao: string };
type Sug = { id: number; cod: string; desc: string; un: string; score: number; motivo: string };
/** Texto de serviço (mão de obra, instalação, frete…) — sugere a família SV. */
export const pareceServico = (t: string) =>
  /\b(servi[cç]os?|m[aã]o de obra|instala[cç][aã]o|montagem|start ?up|comissionamento|treinamento|frete|loca[cç][aã]o|manuten[cç][aã]o|visita t[eé]cnica)\b/i.test(t);

export default function AcertoItemEstoque({ empresa, compra, onFechar, onPronto, modo = "nota", sugeridas, compraAlternativas, onEscolhido }: {
  empresa: string; compra: Compra; onFechar: () => void; onPronto?: (codigoNovo: string) => void;
  modo?: "nota" | "lista";
  /** sugestões já calculadas (a lista manda as da linha da CP) — evita buscar de novo */
  sugeridas?: Sug[];
  /** produtos só do Omie parecidos com a linha: "Cadastrar como item nosso" a partir deles */
  compraAlternativas?: Compra[];
  onEscolhido?: (it: Escolhido) => void;
}) {
  const lista = modo === "lista";
  /** produto de compra de onde nasce o cadastro (no modo lista pode ser escolhido entre os "só no Omie") */
  const [origem, setOrigem] = useState<Compra>(compra);
  const pronto = (it: Escolhido) => { onEscolhido?.(it); onPronto?.(it.codigo); };
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
  /** Sugestões do mesmo motor do "Compatibilizar com o estoque" (nome + preço + unidade), 06/10/26 */
  const [sug, setSug] = useState<Sug[] | null>(sugeridas ?? null);
  const [buscaCompra, setBuscaCompra] = useState<Compra[]>([]);

  useEffect(() => {
    const url = lista ? `/api/catalogo/projeto?op=preparar` : `/api/estoque/vinculos?op=preparar`;
    fetch(`${url}&emp=${empresa}&origem=${origem.n_cod_prod}&descricao=${encodeURIComponent(compra.descricao)}`, { cache: "no-store" })
      .then((x) => x.json()).then((j) => {
        setParecidos(j.parecidos ?? []); setFamilias(j.familias ?? []); setInfo(j.info ?? null);
        const sv = lista && pareceServico(compra.descricao) ? (j.familias ?? []).find((f: Familia) => (f.prefixo ?? "").toUpperCase() === "SV") : null;
        if (sv) setFamilia(sv.id); else if (j.familia_sugerida) setFamilia(j.familia_sugerida);
      }).catch(() => setParecidos([]));
  }, [empresa, compra.descricao, origem.n_cod_prod, lista]);

  useEffect(() => {
    if (sugeridas) return;
    const p = new URLSearchParams({ op: "sugerir", emp: empresa, q: compra.descricao });
    if (compra.ultimo_preco) p.set("custo", String(compra.ultimo_preco));
    if (compra.unidade) p.set("un", compra.unidade);
    fetch(`${lista ? "/api/catalogo/projeto" : "/api/faturamento/nova"}?${p}`, { cache: "no-store" }).then((x) => x.json()).then((j) => setSug(j.itens ?? [])).catch(() => setSug([]));
  }, [empresa, compra.descricao, compra.ultimo_preco, compra.unidade, lista, sugeridas]);

  useEffect(() => {
    if (q.trim().length < 2) { setBusca([]); setBuscaCompra([]); return; }
    const t = window.setTimeout(() => {
      if (lista) {
        // itens nossos primeiro (código novo; código de compra vinculado aparece como "cód. compra X")
        fetch(`/api/catalogo/projeto?op=buscar&emp=${empresa}&q=${encodeURIComponent(q.trim())}`, { cache: "no-store" })
          .then((x) => x.json()).then((j: { itens?: { ncod_prod: number; codigo: string; descricao: string; via?: string | null }[]; compra?: { ncod_prod: number; codigo: string | null; descricao: string; unidade: string | null; ultimo_preco: number | null; fornecedor: string | null }[] }) => {
            setBusca((j.itens ?? []).map((i) => ({ n_cod_prod: i.ncod_prod, codigo: i.codigo, descricao: i.descricao, saldo: null, via: i.via ?? null })));
            setBuscaCompra((j.compra ?? []).map((c) => ({ n_cod_prod: c.ncod_prod, codigo: c.codigo, descricao: c.descricao, unidade: c.unidade,
              ultimo_preco: c.ultimo_preco, fornecedor: c.fornecedor, ncm: null })));
          }).catch(() => { setBusca([]); setBuscaCompra([]); });
        return;
      }
      fetch(`/api/faturamento/nova?op=itens&emp=${empresa}&q=${encodeURIComponent(q.trim())}&estoque=1`, { cache: "no-store" })
        .then((x) => x.json()).then((j) => setBusca(j.itens ?? [])).catch(() => setBusca([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, empresa, lista]);

  /** Cadastro a partir de um produto só do Omie (modo lista): ele vira a origem e a descrição dele entra no formulário. */
  function partirDe(c: Compra) {
    setOrigem(c); setDescricao(c.descricao); if (c.unidade) setUnidade(c.unidade.toUpperCase());
    if (c.ultimo_preco != null) setPreco(c.ultimo_preco);
    window.setTimeout(() => document.getElementById("acerto-cadastro")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30);
  }

  async function vincular(destino: number, codigo: string, desc = "") {
    // modo lista: a escolha volta para a linha (a lista grava o de-para do texto)
    if (lista) { pronto({ n_cod_prod: destino, codigo, descricao: desc }); return; }
    // sem produto de compra identificado (código digitado/antigo): só troca a linha pelo item nosso
    if (!compra.n_cod_prod) { pronto({ n_cod_prod: destino, codigo, descricao: desc }); return; }
    setOcupado(true); setErro(null);
    const r = await fetch("/api/estoque/vinculos", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "vincular", emp: empresa, origem: compra.n_cod_prod, destino }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcupado(false);
    if (r.error) { setErro(r.error); return; }
    pronto({ n_cod_prod: destino, codigo, descricao: desc });
  }

  async function cadastrar(forcar = false) {
    if (!familia) { setErro("Escolha a família do item."); return; }
    setOcupado(true); setErro(null);
    const res = await fetch("/api/estoque/vinculos", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "cadastrar", emp: empresa, origem: origem.n_cod_prod || null, codigo_origem: origem.codigo, contexto: lista ? "lista" : "nota", familia_id: familia,
        descricao, ncm: ncm || null, unidade, preco: preco === "" ? null : preco, forcar }) });
    const r = await res.json().catch((e) => ({ error: String(e) }));
    setOcupado(false);
    if (res.status === 409 && r.candidatos) { setParecidos(r.candidatos); setErro("Já existe item parecido no estoque — use um destes (ou, sendo admin, cadastre mesmo assim)."); return; }
    if (r.error) { setErro(r.error); return; }
    pronto({ n_cod_prod: Number(r.n_cod_prod), codigo: r.codigo, descricao: descricao.toUpperCase() });
  }

  const pr = (parecidos ?? []).filter((p) => p.codigo_novo);
  return (
    <div className="ne-acerto" role="dialog" aria-label="Acertar item do estoque">
      <div className="ne-acerto-cab">
        <div>
          {lista
            ? <><b>Item do catálogo</b> — {compra.descricao}<small>escolha o item nosso desta linha, procure outro ou cadastre — a escolha fica gravada e vale para o mesmo texto da próxima vez</small></>
            : <><b>{compra.n_cod_prod ? "Código de compra" : "Código fora do estoque"} {compra.codigo ?? compra.n_cod_prod}</b> — {compra.descricao}
              <small>{[compra.fornecedor && `forn. ${compra.fornecedor}`, "não existe no nosso estoque — escolha o item nosso ou cadastre"].filter(Boolean).join(" · ")}</small></>}
        </div>
        <button className="ne-lk" onClick={onFechar}>fechar</button>
      </div>

      <div className="ne-acerto-sec">
        <div className="ne-acerto-tit">Sugestões <small>(nome, preço e unidade — os 3 itens nossos mais parecidos)</small></div>
        {sug == null ? <div className="ne-dica">procurando…</div> : sug.length === 0 ? <div className="ne-dica">Nenhuma sugestão — veja abaixo ou cadastre.</div> : sug.map((x) => (
          <div key={x.id} className="ne-comp-it">
            <div style={{ flex: 1 }}><b>{x.cod}</b> — {x.desc}<small style={{ display: "block" }}>{Math.round(x.score * 100)}% · {x.motivo}</small></div>
            <button className="ne-btn" disabled={ocupado} onClick={() => vincular(x.id, x.cod, x.desc)}>Usar este</button>
          </div>))}
      </div>

      <div className="ne-acerto-sec">
        <div className="ne-acerto-tit">1. Já existe no estoque? <small>(mais parecidos primeiro — evite duplicar)</small></div>
        {pr.length > 0 && pr.every((p) => p.fraco) && <div className="ne-dica">Nada parecido o bastante — itens nossos com a mesma palavra:</div>}
        {parecidos == null ? <div className="ne-dica">procurando…</div> : pr.length === 0 ? <div className="ne-dica">Nenhum item parecido no estoque.</div> : pr.map((p) => (
          <div key={p.n_cod_prod} className="ne-comp-it">
            <div style={{ flex: 1 }}><b>{p.codigo_novo}</b> — {p.descricao}<small style={{ display: "block" }}>{p.fraco ? "mesma família/palavra" : `semelhança ${Math.round(Number(p.sim) * 100)}%`}{p.igual ? " · descrição igual" : ""}{p.saldo != null ? ` · disp. ${p.saldo}` : ""}</small></div>
            <button className="ne-btn" disabled={ocupado} onClick={() => vincular(p.n_cod_prod, p.codigo_novo!, p.descricao)}>Usar este</button>
          </div>))}
        <input className="ne-in" style={{ width: "100%", marginTop: 6 }} placeholder="ou procure outro item do estoque (nome ou código)…" value={q} onChange={(e) => setQ(e.target.value)} />
        {busca.map((b) => (
          <div key={b.codigo} className="ne-comp-it">
            <div style={{ flex: 1 }}><b>{b.codigo}</b> — {b.descricao}{b.saldo != null ? <small> · disp. {b.saldo}</small> : null}{b.via ? <small> · {b.via}</small> : null}</div>
            <button className="ne-btn" disabled={ocupado || !b.n_cod_prod} onClick={() => b.n_cod_prod && vincular(b.n_cod_prod, b.codigo, b.descricao)}>{lista ? "Usar este" : "Vincular"}</button>
          </div>))}
        {lista && [...(compraAlternativas ?? []), ...buscaCompra.filter((c) => !(compraAlternativas ?? []).some((a) => a.n_cod_prod === c.n_cod_prod))].length > 0 && (
          <div className="ne-comp" style={{ marginTop: 6 }}>
            <div className="ne-comp-tit">Só no Omie <small>— produto de compra sem item nosso: cadastre como item nosso a partir dele</small></div>
            {[...(compraAlternativas ?? []), ...buscaCompra.filter((c) => !(compraAlternativas ?? []).some((a) => a.n_cod_prod === c.n_cod_prod))].map((c) => (
              <div key={c.n_cod_prod} className="ne-comp-it">
                <div style={{ flex: 1, minWidth: 0 }}><span className="ne-comp-cod">cód. compra {c.codigo ?? c.n_cod_prod}</span> {c.descricao}
                  <small style={{ display: "block" }}>{[c.fornecedor && `forn. ${c.fornecedor}`, c.ultimo_preco != null && `últ. compra ${c.ultimo_preco.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`].filter(Boolean).join(" · ")}</small></div>
                <button className="ne-lk" disabled={ocupado} onClick={() => partirDe(c)}>{origem.n_cod_prod === c.n_cod_prod ? "✓ no cadastro abaixo" : "Cadastrar como item nosso"}</button>
              </div>))}
          </div>)}
      </div>

      <div className="ne-acerto-sec" id="acerto-cadastro">
        <div className="ne-acerto-tit">2. Não existe? {lista ? "Criar item nosso" : "Cadastrar no estoque"} <small>(ganha o próximo código da família{lista ? "; serviço → família SV" : ""}){lista && origem.n_cod_prod ? ` · a partir do cód. compra ${origem.codigo ?? origem.n_cod_prod}` : ""}</small></div>
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
          <button className="ne-btn pri" disabled={ocupado} onClick={() => cadastrar(false)}>{ocupado ? "Gravando…" : lista ? "Criar e usar nesta linha" : "Cadastrar e usar na nota"}</button>
          {erro?.startsWith("Já existe") && <button className="ne-lk" disabled={ocupado} onClick={() => cadastrar(true)}>cadastrar mesmo assim (admin)</button>}
        </div>
        {info && (info.em_estoque
          ? <div className="ne-dica" style={{ color: "#86efac" }}>Este produto já tem estoque registrado ({info.saldo ?? 0}{info.cmc != null ? ` · CMC ${info.cmc.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}` : ""}) — ele só ganha o código novo; saldo e custo continuam.</div>
          : <div className="ne-dica">Saldo estimado pelas compras: {info.compras_recebidas > 0 ? `${info.saldo_estimado} recebidos em ${info.compras_recebidas} PC(s)` : `${info.comprado} comprados em ${info.pcs} PC(s), sem recebimento registrado no Omie`}
              {info.saidas_omie > 0 ? ` · ${info.saidas_omie} saídas registradas` : ""}. O item nasce com saldo 0 — registre o saldo inicial conferido em <a href="/estoque/inventario" target="_blank" rel="noreferrer">Estoque › Inventário</a> (a nota não é bloqueada por isso).</div>)}
        {lista
          ? <div className="ne-dica">O item nasce no estoque nosso (nada vai ao Omie) e o texto desta linha fica ligado a ele: da próxima vez, o mesmo texto já casa sozinho.</div>
          : <div className="ne-dica">O código de compra fica vinculado ao item novo (de-para): nas próximas notas e compras ele já vem como item nosso.</div>}
      </div>
      {erro && <div className="ne-aviso" style={{ marginTop: 6 }}>{erro}</div>}
    </div>
  );
}
