// cd web && npx tsx --test ../scripts/testes/planejamento-compras.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { planejarItem, normFornecedor, type PrazoFornecedor } from "../../web/lib/planejamento-compras";
import { dataParaIso, lerColagem } from "../../web/lib/colar-grade";

const hoje = "2026-10-08";
const ACQUA = "ACQUA IMPORT";
const prazos = (manual: number | null) => new Map<string, PrazoFornecedor>([[normFornecedor(ACQUA), { norm: normFornecedor(ACQUA), nome: ACQUA, historico: 21, manual }]]);

test("aceite E1: ACQUA (21d histórico), necessário 30/10 → comprar até 06/10, atrasado em 08/10", () => {
  const p = planejarItem({ necessario: "2026-10-30", temPc: false, fornecedor: ACQUA, prazos: prazos(null), hoje });
  assert.equal(p.comprarAte, "2026-10-06");
  assert.equal(p.status, "atrasado");
  assert.equal(p.texto, "atrasado 2d");
  assert.equal(p.fonte, "historico");
});
test("aceite E2: prazo manual de 10d manda — comprar até 17/10, mesmo com prazo do item", () => {
  const p = planejarItem({ necessario: "2026-10-30", temPc: false, fornecedor: "Acqua  Import", prazoItem: 31, prazos: prazos(10), hoje });
  assert.equal(p.comprarAte, "2026-10-17");
  assert.equal(p.fonte, "manual");
  assert.equal(p.status, "ok");
});
test("aceite E3: sem fornecedor usa 15d e fica estimado", () => {
  const p = planejarItem({ necessario: "2026-11-30", temPc: false, fornecedor: null, prazos: prazos(null), hoje });
  assert.equal(p.prazo, 15);
  assert.equal(p.estimado, true);
  assert.equal(p.comprarAte, "2026-11-12");
});
test("prazo do item vem antes do histórico; janela de 7 dias = comprar agora", () => {
  const p = planejarItem({ necessario: "2026-10-30", temPc: false, fornecedor: ACQUA, prazoItem: 6, prazos: prazos(null), hoje });
  assert.equal(p.comprarAte, "2026-10-21");
  assert.equal(p.status, "ok");
  const q = planejarItem({ necessario: "2026-10-24", temPc: false, fornecedor: ACQUA, prazoItem: 6, prazos: prazos(null), hoje });
  assert.equal(q.status, "agora");
});
test("com PC e sem data", () => {
  assert.equal(planejarItem({ necessario: "2026-10-30", temPc: true, hoje }).status, "compc");
  assert.equal(planejarItem({ necessario: null, temPc: false, hoje }).status, "semdata");
});
test("colar: datas dd/mm/aaaa viram ISO; inválidas somem", () => {
  assert.equal(dataParaIso("30/10/2026"), "2026-10-30");
  assert.equal(dataParaIso("1/2/26"), "2026-02-01");
  assert.equal(dataParaIso("31/02/2026"), "");
  assert.equal(dataParaIso("2026-10-30"), "2026-10-30");
});
test("colar: sem cabeçalho na ordem Código · Item · Qtd · Un · Necessário em · Valor; com cabeçalho pelo nome", () => {
  const pos = [{ label: "Código", key: "cod" }, { label: "Item", key: "item" }, { label: "Qtd", key: "qtd" }, { label: "Un", key: "un" },
    { label: "Necessário em", key: "nec", tipo: "data" }, { label: "Valor unit.", key: "vu" }];
  const a = lerColagem("E02045\tCREPINA\t2\tun\t30/10/2026\t40\n\tMANOMETRO\t1\tun\t31/10/2026\t57,70", pos, pos);
  assert.equal(a.comCabecalho, false);
  assert.deepEqual(a.linhas[1], { cod: "", item: "MANOMETRO", qtd: "1", un: "un", nec: "2026-10-31", vu: "57,70" });
  const b = lerColagem("Item\tQtd\tNecessário em\nCREPINA\t2\t01/11/2026", pos, pos);
  assert.equal(b.comCabecalho, true);
  assert.deepEqual(b.linhas[0], { item: "CREPINA", qtd: "2", nec: "2026-11-01" });
});
