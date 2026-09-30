"use client";

/**
 * Fluxo de Caixa projetado — recriação Navy (protótipo "Painel Allka finance").
 *
 * Esqueleto do modelo: saldo hoje · entradas/saídas · menor saldo projetado →
 * linha saldo × entradas × saídas por semana + atenção → árvore Semana ›
 * natureza › título.
 *
 * Regras de negócio são as da tela antiga (FluxoCaixaView), copiadas e não
 * reinventadas:
 *   - saldo de partida = Omie.CASH da Safe (bi.saldo_conta), e com a simulação
 *     ligada, mais os atrasados a receber;
 *   - entradas só Safe, saídas do grupo (o escopo vem da própria RPC);
 *   - título em renegociação fica FORA da curva e o valor que saiu é mostrado;
 *   - a data de cada título passa pelo próximo dia útil.
 *
 * A mesa de reagendamento (reprogramar, ratear em datas, renegociar, enviar ao
 * Omie, simular) é grande e cheia de regras que custaram caro a acertar. Nesta
 * rodada ela vem INTEIRA, abaixo da árvore, sem mudar uma linha — convertê-la
 * ao desenho novo é o passo seguinte, e não à custa de perder função.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import FluxoCaixaView from "../../bi/FluxoCaixaView";
import type { Tom } from "../primitivos";
import {
  ArvoreNavy, Aviso, BotaoTela, CabecalhoTela, Carregando, ChipFiltro, FaixaFiltros, GradeKpis,
  GraficoLinha, MeioTela, PaginaNavy, PainelLateral, brl, brl0, cBarra, cMudo, cPill, cTexto, ddmm,
  diaSemana, hojeISO, kbrl, somaDias, type Bloco, type ColunaNavy, type Kpi, type NoNavy,
} from "./KitTela";

type Titulo = {
  cod_titulo: number; empresa: string; natureza: "R" | "P"; contraparte: string; categoria: string;
  num_titulo: string; documento: string; vencimento: string | null; previsao: string; previsao_original: string | null;
  tem_override: boolean; sincronizado_omie: boolean; esta_vencido: boolean; dias_atraso: number | null;
  faixa_atraso: string | null; valor: number; reprogramado_em: string | null; em_renegociacao: boolean;
  motivo_renegociacao: string | null; previsao_conflito: boolean; alterado_no_omie_em: string | null; alterado_no_omie_por: string | null;
};
type Conta = { empresa: string; cod_conta: number; conta: string; saldo: number; dt_ultimo: string | null };
type Cenario = { entrada: number; saida: number; saida_da_entrada: number; saida_de_fora: number; resultado: number;
  atraso_receber: number; atraso_pagar: number; resultado_se_atraso_pago: number };
type Payload = {
  dias: number; ano: number; pode_editar: boolean;
  saldo_atual: { saldo: number; dt_ref: string | null; origem: string } | null;
  titulos: Titulo[]; atrasados: Titulo[]; contas: Conta[]; cenario: Cenario | null;
};

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
/** Mesmo ajuste da tela antiga: dinheiro não se move no fim de semana. */
function diaUtil(iso: string) {
  const dow = new Date(iso + "T12:00:00Z").getUTCDay();
  return dow === 6 ? somaDias(iso, 2) : dow === 0 ? somaDias(iso, 1) : iso;
}

type Linha = { t: Titulo; dia: string; semana: number };

/** `embutida`: dentro da Visão financeira, sem o cabeçalho da página (a Visão
 *  já tem o seu) — o botão da mesa passa para a faixa de filtros. */
export default function TelaFluxoNavy({ embutida = false }: { embutida?: boolean } = {}) {
  const [semanas, setSemanas] = useState(8);
  const [comAtraso, setComAtraso] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mesa, setMesa] = useState(false);
  const dias = semanas * 7;

  const load = useCallback(async () => {
    setData(null); setErro(null);
    try {
      const r = await fetch(`/api/bi/fluxo-caixa?dias=${Math.max(dias, 60)}&dias_atras=0`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setErro((e as Error).message); }
  }, [dias]);
  useEffect(() => { void load(); }, [load]);

  const hoje = hojeISO(), fim = somaDias(hoje, dias - 1);
  const saldoOmie = num(data?.saldo_atual?.saldo);
  const atrasoReceber = useMemo(() => (data?.atrasados ?? []).filter((t) => t.natureza === "R").reduce((s, t) => s + num(t.valor), 0), [data]);
  const atrasoPagar = useMemo(() => (data?.atrasados ?? []).filter((t) => t.natureza === "P").reduce((s, t) => s + num(t.valor), 0), [data]);
  const saldo0 = comAtraso ? saldoOmie + atrasoReceber : saldoOmie;

  const fora = useMemo(() => (data?.titulos ?? []).filter((t) => t.em_renegociacao), [data]);
  const linhas: Linha[] = useMemo(() => (data?.titulos ?? []).filter((t) => !t.em_renegociacao).flatMap((t) => {
    const d = diaUtil(t.previsao);
    if (d < hoje || d > fim) return [];
    return [{ t, dia: d, semana: Math.floor((Date.parse(d + "T12:00:00Z") - Date.parse(hoje + "T12:00:00Z")) / (7 * 86_400_000)) }];
  }), [data, hoje, fim]);

  const porSemana = useMemo(() => {
    const s = Array.from({ length: semanas }, (_, i) => ({ i, ini: somaDias(hoje, i * 7), e: 0, s: 0, ne: 0, ns: 0, saldo: 0 }));
    for (const l of linhas) { const w = s[l.semana]; if (!w) continue; if (l.t.natureza === "R") { w.e += num(l.t.valor); w.ne++; } else { w.s += num(l.t.valor); w.ns++; } }
    let acc = saldo0; for (const w of s) { acc += w.e - w.s; w.saldo = acc; }
    return s;
  }, [linhas, semanas, hoje, saldo0]);

  if (erro) return <PaginaNavy>{!embutida && <Cab />}<Aviso>{erro}</Aviso></PaginaNavy>;
  if (!data) return <PaginaNavy>{!embutida && <Cab />}<Carregando texto="Projetando…" /></PaginaNavy>;

  const d30 = somaDias(hoje, 30);
  const ent30 = linhas.filter((l) => l.t.natureza === "R" && l.dia <= d30), sai30 = linhas.filter((l) => l.t.natureza === "P" && l.dia <= d30);
  const menor = porSemana.reduce((m, w) => (w.saldo < m.saldo ? w : m), porSemana[0]);
  const kpis: Kpi[] = [
    { rotulo: "Saldo hoje", valor: kbrl(saldo0), hero: true, title: brl(saldo0),
      sub: `${data.saldo_atual?.origem ?? "Omie.CASH · Safe"}${data.saldo_atual?.dt_ref ? ` · ${ddmm(data.saldo_atual.dt_ref)}` : ""}${comAtraso ? " + atrasados a receber" : ""}` },
    { rotulo: "Entradas 30d", valor: kbrl(ent30.reduce((s, l) => s + num(l.t.valor), 0)), sub: `${ent30.length} títulos a receber · Safe`, subTom: "ok" },
    { rotulo: "Saídas 30d", valor: kbrl(sai30.reduce((s, l) => s + num(l.t.valor), 0)), sub: `${sai30.length} títulos a pagar · grupo`, subTom: "crit" },
    ...(menor ? [{ rotulo: "Menor saldo projetado", valor: kbrl(menor.saldo), sub: `semana de ${ddmm(menor.ini)}`, subTom: (menor.saldo < 0 ? "crit" : "warn") as Tom, title: brl(menor.saldo) }] : []),
    { rotulo: "Atrasados (receber − pagar)", valor: kbrl(atrasoReceber - atrasoPagar), title: `a receber ${brl(atrasoReceber)} · a pagar ${brl(atrasoPagar)}`,
      sub: `receber ${kbrl(atrasoReceber)} · pagar ${kbrl(atrasoPagar)}` },
    ...(fora.length ? [{ rotulo: "Fora da curva", valor: String(fora.length), subTom: "violet" as Tom,
      sub: `em renegociação · pagar ${kbrl(fora.filter((t) => t.natureza === "P").reduce((s, t) => s + num(t.valor), 0))} · receber ${kbrl(fora.filter((t) => t.natureza === "R").reduce((s, t) => s + num(t.valor), 0))}` }] : []),
  ];

  const atencao: Bloco[] = [
    ...porSemana.filter((w) => w.s - w.e > 0).sort((a, b) => (b.s - b.e) - (a.s - a.e)).slice(0, 4).map((w) => ({
      k: "i" as const, tom: (w.saldo < 0 ? "crit" : "warn") as Tom,
      t: `Semana de ${ddmm(w.ini)}: saídas superam entradas em ${kbrl(w.s - w.e)}`,
      s: `${w.ns} a pagar · ${w.ne} a receber · saldo ${kbrl(w.saldo)}`,
    })),
    ...(data.cenario ? [{ k: "t" as const, t: `Resultado do ano (cenário): ${brl0(num(data.cenario.resultado))}\nSe os atrasados forem liquidados: ${brl0(num(data.cenario.resultado_se_atraso_pago))}` }] : []),
    { k: "t", t: "Entradas só da Safe, saídas das três empresas — é como o caixa funciona. A projeção ancora na Omie.CASH da Safe." },
  ];

  return (
    <PaginaNavy>
      {!embutida && <Cab acoes={<BotaoTela onClick={() => setMesa((v) => !v)} primario={!mesa}>{mesa ? "Fechar mesa" : "Reagendar títulos"}</BotaoTela>} />}
      <FaixaFiltros>
        {embutida && <BotaoTela onClick={() => setMesa((v) => !v)} primario={!mesa}>{mesa ? "Fechar mesa" : "Reagendar títulos"}</BotaoTela>}
        {[4, 8, 13, 26].map((n) => <ChipFiltro key={n} ativo={semanas === n} onClick={() => setSemanas(n)}>{n} semanas</ChipFiltro>)}
        <ChipFiltro ativo={comAtraso} onClick={() => setComAtraso((v) => !v)}
          title="Simula receber hoje tudo que está vencido a receber da Safe. Não altera nada — é só a curva.">
          Simular atrasados recebidos
        </ChipFiltro>
      </FaixaFiltros>

      <GradeKpis kpis={kpis} min={175} />
      <MeioTela
        grafico={<GraficoLinha titulo="Saldo projetado × entradas × saídas por semana" formatar={brl0}
          rotulos={porSemana.map((w) => ddmm(w.ini))}
          series={[
            { nome: "Saldo", cor: "var(--ww-brand-2)", largura: 3, vals: porSemana.map((w) => w.saldo) },
            { nome: "Entradas", cor: "var(--ww-brand-3)", vals: porSemana.map((w) => w.e) },
            { nome: "Saídas", cor: "var(--ww-crit)", tracejado: "5 4", vals: porSemana.map((w) => w.s) },
          ]} />}
        lado={<PainelLateral titulo="Atenção" blocos={atencao} />} />

      <Arvore linhas={linhas} porSemana={porSemana} />

      {mesa && (
        <section style={{ borderRadius: "var(--radius-section)", border: "1px solid var(--ww-border)", padding: 16, background: "var(--ww-panel-grad)" }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>Mesa de reagendamento</div>
          <div style={{ fontSize: 12, color: "var(--ww-text-muted)", marginBottom: 12 }}>
            Reprogramar, ratear em datas, renegociar, simular e enviar ao Omie — a ferramenta completa, igual à de sempre.
          </div>
          <FluxoCaixaView />
        </section>
      )}
    </PaginaNavy>
  );
}

function Cab({ acoes }: { acoes?: React.ReactNode }) {
  return <CabecalhoTela area="Financeiro" titulo="Fluxo de Caixa projetado" acoes={acoes}
    sub="Saldo de hoje + a receber − a pagar por previsão (bi.fluxo_caixa_titulos) · saldo de bi.saldo_conta · títulos em renegociação fora da curva" />;
}

type Semana = { i: number; ini: string; e: number; s: number; ne: number; ns: number; saldo: number };

function Arvore({ linhas, porSemana }: { linhas: Linha[]; porSemana: Semana[] }) {
  const colunas: ColunaNavy<Linha>[] = [
    { label: "Semana › natureza › título" },
    { label: "Emp.", texto: (l) => l.t.empresa },
    { label: "Categoria", texto: (l) => l.t.categoria },
    { label: "Previsão", texto: (l) => ddmm(l.dia), numero: (l) => Date.parse(l.dia) },
    { label: "Estado", texto: (l) => (l.t.previsao_conflito ? "Omie mudou" : l.t.tem_override ? (l.t.sincronizado_omie ? "Reprogramado · no Omie" : "Reprogramado · falta enviar") : "Original") },
    { label: "Entradas", align: "right", texto: (l) => (l.t.natureza === "R" ? brl(num(l.t.valor)) : ""), numero: (l) => (l.t.natureza === "R" ? num(l.t.valor) : null) },
    { label: "Saídas", align: "right", texto: (l) => (l.t.natureza === "P" ? brl(num(l.t.valor)) : ""), numero: (l) => (l.t.natureza === "P" ? num(l.t.valor) : null) },
    { label: "Líquido", align: "right", filtravel: false },
    { label: "Saldo projetado", align: "right", filtravel: false },
  ];
  const mxSaldo = Math.max(1, ...porSemana.map((w) => Math.abs(w.saldo)));
  const montar = useCallback((ls: Linha[]): NoNavy[] => porSemana.map((w) => {
    const dela = ls.filter((l) => l.semana === w.i);
    const e = dela.filter((l) => l.t.natureza === "R"), s = dela.filter((l) => l.t.natureza === "P");
    const se = e.reduce((a, l) => a + num(l.t.valor), 0), ss = s.reduce((a, l) => a + num(l.t.valor), 0), liq = se - ss;
    const folha = (l: Linha): NoNavy => ({
      id: `t:${l.t.natureza}:${l.t.cod_titulo}`, nome: l.t.contraparte || "—",
      sub: `${l.t.documento || l.t.num_titulo || "título"} · prev. ${ddmm(l.dia)} ${diaSemana(l.dia)}${l.t.previsao_original && l.t.previsao_original !== l.t.previsao ? ` · era ${ddmm(l.t.previsao_original)}` : ""}`,
      title: l.t.previsao_conflito ? `Alterado no Omie${l.t.alterado_no_omie_por ? ` por ${l.t.alterado_no_omie_por}` : ""} — a curva usa a data do Omie` : undefined,
      cels: [cTexto(l.t.empresa, { cor: "var(--ww-text-2)" }), cTexto(l.t.categoria || "—"), cTexto(ddmm(l.dia)),
        l.t.previsao_conflito ? cPill("Omie mudou", "warn") : l.t.tem_override ? cPill(l.t.sincronizado_omie ? "no Omie" : "falta enviar", l.t.sincronizado_omie ? "ok" : "warn", "reprogramado") : cMudo("original"),
        l.t.natureza === "R" ? cTexto(brl(num(l.t.valor)), { tom: "ok", peso: 600 }) : cMudo(""),
        l.t.natureza === "P" ? cTexto(brl(num(l.t.valor)), { tom: "crit", peso: 600 }) : cMudo(""), cMudo(""), cMudo("")],
    });
    const grupo = (nat: "R" | "P", l: Linha[], soma: number): NoNavy => ({
      id: `w${w.i}:${nat}`, nome: nat === "R" ? "A receber" : "A pagar", sub: `${l.length} título${l.length === 1 ? "" : "s"}`,
      cels: [cMudo(""), cMudo(""), cMudo(""), cMudo(""), nat === "R" ? cTexto(brl(soma), { tom: "ok", peso: 600 }) : cMudo(""),
        nat === "P" ? cTexto(brl(soma), { tom: "crit", peso: 600 }) : cMudo(""), cMudo(""), cMudo("")],
      filhos: [...l].sort((a, b) => num(b.t.valor) - num(a.t.valor)).map(folha),
    });
    return {
      id: `w${w.i}`, nome: `Semana de ${ddmm(w.ini)}`, sub: `${w.i === 0 ? "atual · " : ""}${dela.length} títulos`,
      cels: [cMudo(""), cMudo(""), cMudo(""), cMudo(""), cTexto(kbrl(se), { tom: "ok", peso: 600 }), cTexto(kbrl(ss), { tom: "crit", peso: 600 }),
        cTexto(`${liq >= 0 ? "+" : "−"}${kbrl(Math.abs(liq)).replace("R$ ", "R$ ")}`, { tom: liq >= 0 ? "ok" : "crit", peso: 600 }),
        cBarra(kbrl(w.saldo), Math.max(4, (Math.abs(w.saldo) / mxSaldo) * 100), w.saldo < 0 ? "crit" : w.saldo < mxSaldo * 0.25 ? "warn" : "info")],
      filhos: [...(e.length ? [grupo("R", e, se)] : []), ...(s.length ? [grupo("P", s, ss)] : [])],
    };
  }), [porSemana, mxSaldo]);
  return <ArvoreNavy titulo="Semana › natureza › título" dica="Saldo projetado é o acumulado da curva inteira — não muda com os filtros de coluna, que só escolhem o que listar"
    colunas={colunas} registros={linhas} montar={montar} abertosIniciais={["w0"]}
    grid="minmax(280px,1.8fr) 70px minmax(150px,1.1fr) 80px 150px 120px 120px 110px 150px" minWidth={1260}
    buscaNome={(l) => `${l.t.contraparte} ${l.t.documento} ${l.t.num_titulo}`}
    rodape={(ls) => <span>{ls.length} títulos na curva · entradas <b style={{ color: "var(--ww-text)" }}>{brl0(ls.filter((l) => l.t.natureza === "R").reduce((s, l) => s + num(l.t.valor), 0))}</b> · saídas {brl0(ls.filter((l) => l.t.natureza === "P").reduce((s, l) => s + num(l.t.valor), 0))}</span>} />;
}
