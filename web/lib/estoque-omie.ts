import "server-only";

/**
 * Cópia do item do painel no Omie (Benny escolheu, 01/10/26: enquanto a NF sai do Omie, o produto
 * precisa existir lá). Doc: https://app.omie.com.br/api/v1/geral/produtos/
 *   IncluirProduto  — produto_servico_cadastro: codigo_produto_integracao, codigo, descricao, unidade,
 *                     ncm, valor_unitario (obrigatórios); ean, codigo_familia, tipoItem, inativo, obs_internas
 *   AlterarProduto  — o mesmo, identificando por codigo_produto (id do Omie)
 * Resposta: { codigo_produto, codigo_produto_integracao, codigo_status ("0" = ok), descricao_status }.
 * O Omie responde HTTP 200 mesmo com erro (faultstring/faultcode) — sempre olhar o corpo.
 *
 * Desde 05/10/26 desligado por padrão (saída do Omie); religar só com env ESTOQUE_OMIE_ESCRITA=on. Só a SF tem chave na Vercel; CD/WW dão erro claro.
 */

const URL_PRODUTOS = "https://app.omie.com.br/api/v1/geral/produtos/";

// 05/10/26 — saída do Omie: desligado por padrão; só escreve com ESTOQUE_OMIE_ESCRITA=on.
export const escritaOmieLigada = () => (process.env.ESTOQUE_OMIE_ESCRITA ?? "off").toLowerCase() === "on";

export function credsOmie(empresa: string): { app_key: string; app_secret: string } | null {
  const k = process.env[`OMIE_APP_KEY_${empresa.toUpperCase()}`], s = process.env[`OMIE_APP_SECRET_${empresa.toUpperCase()}`];
  return k && s ? { app_key: k, app_secret: s } : null;
}

/** NCM do painel (8 dígitos) → formato do Omie (0000.00.00). */
export const ncmOmie = (n: string | null | undefined) => {
  const d = String(n ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}` : d;
};

export type ItemOmie = {
  codigo: string; descricao: string; unidade: string; ncm: string; ean?: string | null; valor_unitario?: number | null;
  codigo_familia?: number | null; obs?: string | null; ativo?: boolean; codigo_produto?: number | null;
};

/** Monta o produto_servico_cadastro. Exportado para conferir o payload sem chamar o Omie. */
export function payloadProduto(it: ItemOmie): Record<string, unknown> {
  const p: Record<string, unknown> = {
    codigo_produto_integracao: it.codigo, codigo: it.codigo,
    descricao: it.descricao.slice(0, 120), unidade: (it.unidade || "UN").slice(0, 6).toUpperCase(),
    ncm: ncmOmie(it.ncm), valor_unitario: Number(it.valor_unitario ?? 0) || 0,
    tipoItem: "00", inativo: it.ativo === false ? "S" : "N",
  };
  if (it.ean) p.ean = it.ean;
  if (it.codigo_familia) p.codigo_familia = it.codigo_familia;
  if (it.obs) p.obs_internas = it.obs;
  if (it.codigo_produto) {
    // Alterar identifica pelo id do Omie e não mexe no código/código de integração que o produto já tem lá.
    p.codigo_produto = it.codigo_produto;
    delete p.codigo_produto_integracao;
    delete p.codigo;
  }
  return p;
}

export type RespostaOmie = { ok: boolean; codigo_produto?: number; erro?: string; corpo: unknown };

export async function enviarProdutoOmie(empresa: string, acao: "IncluirProduto" | "AlterarProduto", it: ItemOmie): Promise<RespostaOmie> {
  if (!escritaOmieLigada()) return { ok: false, erro: "Cópia no Omie desligada (ESTOQUE_OMIE_ESCRITA=off)", corpo: null };
  const c = credsOmie(empresa);
  if (!c) return { ok: false, erro: `Sem chave do Omie para a empresa ${empresa} no painel (só a SF está configurada)`, corpo: null };
  if (!it.ncm || ncmOmie(it.ncm).replace(/\D/g, "").length !== 8) return { ok: false, erro: "O Omie exige NCM (8 dígitos) para criar o produto", corpo: null };
  try {
    const r = await fetch(URL_PRODUTOS, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call: acao, app_key: c.app_key, app_secret: c.app_secret, param: [payloadProduto(it)] }),
    });
    const txt = await r.text();
    let j: Record<string, unknown> | null = null;
    try { j = JSON.parse(txt); } catch { /* corpo não-JSON */ }
    if (!j) return { ok: false, erro: `Resposta não-JSON do Omie (HTTP ${r.status})`, corpo: txt.slice(0, 2000) };
    if (j.faultstring || j.faultcode) return { ok: false, erro: String(j.faultstring ?? j.faultcode), corpo: j };
    if (j.codigo_status != null && String(j.codigo_status) !== "0") return { ok: false, erro: String(j.descricao_status ?? `status ${j.codigo_status}`), corpo: j };
    const id = Number(j.codigo_produto);
    return { ok: true, codigo_produto: Number.isFinite(id) && id > 0 ? id : undefined, corpo: j };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "erro de rede", corpo: null };
  }
}
