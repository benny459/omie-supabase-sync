// OC do cliente e anexos do PV/OS (07/10/26, sql/110) — tipos partilhados
// entre telas e rotas. Chave de um PV/OS: empresa + label ("PV1968", "OS4886"),
// vale para nativos e para os espelhados do Omie.

export type AnexoTipo = "oc_cliente" | "outro";

export type VendaAnexo = {
  id: number; nome: string; tipo: AnexoTipo;
  /** link externo (CRM, Drive…); null para arquivo do painel */
  url: string | null; arquivo_path: string | null;
  /** arquivo do painel (bucket privado): URL assinada válida por 1 h, gerada na leitura */
  url_assinada?: string | null;
  tamanho: number | null; mime: string | null; origem: "painel" | "crm"; por: string | null; em: string;
};

export type OcDoc = {
  empresa: string; tipo: "PV" | "OS"; numero: string; label: string;
  num_pedido_cliente: string | null;
  /** de onde veio o nº: painel (nativo ou guardado no painel) ou omie */
  oc_origem: "painel" | "omie" | null;
  /** o nº que está no Omie (só PV do Omie) — referência quando o painel sobrepõe */
  oc_omie: string | null;
  documento_id: number | null; nativo: boolean; existe?: boolean;
  anexos: VendaAnexo[];
  /** sql/110 ainda não aplicada: só o nº do Omie, sem anexos nem edição */
  pendente?: boolean;
};

export type OcResumo = { label: string; num_pedido_cliente: string | null; oc_origem: string | null; anexos: number; anexos_oc: number };

/** "PV1968" → { tipo: "PV", numero: "1968" }; null se não for PV/OS. */
export function partirLabel(label: string): { tipo: "PV" | "OS"; numero: string } | null {
  const m = /^(PV|OS)\s*(\d+)$/i.exec(String(label ?? "").trim());
  return m ? { tipo: m[1].toUpperCase() as "PV" | "OS", numero: m[2] } : null;
}

export const BUCKET_VENDAS_ANEXOS = "vendas-anexos";
export const LIMITE_ANEXO = 25 * 1024 * 1024;
