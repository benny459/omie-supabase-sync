// cd web && npx tsx --test ../scripts/testes/aprovacao-permissao.test.ts
// "Só pode reprovar quem aprova" (08/10/26): aprovar e reprovar passam pela MESMA regra.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  motivoSemPermissao, statusExigeAprovador, aprovPainelExigeAprovador, acaoDoStatus, type EntradaPermissao,
} from "../../web/lib/aprovacao-permissao";
import { canApprove, type UserPerms } from "../../web/lib/permissions";

const base: EntradaPermissao = { ehAdmin: false, temPermissao: true, valor: 1000, teto: null };
const ambas = (e: EntradaPermissao) => [motivoSemPermissao(e, "aprovar"), motivoSemPermissao(e, "reprovar")];

test("sem compras.aprovar / can_approve: não aprova NEM reprova", () => {
  const [a, r] = ambas({ ...base, temPermissao: false });
  assert.ok(a); assert.ok(r);
  assert.match(r!, /só quem aprova pode reprovar/);
});
test("aprovador dentro da alçada: aprova e reprova", () => {
  assert.deepEqual(ambas({ ...base, teto: 5000 }), [null, null]);
});
test("acima da alçada: não aprova nem reprova (mesma regra)", () => {
  const [a, r] = ambas({ ...base, valor: 9000, teto: 5000 });
  assert.match(a!, /alçada/); assert.match(r!, /alçada/);
});
test("admin decide tudo, inclusive projeto estourado e acima da alçada", () => {
  assert.deepEqual(ambas({ ehAdmin: true, temPermissao: false, valor: 1e9, teto: 1, projeto: { estouro: 500, motivo: "estoura" } }), [null, null]);
});
test("PC de projeto que estoura o budget: só admin — também para reprovar", () => {
  const [a, r] = ambas({ ...base, projeto: { estouro: 1710.77, motivo: "estoura o budget do projeto em R$ 1.710,77" } });
  assert.match(a!, /administradores/); assert.match(r!, /administradores/);
});
test("PC de projeto dentro do budget: alçada da área não se aplica", () => {
  assert.deepEqual(ambas({ ...base, valor: 9000, teto: 5000, projeto: { estouro: 0, motivo: "dentro" } }), [null, null]);
});
test("PC de projeto sem como conferir o budget: não decide (não-admin)", () => {
  const [a, r] = ambas({ ...base, projeto: "indisponivel" });
  assert.ok(a); assert.ok(r);
});

test("Operação: qualquer status exige quem aprova, menos pôr Pendente sem decisão", () => {
  for (const st of ["APROVADO", "APROVADO_FAT_DIRETO", "NAO_APROVADO", "REJEITADO_VALIDADE", "N_A", "PRE_SELECAO", "CANCELAR_PEDIDO"]) {
    assert.equal(statusExigeAprovador("PENDENTE", st), true, st);
    assert.equal(statusExigeAprovador(null, st), true, st);
  }
  assert.equal(statusExigeAprovador(null, "PENDENTE"), false);
  assert.equal(statusExigeAprovador("PENDENTE", "PENDENTE"), false);
  // devolver um aprovado / reabrir um recusado para Pendente é decisão
  assert.equal(statusExigeAprovador("APROVADO", "PENDENTE"), true);
  assert.equal(statusExigeAprovador("NAO_APROVADO", "PENDENTE"), true);
});
test("Compras (PC do painel): devolver aprovado → aguardando é decisão; pedir aprovação não", () => {
  assert.equal(aprovPainelExigeAprovador("aprovado", "aguardando"), true);
  assert.equal(aprovPainelExigeAprovador("nao_solicitada", "aguardando"), false);
  assert.equal(aprovPainelExigeAprovador("nao_aprovado", "aguardando"), false);
  assert.equal(aprovPainelExigeAprovador("aguardando", "nao_aprovado"), true);
  assert.equal(aprovPainelExigeAprovador("aguardando", "aprovado"), true);
});
test("ação: aprovado* = aprovar; o resto = reprovar", () => {
  assert.equal(acaoDoStatus("APROVADO"), "aprovar");
  assert.equal(acaoDoStatus("aprovado"), "aprovar");
  assert.equal(acaoDoStatus("NAO_APROVADO"), "reprovar");
  assert.equal(acaoDoStatus("aguardando"), "reprovar");
});

// Dry-run da cadeia do set-status para um comprador (sem can_approve): o que o servidor faz
// com perms reais de papel, sem tocar no banco.
test("comprador sem can_approve não reprova pela Operação (dry-run do set-status)", () => {
  const comprador: UserPerms = { role: "comprador", is_admin: false, module_roles: [] };
  const viaRole = canApprove(comprador, "projetos");
  assert.equal(viaRole, false);
  const comPapelSemAprovar: UserPerms = { role: "aprovador", is_admin: false, module_roles: [
    { modulo: "projetos", can_edit_pv: true, can_edit_rc: true, can_edit_pc: true, can_approve: false, can_edit_log: true,
      can_view_values: true, can_view_margin: true, approval_ceiling_brl: null, weekly_budget_brl: null } ] };
  assert.equal(canApprove(comPapelSemAprovar, "projetos"), false);
  for (const st of ["NAO_APROVADO", "REJEITADO_VALIDADE", "N_A", "PRE_SELECAO"]) {
    assert.ok(statusExigeAprovador("PENDENTE", st));
    assert.ok(motivoSemPermissao({ ehAdmin: false, temPermissao: canApprove(comprador, "projetos"), valor: 100, teto: null }, acaoDoStatus(st)));
  }
  const aprovador: UserPerms = { role: "aprovador", is_admin: false, module_roles: [] };
  assert.equal(motivoSemPermissao({ ehAdmin: false, temPermissao: canApprove(aprovador, "projetos"), valor: 100, teto: null }, "reprovar"), null);
});

// 09/10/26: aprovar PC do Compras pela Operação › Projetos sem a área ERP (Marcelo).
import { caminhoAprovacaoCompras, motivoForaDoCaminho, SO_PC_DE_PROJETO } from "../../web/lib/aprovacao-permissao";

test("caminho: admin e quem tem ERP + Compras → compras", () => {
  assert.equal(caminhoAprovacaoCompras({ ehAdmin: true, areaErp: false, comprasAcesso: false, aprovaProjetos: false }), "compras");
  assert.equal(caminhoAprovacaoCompras({ ehAdmin: false, areaErp: true, comprasAcesso: true, aprovaProjetos: true }), "compras");
});
test("caminho: sem ERP mas aprova em Projetos → projetos; sem nada → null", () => {
  assert.equal(caminhoAprovacaoCompras({ ehAdmin: false, areaErp: false, comprasAcesso: false, aprovaProjetos: true }), "projetos");
  assert.equal(caminhoAprovacaoCompras({ ehAdmin: false, areaErp: true, comprasAcesso: false, aprovaProjetos: true }), "projetos");
  assert.equal(caminhoAprovacaoCompras({ ehAdmin: false, areaErp: false, comprasAcesso: true, aprovaProjetos: false }), null);
  assert.equal(caminhoAprovacaoCompras({ ehAdmin: false, areaErp: true, comprasAcesso: false, aprovaProjetos: false }), null);
});
test("caminho projetos: só PC de projeto de obra; o resto fica para Compras", () => {
  assert.equal(motivoForaDoCaminho("projetos", false), SO_PC_DE_PROJETO);
  assert.equal(motivoForaDoCaminho("projetos", true), null);
  assert.equal(motivoForaDoCaminho("compras", false), null);
});
test("caminho projetos + PC de obra: a regra do budget continua mandando", () => {
  const e: EntradaPermissao = { ehAdmin: false, temPermissao: true, valor: 5000, teto: null };
  assert.equal(motivoSemPermissao({ ...e, projeto: { estouro: 0, motivo: "dentro" } }, "aprovar"), null);
  assert.match(motivoSemPermissao({ ...e, projeto: { estouro: 10, motivo: "estoura o budget do projeto em R$ 10,00" } }, "reprovar")!, /administradores/);
  assert.match(motivoSemPermissao({ ...e, projeto: "indisponivel" }, "aprovar")!, /budget/);
});
