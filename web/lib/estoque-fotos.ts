import "server-only";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { supaAdmin } from "@/lib/supabase-admin";
import { orders, platform } from "@/lib/estoque-server";
import { termoBusca } from "@/lib/estoque";

/**
 * Fotos dos itens do Estoque (02/10/26).
 *
 * Provedor de busca de imagens escolhido por env (servidor, nunca no navegador):
 *   IMAGE_SEARCH_PROVIDER = google | serpapi | serper | brave
 *   IMAGE_SEARCH_KEY      = chave do provedor
 *   IMAGE_SEARCH_CX       = só google (id do mecanismo do Programmable Search Engine)
 * Sem as variáveis o job fica parado e a tela mostra "busca automática aguardando chave".
 *
 * A foto escolhida é BAIXADA e guardada no bucket privado "produtos" (Supabase Storage); a tela usa
 * URL assinada. Nunca usamos o link externo como foto (hotlink). Os candidatos (top 5) ficam
 * gravados para o "Trocar foto" mostrar alternativas sem gastar outra busca.
 */

export const BUCKET = "produtos";
export type Provedor = "google" | "serpapi" | "serper" | "brave";
export type Candidato = { url: string; thumb: string | null; titulo: string | null; pagina: string | null; largura: number | null; altura: number | null };

/** Erro do provedor, já classificado: limite por minuto (tenta depois), cota esgotada (pausa até amanhã), chave inválida (desliga). */
export class ErroProvedor extends Error {
  constructor(msg: string, public tipo: "limite" | "cota" | "chave" | "outro", public status?: number) { super(msg); }
}

export function configProvedor(): { provedor: Provedor | null; pronto: boolean; faltando: string[] } {
  const p = (process.env.IMAGE_SEARCH_PROVIDER ?? "").trim().toLowerCase() as Provedor;
  const valido = (["google", "serpapi", "serper", "brave"] as const).includes(p as Provedor);
  const faltando: string[] = [];
  if (!valido) faltando.push("IMAGE_SEARCH_PROVIDER (google | serpapi | serper | brave)");
  if (!(process.env.IMAGE_SEARCH_KEY ?? "").trim()) faltando.push("IMAGE_SEARCH_KEY");
  if (p === "google" && !(process.env.IMAGE_SEARCH_CX ?? "").trim()) faltando.push("IMAGE_SEARCH_CX");
  return { provedor: valido ? p : null, pronto: faltando.length === 0, faltando };
}

const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

async function pedir(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  let r: Response;
  try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), cache: "no-store" }); }
  catch (e) { throw new ErroProvedor(`Sem resposta do provedor: ${(e as Error).message}`, "outro"); }
  const txt = await r.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(txt); } catch {}
  const msg = String((j.error as { message?: string })?.message ?? j.error ?? j.message ?? txt.slice(0, 200) ?? r.statusText);
  if (r.status === 429) {
    // Google devolve 429 tanto para "por minuto" quanto para a cota do dia
    const cota = /daily|quota|per day|Queries per day/i.test(msg);
    throw new ErroProvedor(`Limite do provedor: ${msg}`, cota ? "cota" : "limite", 429);
  }
  if (r.status === 401) throw new ErroProvedor(`Chave recusada pelo provedor: ${msg}`, "chave", 401);
  if (r.status === 402) throw new ErroProvedor(`Créditos do provedor esgotados: ${msg}`, "cota", 402);
  if (r.status === 403) {
    const cota = /quota|limit|credits|exceeded/i.test(msg);
    throw new ErroProvedor(`${cota ? "Cota do provedor esgotada" : "Acesso negado pelo provedor"}: ${msg}`, cota ? "cota" : "chave", 403);
  }
  if (!r.ok) throw new ErroProvedor(`Provedor respondeu ${r.status}: ${msg}`, r.status >= 500 ? "limite" : "outro", r.status);
  // SerpApi devolve 200 com { error } em alguns casos (sem créditos, chave errada)
  if (typeof j.error === "string") {
    const e = j.error as string;
    if (/run out of searches|credits|plan/i.test(e)) throw new ErroProvedor(`Créditos do provedor esgotados: ${e}`, "cota");
    if (/invalid api key|api key/i.test(e)) throw new ErroProvedor(`Chave recusada pelo provedor: ${e}`, "chave");
    if (!/hasn't returned any results|no results/i.test(e)) throw new ErroProvedor(e, "outro");
  }
  return j;
}

/** Busca imagens no provedor configurado. Devolve até 10 candidatos (os 5 primeiros ficam gravados). */
export async function buscarImagens(termo: string): Promise<Candidato[]> {
  const cfg = configProvedor();
  if (!cfg.pronto || !cfg.provedor) throw new ErroProvedor(`Busca automática aguardando chave (${cfg.faltando.join(", ")})`, "chave");
  const key = process.env.IMAGE_SEARCH_KEY!.trim();
  const q = termo.trim();
  if (cfg.provedor === "google") {
    const u = new URL("https://www.googleapis.com/customsearch/v1");
    u.search = new URLSearchParams({ key, cx: process.env.IMAGE_SEARCH_CX!.trim(), q, searchType: "image", num: "10", safe: "active", gl: "br", hl: "pt-BR" }).toString();
    const j = await pedir(u.toString(), { method: "GET" });
    return ((j.items ?? []) as Record<string, unknown>[]).map((x) => {
      const im = (x.image ?? {}) as Record<string, unknown>;
      return { url: String(x.link), thumb: str(im.thumbnailLink), titulo: str(x.title), pagina: str(im.contextLink), largura: num(im.width), altura: num(im.height) };
    });
  }
  if (cfg.provedor === "serpapi") {
    const u = new URL("https://serpapi.com/search.json");
    u.search = new URLSearchParams({ engine: "google_images", q, api_key: key, gl: "br", hl: "pt-br", safe: "active" }).toString();
    const j = await pedir(u.toString(), { method: "GET" });
    return ((j.images_results ?? []) as Record<string, unknown>[]).slice(0, 10).map((x) => ({
      url: String(x.original ?? x.thumbnail), thumb: str(x.thumbnail), titulo: str(x.title), pagina: str(x.link), largura: num(x.original_width), altura: num(x.original_height),
    }));
  }
  if (cfg.provedor === "serper") {
    const j = await pedir("https://google.serper.dev/images", {
      method: "POST", headers: { "X-API-KEY": key, "Content-Type": "application/json" },
      body: JSON.stringify({ q, gl: "br", hl: "pt-br", num: 10 }),
    });
    return ((j.images ?? []) as Record<string, unknown>[]).slice(0, 10).map((x) => ({
      url: String(x.imageUrl), thumb: str(x.thumbnailUrl), titulo: str(x.title), pagina: str(x.link), largura: num(x.imageWidth), altura: num(x.imageHeight),
    }));
  }
  // brave
  const u = new URL("https://api.search.brave.com/res/v1/images/search");
  u.search = new URLSearchParams({ q, count: "20", country: "BR", search_lang: "pt-br", safesearch: "strict" }).toString();
  const j = await pedir(u.toString(), { method: "GET", headers: { Accept: "application/json", "X-Subscription-Token": key } });
  return ((j.results ?? []) as Record<string, unknown>[]).slice(0, 10).map((x) => {
    const pr = (x.properties ?? {}) as Record<string, unknown>, th = (x.thumbnail ?? {}) as Record<string, unknown>;
    return { url: String(pr.url ?? th.src), thumb: str(th.src), titulo: str(x.title), pagina: str(x.url), largura: num(pr.width), altura: num(pr.height) };
  });
}

/** Ordena: imagens maiores e mais "quadradas" primeiro; descarta minúsculas e formatos que não guardamos. */
export function melhores(c: Candidato[]): Candidato[] {
  const ok = c.filter((x) => /^https?:\/\//i.test(x.url) && !/\.(svg|ico|bmp|tiff?)(\?|$)/i.test(x.url)
    && (x.largura == null || x.largura >= 150) && (x.altura == null || x.altura >= 150));
  const nota = (x: Candidato) => {
    if (!x.largura || !x.altura) return 0.5;
    const ar = Math.min(x.largura, x.altura) / Math.max(x.largura, x.altura);
    return ar * 0.6 + Math.min(1, Math.min(x.largura, x.altura) / 800) * 0.4;
  };
  // a ordem de relevância do provedor pesa: cada posição abaixo custa 0,03 de nota
  return ok.map((x, i) => ({ x, s: nota(x) - i * 0.03 })).sort((a, b) => b.s - a.s).map((o) => o.x);
}

// ── Download seguro (sem SSRF) ───────────────────────────────────────────────
function ipPrivado(ip: string) {
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    if (l.startsWith("::ffff:")) return ipPrivado(l.slice(7));
    return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") || l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb");
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
async function hostSeguro(u: URL) {
  if (!/^https?:$/.test(u.protocol)) throw new Error("Só links http(s)");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname)) throw new Error("Endereço não permitido");
  const ips = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
  if (!ips.length || ips.some((x) => ipPrivado(x.address))) throw new Error("Endereço não permitido");
}
const MAX = 5 * 1024 * 1024;
const TIPOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
function tipoPelosBytes(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** Baixa uma imagem da web com checagens (IP público, até 3 redirecionamentos, 5 MB, tipo pelos bytes). */
export async function baixarImagem(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  let atual = new URL(url);
  for (let i = 0; i < 4; i++) {
    await hostSeguro(atual);
    const r = await fetch(atual, { redirect: "manual", signal: AbortSignal.timeout(12_000),
      headers: { "User-Agent": "Mozilla/5.0 (painel.waterworks.com.br; foto de item de estoque)", Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8" } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { atual = new URL(r.headers.get("location")!, atual); continue; }
    if (!r.ok) throw new Error(`O site respondeu ${r.status}`);
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > MAX) throw new Error("Imagem maior que 5 MB");
    const reader = r.body?.getReader();
    if (!reader) throw new Error("Sem conteúdo");
    const partes: Uint8Array[] = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX) { await reader.cancel(); throw new Error("Imagem maior que 5 MB"); }
      partes.push(value);
    }
    const bytes = new Uint8Array(total); let o = 0;
    for (const p of partes) { bytes.set(p, o); o += p.length; }
    const mime = tipoPelosBytes(bytes);
    if (!mime) throw new Error("O link não é uma imagem JPG, PNG, WEBP ou GIF");
    if (total < 2_000) throw new Error("Imagem pequena demais");
    return { bytes, mime };
  }
  throw new Error("Redirecionamentos demais");
}

/** Guarda a imagem no bucket privado e marca como foto atual do item (substitui a anterior). */
export async function guardarFoto(empresa: string, n_cod_prod: number, img: { bytes: Uint8Array; mime: string },
  meta: { origem: "web" | "upload" | "url"; source_url?: string | null; provider?: string | null; termo?: string | null; email?: string | null }) {
  const ext = TIPOS[img.mime];
  if (!ext) throw new Error("Tipo de imagem não suportado");
  const hash = createHash("sha256").update(img.bytes).digest("hex").slice(0, 16);
  const path = `${empresa}/${n_cod_prod}/${hash}.${ext}`;
  const st = supaAdmin().storage.from(BUCKET);
  const up = await st.upload(path, img.bytes, { contentType: img.mime, upsert: true, cacheControl: "31536000" });
  if (up.error) throw new Error(`Storage: ${up.error.message}`);
  const antes = await platform().from("estoque_foto").select("path").eq("empresa", empresa).eq("n_cod_prod", n_cod_prod).maybeSingle();
  const r = await platform().from("estoque_foto").upsert({
    empresa, n_cod_prod, path, origem: meta.origem, source_url: meta.source_url ?? null, provider: meta.provider ?? null, termo: meta.termo ?? null,
    mime: img.mime, bytes: img.bytes.length, created_by_email: meta.email ?? null, created_at: new Date().toISOString(),
  });
  if (r.error) throw new Error(r.error.message);
  if (antes.data?.path && antes.data.path !== path) await st.remove([antes.data.path]);
  return path;
}

export async function urlsAssinadas(paths: string[], segundos = 3600): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!paths.length) return m;
  const r = await supaAdmin().storage.from(BUCKET).createSignedUrls(paths, segundos);
  if (r.error) throw new Error(r.error.message);
  for (const x of r.data ?? []) if (x.signedUrl && x.path) m.set(x.path, x.signedUrl);
  return m;
}

// ── Job ──────────────────────────────────────────────────────────────────────
export type EstadoJob = { ativo: boolean; cota_dia: number; dia: string | null; usados_dia: number; ultimo_lote_em: string | null; ultimo_erro: string | null; pausa_motivo: string | null };

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Buscas em paralelo por ciclo (IMAGE_SEARCH_CONCURRENCY, 1–8; padrão 4). Cada "trabalhador" espera 300 ms entre buscas. */
const concorrencia = () => Math.min(8, Math.max(1, Number(process.env.IMAGE_SEARCH_CONCURRENCY) || 4));

/**
 * Um ciclo do job: pega a vez (lease), pega a fila (maior valor/mais usados primeiro) e processa com
 * alguns trabalhadores em paralelo — cada item: reserva 1 da cota do dia, busca, grava os 5 melhores
 * candidatos e baixa o primeiro que vier. Para na cota do dia, na cota/chave do provedor ou no prazo.
 * Limite por minuto (429): espera e segue; 3 seguidos encerram o ciclo (o próximo retoma).
 * Cron e tela podem chamar juntos: só um ciclo roda por vez.
 */
export async function rodarCiclo(opts: { max?: number; prazoMs?: number; email?: string | null } = {}) {
  const cfg = configProvedor();
  const out = { rodou: false, motivo: "" as string, processados: 0, com_foto: 0, sem_resultado: 0, erros: 0, segundos: 0 };
  if (!cfg.pronto) { out.motivo = `aguardando chave (${cfg.faltando.join(", ")})`; return out; }
  const job = await platform().from("estoque_foto_job").select("*").eq("id", 1).single();
  if (job.error) throw new Error(job.error.message);
  if (!job.data.ativo) { out.motivo = "pausado"; return out; }
  const inicio = Date.now(), prazo = opts.prazoMs ?? 45_000, max = opts.max ?? 40;
  const lease = await orders().rpc("estoque_foto_lease", { p_segundos: Math.ceil(prazo / 1000) + 60 });
  if (lease.error) throw new Error(lease.error.message);
  if (!lease.data) { out.motivo = "outro ciclo em andamento"; return out; }
  out.rodou = true;
  try {
    const fila = await orders().rpc("estoque_foto_fila", { p_empresa: "SF", p_limite: max });
    if (fila.error) throw new Error(fila.error.message);
    const itens = [...((fila.data ?? []) as { n_cod_prod: number; descricao: string }[])];
    if (!itens.length) { out.motivo = "fila vazia — todos os itens já têm foto ou foram buscados"; await pausar(null, "concluído"); return out; }
    let parar = "", limites = 0;

    const processar = async (it: { n_cod_prod: number; descricao: string }) => {
      const id = Number(it.n_cod_prod), termo = termoBusca({ descricao: it.descricao });
      try {
        const top = melhores(await buscarImagens(termo)).slice(0, 5);
        limites = 0;
        let guardou = false, ultimoErro: string | null = null;
        for (const c of top) {
          try { await guardarFoto("SF", id, await baixarImagem(c.url), { origem: "web", source_url: c.url, provider: cfg.provedor, termo, email: opts.email ?? "busca automática" }); guardou = true; break; }
          catch (e) { ultimoErro = (e as Error).message; }
        }
        await platform().from("estoque_foto_busca").upsert({
          empresa: "SF", n_cod_prod: id, termo, provider: cfg.provedor, candidatos: top,
          status: guardou ? "ok" : "sem_resultado", ultimo_erro: guardou ? null : (top.length ? `nenhum candidato baixou: ${ultimoErro}` : "a busca não trouxe imagens"),
          buscado_em: new Date().toISOString(), tentativas: 1,
        });
        out.processados++; if (guardou) out.com_foto++; else out.sem_resultado++;
      } catch (e) {
        const er = e as ErroProvedor;
        if (er instanceof ErroProvedor && er.tipo === "limite") {
          // não conta como erro do item: volta para a fila do próximo ciclo
          limites++; await anotar({ ultimo_erro: er.message });
          if (limites >= 3) parar = "limite por minuto do provedor — retoma no próximo ciclo"; else await espera(5000);
          return;
        }
        const ant = await platform().from("estoque_foto_busca").select("tentativas").eq("empresa", "SF").eq("n_cod_prod", id).maybeSingle();
        await platform().from("estoque_foto_busca").upsert({ empresa: "SF", n_cod_prod: id, termo, provider: cfg.provedor, status: "erro",
          ultimo_erro: er.message, buscado_em: new Date().toISOString(), tentativas: (ant.data?.tentativas ?? 0) + 1 });
        out.erros++;
        if (er instanceof ErroProvedor && er.tipo === "chave") { await pausar(er.message, "chave recusada — confira IMAGE_SEARCH_KEY"); parar = er.message; }
        else if (er instanceof ErroProvedor && er.tipo === "cota") { await anotar({ ultimo_erro: er.message, pausa_motivo: "cota do provedor esgotada — retoma no próximo ciclo" }); parar = er.message; }
        else await anotar({ ultimo_erro: er.message });
      }
    };

    const trabalhador = async () => {
      while (!parar && itens.length && Date.now() - inicio < prazo) {
        const res = await orders().rpc("estoque_foto_reservar", { p_qtd: 1, p_manual: false });
        if (res.error) { parar = res.error.message; break; }
        if (!res.data) { parar = "cota do dia atingida"; await anotar({ pausa_motivo: "cota do dia atingida — retoma amanhã" }); break; }
        const it = itens.shift();
        if (!it) break;
        await processar(it);
        await espera(300);
      }
    };
    await Promise.all(Array.from({ length: concorrencia() }, trabalhador));
    out.motivo = parar || (itens.length ? "prazo do ciclo" : "lote concluído");
    if (out.processados && !parar) await anotar({ pausa_motivo: null });
    return out;
  } finally {
    out.segundos = Math.round((Date.now() - inicio) / 1000);
    await orders().rpc("estoque_foto_lease", { p_segundos: 0 });
  }
}
async function anotar(c: Partial<EstadoJob>) { await platform().from("estoque_foto_job").update({ ...c, updated_at: new Date().toISOString() }).eq("id", 1); }
async function pausar(erro: string | null, motivo: string) { await anotar({ ativo: false, ultimo_erro: erro, pausa_motivo: motivo }); }
