// Leitura do CRM de propostas (propostas-ww) pelo painel.
//
// O fechamento de uma proposta Ganha pode ser LINKADO a um projeto do painel
// (campo "Projeto no painel" no resumo do fechamento do CRM). Feito o link, o
// painel mostra o resumo aqui e oferece o CP/MC Excel — que o CRM sobe para o
// Storage num caminho fixo a cada save do fechamento e a cada geração.
//
// A chave abaixo é a ANON do Supabase do CRM: pública por natureza (já viaja
// no bundle do próprio CRM) e read-only via RLS. Nada aqui escreve no CRM.

const CRM_URL = "https://epoazrnafevkirxhkmog.supabase.co";
const CRM_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVwb2F6cm5hZmV2a2lyeGhrbW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNjk5OTEsImV4cCI6MjA4Nzk0NTk5MX0.duK7ykVjoP1eCiFn1ono1Ka-VGdQUbdUbgCmdnL7wKY";
const CRM_EMPRESA = "b1bf590f-c281-41f8-9968-a70b0dc02b31";

export type ParcelaCrm = {
  pct: number;
  evento: string;
  tipo?: "mercantil" | "servico";
  faturamento?: string;   // ISO — quando faturamos
  previsao?: string;      // ISO — quando o cliente paga (faturamento + prazo)
};

export type RecebimentoCrm = {
  valorTotal?: number;
  confirmadoPor?: string;
  confirmadoEm?: string;
  confirmacoes?: { frete?: boolean; deslocamento?: boolean; instalacao?: boolean; impostos?: boolean };
  inicioProjeto?: string;
  entregaPrazoDias?: number;
  entregaPrevista?: string;
  pagamentoDias?: number;
  saidaDias?: { maoObra?: number; despesas?: number };
  parcelas?: ParcelaCrm[];
  projetoPainel?: { codigo: number; nome: string };
};

export type FechamentoCrm = {
  numero: string;
  status?: string;
  valor?: number;
  cliente?: string;
  recebimento: RecebimentoCrm;
  cpmcUrl: string;      // caminho fixo do snapshot — pode ainda não existir
  gerarUrl: string;     // endpoint do CRM que gera o Excel na hora (e publica o snapshot)
  crmUrl: string;       // deep-link pra abrir a proposta no CRM
};

/** Propostas do CRM cujo fechamento está linkado a este projeto do painel. */
export async function fetchFechamentosDoProjeto(codigoProjeto: number | string): Promise<FechamentoCrm[]> {
  const filtro = `dados_json->recebimento->projetoPainel->>codigo=eq.${encodeURIComponent(String(codigoProjeto))}`;
  const url = `${CRM_URL}/rest/v1/propostas?select=numero,status,valor,dados_json&empresa_id=eq.${CRM_EMPRESA}&${filtro}&limit=5`;
  const r = await fetch(url, {
    headers: { apikey: CRM_ANON, Authorization: `Bearer ${CRM_ANON}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`CRM respondeu ${r.status}`);
  const rows = (await r.json()) as Array<{ numero: string; status?: string; valor?: number; dados_json?: Record<string, unknown> }>;
  return rows
    .filter((p) => (p.dados_json as { recebimento?: RecebimentoCrm } | undefined)?.recebimento)
    .map((p) => {
      const dj = p.dados_json as { recebimento: RecebimentoCrm; cl?: { emp?: string } };
      return {
        numero: p.numero,
        status: p.status,
        valor: p.valor,
        cliente: dj.cl?.emp || "",
        recebimento: dj.recebimento,
        cpmcUrl: `${CRM_URL}/storage/v1/object/public/propostas-pdfs/${CRM_EMPRESA}/${encodeURIComponent(p.numero)}/cpmc.xlsx`,
        gerarUrl: `https://propostas-ww.vercel.app/api/cpmc-gerar?num=${encodeURIComponent(p.numero)}`,
        crmUrl: `https://propostas-ww.vercel.app/?num=${encodeURIComponent(p.numero)}`,
      };
    });
}

/** O snapshot do CP/MC já existe no Storage? (o CRM sobe ao salvar o fechamento) */
export async function cpmcExiste(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    return r.ok;
  } catch {
    return false;
  }
}
