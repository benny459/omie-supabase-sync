"use client";

/**
 * Contas a Pagar / Contas a Receber (BI) — recriação Navy.
 *
 * São as telas analíticas dos títulos (dashboard 5 do Metabase), irmãs de
 * Títulos a Pagar/Receber (a lista operacional do ERP). O modelo não as desenha
 * à parte; seguem o esqueleto dele e a ideia de "Cobertura do mês" (emitido ×
 * pago) que o protótipo põe em Títulos a Pagar, e que aqui tem fonte
 * (tit_mensal / ar_mensal).
 *
 * Nada da tela antiga ficou de fora: filtros de período, empresa, horizonte,
 * base (previsão × vencimento), recorte Tudo/Vencido/Hoje/A vencer; os avisos
 * do que está fora do foco e fora do corte; os quatro números; vencido por
 * atraso e a vencer por horizonte em escalas separadas; emitido × pago;
 * saídas por grupo DRE; top fornecedores; e a agenda compra → venda →
 * pagamento com as 29 colunas (todas no controlo Colunas). No A Receber: só
 * carteira, categoria de venda, aging, detalhe e emitido × recebido.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SegmentedControl, type Tom } from "../primitivos";
import {
  ArvoreNavy, Aviso, CabecalhoTela, CampoData, Carregando, ChipFiltro, FaixaFiltros, GradeKpis,
  GraficoBarras, GraficoLinha, MeioTela, PaginaNavy, PainelLateral, SeletorColunas, brl0, cMudo, cPill,
  cTexto, ddmm, ddmmaa, hojeISO, kbrl, somaDias, useColunasEscolhidas, type Bloco, type ColunaNavy, type Kpi, type NoNavy,
} from "./KitTela";

const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const EMPRESAS = ["SF", "CD", "WW"];
const CATS = ["Contratuais", "Projetos", "Revenda", "Avulsos", "BOT/SW", "Outras"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesCurto = (x: string) => { const [y, m] = x.slice(0, 7).split("-"); return `${MESES[Number(m) - 1] ?? m}/${(y ?? "").slice(2)}`; };

type Periodo = "ytd" | "m12" | "mes" | "livre";
function usePeriodo() {
  const h = hojeISO();
  const [p, setP] = useState<Periodo>("ytd");
  const [de, setDe] = useState(h.slice(0, 4) + "-01-01");
  const [ate, setAte] = useState(h);
  const [from, to] = p === "ytd" ? [h.slice(0, 4) + "-01-01", h] : p === "m12" ? [somaDias(h, -365), h] : p === "mes" ? [h.slice(0, 8) + "01", h] : [de, ate];
  const chips = (<>
    {([["ytd", "Ano até hoje"], ["m12", "12 meses"], ["mes", "Mês corrente"], ["livre", "De / Até"]] as const).map(([k, l]) => (
      <ChipFiltro key={k} ativo={p === k} onClick={() => setP(k)}>{l}</ChipFiltro>
    ))}
    {p === "livre" && (<><CampoData valor={de} onChange={setDe} /><CampoData valor={ate} onChange={setAte} /></>)}
  </>);
  return { from, to, chips };
}

function ChipsMulti({ opcoes, sel, set }: { opcoes: string[]; sel: string[]; set: (v: string[]) => void }) {
  return <>{opcoes.map((o) => <ChipFiltro key={o} ativo={sel.includes(o)} onClick={() => set(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o])}>{o}</ChipFiltro>)}</>;
}

// ── A Pagar ─────────────────────────────────────────────────────────────────
type AgendaRow = {
  lado: string; previsao: string | null; dia_semana: string; vencimento: string | null; emissao: string | null; dias_atraso: number | null;
  fornecedor: string; titulo: string | null; nf: string | null; categoria: string; grupo: string; projeto: string; pedido: string;
  aprovacao: string; aprovador: string; pv_os: string; rc: string; rc_descricao: string; rc_custo: number | null; pc_custo: number | null;
  qtd_pcs: number; rc_vs_pc: string | null; fat_status: string | null; venda: number | null; margem_pct: number | null;
  dt_aprovacao: string | null; dt_nf_fornec: string | null; dt_lancamento: string | null; atraso_nf: number | null;
  dt_receb_nf: string | null; prazo_dias: number | null; material: string; valor: number;
};
type PagarPayload = {
  saldo_aberto: number; qtd_titulos: number; total_pago_ano: number;
  horizonte: { dias: number; vencido: number; no_horizonte: number; futuro: number; sem_data: number; qtd_vencido: number; qtd_no_horizonte: number; qtd_futuro: number };
  aging: Array<{ faixa: string; ord: number; qtd: number; valor: number }>;
  mensal: Array<{ x: string; emitido: number; pago: number }>;
  grupos: Array<{ label: string; value: number; macro: string }>;
  top: Array<{ chave: string; valor: number; qtd: number }>;
  agenda: AgendaRow[];
  faixas: Array<{ lado: string; faixa: string; ord: number; qtd: number; valor: number }>;
  horizonte_mes: { vencido: number; qtd_vencido: number; mes_atual: number; qtd_mes_atual: number; mes_proximo: number; qtd_mes_proximo: number; depois: number; qtd_depois: number } | null;
};

type K = keyof AgendaRow & string;
type ColA = { key: K; label: string; grupo: string; tipo?: "data" | "dias" | "money" | "pct"; tom?: (v: string) => Tom };
const COLS_AGENDA: ColA[] = [
  { key: "previsao", label: "Previsão", grupo: "Datas", tipo: "data" },
  { key: "dia_semana", label: "D.Sem", grupo: "Datas" },
  { key: "vencimento", label: "Vencimento", grupo: "Datas", tipo: "data" },
  { key: "dias_atraso", label: "Atraso", grupo: "Datas", tipo: "dias" },
  { key: "emissao", label: "Emissão", grupo: "Datas", tipo: "data" },
  { key: "titulo", label: "Título", grupo: "Título" },
  { key: "nf", label: "NF", grupo: "Título" },
  { key: "categoria", label: "Categoria", grupo: "Título" },
  { key: "grupo", label: "Grupo DRE", grupo: "Título" },
  { key: "projeto", label: "Projeto", grupo: "Título" },
  { key: "pedido", label: "Pedido", grupo: "Compra" },
  { key: "aprovacao", label: "Aprovação", grupo: "Compra",
    tom: (v) => (v === "Aprovado" ? "ok" : v === "Não aprovado" ? "crit" : v === "Pendente" || v === "Sem aprovação" ? "warn" : "off") },
  { key: "aprovador", label: "Aprovador", grupo: "Compra" },
  { key: "dt_aprovacao", label: "Aprovado em", grupo: "Compra", tipo: "data" },
  { key: "rc", label: "RC", grupo: "Compra" },
  { key: "rc_descricao", label: "RC — descrição", grupo: "Compra" },
  { key: "rc_custo", label: "RC orçado", grupo: "Compra", tipo: "money" },
  { key: "pc_custo", label: "PC real", grupo: "Compra", tipo: "money" },
  { key: "qtd_pcs", label: "Qtd PCs", grupo: "Compra" },
  { key: "rc_vs_pc", label: "RC × PC", grupo: "Compra", tom: (v) => (v === "No orçamento" ? "ok" : v === "Acima do RC" ? "crit" : "off") },
  { key: "material", label: "Material", grupo: "Compra" },
  { key: "dt_nf_fornec", label: "NF fornec. em", grupo: "Compra", tipo: "data" },
  { key: "atraso_nf", label: "Atraso NF", grupo: "Compra", tipo: "dias" },
  { key: "dt_receb_nf", label: "Recebida em", grupo: "Compra", tipo: "data" },
  { key: "dt_lancamento", label: "Lançado em", grupo: "Compra", tipo: "data" },
  { key: "prazo_dias", label: "Prazo", grupo: "Compra", tipo: "dias" },
  { key: "pv_os", label: "PV/OS", grupo: "Venda" },
  { key: "fat_status", label: "Faturado?", grupo: "Venda", tom: (v) => (v === "Faturado" ? "ok" : v === "Não faturado" ? "crit" : "off") },
  { key: "venda", label: "Venda", grupo: "Venda", tipo: "money" },
  { key: "margem_pct", label: "Margem", grupo: "Venda", tipo: "pct" },
  { key: "valor", label: "A pagar", grupo: "Título", tipo: "money" },
];
const PADRAO_AGENDA: K[] = ["previsao", "dias_atraso", "titulo", "categoria", "projeto", "pedido", "aprovacao", "pv_os", "fat_status", "margem_pct", "valor"];
const txtA = (c: ColA, r: AgendaRow) => {
  const v = r[c.key];
  if (v == null || v === "") return "—";
  if (c.tipo === "data") return ddmmaa(String(v).slice(0, 10));
  if (c.tipo === "dias") return `${v}d`;
  if (c.tipo === "money") return brl0(n(v));
  if (c.tipo === "pct") return `${n(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  return String(v);
};
const numA = (c: ColA) => (c.tipo === "money" || c.tipo === "dias" || c.tipo === "pct" || c.key === "qtd_pcs")
  ? (r: AgendaRow) => (r[c.key] == null ? null : n(r[c.key]))
  : c.tipo === "data" ? (r: AgendaRow) => (r[c.key] ? Date.parse(String(r[c.key])) : null) : undefined;

export function TelaContasPagarBiNavy() {
  const per = usePeriodo();
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [horizonte, setHorizonte] = useState(90);
  const [base, setBase] = useState<"previsao" | "vencimento">("vencimento");
  const [lado, setLado] = useState<"todos" | "Vencido" | "hoje" | "A vencer">("todos");
  const [data, setData] = useState<PagarPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cols, setCols] = useColunasEscolhidas<K>("bi.pagar.navy.colunas", COLS_AGENDA.map((c) => c.key), PADRAO_AGENDA);

  const load = useCallback(async () => {
    setData(null); setErr(null);
    try {
      const qs = new URLSearchParams({ from: per.from, to: per.to, base, horizonte: String(horizonte) });
      if (empresas.length) qs.set("empresas", empresas.join(","));
      const r = await fetch(`/api/bi/contas-pagar?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setErr((e as Error).message); }
  }, [per.from, per.to, empresas, horizonte, base]);
  useEffect(() => { void load(); }, [load]);

  const hoje = hojeISO();
  const agenda = useMemo(() => (data?.agenda ?? []).filter((r) =>
    lado === "todos" ? true : lado === "hoje" ? (r.previsao ?? "").slice(0, 10) === hoje : r.lado === lado), [data, lado, hoje]);
  const ativas = useMemo(() => COLS_AGENDA.filter((c) => cols.includes(c.key)), [cols]);

  const cab = <CabecalhoTela area="Financeiro" titulo="Contas a Pagar"
    sub="Análise dos títulos a pagar (bi.tit_* natureza P) · saldo quebrado por horizonte · agenda compra → venda → pagamento" />;
  const filtros = (
    <FaixaFiltros>
      {per.chips}
      <ChipsMulti opcoes={EMPRESAS} sel={empresas} set={setEmpresas} />
      {[30, 60, 90, 180, 365].map((d) => <ChipFiltro key={d} ativo={horizonte === d} onClick={() => setHorizonte(d)}>{d} dias</ChipFiltro>)}
      <SegmentedControl value={base} onChange={(v) => setBase(v as typeof base)} options={[{ value: "vencimento", label: "Por vencimento" }, { value: "previsao", label: "Por previsão" }]} />
    </FaixaFiltros>
  );
  if (err) return <PaginaNavy>{cab}{filtros}<Aviso>{err}</Aviso></PaginaNavy>;
  if (!data) return <PaginaNavy>{cab}{filtros}<Carregando /></PaginaNavy>;

  const hm = data.horizonte_mes, h = data.horizonte;
  const kpis: Kpi[] = [
    { rotulo: "Saldo aberto", valor: kbrl(data.saldo_aberto), sub: `${data.qtd_titulos.toLocaleString("pt-BR")} títulos · inclui parcelas futuras`, hero: true },
    { rotulo: "Vencido", valor: hm ? kbrl(hm.vencido) : "—", sub: hm ? `${hm.qtd_vencido} títulos · por ${base}` : undefined, subTom: "crit", onClick: () => setLado("Vencido") },
    { rotulo: "Vence este mês", valor: hm ? kbrl(hm.mes_atual) : "—", sub: hm ? `${hm.qtd_mes_atual} títulos · até o fim do mês` : undefined, subTom: "warn" },
    { rotulo: "Vence no mês que vem", valor: hm ? kbrl(hm.mes_proximo) : "—", sub: hm ? `${hm.qtd_mes_proximo} títulos` : undefined },
    { rotulo: "Pago no período", valor: kbrl(data.total_pago_ano), sub: `${ddmm(per.from)} a ${ddmm(per.to)}`, subTom: "ok" },
    { rotulo: `No horizonte · ${h.dias}d`, valor: kbrl(h.no_horizonte), sub: `${h.qtd_no_horizonte} títulos · futuro ${kbrl(h.futuro)}${h.sem_data ? ` · sem data ${kbrl(h.sem_data)}` : ""}` },
  ];
  const faixas = (l: string) => data.faixas.filter((f) => f.lado === l).sort((a, b) => a.ord - b.ord);
  const fora = data.faixas.filter((f) => f.lado === "Além do corte");
  const mesAtual = data.mensal.find((m) => m.x.slice(0, 7) === hoje.slice(0, 7));
  const mxG = Math.max(1, ...data.grupos.map((g) => g.value));
  const cobertura: Bloco[] = [
    ...(mesAtual ? [
      { k: "m" as const, rotulo: "Emitido no mês", valor: kbrl(mesAtual.emitido), pct: 100, tom: "info" as Tom },
      { k: "m" as const, rotulo: "Pago no mês", valor: kbrl(mesAtual.pago), pct: mesAtual.emitido ? Math.min(100, (mesAtual.pago / mesAtual.emitido) * 100) : 0, tom: "ok" as Tom },
    ] : []),
    { k: "t", t: "Cobertura do mês: emitido × pago (tit_mensal). O comprado em PCs não tem fonte nesta rota." },
    ...data.grupos.slice(0, 8).map((g) => ({ k: "m" as const, rotulo: `${g.label}`, valor: kbrl(g.value), pct: (g.value / mxG) * 100, tom: "violet" as Tom, title: `${g.macro} · ${g.label}` })),
  ];
  const mxT = Math.max(1, ...data.top.map((t) => t.valor));

  const colunas: ColunaNavy<AgendaRow>[] = [{ label: "Situação › fornecedor › título" },
    ...ativas.map((c) => ({ label: c.label, align: (c.tipo === "money" || c.tipo === "dias" || c.tipo === "pct") ? "right" as const : undefined, texto: (r: AgendaRow) => txtA(c, r), numero: numA(c) }))];
  const grid = "minmax(260px,1.6fr) " + ativas.map((c) => (c.key === "rc_descricao" ? "minmax(180px,1.4fr)" : c.tipo === "money" ? "110px" : c.tipo ? "86px" : "minmax(100px,1fr)")).join(" ");
  const cel = (c: ColA, r: AgendaRow) => {
    const t = txtA(c, r);
    if (t === "—") return cMudo("—");
    if (c.tom) return cPill(t, c.tom(t));
    if (c.key === "dias_atraso" && n(r.dias_atraso) > 0) return cTexto(t, { tom: "crit" });
    return cTexto(t, { peso: c.key === "valor" ? 600 : 500, cor: c.tipo === "money" ? undefined : "var(--ww-text-2)" });
  };
  const soma = (l: AgendaRow[], k: K) => l.reduce((s, r) => s + n(r[k]), 0);
  const celsSoma = (l: AgendaRow[]) => ativas.map((c) => (c.tipo === "money" ? cTexto(brl0(soma(l, c.key)), { peso: c.key === "valor" ? 700 : 600 }) : cMudo("")));
  const montar = (rs: AgendaRow[]): NoNavy[] => ["Vencido", "A vencer"].map((ld) => {
    const l = rs.filter((r) => r.lado === ld);
    const pf = new Map<string, AgendaRow[]>();
    for (const r of l) (pf.get(r.fornecedor) ?? pf.set(r.fornecedor, []).get(r.fornecedor)!).push(r);
    return { id: `l:${ld}`, nome: ld, sub: `${l.length} títulos · ${pf.size} fornecedores`, cels: celsSoma(l),
      filhos: [...pf.entries()].sort((a, b) => soma(b[1], "valor") - soma(a[1], "valor")).map(([f, lf]) => ({
        id: `l:${ld}:${f}`, nome: f, sub: `${lf.length} título${lf.length === 1 ? "" : "s"}`, cels: celsSoma(lf),
        filhos: lf.map((r, i) => ({ id: `l:${ld}:${f}:${i}`, nome: r.titulo || r.nf || "título",
          sub: `prev. ${ddmm((r.previsao ?? "").slice(0, 10) || null)}${r.dia_semana ? ` ${r.dia_semana}` : ""}${r.nf ? ` · NF ${r.nf}` : ""}`,
          cels: ativas.map((c) => cel(c, r)) })),
      })) };
  }).filter((x) => x.filhos.length);

  return (
    <PaginaNavy>
      {cab}{filtros}
      {hm && hm.depois > 0 && <Aviso tone="info">Saldo aberto total é {brl0(data.saldo_aberto)} em {data.qtd_titulos} títulos, mas <b>{brl0(hm.depois)}</b> ({hm.qtd_depois} parcelas) só vencem depois do mês que vem. O que exige decisão agora é {brl0(hm.vencido + hm.mes_atual)} — vencido mais o que vence até o fim do mês.</Aviso>}
      <GradeKpis kpis={kpis} min={170} />
      <MeioTela
        grafico={<GraficoBarras titulo={`Vencido — por tempo de atraso · por ${base} · sem filtro de período`}
          colunas={faixas("Vencido").map((f) => ({ rotulo: f.faixa, topo: kbrl(n(f.valor)).replace(" mil", "k"), topoCor: "var(--ww-crit-text)", title: `${f.faixa} · ${brl0(n(f.valor))} · ${f.qtd} títulos`, segs: [{ v: n(f.valor), cor: "var(--ww-crit)" }] }))} />}
        lado={<PainelLateral titulo="Cobertura do mês · saídas por grupo DRE" blocos={cobertura} />} />
      {fora.length > 0 && <Aviso tone="off">Fora dos gráficos: {fora.map((f) => `${brl0(n(f.valor))} ${f.faixa.toLowerCase()} (${f.qtd} títulos)`).join(" · ")}. A escala deles escondia o que é acionável — seguem na agenda abaixo.</Aviso>}
      <MeioTela
        grafico={<GraficoBarras titulo="A vencer — por horizonte (até 12 meses)"
          colunas={faixas("A vencer").map((f) => ({ rotulo: f.faixa, topo: kbrl(n(f.valor)).replace(" mil", "k"), title: `${f.faixa} · ${brl0(n(f.valor))} · ${f.qtd} títulos`, segs: [{ v: n(f.valor), cor: "var(--ww-brand-2)" }] }))} />}
        lado={<PainelLateral titulo="Top fornecedores pagos no período" blocos={data.top.slice(0, 10).map((t) => ({ k: "m", rotulo: t.chave, valor: kbrl(t.valor), pct: (t.valor / mxT) * 100, tom: "info", title: `${brl0(t.valor)} · ${t.qtd} títulos` }))} />} />
      <GraficoLinha titulo="Emitido × pago por mês" formatar={brl0} rotulos={data.mensal.map((m) => mesCurto(m.x))}
        series={[{ nome: "Emitido", cor: "var(--ww-brand-2)", largura: 3, vals: data.mensal.map((m) => m.emitido) },
                 { nome: "Pago", cor: "var(--ww-brand-3)", tracejado: "5 4", vals: data.mensal.map((m) => m.pago) }]} />
      <ArvoreNavy<AgendaRow> chave={`${lado}:${cols.join(",")}`}
        titulo="Contas a pagar — vencido e a vencer"
        dica={`Vencido inteiro + a vencer nos próximos ${horizonte} dias · compra → venda → pagamento na mesma linha`}
        colunas={colunas} registros={agenda} montar={montar} grid={grid} minWidth={Math.max(1100, 300 + ativas.length * 110)}
        abertosIniciais={new Set(agenda.filter((r) => r.lado === "Vencido").map((r) => r.fornecedor)).size <= 10 ? ["l:Vencido"] : []} buscaNome={(r) => `${r.fornecedor} ${r.titulo ?? ""} ${r.nf ?? ""}`}
        toolbar={<div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <SegmentedControl value={lado} onChange={(v) => setLado(v as typeof lado)} options={[
            { value: "todos", label: "Tudo" }, { value: "Vencido", label: "Só vencido" }, { value: "hoje", label: "Vence hoje" }, { value: "A vencer", label: "Só a vencer" }]} />
          <SeletorColunas colunas={COLS_AGENDA} sel={cols} setSel={setCols} padrao={PADRAO_AGENDA} titulo="Campos da agenda" />
        </div>}
        rodape={(rs) => <span>{rs.length} títulos · a pagar <b style={{ color: "var(--ww-text)" }}>{brl0(soma(rs, "valor"))}</b> · PC real {brl0(soma(rs, "pc_custo"))} · venda {brl0(soma(rs, "venda"))}</span>} />
    </PaginaNavy>
  );
}

// ── A Receber ───────────────────────────────────────────────────────────────
type TituloR = { empresa: string; contraparte: string; num_titulo: string; categoria: string; emissao: string | null; vencimento: string | null;
  previsao: string | null; pagamento: string | null; valor: number; aberto: number; pago: number; dias_atraso: number | null; situacao: string };
type ReceberPayload = { saldo_aberto: number; qtd_titulos: number; a_vencer: number; vence_hoje: number; vence_amanha: number; esta_semana: number; em_atraso: number;
  aging: Array<{ faixa: string; ord: number; qtd: number; valor: number }>; mensal: Array<{ x: string; emitido: number; recebido: number }>; detalhe: TituloR[] };

export function TelaContasReceberBiNavy() {
  const per = usePeriodo();
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [carteira, setCarteira] = useState(false);
  const [base, setBase] = useState<"previsao" | "vencimento">("previsao");
  const [data, setData] = useState<ReceberPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null); setErr(null);
    try {
      const qs = new URLSearchParams({ from: per.from, to: per.to, base });
      if (empresas.length) qs.set("empresas", empresas.join(","));
      if (cats.length) qs.set("cat", cats.join(","));
      if (carteira) qs.set("carteira", "1");
      const r = await fetch(`/api/bi/contas-receber?${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setData(j);
    } catch (e) { setErr((e as Error).message); }
  }, [per.from, per.to, empresas, cats, carteira, base]);
  useEffect(() => { void load(); }, [load]);

  const cab = <CabecalhoTela area="Financeiro" titulo="Contas a Receber" sub="Análise dos títulos a receber (bi.ar_resumo, ar_aging, ar_mensal, titulos_detalhe)" />;
  const filtros = (
    <FaixaFiltros>
      {per.chips}
      <ChipsMulti opcoes={EMPRESAS} sel={empresas} set={setEmpresas} />
      <ChipsMulti opcoes={CATS} sel={cats} set={setCats} />
      <ChipFiltro ativo={carteira} onClick={() => setCarteira((v) => !v)} title="Recorte que no Metabase estava colado no SQL e aplicado de forma incoerente">Só carteira</ChipFiltro>
      <SegmentedControl value={base} onChange={(v) => setBase(v as typeof base)} options={[{ value: "previsao", label: "Por previsão" }, { value: "vencimento", label: "Por vencimento" }]} />
    </FaixaFiltros>
  );
  if (err) return <PaginaNavy>{cab}{filtros}<Aviso>{err}</Aviso></PaginaNavy>;
  if (!data) return <PaginaNavy>{cab}{filtros}<Carregando /></PaginaNavy>;

  const kpis: Kpi[] = [
    { rotulo: "Saldo aberto", valor: kbrl(data.saldo_aberto), sub: `${data.qtd_titulos.toLocaleString("pt-BR")} títulos`, hero: true },
    { rotulo: "Em atraso", valor: kbrl(data.em_atraso), sub: `por ${base}`, subTom: "crit" },
    { rotulo: "Vence hoje", valor: kbrl(data.vence_hoje), subTom: "warn", sub: `amanhã ${kbrl(data.vence_amanha)}` },
    { rotulo: "Esta semana", valor: kbrl(data.esta_semana) },
    { rotulo: "A vencer", valor: kbrl(data.a_vencer), subTom: "ok", sub: "todo o futuro" },
  ];
  const aging = [...data.aging].sort((a, b) => a.ord - b.ord);
  const mxA = Math.max(1, ...aging.map((a) => a.valor));

  const colunas: ColunaNavy<TituloR>[] = [
    { label: "Situação › cliente › título" },
    { label: "Emp.", texto: (r) => r.empresa },
    { label: "Categoria", texto: (r) => r.categoria },
    { label: "Emissão", texto: (r) => ddmmaa(r.emissao), numero: (r) => (r.emissao ? Date.parse(r.emissao) : null) },
    { label: "Previsão", texto: (r) => ddmmaa(r.previsao), numero: (r) => (r.previsao ? Date.parse(r.previsao) : null) },
    { label: "Vencimento", texto: (r) => ddmmaa(r.vencimento), numero: (r) => (r.vencimento ? Date.parse(r.vencimento) : null) },
    { label: "Atraso", align: "right", texto: (r) => (r.dias_atraso == null ? "—" : `${r.dias_atraso}d`), numero: (r) => r.dias_atraso },
    { label: "Valor", align: "right", texto: (r) => brl0(n(r.valor)), numero: (r) => n(r.valor) },
    { label: "Pago", align: "right", texto: (r) => brl0(n(r.pago)), numero: (r) => n(r.pago) },
    { label: "Aberto", align: "right", texto: (r) => brl0(n(r.aberto)), numero: (r) => n(r.aberto) },
  ];
  const s = (l: TituloR[], k: "valor" | "pago" | "aberto") => l.reduce((t, r) => t + n(r[k]), 0);
  const sumC = (l: TituloR[]) => [cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""),
    cTexto(brl0(s(l, "valor")), { peso: 600 }), cTexto(brl0(s(l, "pago"))), cTexto(brl0(s(l, "aberto")), { peso: 700 })];
  const tomSit = (v: string): Tom => (v === "Vencido" ? "crit" : v === "Liquidado" ? "ok" : "info");
  const montar = (rs: TituloR[]): NoNavy[] => {
    const g = new Map<string, TituloR[]>();
    for (const r of rs) (g.get(r.situacao) ?? g.set(r.situacao, []).get(r.situacao)!).push(r);
    return [...g.entries()].sort((a, b) => (a[0] === "Vencido" ? -1 : b[0] === "Vencido" ? 1 : a[0].localeCompare(b[0]))).map(([sit, l]) => {
      const pc = new Map<string, TituloR[]>();
      for (const r of l) (pc.get(r.contraparte) ?? pc.set(r.contraparte, []).get(r.contraparte)!).push(r);
      return { id: `s:${sit}`, nome: sit, sub: `${l.length} títulos · ${pc.size} clientes`, cels: sumC(l),
        filhos: [...pc.entries()].sort((a, b) => s(b[1], "aberto") - s(a[1], "aberto")).map(([c, lc]) => ({
          id: `s:${sit}:${c}`, nome: c, sub: `${lc.length} título${lc.length === 1 ? "" : "s"}`, cels: sumC(lc),
          filhos: lc.map((r, i) => ({ id: `s:${sit}:${c}:${i}`, nome: r.num_titulo || "título", sub: r.pagamento ? `pago ${ddmm(r.pagamento)}` : undefined, cels: [
            cTexto(r.empresa, { cor: "var(--ww-text-2)" }), cTexto(r.categoria), cTexto(ddmmaa(r.emissao)), cTexto(ddmmaa(r.previsao)), cTexto(ddmmaa(r.vencimento)),
            r.dias_atraso ? cPill(`${r.dias_atraso}d`, tomSit(r.situacao)) : cMudo("—"),
            cTexto(brl0(n(r.valor))), cTexto(brl0(n(r.pago)), { cor: "var(--ww-text-2)" }), cTexto(brl0(n(r.aberto)), { peso: 600 })] })),
        })) };
    });
  };

  return (
    <PaginaNavy>
      {cab}{filtros}
      {carteira && <Aviso tone="warn">Recorte de carteira ativo — títulos de clientes fora dela não entram em nenhum número desta tela.</Aviso>}
      <GradeKpis kpis={kpis} min={180} />
      <MeioTela
        grafico={<GraficoBarras titulo={`Aging dos títulos abertos · por ${base === "previsao" ? "data de previsão" : "data de vencimento"}`}
          colunas={aging.map((a) => ({ rotulo: a.faixa, topo: kbrl(a.valor).replace(" mil", "k"), title: `${a.faixa} · ${brl0(a.valor)} · ${a.qtd} títulos`,
            segs: [{ v: a.valor, cor: /vencer/i.test(a.faixa) ? "linear-gradient(180deg,var(--ww-brand-3),var(--ww-brand-1))" : /hoje/i.test(a.faixa) ? "var(--ww-warn)" : "var(--ww-crit)" }] }))} />}
        lado={<PainelLateral titulo="Faixas" blocos={aging.map((a) => ({ k: "m", rotulo: `${a.faixa} · ${a.qtd}`, valor: kbrl(a.valor), pct: (a.valor / mxA) * 100, tom: "info" }))} />} />
      <GraficoLinha titulo="Emitido × recebido por mês" formatar={brl0} rotulos={data.mensal.map((m) => mesCurto(m.x))}
        series={[{ nome: "Emitido", cor: "var(--ww-brand-2)", largura: 3, vals: data.mensal.map((m) => m.emitido) },
                 { nome: "Recebido", cor: "var(--ww-brand-3)", tracejado: "5 4", vals: data.mensal.map((m) => m.recebido) }]} />
      <ArvoreNavy<TituloR> titulo="Detalhe de títulos a receber" dica="Títulos em aberto, linha a linha — mesma lista do card do Metabase (até 500)"
        colunas={colunas} registros={data.detalhe} montar={montar}
        abertosIniciais={new Set(data.detalhe.filter((r) => r.situacao === "Vencido").map((r) => r.contraparte)).size <= 10 ? ["s:Vencido"] : []}
        grid="minmax(260px,1.6fr) 76px minmax(130px,1fr) 96px 96px 104px 84px 116px 110px 116px" minWidth={1300}
        buscaNome={(r) => `${r.contraparte} ${r.num_titulo}`}
        rodape={(rs) => <span>{rs.length} títulos · valor <b style={{ color: "var(--ww-text)" }}>{brl0(s(rs, "valor"))}</b> · aberto {brl0(s(rs, "aberto"))}</span>} />
    </PaginaNavy>
  );
}
