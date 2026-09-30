"use client";

/**
 * Visão financeira — recriação Navy (protótipo "Painel Allka finance").
 *
 * A aba "Visão" é a do modelo: saldo bancário, a receber / a pagar em 30 dias,
 * resultado do mês → receitas × despesas por mês + saldos por conta → árvore
 * Mês › natureza › categoria. Fontes, todas já existentes:
 *   - receitas = faturado por mês e tipo de venda (bi.fat_coorte_categoria,
 *     via /api/bi/financeiro) — o mesmo número da aba Recebíveis;
 *   - despesas = saídas da DRE por mês e grupo (bi.dre_saidas, /api/bi/dre);
 *   - a receber / a pagar 30d e em atraso = tit_resumo dos dois lados;
 *   - saldos = bi.saldo_por_conta.
 *
 * As abas Análise, Recebíveis e Fluxo da tela antiga continuam aqui, inteiras
 * (aging, horizonte, emitido × liquidado, maiores contrapartes, concentração
 * do vencido, coorte com drill por tipo e documento, mesa de reagendamento).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import FinanceiroView from "../../bi/FinanceiroView";
import { SegmentedControl, type Tom } from "../primitivos";
import {
  ArvoreNavy, Aviso, CabecalhoTela, Carregando, ChipFiltro, FaixaFiltros, GradeKpis, GraficoLinha,
  MeioTela, PaginaNavy, PainelLateral, brl, brl0, cBarra, cMudo, cTexto, hojeISO, kbrl,
  type Bloco, type ColunaNavy, type Kpi, type NoNavy,
} from "./KitTela";

type Resumo = { saldo_aberto: number; qtd_titulos: number; a_vencer: number; em_atraso: number; esta_semana: number; prox_30_dias: number; total_pago_periodo: number };
type CoorteCat = { mes: string; categoria: string; faturado: number; recebido: number; a_vencer: number; vencido: number; sem_titulo: number; pct_recebido: number | null };
type Fin = { resumo: { sai: Resumo | null; entra: Resumo | null }; coorte_categoria: CoorteCat[]; mensal: { sai: { mes: string; emitido: number; pago: number }[]; entra: { mes: string; emitido: number; pago: number }[] } };
type Dre = { mensal: Array<Record<string, number | string>>; grupos_series: string[]; grupos: { label: string; value: number }[] };
type Conta = { empresa: string; conta: string; saldo: number | string; dt_ultimo: string | null };

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_L = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const m7 = (s: string) => s.slice(0, 7);

type Registro = { mes: string; natureza: "R" | "D"; categoria: string; valor: number; extra?: CoorteCat };

export default function TelaVisaoNavy() {
  const [aba, setAba] = useState<"visao" | "analise" | "recebiveis" | "fluxo">("visao");
  return (
    <PaginaNavy>
      <CabecalhoTela area="Financeiro" titulo="Visão financeira"
        sub="Receitas (faturado, bi.fat_coorte_categoria) × despesas (saídas da DRE, bi.dre_saidas) · em aberto de tit_resumo · saldos de bi.saldo_por_conta · recebe Safe, paga Safe + CDG + Water"
        acoes={<SegmentedControl value={aba} onChange={(v) => setAba(v as typeof aba)} options={[
          { value: "visao", label: "Visão" }, { value: "analise", label: "Análise" },
          { value: "recebiveis", label: "Recebíveis" }, { value: "fluxo", label: "Fluxo" },
        ]} />} />
      {aba === "visao" ? <Visao /> : <FinanceiroView key={aba} abaInicial={aba} />}
    </PaginaNavy>
  );
}

function Visao() {
  const [meses, setMeses] = useState(6);
  const [fin, setFin] = useState<Fin | null>(null);
  const [dre, setDre] = useState<Dre | null>(null);
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = hojeISO();
  const from = useMemo(() => {
    const d = new Date(hoje.slice(0, 8) + "01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - (meses - 1));
    return d.toISOString().slice(0, 10);
  }, [hoje, meses]);

  const load = useCallback(async () => {
    setFin(null); setDre(null); setErro(null);
    try {
      const [a, b, c] = await Promise.all([
        fetch(`/api/bi/financeiro?from=${from}&to=${hoje}`, { cache: "no-store" }),
        fetch(`/api/bi/dre?from=${from}&to=${hoje}`, { cache: "no-store" }),
        fetch(`/api/financeiro/extratos?so_contas=1`, { cache: "no-store" }),
      ]);
      const [ja, jb, jc] = await Promise.all([a.json(), b.json(), c.json()]);
      if (!a.ok) throw new Error(ja.error ?? a.statusText);
      if (!b.ok) throw new Error(jb.error ?? b.statusText);
      setFin(ja); setDre(jb); setContas(c.ok ? jc.contas : []);
    } catch (e) { setErro((e as Error).message); }
  }, [from, hoje]);
  useEffect(() => { void load(); }, [load]);

  const registros: Registro[] = useMemo(() => {
    if (!fin || !dre) return [];
    const r: Registro[] = fin.coorte_categoria.map((c) => ({ mes: m7(c.mes), natureza: "R" as const, categoria: c.categoria, valor: num(c.faturado), extra: c }));
    for (const linha of dre.mensal) {
      const mes = m7(String(linha.x));
      for (const g of dre.grupos_series) { const v = num(linha[g]); if (v) r.push({ mes, natureza: "D", categoria: g, valor: v }); }
    }
    return r.filter((x) => x.mes >= m7(from));
  }, [fin, dre, from]);

  const mesesLista = useMemo(() => {
    const out: string[] = []; const d = new Date(from + "T12:00:00Z");
    while (d.toISOString().slice(0, 7) <= hoje.slice(0, 7)) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() + 1); }
    return out;
  }, [from, hoje]);

  if (erro) return <Aviso>{erro}</Aviso>;
  if (!fin || !dre) return <Carregando />;

  const tot = (mes: string, n: "R" | "D") => registros.filter((x) => x.mes === mes && x.natureza === n).reduce((s, x) => s + x.valor, 0);
  const rec = mesesLista.map((m) => tot(m, "R")), des = mesesLista.map((m) => tot(m, "D"));
  const atual = hoje.slice(0, 7), ri = rec[rec.length - 1] ?? 0, di = des[des.length - 1] ?? 0, res = ri - di;
  const margem = ri > 0 ? (res / ri) * 100 : null;
  const E = fin.resumo.entra, S = fin.resumo.sai;
  const cs = (contas ?? []).filter((c) => num(c.saldo) !== 0);
  const saldoTotal = cs.reduce((s, c) => s + num(c.saldo), 0);

  const kpis: Kpi[] = [
    { rotulo: "Saldo bancário", valor: kbrl(saldoTotal), sub: `${cs.length} contas com saldo · 3 empresas`, hero: true, title: brl(saldoTotal) },
    { rotulo: "A receber 30d", valor: kbrl(num(E?.prox_30_dias)), sub: `em aberto ${kbrl(num(E?.saldo_aberto))} · ${num(E?.qtd_titulos).toLocaleString("pt-BR")} títulos`, subTom: "ok" },
    { rotulo: "A pagar 30d", valor: kbrl(num(S?.prox_30_dias)), sub: `em aberto ${kbrl(num(S?.saldo_aberto))} · ${num(S?.qtd_titulos).toLocaleString("pt-BR")} títulos`, subTom: "crit" },
    { rotulo: `Resultado ${MESES_L[Number(atual.slice(5, 7)) - 1].toLowerCase()}`, valor: kbrl(res), title: brl(res),
      sub: margem == null ? "sem receita no mês" : `margem ${margem.toFixed(1).replace(".", ",")}% · mês em curso`,
      barra: margem == null ? undefined : { pct: Math.max(0, Math.min(100, margem * 3)), tom: (res < 0 ? "crit" : margem < 10 ? "warn" : "ok") as Tom } },
    { rotulo: "Em atraso", valor: kbrl(num(E?.em_atraso)), sub: `a receber · a pagar ${kbrl(num(S?.em_atraso))}`, subTom: "warn" },
  ];

  const mxC = Math.max(1, ...cs.map((c) => Math.abs(num(c.saldo))));
  const lado: Bloco[] = [
    ...[...cs].sort((a, b) => num(b.saldo) - num(a.saldo)).slice(0, 8).map((c) => ({
      k: "m" as const, rotulo: `${c.empresa} · ${c.conta}`, valor: kbrl(num(c.saldo)), pct: (Math.abs(num(c.saldo)) / mxC) * 100,
      tom: (num(c.saldo) < 0 ? "crit" : "info") as Tom, title: brl(num(c.saldo)) })),
    { k: "t", t: `Total ${brl(saldoTotal)}${cs.length > 8 ? ` · ${cs.length - 8} outras contas na Conciliação` : ""}` },
  ];

  return (<>
    <FaixaFiltros>
      {[[6, "6 meses"], [12, "12 meses"], [Number(hoje.slice(5, 7)), "Ano"]].map(([n, l]) => (
        <ChipFiltro key={String(l)} ativo={meses === n} onClick={() => setMeses(Number(n))}>{l}</ChipFiltro>
      ))}
    </FaixaFiltros>
    <GradeKpis kpis={kpis} min={185} />
    <MeioTela
      grafico={<GraficoLinha titulo="Receitas × despesas por mês" formatar={brl0}
        rotulos={mesesLista.map((m) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`)}
        series={[
          { nome: "Receitas", cor: "var(--ww-brand-3)", largura: 3, vals: rec },
          { nome: "Despesas", cor: "var(--ww-crit)", tracejado: "5 4", vals: des },
          { nome: "Resultado", cor: "var(--ww-brand-2)", vals: rec.map((r, i) => r - des[i]) },
        ]} />}
      lado={<PainelLateral titulo="Saldos por conta" blocos={lado} />} />
    <Arvore registros={registros} mesesLista={mesesLista} />
  </>);
}

function Arvore({ registros, mesesLista }: { registros: Registro[]; mesesLista: string[] }) {
  const colunas: ColunaNavy<Registro>[] = [
    { label: "Mês › natureza › categoria" },
    { label: "Receitas", align: "right", texto: (r) => (r.natureza === "R" ? brl0(r.valor) : ""), numero: (r) => (r.natureza === "R" ? r.valor : null) },
    { label: "Despesas", align: "right", texto: (r) => (r.natureza === "D" ? brl0(r.valor) : ""), numero: (r) => (r.natureza === "D" ? r.valor : null) },
    { label: "Resultado", align: "right", filtravel: false },
    { label: "Margem / recebido", filtravel: false },
  ];
  const montar = useCallback((rs: Registro[]): NoNavy[] => [...mesesLista].reverse().map((m) => {
    const doMes = rs.filter((r) => r.mes === m);
    const R = doMes.filter((r) => r.natureza === "R"), D = doMes.filter((r) => r.natureza === "D");
    const sr = R.reduce((s, r) => s + r.valor, 0), sd = D.reduce((s, r) => s + r.valor, 0), res = sr - sd;
    const pc = sr > 0 ? Math.round((res / sr) * 100) : null;
    const [y, mm] = m.split("-");
    return {
      id: `m:${m}`, nome: `${MESES_L[Number(mm) - 1]} ${y}`, sub: m === hojeISO().slice(0, 7) ? "mês corrente" : undefined,
      cels: [cTexto(kbrl(sr), { tom: "ok", peso: 600 }), cTexto(kbrl(sd), { tom: "crit", peso: 600 }),
        cTexto(kbrl(res), { tom: res < 0 ? "crit" : undefined, peso: 700 }),
        pc == null ? cMudo("—") : cBarra(`${pc}%`, Math.max(3, Math.min(100, Math.abs(pc) * 3)), res < 0 ? "crit" : pc < 10 ? "warn" : "ok")],
      filhos: [
        ...(R.length ? [{
          id: `m:${m}:R`, nome: "Receitas", sub: `${R.length} tipos de venda · faturado`,
          cels: [cTexto(brl0(sr), { peso: 600 }), cMudo(""), cMudo(""), cMudo("")],
          filhos: [...R].sort((a, b) => b.valor - a.valor).map((r) => ({
            id: `m:${m}:R:${r.categoria}`, nome: r.categoria,
            sub: r.extra ? `recebido ${brl0(num(r.extra.recebido))} · a vencer ${brl0(num(r.extra.a_vencer))} · vencido ${brl0(num(r.extra.vencido))}${num(r.extra.sem_titulo) ? ` · sem título ${brl0(num(r.extra.sem_titulo))}` : ""}` : undefined,
            cels: [cTexto(brl0(r.valor)), cMudo(""), cMudo(""),
              r.extra?.pct_recebido != null ? cBarra(`${num(r.extra.pct_recebido)}% recebido`, num(r.extra.pct_recebido), num(r.extra.pct_recebido) >= 90 ? "ok" : "warn") : cMudo("")],
          })),
        }] : []),
        ...(D.length ? [{
          id: `m:${m}:D`, nome: "Despesas", sub: `${D.length} grupos da DRE`,
          cels: [cMudo(""), cTexto(brl0(sd), { peso: 600 }), cMudo(""), cMudo("")],
          filhos: [...D].sort((a, b) => b.valor - a.valor).map((r) => ({
            id: `m:${m}:D:${r.categoria}`, nome: r.categoria,
            cels: [cMudo(""), cTexto(brl0(r.valor)), cMudo(""), cBarra(sd ? `${Math.round((r.valor / sd) * 100)}% das despesas` : "", sd ? (r.valor / sd) * 100 : 0, "info")],
          })),
        }] : []),
      ],
    };
  }), [mesesLista]);
  return <ArvoreNavy titulo="Mês › natureza › categoria" dica="Resultado = faturado − saídas da DRE do mês · receitas abrem por tipo de venda com o destino do recebível"
    colunas={colunas} registros={registros} montar={montar} abertosIniciais={[`m:${hojeISO().slice(0, 7)}`, `m:${hojeISO().slice(0, 7)}:R`]}
    grid="minmax(280px,1.8fr) repeat(3,minmax(120px,1fr)) 190px" minWidth={1000} buscaNome={(r) => r.categoria} />;
}
