"use client";

/**
 * Margem por Projeto · Margem por Venda · Cadeia de Compras — recriação Navy.
 *
 * Mesmas rotas e mesmos números das telas antigas (/api/bi/margem-projeto,
 * /api/bi/margem-venda, /api/bi/compras-cadeia). Tudo o que elas tinham fica:
 * avisos de cobertura, KPIs, rankings, distribuição por faixa, alarmes
 * clicáveis, resumo da seleção de clientes, e todas as tabelas — que viram
 * árvores com filtro por coluna, CSV e, na cadeia, TODOS os campos da RPC no
 * controlo Colunas (a tela antiga mostrava 14 de 28).
 *
 * Do modelo: o esqueleto, a barra de M% e a árvore Projeto › … . O modelo abre
 * cada projeto em "origem" (NFs, PCs, títulos); a RPC devolve o total por
 * projeto, sem essa quebra — fica o agrupamento pela situação da margem.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FAIXAS_SEM_MARGEM, faixaDeValores } from "@/lib/margem";
import { SegmentedControl, type Tom } from "../primitivos";
import {
  ArvoreNavy, Aviso, CabecalhoTela, CampoData, Carregando, ChipFiltro, FaixaFiltros, GradeKpis,
  GraficoBarras, MeioTela, PaginaNavy, PainelLateral, SeletorColunas, brl0, cBarra, cMudo, cPill, cTexto,
  ddmmaa, hojeISO, kbrl, somaDias, useColunasEscolhidas, type ColunaNavy, type Kpi, type NoNavy,
} from "./KitTela";

const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const EMPRESAS = ["SF", "CD", "WW"];
const CATS = ["Avulsos", "Contratuais", "Projetos", "Revenda", "BOT/SW", "Outras"];
const pct1 = (v: number | null | undefined) => (v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

function usePeriodo() {
  const h = hojeISO();
  const [p, setP] = useState<"ytd" | "m12" | "mes" | "livre">("ytd");
  const [de, setDe] = useState(h.slice(0, 4) + "-01-01");
  const [ate, setAte] = useState(h);
  const [from, to] = p === "ytd" ? [h.slice(0, 4) + "-01-01", h] : p === "m12" ? [somaDias(h, -365), h] : p === "mes" ? [h.slice(0, 8) + "01", h] : [de, ate];
  const chips = (<>
    {([["ytd", "Ano até hoje"], ["m12", "12 meses"], ["mes", "Mês corrente"], ["livre", "De / Até"]] as const).map(([k, l]) => (
      <ChipFiltro key={k} ativo={p === k} onClick={() => setP(k)}>{l}</ChipFiltro>))}
    {p === "livre" && (<><CampoData valor={de} onChange={setDe} /><CampoData valor={ate} onChange={setAte} /></>)}
  </>);
  return { from, to, chips };
}
function Multi({ opcoes, sel, set }: { opcoes: string[]; sel: string[]; set: (v: string[]) => void }) {
  return <>{opcoes.map((o) => <ChipFiltro key={o} ativo={sel.includes(o)} onClick={() => set(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o])}>{o}</ChipFiltro>)}</>;
}

/** Coluna tipada: o mesmo tipo desenha a célula, alimenta o filtro e ordena. */
type Tipo = "txt" | "data" | "money" | "dias" | "num" | "pct";
type Spec<R> = { key: keyof R & string; label: string; tipo?: Tipo; tom?: (v: string) => Tom; grupo?: string; w?: string };
const texto = <R,>(s: Spec<R>, r: R) => {
  const v = (r as Record<string, unknown>)[s.key];
  if (v == null || v === "") return "—";
  switch (s.tipo) {
    case "data": return ddmmaa(String(v).slice(0, 10));
    case "money": return brl0(n(v));
    case "dias": return `${v}d`;
    case "pct": return pct1(n(v));
    default: return String(v);
  }
};
const numero = <R,>(s: Spec<R>) => (s.tipo && s.tipo !== "txt")
  ? (r: R) => { const v = (r as Record<string, unknown>)[s.key]; return v == null ? null : s.tipo === "data" ? Date.parse(String(v)) : n(v); }
  : undefined;
const direita = (t?: Tipo) => t === "money" || t === "dias" || t === "num" || t === "pct";
const colunasDe = <R,>(nome: string, specs: Spec<R>[]): ColunaNavy<R>[] =>
  [{ label: nome }, ...specs.map((s) => ({ label: s.label, align: direita(s.tipo) ? "right" as const : undefined, texto: (r: R) => texto(s, r), numero: numero(s) }))];
const gridDe = <R,>(specs: Spec<R>[], primeira = "minmax(240px,1.6fr)") =>
  primeira + " " + specs.map((s) => s.w ?? (s.tipo === "money" ? "112px" : s.tipo === "data" ? "88px" : s.tipo && s.tipo !== "txt" ? "80px" : "minmax(110px,1fr)")).join(" ");
const celula = <R,>(s: Spec<R>, r: R): ReactNode => {
  const t = texto(s, r);
  if (t === "—") return cMudo("—");
  if (s.tom) return cPill(t, s.tom(t));
  const v = n((r as Record<string, unknown>)[s.key]);
  if (s.tipo === "money" && v < 0) return cTexto(t, { tom: "crit", peso: 600 });
  return cTexto(t, { cor: direita(s.tipo) ? undefined : "var(--ww-text-2)" });
};
const somaCels = <R,>(specs: Spec<R>[], l: R[]) => specs.map((s) => (s.tipo === "money"
  ? cTexto(brl0(l.reduce((a, r) => a + n((r as Record<string, unknown>)[s.key]), 0)), { peso: 700 }) : cMudo("")));

// ── Margem por Projeto ──────────────────────────────────────────────────────
type Proj = { projeto: string; receita: number; custo: number; margem: number; margem_pct: number | null; tem_custo: boolean };
type ProjPayload = { margem_total: number; projetos: Proj[]; prejuizo: Proj[]; total_projetos: number;
  sem_custo: { projetos: Proj[]; total: number; receita: number };
  cobertura: { titulos: number; titulos_com_projeto: number; valor: number; valor_com_projeto: number; pct_valor: number | null } | null };

export function TelaMargemProjetoNavy() {
  const per = usePeriodo();
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [media, setMedia] = useState(false);
  const [data, setData] = useState<ProjPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setErr(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ from: per.from, to: per.to });
        if (empresas.length) qs.set("empresas", empresas.join(","));
        if (media) qs.set("media", "1");
        const r = await fetch(`/api/bi/margem-projeto?${qs}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setData(j);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [per.from, per.to, empresas, media]);

  const cab = <CabecalhoTela area="BI" titulo="Margem por Projeto" sub="Receita (itens vendidos + OS faturadas) × títulos a pagar com código de projeto (bi.margem_por_projeto) · cobertura de bi.cobertura_custo_projeto" />;
  const filtros = <FaixaFiltros>{per.chips}<Multi opcoes={EMPRESAS} sel={empresas} set={setEmpresas} />
    <ChipFiltro ativo={media} onClick={() => setMedia((v) => !v)}>Média mensal</ChipFiltro></FaixaFiltros>;
  if (err) return <PaginaNavy>{cab}{filtros}<Aviso>{err}</Aviso></PaginaNavy>;
  if (!data) return <PaginaNavy>{cab}{filtros}<Carregando /></PaginaNavy>;

  const receitaCom = data.projetos.reduce((a, p) => a + p.receita, 0), margemCom = data.projetos.reduce((a, p) => a + p.margem, 0);
  const mPct = receitaCom > 0 ? (margemCom / receitaCom) * 100 : null;
  const kpis: Kpi[] = [
    { rotulo: media ? "Margem — média mensal" : "Margem total no período", valor: kbrl(data.margem_total), hero: true, sub: "receita − títulos a pagar, total da empresa" },
    { rotulo: "Margem dos projetos com custo", valor: pct1(mPct), sub: `${kbrl(margemCom)} de ${kbrl(receitaCom)}`, barra: mPct == null ? undefined : { pct: Math.max(0, mPct), tom: mPct < 0 ? "crit" : mPct < 25 ? "warn" : "ok" } },
    { rotulo: "Com custo vinculado", valor: String(data.total_projetos), sub: "os únicos em que a margem é calculável" },
    { rotulo: "Sem custo vinculado", valor: String(data.sem_custo.total), sub: `${kbrl(data.sem_custo.receita)} de receita sem contrapartida`, subTom: "warn" },
    { rotulo: "No prejuízo", valor: String(data.prejuizo.length), sub: data.prejuizo[0] ? `pior: ${data.prejuizo[0].projeto}` : "nenhum", subTom: data.prejuizo.length ? "crit" : "ok" },
  ];
  const top = data.projetos.slice(0, 15);
  const semC = data.sem_custo.projetos.slice(0, 15), mxS = Math.max(1, ...semC.map((p) => p.receita));
  const todos: (Proj & { grupo: string })[] = [
    ...data.projetos.map((p) => ({ ...p, grupo: p.margem < 0 ? "No prejuízo" : "Com margem" })),
    ...data.sem_custo.projetos.map((p) => ({ ...p, grupo: "Sem custo vinculado" })),
  ];
  const colunas: ColunaNavy<Proj & { grupo: string }>[] = [
    { label: "Situação › projeto" },
    { label: "Receita", align: "right", texto: (p) => brl0(p.receita), numero: (p) => p.receita },
    { label: "Custo", align: "right", texto: (p) => brl0(p.custo), numero: (p) => p.custo },
    { label: "Margem", align: "right", texto: (p) => brl0(p.margem), numero: (p) => p.margem },
    { label: "M%", texto: (p) => pct1(p.margem_pct), numero: (p) => p.margem_pct },
  ];
  const ordem = ["No prejuízo", "Com margem", "Sem custo vinculado"];
  const montar = (ps: (Proj & { grupo: string })[]): NoNavy[] => ordem.map((g) => {
    const l = ps.filter((p) => p.grupo === g); if (!l.length) return null;
    const r = l.reduce((a, p) => a + p.receita, 0), c = l.reduce((a, p) => a + p.custo, 0), m = l.reduce((a, p) => a + p.margem, 0);
    return { id: `g:${g}`, nome: g, sub: `${l.length} projeto${l.length === 1 ? "" : "s"}${g === "Sem custo vinculado" ? " · margem desconhecida, não lucro" : ""}`,
      cels: [cTexto(brl0(r), { peso: 700 }), cTexto(brl0(c), { peso: 600 }), cTexto(brl0(m), { peso: 700, tom: m < 0 ? "crit" : undefined }),
        g === "Sem custo vinculado" || !r ? cMudo("—") : cBarra(pct1((m / r) * 100), Math.max(3, Math.min(100, Math.abs((m / r) * 100) * 2)), m < 0 ? "crit" : "ok")],
      filhos: l.map((p) => ({ id: `p:${g}:${p.projeto}`, nome: p.projeto, cels: [cTexto(brl0(p.receita)), p.tem_custo ? cTexto(brl0(p.custo)) : cPill("sem custo", "warn"),
        cTexto(brl0(p.margem), { tom: p.margem < 0 ? "crit" : undefined, peso: 600 }),
        p.margem_pct == null || !p.tem_custo ? cMudo("—") : cBarra(pct1(p.margem_pct), Math.max(3, Math.min(100, Math.abs(p.margem_pct) * 2)), p.margem_pct < 0 ? "crit" : p.margem_pct < 25 ? "warn" : "ok")] })),
    } as NoNavy;
  }).filter((x): x is NoNavy => !!x);

  return (
    <PaginaNavy>
      {cab}{filtros}
      {data.sem_custo.total > 0 && <Aviso tone="warn"><b>{data.sem_custo.total} projetos sem custo vinculado</b> ({brl0(data.sem_custo.receita)} de receita) estão fora dos rankings.
        {data.cobertura?.pct_valor != null && <> Apenas <b>{String(data.cobertura.pct_valor).replace(".", ",")}%</b> do valor a pagar do período carrega código de projeto ({brl0(data.cobertura.valor_com_projeto)} de {brl0(data.cobertura.valor)}; {data.cobertura.titulos_com_projeto} de {data.cobertura.titulos} títulos).</>}
        {" "}Sem título a pagar apontando pro projeto, a margem dele seria a receita inteira — cadastro faltando, não lucro.</Aviso>}
      <GradeKpis kpis={kpis} min={190} />
      <MeioTela
        grafico={<GraficoBarras titulo="Margem por projeto — 15 maiores (com custo vinculado)" legenda={[{ nome: "Receita", cor: "var(--ww-brand-3)" }, { nome: "Custo", cor: "var(--ww-crit)" }]} agrupado
          colunas={top.map((p) => ({ rotulo: p.projeto.split(" ")[0], title: `${p.projeto} · receita ${brl0(p.receita)} · custo ${brl0(p.custo)} · margem ${brl0(p.margem)} (${pct1(p.margem_pct)})`,
            topo: pct1(p.margem_pct), topoCor: (p.margem_pct ?? 0) < 0 ? "var(--ww-crit-text)" : "var(--ww-accent-text)",
            segs: [{ v: p.receita, cor: "var(--ww-brand-3)" }, { v: p.custo, cor: "var(--ww-crit)" }] }))} />}
        lado={<PainelLateral titulo="Sem custo vinculado — maiores por receita" blocos={[
          ...semC.map((p) => ({ k: "m" as const, rotulo: p.projeto, valor: kbrl(p.receita), pct: (p.receita / mxS) * 100, tom: "warn" as Tom })),
          { k: "t" as const, t: "Onde ligar custo renderia mais informação: é aqui que a margem desconhecida custa mais caro." }]} />} />
      <ArvoreNavy titulo="Situação › projeto" dica={`${data.projetos.length} projetos com custo vinculado · sem custo: ${data.sem_custo.projetos.length} de ${data.sem_custo.total} listados (a rota devolve os maiores por receita)`}
        colunas={colunas} registros={todos} montar={montar} abertosIniciais={["g:No prejuízo"]} grid="minmax(300px,2fr) repeat(3,minmax(120px,1fr)) 170px" minWidth={1000}
        buscaNome={(p) => p.projeto} rodape={(ps) => <span>{ps.length} projetos · receita <b style={{ color: "var(--ww-text)" }}>{brl0(ps.reduce((a, p) => a + p.receita, 0))}</b></span>} />
    </PaginaNavy>
  );
}

// ── Margem por Venda ────────────────────────────────────────────────────────
type LinhaV = { pv_os: string; dt_fat: string | null; documento: string; cliente: string; categoria: string; projeto: string;
  receita: number; custo_compra: number | null; margem: number | null; margem_pct: number | null; tem_custo: boolean; exige_custo: boolean;
  qtd_pcs: number; fornecedores: string; faixa: string; faixa_ord: number; tipo_omie: string; dt_emissao: string | null };
type VendaPayload = { base: string; falta_custo: { vendas: number; receita: number; de: number }; tipos: string[];
  total: { vendas: number; receita: number; receita_medida: number; custo_medido: number; margem_medida: number; cobertura_pct: number };
  faixas: Array<{ faixa: string; vendas: number; receita: number; custo: number; margem: number }>; linhas: LinhaV[] };
const TOM_F: Record<string, Tom> = { "Negativa": "crit", "Sem custo lançado": "crit", "0–15%": "crit", "15–25%": "warn", "25–35%": "warn", "> 35%": "ok", "Serviço (sem compra)": "off", "Sem receita": "off" };
const SPECS_V: Spec<LinhaV>[] = [
  { key: "dt_emissao", label: "Emissão", tipo: "data" }, { key: "dt_fat", label: "Dt. NF", tipo: "data" },
  { key: "documento", label: "Documento" }, { key: "tipo_omie", label: "Tipo", tom: (v) => (v === "Serviço" ? "off" : v === "(sem tipo)" ? "warn" : "ok"), w: "100px" },
  { key: "categoria", label: "Categoria" }, { key: "cliente", label: "Cliente", w: "minmax(170px,1.3fr)" }, { key: "projeto", label: "Projeto" },
  { key: "receita", label: "Receita", tipo: "money" }, { key: "custo_compra", label: "Custo compra", tipo: "money", w: "118px" },
  { key: "margem", label: "Margem", tipo: "money" }, { key: "margem_pct", label: "%", tipo: "pct", w: "72px" },
  { key: "qtd_pcs", label: "PCs", tipo: "num", w: "58px" }, { key: "fornecedores", label: "Fornecedores", w: "minmax(180px,1.3fr)" },
];

export function TelaMargemVendaNavy() {
  const per = usePeriodo();
  const [cats, setCats] = useState<string[]>([]);
  const [base, setBase] = useState<"emissao" | "faturamento">("emissao");
  const [faixaSel, setFaixaSel] = useState<string | null>(null);
  const [tipos, setTipos] = useState<string[]>([]);
  const [clientes, setClientes] = useState<string[]>([]);
  const [data, setData] = useState<VendaPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null); setErr(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ from: per.from, to: per.to, base });
        if (cats.length) qs.set("cat", cats.join(","));
        const r = await fetch(`/api/bi/margem-venda?${qs}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setData(j);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [per.from, per.to, cats, base]);

  const linhas = useMemo(() => (data?.linhas ?? []).filter((l) => (!faixaSel || l.faixa === faixaSel) && (!tipos.length || tipos.includes(l.tipo_omie)) && (!clientes.length || clientes.includes(l.cliente))), [data, faixaSel, tipos, clientes]);
  const clientesOp = useMemo(() => [...new Set((data?.linhas ?? []).map((l) => l.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [data]);
  const ranking = useMemo(() => {
    const acc = new Map<string, { receita: number; custo: number; margem: number }>();
    for (const l of data?.linhas ?? []) {
      if (!l.tem_custo || (tipos.length && !tipos.includes(l.tipo_omie)) || (clientes.length && !clientes.includes(l.cliente))) continue;
      const k = l.cliente || "(sem cliente)", a = acc.get(k) ?? { receita: 0, custo: 0, margem: 0 };
      a.receita += n(l.receita); a.custo += n(l.custo_compra); a.margem += n(l.margem); acc.set(k, a);
    }
    return [...acc.entries()].filter(([, a]) => a.receita > 0).map(([c, a]) => ({ c, ...a, pct: (a.margem / a.receita) * 100, faixa: faixaDeValores(a.receita, a.custo, true) }))
      .sort((p, q) => q.pct - p.pct).slice(0, 15);
  }, [data, tipos, clientes]);

  const cab = <CabecalhoTela area="Financeiro" titulo="Margem por Venda" sub="Receita do PV/OS − custo dos pedidos de compra ligados a ele (/api/bi/margem-venda) · despesas por cliente estão em Custo por cliente" />;
  const filtros = <FaixaFiltros>{per.chips}<Multi opcoes={CATS} sel={cats} set={setCats} />
    <SegmentedControl value={base} onChange={(v) => setBase(v as typeof base)} options={[{ value: "emissao", label: "Emissão PV/OS" }, { value: "faturamento", label: "Faturamento" }]} />
    {(data?.tipos ?? []).length > 0 && <Multi opcoes={data!.tipos} sel={tipos} set={setTipos} />}</FaixaFiltros>;
  if (err) return <PaginaNavy>{cab}{filtros}<Aviso>{err}</Aviso></PaginaNavy>;
  if (!data) return <PaginaNavy>{cab}{filtros}<Carregando /></PaginaNavy>;

  const t = data.total, fx = data.faixas, f = (k: string) => fx.find((x) => x.faixa === k);
  const neg = f("Negativa"), baixa = f("0–15%"), falta = f("Sem custo lançado"), serv = f("Serviço (sem compra)");
  const mMed = t.receita_medida > 0 ? (t.margem_medida / t.receita_medida) * 100 : null;
  const kpis: Kpi[] = [
    { rotulo: "Vendas no período", valor: String(t.vendas), sub: kbrl(t.receita), hero: true },
    { rotulo: "Margem média", valor: pct1(mMed), sub: "só das vendas com custo medido", barra: mMed == null ? undefined : { pct: Math.max(0, mMed), tom: mMed < 15 ? "crit" : mMed < 35 ? "warn" : "ok" } },
    { rotulo: "Resultado medido", valor: kbrl(t.margem_medida), sub: `${kbrl(t.receita_medida)} − ${kbrl(t.custo_medido)} de custo` },
    { rotulo: "Falta custo", valor: String(data.falta_custo.vendas), sub: `de ${data.falta_custo.de} que exigem compra · ${kbrl(data.falta_custo.receita)}`, subTom: "crit", onClick: () => setFaixaSel("Sem custo lançado") },
    { rotulo: "Cobertura", valor: pct1(t.cobertura_pct), sub: "da receita com custo medido" },
  ];
  const ESC = ["Negativa", "0–15%", "15–25%", "25–35%", "> 35%"];
  const sel = (() => {
    if (!clientes.length) return null;
    const med = linhas.filter((l) => l.tem_custo), r = med.reduce((a, l) => a + n(l.receita), 0), m = med.reduce((a, l) => a + n(l.margem), 0);
    return { vendas: linhas.length, med: med.length, r, m, p: r > 0 ? (m / r) * 100 : null };
  })();
  const faixaRank = (p: number): Tom => (p < 15 ? "crit" : p < 35 ? "warn" : "info");
  const montar = (ls: LinhaV[]): NoNavy[] => {
    const g = new Map<string, LinhaV[]>();
    for (const l of ls) (g.get(l.faixa) ?? g.set(l.faixa, []).get(l.faixa)!).push(l);
    return [...g.entries()].sort((a, b) => (a[1][0].faixa_ord ?? 0) - (b[1][0].faixa_ord ?? 0)).map(([fa, l]) => ({
      id: `f:${fa}`, nome: fa, sub: `${l.length} venda${l.length === 1 ? "" : "s"}`, cels: somaCels(SPECS_V, l),
      filhos: [...l].sort((a, b) => n(a.margem) - n(b.margem)).map((x, i) => ({ id: `v:${fa}:${x.pv_os}:${i}`, nome: x.pv_os, sub: x.cliente, cels: SPECS_V.map((s) => celula(s, x)) })),
    }));
  };

  return (
    <PaginaNavy>
      {cab}{filtros}
      {(neg || baixa || falta) && <Aviso tone="crit">
        {neg && <div><button type="button" onClick={() => setFaixaSel("Negativa")} style={alarme}>{neg.vendas} venda(s) abaixo do custo — prejuízo de {brl0(Math.abs(neg.margem))}</button></div>}
        {baixa && <div><button type="button" onClick={() => setFaixaSel("0–15%")} style={alarme}>{baixa.vendas} com margem abaixo de 15%</button></div>}
        {falta && <div><button type="button" onClick={() => setFaixaSel("Sem custo lançado")} style={alarme}>{falta.vendas} Mix/Mercantil sem compra ligada — {brl0(falta.receita)} sem custo apurado</button></div>}
        <div style={{ fontSize: 11.5, opacity: 0.8, marginTop: 4 }}>Clique num alarme para filtrar a lista.{serv ? ` As ${serv.vendas} de Serviço puro ficam fora: pela regra, não geram compra.` : ""}</div>
      </Aviso>}
      <GradeKpis kpis={kpis} min={180} />
      <FaixaFiltros>
        <ChipFiltro ativo={!faixaSel} onClick={() => setFaixaSel(null)}>Todas ({data.linhas.length})</ChipFiltro>
        {fx.map((x) => <ChipFiltro key={x.faixa} ativo={faixaSel === x.faixa} onClick={() => setFaixaSel(faixaSel === x.faixa ? null : x.faixa)}>
          {x.faixa}: {x.vendas}{!FAIXAS_SEM_MARGEM.has(x.faixa) ? ` · ${kbrl(x.margem)}` : ""}</ChipFiltro>)}
      </FaixaFiltros>
      <MeioTela
        grafico={<GraficoBarras titulo="Distribuição das margens · vendas com custo medido" colunas={ESC.map((e) => {
          const x = f(e); return { rotulo: e, topo: String(x?.vendas ?? 0), title: `${e} · ${x?.vendas ?? 0} vendas · receita ${brl0(n(x?.receita))}`, onClick: () => setFaixaSel(e),
            segs: [{ v: x?.vendas ?? 0, cor: TOM_F[e] === "crit" ? "var(--ww-crit)" : TOM_F[e] === "warn" ? "var(--ww-warn)" : "var(--ww-brand-3)" }] };
        })} />}
        lado={<PainelLateral titulo="Clientes por faixa de margem" extra={<SeletorClientes op={clientesOp} sel={clientes} set={setClientes} />}
          blocos={ranking.map((r) => ({ k: "m", rotulo: r.c, valor: pct1(r.pct), pct: Math.max(2, Math.min(100, r.pct)), tom: faixaRank(r.pct), title: `receita ${brl0(r.receita)} · custo ${brl0(r.custo)} · ${r.faixa}` }))} />} />
      {sel && <Aviso tone="info"><b>{clientes.length === 1 ? clientes[0] : `${clientes.length} clientes`}</b> · {sel.vendas} vendas ({sel.med} com custo medido) · receita medida {brl0(sel.r)} · margem {brl0(sel.m)} · margem média <b>{pct1(sel.p)}</b> ponderada pela receita
        {" "}<button type="button" onClick={() => setClientes([])} style={{ ...alarme, textDecoration: "underline", marginLeft: 8 }}>limpar seleção</button></Aviso>}
      <ArvoreNavy titulo={clientes.length === 1 ? `Vendas — ${clientes[0]}` : faixaSel ? `Vendas — ${faixaSel}` : "Faixa de margem › venda"}
        dica="Ordenado pela pior margem · o custo é o dos pedidos de compra ligados àquele PV/OS"
        colunas={colunasDe("Faixa › PV/OS", SPECS_V)} registros={linhas} montar={montar} grid={gridDe(SPECS_V, "minmax(200px,1.3fr)")} minWidth={1700}
        abertosIniciais={["f:Negativa"]} buscaNome={(l) => `${l.pv_os} ${l.cliente}`} chave={`${faixaSel}|${clientes.join()}`}
        rodape={(ls) => <span>{ls.length} vendas · receita <b style={{ color: "var(--ww-text)" }}>{brl0(ls.reduce((a, l) => a + n(l.receita), 0))}</b> · custo {brl0(ls.reduce((a, l) => a + n(l.custo_compra), 0))} · margem {brl0(ls.reduce((a, l) => a + n(l.margem), 0))}</span>} />
      <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>Margem aqui é receita menos custo de compra. Despesas operacionais, combustível e mão de obra existem por cliente e mês, não por venda — ratear por NF inventaria precisão que o dado não tem. Esses custos estão em Custo por cliente.</div>
    </PaginaNavy>
  );
}
const alarme = { background: "none", border: 0, padding: 0, color: "inherit", font: "inherit", fontWeight: 600, cursor: "pointer", textAlign: "left" as const };

function SeletorClientes({ op, sel, set }: { op: string[]; sel: string[]; set: (v: string[]) => void }) {
  const [aberto, setAberto] = useState(false), [q, setQ] = useState("");
  return (
    <div style={{ position: "relative" }}>
      <button type="button" onClick={() => setAberto((v) => !v)} style={{ height: 26, padding: "0 10px", borderRadius: 8, fontSize: 11.5, cursor: "pointer", background: "transparent",
        border: "1px solid " + (sel.length ? "var(--ww-brand-3)" : "var(--ww-border-strong)"), color: sel.length ? "var(--ww-accent-text)" : "var(--ww-text-2)" }}>Cliente{sel.length ? ` · ${sel.length}` : ""}</button>
      {aberto && (<>
        <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setAberto(false)} />
        <div style={{ position: "absolute", right: 0, top: "100%", marginTop: 6, zIndex: 40, width: 320, maxHeight: 380, overflow: "auto", padding: 10, borderRadius: 12,
          background: "var(--ww-panel)", border: "1px solid var(--ww-border-strong)", boxShadow: "var(--shadow-float)" }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente…" style={{ width: "100%", height: 30, marginBottom: 6, padding: "0 10px", borderRadius: 8,
            border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)", font: "inherit", fontSize: 12.5 }} />
          {op.filter((c) => c.toLowerCase().includes(q.toLowerCase())).slice(0, 200).map((c) => (
            <label key={c} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, padding: "3px 2px", color: "var(--ww-text-2)", cursor: "pointer" }}>
              <input type="checkbox" checked={sel.includes(c)} onChange={() => set(sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c])} />{c}
            </label>))}
        </div>
      </>)}
    </div>
  );
}

// ── Cadeia de Compras ───────────────────────────────────────────────────────
type ResumoC = { qtd_titulos: number; total_comprado: number; total_pago: number; total_aberto: number; qtd_pv_os: number; total_faturado: number; total_recebido: number; aberto_ar: number };
type Cad = { empresa: string; cod_titulo: number; emissao: string | null; vencimento: string | null; previsao: string | null; pagamento: string | null;
  fornecedor: string; categoria: string; nf_fornecedor: string | null; projeto_compra: string; pc: string; aprovacao: string; aprovador: string; pv_os: string;
  cliente_venda: string; projeto_venda: string; valor: number; val_pago: number; val_aberto: number; status_pgto: string; dias_atraso: number | null;
  status_fat: string; val_faturado: number | null; status_ar: string; val_recebido: number | null; aberto_ar: number | null; atraso_ar: number | null };
type NaoFat = { pv_os: string; qtd_pcs: number; qtd_pagamentos: number; total_pago: number; fornecedores: string; primeiro_pgto: string | null; ultimo_pgto: string | null; dias_desde_pgto: number | null };
type Cob = { projeto: string; cod_projeto: string; comprado: number; faturado: number; pago: number; recebido: number; gap_competencia: number; exposicao_caixa: number; pct_cobertura: number | null };
type CadPayload = { resumo: ResumoC | null; aprovacao: Array<{ status: string; qtd: number; valor: number; pct_total: number }>; cadeia: Cad[]; rastreio: Cad[]; nao_faturadas: NaoFat[]; cobertura: Cob[] };

const tAprov = (v: string): Tom => (v === "Aprovado" ? "ok" : v === "Não aprovado" ? "crit" : v === "Pendente" || v === "Sem aprovação" ? "warn" : "off");
const tPg = (v: string): Tom => (v === "Pago" ? "ok" : v === "Vencido" ? "crit" : v === "Parcial" ? "warn" : "off");
const tFat = (v: string): Tom => (v === "Faturado" ? "ok" : v === "Não faturado" ? "crit" : "off");
const tAr = (v: string): Tom => (v === "Recebido" ? "ok" : v === "Vencido" ? "crit" : v === "Parcial" ? "warn" : "off");
type KC = keyof Cad & string;
const SPECS_CAD: Spec<Cad>[] = [
  { key: "previsao", label: "Previsão", tipo: "data", grupo: "Compra" }, { key: "emissao", label: "Emissão", tipo: "data", grupo: "Compra" },
  { key: "vencimento", label: "Vencimento", tipo: "data", grupo: "Compra" }, { key: "pagamento", label: "Dt. pgto", tipo: "data", grupo: "Compra" },
  { key: "empresa", label: "Emp.", grupo: "Compra", w: "70px" }, { key: "cod_titulo", label: "Cód. título", tipo: "num", grupo: "Compra", w: "110px" },
  { key: "fornecedor", label: "Fornecedor", grupo: "Compra", w: "minmax(160px,1.3fr)" }, { key: "categoria", label: "Categoria", grupo: "Compra" },
  { key: "nf_fornecedor", label: "NF compra", grupo: "Compra" }, { key: "projeto_compra", label: "Projeto (compra)", grupo: "Compra" },
  { key: "pc", label: "PC", grupo: "Compra", w: "90px" }, { key: "aprovacao", label: "Aprovação", tom: tAprov, grupo: "Compra", w: "120px" },
  { key: "aprovador", label: "Aprovador", grupo: "Compra" },
  { key: "valor", label: "Valor", tipo: "money", grupo: "Pagamento" }, { key: "val_pago", label: "Pago", tipo: "money", grupo: "Pagamento" },
  { key: "val_aberto", label: "Aberto", tipo: "money", grupo: "Pagamento" }, { key: "status_pgto", label: "Pgto", tom: tPg, grupo: "Pagamento", w: "96px" },
  { key: "dias_atraso", label: "Atraso pgto", tipo: "dias", grupo: "Pagamento", w: "92px" },
  { key: "pv_os", label: "PV/OS", grupo: "Venda", w: "100px" }, { key: "cliente_venda", label: "Cliente", grupo: "Venda", w: "minmax(160px,1.3fr)" },
  { key: "projeto_venda", label: "Projeto (venda)", grupo: "Venda" }, { key: "status_fat", label: "Faturado?", tom: tFat, grupo: "Venda", w: "110px" },
  { key: "val_faturado", label: "Faturado", tipo: "money", grupo: "Venda" },
  { key: "status_ar", label: "Receb.", tom: tAr, grupo: "Recebimento", w: "96px" }, { key: "val_recebido", label: "Recebido", tipo: "money", grupo: "Recebimento" },
  { key: "aberto_ar", label: "Aberto AR", tipo: "money", grupo: "Recebimento" }, { key: "atraso_ar", label: "Atraso AR", tipo: "dias", grupo: "Recebimento", w: "92px" },
];
const PADRAO_CADEIA: KC[] = ["previsao", "fornecedor", "categoria", "pc", "aprovacao", "valor", "status_pgto", "val_aberto", "pv_os", "cliente_venda", "status_fat", "val_faturado", "status_ar", "val_recebido"];
const PADRAO_RASTREIO: KC[] = ["pagamento", "fornecedor", "categoria", "val_pago", "nf_fornecedor", "pc", "pv_os", "projeto_venda", "cliente_venda", "status_fat", "val_faturado", "status_ar", "val_recebido", "aberto_ar"];

export function TelaCadeiaComprasNavy() {
  const per = usePeriodo();
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [base, setBase] = useState<"previsao" | "emissao">("previsao");
  const [bloco, setBloco] = useState<"naofat" | "rastreio" | "cadeia" | "cobertura">("naofat");
  const [data, setData] = useState<CadPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [colsC, setColsC] = useColunasEscolhidas<KC>("bi.cadeia.navy.cadeia", SPECS_CAD.map((s) => s.key), PADRAO_CADEIA);
  const [colsR, setColsR] = useColunasEscolhidas<KC>("bi.cadeia.navy.rastreio", SPECS_CAD.map((s) => s.key), PADRAO_RASTREIO);
  useEffect(() => {
    setData(null); setErr(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ from: per.from, to: per.to, base });
        if (empresas.length) qs.set("empresas", empresas.join(","));
        const r = await fetch(`/api/bi/compras-cadeia?${qs}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setData(j);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, [per.from, per.to, empresas, base]);

  const cab = <CabecalhoTela area="Financeiro" titulo="Cadeia de Compras" sub="Título a pagar → PC → aprovação → PV/OS → NF → recebimento (/api/bi/compras-cadeia)" />;
  const filtros = <FaixaFiltros>{per.chips}<Multi opcoes={EMPRESAS} sel={empresas} set={setEmpresas} />
    <SegmentedControl value={base} onChange={(v) => setBase(v as typeof base)} options={[{ value: "previsao", label: "Por previsão" }, { value: "emissao", label: "Por emissão" }]} /></FaixaFiltros>;
  if (err) return <PaginaNavy>{cab}{filtros}<Aviso>{err}</Aviso></PaginaNavy>;
  if (!data) return <PaginaNavy>{cab}{filtros}<Carregando /></PaginaNavy>;

  const r = data.resumo;
  const kpis: Kpi[] = [
    { rotulo: "Comprado (com PC)", valor: kbrl(n(r?.total_comprado)), sub: `${r?.qtd_titulos ?? 0} títulos a pagar`, hero: true },
    { rotulo: "Pago ao fornecedor", valor: kbrl(n(r?.total_pago)), sub: `${kbrl(n(r?.total_aberto))} ainda em aberto`, subTom: "crit" },
    { rotulo: "Faturado p/ cliente", valor: kbrl(n(r?.total_faturado)), sub: `${r?.qtd_pv_os ?? 0} PV/OS distintos na cadeia` },
    { rotulo: "Recebido do cliente", valor: kbrl(n(r?.total_recebido)), sub: `${kbrl(n(r?.aberto_ar))} em aberto no AR`, subTom: "ok" },
    { rotulo: "Pagas sem faturamento", valor: kbrl(data.nao_faturadas.reduce((a, x) => a + n(x.total_pago), 0)), sub: `${data.nao_faturadas.length} PV/OS · saiu do caixa e não voltou`, subTom: "warn", onClick: () => setBloco("naofat") },
  ];
  const mxA = Math.max(1, ...data.aprovacao.map((a) => n(a.valor)));

  const arvCad = (titulo: string, dica: string, regs: Cad[], cols: KC[], setCols: (v: KC[]) => void, padrao: KC[], grupoPor: "status_pgto" | "status_fat", chave: string) => {
    const specs = SPECS_CAD.filter((s) => cols.includes(s.key));
    const montar = (rs: Cad[]): NoNavy[] => {
      const g = new Map<string, Cad[]>();
      for (const x of rs) { const k = x[grupoPor] || "—"; (g.get(k) ?? g.set(k, []).get(k)!).push(x); }
      return [...g.entries()].map(([k, l]) => ({ id: `${chave}:${k}`, nome: k, sub: `${l.length} linha${l.length === 1 ? "" : "s"}`, cels: somaCels(specs, l),
        filhos: l.map((x, i) => ({ id: `${chave}:${k}:${x.cod_titulo}:${i}`, nome: x.fornecedor, sub: [x.pc && `PC ${x.pc}`, x.pv_os].filter(Boolean).join(" → ") || undefined, cels: specs.map((s) => celula(s, x)) })) }));
    };
    return <ArvoreNavy key={chave} titulo={titulo} dica={dica} colunas={colunasDe(`${grupoPor === "status_pgto" ? "Pagamento" : "Faturamento"} › compra`, specs)} registros={regs} montar={montar}
      grid={gridDe(specs)} minWidth={Math.max(1100, 260 + specs.length * 112)} buscaNome={(x) => `${x.fornecedor} ${x.pc} ${x.pv_os} ${x.cliente_venda}`} chave={cols.join()}
      toolbar={<SeletorColunas colunas={SPECS_CAD} sel={cols} setSel={setCols} padrao={padrao} titulo="Campos da cadeia" />}
      rodape={(rs) => <span>{rs.length} linhas · valor <b style={{ color: "var(--ww-text)" }}>{brl0(rs.reduce((a, x) => a + n(x.valor), 0))}</b> · pago {brl0(rs.reduce((a, x) => a + n(x.val_pago), 0))} · recebido {brl0(rs.reduce((a, x) => a + n(x.val_recebido), 0))}</span>} />;
  };

  const specsNF: Spec<NaoFat>[] = [{ key: "fornecedores", label: "Fornecedores", w: "minmax(220px,1.8fr)" }, { key: "qtd_pcs", label: "PCs", tipo: "num", w: "60px" },
    { key: "qtd_pagamentos", label: "Pgtos", tipo: "num", w: "66px" }, { key: "total_pago", label: "Pago ao forn.", tipo: "money", w: "130px" },
    { key: "primeiro_pgto", label: "1º pgto", tipo: "data" }, { key: "ultimo_pgto", label: "Últ. pgto", tipo: "data" }, { key: "dias_desde_pgto", label: "Parado há", tipo: "dias", w: "96px" }];
  const specsCob: Spec<Cob>[] = [{ key: "cod_projeto", label: "Código", w: "100px" }, { key: "comprado", label: "Comprado", tipo: "money" }, { key: "faturado", label: "Faturado", tipo: "money" },
    { key: "pago", label: "Pago", tipo: "money" }, { key: "recebido", label: "Recebido", tipo: "money" }, { key: "gap_competencia", label: "Gap compet.", tipo: "money", w: "120px" },
    { key: "exposicao_caixa", label: "Exposição caixa", tipo: "money", w: "130px" }, { key: "pct_cobertura", label: "Cobertura", tipo: "pct", w: "96px" }];

  return (
    <PaginaNavy>
      {cab}{filtros}
      <GradeKpis kpis={kpis} min={180} />
      <MeioTela
        grafico={<GraficoBarras titulo="Compras por status de aprovação do PC" colunas={data.aprovacao.map((a) => ({ rotulo: a.status, topo: `${Math.round(n(a.pct_total))}%`,
          title: `${a.status} · ${brl0(n(a.valor))} · ${a.qtd} títulos · ${pct1(n(a.pct_total))}`, segs: [{ v: n(a.valor), cor: tAprov(a.status) === "ok" ? "var(--ww-brand-3)" : tAprov(a.status) === "crit" ? "var(--ww-crit)" : tAprov(a.status) === "warn" ? "var(--ww-warn)" : "var(--ww-off)" }] }))} />}
        lado={<PainelLateral titulo="Aprovação — valor e títulos" blocos={[...data.aprovacao.map((a) => ({ k: "m" as const, rotulo: `${a.status} · ${a.qtd} títulos`, valor: kbrl(n(a.valor)), pct: (n(a.valor) / mxA) * 100, tom: tAprov(a.status) })),
          { k: "t" as const, t: "Valor dos títulos a pagar conforme a aprovação do pedido de compra." }]} />} />
      <div><SegmentedControl value={bloco} onChange={(v) => setBloco(v as typeof bloco)} options={[
        { value: "naofat", label: `Pagas sem faturamento · ${data.nao_faturadas.length}` }, { value: "rastreio", label: `Rastreio · ${data.rastreio.length}` },
        { value: "cadeia", label: `Cadeia · ${data.cadeia.length}` }, { value: "cobertura", label: `Cobertura por projeto · ${data.cobertura.length}` }]} /></div>
      {bloco === "naofat" && <ArvoreNavy titulo="Compras pagas que não viraram faturamento" dica="Saiu do caixa pro fornecedor e não voltou como nota pro cliente — quanto mais velho, pior"
        colunas={colunasDe("PV/OS", specsNF)} registros={data.nao_faturadas} grid={gridDe(specsNF, "minmax(140px,1fr)")} minWidth={1000} buscaNome={(x) => `${x.pv_os} ${x.fornecedores}`}
        montar={(xs) => xs.map((x, i) => ({ id: `nf:${x.pv_os}:${i}`, nome: x.pv_os, cels: specsNF.map((s) => (s.key === "dias_desde_pgto" && x.dias_desde_pgto != null ? cPill(`${x.dias_desde_pgto}d`, x.dias_desde_pgto > 90 ? "crit" : x.dias_desde_pgto > 30 ? "warn" : "info") : celula(s, x))) }))}
        rodape={(xs) => <span>{xs.length} PV/OS · pago <b style={{ color: "var(--ww-text)" }}>{brl0(xs.reduce((a, x) => a + n(x.total_pago), 0))}</b></span>} />}
      {bloco === "rastreio" && arvCad("Rastreio: compra paga → venda → recebimento", "Ancorado na data de pagamento — o que já saiu do caixa e onde parou", data.rastreio, colsR, setColsR, PADRAO_RASTREIO, "status_fat", "ras")}
      {bloco === "cadeia" && arvCad("Cadeia de compras — detalhe", "Título a pagar → PC → aprovação → PV/OS → NF → recebimento, linha a linha", data.cadeia, colsC, setColsC, PADRAO_CADEIA, "status_pgto", "cad")}
      {bloco === "cobertura" && <ArvoreNavy titulo="Cobertura compra ↔ venda por projeto" dica="Vitalício por projeto, sem recorte de período · gap de competência ≠ exposição de caixa"
        colunas={colunasDe("Projeto", specsCob)} registros={data.cobertura} grid={gridDe(specsCob, "minmax(240px,1.6fr)")} minWidth={1200} buscaNome={(x) => `${x.projeto} ${x.cod_projeto}`}
        montar={(xs) => xs.map((x, i) => ({ id: `cb:${x.cod_projeto}:${i}`, nome: x.projeto, cels: specsCob.map((s) => (s.key === "pct_cobertura" && x.pct_cobertura != null
          ? cBarra(pct1(x.pct_cobertura), Math.min(100, x.pct_cobertura), x.pct_cobertura >= 100 ? "ok" : x.pct_cobertura >= 60 ? "warn" : "crit") : s.key === "exposicao_caixa" && n(x.exposicao_caixa) > 0 ? cTexto(brl0(n(x.exposicao_caixa)), { tom: "warn", peso: 600 }) : celula(s, x))) }))}
        rodape={(xs) => <span>{xs.length} projetos · comprado <b style={{ color: "var(--ww-text)" }}>{brl0(xs.reduce((a, x) => a + n(x.comprado), 0))}</b> · faturado {brl0(xs.reduce((a, x) => a + n(x.faturado), 0))} · exposição {brl0(xs.reduce((a, x) => a + n(x.exposicao_caixa), 0))}</span>} />}
    </PaginaNavy>
  );
}
