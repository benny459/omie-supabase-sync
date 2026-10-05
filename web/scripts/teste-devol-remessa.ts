/**
 * Teste das NF-e não-venda (05/10/26) — SÓ HOMOLOGAÇÃO (forcar_homologacao),
 * destinatário = a própria SF (a SEFAZ de homologação só aceita o CNPJ do
 * emitente). Emite uma devolução de compra e uma simples remessa, confere que
 * autorizaram, que NÃO criaram contas a receber e que a numeração de produção
 * não mudou; cancela as duas em seguida. MODO=devolucao|remessa|ambos.
 */
import { supaAdmin } from "../lib/supabase-admin";
import { atualizar, buscar, cancelar, configDe, emitir } from "../lib/faturamento/server";
import type { DocFat } from "../lib/faturamento/montar";

const SF = {
  nome: "TESTE E2E DESTINATARIO", cnpj: "15766003000108", ie: "206878808115", email: "contasareceber@waterworks.com.br",
  logradouro: "Avenida Tucunare", numero: "550", bairro: "Tambore", municipio: "Barueri", codigo_municipio: "3505708", uf: "SP", cep: "06460020",
};

const DEVOL: DocFat = {
  empresa: "SF", cliente: SF,
  itens: [{ codigo: "TESTE-DEV-01", descricao: "TESTE E2E - CANALETA PVC (DEVOLUCAO)", quantidade: 2, quantidade_max: 9, valor_unitario: 69.82, unidade: "UN",
    ncm: "39259090", origem: 0, icms_aliquota: 18, pis_cst: "01", pis_aliquota: 1.65, cofins_cst: "01", cofins_aliquota: 7.6, info_item: "-105074B2-" }],
  condicao: { parcelas: [] },
  operacao: {
    tipo: "devolucao", motivo: "TESTE E2E - Mercadoria em desacordo com o pedido",
    nf_ref: { chave: "35260857158057000130550020007577931991371462", numero: "757793", serie: "2", emitente_doc: "57158057000130", emissao: "2026-08-20" },
  },
  observacoes: "TESTE E2E 05/10 — homologação, sem valor fiscal",
};

const REMESSA: DocFat = {
  empresa: "SF", cliente: SF,
  itens: [{ codigo: "TESTE-REM-01", descricao: "TESTE E2E - CURVA LONGA 90 PPR (REMESSA)", quantidade: 3, valor_unitario: 10, unidade: "UN", ncm: "39174090", origem: 0 }],
  condicao: { parcelas: [], projeto: "12580422099" },
  operacao: {
    tipo: "remessa", motivo: "TESTE E2E - Remessa de material para instalação/obra do projeto",
    projeto_codigo: "12580422099", projeto_nome: "PJ364_Diaverum Bosque Maia", cliente_projeto: "DIAVERUM BOSQUE MAIA",
  },
  transporte: { modalidade: 9 },
  observacoes: "TESTE E2E 05/10 — homologação, sem valor fiscal",
};

async function um(nome: string, doc: DocFat) {
  console.log(`\n=== ${nome} ===`);
  const antes = await configDe("SF");
  let e = await emitir(doc, { tipo: "nfe", origem_tipo: "teste", criado_por: "teste-e2e@painel", forcar_homologacao: true });
  if (e.ambiente !== "homologacao") throw new Error("ABORTADO: não ficou em homologação");
  for (let i = 0; i < 20 && e.status === "processando"; i++) {
    await new Promise((ok) => setTimeout(ok, 4000));
    e = await atualizar(e.id);
  }
  const p = e.payload as Record<string, unknown> | null;
  const it0 = ((p?.items ?? []) as Record<string, unknown>[])[0] ?? {};
  console.log(JSON.stringify({
    id: e.id, ambiente: e.ambiente, status: e.status, focus_status: e.focus_status, mensagem: e.mensagem, erros: e.erros,
    numero: e.numero, serie: e.serie, chave: e.chave, gerar_receber: e.gerar_receber, receber_ids: e.receber_ids, operacao: e.operacao,
    natureza: p?.natureza_operacao, finalidade: p?.finalidade_emissao, refs: p?.notas_referenciadas, pagamento: p?.formas_pagamento,
    tem_duplicatas: !!p?.duplicatas, cfop: it0.cfop, csosn: it0.icms_situacao_tributaria, icms: [it0.icms_base_calculo, it0.icms_aliquota, it0.icms_valor],
    pis: [it0.pis_situacao_tributaria, it0.pis_aliquota_porcentual], infCpl: p?.informacoes_adicionais_contribuinte,
  }, null, 2));
  const depois = await configDe("SF");
  console.log(`numeração de produção: antes ${antes.nfe_proximo_producao} · depois ${depois.nfe_proximo_producao} · homologação ${antes.nfe_proximo_homologacao} → ${depois.nfe_proximo_homologacao}`);
  if (depois.nfe_proximo_producao !== antes.nfe_proximo_producao) throw new Error("ERRO: a numeração de produção mudou");
  if (e.status !== "autorizada") { console.log("payload:", JSON.stringify(p)); return false; }
  const { data: rec } = await supaAdmin().schema("finance").from("receber").select("id").contains("extras", { fat_emissao_id: e.id });
  console.log(`contas a receber criadas: ${(rec ?? []).length} (esperado 0)`);
  const c = await cancelar(e.id, "Teste E2E de homologacao cancelado pelo painel");
  console.log(`cancelamento: ${c.status} — ${c.mensagem}`);
  console.log("status final:", (await buscar(e.id)).status);
  return true;
}

async function main() {
  const modo = (process.env.MODO || "ambos").toLowerCase();
  let ok = true;
  if (modo === "devolucao" || modo === "ambos") ok = (await um("DEVOLUÇÃO DE COMPRA", DEVOL)) && ok;
  if (modo === "remessa" || modo === "ambos") ok = (await um("SIMPLES REMESSA", REMESSA)) && ok;
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
