import "server-only";

/**
 * Cliente mínimo da Focus NFe (API v2) para o faturamento do painel.
 *
 * Ambiente:
 *  - homologação (padrão): homologacao.focusnfe.com.br, token de homologação
 *    da empresa, lido pela conta master (FOCUS_TOKEN_MASTER → /v2/empresas).
 *  - produção: api.focusnfe.com.br com FOCUS_TOKEN_<EMPRESA>. Só é chamada se
 *    a empresa tiver producao_liberada (ver server.ts) — nunca por padrão.
 * Tokens nunca saem do servidor nem vão para logs.
 */

export type Ambiente = "homologacao" | "producao";

export const HOST: Record<Ambiente, string> = {
  homologacao: "https://homologacao.focusnfe.com.br",
  producao: "https://api.focusnfe.com.br",
};

export type EmpresaFocus = {
  cnpj?: string;
  nome?: string;
  nome_fantasia?: string;
  inscricao_estadual?: string;
  inscricao_municipal?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  codigo_municipio?: string;
  uf?: string;
  cep?: string;
  telefone?: string;
  regime_tributario?: string | number;
  token_homologacao?: string;
  token_producao?: string;
};

const cacheEmpresa = new Map<string, { em: number; dados: EmpresaFocus }>();

/** Dados da empresa na Focus (endereço, IE/IM, tokens) pela conta master. */
export async function empresaFocus(cnpj: string): Promise<EmpresaFocus> {
  const c = cacheEmpresa.get(cnpj);
  if (c && Date.now() - c.em < 10 * 60_000) return c.dados;
  const master = process.env.FOCUS_TOKEN_MASTER;
  if (!master) throw new Error("FOCUS_TOKEN_MASTER não configurado na Vercel");
  const r = await chamar(HOST.producao, master, "GET", `/v2/empresas?cnpj=${cnpj}`);
  if (r.status !== 200) throw new Error(`Focus /v2/empresas → HTTP ${r.status}`);
  const lista = r.json as EmpresaFocus[] | EmpresaFocus;
  const dados = Array.isArray(lista) ? lista[0] : lista;
  if (!dados) throw new Error(`Empresa ${cnpj} não cadastrada na Focus`);
  cacheEmpresa.set(cnpj, { em: Date.now(), dados });
  return dados;
}

/** Token da empresa no ambiente pedido. */
export async function tokenDe(empresa: string, cnpj: string, ambiente: Ambiente): Promise<string> {
  if (ambiente === "producao") {
    const t = process.env[`FOCUS_TOKEN_${empresa}`];
    if (!t) throw new Error(`FOCUS_TOKEN_${empresa} não configurado na Vercel`);
    return t;
  }
  const e = await empresaFocus(cnpj);
  if (!e.token_homologacao) throw new Error("A empresa não tem token de homologação na Focus");
  return e.token_homologacao;
}

export type Resposta = { status: number; json: unknown; texto: string };

export async function chamar(host: string, token: string, metodo: string, caminho: string, corpo?: unknown): Promise<Resposta> {
  const auth = Buffer.from(`${token}:`).toString("base64");
  const r = await fetch(`${host}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    cache: "no-store",
  });
  const texto = await r.text();
  let json: unknown = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* corpo não-JSON */ }
  return { status: r.status, json, texto };
}

/** Baixa um arquivo da Focus (XML/DANFE). O caminho pode ser relativo ao host
 *  ou uma URL absoluta (S3 da Focus, que dispensa autenticação). */
export async function baixar(host: string, token: string, caminho: string): Promise<{ bytes: ArrayBuffer; tipo: string } | null> {
  const url = caminho.startsWith("http") ? caminho : `${host}${caminho}`;
  const headers: Record<string, string> = {};
  if (url.startsWith(host)) headers.Authorization = `Basic ${Buffer.from(`${token}:`).toString("base64")}`;
  const r = await fetch(url, { headers, cache: "no-store" });
  if (!r.ok) return null;
  return { bytes: await r.arrayBuffer(), tipo: r.headers.get("content-type") || "application/octet-stream" };
}
