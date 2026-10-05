/**
 * Validação final do ciclo de vendas avulsas (05/10/26) — SÓ HOMOLOGAÇÃO.
 * Roda pelo workflow ciclo_final_e2e.yml (token Focus nos secrets).
 *   MODO=emitir   DOC_ID=<vendas.documentos.id>  → NF-e em homologação do PV nativo
 *                 de TESTE, com a própria SF como destinatária (a SEFAZ de homologação
 *                 recusa terceiros); gera as parcelas a receber e NÃO cancela.
 *   MODO=cancelar EMISSAO_ID=<orders.fat_emissoes.id> → cancela (homologação).
 * Aborta se o documento não for de TESTE ou se a empresa não estiver em homologação.
 */
import { supaAdmin } from "../lib/supabase-admin";
import { atualizar, cancelar, configDe, emitir, buscar } from "../lib/faturamento/server";
import { empresaFocus } from "../lib/faturamento/focus";
import { docFat } from "../lib/vendas-fat";
import type { VendaDoc } from "../lib/vendas";

async function main() {
  const modo = process.env.MODO;
  if (modo === "cancelar") {
    const id = Number(process.env.EMISSAO_ID);
    const e0 = await buscar(id);
    if (e0.ambiente !== "homologacao") throw new Error("ABORTADO: emissão não é de homologação");
    const e = await cancelar(id, "TESTE E2E validacao final - cancelamento em homologacao");
    console.log(`emissão #${e.id} → ${e.status} ${e.mensagem ?? ""}`);
    if (e.status !== "cancelada") process.exit(1);
    return;
  }
  const id = Number(process.env.DOC_ID);
  const { data, error } = await supaAdmin().schema("orders").rpc("vendas_documento", { p_id: id });
  if (error || !data) throw new Error(error?.message ?? "documento não encontrado");
  const d = data as VendaDoc;
  if (!/TESTE E2E/i.test(d.observacoes ?? "")) throw new Error(`ABORTADO: ${d.label} não é de teste`);
  const cfg = await configDe(d.empresa);
  if (cfg.ambiente !== "homologacao" || (cfg as { producao_liberada?: boolean }).producao_liberada) throw new Error("ABORTADO: empresa não está em homologação");
  const doc = docFat(d);
  const em = await empresaFocus(cfg.cnpj!);
  doc.cliente = {
    ...doc.cliente, cnpj: cfg.cnpj!, cpf: null, ie: em.inscricao_estadual ?? null, indicador_ie: em.inscricao_estadual ? "1" : "9",
    email: "contasareceber@waterworks.com.br", logradouro: em.logradouro || doc.cliente.logradouro, numero: em.numero || "S/N",
    complemento: null, bairro: em.bairro || doc.cliente.bairro, municipio: em.municipio || doc.cliente.municipio,
    codigo_municipio: em.codigo_municipio || null, uf: em.uf || "SP", cep: em.cep || doc.cliente.cep,
  } as typeof doc.cliente;
  doc.itens = doc.itens.map((i) => ({ ...i, cfop: null }));
  let e = await emitir(doc, { origem_tipo: d.tipo === "OS" ? "os" : "pv", origem_id: String(id), gerar_receber_homologacao: true, criado_por: "teste-e2e-final@painel" });
  for (let i = 0; i < 25 && e.status === "processando"; i++) { await new Promise((r) => setTimeout(r, 4000)); e = await atualizar(e.id); }
  console.log(`EMISSAO_ID=${e.id} status=${e.status} numero=${e.numero ?? "—"} receber=${JSON.stringify(e.receber_ids ?? [])} ${e.mensagem ?? ""}`);
  if (e.status !== "autorizada") process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
