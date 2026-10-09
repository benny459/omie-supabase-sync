// Recibos em lote (05/10/26): completa o documento de uma OS com o que a folha
// "Revisar e emitir recibo" preencheria sozinha — forma e conta herdadas do último
// faturamento do cliente, nome da conta e a instrução de pagamento (PIX/banco) —
// para o lote emitir pelo MESMO caminho da emissão avulsa, com o documento pronto.
import { supaAdmin } from "@/lib/supabase-admin";
import type { DocFat } from "@/lib/faturamento/montar";
import { herancaRecebimento, historicoDoCliente, type HistBase } from "@/lib/faturamento/historico";

const BANCOS: Record<string, string> = { "001": "Banco do Brasil", "033": "Santander", "104": "Caixa", "237": "Bradesco", "260": "Nubank", "301": "Conta Simples", "336": "C6 Bank", "341": "Itaú", "450": "Omie.CASH", "077": "Inter", "208": "BTG" };
const FORMAS_BANCO = ["TRA", "TED", "DEP"];

type DadosConta = { banco?: string | null; agencia?: string | null; conta?: string | null; pix_tipo?: string | null; pix_chave?: string | null; beneficiario?: string | null };

/** Mesma regra da folha (NovaEmissao › instrucoes): PIX → chave; PIX ou
 *  transferência/depósito → banco, agência e conta. Linhas separadas por " | ". */
export function instrucaoPagamento(formas: string[], d: DadosConta | null | undefined) {
  if (!d) return "";
  const quem = d.beneficiario ? ` — favorecido ${d.beneficiario}` : "";
  const l: string[] = [];
  if (formas.includes("PIX") && d.pix_chave) l.push(`Pagamento via PIX: chave ${d.pix_tipo ? `${d.pix_tipo.toUpperCase()} ` : ""}${d.pix_chave}${quem}`);
  if (formas.some((f) => f === "PIX" || FORMAS_BANCO.includes(f)) && d.banco && d.agencia && d.conta)
    l.push(`Transferência/depósito: ${BANCOS[d.banco] ?? `Banco ${d.banco}`} (${d.banco}) Ag ${d.agencia} CC ${d.conta}${quem}`);
  return l.join(" | ");
}

export async function dadosConta(empresa: string, codigo: number | string | null | undefined) {
  if (codigo == null || codigo === "") return null;
  const { data } = await supaAdmin().schema("orders").rpc("fat_conta_dados", { p_empresa: empresa, p_codigo: String(codigo) });
  return (data ?? null) as DadosConta | null;
}

export async function completarRecebimento(doc: DocFat): Promise<DocFat> {
  const db = supaAdmin();
  const cond = { ...(doc.condicao ?? {}) } as NonNullable<DocFat["condicao"]>;
  const cpfCnpj = String(doc.cliente.cnpj || doc.cliente.cpf || "").replace(/\D/g, "");
  if ((!cond.forma_recebimento || cond.conta_corrente == null) && cpfCnpj.length >= 11) {
    // Últimos faturamentos do MESMO CNPJ/CPF (lib/faturamento/historico): a primeira
    // forma válida (o Omie às vezes traz o tipo do título, ex. "NFE") e a primeira conta.
    const { data } = await db.schema("orders").rpc("fat_historico_cliente", { p_empresa: doc.empresa, p_doc: cpfCnpj, p_lim: 5 });
    const her = herancaRecebimento(historicoDoCliente((data ?? []) as HistBase[], cpfCnpj));
    if (!cond.forma_recebimento) cond.forma_recebimento = her.forma;
    if (cond.conta_corrente == null) cond.conta_corrente = her.conta;
  }
  if (!cond.forma_recebimento) cond.forma_recebimento = "BOL"; // padrão da folha
  const forma = cond.forma_recebimento;
  cond.parcelas = (cond.parcelas ?? []).map((p) => ({ ...p, forma: p.forma ?? forma }));
  if (cond.conta_corrente != null) {
    if (!cond.conta_nome) {
      const { data: cc } = await db.schema("finance").from("contas_correntes").select("descricao")
        .eq("empresa", doc.empresa).eq("cod_cc", cond.conta_corrente).maybeSingle();
      cond.conta_nome = (cc as { descricao?: string } | null)?.descricao ?? null;
    }
    if (!cond.instrucao_pagamento) {
      const formas = [...new Set(cond.parcelas.map((p) => p.forma ?? forma))];
      cond.instrucao_pagamento = instrucaoPagamento(formas, await dadosConta(doc.empresa, cond.conta_corrente)) || null;
    }
  }
  return { ...doc, condicao: cond };
}
