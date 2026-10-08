"use client";
// Localizador de NCM (05/10/26): tabela oficial Siscomex + sugestões do nosso
// histórico (itens parecidos do catálogo, NF de fornecedor, NF-e do Omie).
// Ao escolher, devolve o NCM e — se marcado — grava no cadastro do item.
import { useEffect, useRef, useState } from "react";
import "./localizar-ncm.css";

type Res = { codigo: string; codigo_fmt: string; descricao: string; caminho: string | null };
type Compra = { ncm: string; codigo_fmt: string; descricao_ncm: string; fornecedor: string | null; nf: string | null; data: string | null;
  xprod: string | null; cprod: string | null; fonte: string; deste_item: boolean; vezes: number; sim: number };
type Sug = { ncm: string; codigo_fmt: string; descricao_ncm: string; caminho: string | null; fontes: string; motivo: string; score: number };

export const ncmFmt = (n: string | null | undefined) => {
  const d = String(n ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}` : d;
};

/** Valida contra a tabela oficial (existe e é folha de 8 dígitos). */
export async function ncmValido(ncm: string): Promise<boolean> {
  const d = ncm.replace(/\D/g, "");
  if (d.length !== 8) return false;
  const r = await fetch(`/api/fiscal/ncm?op=validar&ncm=${d}`).then((x) => x.json()).catch(() => null);
  return !!r?.valido;
}

type DaFamilia = { ncm: string; codigo_fmt: string; descricao_ncm: string; caminho: string | null; itens: number };

export default function LocalizarNcm({ emp = "SF", descricao, codigo, atual, onEscolher, onFechar, familia, cadastroNovo = false }: {
  emp?: string; descricao: string; codigo?: string | null; atual?: string | null;
  onEscolher: (ncm: string, salvo: boolean) => void; onFechar: () => void;
  /** 08/10/26 (Criar item nosso, na lista de materiais): a família escolhida — mostra os NCMs dos itens dela. */
  familia?: { prefixo: string | null; nome: string } | null;
  /** Cadastro de item novo: o NCM volta para o formulário (não grava em cadastro nenhum); `codigo`
   *  é só a pista para as compras (o código de compra de onde o item nasce). */
  cadastroNovo?: boolean;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Res[] | null>(null);
  const [sug, setSug] = useState<Sug[] | null>(null);
  const [comp, setComp] = useState<Compra[] | null>(null);
  const [salvar, setSalvar] = useState(!!codigo && !cadastroNovo);
  const [fam, setFam] = useState<DaFamilia[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const caixa = useRef<HTMLInputElement>(null);

  useEffect(() => { caixa.current?.focus(); }, []);
  useEffect(() => {
    const p = new URLSearchParams({ op: "sugerir", emp, desc: descricao ?? "", cod: codigo ?? "" });
    fetch(`/api/fiscal/ncm?${p}`).then((r) => r.json()).then((j) => setSug(j.sugestoes ?? [])).catch(() => setSug([]));
    const pc = new URLSearchParams({ op: "compras", emp, desc: descricao ?? "", cod: codigo ?? "" });
    fetch(`/api/fiscal/ncm?${pc}`).then((r) => r.json()).then((j) => setComp(j.compras ?? [])).catch(() => setComp([]));
  }, [emp, descricao, codigo]);
  useEffect(() => {
    if (!familia?.prefixo) { setFam([]); return; }
    fetch(`/api/fiscal/ncm?${new URLSearchParams({ op: "familia", emp, prefixo: familia.prefixo })}`).then((r) => r.json())
      .then((j) => setFam(j.familia ?? [])).catch(() => setFam([]));
  }, [emp, familia?.prefixo]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = window.setTimeout(() => {
      fetch(`/api/fiscal/ncm?q=${encodeURIComponent(q.trim())}`).then((r) => r.json()).then((j) => setRes(j.resultados ?? [])).catch(() => setRes([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  async function escolher(ncm: string) {
    const d = ncm.replace(/\D/g, "");
    if (salvar && codigo && !cadastroNovo) {
      setGravando(true); setMsg(null);
      const r = await fetch("/api/fiscal/ncm", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emp, codigo, ncm: d }) }).then((x) => x.json().then((j) => ({ ok: x.ok, j }))).catch(() => ({ ok: false, j: { error: "falha de rede" } }));
      setGravando(false);
      if (!r.ok) { setMsg(`NCM aplicado só nesta nota — não gravei no cadastro: ${r.j?.error ?? "erro"}`); onEscolher(d, false); return; }
      onEscolher(d, true); return;
    }
    onEscolher(d, false);
  }

  const linha = (cod: string, fmt: string, desc: string, cam: string | null, extra?: React.ReactNode) => (
    <button key={cod} type="button" className={`ncm-it${atual && atual.replace(/\D/g, "") === cod ? " on" : ""}`} disabled={gravando} onClick={() => escolher(cod)}>
      <b className="mono">{fmt}</b> <span>{desc.replace(/^[-\s]+/, "")}</span>
      {cam && <small className="cam">{cam}</small>}
      {extra}
    </button>
  );

  return (
    <div className="ncm-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="ncm-caixa" role="dialog" aria-label="Localizar NCM">
        <div className="ncm-topo">
          <div><h3>Localizar NCM</h3><small>{codigo && !cadastroNovo ? <b>{codigo}</b> : null}{codigo && !cadastroNovo ? " · " : ""}{cadastroNovo ? "item novo · " : ""}{descricao || "item sem descrição"}</small></div>
          <button type="button" className="ncm-x" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <input ref={caixa} className="ncm-busca" placeholder="Busque por código (ex.: 7609) ou palavras (ex.: acessórios tubos alumínio)"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ncm-lista">
          {!q.trim() && (<>
            <div className="ncm-sec">Das nossas compras</div>
            {comp === null ? <div className="ncm-vazio">procurando nas NF-e e pedidos dos fornecedores…</div>
              : comp.length ? comp.map((c) => linha(c.ncm, c.codigo_fmt, c.descricao_ncm, null,
                  <small className="mot">{c.deste_item ? "✓ deste item · " : "item parecido · "}{c.fornecedor ?? "fornecedor ?"}{c.nf ? ` · ${/^PC /.test(c.nf) ? c.nf : `NF ${c.nf}`}` : ""}{c.data ? ` · ${new Date(`${c.data}T12:00:00`).toLocaleDateString("pt-BR")}` : ""}
                    {c.vezes > 1 ? ` · ${c.vezes}×` : ""}<span className="cam" style={{ display: "block" }}>“{c.xprod}”{c.cprod ? ` (cód. ${c.cprod})` : ""}</span></small>))
              : <div className="ncm-vazio">Nenhuma compra deste item (ou parecido) com NCM.</div>}
            {familia && (<>
              <div className="ncm-sec">Da família {familia.prefixo ? `${familia.prefixo} · ` : ""}{familia.nome}</div>
              {fam === null ? <div className="ncm-vazio">lendo os itens da família…</div>
                : fam.length ? fam.map((f) => linha(f.ncm, f.codigo_fmt, f.descricao_ncm, f.caminho, <small className="mot">usado em {f.itens} item(ns) da família</small>))
                : <div className="ncm-vazio">Nenhum item da família com NCM ainda.</div>}
            </>)}
            <div className="ncm-sec">Sugestões do catálogo</div>
            {sug === null ? <div className="ncm-vazio">buscando no nosso histórico…</div>
              : sug.length ? sug.map((s) => linha(s.ncm, s.codigo_fmt, s.descricao_ncm, s.caminho,
                  <small className="mot">✓ {s.motivo}{s.fontes ? ` · ${s.fontes}` : ""}</small>))
              : <div className="ncm-vazio">Sem sugestão no nosso histórico — busque acima pelo nome do produto.</div>}
          </>)}
          {q.trim() && (res === null ? <div className="ncm-vazio">buscando…</div>
            : res.length ? res.map((r) => linha(r.codigo, r.codigo_fmt, r.descricao, r.caminho))
            : <div className="ncm-vazio">Nada encontrado na tabela oficial — tente outras palavras ou o início do código.</div>)}
        </div>
        <div className="ncm-pe">
          {cadastroNovo ? <small>O NCM entra no cadastro do item novo quando você criar.</small>
            : codigo ? <label><input type="checkbox" checked={salvar} onChange={(e) => setSalvar(e.target.checked)} /> salvar no cadastro do item {codigo}</label>
            : <small>Item sem código do estoque — o NCM vale só para esta nota.</small>}
          {msg && <small className="err">{msg}</small>}
          <small className="fonte">Tabela NCM oficial (Siscomex/Receita)</small>
        </div>
      </div>
    </div>
  );
}
