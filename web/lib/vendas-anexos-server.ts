import "server-only";
import { randomUUID } from "node:crypto";
import { supaAdmin } from "@/lib/supabase-admin";
import { BUCKET_VENDAS_ANEXOS, partirLabel, type OcDoc, type OcResumo, type VendaAnexo } from "@/lib/vendas-anexos";

// OC do cliente e anexos do PV/OS (sql/110). Tudo pelas RPCs orders.vendas_oc_*
// e vendas_anexo_* (o schema vendas não é exposto). Enquanto a sql/110 não
// estiver aplicada, a leitura cai para o nº do Omie (sales.v_erp_vendas) e a
// escrita responde "migração pendente".

export const MSG_PENDENTE = "Migração pendente (sql/110_vendas_anexos_oc.sql): anexos e OC no painel ainda não estão ligados";

export class MigracaoPendente extends Error {
  constructor() { super(MSG_PENDENTE); }
}

/** Função/tabela da sql/110 ainda não existe no banco? */
const ehPendente = (msg: string) => /Could not find the function|schema cache|does not exist/i.test(msg);

async function rpcOc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supaAdmin().schema("orders").rpc(fn, args);
  if (error) {
    if (ehPendente(error.message)) throw new MigracaoPendente();
    throw new Error(error.message);
  }
  return data as T;
}

/** Arquivos do painel (bucket privado): acrescenta url_assinada (1 h). `url`
 *  fica só para links externos (CRM, Drive…). */
export async function assinar<T extends { arquivo_path?: string | null }>(anexos: T[]): Promise<(T & { url_assinada?: string | null })[]> {
  const paths = anexos.filter((a) => a.arquivo_path).map((a) => a.arquivo_path!);
  if (!paths.length) return anexos;
  const { data } = await supaAdmin().storage.from(BUCKET_VENDAS_ANEXOS).createSignedUrls(paths, 3600);
  const m = new Map((data ?? []).map((s) => [s.path, s.signedUrl]));
  return anexos.map((a) => (a.arquivo_path ? { ...a, url_assinada: m.get(a.arquivo_path) ?? null } : a));
}

/** Nº da OC que está no espelho do Omie / nativo (sem a sql/110). */
async function ocDoEspelho(empresa: string, tipo: string, numero: string): Promise<string | null> {
  const { data } = await supaAdmin().schema("sales").from("v_erp_vendas")
    .select("num_pedido_cliente").eq("empresa", empresa).eq("tipo", tipo).eq("numero", numero).limit(1).maybeSingle();
  const v = (data as { num_pedido_cliente?: string | null } | null)?.num_pedido_cliente;
  return v && v.trim() ? v.trim() : null;
}

/** Um PV/OS: OC + anexos (URLs dos arquivos do painel já assinadas). */
export async function ocDoc(empresa: string, tipo: "PV" | "OS", numero: string): Promise<OcDoc> {
  try {
    const d = await rpcOc<OcDoc>("vendas_oc_doc", { p_empresa: empresa, p_tipo: tipo, p_numero: numero });
    return { ...d, anexos: await assinar(d.anexos ?? []) };
  } catch (e) {
    if (!(e instanceof MigracaoPendente)) throw e;
    const oc = await ocDoEspelho(empresa, tipo, numero);
    return { empresa, tipo, numero, label: tipo + numero, num_pedido_cliente: oc, oc_origem: oc ? "omie" : null, oc_omie: oc,
      documento_id: null, nativo: false, anexos: [], pendente: true };
  }
}

/** Vários PV/OS (cards/linhas): nº da OC e contagem de anexos por label. */
export async function ocResumo(empresa: string, labels: string[]): Promise<{ rows: OcResumo[]; pendente?: boolean }> {
  const ls = [...new Set(labels.map((l) => l.trim().toUpperCase()).filter((l) => partirLabel(l)))].slice(0, 2000);
  if (!ls.length) return { rows: [] };
  try {
    return { rows: await rpcOc<OcResumo[]>("vendas_oc_resumo", { p_empresa: empresa, p_labels: ls }) };
  } catch (e) {
    if (!(e instanceof MigracaoPendente)) throw e;
    const rows: OcResumo[] = [];
    for (let i = 0; i < ls.length; i += 300) {
      const { data } = await supaAdmin().schema("sales").from("v_erp_vendas")
        .select("label, num_pedido_cliente").eq("empresa", empresa).in("label", ls.slice(i, i + 300));
      for (const r of (data ?? []) as { label: string; num_pedido_cliente: string | null }[]) {
        const oc = r.num_pedido_cliente?.trim() || null;
        rows.push({ label: r.label, num_pedido_cliente: oc, oc_origem: oc ? "omie" : null, anexos: 0, anexos_oc: 0 });
      }
    }
    return { rows, pendente: true };
  }
}

export async function ocDefinir(empresa: string, tipo: "PV" | "OS", numero: string, oc: string | null, por: string) {
  return rpcOc<OcDoc>("vendas_oc_definir", { p_empresa: empresa, p_tipo: tipo, p_numero: numero, p_oc: oc ?? "", p_por: por });
}

export type AnexoNovo = { nome?: string | null; url?: string | null; arquivo_path?: string | null; tipo?: string | null; tamanho?: number | null; mime?: string | null };

export async function anexoIncluir(empresa: string, tipo: "PV" | "OS", numero: string, a: AnexoNovo, origem: "painel" | "crm", por: string) {
  return rpcOc<VendaAnexo>("vendas_anexo_incluir", { p: {
    empresa, tipo, numero, nome: a.nome ?? null, url: a.url ?? null, arquivo_path: a.arquivo_path ?? null,
    anexo_tipo: a.tipo === "oc_cliente" ? "oc_cliente" : "outro", tamanho: a.tamanho ?? null, mime: a.mime ?? null, origem, por,
  } });
}

export async function anexoRemover(id: number, por: string) {
  const r = await rpcOc<VendaAnexo>("vendas_anexo_remover", { p_id: id, p_por: por });
  // O registo fica (apagar lógico, com quem e quando); o arquivo sai do bucket.
  if (r.arquivo_path) await supaAdmin().storage.from(BUCKET_VENDAS_ANEXOS).remove([r.arquivo_path]).then(() => null, () => null);
  return r;
}

/** URL assinada de upload direto do navegador ao bucket (sem passar os bytes
 *  pela função da Vercel, que corta em ~4,5 MB). */
export async function urlDeUpload(empresa: string, tipo: string, numero: string, nome: string) {
  const limpo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-120) || "arquivo";
  const path = `${empresa}/${tipo}${numero}/${randomUUID().slice(0, 8)}-${limpo}`;
  const { data, error } = await supaAdmin().storage.from(BUCKET_VENDAS_ANEXOS).createSignedUploadUrl(path);
  if (error) {
    if (/not found|bucket/i.test(error.message)) throw new MigracaoPendente();
    throw new Error(error.message);
  }
  return { path: data.path, token: data.token, signedUrl: data.signedUrl };
}

/** Normaliza a lista de anexos que vem do CRM: [{nome,url,tipo}]. */
export function anexosDoCorpo(v: unknown): AnexoNovo[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object" && typeof (x as { url?: unknown }).url === "string" && /^https?:\/\//i.test((x as { url: string }).url.trim()))
    .map((x) => {
      const o = x as { nome?: unknown; url: string; tipo?: unknown };
      return { nome: o.nome != null ? String(o.nome).slice(0, 300) : null, url: o.url.trim(), tipo: o.tipo === "oc_cliente" ? "oc_cliente" : "outro" };
    });
}
