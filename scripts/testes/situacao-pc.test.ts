// cd web && npx tsx --test ../scripts/testes/situacao-pc.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { estadoPc, dicaEstadoPc } from "../../web/lib/situacao-pc";

test("PC sem aprovação não é 'Pedido de Compra': é Aguardando aprovação", () => {
  assert.equal(estadoPc({ etapa: "10", aprov: "nao_solicitada" }).chave, "aguardando");
  assert.equal(estadoPc({ etapa: "15", aprov: "aguardando" }).chave, "aguardando");
});
test("aprovado, enviado, faturado, recebido (parcial) e conferido", () => {
  assert.equal(estadoPc({ etapa: "15", aprov: "aprovado" }).chave, "aprovado");
  assert.equal(estadoPc({ etapa: "10", aprov: "aprovado", enviado_em: "2026-10-01" }).chave, "enviado");
  assert.equal(estadoPc({ etapa: "40", aprov: "aprovado", nf: "123" }).chave, "faturado");
  const r = estadoPc({ etapa: "10", aprov: "aprovado", qtd: 10, qtd_recebida: 4 });
  assert.equal(r.chave, "recebido"); assert.equal(r.rot, "Recebido parcial");
  assert.equal(estadoPc({ etapa: "80", aprov: "aprovado", nf: "1" }).chave, "conferido");
});
test("reprovado e cancelado vencem a etapa", () => {
  assert.equal(estadoPc({ etapa: "80", aprov: "nao_aprovado" }).chave, "reprovado");
  assert.equal(estadoPc({ etapa: "40", cancelado: true }).chave, "cancelado");
});
test("cores distintas entre estados vizinhos", () => {
  const c = (x: Parameters<typeof estadoPc>[0]) => estadoPc(x).cor;
  assert.notEqual(c({ etapa: "10" }), c({ etapa: "10", aprov: "aprovado" }));
  assert.notEqual(c({ etapa: "60" }), c({ etapa: "80" }));
});
test("dica traz data, NF e quem aprovou", () => {
  const t = dicaEstadoPc({ etapa: "80", aprov: "aprovado", nf: "000019571", dt_rec: "2026-09-24", aprov_por: "marcelo@waterworks.com.br", aprov_em: "2026-09-21" });
  assert.match(t, /recebido em 24\/09\/26/); assert.match(t, /NF 000019571/); assert.match(t, /por marcelo em 21\/09\/26/);
});
