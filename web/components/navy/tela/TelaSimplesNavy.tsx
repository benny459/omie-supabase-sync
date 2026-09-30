"use client";

/**
 * Simples Nacional — recriação Navy (protótipo "Painel Allka finance").
 *
 * Mesma apuração da tela antiga (/api/simples): RBT12, fator r, alíquotas
 * efetivas por anexo, memorial por atividade com os sete tributos, cenários de
 * fechamento, notas do mês e a conferência Omie × PGDAS. Nada recalculado aqui.
 *
 * Do modelo vêm o esqueleto (KPIs → gráfico + lateral → árvore) e a leitura
 * "competência › anexo". O gráfico é a conferência histórica — calculado ×
 * declarado por competência —, que é o faturamento mensal que a tela tem com
 * fonte. "Gerar DAS" e "Memória de cálculo" como botões ficam de fora: não há
 * emissão de DAS no painel, e a memória de cálculo é a própria árvore.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SegmentedControl, type Tom } from "../primitivos";
import {
  ArvoreNavy, Aviso, BotaoTela, CabecalhoTela, Carregando, GradeKpis, GraficoBarras, MeioTela,
  PaginaNavy, PainelLateral, brl, brl0, cMudo, cPill, cTexto, ddmm, kbrl, type Bloco, type ColunaNavy, type Kpi, type NoNavy,
} from "./KitTela";

type Tributos = Record<string, number>;
type Atividade = { anexo: string; rotulo: string; base: number; efetiva: number; debito: number; tributos: Tributos; issNoTeto: boolean };
type Cenario = { rotulo: string; mercantil: number; receita: number; das: number; efetiva: number };
type Conf = { competencia: string; calculado: number; declarado: number | null; diferenca: number | null; recibo: number };
type Doc = { data: string; tipo: string; documento: string; cliente: string; valor: number; anexo: string; na_base: boolean };
type Dados = {
  competencia: string; rbt12: number; faixa: number; folha12: number;
  fatorR: number | null; mesesSemFolha: number; anexoServico: string;
  efetivas: Record<string, number>; custoPorMil: Record<string, number>;
  folgaFaixa: number | null;
  bases: { mercantil: number; servicoIii: number; servicoV: number; recibo: number };
  contagens: { nfe: number; osNota: number; osRecibo: number };
  sincronizado: { nfe: string | null; os: string | null };
  realizado: { das: number; receitaDoMes: number; efetivaMedia: number; atividades: Atividade[]; tributos: Tributos };
  cenarios: Cenario[];
  conferencia: Conf[];
  documentos: Doc[];
  anexoIiiClientes: { codigo_cliente: string; observacao: string | null }[];
};

const TRIB = ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "ICMS", "ISS"];
const pct = (v: number, casas = 4) => `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
const mesLongo = (s: string) => new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const mesCurto = (s: string) => new Date(s.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(". de ", "/").replace(" de ", "/");

export default function TelaSimplesNavy() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [competencia, setCompetencia] = useState("");
  const [verRecibos, setVerRecibos] = useState(false);
  const [bloco, setBloco] = useState<"memorial" | "notas" | "conferencia">("memorial");

  const load = useCallback(async () => {
    setCarregando(true); setErro("");
    try {
      const r = await fetch(`/api/simples${competencia ? `?competencia=${competencia}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setD(j);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setCarregando(false); }
  }, [competencia]);
  useEffect(() => { void load(); }, [load]);

  const meses = useMemo(() => d ? [...new Set(d.conferencia.map((c) => c.competencia).concat(d.competencia))].sort().reverse().slice(0, 14) : [], [d]);
  const docs = useMemo(() => (d ? (verRecibos ? d.documentos : d.documentos.filter((x) => x.na_base)) : []), [d, verRecibos]);

  const seletor = (
    <select value={competencia || d?.competencia.slice(0, 7) || ""} onChange={(e) => setCompetencia(e.target.value)} style={{
      height: 34, padding: "0 12px", borderRadius: 10, fontSize: 13, fontFamily: "inherit",
      border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
    }}>
      {meses.map((m) => <option key={m} value={m.slice(0, 7)}>{mesLongo(m)}</option>)}
    </select>
  );

  if (erro) return <PaginaNavy><Aviso>{erro}</Aviso></PaginaNavy>;
  if (!d) return <PaginaNavy><Carregando texto={carregando ? "Apurando…" : "Sem dados."} /></PaginaNavy>;

  const med = d.cenarios[1] ?? d.cenarios[0];
  const kpis: Kpi[] = [
    { rotulo: "RBT12", valor: kbrl(d.rbt12), sub: `${d.faixa}ª faixa${d.folgaFaixa !== null ? ` · ${kbrl(d.folgaFaixa)} até a seguinte` : ""}`, hero: true, title: brl(d.rbt12) },
    { rotulo: "DAS com o já faturado", valor: brl(d.realizado.das), sub: `sobre ${brl0(d.realizado.receitaDoMes)} de receita`, subTom: "warn" },
    ...(med ? [{ rotulo: "Projeção do fechamento", valor: brl0(med.das), sub: `${med.rotulo.toLowerCase()} · ${(med.efetiva * 100).toFixed(2).replace(".", ",")}%` }] : []),
    { rotulo: "Custo de cada R$ 1.000", valor: brl(d.custoPorMil.I), sub: `mercantil · serviço ${brl(d.custoPorMil[d.anexoServico])}` },
    { rotulo: "Alíquota efetiva do mês", valor: pct(d.realizado.efetivaMedia, 2), sub: `Anexo I ${pct(d.efetivas.I, 2)} · ${d.anexoServico} ${pct(d.efetivas[d.anexoServico], 2)}` },
    { rotulo: "Fator r", valor: d.fatorR === null ? "—" : `${(d.fatorR * 100).toFixed(2).replace(".", ",")}%`,
      sub: d.fatorR !== null && d.fatorR < 0.28 ? `abaixo de 28% → serviços no Anexo ${d.anexoServico}` : "≥ 28% → serviços no Anexo III",
      barra: d.fatorR === null ? undefined : { pct: Math.min(100, (d.fatorR / 0.28) * 100), tom: d.fatorR >= 0.28 ? "ok" : "warn" } },
  ];

  const conf = [...d.conferencia].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const colGraf = conf.map((c) => {
    const ok = c.diferenca !== null && Math.abs(c.diferenca) < 0.01;
    return {
      rotulo: mesCurto(c.competencia), topo: c.declarado == null ? "" : ok ? "confere" : kbrl(c.diferenca ?? 0).replace(" mil", "k"),
      topoCor: ok ? "var(--ww-accent-text)" : "var(--ww-warn-text)",
      title: `${mesLongo(c.competencia)} · calculado ${brl0(c.calculado)} · declarado ${c.declarado == null ? "—" : brl0(c.declarado)} · recibo fora ${brl0(c.recibo)}`,
      segs: [{ v: c.calculado, cor: "linear-gradient(180deg,var(--ww-brand-3),var(--ww-brand-1))", brilho: true }],
    };
  });

  const lado: Bloco[] = [
    { k: "m", rotulo: "Anexo I · mercadorias", valor: pct(d.efetivas.I), pct: Math.min(100, d.efetivas.I * 500), tom: "ok" },
    { k: "m", rotulo: `Anexo ${d.anexoServico} · serviços (fator r)`, valor: pct(d.efetivas[d.anexoServico]), pct: Math.min(100, d.efetivas[d.anexoServico] * 500), tom: "info" },
    { k: "m", rotulo: "Anexo III", valor: pct(d.efetivas.III), pct: Math.min(100, d.efetivas.III * 500), tom: "info" },
    { k: "t", t: `RBT12 ${brl(d.rbt12)} · folha 12m ${brl0(d.folha12)}\nCada R$ 1.000 de NF-e custa ${brl(d.custoPorMil.I)}; de OS com nota, ${brl(d.custoPorMil[d.anexoServico])}.\nEstes números não mudam até o dia 30 — dependem só de meses fechados.` },
    ...(d.mesesSemFolha > 0 ? [{ k: "i" as const, tom: "warn" as Tom, t: `Folha de ${d.mesesSemFolha} ${d.mesesSemFolha === 1 ? "mês" : "meses"} ainda não lançada`,
      s: "completei pela média para estimar o fator r — não muda o anexo" }] : []),
    ...d.cenarios.map((c) => ({ k: "i" as const, tom: "info" as Tom, t: `${c.rotulo} · ${brl0(c.das)}`,
      s: `mercantil ${brl0(c.mercantil)} · receita ${brl0(c.receita)} · ${(c.efetiva * 100).toFixed(2).replace(".", ",")}%` })),
  ];

  return (
    <PaginaNavy>
      <CabecalhoTela area="Financeiro" titulo="Simples Nacional"
        sub={<>RBT12 e fator r de meses fechados · base do mês = NF-e autorizadas + OS com nota · Omie sincronizado até {ddmm(d.sincronizado.nfe)} (NF-e) e {ddmm(d.sincronizado.os)} (OS)</>}
        acoes={<>{seletor}<BotaoTela onClick={() => void load()} disabled={carregando}>{carregando ? "…" : "Atualizar"}</BotaoTela></>} />

      <GradeKpis kpis={kpis} min={180} />

      <MeioTela
        grafico={<GraficoBarras titulo="Calculado (Omie) por competência · diferença para o PGDAS no topo" colunas={colGraf} />}
        lado={<PainelLateral titulo={`Definido para ${mesLongo(d.competencia)}`} blocos={lado} />} />

      <div><SegmentedControl value={bloco} onChange={(v) => setBloco(v as typeof bloco)} options={[
        { value: "memorial", label: "Memorial de cálculo" },
        { value: "notas", label: `Notas do mês · ${d.documentos.length}` },
        { value: "conferencia", label: "Conferência Omie × PGDAS" },
      ]} /></div>

      {bloco === "memorial" && <Memorial d={d} />}
      {bloco === "notas" && <Notas d={d} docs={docs} verRecibos={verRecibos} setVerRecibos={setVerRecibos} />}
      {bloco === "conferencia" && <Conferencia conf={d.conferencia} />}

      <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>
        Critério: mercantil = NF-e autorizadas (fora canceladas e devolvidas); serviço = OS faturadas com nota (OS de recibo não entra).
        Anexo III para {d.anexoIiiClientes.length} {d.anexoIiiClientes.length === 1 ? "cliente marcado" : "clientes marcados"} em finance.simples_anexo_iii.
        Conferido contra os extratos PGDAS de 07 e 08/2026.
      </div>
    </PaginaNavy>
  );
}

function Memorial({ d }: { d: Dados }) {
  type Linha = { a: Atividade };
  const colunas: ColunaNavy<Linha>[] = [
    { label: "Competência › atividade" },
    { label: "Anexo", texto: (l) => l.a.anexo },
    { label: "Base", align: "right", texto: (l) => brl(l.a.base), numero: (l) => l.a.base },
    { label: "Alíq. efetiva", align: "right", texto: (l) => pct(l.a.efetiva), numero: (l) => l.a.efetiva },
    { label: "Débito", align: "right", texto: (l) => brl(l.a.debito), numero: (l) => l.a.debito },
    ...TRIB.map((t) => ({ label: t, align: "right" as const, texto: (l: Linha) => (l.a.tributos[t] ? brl(l.a.tributos[t]) : "—"), numero: (l: Linha) => l.a.tributos[t] ?? 0 })),
  ];
  const montar = useCallback((ls: Linha[]): NoNavy[] => [{
    id: "das", nome: mesLongo(d.competencia), sub: "DAS · competência",
    cels: [cTexto([...new Set(d.realizado.atividades.map((a) => a.anexo))].join(" + ")), cTexto(brl(d.realizado.receitaDoMes), { peso: 600 }), cTexto(pct(d.realizado.efetivaMedia, 2)),
      cTexto(brl(d.realizado.das), { peso: 700 }), ...TRIB.map((t) => (d.realizado.tributos[t] ? cTexto(brl(d.realizado.tributos[t])) : cMudo("—")))],
    filhos: ls.map((l, i) => ({
      id: `at:${i}`, nome: l.a.rotulo, sub: l.a.issNoTeto ? "ISS no teto de 5% — excedente redistribuído" : `Anexo ${l.a.anexo}`,
      cels: [cTexto(`Anexo ${l.a.anexo}`, { cor: "var(--ww-text-2)" }), cTexto(brl(l.a.base)), cTexto(pct(l.a.efetiva)), cTexto(brl(l.a.debito), { peso: 600 }),
        ...TRIB.map((t) => (l.a.tributos[t] ? cTexto(brl(l.a.tributos[t]), { cor: "var(--ww-text-2)" }) : cMudo("—")))],
    })),
  }], [d]);
  return <ArvoreNavy titulo="Memorial de cálculo — o que já está faturado" dica="DAS = base × alíquota efetiva do anexo · os sete tributos repartidos"
    colunas={colunas} registros={d.realizado.atividades.map((a) => ({ a }))} montar={montar} abertosIniciais={["das"]}
    grid={"minmax(240px,1.5fr) 90px 120px 100px 120px " + TRIB.map(() => "100px").join(" ")} minWidth={1360}
    buscaNome={(l) => l.a.rotulo} />;
}

function Notas({ d, docs, verRecibos, setVerRecibos }: { d: Dados; docs: Doc[]; verRecibos: boolean; setVerRecibos: (v: boolean) => void }) {
  const colunas: ColunaNavy<Doc>[] = [
    { label: "Anexo › documento" },
    { label: "Data", texto: (x) => ddmm(x.data), numero: (x) => Date.parse(x.data) },
    { label: "Tipo", texto: (x) => x.tipo },
    { label: "Documento", texto: (x) => x.documento },
    { label: "Cliente", texto: (x) => x.cliente },
    { label: "Na base", texto: (x) => (x.na_base ? "sim" : "recibo · fora") },
    { label: "Valor", align: "right", texto: (x) => brl(x.valor), numero: (x) => x.valor },
  ];
  const montar = useCallback((xs: Doc[]): NoNavy[] => {
    const m = new Map<string, Doc[]>();
    for (const x of xs) (m.get(x.anexo) ?? m.set(x.anexo, []).get(x.anexo)!).push(x);
    return [...m.entries()].map(([a, l]) => ({
      id: `an:${a}`, nome: `Anexo ${a}`, sub: `${l.length} documento${l.length === 1 ? "" : "s"}`,
      cels: [cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""), cTexto(brl(l.filter((x) => x.na_base).reduce((t, x) => t + x.valor, 0)), { peso: 700 })],
      filhos: l.map((x, i) => ({ id: `doc:${a}:${i}`, nome: `${x.tipo} ${x.documento}`, sub: x.cliente, cels: [
        cTexto(ddmm(x.data)), cTexto(x.tipo), cTexto(x.documento), cTexto(x.cliente),
        x.na_base ? cPill("na base", "ok") : cPill("recibo · fora", "off"), cTexto(brl(x.valor), { peso: 600, cor: x.na_base ? undefined : "var(--ww-text-faint)" })] })),
    }));
  }, []);
  return <ArvoreNavy titulo="Notas do mês"
    dica={`${d.contagens.nfe} NF-e · ${d.contagens.osNota} OS com nota na base · ${d.contagens.osRecibo} OS por recibo fora dela (${brl0(d.bases.recibo)})`}
    colunas={colunas} registros={docs} montar={montar} abertosIniciais={["an:I"]}
    grid="minmax(220px,1.3fr) 70px 90px 110px minmax(220px,1.6fr) 110px 130px" minWidth={1100}
    buscaNome={(x) => `${x.documento} ${x.cliente}`} vazio="Nenhuma nota neste mês ainda."
    toolbar={<label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ww-text-2)", cursor: "pointer" }}>
      <input type="checkbox" checked={verRecibos} onChange={(e) => setVerRecibos(e.target.checked)} /> mostrar as OS de recibo</label>}
    rodape={(xs) => <span>{xs.length} documentos · na base <b style={{ color: "var(--ww-text)" }}>{brl(xs.filter((x) => x.na_base).reduce((t, x) => t + x.valor, 0))}</b></span>} />;
}

function Conferencia({ conf }: { conf: Conf[] }) {
  const colunas: ColunaNavy<Conf>[] = [
    { label: "Competência" },
    { label: "Calculado (Omie)", align: "right", texto: (c) => brl0(c.calculado), numero: (c) => c.calculado },
    { label: "Declarado (PGDAS)", align: "right", texto: (c) => (c.declarado == null ? "—" : brl0(c.declarado)), numero: (c) => c.declarado },
    { label: "Diferença", align: "right", texto: (c) => (c.diferenca == null ? "—" : Math.abs(c.diferenca) < 0.01 ? "confere" : brl0(c.diferenca)), numero: (c) => c.diferenca },
    { label: "OS por recibo (fora)", align: "right", texto: (c) => brl0(c.recibo), numero: (c) => c.recibo },
  ];
  const montar = useCallback((cs: Conf[]): NoNavy[] => cs.map((c) => {
    const ok = c.diferenca !== null && Math.abs(c.diferenca) < 0.01;
    return { id: c.competencia, nome: mesLongo(c.competencia), cels: [
      cTexto(brl0(c.calculado)), c.declarado == null ? cMudo("—") : cTexto(brl0(c.declarado)),
      c.diferenca == null ? cMudo("—") : ok ? cPill("confere", "ok") : cPill(brl0(c.diferenca), "warn"),
      cTexto(brl0(c.recibo), { cor: "var(--ww-text-2)" })] };
  }), []);
  return <ArvoreNavy titulo="Conferência — Omie × PGDAS" dica="Onde diverge, houve decisão do contador sobre alguma OS"
    colunas={colunas} registros={conf} montar={montar} grid="minmax(220px,1.4fr) repeat(4,minmax(140px,1fr))" minWidth={900} buscaNome={(c) => mesLongo(c.competencia)} />;
}
