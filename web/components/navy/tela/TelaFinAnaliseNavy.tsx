"use client";

/**
 * Abas Análise e Recebíveis da Visão financeira — porte Navy do que vivia em
 * components/bi/FinanceiroView.tsx. Mesma fonte (/api/bi/financeiro), mesmas
 * perguntas, mesmos números:
 *
 *  Análise — resumo em aberto dos dois lados · vencido por idade do atraso ·
 *  onde está o saldo aberto (vencido / 90d / futuro) · emitido × liquidado por
 *  mês · maiores contrapartes liquidadas · concentração do vencido por idade e
 *  a lista de contrapartes em atraso (8 colunas).
 *
 *  Recebíveis — coorte "do que faturei, quanto virou dinheiro" com escolha do
 *  mês, pior conversão, por tipo de venda e o detalhe por tipo em que todo
 *  valor abre a lista de documentos por trás dele (fat_coorte_detalhe), com a
 *  conferência "a lista soma o mesmo".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SegmentedControl, type Tom } from "../primitivos";
import {
  ArvoreNavy, Aviso, Carregando, ChipFiltro, FaixaFiltros, GradeKpis, GraficoBarras, MeioTela,
  PainelLateral, brl, brl0, cBarra, cMudo, cPill, cTexto, ddmmaa, kbrl, type Bloco, type ColunaNavy, type Kpi, type NoNavy,
} from "./KitTela";

type Faixa = { faixa: string; ord: number; qtd: number; valor: number };
type Horiz = { vencido: number; vence_no_horizonte: number; futuro_contratado: number; qtd_vencido: number; qtd_no_horizonte: number; qtd_futuro: number };
type Mensal = { mes: string; emitido: number; pago: number };
type Resumo = { saldo_aberto: number; qtd_titulos: number; a_vencer: number; em_atraso: number; esta_semana: number; prox_30_dias: number; total_pago_periodo: number };
type Coorte = { mes: string; faturado: number; recebido: number; a_vencer: number; vencido: number; sem_titulo: number; pct_recebido: number | null };
type CoorteCat = Coorte & { categoria: string };
type Top = { contraparte: string; valor: number; qtd: number };
type Atraso = { contraparte: string; cnpj: string | null; titulos: number; valor: number; atraso_max: number; atraso_medio: number;
  ate_30: number; de_31_90: number; mais_90: number; vencimento_mais_antigo: string | null };
export type FinPayload = {
  periodo: { from: string; to: string };
  aging: { sai: Faixa[]; entra: Faixa[] }; horizonte: { sai: Horiz[]; entra: Horiz[] };
  mensal: { sai: Mensal[]; entra: Mensal[] }; resumo: { sai: Resumo | null; entra: Resumo | null };
  coorte: Coorte[]; coorte_categoria: CoorteCat[]; top: { sai: Top[]; entra: Top[] }; atraso: { sai: Atraso[]; entra: Atraso[] };
};
type Lado = "ambos" | "receber" | "pagar";

const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesBr = (iso: string) => { const [a, m] = iso.slice(0, 7).split("-"); return `${MESES[Number(m) - 1]}/${a.slice(2)}`; };
const kk = (v: number) => kbrl(v).replace(" mil", "k");
const COR_R = "var(--ww-brand-3)", COR_P = "var(--ww-crit)";

export function useFinanceiro() {
  const [data, setData] = useState<FinPayload | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/bi/financeiro", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setData(j);
      } catch (e) { setErro((e as Error).message); }
    })();
  }, []);
  return { data, erro };
}

function SeletorLado({ lado, setLado }: { lado: Lado; setLado: (l: Lado) => void }) {
  return (
    <FaixaFiltros>
      <SegmentedControl value={lado} onChange={(v) => setLado(v as Lado)}
        options={[{ value: "ambos", label: "Ambos" }, { value: "receber", label: "Receber" }, { value: "pagar", label: "Pagar" }]} />
      <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ww-text-faint)" }}>Recebe <b>Safe</b> · paga <b>Safe + CDG + Water</b></span>
    </FaixaFiltros>
  );
}

function kpisResumo(data: FinPayload, lado: Lado): Kpi[] {
  const r = data.resumo.entra, p = data.resumo.sai, out: Kpi[] = [];
  if (lado !== "pagar" && r) out.push(
    { rotulo: "A receber — em aberto", valor: kbrl(r.saldo_aberto), sub: `${r.qtd_titulos} títulos`, subTom: "ok", title: brl(r.saldo_aberto) },
    { rotulo: "A receber — vencido", valor: kbrl(r.em_atraso), sub: `${kbrl(r.prox_30_dias)} vencem em 30 dias`, subTom: "ok", title: brl(r.em_atraso) });
  if (lado !== "receber" && p) out.push(
    { rotulo: "A pagar — em aberto", valor: kbrl(p.saldo_aberto), sub: `${p.qtd_titulos.toLocaleString("pt-BR")} títulos`, subTom: "crit", title: brl(p.saldo_aberto) },
    { rotulo: "A pagar — vencido", valor: kbrl(p.em_atraso), sub: `${kbrl(p.prox_30_dias)} vencem em 30 dias`, subTom: "crit", title: brl(p.em_atraso) });
  if (lado === "ambos" && r && p) out.unshift({ rotulo: "Saldo líquido em aberto", valor: kbrl(r.saldo_aberto - p.saldo_aberto), sub: "a receber menos a pagar, sem prazo", hero: true, title: brl(r.saldo_aberto - p.saldo_aberto) });
  else if (out[0]) out[0] = { ...out[0], hero: true };
  return out;
}

// ── Análise ─────────────────────────────────────────────────────────────────
export function AnaliseNavy({ data }: { data: FinPayload }) {
  const [lado, setLado] = useState<Lado>("ambos");
  const E = lado !== "pagar", S = lado !== "receber";
  const legenda = [...(E ? [{ nome: "A receber", cor: COR_R }] : []), ...(S ? [{ nome: "A pagar", cor: COR_P }] : [])];
  const segs = (e: number, s: number) => [...(E ? [{ v: e, cor: COR_R }] : []), ...(S ? [{ v: s, cor: COR_P }] : [])];

  // Aging dos dois lados no mesmo eixo; "a vencer"/"futuro" não são atraso.
  const faixas = useMemo(() => {
    const k = new Map<string, number>();
    for (const f of [...data.aging.sai, ...data.aging.entra]) if (!k.has(f.faixa)) k.set(f.faixa, f.ord);
    return [...k.entries()].sort((a, b) => a[1] - b[1]).map(([faixa]) => faixa).filter((f) => !/^a vencer|futuro/i.test(f));
  }, [data]);
  const aging = faixas.map((f) => {
    const e = data.aging.entra.find((x) => x.faixa === f), s = data.aging.sai.find((x) => x.faixa === f);
    return { rotulo: f, title: `${f} · receber ${brl0(n(e?.valor))} (${e?.qtd ?? 0}) · pagar ${brl0(n(s?.valor))} (${s?.qtd ?? 0})`, segs: segs(n(e?.valor), n(s?.valor)) };
  });
  const hs = data.horizonte.sai[0], he = data.horizonte.entra[0];
  const itensH = ([["Vencido", "vencido", "qtd_vencido"], ["No horizonte (90d)", "vence_no_horizonte", "qtd_no_horizonte"], ["Futuro contratado", "futuro_contratado", "qtd_futuro"]] as const)
    .flatMap(([rot, k, q]) => [
      ...(E && he ? [{ rot: `${rot} · receber`, v: n(he[k]), q: he[q], tom: "ok" as Tom }] : []),
      ...(S && hs ? [{ rot: `${rot} · pagar`, v: n(hs[k]), q: hs[q], tom: "crit" as Tom }] : []),
    ]);
  const mxH = Math.max(1, ...itensH.map((x) => x.v));
  const horiz: Bloco[] = itensH.map((x) => ({ k: "m", rotulo: x.rot, valor: kbrl(x.v), pct: (x.v / mxH) * 100, tom: x.tom, title: `${brl0(x.v)} · ${x.q} títulos` }));

  const meses = [...new Set([...data.mensal.entra, ...data.mensal.sai].map((m) => m.mes))].sort();
  const mensal = meses.map((m) => {
    const e = data.mensal.entra.find((x) => x.mes === m), s = data.mensal.sai.find((x) => x.mes === m);
    if (lado === "ambos") return { rotulo: mesBr(`${m}-01`), title: `${m} · emitido receber ${brl0(n(e?.emitido))} · pagar ${brl0(n(s?.emitido))}`, segs: segs(n(e?.emitido), n(s?.emitido)) };
    const f = lado === "receber" ? e : s;
    return { rotulo: mesBr(`${m}-01`), title: `${m} · emitido ${brl0(n(f?.emitido))} · ${lado === "receber" ? "recebido" : "pago"} ${brl0(n(f?.pago))}`,
      segs: [{ v: n(f?.emitido), cor: "var(--ww-brand-2)" }, { v: n(f?.pago), cor: lado === "receber" ? COR_R : "var(--ww-warn)" }] };
  });
  const top = lado === "receber" ? data.top.entra : data.top.sai;
  const mxT = Math.max(1, ...top.map((t) => n(t.valor)));

  return (<>
    <SeletorLado lado={lado} setLado={setLado} />
    <GradeKpis kpis={kpisResumo(data, lado)} min={200} />
    <MeioTela
      grafico={<GraficoBarras agrupado titulo="Vencido — por idade do atraso · os dois lados no mesmo eixo" colunas={aging} legenda={legenda} />}
      lado={<PainelLateral titulo="Onde está o saldo aberto" blocos={[...horiz,
        { k: "t", t: "O futuro contratado é grande e não é problema — só não é caixa de curto prazo." }]} />} />
    <MeioTela
      grafico={<GraficoBarras agrupado titulo={lado === "ambos" ? "Emitido por mês — receber × pagar" : `Emitido × ${lado === "receber" ? "recebido" : "pago"} por mês`}
        colunas={mensal} legenda={lado === "ambos" ? legenda : [{ nome: "Emitido", cor: "var(--ww-brand-2)" }, { nome: lado === "receber" ? "Recebido" : "Pago", cor: lado === "receber" ? COR_R : "var(--ww-warn)" }]} />}
      lado={<PainelLateral titulo={lado === "receber" ? "Maiores clientes — recebido no período" : "Maiores fornecedores — pago no período"}
        blocos={top.map((t) => ({ k: "m", rotulo: t.contraparte, valor: kbrl(n(t.valor)), pct: (n(t.valor) / mxT) * 100, tom: lado === "receber" ? "ok" : "crit", title: `${brl0(n(t.valor))} · ${t.qtd} títulos` }))} />} />
    <EmAtraso data={data} lado={lado} />
  </>);
}

function EmAtraso({ data, lado }: { data: FinPayload; lado: Lado }) {
  const somaR = data.atraso.entra.reduce((a, x) => a + n(x.valor), 0), somaP = data.atraso.sai.reduce((a, x) => a + n(x.valor), 0);
  // Em "ambos", mostra o lado com mais dinheiro parado — cliente que deve e
  // fornecedor a quem devo não se compensam num ranking.
  const ehPagar = lado === "pagar" || (lado === "ambos" && somaP >= somaR);
  const linhas = (ehPagar ? data.atraso.sai : data.atraso.entra).map((x) => ({ ...x, valor: n(x.valor) }));
  const total = linhas.reduce((a, x) => a + x.valor, 0), velho = linhas.reduce((a, x) => a + n(x.mais_90), 0);
  const top = linhas.slice(0, 12);
  const colunas: ColunaNavy<Atraso>[] = [
    { label: ehPagar ? "Fornecedor" : "Cliente" },
    { label: "Títulos", align: "right", texto: (x) => String(x.titulos), numero: (x) => x.titulos },
    { label: "Em atraso", align: "right", texto: (x) => brl0(x.valor), numero: (x) => x.valor },
    { label: "Até 30d", align: "right", texto: (x) => brl0(n(x.ate_30)), numero: (x) => n(x.ate_30) },
    { label: "31–90d", align: "right", texto: (x) => brl0(n(x.de_31_90)), numero: (x) => n(x.de_31_90) },
    { label: "90d+", align: "right", texto: (x) => brl0(n(x.mais_90)), numero: (x) => n(x.mais_90) },
    { label: "Pior atraso", align: "right", texto: (x) => `${x.atraso_max}d`, numero: (x) => x.atraso_max },
    { label: "Atraso médio", align: "right", texto: (x) => `${Math.round(n(x.atraso_medio))}d`, numero: (x) => n(x.atraso_medio) },
    { label: "Mais antigo", texto: (x) => ddmmaa(x.vencimento_mais_antigo), numero: (x) => (x.vencimento_mais_antigo ? Date.parse(x.vencimento_mais_antigo) : null) },
  ];
  const montar = useCallback((rs: Atraso[]): NoNavy[] => rs.map((x, i) => ({
    id: `a:${i}:${x.contraparte}`, nome: x.contraparte, sub: x.cnpj ?? undefined,
    cels: [cTexto(String(x.titulos)), cTexto(brl0(x.valor), { peso: 700 }), cTexto(brl0(n(x.ate_30))), cTexto(brl0(n(x.de_31_90))),
      n(x.mais_90) ? cTexto(brl0(n(x.mais_90)), { tom: "crit", peso: 600 }) : cMudo("—"),
      cPill(`${x.atraso_max}d`, x.atraso_max > 90 ? "crit" : x.atraso_max > 30 ? "warn" : "info"), cTexto(`${Math.round(n(x.atraso_medio))}d`, { cor: "var(--ww-text-2)" }),
      cTexto(ddmmaa(x.vencimento_mais_antigo), { cor: "var(--ww-text-2)" })],
  })), []);
  return (<>
    <Aviso tone={ehPagar ? "crit" : "ok"}>
      <b>{ehPagar ? "Fornecedores a quem devo" : "Clientes que me devem"}</b> · {brl0(total)} em atraso · {linhas.length} contrapartes
      {velho > 0 && <> · <b>{brl0(velho)}</b> com mais de 90 dias{total > 0 ? ` (${Math.round((velho / total) * 100)}%)` : ""}</>}
      {lado === "ambos" && " — use o seletor para ver o outro lado"}
    </Aviso>
    <GraficoBarras titulo={`Concentração do vencido — ${ehPagar ? "fornecedores" : "clientes"} · empilhado por idade do atraso`}
      legenda={[{ nome: "Até 30d", cor: "var(--ww-warn)" }, { nome: "31–90d", cor: "var(--ww-brand-2)" }, { nome: "90d+", cor: "var(--ww-crit)" }]}
      colunas={top.map((x) => ({ rotulo: x.contraparte.split(" ").slice(0, 2).join(" "), title: `${x.contraparte} · ${brl0(x.valor)}`, topo: kk(x.valor),
        segs: [{ v: n(x.ate_30), cor: "var(--ww-warn)" }, { v: n(x.de_31_90), cor: "var(--ww-brand-2)" }, { v: n(x.mais_90), cor: "var(--ww-crit)" }] }))} />
    <ArvoreNavy titulo={`${ehPagar ? "Fornecedores" : "Clientes"} em atraso — detalhe`} dica="Ordenado pelo valor parado · a coluna 90d+ separa o que é operacional do que virou passivo"
      colunas={colunas} registros={linhas} montar={montar} grid="minmax(260px,1.7fr) 70px 120px 110px 110px 120px 96px 104px 96px" minWidth={1200}
      buscaNome={(x) => `${x.contraparte} ${x.cnpj ?? ""}`} chave={ehPagar ? "p" : "r"}
      rodape={(rs) => <span>{rs.length} contrapartes · em atraso <b style={{ color: "var(--ww-text)" }}>{brl0(rs.reduce((a, x) => a + x.valor, 0))}</b> · 90d+ {brl0(rs.reduce((a, x) => a + n(x.mais_90), 0))}</span>} />
  </>);
}

// ── Recebíveis ──────────────────────────────────────────────────────────────
const BUCKETS: Record<string, string> = { faturado: "Faturado", recebido: "Recebido", a_vencer: "A vencer", vencido: "Vencido", sem_titulo: "Sem título" };
const COR_B: Record<string, string> = { recebido: COR_R, a_vencer: "var(--ww-brand-2)", vencido: COR_P, sem_titulo: "var(--ww-warn)" };

export function RecebiveisNavy({ data }: { data: FinPayload }) {
  const [mesSel, setMesSel] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ categoria: string | null; bucket: string; valor: number } | null>(null);
  const periodo = useMemo(() => {
    if (!mesSel) return data.periodo;
    const ini = mesSel.slice(0, 10), d = new Date(`${ini}T12:00:00`), fim = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const p2 = (x: number) => String(x).padStart(2, "0");
    return { from: ini, to: `${fim.getFullYear()}-${p2(fim.getMonth() + 1)}-${p2(fim.getDate())}` };
  }, [mesSel, data]);

  const porCat = useMemo(() => {
    const acc = new Map<string, { faturado: number; recebido: number; a_vencer: number; vencido: number; sem_titulo: number }>();
    for (const c of data.coorte_categoria.filter((c) => !mesSel || c.mes.slice(0, 7) === mesSel.slice(0, 7))) {
      const a = acc.get(c.categoria) ?? { faturado: 0, recebido: 0, a_vencer: 0, vencido: 0, sem_titulo: 0 };
      a.faturado += n(c.faturado); a.recebido += n(c.recebido); a.a_vencer += n(c.a_vencer); a.vencido += n(c.vencido); a.sem_titulo += n(c.sem_titulo);
      acc.set(c.categoria, a);
    }
    return [...acc.entries()].map(([categoria, v]) => ({ categoria, ...v, pct: v.faturado > 0 ? (v.recebido / v.faturado) * 100 : null })).sort((a, b) => b.faturado - a.faturado);
  }, [data, mesSel]);
  const pior = porCat.length ? porCat.reduce((m, c) => ((c.pct ?? 100) < (m.pct ?? 100) ? c : m)) : null;
  const tot = porCat.reduce((a, c) => ({ faturado: a.faturado + c.faturado, recebido: a.recebido + c.recebido, a_vencer: a.a_vencer + c.a_vencer, vencido: a.vencido + c.vencido, sem_titulo: a.sem_titulo + c.sem_titulo }),
    { faturado: 0, recebido: 0, a_vencer: 0, vencido: 0, sem_titulo: 0 });

  const kpis: Kpi[] = [
    { rotulo: `Faturado${mesSel ? ` · ${mesBr(mesSel)}` : " no período"}`, valor: kbrl(tot.faturado), hero: true, title: brl(tot.faturado), onClick: () => setDrill({ categoria: null, bucket: "faturado", valor: tot.faturado }),
      sub: tot.faturado ? `${((tot.recebido / tot.faturado) * 100).toFixed(1).replace(".", ",")}% já recebido` : undefined },
    ...(["recebido", "a_vencer", "vencido", "sem_titulo"] as const).map((b) => ({ rotulo: BUCKETS[b], valor: kbrl(tot[b]), dot: COR_B[b], title: `${brl(tot[b])} · clique para a lista`,
      sub: "clique para a lista", subTom: (b === "vencido" || b === "sem_titulo" ? "crit" : b === "recebido" ? "ok" : undefined) as Tom | undefined,
      onClick: () => setDrill({ categoria: null, bucket: b, valor: tot[b] }) })),
  ];

  const colunas: ColunaNavy<(typeof porCat)[number]>[] = [
    { label: "Tipo de venda" },
    ...(["faturado", "recebido", "a_vencer", "vencido", "sem_titulo"] as const).map((b) => ({ label: BUCKETS[b], align: "right" as const, texto: (c: (typeof porCat)[number]) => brl0(c[b]), numero: (c: (typeof porCat)[number]) => c[b] })),
    { label: "% recebido", texto: (c) => (c.pct == null ? "—" : `${c.pct.toFixed(1)}%`), numero: (c) => c.pct },
  ];
  const btnValor = (cat: string | null, b: string, v: number) => (
    <button type="button" onClick={(e) => { e.stopPropagation(); setDrill({ categoria: cat, bucket: b, valor: v }); }} title="Abrir os documentos por trás deste número" style={{
      background: "none", border: 0, padding: 0, cursor: v ? "pointer" : "default", fontFamily: "inherit", fontSize: 12.5, fontWeight: b === "faturado" ? 700 : 500,
      color: v ? (b === "vencido" || b === "sem_titulo" ? "var(--ww-crit-text)" : "var(--ww-text)") : "var(--ww-text-faint)", textDecoration: v ? "underline dotted" : "none", textUnderlineOffset: 3,
    }}>{brl0(v)}</button>
  );
  const montar = (cs: (typeof porCat)): NoNavy[] => cs.map((c) => ({
    id: `c:${c.categoria}`, nome: c.categoria,
    cels: [...(["faturado", "recebido", "a_vencer", "vencido", "sem_titulo"] as const).map((b) => btnValor(c.categoria, b, c[b])),
      c.pct == null ? cMudo("—") : cBarra(`${c.pct.toFixed(1).replace(".", ",")}%`, c.pct, c.pct >= 95 ? "ok" : c.pct >= 70 ? "warn" : "crit")],
  }));

  return (<>
    <GradeKpis kpis={kpis} min={180} />
    <GraficoBarras titulo="Do que faturei, quanto virou dinheiro · cada coluna é um mês de faturamento, repartido no destino do recebível — clique para escolher o mês"
      legenda={Object.entries(COR_B).map(([b, cor]) => ({ nome: BUCKETS[b], cor }))}
      colunas={data.coorte.map((c) => ({ rotulo: mesBr(c.mes), topo: c.pct_recebido == null ? kk(n(c.faturado)) : `${Math.round(n(c.pct_recebido))}%`,
        topoCor: c.pct_recebido == null ? undefined : n(c.pct_recebido) >= 95 ? "var(--ww-accent-text)" : n(c.pct_recebido) >= 70 ? "var(--ww-warn-text)" : "var(--ww-crit-text)",
        title: `${mesBr(c.mes)} · faturado ${brl0(n(c.faturado))} · recebido ${brl0(n(c.recebido))} · a vencer ${brl0(n(c.a_vencer))} · vencido ${brl0(n(c.vencido))} · sem título ${brl0(n(c.sem_titulo))}`,
        onClick: () => setMesSel(mesSel === c.mes ? null : c.mes),
        segs: (["recebido", "a_vencer", "vencido", "sem_titulo"] as const).map((b) => ({ v: n(c[b]), cor: COR_B[b] })) }))} />
    <FaixaFiltros>
      <ChipFiltro ativo={!mesSel} onClick={() => setMesSel(null)}>Todos os meses</ChipFiltro>
      {data.coorte.map((c) => <ChipFiltro key={c.mes} ativo={mesSel === c.mes} onClick={() => setMesSel(c.mes)} title={`${brl0(n(c.faturado))} faturado · ${c.pct_recebido ?? "—"}% recebido`}>
        {mesBr(c.mes)}{c.pct_recebido != null ? ` · ${Math.round(n(c.pct_recebido))}%` : ""}</ChipFiltro>)}
    </FaixaFiltros>
    {pior && <Aviso tone="warn">Pior conversão {mesSel ? `em ${mesBr(mesSel)}` : "no período"}: <b>{pior.categoria}</b> — {pior.pct?.toFixed(1).replace(".", ",")}% recebido de {brl0(pior.faturado)}, com <b>{brl0(pior.vencido)}</b> vencido.</Aviso>}
    <MeioTela
      grafico={<GraficoBarras titulo={`Por tipo de venda${mesSel ? ` — ${mesBr(mesSel)}` : ""} · onde o recebível trava`}
        colunas={porCat.map((c) => ({ rotulo: c.categoria, topo: c.pct == null ? "" : `${Math.round(c.pct)}%`, title: `${c.categoria} · faturado ${brl0(c.faturado)}`,
          segs: (["recebido", "a_vencer", "vencido", "sem_titulo"] as const).map((b) => ({ v: c[b], cor: COR_B[b] })) }))} />}
      lado={<PainelLateral titulo="Total do recorte" blocos={(["recebido", "a_vencer", "vencido", "sem_titulo"] as const).map((b) => ({
        k: "m", rotulo: BUCKETS[b], valor: kbrl(tot[b]), pct: tot.faturado ? (tot[b] / tot.faturado) * 100 : 0,
        tom: (b === "recebido" ? "ok" : b === "a_vencer" ? "info" : b === "vencido" ? "crit" : "warn") as Tom, title: brl(tot[b]) }))} />} />
    <ArvoreNavy titulo={`Detalhe por tipo${mesSel ? ` — ${mesBr(mesSel)}` : ""}`} dica="Os mesmos números do gráfico · todo valor é clicável e abre os documentos por trás dele"
      colunas={colunas} registros={porCat} montar={montar} grid="minmax(200px,1.3fr) repeat(5,minmax(120px,1fr)) 170px" minWidth={1100} buscaNome={(c) => c.categoria}
      rodape={() => (<>
        <span>Total: {(["faturado", "recebido", "a_vencer", "vencido", "sem_titulo"] as const).map((b, i) => (
          <span key={b}>{i ? " · " : ""}{BUCKETS[b]} {btnValor(null, b, tot[b])}</span>))}</span>
      </>)} />
    {drill && <Drill {...drill} from={periodo.from} to={periodo.to} fechar={() => setDrill(null)} />}
  </>);
}

type Doc = Record<string, unknown>;
function Drill({ categoria, bucket, valor, from, to, fechar }: { categoria: string | null; bucket: string; valor: number; from: string; to: string; fechar: () => void }) {
  const [linhas, setLinhas] = useState<Doc[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc);
  }, [fechar]);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const q = new URLSearchParams({ from, to, bucket }); if (categoria) q.set("categoria", categoria);
      try {
        const r = await fetch(`/api/bi/financeiro/detalhe?${q}`, { cache: "no-store" });
        const j = await r.json();
        if (!vivo) return;
        if (!r.ok) { setErro(j.error ?? r.statusText); return; }
        setLinhas(j.linhas);
      } catch (e) { if (vivo) setErro((e as Error).message); }
    })();
    return () => { vivo = false; };
  }, [categoria, bucket, from, to]);
  const somado = (linhas ?? []).reduce((a, l) => a + n(l[bucket]), 0), bate = Math.abs(somado - valor) < 0.5;
  const M = (k: string, label: string): ColunaNavy<Doc> => ({ label, align: "right", texto: (d) => brl0(n(d[k])), numero: (d) => n(d[k]) });
  const D = (k: string, label: string): ColunaNavy<Doc> => ({ label, texto: (d) => ddmmaa(d[k] as string | null), numero: (d) => (d[k] ? Date.parse(String(d[k])) : null) });
  const colunas: ColunaNavy<Doc>[] = [
    { label: "Cliente › documento" }, { label: "OS/PV", texto: (d) => String(d.num_os ?? "") }, { label: "Título", texto: (d) => String(d.num_titulo ?? "") },
    { label: "Parc.", align: "right", texto: (d) => String(d.parcelas ?? ""), numero: (d) => n(d.parcelas) },
    D("dt_fat", "Faturado em"), D("vencimento", "Vencimento"), D("previsao", "Previsão"),
    M("faturado", "Faturado"), M("recebido", "Recebido"), M("a_vencer", "A vencer"), M("vencido", "Vencido"),
    ...(bucket === "sem_titulo" ? [M("sem_titulo", "Sem título")] : []),
    { label: "Atraso", align: "right", texto: (d) => (d.atraso_dias == null ? "—" : `${d.atraso_dias}d`), numero: (d) => n(d.atraso_dias) },
    { label: "% receb.", align: "right", texto: (d) => (d.pct_recebido == null ? "—" : `${n(d.pct_recebido).toFixed(1).replace(".", ",")}%`), numero: (d) => n(d.pct_recebido) },
  ];
  const montar = (ds: Doc[]): NoNavy[] => {
    const g = new Map<string, Doc[]>();
    for (const d of ds) { const c = String(d.cliente ?? "—"); (g.get(c) ?? g.set(c, []).get(c)!).push(d); }
    return [...g.entries()].sort((a, b) => b[1].reduce((s, d) => s + n(d[bucket]), 0) - a[1].reduce((s, d) => s + n(d[bucket]), 0)).map(([c, l]) => ({
      id: `cl:${c}`, nome: c, sub: `${l.length} documento${l.length === 1 ? "" : "s"}`,
      cels: colunas.slice(1).map((col) => (col.align === "right" && col.label !== "Parc." && col.label !== "Atraso" && col.label !== "% receb."
        ? cTexto(brl0(l.reduce((s, d) => s + (col.numero?.(d) ?? 0), 0)), { peso: 600 }) : cMudo(""))),
      filhos: l.map((d, i) => ({ id: `cl:${c}:${i}`, nome: String(d.num_os ?? d.num_titulo ?? "doc"), cels: colunas.slice(1).map((col) => {
        const t = col.texto?.(d) ?? ""; return !t || t === "—" || t === "R$ 0" ? cMudo(t || "—") : cTexto(t, { cor: col.align === "right" ? undefined : "var(--ww-text-2)" });
      }) })),
    }));
  };
  return (
    <div onClick={fechar} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(5,10,25,.6)", display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(1300px,100%)", maxHeight: "90vh", overflow: "auto", display: "flex", flexDirection: "column", gap: 12,
        padding: 16, borderRadius: 20, background: "var(--ww-bg)", border: "1px solid var(--ww-border-strong)", boxShadow: "var(--shadow-float)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{BUCKETS[bucket]} — {categoria ?? "todos os tipos de venda"}</div>
            <div style={{ fontSize: 12, color: "var(--ww-text-muted)", marginTop: 2 }}>
              Uma linha por documento faturado, {from.slice(0, 10)} a {to.slice(0, 10)}. <b>OS/PV</b> é o número do faturamento; <b>Título</b> é o que o Omie mostra no Contas a Receber — são campos diferentes.
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{brl(valor)}</div>
            <div style={{ fontSize: 11.5, color: linhas == null ? "var(--ww-text-faint)" : bate ? "var(--ww-ok-text)" : "var(--ww-warn-text)" }}>
              {linhas == null ? "carregando…" : bate ? `✓ a lista soma o mesmo · ${linhas.length} documentos` : `⚠ lista soma ${brl(somado)}`}
            </div>
          </div>
          <button type="button" onClick={fechar} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid var(--ww-border-strong)", background: "transparent", color: "var(--ww-text-2)", cursor: "pointer" }}>✕</button>
        </div>
        {erro && <Aviso>{erro}</Aviso>}
        {linhas == null ? <Carregando /> : (
          <ArvoreNavy titulo="Documentos" dica="Cliente › documento · clique no cabeçalho para filtrar e ordenar" colunas={colunas} registros={linhas} montar={montar}
            grid={"minmax(240px,1.6fr) 80px 96px 56px 96px 96px 96px " + colunas.slice(7).map(() => "108px").join(" ")} minWidth={1360}
            buscaNome={(d) => `${d.cliente ?? ""} ${d.num_os ?? ""} ${d.num_titulo ?? ""}`}
            rodape={(ds) => <span>{ds.length} documentos · {BUCKETS[bucket].toLowerCase()} <b style={{ color: "var(--ww-text)" }}>{brl(ds.reduce((s, d) => s + n(d[bucket]), 0))}</b></span>} />
        )}
      </div>
    </div>
  );
}
