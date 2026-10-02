import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { orders, platform } from "@/lib/estoque-server";

/**
 * Revisão de famílias — 2ª passada com IA (02/10/26). Mesma chave do Cesar (ANTHROPIC_API_KEY).
 * Para cada item ainda "sem sugestão": manda à IA (lotes de 25, 3 em paralelo) código, descrição, NCM, unidade,
 * família atual, 3 vizinhos parecidos com a família deles e a família da maioria do NCM, junto com as famílias de
 * material ativas (com exemplos). A IA devolve {familia, confianca 0–100, motivo, nova?}.
 * Teto: "média" (0,79); só chega a "alta" quando o NCM (≥ 50% dos itens do NCM) ou um vizinho parecido (≥ 0,30) concordam.
 * Cache em platform.estoque_familia_ia (por item + descrição) — recalcular reaplica sem pagar de novo. Nunca aplica sozinho.
 */

const MODELO = () => process.env.ESTOQUE_IA_MODEL || "claude-sonnet-5";
// Estimativa de custo (US$ por milhão de tokens) — só para o relatório; ajuste por env se o preço mudar.
const PRECO_IN = () => Number(process.env.ESTOQUE_IA_USD_IN_M) || 3;
const PRECO_OUT = () => Number(process.env.ESTOQUE_IA_USD_OUT_M) || 15;

type Vizinho = { descricao: string; familia: string; familia_id: number; sim?: number };
type Ctx = { n_cod_prod: number; codigo: string; descricao: string; ncm: string | null; unidade: string | null; familia_atual: string | null;
  ncm_familia_id: number | null; ncm_familia: string | null; ncm_fatia: number | null; vizinhos: Vizinho[] };
type Fam = { id: number; nome: string; prefixo: string; descricao: string | null; exemplos: string[] };
export type ResultadoIA = { familia_id: number; familia: string; confianca: number; confianca_ia: number; motivo: string; nova: string | null; concorda: string | null };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

function prompt(fams: Fam[], itens: Ctx[]) {
  const lista = fams.map((f) => `- ${f.nome} (prefixo ${f.prefixo})${f.descricao ? `: ${f.descricao}` : ""} — exemplos: ${f.exemplos.slice(0, 5).join(" | ")}`).join("\n");
  const its = itens.map((i) => JSON.stringify({
    codigo: i.codigo, descricao: i.descricao, ncm: i.ncm, unidade: i.unidade, familia_atual: i.familia_atual,
    familia_do_ncm: i.ncm_familia ? `${i.ncm_familia} (${Math.round((i.ncm_fatia ?? 0) * 100)}% dos itens com este NCM)` : null,
    parecidos: i.vizinhos.map((v) => `${v.descricao} → ${v.familia}`),
  })).join("\n");
  return `Você organiza o estoque da Waterworks (tratamento de água: osmose reversa, hemodiálise, hospitais, indústria).
Classifique cada item numa FAMÍLIA DE MATERIAL da lista abaixo (use o nome exatamente como está).

Famílias:
${lista}

Regras:
- Escolha SEMPRE a família existente que melhor serve, mesmo com dúvida (confiança baixa).
- confianca: 0 a 100 (100 = certeza).
- motivo: curto, em português (até 15 palavras), dizendo o que o item é. Ex.: "CLP = controlador lógico, automação".
- Se nenhuma família existente serve bem (ex.: meios filtrantes como zeólito sem família própria), escolha a mais próxima E preencha "nova" com o nome da família que falta. Senão "nova": null.
- "familia_atual" e "parecidos" são pistas; o NCM ajuda quando existe.

Itens (um JSON por linha):
${its}

Responda SÓ com JSON, sem texto em volta:
{"itens":[{"codigo":"...","familia":"NOME DA LISTA","confianca":0,"motivo":"...","nova":null}]}`;
}

/** Classifica uma lista de itens (contexto já montado). Devolve por código + tokens usados. */
async function classificar(cliente: Anthropic, fams: Fam[], itens: Ctx[]) {
  const r = await cliente.messages.create({
    model: MODELO(), max_tokens: 8000,
    messages: [{ role: "user", content: prompt(fams, itens) }],
  });
  const txt = r.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  const i = txt.indexOf("{"), j = txt.lastIndexOf("}");
  type Saida = { codigo: string; familia: string; confianca: number; motivo: string; nova: string | null };
  let out: Saida[] = [];
  try { out = JSON.parse(txt.slice(i, j + 1)).itens ?? []; }
  catch {
    // resposta cortada (limite de tokens): aproveita cada objeto completo {"codigo":…}
    for (const m of txt.matchAll(/\{[^{}]*"codigo"[^{}]*\}/g)) { try { out.push(JSON.parse(m[0])); } catch { /* objeto incompleto */ } }
  }
  return { out, tin: r.usage?.input_tokens ?? 0, tout: r.usage?.output_tokens ?? 0 };
}

/** Teto da confiança + quem concorda (NCM / vizinhos). */
function avaliar(c: Ctx, fam: Fam, confIA: number): Pick<ResultadoIA, "confianca" | "concorda"> {
  const ncm = c.ncm_familia_id === fam.id && (c.ncm_fatia ?? 0) >= 0.5;
  const viz = c.vizinhos.filter((v) => v.familia_id === fam.id && (v.sim ?? 1) >= 0.3).length > 0
    || c.vizinhos.filter((v) => v.familia_id === fam.id).length >= 2;
  const concorda = ncm && viz ? "ncm+vizinhos" : ncm ? "ncm" : viz ? "vizinhos" : null;
  const teto = concorda ? 0.95 : 0.79;
  return { confianca: Math.round(Math.min(Math.max(confIA, 1) / 100, teto) * 100) / 100, concorda };
}

function mapear(fams: Fam[], nome: string): Fam | undefined {
  const n = semAcento(nome ?? "");
  return fams.find((f) => semAcento(f.nome) === n) ?? fams.find((f) => n.startsWith(semAcento(f.nome)) || semAcento(f.nome).startsWith(n));
}

const motivoTexto = (r: Pick<ResultadoIA, "motivo" | "concorda" | "nova">) =>
  `IA: ${r.motivo}${r.concorda ? ` · confirmado pelo ${r.concorda === "ncm" ? "NCM" : r.concorda === "vizinhos" ? "itens parecidos" : "NCM e itens parecidos"}` : ""}${r.nova ? ` · sugere criar a família “${r.nova}”` : ""}`;

/**
 * Passada de IA sobre as sugestões pendentes SEM família sugerida. Aplica o cache primeiro; só o resto vai à IA.
 * Devolve contagens por faixa, propostas de família nova e tokens/custo estimado.
 */
export async function passadaIA(empresa = "SF") {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) throw new Error("ANTHROPIC_API_KEY não configurada");
  const sug = await platform().from("estoque_familia_sugestao").select("n_cod_prod").eq("empresa", empresa).eq("status", "pendente").is("familia_sugerida_id", null).limit(2000);
  if (sug.error) throw new Error(sug.error.message);
  const ids = (sug.data ?? []).map((s) => Number(s.n_cod_prod));
  const res = { candidatos: ids.length, do_cache: 0, classificados: 0, sem_resposta: 0, tokens_in: 0, tokens_out: 0, custo_usd: 0, modelo: MODELO(),
    faixas: { alta: 0, media: 0, baixa: 0 }, propostas: {} as Record<string, number> };
  if (!ids.length) return res;

  const [famR, ctxR, cacheR] = await Promise.all([
    orders().rpc("estoque_ia_familias", { p_empresa: empresa }),
    orders().rpc("estoque_ia_contexto", { p_empresa: empresa, p_ids: ids }),
    platform().from("estoque_familia_ia").select("*").eq("empresa", empresa).in("n_cod_prod", ids),
  ]);
  if (famR.error) throw new Error(famR.error.message);
  if (ctxR.error) throw new Error(ctxR.error.message);
  if (cacheR.error) throw new Error(cacheR.error.message);
  const fams = (famR.data ?? []) as Fam[];
  const ctx = ((ctxR.data ?? []) as Ctx[]).map((c) => ({ ...c, n_cod_prod: Number(c.n_cod_prod) }));
  const cache = new Map(((cacheR.data ?? []) as { n_cod_prod: number; descricao: string; familia_id: number; confianca: number; motivo: string; proposta_nova: string | null; concorda: string | null; confianca_ia: number }[])
    .map((c) => [Number(c.n_cod_prod), c]));

  const gravar = async (c: Ctx, r: ResultadoIA, doCache: boolean) => {
    const u = await platform().from("estoque_familia_sugestao").update({
      familia_sugerida_id: r.familia_id, confianca: r.confianca, motivo: motivoTexto(r), fonte: "ia",
    }).eq("empresa", empresa).eq("n_cod_prod", c.n_cod_prod).eq("status", "pendente");
    if (u.error) throw new Error(u.error.message);
    if (!doCache) {
      const w = await platform().from("estoque_familia_ia").upsert({ empresa, n_cod_prod: c.n_cod_prod, descricao: c.descricao, familia_id: r.familia_id,
        confianca_ia: r.confianca_ia, confianca: r.confianca, motivo: r.motivo, proposta_nova: r.nova, concorda: r.concorda, modelo: MODELO(), created_at: new Date().toISOString() });
      if (w.error) throw new Error(w.error.message);
    }
    if (r.confianca >= 0.8) res.faixas.alta++; else if (r.confianca >= 0.6) res.faixas.media++; else res.faixas.baixa++;
    if (r.nova) res.propostas[r.nova.toUpperCase()] = (res.propostas[r.nova.toUpperCase()] ?? 0) + 1;
  };

  const faltam: Ctx[] = [];
  for (const c of ctx) {
    const k = cache.get(c.n_cod_prod);
    if (k && k.descricao === c.descricao && fams.some((f) => f.id === Number(k.familia_id))) {
      await gravar(c, { familia_id: Number(k.familia_id), familia: "", confianca: Number(k.confianca), confianca_ia: Number(k.confianca_ia), motivo: k.motivo, nova: k.proposta_nova, concorda: k.concorda }, true);
      res.do_cache++;
    } else faltam.push(c);
  }

  const cliente = new Anthropic({ apiKey: chave });
  const lotes: Ctx[][] = [];
  for (let i = 0; i < faltam.length; i += 25) lotes.push(faltam.slice(i, i + 25));
  let idx = 0;
  const trabalhador = async () => {
    while (idx < lotes.length) {
      const lote = lotes[idx++];
      const porCodigo = new Map(lote.map((c) => [String(c.codigo), c]));
      let r;
      try { r = await classificar(cliente, fams, lote); }
      catch (e) { console.error("[estoque-ia] lote falhou:", (e as Error).message); res.sem_resposta += lote.length; continue; }
      res.tokens_in += r.tin; res.tokens_out += r.tout;
      const feitos = new Set<string>();
      for (const o of r.out) {
        const c = porCodigo.get(String(o.codigo)); const f = mapear(fams, o.familia);
        if (!c || !f || feitos.has(String(o.codigo))) continue;
        feitos.add(String(o.codigo));
        const confIA = Math.round(Number(o.confianca) || 0);
        const av = avaliar(c, f, confIA);
        await gravar(c, { familia_id: f.id, familia: f.nome, confianca_ia: confIA, ...av, motivo: String(o.motivo ?? "").slice(0, 200), nova: o.nova ? String(o.nova).slice(0, 60) : null }, false);
        res.classificados++;
      }
      res.sem_resposta += lote.length - feitos.size;
    }
  };
  await Promise.all([trabalhador(), trabalhador(), trabalhador()]);
  res.custo_usd = Math.round(((res.tokens_in / 1e6) * PRECO_IN() + (res.tokens_out / 1e6) * PRECO_OUT()) * 100) / 100;
  return res;
}

/** "Novo item": sugere a família pela descrição (+ NCM). Uma chamada pequena. */
export async function sugerirFamiliaTexto(descricao: string, ncm: string | null, empresa = "SF"): Promise<ResultadoIA | null> {
  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave || descricao.trim().length < 3) return null;
  const [famR, ctxR] = await Promise.all([
    orders().rpc("estoque_ia_familias", { p_empresa: empresa }),
    orders().rpc("estoque_ia_contexto_texto", { p_empresa: empresa, p_descricao: descricao, p_ncm: ncm ?? "" }),
  ]);
  if (famR.error || ctxR.error) throw new Error((famR.error ?? ctxR.error)!.message);
  const fams = (famR.data ?? []) as Fam[];
  const c = { ...(ctxR.data as Ctx), codigo: "novo", familia_atual: null, unidade: null };
  const r = await classificar(new Anthropic({ apiKey: chave }), fams, [c]);
  const o = r.out[0];
  const f = o ? mapear(fams, o.familia) : undefined;
  if (!o || !f) return null;
  const confIA = Math.round(Number(o.confianca) || 0);
  return { familia_id: f.id, familia: f.nome, confianca_ia: confIA, ...avaliar(c, f, confIA), motivo: String(o.motivo ?? ""), nova: o.nova ?? null };
}
