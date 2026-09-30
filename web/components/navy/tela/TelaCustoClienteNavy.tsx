"use client";

/**
 * Custo por cliente — recriação Navy (protótipo "Painel Allka finance").
 *
 * Mesma fonte da tela antiga (/api/bi/custo-cliente: custo do app de serviços
 * em tempo real, receita do Omie casada pelo código do cliente). Tudo o que a
 * antiga tinha continua: as quatro parcelas do custo, clientes atendidos, a
 * repartição cliente × sem link × overhead, custo por tipo de venda, custo mês
 * a mês, a tabela com as 12 colunas e a memória de cálculo por cliente.
 *
 * Do modelo: KPI de margem média (ponderada pela receita, só sobre quem tem
 * receita casada — é a única margem que existe), barra de M% na árvore e a
 * árvore por origem › cliente. O modelo abre cada cliente em projetos,
 * contratos e vendas avulsas; a fonte não reparte o custo assim, por isso o
 * segundo nível fica de fora em vez de inventado.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import MemorialCusto from "../../bi/MemorialCusto";
import type { Tom } from "../primitivos";
import {
  ArvoreNavy, Aviso, CabecalhoTela, CampoData, Carregando, ChipFiltro, FaixaFiltros, GradeKpis,
  GraficoBarras, MeioTela, PaginaNavy, PainelLateral, brl, brl0, cBarra, cMudo, cPill, cTexto,
  hojeISO, kbrl, somaDias, type Bloco, type ColunaNavy, type Kpi, type NoNavy,
} from "./KitTela";

type Linha = {
  codigo: number | null; nome: string; is_bucket: boolean; sem_link: boolean; customer_ids: string[];
  diretas: number; combustivel: number; pedagio: number; mao_obra: number; custo_total: number;
  qtd_os: number; tecnicos: number; receita: number; compras: number; margem: number | null; margem_pct: number | null;
};
type Payload = {
  fonte: string;
  total: { diretas: number; combustivel: number; pedagio: number; mao_obra: number; custo_total: number; qtd_os: number; receita: number; clientes: number };
  reparticao: { cliente_real: number; sem_link: number; buckets: number };
  tipos: Array<{ label: string; value: number }>;
  mensal: Array<{ x: string; diretas: number; combustivel: number; pedagio: number; mao_obra: number }>;
  linhas: Linha[];
  error?: string; hint?: string;
};

const PARC = [
  { k: "diretas", rotulo: "Despesas diretas", cor: "var(--ww-cat-projetos)", hint: "lançadas na OS, já aprovadas" },
  { k: "combustivel", rotulo: "Combustível", cor: "var(--ww-cat-avulsos)", hint: "rateado por km rodado" },
  { k: "mao_obra", rotulo: "Mão de obra", cor: "var(--ww-cat-revenda)", hint: "horas de OS × valor/hora do técnico" },
  { k: "pedagio", rotulo: "Pedágio", cor: "var(--ww-cat-botsw)", hint: "rateado por km rodado" },
] as const;

const origem = (l: Linha) => (l.is_bucket ? "Overhead" : l.sem_link ? "Sem link Omie" : "Cliente");
const tomOrigem = (o: string): Tom => (o === "Cliente" ? "ok" : o === "Sem link Omie" ? "warn" : "off");
const pctTxt = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

type Periodo = "ytd" | "m12" | "mes" | "livre";

export default function TelaCustoClienteNavy() {
  const h = hojeISO();
  const [periodo, setPeriodo] = useState<Periodo>("ytd");
  const [de, setDe] = useState(h.slice(0, 4) + "-01-01");
  const [ate, setAte] = useState(h);
  const [tipo, setTipo] = useState("");
  const [soReceita, setSoReceita] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [memorial, setMemorial] = useState<{ nome: string; ids: string[] } | null>(null);
  const [from, to] = periodo === "ytd" ? [h.slice(0, 4) + "-01-01", h] : periodo === "m12" ? [somaDias(h, -365), h]
    : periodo === "mes" ? [h.slice(0, 8) + "01", h] : [de, ate];

  const load = useCallback(async () => {
    setData(null); setErr(null);
    try {
      const qs = new URLSearchParams({ from, to });
      if (tipo) qs.set("tipo", tipo);
      const r = await fetch(`/api/bi/custo-cliente?${qs}`, { cache: "no-store" });
      const j = (await r.json()) as Payload;
      if (!r.ok) { setErr(j.hint ? `${j.error} — ${j.hint}` : (j.error ?? r.statusText)); return; }
      setData(j);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, [from, to, tipo]);
  useEffect(() => { void load(); }, [load]);

  // Tipos de venda: guardo a lista da primeira carga — filtrar por um tipo
  // devolve só esse tipo, e os chips dos outros sumiriam.
  const [tiposConhecidos, setTiposConhecidos] = useState<string[]>([]);
  useEffect(() => { if (data && !tipo) setTiposConhecidos(data.tipos.map((x) => x.label)); }, [data, tipo]);

  const linhas = useMemo(() => {
    const b = data?.linhas ?? [];
    return soReceita ? b.filter((l) => l.receita > 0) : b;
  }, [data, soReceita]);

  if (err) return <PaginaNavy><Cab /><Aviso>{err}</Aviso></PaginaNavy>;

  const t = data?.total, rep = data?.reparticao;
  const comMargem = linhas.filter((l) => l.margem != null && l.receita > 0);
  const recM = comMargem.reduce((s, l) => s + l.receita, 0), margM = comMargem.reduce((s, l) => s + (l.margem ?? 0), 0);
  const margemMedia = recM > 0 ? (margM / recM) * 100 : null;

  const kpis: Kpi[] = t ? [
    { rotulo: "Custo total", valor: kbrl(t.custo_total), sub: `${t.qtd_os.toLocaleString("pt-BR")} OS`, hero: true, title: brl(t.custo_total) },
    ...PARC.map((p) => ({ rotulo: p.rotulo, valor: kbrl(t[p.k]), sub: p.hint, dot: p.cor, title: brl(t[p.k]) })),
    { rotulo: "Clientes atendidos", valor: String(t.clientes), sub: "com código Omie vinculado" },
    { rotulo: "Receita casada", valor: kbrl(t.receita), sub: "Omie, pelo código do cliente", title: brl(t.receita) },
    ...(margemMedia != null ? [{ rotulo: "Margem média", valor: pctTxt(margemMedia), sub: `ponderada · ${comMargem.length} clientes com receita`,
      barra: { pct: Math.max(0, margemMedia), tom: (margemMedia < 0 ? "crit" : margemMedia < 25 ? "warn" : "ok") as Tom } }] : []),
  ] : [];

  const colGraf = (data?.mensal ?? []).map((m) => {
    const tot = PARC.reduce((s, p) => s + (m[p.k] ?? 0), 0);
    const [y, mm] = m.x.slice(0, 7).split("-");
    return { rotulo: `${MESES[Number(mm) - 1] ?? m.x}/${(y ?? "").slice(2)}`, topo: kbrl(tot).replace(" mil", "k"),
      title: `${m.x} · ${PARC.map((p) => `${p.rotulo}: ${brl0(m[p.k] ?? 0)}`).join(" · ")} · total ${brl0(tot)}`,
      segs: PARC.map((p) => ({ v: m[p.k] ?? 0, cor: p.cor })) };
  });

  const lado: Bloco[] = rep && t ? (() => {
    const totRep = rep.cliente_real + rep.sem_link + rep.buckets || 1;
    const mxTipo = Math.max(1, ...(data?.tipos ?? []).map((x) => x.value));
    return [
      { k: "m", rotulo: "Cliente identificado", valor: kbrl(rep.cliente_real), pct: (rep.cliente_real / totRep) * 100, tom: "ok", title: `${brl(rep.cliente_real)} · entra na conta de rentabilidade` },
      { k: "m", rotulo: "Sem vínculo com o Omie", valor: kbrl(rep.sem_link), pct: (rep.sem_link / totRep) * 100, tom: "warn", title: `${brl(rep.sem_link)} · tem custo, mas não há receita pra comparar` },
      { k: "m", rotulo: "Overhead", valor: kbrl(rep.buckets), pct: (rep.buckets / totRep) * 100, tom: "off", title: `${brl(rep.buckets)} · empresa, comercial, não atribuído` },
      { k: "t", t: "Nem todo custo pertence a um cliente: o que não tem vínculo com o Omie tem custo e não tem receita para comparar." },
      ...(data?.tipos ?? []).map((x) => ({ k: "m" as const, rotulo: `Tipo · ${x.label}`, valor: kbrl(x.value), pct: (x.value / mxTipo) * 100, tom: "info" as Tom, title: brl(x.value) })),
    ];
  })() : [];

  return (
    <PaginaNavy>
      <Cab fonte={data?.fonte} />
      <FaixaFiltros>
        {([["ytd", "Ano até hoje"], ["m12", "12 meses"], ["mes", "Mês corrente"], ["livre", "De / Até"]] as const).map(([k, l]) => (
          <ChipFiltro key={k} ativo={periodo === k} onClick={() => setPeriodo(k)}>{l}</ChipFiltro>
        ))}
        {periodo === "livre" && (<><CampoData valor={de} onChange={setDe} /><CampoData valor={ate} onChange={setAte} /></>)}
        {tiposConhecidos.length > 0 && <ChipFiltro ativo={!tipo} onClick={() => setTipo("")}>Todos os tipos</ChipFiltro>}
        {tiposConhecidos.map((x) => <ChipFiltro key={x} ativo={tipo === x} onClick={() => setTipo(tipo === x ? "" : x)}>{x}</ChipFiltro>)}
        <ChipFiltro ativo={soReceita} onClick={() => setSoReceita((v) => !v)}>Só quem tem receita</ChipFiltro>
      </FaixaFiltros>

      {!data ? <Carregando /> : (<>
        <GradeKpis kpis={kpis} min={170} />
        <MeioTela
          grafico={<GraficoBarras titulo="Custo mês a mês · a altura é o total, as faixas dizem de que é feito" colunas={colGraf}
            legenda={PARC.map((p) => ({ nome: p.rotulo, cor: p.cor }))} />}
          lado={<PainelLateral titulo="Repartição do custo" blocos={lado} />} />
        <Arvore linhas={linhas} abrir={(l) => setMemorial({ nome: l.nome, ids: l.customer_ids })} />
        <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>
          Custo vem do app de serviços em tempo real ({data.fonte === "app-direto" ? "leitura direta" : data.fonte}). Receita vem do Omie.
          O cruzamento é pelo código do cliente — por isso quem não tem vínculo aparece com custo e sem margem.
        </div>
      </>)}

      {memorial && <MemorialCusto cliente={memorial.nome} customerIds={memorial.ids} from={from} to={to} onFechar={() => setMemorial(null)} />}
    </PaginaNavy>
  );
}

function Cab({ fonte }: { fonte?: string }) {
  return <CabecalhoTela area="Financeiro" titulo="Custo por cliente"
    sub={`Despesas, combustível, pedágio e mão de obra do app de serviços${fonte ? ` (${fonte})` : ""} × receita do Omie, por cliente`} />;
}

function Arvore({ linhas, abrir }: { linhas: Linha[]; abrir: (l: Linha) => void }) {
  const money = (k: keyof Linha, label: string): ColunaNavy<Linha> =>
    ({ label, align: "right", texto: (l) => brl0(Number(l[k]) || 0), numero: (l) => Number(l[k]) || 0 });
  const colunas: ColunaNavy<Linha>[] = [
    { label: "Origem › cliente" },
    { label: "OS", align: "right", texto: (l) => String(l.qtd_os), numero: (l) => l.qtd_os },
    { label: "Téc.", align: "right", texto: (l) => String(l.tecnicos), numero: (l) => l.tecnicos },
    money("diretas", "Despesas"), money("combustivel", "Combustível"), money("pedagio", "Pedágio"), money("mao_obra", "Mão de obra"),
    money("custo_total", "Custo total"), money("receita", "Receita"),
    { label: "Margem", align: "right", texto: (l) => (l.margem == null ? "—" : brl0(l.margem)), numero: (l) => l.margem },
    { label: "M%", texto: (l) => pctTxt(l.margem_pct), numero: (l) => l.margem_pct },
  ];
  const somaL = (ls: Linha[], k: keyof Linha) => ls.reduce((s, l) => s + (Number(l[k]) || 0), 0);
  const celsDe = (ls: Linha[], agregado: boolean): React.ReactNode[] => {
    const rec = somaL(ls, "receita"), cst = somaL(ls, "custo_total");
    const comM = ls.filter((l) => l.margem != null);
    const marg = comM.reduce((s, l) => s + (l.margem ?? 0), 0), recM = comM.reduce((s, l) => s + l.receita, 0);
    const mp = agregado ? (recM > 0 ? (marg / recM) * 100 : null) : ls[0].margem_pct;
    const peso = agregado ? 700 : 500;
    return [
      cTexto(somaL(ls, "qtd_os").toLocaleString("pt-BR")), cTexto(agregado ? "" : String(ls[0].tecnicos), { cor: "var(--ww-text-2)" }),
      cTexto(brl0(somaL(ls, "diretas"))), cTexto(brl0(somaL(ls, "combustivel"))), cTexto(brl0(somaL(ls, "pedagio"))), cTexto(brl0(somaL(ls, "mao_obra"))),
      cTexto(brl0(cst), { peso: agregado ? 700 : 600 }), rec ? cTexto(brl0(rec), { peso }) : cMudo("—"),
      comM.length ? cTexto(brl0(marg), { tom: marg < 0 ? "crit" : undefined, peso: 600 }) : cMudo("—"),
      mp == null ? cMudo("—") : cBarra(pctTxt(mp), Math.max(3, Math.min(100, Math.abs(mp) * 2)), mp < 0 ? "crit" : mp < 25 ? "warn" : "ok"),
    ];
  };
  const montar = useCallback((ls: Linha[]): NoNavy[] => {
    const ordem = ["Cliente", "Sem link Omie", "Overhead"];
    const m = new Map<string, Linha[]>();
    for (const l of ls) (m.get(origem(l)) ?? m.set(origem(l), []).get(origem(l))!).push(l);
    return ordem.filter((o) => m.has(o)).map((o) => {
      const g = m.get(o)!;
      return {
        id: `o:${o}`, nome: o, sub: `${g.length} linha${g.length === 1 ? "" : "s"} · ${o === "Cliente" ? "entra na rentabilidade" : o === "Sem link Omie" ? "custo sem receita para comparar" : "empresa, comercial, não atribuído"}`,
        cels: celsDe(g, true),
        filhos: g.map((l, i) => ({
          id: `o:${o}:${l.codigo ?? l.nome}:${i}`, nome: l.nome,
          sub: l.codigo ? `Omie ${l.codigo}` : undefined,
          cels: celsDe([l], false),
          acao: l.customer_ids.length ? (
            <button type="button" title="Memória de cálculo" onClick={() => abrir(l)} style={{
              fontSize: 11, padding: "2px 8px", borderRadius: 999, cursor: "pointer",
              border: "1px solid var(--ww-border-strong)", background: "transparent", color: "var(--ww-text-muted)",
            }}>memória</button>
          ) : cPill(o === "Overhead" ? "overhead" : "sem OS", "off"),
        })),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <ArvoreNavy titulo="Origem › cliente" dica="Cada cliente com as quatro parcelas de custo e, quando há receita casada, a margem que sobra · 'memória' mostra como o número foi montado"
    colunas={colunas} registros={linhas} montar={montar} abertosIniciais={["o:Cliente"]}
    grid="minmax(260px,1.7fr) 60px 56px repeat(6,minmax(100px,1fr)) 110px 130px" minWidth={1400}
    buscaNome={(l) => `${l.nome} ${l.codigo ?? ""}`}
    rodape={(ls) => <span>{ls.length} linhas · custo <b style={{ color: "var(--ww-text)" }}>{brl0(somaL(ls, "custo_total"))}</b> · receita {brl0(somaL(ls, "receita"))}</span>} />;
}
