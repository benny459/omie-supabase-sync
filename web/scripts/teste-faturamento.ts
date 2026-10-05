/**
 * Teste E2E do faturamento (P5) — SÓ HOMOLOGAÇÃO, dados "TESTE E2E".
 * Roda pelo workflow faturamento_teste.yml (os tokens ficam nos secrets).
 *   MODO=nfe|recibo|nfse|todos
 * Para cada documento: emite → espera autorizar → confere XML/PDF no Storage
 * e as parcelas em finance.receber → cancela (homologação) — o que apaga as
 * parcelas. Os documentos ficam no sandbox da Focus. Não imprime tokens.
 */
import { supaAdmin } from "../lib/supabase-admin";
import { atualizar, buscar, cancelar, configDe, emitir, type TipoDoc } from "../lib/faturamento/server";
import type { DocFat } from "../lib/faturamento/montar";

const DOC: DocFat = {
  empresa: "SF",
  cliente: {
    nome: "TESTE E2E CLIENTE LTDA", cnpj: "07504505000132", ie: "",
    logradouro: "Rua Teste", numero: "100", bairro: "Centro", municipio: "Barueri", codigo_municipio: "3505708", uf: "SP", cep: "06401000",
  },
  itens: [{ codigo: "TESTE-E2E-01", descricao: "TESTE E2E - ELEMENTO FILTRANTE", quantidade: 2, valor_unitario: 150, unidade: "UN", ncm: "84212100" }],
  condicao: { parcelas: [{ dias: 30 }, { dias: 60 }] },
  observacoes: "TESTE E2E 05/10 — homologação, sem valor fiscal",
};

async function um(tipo: TipoDoc) {
  console.log(`\n=== ${tipo.toUpperCase()} ===`);
  const cfg = await configDe("SF");
  if (cfg.ambiente !== "homologacao") throw new Error("ABORTADO: SF não está em homologação");
  let e = await emitir(
    tipo === "nfe" ? DOC : { ...DOC, itens: [{ ...DOC.itens[0], descricao: "TESTE E2E - VISITA TECNICA DE MANUTENCAO", quantidade: 1, valor_unitario: 300 }] },
    { tipo, origem_tipo: "teste", origem_id: `TESTE-E2E-${tipo}-${Date.now()}`, gerar_receber_homologacao: true, criado_por: "teste-e2e@painel" },
  );
  for (let i = 0; i < 20 && e.status === "processando"; i++) {
    await new Promise((ok) => setTimeout(ok, 4000));
    e = await atualizar(e.id);
  }
  if (e.status === "autorizada" && (!e.xml_path || !e.pdf_path) && tipo !== "recibo") {
    await new Promise((ok) => setTimeout(ok, 5000));
    e = await atualizar(e.id);
  }
  console.log(JSON.stringify({
    id: e.id, ambiente: e.ambiente, status: e.status, focus_status: e.focus_status, mensagem: e.mensagem, erros: e.erros,
    numero: e.numero, serie: e.serie, chave: e.chave, valor: e.valor_total, xml: e.xml_path, pdf: e.pdf_path, receber_ids: e.receber_ids,
  }, null, 2));
  if (e.status !== "autorizada") { console.log("payload enviado:", JSON.stringify(e.payload)); return false; }

  const { data: rec } = await supaAdmin().schema("finance").from("receber")
    .select("id,numero_documento,numero_parcela,vencimento,valor,origem,chave_nfe").in("id", e.receber_ids ?? []);
  console.log("receber criado:", JSON.stringify(rec));
  const { data: v } = await supaAdmin().schema("finance").from("v_receber").select("*").in("id", e.receber_ids ?? []).limit(5);
  console.log("aparece em v_receber:", (v ?? []).length);
  for (const p of [e.xml_path, e.pdf_path]) {
    if (!p) continue;
    const { data } = await supaAdmin().storage.from("fat-documentos").download(p);
    console.log(`storage ${p}: ${data ? `${data.size} bytes` : "AUSENTE"}`);
  }

  const c = await cancelar(e.id, "Teste E2E de homologacao cancelado pelo painel");
  const { data: resto } = await supaAdmin().schema("finance").from("receber").select("id").in("id", e.receber_ids ?? []);
  console.log(`cancelamento: ${c.status} — ${c.mensagem}; parcelas restantes: ${(resto ?? []).length}`);
  const final = await buscar(e.id);
  console.log("status final:", final.status);
  return true;
}

async function main() {
  const modo = (process.env.MODO || "nfe").toLowerCase();
  const tipos: TipoDoc[] = modo === "todos" ? ["recibo", "nfe", "nfse"] : [modo as TipoDoc];
  let ok = true;
  for (const t of tipos) {
    try { ok = (await um(t)) && ok; } catch (e) { ok = false; console.log(`ERRO ${t}:`, e instanceof Error ? e.message : e); }
  }
  process.exit(ok ? 0 : 1);
}
main();
