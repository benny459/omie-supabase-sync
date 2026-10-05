"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ClienteFat } from "@/lib/faturamento/montar";

/* Buscas partilhadas pelo form do PV/OS nativo e pela emissão avulsa (05/10/26):
   • BuscaProposta — procura a proposta no CRM (por nº, cliente ou título) e
     devolve o número escolhido; quem chama pede o pré-preenchimento.
   • BuscaPessoa   — procura o cliente no cadastro do painel (nome, fantasia,
     CNPJ/CPF). Sem resultado, oferece "Cadastrar novo" (tela de Cadastros, que
     tem a trava contra duplicados). */

const input: CSSProperties = {
  height: 32, padding: "0 10px", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", minWidth: 0, width: "100%",
  border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
};
const caixa: CSSProperties = {
  position: "absolute", zIndex: 30, top: 36, left: 0, right: 0, maxHeight: 320, overflowY: "auto",
  background: "var(--ww-panel)", border: "1px solid var(--ww-border-strong)", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.25)",
};
const opc: CSSProperties = {
  display: "block", width: "100%", textAlign: "left", padding: "8px 10px", background: "none", border: 0,
  borderBottom: "1px solid var(--ww-border)", color: "var(--ww-text)", cursor: "pointer", fontSize: 12.5,
};
const sub: CSSProperties = { fontSize: 11, color: "var(--ww-text-faint)" };
const brl = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export type PropostaOp = {
  numero: string; status: string | null; valor: number; cliente: string | null; titulo: string | null; ja_lancado: string | null;
};

function useBusca<T>(url: (q: string) => string, ler: (j: Record<string, unknown>) => T[], min = 2) {
  const [lista, setLista] = useState<T[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  function buscar(v: string) {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(async () => {
      if (v.trim().length < min) { setLista([]); setInfo(null); return; }
      const j = await fetch(url(v.trim()), { cache: "no-store" }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
      if (j.error) { setInfo(j.error); setLista([]); return; }
      if (j.disponivel === false) { setInfo(j.motivo ?? "busca indisponível"); setLista([]); return; }
      setInfo(null); setLista(ler(j));
    }, 300);
  }
  return { lista, info, buscar, limpar: () => setLista([]) };
}

export function BuscaProposta({ valor, desativado, onEscolher, onTexto, placeholder }: {
  valor: string; desativado?: boolean; onEscolher: (p: PropostaOp) => void; onTexto?: (v: string) => void; placeholder?: string;
}) {
  const [q, setQ] = useState(valor);
  const [aberta, setAberta] = useState(false);
  useEffect(() => { setQ(valor); }, [valor]);
  const b = useBusca<PropostaOp>((v) => `/api/vendas/proposta?q=${encodeURIComponent(v)}`, (j) => (j.propostas as PropostaOp[]) ?? []);
  return (
    <div style={{ position: "relative" }}>
      <input style={input} disabled={desativado} value={q} placeholder={placeholder ?? "Nº da proposta, cliente ou título"}
        onChange={(e) => { setQ(e.target.value); onTexto?.(e.target.value); setAberta(true); b.buscar(e.target.value); }}
        onFocus={() => setAberta(true)} onBlur={() => setTimeout(() => setAberta(false), 200)} />
      {aberta && (b.lista.length > 0 || b.info) && (
        <div style={caixa}>
          {b.info && <div style={{ ...opc, cursor: "default", color: "var(--ww-text-faint)" }}>{b.info}</div>}
          {b.lista.map((p) => (
            <button key={p.numero} type="button" style={opc} onMouseDown={() => { setQ(p.numero); onEscolher(p); setAberta(false); }}>
              <b>{p.numero}</b> · {p.cliente ?? "—"} <span style={{ float: "right", fontVariantNumeric: "tabular-nums" }}>{brl(Number(p.valor))}</span>
              <div style={sub}>{p.status ?? ""}{p.titulo ? ` · ${p.titulo}` : ""}{p.ja_lancado ? ` · já lançado: ${p.ja_lancado}` : ""}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export type PessoaOp = { id: number; codigo: number; razao: string; fantasia: string | null; doc: string | null; cidade: string | null; uf: string | null };

export function BuscaPessoa({ valor, desativado, onEscolher, empresa = "SF", placeholder }: {
  valor: string; desativado?: boolean; onEscolher: (p: PessoaOp) => void; empresa?: string; placeholder?: string;
}) {
  const [q, setQ] = useState(valor);
  const [aberta, setAberta] = useState(false);
  const [buscou, setBuscou] = useState(false);
  useEffect(() => { setQ(valor); }, [valor]);
  const b = useBusca<PessoaOp>((v) => `/api/cadastros?papel=cliente&emp=${empresa}&q=${encodeURIComponent(v)}`, (j) => (j.linhas as PessoaOp[]) ?? []);
  const doc = q.replace(/\D/g, "");
  const novo = `/cadastros/novo?papel=cliente&emp=${empresa}${doc.length >= 11 ? `&doc=${doc}` : `&razao=${encodeURIComponent(q.trim())}`}`;
  return (
    <div style={{ position: "relative" }}>
      <input style={input} disabled={desativado} value={q} placeholder={placeholder ?? "Nome, fantasia ou CNPJ/CPF do cadastro"}
        onChange={(e) => { setQ(e.target.value); setAberta(true); setBuscou(e.target.value.trim().length >= 2); b.buscar(e.target.value); }}
        onFocus={() => setAberta(true)} onBlur={() => setTimeout(() => setAberta(false), 200)} />
      {aberta && buscou && (
        <div style={caixa}>
          {b.info && <div style={{ ...opc, cursor: "default", color: "var(--ww-text-faint)" }}>{b.info}</div>}
          {b.lista.map((c) => (
            <button key={c.codigo} type="button" style={opc} onMouseDown={() => { onEscolher(c); setQ(c.fantasia || c.razao); setAberta(false); }}>
              <b>{c.fantasia || c.razao}</b>
              <div style={sub}>{c.razao} · {c.doc ?? "sem doc"} · {c.cidade ?? ""} · cód. {c.codigo}</div>
            </button>
          ))}
          <a href={novo} target="_blank" rel="noopener" style={{ ...opc, display: "block", color: "var(--ww-accent-text)", fontWeight: 600, textDecoration: "none" }}
            onMouseDown={(e) => e.stopPropagation()}>
            {b.lista.length ? "Não é nenhum destes? " : "Nenhum cadastro encontrado — "}Cadastrar novo cliente ↗
            <div style={sub}>abre Cadastros (com a trava contra duplicados); depois busque aqui de novo</div>
          </a>
        </div>
      )}
    </div>
  );
}

/** Cadastro completo (orders.cadastros_obter) → cliente da nota. */
export function clienteDaPessoa(p: Record<string, unknown>): ClienteFat {
  const s = (k: string) => (p[k] == null ? "" : String(p[k]));
  const doc = s("doc").replace(/\D/g, "");
  return {
    nome: s("razao"), cnpj: doc.length === 14 ? doc : "", cpf: doc.length === 11 ? doc : "",
    ie: s("ie"), email: s("emailNfe") || s("email").split(/[,;\s]+/)[0] || "",
    logradouro: s("logradouro"), numero: s("numero"), complemento: s("complemento"), bairro: s("bairro"),
    municipio: s("cidade").replace(/\s*\([A-Z]{2}\)\s*$/, ""), codigo_municipio: s("ibge"), uf: s("uf"), cep: s("cep").replace(/\D/g, ""),
  };
}

export async function pessoaCompleta(id: number): Promise<Record<string, unknown> | null> {
  const j = await fetch(`/api/cadastros/${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
  return (j?.pessoa as Record<string, unknown>) ?? null;
}
