"use client";

// MOCKUP da tela de projeto — para aprovação, não ligado ao banco.
//
// Junta o que hoje está espalhado em três lugares (materiais, orçamento,
// cronograma) e acrescenta o que não existe: o FLUXO DE CAIXA DO PROJETO, que
// cruza as duas pontas.
//
// A ideia que organiza a tela: cronograma manda nas ENTRADAS, orçamento manda
// nas SAÍDAS, e a curva é a consequência. Por isso as três seções ficam na
// mesma tela e não em abas — mexer no cronograma e ver a curva reagir é o ponto.
//
// Toda entrada de dado aceita os três caminhos: digitar, colar do Excel, subir
// planilha. Nenhum é o "jeito certo" — quem tem a planilha sobe, quem está
// negociando digita, quem recebeu por e-mail cola.

import { useMemo, useState } from "react";
import GradeEditavel, {
  brl, linhaVazia, num, type ColunaGrade, type LinhaGrade,
} from "./GradeEditavel";
import ChartFrame, { type SeriesDef } from "@/components/viz/ChartFrame";
import VizCombo from "@/components/viz/VizCombo";
import StatTile from "@/components/viz/StatTile";

// ─────────────────────────────────────────────────────────────────────────────
// Colunas de cada grade
// ─────────────────────────────────────────────────────────────────────────────

const COLS_MATERIAIS: ColunaGrade[] = [
  { key: "equipamento", label: "Equipamento", w: 160 },
  { key: "item",        label: "Item / Descrição", w: 300 },
  { key: "qtd",         label: "Qtd", w: 64, tipo: "num", alinhaDireita: true },
  { key: "modelo",      label: "Modelo / Ref.", w: 150 },
  { key: "unitario",    label: "Custo unit.", w: 106, tipo: "moeda", alinhaDireita: true },
  { key: "total",       label: "Total", w: 110, alinhaDireita: true,
    calculada: (l) => brl(num(l.qtd) * num(l.unitario)) },
];

const COLS_ORCAMENTO: ColunaGrade[] = [
  { key: "grupo",     label: "Grupo", w: 150 },
  { key: "descricao", label: "Descrição", w: 280 },
  { key: "previsto",  label: "Previsto", w: 118, tipo: "moeda", alinhaDireita: true },
  { key: "data",      label: "Desembolso", w: 132, tipo: "data" },
  { key: "fornecedor", label: "Fornecedor", w: 170 },
];

const COLS_CRONOGRAMA: ColunaGrade[] = [
  { key: "etapa",   label: "Etapa / Marco", w: 260 },
  { key: "data",    label: "Data prevista", w: 132, tipo: "data" },
  { key: "pct",     label: "% do contrato", w: 110, tipo: "num", alinhaDireita: true },
  { key: "receita", label: "Entrada prevista", w: 130, alinhaDireita: true, calculada: () => "" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Dados de exemplo — plausíveis, para o mockup ser avaliável
// ─────────────────────────────────────────────────────────────────────────────

const mk = (cols: ColunaGrade[], dados: Record<string, string>[]): LinhaGrade[] =>
  [...dados.map((d) => ({ ...linhaVazia(cols), ...d })), linhaVazia(cols)];

const MATERIAIS_EX = mk(COLS_MATERIAIS, [
  { equipamento: "OSMOSE INDUSTRIAL", item: "VÁLVULA SOLENÓIDE 100-DV 1\" 24 VAC", qtd: "1", unitario: "179,90" },
  { equipamento: "OSMOSE INDUSTRIAL", item: "PRESSOSTATO DANFOSS KPI 35", qtd: "1", unitario: "672,00" },
  { equipamento: "OSMOSE INDUSTRIAL", item: "ROTAMETRO 5-35 LPM LZT-2510", qtd: "2", modelo: "LZT-2510M", unitario: "492,12" },
  { equipamento: "HIDRÁULICA OSMOSE", item: "Bucha de Redução Inox 1/2\" x 1/4\"", qtd: "10", unitario: "6,72" },
  { equipamento: "HIDRÁULICA OSMOSE", item: "ENGATE RÁPIDO MACHO MANG 1/4", qtd: "16", unitario: "12,40" },
]);

const ORCAMENTO_EX = mk(COLS_ORCAMENTO, [
  { grupo: "Materiais",   descricao: "Painel elétrico montado", previsto: "32.000,00", data: "2026-10-20", fornecedor: "ELETROTEC" },
  { grupo: "Mão de obra", descricao: "Montagem em fábrica — 3 técnicos", previsto: "28.000,00", data: "2026-11-10", fornecedor: "Interno" },
  { grupo: "Mão de obra", descricao: "Instalação em campo + comissionamento", previsto: "22.000,00", data: "2026-12-05", fornecedor: "Interno" },
  { grupo: "Logística",   descricao: "Frete + içamento", previsto: "9.500,00", data: "2026-11-25", fornecedor: "TRANSLOG" },
]);

const CRONOGRAMA_EX = mk(COLS_CRONOGRAMA, [
  { etapa: "Assinatura / entrada", data: "2026-09-30", pct: "30" },
  { etapa: "Aprovação do projeto executivo", data: "2026-10-31", pct: "20" },
  { etapa: "Entrega dos equipamentos", data: "2026-11-30", pct: "30" },
  { etapa: "Comissionamento e aceite", data: "2026-12-20", pct: "20" },
]);

/** REALIZADO — números reais do projeto PJ350 (HIAE CME Morumbi), lidos do
 *  banco. Servem pra avaliar o desenho com dado de verdade, não inventado.
 *
 *  Faturar, receber e pagar são TRÊS coisas: dez/25 faturou R$ 202.560 e o
 *  dinheiro só entrou em jan/26. Um gráfico que misturasse as três esconderia
 *  justamente a defasagem que aperta o caixa. */
const REALIZADO_MES = [
  { mes: "2025-12", faturado: 202560, recebido: 0,      pago: 0 },
  { mes: "2026-01", faturado: 0,      recebido: 202560, pago: 9120 },
  { mes: "2026-02", faturado: 0,      recebido: 0,      pago: 9158 },
  { mes: "2026-03", faturado: 0,      recebido: 0,      pago: 0 },
  { mes: "2026-04", faturado: 0,      recebido: 0,      pago: 0 },
  { mes: "2026-05", faturado: 0,      recebido: 0,      pago: 17530 },
  { mes: "2026-06", faturado: 0,      recebido: 0,      pago: 64431 },
  { mes: "2026-07", faturado: 0,      recebido: 0,      pago: 41216 },
  { mes: "2026-08", faturado: 258320, recebido: 0,      pago: 12694 },
];

/** Pagamentos item a item — "o que já paguei e em que data". Dados reais. */
const PAGAMENTOS = [
  { data: "2026-08-24", fornecedor: "OKI COMERCIO DE MATERIAIS CONSTRUÇÃO", doc: "000081034", categoria: "Materiais", valor: 1557.74 },
  { data: "2026-08-24", fornecedor: "CONAB CONSERBOMBAS LTDA", doc: "000295795", categoria: "Compras de Matéria Prima", valor: 4202.14 },
  { data: "2026-08-13", fornecedor: "FLUID BRASIL SISTEMAS E TECNOLOGIA", doc: "000052550/3", categoria: "Materiais", valor: 6933.86 },
  { data: "2026-07-31", fornecedor: "COMERCIAL ELETRICA PJ", doc: "000737895/3", categoria: "Compras de Matéria Prima", valor: 223.40 },
  { data: "2026-07-27", fornecedor: "Portal Comércio de Bombas e Máquinas", doc: "000016851/2", categoria: "Materiais", valor: 6363.33 },
  { data: "2026-07-23", fornecedor: "PUMPING & PLUMBING COMERCIO", doc: "000008701/2", categoria: "Materiais", valor: 5261.65 },
  { data: "2026-07-22", fornecedor: "COMERCIAL ELETRICA PJ", doc: "000736227", categoria: "Materiais", valor: 7213.67 },
  { data: "2026-07-17", fornecedor: "REMPLAST", doc: "000002453/1", categoria: "Materiais", valor: 8410.00 },
  { data: "2026-07-14", fornecedor: "FLUID BRASIL SISTEMAS E TECNOLOGIA", doc: "000052550/2", categoria: "Materiais", valor: 6933.86 },
  { data: "2026-07-13", fornecedor: "OKI COMERCIO DE MATERIAIS CONSTRUÇÃO", doc: "000080025/3", categoria: "Compras de Matéria Prima", valor: 3293.16 },
];

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesRotulo = (iso: string) => {
  const [a, m] = iso.slice(0, 7).split("-");
  return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
};

export default function ProjetoMockupView() {
  const [valorContrato, setValorContrato] = useState("210.000,00");
  const [materiais, setMateriais] = useState<LinhaGrade[]>(MATERIAIS_EX);
  const [orcamento, setOrcamento] = useState<LinhaGrade[]>(ORCAMENTO_EX);
  const [cronograma, setCronograma] = useState<LinhaGrade[]>(CRONOGRAMA_EX);

  const contrato = num(valorContrato);

  const totalMateriais = useMemo(
    () => materiais.reduce((a, l) => a + num(l.qtd) * num(l.unitario), 0),
    [materiais],
  );
  /** O grupo "Materiais" do orçamento é CALCULADO da lista, não digitado —
   *  decisão do Benny. Digitar os dois lados garantiria divergência: bastaria
   *  acrescentar um item e esquecer de atualizar o orçamento. */
  const totalOrcado = useMemo(
    () => orcamento.reduce((a, l) => a + num(l.previsto), 0) + totalMateriais,
    [orcamento, totalMateriais],
  );
  const pctTotal = useMemo(
    () => cronograma.reduce((a, l) => a + num(l.pct), 0),
    [cronograma],
  );

  /** A curva do projeto: entradas do cronograma × saídas do orçamento, por mês.
   *
   *  Mês e não dia: no horizonte de um projeto (meses a mais de um ano) o dia
   *  exato é ruído — o que se decide olhando isso é "em que mês o caixa aperta",
   *  não "em que terça". */
  const fluxo = useMemo(() => {
    const porMes = new Map<string, { entrada: number; saida: number }>();
    const toque = (iso: string) => {
      const k = iso.slice(0, 7);
      if (!porMes.has(k)) porMes.set(k, { entrada: 0, saida: 0 });
      return porMes.get(k)!;
    };
    for (const l of cronograma) {
      if (!l.data || !num(l.pct)) continue;
      toque(l.data).entrada += contrato * (num(l.pct) / 100);
    }
    for (const l of orcamento) {
      if (!l.data || !num(l.previsto)) continue;
      toque(l.data).saida += num(l.previsto);
    }
    const chaves = Array.from(porMes.keys()).sort();
    let acum = 0;
    return chaves.map((k) => {
      const c = porMes.get(k)!;
      acum += c.entrada - c.saida;
      return {
        x: mesRotulo(`${k}-01`),
        Entradas: c.entrada,
        Saídas: -c.saida,
        Acumulado: acum,
      };
    });
  }, [cronograma, orcamento, contrato]);

  /** Curva do REALIZADO. A linha acumulada usa CAIXA (recebido − pago), não
   *  faturado: a pergunta aqui é quanto dinheiro o projeto tem, e nota emitida
   *  não paga fornecedor. O faturado aparece como barra pra mostrar a
   *  defasagem entre emitir e receber. */
  const realizado = useMemo(() => {
    let acum = 0;
    return REALIZADO_MES.map((m) => {
      acum += m.recebido - m.pago;
      return {
        x: mesRotulo(`${m.mes}-01`),
        Faturado: m.faturado,
        Recebido: m.recebido,
        Pago: -m.pago,
        "Caixa acumulado": acum,
      };
    });
  }, []);

  const totRealizado = useMemo(() => {
    const soma = (k: "faturado" | "recebido" | "pago") =>
      REALIZADO_MES.reduce((a, m) => a + m[k], 0);
    return { faturado: soma("faturado"), recebido: soma("recebido"), pago: soma("pago") };
  }, []);

  const piorMes = useMemo(() => {
    if (!fluxo.length) return null;
    return fluxo.reduce((m, p) => (p.Acumulado < m.Acumulado ? p : m));
  }, [fluxo]);

  const margem = contrato - totalOrcado;

  const barras: SeriesDef[] = [
    { key: "Entradas", label: "Entradas (cronograma)", slot: 5, mark: "rect" },
    { key: "Saídas",   label: "Saídas (orçamento)",    slot: 3, mark: "rect" },
  ];
  const linhas: SeriesDef[] = [
    { key: "Acumulado", label: "Caixa acumulado do projeto", slot: 0, mark: "line" },
  ];
  // Realizado: faturado em azul (é fato contábil, não caixa), recebido em verde
  // e pago em vermelho — mesma convenção do fluxo geral.
  const barrasReal: SeriesDef[] = [
    { key: "Faturado", label: "Faturado (nota emitida)", slot: 0, mark: "rect" },
    { key: "Recebido", label: "Recebido (entrou)",       slot: 5, mark: "rect" },
    { key: "Pago",     label: "Pago (saiu)",             slot: 3, mark: "rect" },
  ];
  const linhaReal: SeriesDef[] = [
    { key: "Caixa acumulado", label: "Caixa acumulado (recebido − pago)", slot: 2, mark: "line" },
  ];

  return (
    <div className="space-y-4">
      {/* Cabeçalho do projeto */}
      <div className="flex items-end gap-4 flex-wrap bg-ww-panel border border-ww-border rounded-xl p-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
            Valor do contrato
          </span>
          <input value={valorContrato} onChange={(e) => setValorContrato(e.target.value)}
            className="w-[140px] text-[15px] font-bold tabular-nums bg-ww-bg border border-ww-border rounded px-2 py-1 text-ww-text" />
        </div>
        <StatTile label="Orçado (saídas)" value={brl(totalOrcado)}
          hint={`${orcamento.filter((l) => num(l.previsto)).length} lançamentos`} higherIsBetter={false} />
        <StatTile label="Margem prevista"
          value={contrato > 0 ? `${((margem / contrato) * 100).toFixed(1).replace(".", ",")}%` : "—"}
          hint={brl(margem)} />
        <StatTile label="Materiais na lista" value={brl(totalMateriais)}
          hint={`${materiais.filter((l) => l.item?.trim()).length} itens`} />
        <StatTile label="Já pago (realizado)" value={brl(totRealizado.pago)}
          hint={`${PAGAMENTOS.length}+ pagamentos · ${totalOrcado > 0 ? ((totRealizado.pago / totalOrcado) * 100).toFixed(0) : 0}% do orçado`}
          higherIsBetter={false} />
        <StatTile label="Já recebido" value={brl(totRealizado.recebido)}
          hint={`de ${brl(totRealizado.faturado)} faturado`} />
        <StatTile label="Pior mês do projeto"
          value={piorMes ? brl(piorMes.Acumulado) : "—"}
          hint={piorMes ? `em ${piorMes.x}` : undefined}
          higherIsBetter={false} />
      </div>

      {/* ── O gráfico primeiro: é a consequência que se quer ver ─────────────── */}
      <ChartFrame
        title="Fluxo de caixa do projeto"
        subtitle="Entradas saem do CRONOGRAMA (% do contrato na data do marco) · saídas saem do ORÇAMENTO (previsto na data de desembolso). Edite qualquer das duas tabelas abaixo e a curva reage."
        series={[...barras, ...linhas]}
        rows={fluxo}
        valueFormat={(v) => brl(Number(v))}
        height={300}
      >
        {(vis) => (
          <VizCombo rows={fluxo}
            bars={barras.filter((b) => vis.some((v) => v.key === b.key))}
            lines={linhas.filter((l) => vis.some((v) => v.key === l.key))}
            valueFormat={(v) => brl(v)} />
        )}
      </ChartFrame>

      {/* ── REALIZADO: o que de fato aconteceu ──────────────────────────────── */}
      <ChartFrame
        title="Fluxo realizado do projeto"
        subtitle="Vem pronto do financeiro, pelo projeto do título. FATURADO ≠ RECEBIDO: a nota de dez/25 só virou dinheiro em jan/26. A linha acumula CAIXA (recebido − pago), porque nota emitida não paga fornecedor."
        series={[...barrasReal, ...linhaReal]}
        rows={realizado}
        valueFormat={(v) => brl(Number(v))}
        height={300}
      >
        {(vis) => (
          <VizCombo rows={realizado}
            bars={barrasReal.filter((b) => vis.some((v) => v.key === b.key))}
            lines={linhaReal.filter((l) => vis.some((v) => v.key === l.key))}
            valueFormat={(v) => brl(v)} />
        )}
      </ChartFrame>

      <Secao
        titulo="Pagamentos realizados"
        sub="O que já saiu do caixa por este projeto, com a data em que saiu. Vem do financeiro — não se digita aqui."
        acoes={<><BotaoFake>⬇ Excel</BotaoFake><BotaoFake>📄 PDF</BotaoFake></>}
      >
        <div className="border border-ww-border rounded-lg overflow-auto" style={{ maxHeight: 260 }}>
          <table className="w-full text-[11.5px] border-collapse">
            <thead className="sticky top-0 bg-ww-panel">
              <tr className="text-[10px] uppercase tracking-wider text-ww-textMuted">
                {["Pago em", "Fornecedor", "Documento", "Categoria"].map((h) => (
                  <th key={h} className="p-1.5 text-left shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">{h}</th>
                ))}
                <th className="p-1.5 text-right shadow-[0_1px_0_0_rgb(var(--color-ww-border))]">Valor</th>
              </tr>
            </thead>
            <tbody>
              {PAGAMENTOS.map((p, i) => (
                <tr key={i} className="viz-row">
                  <td className="p-1.5 border-b border-ww-border/40 tabular-nums text-ww-text">
                    {p.data.slice(8, 10)}/{p.data.slice(5, 7)}/{p.data.slice(2, 4)}
                  </td>
                  <td className="p-1.5 border-b border-ww-border/40 text-ww-text truncate" title={p.fornecedor}>
                    {p.fornecedor}
                  </td>
                  <td className="p-1.5 border-b border-ww-border/40 text-ww-textMuted tabular-nums">{p.doc}</td>
                  <td className="p-1.5 border-b border-ww-border/40 text-ww-textMuted">{p.categoria}</td>
                  <td className="p-1.5 border-b border-ww-border/40 text-right tabular-nums text-ww-text">
                    {brl(p.valor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10.5px] text-ww-textFaint mt-1.5">
          Mostrando 10 de 39 pagamentos · total pago {brl(totRealizado.pago)}. No real, a lista
          vem inteira e filtrável por período, fornecedor e categoria.
        </p>
      </Secao>

      {/* ── Cronograma: manda nas entradas ───────────────────────────────────── */}
      <Secao
        titulo="Cronograma de recebimento"
        sub="Cada marco libera uma parcela do contrato. É isto que gera as ENTRADAS do gráfico."
        alerta={Math.abs(pctTotal - 100) > 0.01
          ? `Os percentuais somam ${pctTotal.toFixed(1).replace(".", ",")}% — ${pctTotal > 100 ? "acima" : "abaixo"} de 100%. A curva usa o que está aqui, sem completar a diferença.`
          : null}
      >
        <GradeEditavel
          cols={COLS_CRONOGRAMA.map((c) => c.key === "receita"
            ? { ...c, calculada: (l) => (num(l.pct) ? brl(contrato * (num(l.pct) / 100)) : "—") }
            : c)}
          linhas={cronograma} onChange={setCronograma} altura={220}
          vazioMsg="Ex.: Assinatura 30% · Projeto aprovado 20% · Entrega 30% · Aceite 20%"
        />
      </Secao>

      {/* ── Orçamento: manda nas saídas ──────────────────────────────────────── */}
      <Secao
        titulo="Orçamento do projeto"
        sub="Custo previsto e QUANDO sai do caixa. É isto que gera as SAÍDAS do gráfico. Materiais entram calculados da lista."
        acoes={<><BotaoFake>📄 Subir modelo (.xlsx)</BotaoFake><BotaoFake>⬇ Baixar modelo</BotaoFake></>}
      >
        {/* Linha travada: o grupo Materiais vem da lista, não da digitação.
            Mostrar como linha (e não só somar escondido) mantém o orçamento
            legível de cima a baixo — quem soma as colunas na mão fecha a conta. */}
        <div className="flex items-center gap-3 px-3 py-2 mb-1.5 rounded-md border border-ww-border bg-ww-rowHover/60">
          <span className="text-[11px] font-semibold text-ww-text">Materiais</span>
          <span className="text-[11px] text-ww-textMuted">
            Calculado da lista abaixo · {materiais.filter((l) => l.item?.trim()).length} itens
          </span>
          <span className="ml-auto text-[12.5px] font-bold tabular-nums text-ww-text">
            {brl(totalMateriais)}
          </span>
          <span className="text-[10px] text-ww-textFaint">🔒 não editável aqui</span>
        </div>
        <GradeEditavel cols={COLS_ORCAMENTO} linhas={orcamento} onChange={setOrcamento} altura={240}
          vazioMsg="Agrupe por Materiais / Mão de obra / Logística — o grupo vira a quebra do relatório." />
      </Secao>

      {/* ── Materiais ────────────────────────────────────────────────────────── */}
      <Secao
        titulo="Lista de materiais"
        sub="Uma linha por item. Some ao orçamento como o grupo Materiais, ou mantenha separado para cotação."
        acoes={<><BotaoFake>📄 Subir XLSX</BotaoFake><BotaoFake>⬇ Baixar modelo</BotaoFake><BotaoFake>→ Somar ao orçamento</BotaoFake></>}
      >
        <GradeEditavel cols={COLS_MATERIAIS} linhas={materiais} onChange={setMateriais} altura={280}
          vazioMsg="Cole direto do Excel: Equipamento · Item · Qtd · Modelo · Custo unitário" />
      </Secao>

      <p className="text-[10.5px] text-ww-textFaint px-1">
        Mockup para aprovação — nada aqui grava no banco. Os números são de exemplo, mas as três
        formas de entrada funcionam de verdade: digite numa célula, cole um bloco do Excel com
        Ctrl+V, ou navegue com Tab e Enter.
      </p>
    </div>
  );
}

function Secao({
  titulo, sub, children, acoes, alerta,
}: {
  titulo: string; sub: string; children: React.ReactNode;
  acoes?: React.ReactNode; alerta?: string | null;
}) {
  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 space-y-2">
      <header className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">{titulo}</h3>
          <p className="text-[11px] text-ww-textMuted mt-0.5">{sub}</p>
        </div>
        {acoes && <div className="flex items-center gap-1.5">{acoes}</div>}
      </header>
      {alerta && (
        <div className="px-2.5 py-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-800 dark:text-amber-200">
          ⚠ {alerta}
        </div>
      )}
      {children}
    </section>
  );
}

/** Botão sem ação — o mockup mostra ONDE cada caminho de entrada mora, sem
 *  prometer que já funciona. */
function BotaoFake({ children }: { children: React.ReactNode }) {
  return (
    <button type="button" disabled
      title="No mockup só ilustra a posição — não faz nada ainda"
      className="px-2 py-0.5 text-[11px] rounded border border-ww-border text-ww-textMuted opacity-60 cursor-not-allowed">
      {children}
    </button>
  );
}
