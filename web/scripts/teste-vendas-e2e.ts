/**
 * Teste E2E do PV/OS nativo (P1) com o faturamento (P5) — SÓ HOMOLOGAÇÃO.
 * Roda pelo workflow vendas_e2e.yml (tokens nos secrets), com DOC_ID = id de um
 * PV/OS nativo de TESTE (observação com "TESTE E2E").
 *   PV nativo → Emitir NF (homologação) → PV faturado + espelho + contas a
 *   receber → cancela a NF → PV volta a aberto e as parcelas somem.
 * Não imprime tokens. Aborta se a empresa não estiver em homologação.
 */
import { supaAdmin } from "../lib/supabase-admin";
import { atualizar, cancelar, configDe, emitir } from "../lib/faturamento/server";
import { docFat } from "../lib/vendas-fat";
import type { VendaDoc } from "../lib/vendas";

async function documento(id: number): Promise<VendaDoc> {
  const { data, error } = await supaAdmin().schema("orders").rpc("vendas_documento", { p_id: id });
  if (error || !data) throw new Error(error?.message ?? `documento ${id} não encontrado`);
  return data as VendaDoc;
}

const falhas: string[] = [];
const ok = (cond: unknown, msg: string) => { console.log(`${cond ? "✓" : "✗"} ${msg}`); if (!cond) falhas.push(msg); };

async function espelho(codigo: number) {
  const { data } = await supaAdmin().schema("sales").from("v_erp_vendas").select("label, faturado, nf, etapa").eq("codigo", String(codigo)).maybeSingle();
  return data as { label: string; faturado: boolean; nf: string | null; etapa: string } | null;
}

async function main() {
  const id = Number(process.env.DOC_ID);
  if (!id) throw new Error("DOC_ID obrigatório");
  let d = await documento(id);
  if (!/TESTE E2E/i.test(d.observacoes ?? "")) throw new Error(`ABORTADO: ${d.label} não é documento de teste`);
  const cfg = await configDe(d.empresa);
  if (cfg.ambiente !== "homologacao") throw new Error(`ABORTADO: ${d.empresa} não está em homologação`);
  ok(d.status === "aberto", `${d.label} aberto antes de faturar (${d.status})`);

  const doc = docFat(d);
  console.log(`cliente ${doc.cliente.nome} · ${doc.itens.length} itens · ${doc.condicao?.parcelas?.length ?? 0} parcelas`);
  let e = await emitir(doc, { origem_tipo: d.tipo === "OS" ? "os" : "pv", origem_id: String(id), gerar_receber_homologacao: true, criado_por: "teste-e2e-p1@painel" });
  for (let i = 0; i < 20 && e.status === "processando"; i++) { await new Promise((r) => setTimeout(r, 4000)); e = await atualizar(e.id); }
  console.log(`emissão #${e.id} ${e.tipo} ${e.status} nº ${e.numero ?? "—"} ${e.mensagem ?? ""}`);
  ok(e.status === "autorizada", "NF autorizada em homologação");

  d = await documento(id);
  ok(d.status === "faturado" && d.nf === e.numero, `${d.label} marcado faturado (status ${d.status}, NF ${d.nf})`);
  const m = await espelho(d.codigo);
  ok(m?.faturado === true, `espelho em sales.v_erp_vendas faturado (${JSON.stringify(m)})`);
  const { data: rec } = await supaAdmin().schema("finance").from("receber").select("id, valor, vencimento, numero_pedido").in("id", e.receber_ids ?? ["-"]);
  ok((rec ?? []).length === d.parcelas.length, `contas a receber: ${(rec ?? []).length} parcela(s) ${JSON.stringify(rec)}`);

  e = await cancelar(e.id, "TESTE E2E P1 — cancelamento em homologação");
  ok(e.status === "cancelada", "NF cancelada em homologação");
  d = await documento(id);
  ok(d.status === "aberto" && !d.nf, `${d.label} voltou a aberto (${d.status})`);
  const { data: rec2 } = await supaAdmin().schema("finance").from("receber").select("id").eq("numero_pedido", String(id)).eq("origem", "painel");
  ok((rec2 ?? []).length === 0, "parcelas a receber removidas");
  const m2 = await espelho(d.codigo);
  ok(m2?.faturado === false, "espelho voltou a não faturado");

  if (falhas.length) { console.error(`\n${falhas.length} falha(s)`); process.exit(1); }
  console.log("\nTudo certo.");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
