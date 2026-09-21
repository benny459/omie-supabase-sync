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

/** Diretriz de custos da proposta (CP/MC), resumida para a primeira tela. */
export type CustosCrm = {
  material: number;      // total da CP (materiais/equipamentos)
  maoDeObra: number;     // total de mão de obra considerado
  despesas: number;      // total de despesas (frete, estadia, passagens...)
  frete: number;         // só o frete estimado (por viagem, dentro de despesas)
  freteViagens: number;
  tecnicos: number;
  diarias: number;       // dias de trabalho somados (como na planilha)
  sabados: number;
  domingos: number;
};

export type FechamentoCrm = {
  numero: string;
  status?: string;
  valor?: number;
  cliente?: string;
  custos: CustosCrm;
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
      const dj = p.dados_json as {
        recebimento: RecebimentoCrm;
        cl?: { emp?: string };
        formacaoCusto?: Record<string, unknown>;
      };
      /* Mesmas contas do bloco CUSTOS CONSIDERADOS da planilha: as diárias
         somam os dias de trabalho por nível (comercial+noturno+sáb+dom); o
         frete é por viagem e vive dentro do total de despesas. */
      const fc = (dj.formacaoCusto || {}) as {
        cpTotal?: number; moTotal?: number; despTotal?: number;
        maoDeObra?: Array<{ qtd?: number; comercial?: number; noturno?: number; sabado?: number; domingo?: number }>;
        despesasCp?: { frete?: { unit?: number; diarias?: number } };
      };
      let tecnicos = 0, diarias = 0, sabados = 0, domingos = 0;
      for (const m of fc.maoDeObra || []) {
        const dias = (m.comercial || 0) + (m.noturno || 0) + (m.sabado || 0) + (m.domingo || 0);
        if ((m.qtd || 0) > 0 && dias > 0) {
          tecnicos += m.qtd || 0; diarias += dias;
          sabados += m.sabado || 0; domingos += m.domingo || 0;
        }
      }
      const custos: CustosCrm = {
        material: Number(fc.cpTotal) || 0,
        maoDeObra: Number(fc.moTotal) || 0,
        despesas: Number(fc.despTotal) || 0,
        frete: (Number(fc.despesasCp?.frete?.unit) || 0) * (Number(fc.despesasCp?.frete?.diarias) || 0),
        freteViagens: Number(fc.despesasCp?.frete?.diarias) || 0,
        tecnicos, diarias, sabados, domingos,
      };
      return {
        numero: p.numero,
        status: p.status,
        valor: p.valor,
        cliente: dj.cl?.emp || "",
        custos,
        recebimento: dj.recebimento,
        cpmcUrl: `${CRM_URL}/storage/v1/object/public/propostas-pdfs/${CRM_EMPRESA}/${encodeURIComponent(p.numero)}/cpmc.xlsx`,
        gerarUrl: `https://propostas-ww.vercel.app/api/cpmc-gerar?num=${encodeURIComponent(p.numero)}`,
        crmUrl: `https://propostas-ww.vercel.app/?num=${encodeURIComponent(p.numero)}`,
      };
    });
}

export type BudgetCrm = {
  codigoProjeto: number;
  numero: string;
  budgetCustos: number;        // materiais/equipamentos da CP — o budget de compras
  despesas: number;
  maoDeObra: number;
  valorTotalProjeto: number;
  resultadoEsperado: number;
  resultadoEsperadoPct: number | null;
};

/**
 * Budget de vários projetos de uma vez, direto do fechamento do CRM.
 *
 * O card de /projetos mostrava "definir" em projeto fechado, porque o budget
 * só existia depois de alguém importar o Fluxo Financeiro à mão — sendo que o
 * fechamento do CRM já tem o número certo (a CP da proposta ganha). Aqui ele é
 * lido em UMA chamada para a lista inteira da tela.
 */
export async function fetchBudgetsDoCrm(codigosProjeto: number[]): Promise<Map<number, BudgetCrm>> {
  const codigos = Array.from(new Set(codigosProjeto.filter((c) => Number.isFinite(c) && c > 0)));
  const mapa = new Map<number, BudgetCrm>();
  if (!codigos.length) return mapa;

  const filtro = `dados_json->recebimento->projetoPainel->>codigo=in.(${codigos.join(",")})`;
  const url = `${CRM_URL}/rest/v1/propostas?select=numero,valor,dados_json&empresa_id=eq.${CRM_EMPRESA}&${filtro}&limit=400`;
  const r = await fetch(url, {
    headers: { apikey: CRM_ANON, Authorization: `Bearer ${CRM_ANON}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`CRM respondeu ${r.status}`);

  const rows = (await r.json()) as Array<{ numero: string; valor?: number; dados_json?: Record<string, unknown> }>;
  for (const p of rows) {
    const dj = p.dados_json as {
      recebimento?: RecebimentoCrm;
      formacaoCusto?: { cpTotal?: number; moTotal?: number; despTotal?: number };
    } | undefined;
    const cod = Number(dj?.recebimento?.projetoPainel?.codigo);
    if (!Number.isFinite(cod)) continue;

    const fc = dj?.formacaoCusto ?? {};
    const budgetCustos = Number(fc.cpTotal) || 0;
    const maoDeObra = Number(fc.moTotal) || 0;
    const despesas = Number(fc.despTotal) || 0;
    const valorTotalProjeto = Number(dj?.recebimento?.valorTotal) || Number(p.valor) || 0;
    const resultadoEsperado = valorTotalProjeto - (budgetCustos + maoDeObra + despesas);

    /* Mais de uma proposta no mesmo projeto: fica a de maior valor — é a que
       manda no orçamento. (fetchFechamentosDoProjeto lista todas.) */
    const jaTem = mapa.get(cod);
    if (jaTem && jaTem.valorTotalProjeto >= valorTotalProjeto) continue;

    mapa.set(cod, {
      codigoProjeto: cod,
      numero: p.numero,
      budgetCustos, despesas, maoDeObra, valorTotalProjeto, resultadoEsperado,
      resultadoEsperadoPct: valorTotalProjeto > 0 ? resultadoEsperado / valorTotalProjeto : null,
    });
  }
  return mapa;
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
