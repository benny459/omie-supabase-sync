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

// ── Agente de compras: a amostra do mockup (hoje 08/10/2026) ─────────────────
import { montarLotes, type ItemLote } from "../../web/lib/planejamento-compras";
const hist: Record<string, number> = { "ACQUA IMPORT": 21, SPRINGWAY: 45, ULTRAPURA: 7, INDFILTROS: 60, "NEW WATERS": 25 };
const pz = new Map<string, PrazoFornecedor>(Object.entries(hist).map(([n, h]) => [normFornecedor(n), { norm: normFornecedor(n), nome: n, historico: h, manual: null }]));
const amostra: [string, string | null, string, number, number, boolean][] = [
  ["E02041", "ACQUA IMPORT", "2026-11-10", 1, 254.95, false], ["E02045", "ACQUA IMPORT", "2026-11-10", 1, 40, false],
  ["MANOMETRO", null, "2026-11-10", 1, 57.7, false], ["MISC", null, "2026-11-10", 1, 800, false], ["RESINA", null, "2026-11-10", 40, 201.83, false],
  ["V0310", "ACQUA IMPORT", "2026-11-10", 1, 5000, false], ["E02021", "ACQUA IMPORT", "2026-10-30", 500, 10, false],
  ["E02045b", "ACQUA IMPORT", "2026-10-30", 2, 40, true], ["T0041", "ACQUA IMPORT", "2026-10-30", 1, 3022, false],
  ["BOMBA", null, "2026-12-05", 1, 15360, false], ["M0120", "ULTRAPURA", "2026-12-15", 16, 1680, false],
  ["SKID", "NEW WATERS", "2026-12-15", 1, 28500, false], ["F0210", "INDFILTROS", "2026-12-15", 6, 165, false],
];
const itensMock: ItemLote[] = amostra.map(([id, forn, nec, qtd, vu, temPc]) => ({ id, item: id, qtd, un: "un", vu, fornecedor: forn, necessario: nec, temPc,
  plano: planejarItem({ necessario: nec, temPc, fornecedor: forn, prazos: pz, hoje }) }));
const recMock = [{ doc: "OS4886", valor: 185763.67, data: "2026-10-09" }, { doc: "OS4887", valor: 111458.2, data: "2026-10-27" }];

test("aceite F1: ACQUA pedir hoje (2 itens, R$ 8.022, caixa até 09/10) + 17/10 (3 itens); INDFILTROS 13/10", () => {
  const ls = montarLotes(itensMock, { janela: 10, hoje, recebimentos: recMock });
  const acqua = ls.filter((l) => l.forn === "ACQUA IMPORT");
  assert.equal(acqua.length, 2);
  const a1 = acqua.find((l) => l.base === "2026-10-06")!;
  assert.equal(a1.itens.length, 2); assert.equal(a1.valor, 8022); assert.equal(a1.pedir, hoje); assert.equal(a1.atrasado, true);
  assert.equal(a1.caixaNeg, true); assert.equal(a1.proxEntrada?.data, "2026-10-09"); assert.match(a1.caixaMsg, /OS4886/);
  const a2 = acqua.find((l) => l.base === "2026-10-17")!;
  assert.equal(a2.itens.length, 3); assert.equal(a2.pedir, "2026-10-17");
  const ind = ls.find((l) => l.forn === "INDFILTROS")!;
  assert.equal(ind.pedir, "2026-10-13"); assert.equal(ind.prazo, 60);
});
test("aceite F2: janela 15 junta os dois lotes da ACQUA", () => {
  const acqua = montarLotes(itensMock, { janela: 15, hoje, recebimentos: recMock }).filter((l) => l.forn === "ACQUA IMPORT");
  assert.equal(acqua.length, 1); assert.equal(acqua[0].itens.length, 5);
});
test("aceite F4: item que ganha PC sai do lote no recálculo; lote agendado sem esse item", () => {
  const comPc = itensMock.map((x) => (x.id === "T0041" ? { ...x, temPc: true } : x));
  const a1 = montarLotes(comPc, { janela: 10, hoje }).find((l) => l.forn === "ACQUA IMPORT" && l.base === "2026-10-06")!;
  assert.deepEqual(a1.itens.map((x) => x.id), ["E02021"]);
  const ag = montarLotes(comPc, { janela: 10, hoje, persistidos: [{ id: "L1", fornecedor: "ACQUA IMPORT", data_base: "2026-10-06", data_pedir: "2026-10-09", status: "agendado", motivo: null, itens: ["E02021", "T0041"] }] });
  const l1 = ag.find((l) => l.id === "L1")!;
  assert.deepEqual(l1.itens.map((x) => x.id), ["E02021"]);
  assert.equal(l1.pedir, "2026-10-09");
  // itens do lote agendado não aparecem de novo nos propostos
  assert.ok(!ag.some((l) => !l.id && l.itens.some((x) => x.id === "E02021")));
});
test("simular comprar tudo hoje: todo lote pede hoje", () => {
  assert.ok(montarLotes(itensMock, { janela: 10, hoje, simAgora: true }).every((l) => l.pedir === hoje));
});
