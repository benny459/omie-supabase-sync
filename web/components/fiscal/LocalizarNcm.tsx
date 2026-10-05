"use client";
// Localizador de NCM (05/10/26): tabela oficial Siscomex + sugestões do nosso
// histórico (itens parecidos do catálogo, NF de fornecedor, NF-e do Omie).
// Ao escolher, devolve o NCM e — se marcado — grava no cadastro do item.
import { useEffect, useRef, useState } from "react";
import "./localizar-ncm.css";

type Res = { codigo: string; codigo_fmt: string; descricao: string; caminho: string | null };
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

export default function LocalizarNcm({ emp = "SF", descricao, codigo, atual, onEscolher, onFechar }: {
  emp?: string; descricao: string; codigo?: string | null; atual?: string | null;
  onEscolher: (ncm: string, salvo: boolean) => void; onFechar: () => void;
}) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Res[] | null>(null);
  const [sug, setSug] = useState<Sug[] | null>(null);
  const [salvar, setSalvar] = useState(!!codigo);
  const [msg, setMsg] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const caixa = useRef<HTMLInputElement>(null);

  useEffect(() => { caixa.current?.focus(); }, []);
  useEffect(() => {
    const p = new URLSearchParams({ op: "sugerir", emp, desc: descricao ?? "", cod: codigo ?? "" });
    fetch(`/api/fiscal/ncm?${p}`).then((r) => r.json()).then((j) => setSug(j.sugestoes ?? [])).catch(() => setSug([]));
  }, [emp, descricao, codigo]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = window.setTimeout(() => {
      fetch(`/api/fiscal/ncm?q=${encodeURIComponent(q.trim())}`).then((r) => r.json()).then((j) => setRes(j.resultados ?? [])).catch(() => setRes([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);

  async function escolher(ncm: string) {
    const d = ncm.replace(/\D/g, "");
    if (salvar && codigo) {
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
          <div><h3>Localizar NCM</h3><small>{codigo ? <b>{codigo}</b> : null}{codigo ? " · " : ""}{descricao || "item sem descrição"}</small></div>
          <button type="button" className="ncm-x" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        <input ref={caixa} className="ncm-busca" placeholder="Busque por código (ex.: 7609) ou palavras (ex.: acessórios tubos alumínio)"
          value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="ncm-lista">
          {!q.trim() && (<>
            <div className="ncm-sec">Sugestões para este item</div>
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
          {codigo ? <label><input type="checkbox" checked={salvar} onChange={(e) => setSalvar(e.target.checked)} /> salvar no cadastro do item {codigo}</label>
            : <small>Item sem código do estoque — o NCM vale só para esta nota.</small>}
          {msg && <small className="err">{msg}</small>}
          <small className="fonte">Tabela NCM oficial (Siscomex/Receita)</small>
        </div>
      </div>
    </div>
  );
}
