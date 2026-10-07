// cd web && npx tsx --test ../scripts/testes/aprovacao-projeto.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { regraProjeto } from "../../web/lib/aprovacao-projeto-regra";

test("fluxo aprovado e dentro do budget: aprova", () => {
  const d = regraProjeto({ fluxoStatus: "aprovado", budget: 80000, comprometidoOutros: 60000, valorPc: 15000 });
  assert.equal(d.aprova, true); assert.equal(d.total, 75000);
});
test("estoura o budget: pendente com o valor do estouro", () => {
  const d = regraProjeto({ fluxoStatus: "aprovado", budget: 60879.25, comprometidoOutros: 61590.02, valorPc: 1000 });
  assert.equal(d.aprova, false); assert.equal(d.estouro, 1710.77); assert.match(d.motivo, /estoura o budget do projeto em R\$\s?1\.710,77/);
});
test("fluxo não aprovado não libera, mesmo dentro do budget", () => {
  assert.equal(regraProjeto({ fluxoStatus: "pendente", budget: 100000, comprometidoOutros: 0, valorPc: 10 }).aprova, false);
  assert.match(regraProjeto({ fluxoStatus: null, budget: 100000, comprometidoOutros: 0, valorPc: 10 }).motivo, /não foi lançado/);
});
test("sem budget não aprova sozinho", () => {
  assert.equal(regraProjeto({ fluxoStatus: "aprovado", budget: null, comprometidoOutros: 0, valorPc: 10 }).aprova, false);
});
test("bater exatamente o budget aprova", () => {
  assert.equal(regraProjeto({ fluxoStatus: "aprovado", budget: 1000, comprometidoOutros: 600, valorPc: 400 }).aprova, true);
});
test("estouro aparece mesmo sem fluxo aprovado (vai para os administradores)", () => {
  const d = regraProjeto({ fluxoStatus: null, budget: 1000, comprometidoOutros: 900, valorPc: 300 });
  assert.equal(d.aprova, false); assert.equal(d.estouro, 200);
});
test("ehProjetoDeObra: só PJ…", async () => {
  const { ehProjetoDeObra } = await import("../../web/lib/aprovacao-projeto-regra");
  assert.equal(ehProjetoDeObra("PJ361_Diaverum Sorocaba"), true);
  assert.equal(ehProjetoDeObra("41_VP"), false);
  assert.equal(ehProjetoDeObra("47_CONTRATUAL"), false);
});
