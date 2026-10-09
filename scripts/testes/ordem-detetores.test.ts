// cd web && npx tsx --test ../scripts/testes/ordem-detetores.test.ts
// Central de Ordem — regras dos detetores (as mesmas das telas de Compras e Títulos a Pagar).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { PedidoLista } from "../../web/lib/compras";
import { detetarEntregasAtrasadas, detetarNaoEnviados, detetarNfColunaMeio, detetarPendentesAprovacao, diasUteis } from "../../web/lib/ordem/regras-compras";
import { detetarBloqueados, detetarConciliacao, detetarSemDocumento, detetarVencidosPagar, interpretarPagar } from "../../web/lib/ordem/regras-financeiro";
import { normalizarConfig, SUGERIDO } from "../../web/lib/ordem/config";

const cfg = normalizarConfig({ parametros: SUGERIDO.parametros });
const pc = (o: Partial<PedidoLista>): PedidoLista => ({ id: 1, tipo: "PC", num: "1", etapa: "10", emp: "SF", valor: 100, nItens: 1, aprov: "aguardando", origem: "painel", ...o });

test("pendentes de aprovação = coluna 'Pedido de Compra · Pendentes', agrupados por projeto", () => {
  const ps = [
    pc({ id: 1, num: "7401", proj: "PJ364_Diaverum", emissao: "2026-10-01" }),
    pc({ id: 2, num: "7402", proj: "PJ364_Diaverum", etapa: "15", emissao: "2026-10-08" }),
    pc({ id: 3, num: "7403", proj: "", emissao: "2026-10-09" }),
    pc({ id: 4, num: "7404", aprov: "aprovado" }),
    pc({ id: 5, num: "7405", aprov: "nao_aprovado" }),
    pc({ id: 6, num: "7406", etapa: "60" }),
    pc({ id: 7, tipo: "RC", num: "R1" }),
  ];
  const xs = detetarPendentesAprovacao(ps, "2026-10-09");
  assert.equal(xs.length, 2);
  const pj = xs.find((x) => x.origem_ref === "projeto:PJ364_Diaverum")!;
  assert.equal((pj.dados!.pcs as unknown[]).length, 2);
  assert.equal(pj.urgencia, "critica");                       // espera há 8 dias
  assert.deepEqual(pj.acao!.rota!.corpo, { acao: "aprovar", ids: [1, 2], status: "aprovado" });
  assert.deepEqual(pj.acao!.desfazer!.corpo, { acao: "aprovar", ids: [1, 2], status: "aguardando" });
});

test("não enviado = regra do chip '✉ Não enviados' (painel, aprovado, sem envio)", () => {
  const xs = detetarNaoEnviados([
    pc({ id: 1, aprov: "aprovado", aprovEm: "2026-10-07T10:00:00Z" }),
    pc({ id: 2, aprov: "aprovado", enviadoEm: "2026-10-08" }),
    pc({ id: 3, aprov: "aprovado", origem: "omie" }),
    pc({ id: 4, aprov: "aguardando" }),
  ], "2026-10-09");
  assert.deepEqual(xs.map((x) => x.origem_ref), ["pc:1"]);
  assert.equal(xs[0].acao!.chave, "compras.enviar_fornecedor");
});

test("entrega atrasada: só aprovados, atraso ≥ N dias e até 180 d; um cartão por fornecedor", () => {
  const xs = detetarEntregasAtrasadas([
    pc({ id: 1, aprov: "aprovado", previsao: "2026-09-20", cnpj: "A", forn: "Forn A", proj: "PJ362" }),
    pc({ id: 2, aprov: "aprovado", previsao: "2026-09-25", cnpj: "A", forn: "Forn A" }),
    pc({ id: 3, aprov: "aprovado", previsao: "2026-10-07", cnpj: "B" }),       // 2 dias: abaixo do limite
    pc({ id: 4, aprov: "aguardando", previsao: "2026-09-01", cnpj: "C" }),
    pc({ id: 5, aprov: "aprovado", previsao: "2025-01-01", cnpj: "D" }),       // histórico (> 180 d)
    pc({ id: 6, aprov: "aprovado", previsao: "2026-09-01", cnpj: "E", etapa: "60" }),
  ], "2026-10-09", cfg);
  assert.deepEqual(xs.map((x) => x.origem_ref), ["fornecedor:A"]);
  assert.equal(xs[0].urgencia, "critica");
  assert.equal(xs[0].acao!.rota!.lote!.length, 2);
});

test("NF ↔ PC: dentro da tolerância vai para o lote; fora vira decisão; muito longe = rever sugestão", () => {
  const ps = [pc({ id: 1, num: "7333", valor: 499.17 }), pc({ id: 2, num: "7287", valor: 450.63 }), pc({ id: 3, num: "9", valor: 100 })];
  const sug = new Map([
    [1, [{ chave: "k1", numero: "132139", valor: 499.17, emitente: "Springway", status: "sugerido" }]],
    [2, [{ chave: "k2", numero: "57678", valor: 485.15, emitente: "NSA", status: "sugerido" }]],
    [3, [{ chave: "k3", numero: "1", valor: 500, emitente: "Z", status: "sugerido" }, { chave: "k4", numero: "2", valor: 100, emitente: "Z", status: "confirmado" }]],
  ]);
  const xs = detetarNfColunaMeio(ps, sug, "2026-10-09", cfg);
  const lote = xs.find((x) => x.tipo === "nf_casar_lote")!;
  assert.equal((lote.dados!.pares as unknown[]).length, 1);
  const div = xs.find((x) => x.origem_ref === "nfe:k2|pc:2")!;
  assert.match(div.titulo, /7,7%/);
  assert.equal(div.recomendacao.confianca, "media");
  const longe = xs.find((x) => x.origem_ref === "nfe:k3|pc:3")!;
  assert.equal(longe.recomendacao.confianca, "baixa");
  assert.ok(!xs.some((x) => x.origem_ref.includes("k4")));     // confirmada não é pendência
});

test("pagar: dias pela previsão efetiva; provisionado ≤ 7 d que era despesa direta vira 'Aguardando NF'", () => {
  const rows = [
    ["o:1", "SF", "2026-10-12", 1000, "Forn", null, null, null, null, null, null, 1, null, null, null, null, null, "NFE", false, "dir", "", "o", 0, 1, null, null],
    ["o:2", "SF", "2026-10-01", 500, "Forn2", null, null, null, null, null, null, 2, "APROVADO", "7333", "10", null, null, "NFE", false, "nf", "", "o", 0, 2, null, null],
    ["p:3", "SF", "2026-08-01", 300, "Velho", null, null, null, null, null, null, 3, null, null, null, null, null, null, false, "dir", "", "p", 0, 3, null, null],
  ];
  const ts = interpretarPagar(rows, "2026-10-09", { "o:2": ["2026-10-20", true] }, { "o:1": { nat: "provisionado" } });
  assert.equal(ts[0].st, "nf");                 // provisionado + 3 dias + dir
  assert.equal(ts[1].dias, 11);                 // previsão reprogramada manda
  const bl = detetarBloqueados(ts);
  assert.equal(bl.find((x) => x.tipo === "titulo_bloqueado_sem_nf")!.dados!.titulos && (bl[0].dados!.titulos as unknown[]).length, 2);
  assert.equal(bl[0].depende_de!.modulo, "compras");
  assert.equal(detetarSemDocumento(ts, cfg).length, 1);
  const venc = detetarVencidosPagar(ts, cfg, { SF: { "v>365": { n: 2, v: 999 } } }, 3);
  assert.ok(!venc.some((x) => x.tipo === "titulo_vencido"));           // o único vencido tem mais de 60 dias
  const hist = venc.find((x) => x.tipo === "vencido_historico_omie")!;
  assert.equal((hist.dados as { n: number }).n, 3);                     // 1 na janela + 2 agregados
});

test("conciliação: uma pendência por conta com movimentos pendentes, link para a conta", () => {
  const xs = detetarConciliacao([{ empresa: "SF", cod_cc: 1, descricao: "Bradesco", pendentes: 3, pendentes_valor: 100, extrato_ate: "2026-10-01" }, { empresa: "SF", cod_cc: 2, pendentes: 0 }], "2026-10-09");
  assert.equal(xs.length, 1);
  assert.equal(xs[0].link, "/financeiro/conciliacao?conta=SF:1");
  assert.equal(xs[0].urgencia, "critica");
  assert.deepEqual(xs[0].requer, ["financeiro.conciliar"]);
});

test("dias úteis", () => {
  assert.equal(diasUteis("2026-10-09", "2026-10-13"), 2);   // sex → ter
  assert.equal(diasUteis("2026-10-09", "2026-10-09"), 0);
});
