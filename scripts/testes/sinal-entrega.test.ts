// cd web && npx tsx --test ../scripts/testes/sinal-entrega.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sinalEntrega } from "../../web/lib/sinal-entrega";

const hoje = "2026-10-07";
test("sem data necessária, sem sinal", () => assert.equal(sinalEntrega({ necessario: null, temPc: true, hoje }), null));
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
