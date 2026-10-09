// cd web && npx tsx --test ../scripts/testes/ordem-acesso.test.ts
// Central de Ordem — acesso e fila (SPEC §4.7): quem vê o quê, cadeados sem contagem,
// pré-visualização só do admin, escopo, valores mascarados, ações só com interruptor + permissão.
import { test } from "node:test";
import assert from "node:assert/strict";
import { modulosVisiveis, podeExecutar, veModulo, type Quem } from "../../web/lib/ordem/acesso";
import { CONFIG_VAZIA, dentroTolerancia, normalizarConfig, SUGERIDO, type ConfigOrdem } from "../../web/lib/ordem/config";
import { filtrarItens, type LinhaItem } from "../../web/lib/ordem/fila";
import type { AreaAccess } from "../../web/lib/permissions";

const tudo = (v: boolean, ks: string[]) => Object.fromEntries(ks.map((k) => [k, v]));
const CHAVES = ["compras.acesso", "compras.ver_valores", "compras.aprovar", "compras.enviar_fornecedor", "estoque.acesso", "estoque.ver_custos",
  "financeiro.ver_pagar", "financeiro.ver_receber", "financeiro.conciliar", "financeiro.baixar", "faturamento.acesso", "projetos.aprovar_acima_budget"];

function pessoa(o: { uid: string; admin?: boolean; role?: "admin" | "aprovador" | "comprador" | "viewer"; areas?: AreaAccess[]; pode?: Record<string, boolean> }): Quem {
  return {
    uid: o.uid, email: `${o.uid}@x`, nome: o.uid, admin: !!o.admin,
    perms: { id: o.uid, role: o.role ?? "viewer", is_admin: !!o.admin, area_access: o.areas ?? [], module_roles: [] },
    pode: { ...tudo(false, CHAVES), ...(o.admin ? tudo(true, CHAVES) : {}), ...(o.pode ?? {}) },
  };
}
// perfis reais (09/10/26), reduzidos ao que importa
const benny = pessoa({ uid: "benny", admin: true, role: "admin", areas: [{ area: "erp", can_view: true }, { area: "financeiro", can_view: true }, { area: "bi", can_view: true }] });
const david = pessoa({ uid: "david", admin: true, role: "admin", areas: [{ area: "erp", can_view: true }] });          // admin SEM linha de Financeiro
const gabriel = pessoa({ uid: "gabriel", areas: [{ area: "erp", can_view: true }, { area: "operacao", can_view: false }, { area: "financeiro", can_view: false }],
  pode: { "compras.acesso": true, "compras.ver_valores": true, "estoque.acesso": true, "estoque.ver_custos": true } });
const marcelo = pessoa({ uid: "marcelo", role: "aprovador", pode: { "compras.aprovar": true, "projetos.aprovar_acima_budget": true } }); // sem área ERP
const fernanda = pessoa({ uid: "fernanda", role: "aprovador", areas: [{ area: "erp", can_view: true }], pode: { "faturamento.acesso": true, "compras.acesso": true } });
const bpo = pessoa({ uid: "bpo", areas: [{ area: "erp", can_view: true }], pode: { "financeiro.ver_pagar": true, "financeiro.ver_receber": true, "financeiro.conciliar": true, "financeiro.baixar": true } });
const semValores = pessoa({ uid: "sv", areas: [{ area: "erp", can_view: true }], pode: { "compras.acesso": true, "compras.ver_valores": false } });

const linha = (o: Partial<LinhaItem> & Pick<LinhaItem, "id" | "tipo" | "modulo">): LinhaItem => ({
  origem_ref: o.id, dono_id: null, urgencia: "atencao", rotulo_urgencia: null, titulo: `T ${o.id} {{R$:100.00}}`, resumo: null, etapa: null, valor: 100,
  link: null, recomendacao: { acao: "fazer {{R$:5.00}}", porque: "x", confianca: "alta" }, dados: { requer: [] }, depende_de: null, estado: "aberto",
  adiado_ate: null, degrau: 0, encaminhado_de: null, encaminhado_por: null, criado_em: "2026-10-01T00:00:00Z", ...o,
});
const LINHAS: LinhaItem[] = [
  linha({ id: "c1", tipo: "pc_nao_enviado", modulo: "compras", dono_id: "gabriel" }),
  linha({ id: "c2", tipo: "pc_pendente_aprovacao", modulo: "compras", dono_id: "outro" }),
  linha({ id: "f1", tipo: "titulo_vencido", modulo: "financeiro", dados: { requer: ["financeiro.ver_pagar"] } }),
  linha({ id: "f2", tipo: "receber_vencido", modulo: "financeiro", dados: { requer: ["financeiro.ver_receber"] } }),
  linha({ id: "fc", tipo: "extrato_a_conciliar", modulo: "financeiro", dados: { requer: ["financeiro.conciliar"] } }),
  linha({ id: "o1", tipo: "op_pode_faturar", modulo: "operacao" }),
];
const ligadoTudo: ConfigOrdem = normalizarConfig({
  ...CONFIG_VAZIA, ativo: true,
  modulos: { compras: true, financeiro: true, operacao: true, estoque: true, projetos: true },
  detetores: { pc_nao_enviado: true, pc_pendente_aprovacao: true, titulo_vencido: true, receber_vencido: true, extrato_a_conciliar: true, op_pode_faturar: true },
  parametros: { ...SUGERIDO.parametros },
});

test("módulos: mesmas regras das telas (ERP + permissão fina; Financeiro só com ver_pagar/ver_receber)", () => {
  assert.deepEqual(modulosVisiveis(benny), ["compras", "financeiro", "operacao", "projetos", "faturamento", "estoque", "cadastros"]);
  assert.deepEqual(modulosVisiveis(gabriel), ["compras", "estoque", "cadastros"]);          // operação negada por linha explícita
  assert.deepEqual(modulosVisiveis(marcelo), ["operacao", "projetos"]);                       // sem ERP: nada de Compras/Financeiro
  assert.ok(veModulo(bpo, "financeiro") && !veModulo(bpo, "compras"));
  assert.ok(modulosVisiveis(fernanda).includes("faturamento"));
});

test("P2 estrito: Financeiro exige também a linha explícita da área (admin sem linha não entra)", () => {
  const estrito = { parametros: { ...SUGERIDO.parametros, p2_financeiro: "estrito" as const } };
  assert.equal(veModulo(benny, "financeiro", estrito), true);
  assert.equal(veModulo(david, "financeiro", estrito), false);
  assert.equal(veModulo(bpo, "financeiro", estrito), false);
});

test("Central desligada: ninguém além do admin vê nada; admin vê em pré-visualização", () => {
  const f = filtrarItens(gabriel, CONFIG_VAZIA, LINHAS, { escopo: "equipe" });
  assert.equal(f.itens.length, 0);
  assert.ok(f.abas.every((a) => !a.acesso || a.n == null || a.n === 0));
  const b = filtrarItens(benny, CONFIG_VAZIA, LINHAS, { escopo: "todos" });
  assert.equal(b.previa, true);
  assert.equal(b.itens.length, LINHAS.length);
  assert.ok(b.itens.every((i) => i.previa));
});

test("módulo sem acesso: cadeado SEM contagem e SEM itens (nem no Meu dia)", () => {
  const f = filtrarItens(gabriel, ligadoTudo, LINHAS, { escopo: "equipe" });
  assert.ok(f.itens.every((i) => i.modulo === "compras"));
  const fin = f.abas.find((a) => a.modulo === "financeiro")!;
  assert.equal(fin.acesso, false); assert.equal(fin.n, null); assert.equal(fin.criticos, null);
  const bloq = filtrarItens(gabriel, ligadoTudo, LINHAS, { modulo: "financeiro" });
  assert.equal(bloq.bloqueado, "financeiro"); assert.equal(bloq.itens.length, 0);
});

test("item com permissão fina extra: receber/conciliação só para quem tem a chave", () => {
  const soPagar = pessoa({ uid: "p", areas: [{ area: "erp", can_view: true }], pode: { "financeiro.ver_pagar": true } });
  const fin = (q: Quem) => filtrarItens(q, ligadoTudo, LINHAS, { escopo: "equipe", modulo: "financeiro" }).itens.map((i) => i.id).sort();
  assert.deepEqual(fin(soPagar), ["f1"]);
  assert.deepEqual(fin(bpo), ["f1", "f2", "fc"]);
});

test("admin sem as linhas explícitas não vê Financeiro: sem ERP nunca; sem 'financeiro' com P2 estrito", () => {
  // Títulos a Pagar/Receber exigem hoje a área ERP (requirePermissao) — admin sem a linha não entra.
  const semErp = pessoa({ uid: "adm", admin: true, role: "admin", areas: [] });
  const f = filtrarItens(semErp, CONFIG_VAZIA, LINHAS, { escopo: "todos" });
  assert.ok(!f.itens.some((i) => i.modulo === "financeiro" || i.modulo === "compras"));
  assert.equal(f.abas.find((a) => a.modulo === "financeiro")?.acesso, false);
  // Com P2 = estrito, também a linha da área Financeiro (DRE/BI) passa a ser exigida.
  const estrito = normalizarConfig({ ...CONFIG_VAZIA, parametros: { ...CONFIG_VAZIA.parametros, p2_financeiro: "estrito" } });
  const d = filtrarItens(david, estrito, LINHAS, { escopo: "todos" });
  assert.ok(!d.itens.some((i) => i.modulo === "financeiro"));
  assert.equal(d.abas.find((a) => a.modulo === "financeiro")?.acesso, false);
});

test("escopo: 'meus' por omissão (dono = eu ou sem dono); equipe só com P1", () => {
  const meus = filtrarItens(gabriel, ligadoTudo, LINHAS, {});
  assert.equal(meus.escopo, "meus");
  assert.deepEqual(meus.itens.map((i) => i.id), ["c1"]);
  const soSup = normalizarConfig({ ...ligadoTudo, parametros: { ...ligadoTudo.parametros, p1_visao_equipe: "so_supervisao" } });
  assert.deepEqual(filtrarItens(gabriel, soSup, LINHAS, { escopo: "equipe" }).escopos, ["meus"]);
  assert.equal(filtrarItens(gabriel, soSup, LINHAS, { escopo: "equipe" }).escopo, "meus");
});

test("valores mascarados para quem não vê valores no módulo", () => {
  const f = filtrarItens(semValores, ligadoTudo, LINHAS, { escopo: "equipe" });
  const c = f.itens.find((i) => i.id === "c2")!;
  assert.equal(c.valor, null);
  assert.match(c.titulo, /R\$ •••/);
  assert.match(c.recomendacao.acao, /R\$ •••/);
  const g = filtrarItens(gabriel, ligadoTudo, LINHAS, { escopo: "equipe" }).itens.find((i) => i.id === "c2")!;
  assert.match(g.titulo, /R\$\s?100,00/);
});

test("ações: só com o interruptor ligado E a permissão da tela", () => {
  assert.equal(podeExecutar(benny, CONFIG_VAZIA, "compras.enviar_fornecedor").ok, false);   // desligada, nem admin
  const cfg = normalizarConfig({ ...ligadoTudo, acoes: { "compras.enviar_fornecedor": true, "financeiro.conciliar": true } });
  assert.equal(podeExecutar(gabriel, cfg, "compras.enviar_fornecedor").ok, false);
  const g2 = pessoa({ uid: "g2", areas: [{ area: "erp", can_view: true }], pode: { "compras.acesso": true, "compras.enviar_fornecedor": true } });
  assert.equal(podeExecutar(g2, cfg, "compras.enviar_fornecedor").ok, true);
  assert.equal(podeExecutar(pessoa({ uid: "c", pode: { "financeiro.conciliar": true } }), cfg, "financeiro.conciliar").ok, false); // falta baixar
  assert.equal(podeExecutar(bpo, cfg, "financeiro.conciliar").ok, true);
  assert.equal(podeExecutar(benny, cfg, "acao.inexistente").ok, false);
});

test("M1: tolerância = o menor entre R$ e % do PC", () => {
  const p = SUGERIDO.parametros;               // R$ 5 ou 0,5%
  assert.equal(dentroTolerancia(4, 10_000, p), true);    // 0,5% de 10 mil = 50 → limite 5
  assert.equal(dentroTolerancia(6, 10_000, p), false);
  assert.equal(dentroTolerancia(1, 100, p), false);      // 0,5% de 100 = 0,50
  assert.equal(dentroTolerancia(0.4, 100, p), true);
  assert.equal(dentroTolerancia(0, 0, CONFIG_VAZIA.parametros), true);  // sem configurar: só o exacto
  assert.equal(dentroTolerancia(0.02, 100, CONFIG_VAZIA.parametros), false);
});
