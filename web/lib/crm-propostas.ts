import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { rpc } from "@/lib/compras-server";
import { casarItensCrm, resolverCodigosCrm, type ItemCrm } from "@/lib/catalogo-crm";

/* Proposta do CRM → PV/OS / emissão (05/10/2026). O CRM Legado (Propostas-WW,
   outro Supabase) expõe /api/propostas-painel só de leitura; aqui só se chama
   servidor-a-servidor com o segredo que já existe nas duas Vercel
   (COMPRAS_RC_SECRET). Nenhuma chave do CRM vive no painel.
   Enquanto o endpoint do CRM não estiver publicado, `disponivel` vem falso e a
   tela continua a funcionar (campo da proposta em texto livre). */

const URL_CRM = process.env.CRM_PROPOSTAS_URL || "https://propostas-ww.vercel.app/api/propostas-painel";

export type PropostaResumo = {
  numero: string; status: string | null; valor: number; cliente: string | null; titulo: string | null;
  projeto: string | null; pagamento: string | null; contato: string | null; data: string | null; fechamento: string | null;
  ja_lancado: string | null;
};
type PropostaCrm = PropostaResumo & {
  prazo: string | null; frete: string | null; faturamento: string | null; previsao: string | null;
  cliente_crm?: unknown;
  cliente: string | null;
  itens: { desc: string; qtd: number; unit: number }[];
  cp: { desc: string; qtd: number; custo: number; codigo: string | null }[];
};

class CrmIndisponivel extends Error {}

async function chamar<T>(corpo: Record<string, unknown>): Promise<T> {
  const segredo = process.env.COMPRAS_RC_SECRET;
  if (!segredo) throw new CrmIndisponivel("COMPRAS_RC_SECRET não configurado no painel");
  let r: Response;
  try {
    r = await fetch(URL_CRM, {
      method: "POST", headers: { "content-type": "application/json", "x-compras-secret": segredo },
      body: JSON.stringify(corpo), signal: AbortSignal.timeout(12000), cache: "no-store",
    });
  } catch (e) {
    throw new CrmIndisponivel(`CRM fora do ar: ${(e as Error).message}`);
  }
  const j = (await r.json().catch(() => null)) as { error?: string } | null;
  // rota inexistente na Vercel devolve HTML (sem JSON): o CRM ainda não tem o endpoint publicado
  if ((r.status === 404 || r.status === 405) && !j?.error) throw new CrmIndisponivel("Busca de propostas ainda não publicada no CRM");
  if (!r.ok) throw new Error(j?.error || `CRM respondeu ${r.status}`);
  return j as unknown as T;
}

export async function buscarPropostas(q: string) {
  try {
    const j = await chamar<{ propostas: PropostaResumo[] }>({ acao: "buscar", q });
    return { disponivel: true, propostas: j.propostas ?? [] };
  } catch (e) {
    if (e instanceof CrmIndisponivel) return { disponivel: false, motivo: e.message, propostas: [] as PropostaResumo[] };
    throw e;
  }
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
const so = (s: unknown) => String(s ?? "").replace(/\D/g, "");
/** Mesma regra do CRM ("criar"): o que é serviço vai para a OS, o resto para o PV. */
const RE_SERV = /SERVI[CÇ]|MANUTEN|INSTALA|VISITA|DESINFEC|SANITIZ|LIMPEZA|M[AÃ]O DE OBRA|START ?UP|TREINAMENTO|DI[AÁ]RIA|HORA T[EÉ]CNICA|REGENERA|PROJETO|AN[AÁ]LISE/i;

type Pessoa = Record<string, unknown> & { id: number; codigo: number; razao: string; doc: string | null };

/** Acha a pessoa no cadastro do painel: código do mestre → código Omie → CNPJ → nome. */
async function pessoaDe(empresa: string, cli: { nome?: string | null; cnpj?: string | null; codigo_omie?: string | null; cadastro_codigo?: number | string | null } | null) {
  if (!cli) return null;
  const tentar = async (q: string, ok: (l: { codigo: number; doc: string | null; razao: string }) => boolean) => {
    if (!q) return null;
    const r = await rpc<{ linhas: { id: number; codigo: number; doc: string | null; razao: string }[] }>("cadastros_listar",
      { p_papel: "cliente", p_empresa: empresa, p_q: q, p_ativos: true, p_lim: 20, p_off: 0 }).catch(() => ({ linhas: [] }));
    return (r.linhas ?? []).find(ok) ?? null;
  };
  const cod = String(cli.cadastro_codigo ?? cli.codigo_omie ?? "").trim();
  const doc = so(cli.cnpj);
  const achado =
    (cod && (await tentar(cod, (l) => String(l.codigo) === cod))) ||
    (doc.length >= 11 && (await tentar(doc, (l) => so(l.doc) === doc))) ||
    (cli.nome && (await tentar(String(cli.nome).slice(0, 60), (l) => norm(l.razao) === norm(String(cli.nome))))) || null;
  if (!achado) return null;
  return await rpc<Pessoa | null>("cadastros_obter", { p_id: achado.id }).catch(() => null);
}

/** "15 ddl" → [15] · "30/60/90" → [30,60,90] · "à vista" → [0] */
function diasDe(txt: string | null): number[] {
  const t = String(txt ?? "").toLowerCase();
  if (!t.trim()) return [];
  if (/vista|antecipad/.test(t) && !/\d/.test(t)) return [0];
  return (t.match(/\d{1,3}/g) ?? []).map(Number).filter((n) => n <= 365);
}

async function condicaoCodigo(empresa: string, dias: number[]) {
  if (!dias.length) return null;
  const { data } = await supaAdmin().schema("sales").from("formas_pagamento").select("codigo, descricao").eq("empresa", empresa);
  const lista = (data ?? []) as { codigo: string; descricao: string }[];
  if (dias.length === 1) {
    if (dias[0] === 0) return lista.find((c) => c.codigo === "000")?.codigo ?? null;
    const alvo = `A${String(dias[0]).padStart(2, "0")}`;
    return lista.find((c) => c.codigo === alvo)?.codigo ?? null;
  }
  const chave = dias.join("/");
  return lista.find((c) => (c.descricao.match(/\d+/g) ?? []).join("/") === chave)?.codigo ?? null;
}

export type ItemPrefill = {
  lado: "PV" | "OS"; codigo: string | null; ncod_prod: number | null; descricao: string; unidade: string; ncm: string | null;
  quantidade: number; valor_unitario: number; casado: boolean;
};

/** Monta, a partir da proposta, tudo o que o form do PV/OS e a emissão avulsa precisam. */
export async function prefillProposta(numero: string, empresa = "SF") {
  let j: { proposta: PropostaCrm & { cliente: unknown } };
  try {
    j = await chamar({ acao: "obter", numero });
  } catch (e) {
    if (e instanceof CrmIndisponivel) return { disponivel: false, motivo: e.message };
    throw e;
  }
  const p = j.proposta as unknown as PropostaCrm & { cliente: { nome?: string; cnpj?: string; codigo_omie?: string; cadastro_codigo?: number } | null };
  // códigos: a linha da CP com a mesma descrição dá o código nativo; senão casa pelo texto
  const porDesc = new Map<string, string>();
  for (const r of p.cp ?? []) if (r.codigo) porDesc.set(norm(r.desc), r.codigo);
  const itensVenda = p.itens ?? [];
  const cods = itensVenda.map((i) => porDesc.get(norm(i.desc)) ?? null);
  const resolvidos = cods.some(Boolean) ? await resolverCodigosCrm(cods.filter((c): c is string => !!c), empresa).catch(() => ({} as Record<string, ItemCrm>)) : {};
  const semCod = itensVenda.map((i, k) => (cods[k] ? null : i.desc));
  const casados = semCod.some(Boolean)
    ? await casarItensCrm(semCod.map((x) => x ?? ""), empresa).catch(() => semCod.map(() => null))
    : semCod.map(() => null);
  const omies = new Set<string>();
  const achados: (ItemCrm | null)[] = itensVenda.map((i, k) => {
    const it = cods[k] ? resolvidos[cods[k] as string] ?? null : (RE_SERV.test(i.desc) ? null : casados[k] ?? null);
    if (it?.codigo_omie) omies.add(it.codigo_omie);
    return it;
  });
  const ncm = new Map<string, string>();
  if (omies.size) {
    const { data } = await supaAdmin().schema("orders").from("fat_produto_fiscal").select("codigo_produto, ncm").eq("empresa", empresa).in("codigo_produto", [...omies]);
    for (const r of (data ?? []) as { codigo_produto: string; ncm: string | null }[]) if (r.ncm) ncm.set(r.codigo_produto, r.ncm);
  }
  const itens: ItemPrefill[] = itensVenda.map((i, k) => {
    const it = achados[k];
    return {
      lado: RE_SERV.test(i.desc) ? "OS" : "PV",
      codigo: it?.codigo ?? cods[k] ?? null, ncod_prod: it?.ncod_prod ?? null,
      descricao: i.desc, unidade: it?.unidade || "UN", ncm: it?.codigo_omie ? ncm.get(it.codigo_omie) ?? null : null,
      quantidade: i.qtd, valor_unitario: i.unit, casado: !!it,
    };
  });
  const dias = diasDe(p.pagamento);
  const pessoa = await pessoaDe(empresa, p.cliente);
  const temPV = itens.some((i) => i.lado === "PV"), temOS = itens.some((i) => i.lado === "OS");
  return {
    disponivel: true,
    proposta: {
      numero: p.numero, status: p.status, valor: p.valor, titulo: p.titulo, projeto: p.projeto, pagamento: p.pagamento,
      contato: p.contato, previsao: p.previsao, prazo: p.prazo, frete: p.frete, faturamento: p.faturamento, ja_lancado: p.ja_lancado,
      cliente_crm: p.cliente,
    },
    pessoa, tipo_sugerido: temPV ? "PV" : temOS ? "OS" : "PV", misto: temPV && temOS,
    itens, condicao: { texto: p.pagamento, dias, codigo: await condicaoCodigo(empresa, dias) },
  };
}
