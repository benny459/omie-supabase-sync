// cd web && npx tsx --test ../scripts/testes/grupos-equipamento.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normGrupo, dataDoGrupo, aplicarDataGrupo, nomePadrao } from "../../web/lib/grupos-equipamento-puro";

test("normGrupo ignora acento e caixa", () => {
  assert.equal(normGrupo("Filtro  Carvão"), normGrupo("filtro carvao"));
});
test("data do grupo = a mais comum; empate fica com a mais cedo; vazio não vota", () => {
  assert.equal(dataDoGrupo(["2026-12-04", "2026-12-04", "2026-11-01", null, ""]), "2026-12-04");
  assert.equal(dataDoGrupo(["2026-12-04", "2026-11-01"]), "2026-11-01");
  assert.equal(dataDoGrupo([null, ""]), null);
});
test("mudar a data do grupo preserva a data própria", () => {
  assert.deepEqual(aplicarDataGrupo(["", "2026-12-04", "2026-10-20"], "2026-12-04", "2026-11-15"),
    ["2026-11-15", "2026-11-15", "2026-10-20"]);
});
test("nome padrão: igual sem acento, ou quase igual (erro de digitação)", () => {
  const cad = ["Filtro Multimeios", "Filtro de Carvão", "Osmose Reversa", "Geral"];
  assert.equal(nomePadrao("filtro multimeios", cad), "Filtro Multimeios");
  assert.equal(nomePadrao("Filtro Muiltimeios", cad), "Filtro Multimeios");
  assert.equal(nomePadrao("Filtro Carvão", cad), "Filtro de Carvão");
  assert.equal(nomePadrao("Looping", cad), null);
});
