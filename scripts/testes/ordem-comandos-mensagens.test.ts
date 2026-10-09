// cd web && npx tsx --test ../scripts/testes/ordem-comandos-mensagens.test.ts
// Central de Ordem — comandos (interpretação determinística) e regras das mensagens/escada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { casaFiltro, interpretar } from "../../web/lib/ordem/comandos";
import { degrauPorIdade, janelaAtual, textoJanela } from "../../web/lib/ordem/mensagens-regras";

test("comandos do mockup viram tipos de pendência", () => {
  assert.deepEqual(interpretar("casar as NF da coluna do meio").tipos, ["nf_casar_lote"]);
  assert.deepEqual(interpretar("enviar os PCs aprovados").tipos, ["pc_nao_enviado"]);
  const c = interpretar("cobrar fornecedores com entrega atrasada > 7 dias");
  assert.deepEqual(c.tipos, ["entrega_atrasada"]); assert.equal(c.filtro?.diasMin, 7);
  const a = interpretar("aprovar os PCs do PJ364 dentro do budget");
  assert.deepEqual(a.tipos, ["pc_pendente_aprovacao", "pj_pc_pendente"]); assert.deepEqual(a.filtro?.texto, ["pj364"]);
  assert.equal(interpretar("pedir as NF dos títulos bloqueados").modo, "encaminhar");
  assert.deepEqual(interpretar("conciliar o extrato do Omie.CASH").filtro?.texto, ["omie.cash"]);
  assert.equal(interpretar("bom dia").ok, false);
});

test("filtro do comando: projeto no título; atraso mínimo nos PCs do item", () => {
  const f = interpretar("aprovar os PCs do PJ364").filtro;
  assert.equal(casaFiltro({ titulo: "Aprovar 3 PC(s) de PJ364_Diaverum", origem_ref: "projeto:PJ364_Diaverum" }, f, "2026-10-09"), true);
  assert.equal(casaFiltro({ titulo: "Aprovar 1 PC(s) de PJ365", origem_ref: "projeto:PJ365" }, f, "2026-10-09"), false);
  const d = interpretar("cobrar fornecedores com entrega atrasada > 7 dias").filtro;
  assert.equal(casaFiltro({ titulo: "x", origem_ref: "f", dados: { pcs: [{ previsao: "2026-10-05" }] } }, d, "2026-10-09"), false);
  assert.equal(casaFiltro({ titulo: "x", origem_ref: "f", dados: { pcs: [{ previsao: "2026-09-20" }] } }, d, "2026-10-09"), true);
});

test("janela das mensagens: só nos 15 min do horário configurado", () => {
  const hs = ["07:30", "11:30", "16:00", "18:00"];
  assert.equal(janelaAtual(hs, "07:30"), "07:30");
  assert.equal(janelaAtual(hs, "07:44"), "07:30");
  assert.equal(janelaAtual(hs, "07:45"), null);
  assert.equal(janelaAtual(hs, "18:05"), "18:00");
  assert.equal(janelaAtual([], "07:30"), null);
});

test("texto por janela: bom dia, meio do dia, último aviso, fechamento", () => {
  const its = [{ titulo: "A", modulo: "compras", urgencia: "critica", degrau: 0 }, { titulo: "B", modulo: "financeiro", urgencia: "atencao", degrau: 2 }];
  assert.match(textoJanela("07:30", "Ana", its, 0), /Bom dia, Ana.*2.*1 em Compras, 1 em Financeiro.*1 crítica/s);
  assert.match(textoJanela("11:30", "Ana", its, 3), /3 resolvido/);
  assert.match(textoJanela("16:00", "Ana", its, 0), /relatório da gestão às 18:00/);
  assert.match(textoJanela("18:00", "Ana", its, 1), /supervisão/);
});

test("escada: lembrete → 2º aviso → supervisão → direção pela idade; 0 = desligado", () => {
  const esc = { ligada: true, dias_segundo_aviso: 1, dias_supervisao: 2, dias_direcao: 7, supervisao_emails: [], direcao_emails: [] };
  const h = "2026-10-09T12:00:00Z";
  assert.equal(degrauPorIdade("2026-10-09T08:00:00Z", h, esc), 0);
  assert.equal(degrauPorIdade("2026-10-08T08:00:00Z", h, esc), 1);
  assert.equal(degrauPorIdade("2026-10-07T08:00:00Z", h, esc), 2);
  assert.equal(degrauPorIdade("2026-10-01T08:00:00Z", h, esc), 3);
  assert.equal(degrauPorIdade("2026-01-01T08:00:00Z", h, { ...esc, dias_segundo_aviso: 0, dias_supervisao: 0, dias_direcao: 0 }), 0);
});
