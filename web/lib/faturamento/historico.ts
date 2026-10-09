// Últimos faturamentos do cliente (09/10/26): regras únicas para a folha
// (NovaEmissao › "Usar como modelo" e herança de forma/conta), para a API
// (?op=historico) e para o lote/carteira (completarRecebimento).
// O SQL (orders.fat_historico_cliente, sql/155) já filtra pelo CNPJ/CPF completo;
// aqui fica a segunda trava: entrada de outro documento não passa, e a forma
// herdada tem de ser uma forma de recebimento de verdade (não "NFE"/"REC").

/** Formas da folha (nova/route FORMAS). */
export const FORMAS_VALIDAS = ["BOL", "PIX", "TRA", "TED", "DEP", "CRC", "CRD", "DIN", "CHQ", "DUP"];

export const soDigitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

export type HistBase = {
  cliente_doc?: string | null;
  forma?: string | null;
  conta_codigo?: number | string | null;
  parcelas?: { forma?: string | null }[] | null;
  condicao?: { forma_recebimento?: string | null; conta_corrente?: number | string | null } | null;
};

/** Só entradas do MESMO CNPJ/CPF (dígitos completos). Nunca por raiz, nome ou
 *  código; entrada sem cliente_doc é descartada (fail-closed). */
export function historicoDoCliente<T extends HistBase>(hs: T[] | null | undefined, doc: string): T[] {
  const d = soDigitos(doc);
  if (d.length < 11) return [];
  return (hs ?? []).filter((h) => soDigitos(h?.cliente_doc) === d);
}

const formaOk = (f: unknown) => {
  const v = String(f ?? "").trim().toUpperCase();
  return FORMAS_VALIDAS.includes(v) ? v : null;
};

/** Forma e conta a herdar do histórico: a primeira forma VÁLIDA e a primeira
 *  conta informada, olhando do mais recente para o mais antigo. */
export function herancaRecebimento(hs: HistBase[], limite = hs.length): { forma: string | null; conta: number | null; de: number | null } {
  let forma: string | null = null; let conta: number | null = null; let de: number | null = null;
  hs.slice(0, limite).forEach((h, i) => {
    if (!forma) {
      const f = [h.condicao?.forma_recebimento, h.forma, ...(h.parcelas ?? []).map((p) => p?.forma)].map(formaOk).find(Boolean) ?? null;
      if (f) { forma = f; if (de == null) de = i; }
    }
    if (conta == null) {
      const c = h.condicao?.conta_corrente ?? h.conta_codigo ?? null;
      if (c != null && c !== "" && Number.isFinite(Number(c))) { conta = Number(c); if (de == null) de = i; }
    }
  });
  return { forma, conta, de };
}
