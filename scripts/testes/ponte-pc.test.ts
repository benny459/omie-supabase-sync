// cd web && npx tsx --test ../scripts/testes/ponte-pc.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decidirPonte, linhasDePcCancelado, equipamentoDoItem, itemSemColisao, unitLiquido, avisoPonte,
  type ItemPc, type LinhaLista, type Rastro } from "../../web/lib/ponte-pc-decidir";

const it = (id: number, numero: string, desc: string, cod: string | null = null, qtd = 2, valor = 200): ItemPc => ({
  pc_item_id: id, pedido_id: Number(numero), numero, produto_cod: cod, descricao: desc, unidade: "UN",
  qtd, valor_unit: valor / qtd, valor, previsao: "2026-10-20",
});
const ln = (id: string, item: string, extra: Partial<LinhaLista> = {}): LinhaLista => ({ id, equipamento: "Geral", item, ...extra });

test("item sem linha nenhuma entra; os cobertos (vínculo, RC, nº do PC + código) não", () => {
  const itens = [it(1, "7400", "BOMBA DOSADORA 5L/H", "PRD1"), it(2, "7400", "VALVULA ESFERA 1/2", "PRD2"),
    it(3, "7401", "TUBO PVC 25MM", "PRD3"), it(4, "7402", "MEMBRANA 8040", "PRD4"), it(5, "7402", "CABO PP 3X2,5", "PRD5")];
  const linhas = [ln("a", "Bomba", { pc_item_id: 1 }), ln("b", "Válvula", { rc_item_id: 99 }),
    ln("c", "Membrana 8040", { pc_numero: "7402", cat_codigo: "PRD4" })];
  const d = decidirPonte({ itens, linhas, viaRc: new Set([2]) });
  assert.deepEqual(d.cobertos.map((c) => [c.pc_item_id, c.por]), [[1, "vinculo"], [2, "rc"], [4, "numero"]]);
  assert.deepEqual(d.inserir.map((i) => i.pc_item_id), [3, 5]);
});

test("linha antiga só com o nº do PC cobre o item que casa por descrição, não o PC inteiro", () => {
  const itens = [it(1, "7274", 'ADAPTADOR LR 3/4" SCH 80'), it(2, "7274", "LUVA SOLDAVEL 50MM")];
  const d = decidirPonte({ itens, linhas: [ln("x", "Adaptador LR 3/4 SCH80", { pc_numero: "7274" })], viaRc: new Set() });
  assert.deepEqual(d.cobertos.map((c) => c.pc_item_id), [1]);
  assert.deepEqual(d.inserir.map((i) => i.pc_item_id), [2]);
});

test("idempotente: item já tratado (rastro) não volta, nem se a linha foi excluída", () => {
  const itens = [it(1, "7400", "BOMBA")];
  const rastro = new Map<number, Rastro>([[1, { pc_item_id: 1, status: "inserido", lista_id: "zz", pc_numero: "7400" }]]);
  const d = decidirPonte({ itens, linhas: [], viaRc: new Set(), rastro });
  assert.equal(d.inserir.length, 0);
  assert.deepEqual(d.pulados, [{ pc_item_id: 1, por: "rastro" }]);
  // segunda passada depois de inserir: a linha nova cobre pelo vínculo
  const d2 = decidirPonte({ itens, linhas: [ln("n", "BOMBA", { pc_item_id: 1, origem: "pc" })], viaRc: new Set() });
  assert.equal(d2.inserir.length, 0);
});

test("cancelamento desfeito: removido_cancelado volta a entrar", () => {
  const rastro = new Map<number, Rastro>([[1, { pc_item_id: 1, status: "removido_cancelado", lista_id: null, pc_numero: "7400" }]]);
  assert.equal(decidirPonte({ itens: [it(1, "7400", "BOMBA")], linhas: [], viaRc: new Set(), rastro }).inserir.length, 1);
});

test("PC escondido e item devolvido por inteiro ficam de fora; devolução parcial entra com o que ficou", () => {
  const itens = [it(1, "7400", "BOMBA", null, 4, 400), it(2, "7400", "FILTRO", null, 4, 40), it(3, "7999", "TUBO")];
  const d = decidirPonte({ itens, linhas: [], viaRc: new Set(), escondidos: new Set(["7999"]), devolvido: new Map([[1, 4], [2, 1]]) });
  assert.deepEqual(d.pulados.map((p) => [p.pc_item_id, p.por]).sort(), [[1, "devolvido"], [3, "escondido"]]);
  assert.equal(d.inserir.length, 1);
  assert.equal(d.inserir[0].qtd_liquida, 3);
});

test("linha sem PC que o casamento automático garante: LIGA em vez de duplicar (uma linha por item)", () => {
  const itens = [it(1, "7400", "BOMBA DOSADORA", "PRD1"), it(2, "7401", "BOMBA DOSADORA", "PRD1")];
  const linhas = [ln("livre", "Bomba dosadora", { cat_codigo: "PRD1" })];
  const d = decidirPonte({ itens, linhas, viaRc: new Set(), candidatos: [
    { lista_id: "livre", pc_item_id: 1, auto: true }, { lista_id: "livre", pc_item_id: 2, auto: true }] });
  assert.deepEqual(d.ligar.map((l) => [l.lista_id, l.item.pc_item_id]), [["livre", 1]]);
  assert.deepEqual(d.inserir.map((i) => i.pc_item_id), [2]);
  // sugestão sem certeza (auto=false) não liga
  const d2 = decidirPonte({ itens: [itens[0]], linhas, viaRc: new Set(), candidatos: [{ lista_id: "livre", pc_item_id: 1, auto: false }] });
  assert.equal(d2.ligar.length, 0); assert.equal(d2.inserir.length, 1);
});

test("PC cancelado: a linha que a ponte criou sai; a religada a outro PC/RC fica", () => {
  const rastro: Rastro[] = [
    { pc_item_id: 1, status: "inserido", lista_id: "a", pc_numero: "7400" },
    { pc_item_id: 2, status: "inserido", lista_id: "b", pc_numero: "7400" },
    { pc_item_id: 3, status: "inserido", lista_id: "c", pc_numero: "7401" },
    { pc_item_id: 4, status: "ligado", lista_id: "d", pc_numero: "7400" },
  ];
  const linhas = [ln("a", "X", { origem: "pc" }), ln("b", "Y", { origem: "pc", pc_item_id: 77 }), ln("c", "Z", { origem: "pc" }), ln("d", "W")];
  assert.deepEqual(linhasDePcCancelado({ rastro, linhas, cancelados: new Set(["7400"]) }).map((r) => r.lista_id), ["a"]);
});

test("equipamento, texto sem colidir, unitário que fecha com o valor do PC e o aviso", () => {
  assert.equal(equipamentoDoItem({ obs: "Equip.: Osmose 1 · urgente", descricao: "x" }), "Osmose 1");
  assert.equal(equipamentoDoItem({ obs: null, descricao: "Bomba" }, new Map([["bomba", "Dosagem"]])), "Dosagem");
  assert.equal(equipamentoDoItem({ obs: null, descricao: "Nada" }), "Compras diretas");
  const oc = new Set(["compras diretas\x01bomba"]);
  assert.equal(itemSemColisao("BOMBA", "7400", "Compras diretas", oc), "BOMBA · PC 7400");
  assert.equal(itemSemColisao("BOMBA", "7400", "Compras diretas", oc), "BOMBA · PC 7400 (2)");
  assert.equal(unitLiquido({ qtd: 3, valor: 100, valor_unit: 30 }), 33.3333);
  assert.equal(avisoPonte({ inseridos: 2, ligados: 0, removidos_cancelado: 0, pcs: ["7400"] }), "2 item(ns) de compras diretas entraram na lista (PC 7400)");
  assert.equal(avisoPonte({ inseridos: 0, ligados: 0, removidos_cancelado: 0, pcs: [] }), null);
});
