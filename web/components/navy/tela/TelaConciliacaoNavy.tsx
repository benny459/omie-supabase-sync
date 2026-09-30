"use client";

/**
 * Conciliação — recriação Navy (protótipo "Painel Allka finance").
 *
 * O protótipo desenha a conciliação BANCÁRIA: Conta › dia › lançamento, com o
 * estado de cada lançamento. A tela que existia no painel faz outra conciliação
 * — faturamento × contas a receber (cards 63/88/108/167 do Metabase). As duas
 * perguntas são reais e diferentes, por isso ficam as duas, numa troca no topo:
 *
 *  - Bancária: finance.v_extratos_consolidado. A situação (Conciliado, Não
 *    conciliado, Previsto) é a do Omie; o painel não decide o match. O match
 *    automático "valor + data ±2d" e as regras do modelo ficam de fora até
 *    existirem — mostrá-los seria inventar um motor que não temos.
 *  - Faturamento × AR: os quatro blocos da tela antiga (resumo, sem título,
 *    anomalias, detalhe) com todas as colunas e os mesmos filtros de período,
 *    empresa e categoria de venda.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SegmentedControl, type Tom } from "../primitivos";
import {
  ArvoreNavy, Aviso, CabecalhoTela, CampoData, Carregando, ChipFiltro, FaixaFiltros, GradeKpis,
  GraficoBarras, MeioTela, PaginaNavy, PainelLateral, brl, cMudo, cPill, cTexto, ddmm, ddmmaa,
  diaSemana, hojeISO, kbrl, somaDias, type ColunaNavy, type Kpi, type NoNavy,
} from "./KitTela";

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const txt = (v: unknown) => (v == null ? "" : String(v).trim());

type Lanc = {
  fonte: string; empresa: string; cod_conta_corrente: number; descricao_cc: string | null; data: string;
  natureza: string | null; situacao: string | null; cod_categoria: string | null; des_categoria: string | null;
  valor: number; fornecedor: string | null; tipo_documento: string | null; numero: string | null; obs: string | null;
};
type Conta = { empresa: string; cod_conta: number; conta: string; saldo: number | string; dt_ultimo: string | null };

const SIT: Record<string, { tom: Tom; cor: string }> = {
  "Conciliado": { tom: "ok", cor: "var(--ww-brand-2)" },
  "Não conciliado": { tom: "crit", cor: "var(--ww-crit)" },
  "Previsto": { tom: "warn", cor: "var(--ww-warn)" },
};
const sitDe = (s: string | null) => SIT[s ?? ""] ?? { tom: "off" as Tom, cor: "var(--ww-off)" };

type Periodo = "mes" | "mes1" | "d30" | "ano" | "livre";
function faixa(p: Periodo, de: string, ate: string): [string, string] {
  const h = hojeISO();
  if (p === "mes") return [h.slice(0, 8) + "01", h];
  if (p === "mes1") {
    const d = new Date(h.slice(0, 8) + "01T12:00:00Z"); d.setUTCDate(0);
    const fim = d.toISOString().slice(0, 10); return [fim.slice(0, 8) + "01", fim];
  }
  if (p === "d30") return [somaDias(h, -30), h];
  if (p === "ano") return [h.slice(0, 4) + "-01-01", h];
  return [de, ate];
}

export default function TelaConciliacaoNavy() {
  const [aba, setAba] = useState<"banco" | "faturamento">("banco");
  return (
    <PaginaNavy>
      <CabecalhoTela area="Financeiro" titulo="Conciliação"
        sub={aba === "banco"
          ? "Lançamentos de finance.v_extratos_consolidado · situação de conciliação do Omie · saldos de bi.saldo_por_conta"
          : "Toda NF faturada virou título no contas a receber, pelo mesmo valor? · cards 63, 88, 108 e 167 do Metabase"}
        acoes={<SegmentedControl value={aba} onChange={(v) => setAba(v as typeof aba)}
          options={[{ value: "banco", label: "Bancária" }, { value: "faturamento", label: "Faturamento × AR" }]} />} />
      {aba === "banco" ? <Bancaria /> : <FaturamentoAR />}
    </PaginaNavy>
  );
}

// ── Bancária ────────────────────────────────────────────────────────────────
function Bancaria() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [de, setDe] = useState(() => hojeISO().slice(0, 8) + "01");
  const [ate, setAte] = useState(hojeISO());
  const [dados, setDados] = useState<{ lancamentos: Lanc[]; contas: Conta[]; truncado: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [empresa, setEmpresa] = useState("");
  const [sits, setSits] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [verTodas, setVerTodas] = useState(false);
  const [from, to] = faixa(periodo, de, ate);

  useEffect(() => {
    const ctrl = new AbortController();
    setDados(null); setErro(null);
    (async () => {
      try {
        const r = await fetch(`/api/financeiro/extratos?from=${from}&to=${to}`, { signal: ctrl.signal, cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setDados(j);
      } catch (e) { if ((e as Error).name !== "AbortError") setErro((e as Error).message); }
    })();
    return () => ctrl.abort();
  }, [from, to]);

  const empresas = useMemo(() => [...new Set((dados?.lancamentos ?? []).map((l) => l.empresa))].sort(), [dados]);
  const base = useMemo(() => {
    let l = dados?.lancamentos ?? [];
    if (empresa) l = l.filter((x) => x.empresa === empresa);
    if (sits.length) l = l.filter((x) => sits.includes(x.situacao ?? "—"));
    const n = q.trim().toLowerCase();
    if (n) l = l.filter((x) => [x.fornecedor, x.descricao_cc, x.des_categoria, x.numero, x.obs, x.tipo_documento]
      .some((v) => (v ?? "").toLowerCase().includes(n)));
    return l;
  }, [dados, empresa, sits, q]);

  const por = (s: string) => base.filter((l) => l.situacao === s);
  const conc = por("Conciliado"), nao = por("Não conciliado"), prev = por("Previsto");
  const soma = (l: Lanc[]) => l.reduce((t, x) => t + num(x.valor), 0);
  const somaAbs = (l: Lanc[]) => l.reduce((t, x) => t + Math.abs(num(x.valor)), 0);
  /* Previsto é lançamento agendado que ainda não aconteceu — não há o que
     conciliar. A percentagem conta só o realizado (conciliado + não). */
  const realizados = conc.length + nao.length;
  const pctConc = realizados ? Math.round((conc.length / realizados) * 100) : 0;
  const nContas = new Set(base.map((l) => `${l.empresa}:${l.cod_conta_corrente}`)).size;

  const kpis: Kpi[] = [
    { rotulo: "Lançamentos no período", valor: base.length.toLocaleString("pt-BR"), sub: `${nContas} contas · ${ddmm(from)} a ${ddmm(to)}` },
    { rotulo: "Conciliados", valor: `${pctConc}%`, sub: `${conc.length.toLocaleString("pt-BR")} de ${realizados.toLocaleString("pt-BR")} realizados`, hero: true,
      barra: { pct: pctConc, tom: "ok" } },
    { rotulo: "Não conciliados", valor: nao.length.toLocaleString("pt-BR"), sub: `${kbrl(somaAbs(nao))} a vincular`, subTom: "crit",
      onClick: () => setSits(["Não conciliado"]) },
    { rotulo: "Previstos", valor: prev.length.toLocaleString("pt-BR"), sub: `${kbrl(somaAbs(prev))} ainda não realizados`, subTom: "warn",
      onClick: () => setSits(["Previsto"]) },
    { rotulo: "Saldo do período", valor: kbrl(soma(base)), sub: `entradas ${kbrl(soma(base.filter((l) => num(l.valor) > 0)))} · saídas ${kbrl(-soma(base.filter((l) => num(l.valor) < 0)))}`,
      title: brl(soma(base)) },
  ];

  const colunasGraf = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const l of base) {
      const a = m.get(l.data) ?? {}; a[l.situacao ?? "—"] = (a[l.situacao ?? "—"] ?? 0) + 1; m.set(l.data, a);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-31).map(([d, a]) => {
      const pend = (a["Não conciliado"] ?? 0) + (a["Previsto"] ?? 0);
      return {
        rotulo: ddmm(d), title: `${ddmm(d)} · ${diaSemana(d)} · ${Object.entries(a).map(([k, v]) => `${k}: ${v}`).join(" · ")}`,
        topo: pend ? `${pend} pend.` : "", topoCor: pend > 5 ? "var(--ww-warn-text)" : "var(--ww-text-faint)",
        segs: [{ v: a["Conciliado"] ?? 0, cor: SIT.Conciliado.cor }, { v: a["Previsto"] ?? 0, cor: SIT.Previsto.cor },
               { v: a["Não conciliado"] ?? 0, cor: SIT["Não conciliado"].cor }],
      };
    });
  }, [base]);

  const contasLado = useMemo(() => {
    const cs = (dados?.contas ?? []).filter((c) => num(c.saldo) !== 0 && (!empresa || c.empresa === empresa))
      .sort((a, b) => num(b.saldo) - num(a.saldo));
    const mx = Math.max(1, ...cs.map((c) => Math.abs(num(c.saldo))));
    const total = cs.reduce((t, c) => t + num(c.saldo), 0);
    const vis = verTodas ? cs : cs.slice(0, 10);
    return [
      ...vis.map((c) => ({ k: "m" as const, rotulo: `${c.empresa} · ${c.conta}`, valor: kbrl(num(c.saldo)),
        pct: (Math.abs(num(c.saldo)) / mx) * 100, tom: (num(c.saldo) < 0 ? "crit" : "info") as Tom,
        title: `${c.conta} · ${brl(num(c.saldo))} · último movimento ${ddmmaa(c.dt_ultimo)}` })),
      { k: "t" as const, t: `Total ${brl(total)} · ${cs.length} contas com saldo · zeradas ocultas` },
    ];
  }, [dados, empresa, verTodas]);
  const nContasSaldo = (dados?.contas ?? []).filter((c) => num(c.saldo) !== 0 && (!empresa || c.empresa === empresa)).length;

  const colunas: ColunaNavy<Lanc>[] = useMemo(() => [
    { label: "Conta › dia › lançamento" },
    { label: "Emp.", texto: (l) => l.empresa },
    { label: "Tipo", texto: (l) => (num(l.valor) >= 0 ? "Crédito" : "Débito") },
    { label: "Categoria", texto: (l) => [l.cod_categoria, l.des_categoria].filter(Boolean).join(" ") },
    { label: "Documento", texto: (l) => [l.tipo_documento, l.numero].filter(Boolean).join(" · ") },
    { label: "Fonte", texto: (l) => (l.fonte === "cs_import" ? "Conta Simples" : "Omie") },
    { label: "Situação", texto: (l) => l.situacao ?? "—" },
    { label: "Valor", align: "right", texto: (l) => brl(num(l.valor)), numero: (l) => num(l.valor) },
  ], []);

  const montar = useCallback((ls: Lanc[]): NoNavy[] => {
    const porConta = new Map<string, Lanc[]>();
    for (const l of ls) { const k = `${l.empresa}:${l.cod_conta_corrente}`; (porConta.get(k) ?? porConta.set(k, []).get(k)!).push(l); }
    const resumoPill = (l: Lanc[]) => {
      const n = l.filter((x) => x.situacao === "Não conciliado").length, p = l.filter((x) => x.situacao === "Previsto").length;
      if (n) return cPill(`${n} não conciliado${n === 1 ? "" : "s"}`, "crit", p ? `${p} previsto${p === 1 ? "" : "s"}` : undefined);
      if (p) return cPill(`${p} previsto${p === 1 ? "" : "s"}`, "warn");
      return cPill("Tudo conciliado", "ok");
    };
    return [...porConta.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, l]) => {
      const porDia = new Map<string, Lanc[]>();
      for (const x of l) (porDia.get(x.data) ?? porDia.set(x.data, []).get(x.data)!).push(x);
      return {
        id: `c:${k}`, nome: `${l[0].empresa} · ${l[0].descricao_cc ?? l[0].cod_conta_corrente}`, sub: `${l.length} lançamentos`,
        cels: [cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""), resumoPill(l), cTexto(brl(soma(l)), { peso: 700 })],
        filhos: [...porDia.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([d, ld]) => ({
          id: `c:${k}:${d}`, nome: `${ddmm(d)} · ${diaSemana(d)}`, sub: `${ld.length} lançamento${ld.length === 1 ? "" : "s"}`,
          cels: [cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""), resumoPill(ld), cTexto(brl(soma(ld)), { peso: 600 })],
          filhos: ld.map((x, i) => {
            const s = sitDe(x.situacao), v = num(x.valor);
            return {
              id: `c:${k}:${d}:${i}`, nome: x.fornecedor || x.des_categoria || "Lançamento",
              sub: v >= 0 ? "crédito" : "débito", title: x.obs ?? undefined,
              cels: [
                cTexto(x.empresa, { cor: "var(--ww-text-2)" }), cTexto(v >= 0 ? "Crédito" : "Débito", { cor: "var(--ww-text-2)" }),
                cTexto(x.des_categoria || "—", { sub: x.cod_categoria ?? undefined }),
                cTexto(x.numero || "—", { sub: x.tipo_documento ?? undefined }),
                cMudo(x.fonte === "cs_import" ? "Conta Simples" : "Omie"),
                cPill(x.situacao ?? "—", s.tom),
                cTexto(brl(v), { tom: v >= 0 ? "ok" : "crit", peso: 600 }),
              ],
            };
          }),
        })),
      };
    });
  }, []);

  return (<>
    <FaixaFiltros busca={q} onBusca={setQ} placeholder="Fornecedor, conta, categoria, documento…">
      {([["mes", "Mês corrente"], ["mes1", "−1 mês"], ["d30", "30 dias"], ["ano", "Ano"], ["livre", "De / Até"]] as const).map(([k, l]) => (
        <ChipFiltro key={k} ativo={periodo === k} onClick={() => setPeriodo(k)}>{l}</ChipFiltro>
      ))}
      {periodo === "livre" && (<><CampoData valor={de} onChange={setDe} /><CampoData valor={ate} onChange={setAte} /></>)}
      {["Conciliado", "Não conciliado", "Previsto"].map((s) => (
        <ChipFiltro key={s} ativo={sits.includes(s)} onClick={() => setSits((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>{s}</ChipFiltro>
      ))}
      {empresas.length > 1 && (<>
        <ChipFiltro ativo={!empresa} onClick={() => setEmpresa("")}>Todas</ChipFiltro>
        {empresas.map((e) => <ChipFiltro key={e} ativo={empresa === e} onClick={() => setEmpresa(empresa === e ? "" : e)}>{e}</ChipFiltro>)}
      </>)}
    </FaixaFiltros>
    {erro && <Aviso>Erro ao carregar: {erro}</Aviso>}
    {!dados ? <Carregando texto="Carregando extratos…" /> : (<>
      {dados.truncado && <Aviso tone="warn">Período grande: lista cortada em 20 mil lançamentos. Estreite as datas.</Aviso>}
      <GradeKpis kpis={kpis} min={180} />
      <MeioTela
        grafico={<GraficoBarras titulo="Conciliação por dia (lançamentos)" colunas={colunasGraf}
          legenda={[{ nome: "Conciliados", cor: SIT.Conciliado.cor }, { nome: "Previstos", cor: SIT.Previsto.cor }, { nome: "Não conciliados", cor: SIT["Não conciliado"].cor }]} />}
        lado={<PainelLateral titulo="Saldos por conta" blocos={contasLado}
          extra={nContasSaldo > 10 ? <button type="button" onClick={() => setVerTodas((v) => !v)} style={{ fontSize: 11.5, background: "none", border: 0, color: "var(--ww-accent-text)", cursor: "pointer", textDecoration: "underline" }}>{verTodas ? "só as 10 maiores" : `ver as ${nContasSaldo}`}</button> : undefined} />}
      />
      <ArvoreNavy<Lanc>
        titulo="Conta › dia › lançamento"
        dica="A situação é a do Omie · passe o rato na linha para ver a observação do lançamento"
        colunas={colunas} registros={base} montar={montar}
        grid="minmax(280px,1.8fr) 84px 90px minmax(170px,1.3fr) minmax(150px,1.1fr) 110px 140px 130px"
        minWidth={1180}
        buscaNome={(l) => `${l.descricao_cc ?? ""} ${l.fornecedor ?? ""}`}
        rodape={(ls) => (<>
          <span>{ls.length.toLocaleString("pt-BR")} lançamentos · saldo <b style={{ color: "var(--ww-text)" }}>{brl(soma(ls))}</b></span>
          <span>Linhas de saldo do extrato (valor 0) não entram</span>
        </>)}
      />
    </>)}
  </>);
}

// ── Faturamento × AR (tela antiga, no esqueleto Navy) ───────────────────────
type ResumoRow = { bucket: string; qtd_os: number | null; soma_faturado: number; soma_emitido: number; diferenca: number };
type SemTituloRow = { dt_fat: string | null; documento: string; cliente: string; categoria: string; valor_faturado: number; dias_sem_titulo: number | null };
type AnomaliaRow = { tipo: string; situacao: string; documento: string; cliente: string; categoria: string; dt_nf: string | null; dt_titulo: string | null; gap_dias: number | null; valor: number; contrib_gap: number };
type DetalheRow = { status: string; documento: string; cliente: string; categoria: string; dt_fat: string | null; dt_emissao: string | null; primeiro_venc: string | null; primeiro_pgto: string | null; gap_dias: number | null; parcelas: number | null; valor: number; pago: number | null; aberto: number | null };
type Payload = { resumo: ResumoRow[]; sem_titulo: SemTituloRow[]; detalhe: DetalheRow[]; anomalias: AnomaliaRow[] };

const EMPRESAS = ["SF", "CD", "WW"];
const CATS = ["Contratuais", "Projetos", "Revenda", "Avulsos", "BOT/SW", "Outras"];
const tomBucket = (b: string): Tom => (b.startsWith("Conciliado") ? "ok" : b.startsWith("Sem título") ? "crit" : "warn");

function agrupar<R>(rs: R[], chave: (r: R) => string, prefixo: string, sub: (l: R[]) => string,
                    cels: (l: R[]) => ReactNodeArr, folha: (r: R, i: number) => NoNavy): NoNavy[] {
  const m = new Map<string, R[]>();
  for (const r of rs) { const k = chave(r) || "—"; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return [...m.entries()].map(([k, l]) => ({ id: `${prefixo}:${k}`, nome: k, sub: sub(l), cels: cels(l), filhos: l.map(folha) }));
}
type ReactNodeArr = React.ReactNode[];

function FaturamentoAR() {
  const [periodo, setPeriodo] = useState<Periodo>("ano");
  const [de, setDe] = useState(() => hojeISO().slice(0, 4) + "-01-01");
  const [ate, setAte] = useState(hojeISO());
  const [empresas, setEmpresas] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [data, setData] = useState<Payload | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [bloco, setBloco] = useState<"sem" | "anom" | "det">("sem");
  const [from, to] = faixa(periodo, de, ate);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null); setErro(null);
    (async () => {
      try {
        const qs = new URLSearchParams({ from, to });
        if (empresas.length) qs.set("empresas", empresas.join(","));
        if (cats.length) qs.set("cat", cats.join(","));
        const r = await fetch(`/api/bi/conciliacao?${qs}`, { cache: "no-store", signal: ctrl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setData(j);
      } catch (e) { if ((e as Error).name !== "AbortError") setErro((e as Error).message); }
    })();
    return () => ctrl.abort();
  }, [from, to, empresas, cats]);

  // Os números saem do resumo, como na tela antiga: recalcular por fora podia
  // divergir da lista logo abaixo.
  const k = useMemo(() => {
    const rs = data?.resumo ?? [];
    const s = (pred: (b: string) => boolean, c: keyof ResumoRow) => rs.filter((r) => pred(r.bucket)).reduce((t, r) => t + num(r[c]), 0);
    const faturado = rs.reduce((t, r) => t + num(r.soma_faturado), 0), emitido = rs.reduce((t, r) => t + num(r.soma_emitido), 0);
    const conciliado = s((b) => b.startsWith("Conciliado"), "soma_faturado");
    return { faturado, emitido, gap: faturado - emitido, semTitulo: s((b) => b.startsWith("Sem título"), "soma_faturado"),
      qtdSem: s((b) => b.startsWith("Sem título"), "qtd_os"), pct: faturado > 0 ? (conciliado / faturado) * 100 : null };
  }, [data]);

  const kpis: Kpi[] = [
    { rotulo: "Faturado no período", valor: kbrl(k.faturado), sub: "vendas, categoria de receita", hero: true, title: brl(k.faturado) },
    { rotulo: "Emitido no AR", valor: kbrl(k.emitido), sub: "títulos a receber, não cancelados", title: brl(k.emitido) },
    { rotulo: "Gap faturado − emitido", valor: kbrl(k.gap), sub: Math.abs(k.gap) < 1 ? "fechado" : "diferença a explicar abaixo",
      subTom: Math.abs(k.gap) < 1 ? "ok" : "warn", title: brl(k.gap) },
    { rotulo: "Faturado sem título", valor: kbrl(k.semTitulo), sub: k.qtdSem ? `${k.qtdSem} nota(s) — nunca entrou na cobrança` : "nenhuma nota sem título",
      subTom: k.qtdSem ? "crit" : "ok", title: brl(k.semTitulo), onClick: () => setBloco("sem") },
    ...(k.pct != null ? [{ rotulo: "Conciliado", valor: `${Math.round(k.pct)}%`, sub: "do faturado bate com o AR", barra: { pct: k.pct, tom: "ok" as Tom } }] : []),
  ];

  const resumoLado = useMemo(() => {
    const rs = [...(data?.resumo ?? [])].sort((a, b) => num(b.soma_faturado) - num(a.soma_faturado));
    const mx = Math.max(1, ...rs.map((r) => Math.abs(num(r.soma_faturado)) || Math.abs(num(r.soma_emitido))));
    return rs.map((r) => ({ k: "m" as const, rotulo: `${r.bucket}${r.qtd_os ? ` · ${r.qtd_os} OS` : ""}`,
      valor: kbrl(num(r.soma_faturado) || num(r.soma_emitido)),
      pct: ((Math.abs(num(r.soma_faturado)) || Math.abs(num(r.soma_emitido))) / mx) * 100, tom: tomBucket(r.bucket),
      title: `Faturado ${brl(num(r.soma_faturado))} · Emitido AR ${brl(num(r.soma_emitido))} · Diferença ${brl(num(r.diferenca))}` }));
  }, [data]);

  const toggle = (arr: string[], v: string, set: (x: string[]) => void) => set(arr.includes(v) ? arr.filter((y) => y !== v) : [...arr, v]);

  return (<>
    <FaixaFiltros>
      {([["mes", "Mês corrente"], ["mes1", "−1 mês"], ["d30", "30 dias"], ["ano", "Ano até hoje"], ["livre", "De / Até"]] as const).map(([kk, l]) => (
        <ChipFiltro key={kk} ativo={periodo === kk} onClick={() => setPeriodo(kk)}>{l}</ChipFiltro>
      ))}
      {periodo === "livre" && (<><CampoData valor={de} onChange={setDe} /><CampoData valor={ate} onChange={setAte} /></>)}
      {EMPRESAS.map((e) => <ChipFiltro key={e} ativo={empresas.includes(e)} onClick={() => toggle(empresas, e, setEmpresas)}>{e}</ChipFiltro>)}
      {CATS.map((c) => <ChipFiltro key={c} ativo={cats.includes(c)} onClick={() => toggle(cats, c, setCats)}>{c}</ChipFiltro>)}
    </FaixaFiltros>
    {erro && <Aviso>{erro}</Aviso>}
    {!data ? <Carregando /> : (<>
      <GradeKpis kpis={kpis} min={190} />
      {/* Sem gráfico aqui, como na tela antiga: são dois ou três baldes, e a
          barra não ajuda a achar QUAL nota ficou sem título — a lista ajuda. */}
      <PainelLateral titulo="Resumo por situação" blocos={[...resumoLado,
        { k: "t", t: "Cada NF do período comparada com a soma dos títulos da mesma OS. Passe o rato para ver faturado, emitido e diferença." }]} />
      <div><SegmentedControl value={bloco} onChange={(v) => setBloco(v as typeof bloco)} options={[
        { value: "sem", label: `Sem título · ${data.sem_titulo.length}` },
        { value: "anom", label: `Anomalias · ${data.anomalias.length}` },
        { value: "det", label: `Detalhe · ${data.detalhe.length}` },
      ]} /></div>
      {bloco === "sem" && <ArvoreSemTitulo rows={data.sem_titulo} />}
      {bloco === "anom" && <ArvoreAnomalias rows={data.anomalias} />}
      {bloco === "det" && <ArvoreDetalhe rows={data.detalhe} />}
    </>)}
  </>);
}

function ArvoreSemTitulo({ rows }: { rows: SemTituloRow[] }) {
  const colunas: ColunaNavy<SemTituloRow>[] = [
    { label: "Categoria › NF" },
    { label: "Dt. NF", texto: (r) => ddmmaa(r.dt_fat), numero: (r) => (r.dt_fat ? Date.parse(r.dt_fat) : null) },
    { label: "PV/OS", texto: (r) => r.documento },
    { label: "Cliente", texto: (r) => r.cliente },
    { label: "Parado há", align: "right", texto: (r) => (r.dias_sem_titulo == null ? "—" : `${r.dias_sem_titulo}d`), numero: (r) => r.dias_sem_titulo },
    { label: "Faturado", align: "right", texto: (r) => brl(num(r.valor_faturado)), numero: (r) => num(r.valor_faturado) },
  ];
  const montar = useCallback((rs: SemTituloRow[]) => agrupar(rs, (r) => r.categoria, "st",
    (l) => `${l.length} nota${l.length === 1 ? "" : "s"}`,
    (l) => [cMudo(""), cMudo(""), cMudo(""), cMudo(""), cTexto(brl(l.reduce((t, r) => t + num(r.valor_faturado), 0)), { peso: 700 })],
    (r, i) => ({ id: `st:${r.documento}:${i}`, nome: r.documento, sub: r.cliente, cels: [
      cTexto(ddmmaa(r.dt_fat)), cTexto(r.documento), cTexto(r.cliente),
      r.dias_sem_titulo == null ? cMudo("—") : cPill(`${r.dias_sem_titulo}d`, r.dias_sem_titulo > 60 ? "crit" : r.dias_sem_titulo > 15 ? "warn" : "info"),
      cTexto(brl(num(r.valor_faturado)), { peso: 600 })] })), []);
  return <ArvoreNavy titulo="Faturado sem título no contas a receber" dica="NF emitida nas vendas que não gerou título — dinheiro fora da régua de cobrança"
    colunas={colunas} registros={rows} montar={montar} grid="minmax(240px,1.4fr) 90px 100px minmax(220px,1.6fr) 100px 130px"
    buscaNome={(r) => `${r.categoria} ${r.documento} ${r.cliente}`}
    rodape={(rs) => <span>{rs.length} notas · <b style={{ color: "var(--ww-text)" }}>{brl(rs.reduce((t, r) => t + num(r.valor_faturado), 0))}</b></span>} />;
}

function ArvoreAnomalias({ rows }: { rows: AnomaliaRow[] }) {
  const colunas: ColunaNavy<AnomaliaRow>[] = [
    { label: "Anomalia › PV/OS" },
    { label: "Cliente", texto: (r) => r.cliente },
    { label: "Categoria", texto: (r) => r.categoria },
    { label: "Dt. NF", texto: (r) => ddmmaa(r.dt_nf), numero: (r) => (r.dt_nf ? Date.parse(r.dt_nf) : null) },
    { label: "Dt. título", texto: (r) => ddmmaa(r.dt_titulo), numero: (r) => (r.dt_titulo ? Date.parse(r.dt_titulo) : null) },
    { label: "Gap", align: "right", texto: (r) => (r.gap_dias == null ? "—" : `${r.gap_dias}d`), numero: (r) => r.gap_dias },
    { label: "Situação", texto: (r) => r.situacao },
    { label: "Valor", align: "right", texto: (r) => brl(num(r.valor)), numero: (r) => num(r.valor) },
    { label: "Contrib.", align: "right", texto: (r) => brl(num(r.contrib_gap)), numero: (r) => num(r.contrib_gap) },
  ];
  const montar = useCallback((rs: AnomaliaRow[]) => agrupar(rs, (r) => r.tipo, "an",
    (l) => `${l.length} caso${l.length === 1 ? "" : "s"}`,
    (l) => [cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""),
      cTexto(brl(l.reduce((t, r) => t + num(r.valor), 0)), { peso: 600 }), cTexto(brl(l.reduce((t, r) => t + num(r.contrib_gap), 0)), { peso: 700 })],
    (r, i) => ({ id: `an:${r.documento}:${i}`, nome: r.documento, sub: r.tipo, cels: [
      cTexto(r.cliente), cTexto(r.categoria), cTexto(ddmmaa(r.dt_nf)), cTexto(ddmmaa(r.dt_titulo)),
      cTexto(r.gap_dias == null ? "—" : `${r.gap_dias}d`),
      cPill(r.situacao, r.situacao === "Pago" ? "ok" : r.situacao === "Vencido" ? "crit" : "off"),
      cTexto(brl(num(r.valor))), cTexto(brl(num(r.contrib_gap)), { tom: num(r.contrib_gap) >= 0 ? "warn" : "info", peso: 600 })] })), []);
  return <ArvoreNavy titulo="Anomalias faturamento × título" dica="Só o que não fecha dentro do mês · contrib. positiva = faturei e não emiti; negativa = emiti sem NF no período"
    colunas={colunas} registros={rows} montar={montar} grid="minmax(230px,1.3fr) minmax(200px,1.4fr) 110px 86px 86px 70px 100px 120px 120px" minWidth={1200}
    buscaNome={(r) => `${r.tipo} ${r.documento}`}
    rodape={(rs) => <span>{rs.length} casos · contrib. <b style={{ color: "var(--ww-text)" }}>{brl(rs.reduce((t, r) => t + num(r.contrib_gap), 0))}</b></span>} />;
}

function ArvoreDetalhe({ rows }: { rows: DetalheRow[] }) {
  const colunas: ColunaNavy<DetalheRow>[] = [
    { label: "Status › PV/OS" },
    { label: "Cliente", texto: (r) => r.cliente },
    { label: "Categoria", texto: (r) => r.categoria },
    { label: "Dt. NF", texto: (r) => ddmmaa(r.dt_fat), numero: (r) => (r.dt_fat ? Date.parse(r.dt_fat) : null) },
    { label: "Emissão", texto: (r) => ddmmaa(r.dt_emissao), numero: (r) => (r.dt_emissao ? Date.parse(r.dt_emissao) : null) },
    { label: "1º venc.", texto: (r) => ddmmaa(r.primeiro_venc), numero: (r) => (r.primeiro_venc ? Date.parse(r.primeiro_venc) : null) },
    { label: "1º pgto.", texto: (r) => ddmmaa(r.primeiro_pgto), numero: (r) => (r.primeiro_pgto ? Date.parse(r.primeiro_pgto) : null) },
    { label: "Gap", align: "right", texto: (r) => (r.gap_dias == null ? "—" : `${r.gap_dias}d`), numero: (r) => r.gap_dias },
    { label: "Parc.", align: "right", texto: (r) => txt(r.parcelas), numero: (r) => r.parcelas },
    { label: "Valor", align: "right", texto: (r) => brl(num(r.valor)), numero: (r) => num(r.valor) },
    { label: "Pago", align: "right", texto: (r) => brl(num(r.pago)), numero: (r) => num(r.pago) },
    { label: "Aberto", align: "right", texto: (r) => brl(num(r.aberto)), numero: (r) => num(r.aberto) },
  ];
  const sumC = (l: DetalheRow[], k: "valor" | "pago" | "aberto") => cTexto(brl(l.reduce((t, r) => t + num(r[k]), 0)), { peso: 700 });
  const montar = useCallback((rs: DetalheRow[]) => agrupar(rs, (r) => r.status, "dt",
    (l) => `${l.length} documento${l.length === 1 ? "" : "s"}`,
    (l) => [cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""), sumC(l, "valor"), sumC(l, "pago"), sumC(l, "aberto")],
    (r, i) => ({ id: `dt:${r.documento}:${i}`, nome: r.documento, sub: r.status, cels: [
      cTexto(r.cliente), cTexto(r.categoria), cTexto(ddmmaa(r.dt_fat)), cTexto(ddmmaa(r.dt_emissao)), cTexto(ddmmaa(r.primeiro_venc)),
      cTexto(ddmmaa(r.primeiro_pgto)), cTexto(r.gap_dias == null ? "—" : `${r.gap_dias}d`), cTexto(txt(r.parcelas) || "—"),
      cTexto(brl(num(r.valor)), { peso: 600 }), cTexto(brl(num(r.pago))), cTexto(brl(num(r.aberto)), { tom: num(r.aberto) > 0 ? "warn" : undefined })] })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  []);
  return <ArvoreNavy titulo="Conciliação — detalhe linha a linha" dica="Os dois lados cruzados por OS, inclusive título sem NF no período"
    colunas={colunas} registros={rows} montar={montar}
    grid="minmax(210px,1.2fr) minmax(190px,1.3fr) 100px 80px 80px 80px 80px 60px 56px 115px 115px 115px" minWidth={1380}
    buscaNome={(r) => `${r.status} ${r.documento}`}
    rodape={(rs) => <span>{rs.length} documentos · valor <b style={{ color: "var(--ww-text)" }}>{brl(rs.reduce((t, r) => t + num(r.valor), 0))}</b> · aberto {brl(rs.reduce((t, r) => t + num(r.aberto), 0))}</span>} />;
}
