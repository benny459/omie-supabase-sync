"use client";

/* Peças partilhadas dos cadastros de clientes e fornecedores (05/10/26).
   O visual é o mesmo do Estoque (classes .est de estoque.css, tokens --ww-*). */

import "../navy/estoque/estoque.css";

export type Papel = "cliente" | "fornecedor";
export const EMPRESAS = ["SF", "CD", "WW"] as const;
export const NOME_EMPRESA: Record<string, string> = { SF: "SF", CD: "CD", WW: "WW" };

export type Linha = {
  id: number; codigo: number; origem: "omie" | "painel" | "servicos" | "crm"; razao: string; fantasia: string | null; doc: string | null;
  cidade: string | null; uf: string | null; email: string | null; telefone: string | null;
  cliente: boolean; fornecedor: boolean; transportadora: boolean; ativo: boolean; criadoEm: string;
};

export type Contato = { nome?: string; cargo?: string; email?: string; telefone?: string };

export type Pessoa = {
  id: number; empresa: string; codigo: number; origem: "omie" | "painel" | "servicos" | "crm"; codigoOmie: number | null;
  cliente: boolean; fornecedor: boolean; transportadora: boolean; pf: boolean; razao: string; fantasia: string | null;
  doc: string | null; ie: string | null; im: string | null; simples: boolean | null; contribuinte: string | null;
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null;
  cidade: string | null; uf: string | null; ibge: string | null; telefone: string | null; telefone2: string | null;
  email: string | null; emailCobranca: string | null; emailNfe: string | null; contato: string | null;
  contatos: Contato[]; tags: string | null; obs: string | null; ativo: boolean; editado: boolean;
  criadoEm: string; criadoPor: string | null; alteradoEm: string; alteradoPor: string | null;
  entidade?: number; preCadastro?: boolean; mescladoEm?: number | null;
  historico?: { acao: string; por: string | null; em: string }[];
};

export const brl = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function kbrl(v: number | null | undefined) {
  if (v == null) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toFixed(2).replace(".", ",")} mi`;
  if (a >= 1e3) return `${s}R$ ${Math.round(a / 1e3).toLocaleString("pt-BR")} mil`;
  return `${s}R$ ${Math.round(a).toLocaleString("pt-BR")}`;
}
export const ddmmaa = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—");

/** CNPJ/CPF com máscara (o banco guarda como vier; a busca usa só os dígitos). */
export function mascaraDoc(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
}

/** Validação local de CPF/CNPJ — a mesma regra do banco (cadastros.doc_valido). */
export function docValido(v: string) {
  const d = v.replace(/\D/g, "");
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], w2 = [6, ...w1];
    const dv = (w: number[]) => { const s = w.reduce((a, x, i) => a + x * Number(d[i]), 0); const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return dv(w1) === Number(d[12]) && dv(w2) === Number(d[13]);
  }
  return false;
}

export const Pill = ({ t, tom, title }: { t: React.ReactNode; tom: "ok" | "warn" | "crit" | "info" | "off" | "violet"; title?: string }) => (
  <span className={`pill t-${tom}`} title={title}>{t}</span>
);

export const Origem = ({ o }: { o: "omie" | "painel" | "servicos" | "crm" }) =>
  o === "painel" ? <Pill t="Painel" tom="info" title="Cadastrado no painel (não existe no Omie)" />
    : o === "servicos" ? <Pill t="Serviços" tom="info" title="Cadastrado na app de Serviços" />
    : o === "crm" ? <Pill t="CRM" tom="info" title="Cadastrado no CRM" />
    : <Pill t="Omie" tom="off" title="Veio do cadastro do Omie (histórico)" />;

export const Papeis = ({ p }: { p: { cliente: boolean; fornecedor: boolean; transportadora: boolean } }) => (
  <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
    {p.cliente && <Pill t="Cliente" tom="ok" />}
    {p.fornecedor && <Pill t="Fornecedor" tom="violet" />}
    {p.transportadora && <Pill t="Transportadora" tom="warn" />}
  </span>
);

/** Erro de pedido; num possível duplicado (409) traz os candidatos ("já existe — usar este"). */
export class ErroPedido extends Error {
  constructor(message: string, public status: number, public candidatos: Candidato[] | null) { super(message); }
}

export async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = j as { error?: string; candidatos?: Candidato[] };
    throw new ErroPedido(e.error ?? r.statusText, r.status, Array.isArray(e.candidatos) ? e.candidatos : null);
  }
  return j as T;
}

/** Cadastro que já existe e parece ser o mesmo (sql/59). forte = é a mesma pessoa. */
export type Candidato = {
  id: number; empresa: string; codigo: number; razao: string; fantasia: string | null; doc: string | null;
  cidade: string | null; uf: string | null; motivo: string; score: number; forte: boolean; entidade?: number;
};

/** Lista "já existe?" — abrir o existente em vez de criar outro. */
export function ListaCandidatos({ itens, titulo, onAbrir }: { itens: Candidato[]; titulo: string; onAbrir: (c: Candidato) => void }) {
  if (!itens.length) return null;
  return (
    <div className={`aviso ${itens.some((c) => c.forte) ? "t-warn" : "t-info"}`} style={{ display: "grid", gap: 6 }}>
      <b>{titulo}</b>
      {itens.map((c) => (
        <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1, minWidth: 220 }}>
            <b>{c.razao}</b>{c.fantasia && c.fantasia !== c.razao ? <span className="mini"> · {c.fantasia}</span> : null}
            <span className="mini"> · {c.empresa} · cód. {c.codigo}{c.doc ? ` · ${c.doc}` : ""}{c.cidade ? ` · ${c.cidade}` : ""}</span>
          </span>
          <Pill t={c.forte ? `mesma pessoa · ${c.motivo}` : c.motivo} tom={c.forte ? "crit" : "off"} />
          <button type="button" className="btn sm" onClick={() => onAbrir(c)}>Abrir este</button>
        </div>
      ))}
    </div>
  );
}

/** Ficha do cliente no CRM do portal (o endereço usa o nome da empresa). */
export const linkCrm = (nome: string) => `/api/sso/portal?next=${encodeURIComponent(`/w/waterworks/clientes/${encodeURIComponent(nome)}`)}`;
