import "server-only";
import { randomUUID } from "node:crypto";
import { supaAdmin } from "@/lib/supabase-admin";

/* NFS-e emitida na prefeitura e registrada no painel (sql/59, 05/10/2026).
   A nota é feita à mão no portal da prefeitura; aqui fica o controle: número,
   valores, retenções, PDF/XML, parcelas a receber (pelo líquido) e a OS
   marcada como faturada. Nada vai ao Omie nem à Focus. */

const BUCKET = "fat-documentos";
const db = () => supaAdmin().schema("orders");

export type NfseManual = {
  id: number; empresa: string; municipio: string; numero: string; codigo_verificacao: string | null;
  data_emissao: string; competencia: string | null; valor_servicos: number; iss_retido: boolean; valor_iss: number;
  ret_ir: number; ret_pis: number; ret_cofins: number; ret_csll: number; ret_inss: number; valor_liquido: number;
  tomador_codigo: number | null; tomador_nome: string | null; tomador_doc: string | null;
  os: { chave: string; rotulo: string; valor: number }[]; os_chaves: string[];
  parcelas: { vencimento: string; valor: number }[]; receber_ids: string[] | null;
  pdf_path: string | null; xml_path: string | null; observacao: string | null; status: "registrada" | "cancelada";
  criado_por: string | null; criado_em: string; cancelado_em: string | null; cancelado_por: string | null; cancelado_motivo: string | null;
};

export async function prefill(empresa: string, chaves: string[]) {
  const { data, error } = await db().rpc("fat_nfse_prefill", { p_empresa: empresa, p_chaves: chaves });
  if (error) throw new Error(error.message);
  return data;
}

export async function lista(empresa: string): Promise<NfseManual[]> {
  const { data, error } = await db().rpc("fat_nfse_lista", { p_empresa: empresa });
  if (error) throw new Error(error.message);
  return (data ?? []) as NfseManual[];
}

const LIMITE = 4 * 1024 * 1024; // limite do corpo da função na Vercel (~4,5 MB)

async function subir(pasta: string, nome: string, f: File | null, tipos: RegExp, contentType: string) {
  if (!f || !f.size) return null;
  if (f.size > LIMITE) throw new Error(`${nome}: arquivo maior que 4 MB`);
  if (!tipos.test(f.name.toLowerCase()) && !tipos.test(f.type)) throw new Error(`${nome}: tipo de arquivo não aceito (${f.name})`);
  const path = `${pasta}/${nome}`;
  const { error } = await supaAdmin().storage.from(BUCKET)
    .upload(path, new Blob([await f.arrayBuffer()], { type: contentType }), { upsert: false, contentType });
  if (error) throw new Error(`Falha ao guardar ${nome}: ${error.message}`);
  return path;
}

/** Registra: sobe PDF/XML, chama orders.fat_nfse_registrar (atômico) e, se
 *  falhar, apaga os arquivos que subiram. */
export async function registrar(dados: Record<string, unknown>, pdf: File | null, xml: File | null, por: string) {
  const empresa = String(dados.empresa || "SF");
  const pasta = `nfse-manual/${empresa}/${randomUUID()}`;
  const subidos: string[] = [];
  try {
    const pdfPath = await subir(pasta, "nfse.pdf", pdf, /\.pdf$|application\/pdf/, "application/pdf");
    if (pdfPath) subidos.push(pdfPath);
    const xmlPath = await subir(pasta, "nfse.xml", xml, /\.xml$|\/xml$/, "application/xml");
    if (xmlPath) subidos.push(xmlPath);
    const { data, error } = await db().rpc("fat_nfse_registrar", {
      p: { ...dados, empresa, pdf_path: pdfPath, xml_path: xmlPath, por },
    });
    if (error) throw new Error(error.message);
    await refrescarSeNativa(dados.os);
    return data as NfseManual;
  } catch (e) {
    if (subidos.length) await supaAdmin().storage.from(BUCKET).remove(subidos).then(() => null, () => null);
    throw e;
  }
}

export async function cancelar(id: number, motivo: string, por: string) {
  const { data, error } = await db().rpc("fat_nfse_cancelar", { p_id: id, p_motivo: motivo, p_por: por });
  if (error) throw new Error(error.message);
  const m = data as NfseManual;
  await refrescarSeNativa(m.os);
  return m;
}

async function refrescarSeNativa(os: unknown) {
  const temNativa = Array.isArray(os) && os.some((o) => String((o as { chave?: string }).chave ?? "").startsWith("venda:"));
  if (temNativa) await db().rpc("vendas_refrescar").then(() => null, () => null);
}

export async function arquivos(id: number) {
  const { data, error } = await db().from("fat_nfse_manual").select("pdf_path, xml_path").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Registro não encontrado");
  const assinar = async (p: string | null) => {
    if (!p) return null;
    const { data: s } = await supaAdmin().storage.from(BUCKET).createSignedUrl(p, 3600);
    return s?.signedUrl ?? null;
  };
  return { pdf_url: await assinar(data.pdf_path), xml_url: await assinar(data.xml_path) };
}
