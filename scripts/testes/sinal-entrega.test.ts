// cd web && npx tsx --test ../scripts/testes/sinal-entrega.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sinalEntrega } from "../../web/lib/sinal-entrega";

const hoje = "2026-10-07";
test("sem data necessária e sem previsão, sem sinal", () => assert.equal(sinalEntrega({ necessario: null, temPc: true, hoje }), null));
test("recebido é verde", () => assert.equal(sinalEntrega({ necessario: "2026-10-01", recebidoEm: "2026-09-24", temPc: true, hoje })?.nivel, "ok"));
test("PC com previsão: folga boa, apertada e atrasada", () => {
  assert.equal(sinalEntrega({ necessario: "2026-10-30", temPc: true, previsaoPc: "2026-10-20", hoje })?.nivel, "ok");
  assert.equal(sinalEntrega({ necessario: "2026-10-30", temPc: true, previsaoPc: "2026-10-29", hoje })?.nivel, "risco");
  assert.equal(sinalEntrega({ necessario: "2026-10-30", temPc: true, previsaoPc: "2026-11-02", hoje })?.nivel, "atrasado");
});
test("PC sem previsão é risco; data já passada sem receber é atraso", () => {
  assert.equal(sinalEntrega({ necessario: "2026-10-30", temPc: true, hoje })?.nivel, "risco");
  assert.equal(sinalEntrega({ necessario: "2026-10-01", temPc: true, previsaoPc: "2026-09-30", hoje })?.nivel, "atrasado");
});
test("sem PC: estimativa pelo prazo médio", () => {
  const s = sinalEntrega({ necessario: "2026-10-30", temPc: false, prazoDias: 10, hoje });
  assert.equal(s?.nivel, "ok"); assert.equal(s?.estimada, true); assert.equal(s?.chegada, "2026-10-17");
  assert.equal(sinalEntrega({ necessario: "2026-10-30", temPc: false, prazoDias: 21, hoje })?.nivel, "risco");
  assert.equal(sinalEntrega({ necessario: "2026-10-30", temPc: false, prazoDias: 30, hoje })?.nivel, "atrasado");
});
test("PC atrasado: chegada efetiva = hoje; ainda com folga é ✓ e o atraso do PC vem à parte", () => {
  const s = sinalEntrega({ necessario: "2026-10-15", temPc: true, previsaoPc: "2026-09-18", hoje });
  assert.equal(s?.nivel, "ok"); assert.equal(s?.chegada, hoje); assert.equal(s?.pcAtrasadoDias, 19); assert.equal(s?.folga, 8);
  assert.match(s!.motivo, /PC atrasado 19d/); assert.match(s!.motivo, /folga 8d/);
});
test("PC atrasado e necessidade perto: ⚠; passou da necessidade: ✕", () => {
  assert.equal(sinalEntrega({ necessario: "2026-10-09", temPc: true, previsaoPc: "2026-09-18", hoje })?.nivel, "risco");
  assert.equal(sinalEntrega({ necessario: "2026-10-05", temPc: true, previsaoPc: "2026-09-18", hoje })?.nivel, "atrasado");
});
test("PC em dia não marca atraso do PC", () => {
  const s = sinalEntrega({ necessario: "2026-10-30", temPc: true, previsaoPc: "2026-10-20", hoje });
  assert.equal(s?.pcAtrasadoDias, 0); assert.equal(s?.previsaoPc, "2026-10-20");
});
test("sem data necessária: ainda mostra a chegada (sem nível de prazo)", () => {
  const s = sinalEntrega({ necessario: null, temPc: true, previsaoPc: "2026-09-18", hoje });
  assert.equal(s?.pcAtrasadoDias, 19); assert.equal(s?.folga, null);
});
test("sem PC e sem prazo médio: risco, sem chegada estimada", () => {
  const s = sinalEntrega({ necessario: "2026-10-30", temPc: false, hoje });
  assert.equal(s?.nivel, "risco"); assert.equal(s?.chegada, null);
});
