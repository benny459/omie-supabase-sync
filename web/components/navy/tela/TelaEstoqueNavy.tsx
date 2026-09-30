"use client";

/**
 * Estoque — recriação Navy (protótipo "Painel Allka finance").
 *
 * Fonte: orders.estoque_posicao / estoque_movimentos (import_estoque.py), a
 * mesma da tela antiga. Tudo o que ela mostrava continua: posição com código,
 * descrição, saldo, reservado, pendente, mínimo, CMC e valor; filtro "com
 * saldo"; movimentação por período com entrada/saída, origem, documento,
 * quantidade, valor e saldo; Kardex por produto. Entram também os campos que
 * a tabela tem e a tela não mostrava: físico, preço unitário, local, CMC e
 * operação do movimento, emissão, devolução.
 *
 * O modelo agrupa por família › produto › local. A família NÃO está no espelho:
 * a posição casa com sales.produtos (2.234 de 2.237), que não traz família, e o
 * cadastro com família (produtos_compras) é outro catálogo e não casa nenhum.
 * Em vez de inventar, a árvore agrupa pela situação que os dados dão —
 * saldo negativo, abaixo do mínimo, com reserva, normal — › produto › local.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SegmentedControl, type Tom } from "../primitivos";
import {
  ArvoreNavy, Aviso, CabecalhoTela, CampoData, Carregando, ChipFiltro, FaixaFiltros, GradeKpis,
  GraficoBarras, MeioTela, PaginaNavy, PainelLateral, brl, cBarra, cMudo, cPill, cTexto, ddmm, ddmmaa,
  diaSemana, hojeISO, kbrl, somaDias, type Bloco, type ColunaNavy, type Kpi, type NoNavy,
} from "./KitTela";

type Pos = {
  empresa: string; n_cod_prod: number; codigo_local_estoque: number; codigo: string | null; descricao: string | null;
  saldo: number | string | null; fisico: number | string | null; reservado: number | string | null; pendente: number | string | null;
  cmc: number | string | null; preco_unitario: number | string | null; estoque_minimo: number | string | null;
  data_posicao: string | null; synced_at: string | null;
};
type Mov = {
  empresa: string; id_mov: number; id_prod: number | null; dt_mov: string | null; dt_emissao: string | null;
  cod_origem: string | null; des_origem: string | null; operacao: string | null; tipo: string | null;
  num_doc: string | null; num_pedido: string | null; qtde: number | string | null; valor: number | string | null;
  saldo: number | string | null; cmc: number | string | null; descricao: string | null; codigo_local_estoque: number | null;
  cancelamento: string | null; devolucao: string | null;
};

const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };
const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const q = (v: unknown) => NUM.format(n(v));
const valorPos = (r: Pos) => n(r.saldo) * n(r.cmc);
const abaixo = (r: Pos) => n(r.estoque_minimo) > 0 && n(r.saldo) < n(r.estoque_minimo);

type Situacao = "negativo" | "abaixo" | "reserva" | "normal" | "zerado";
const SIT: Record<Situacao, { rotulo: string; tom: Tom; ordem: number }> = {
  negativo: { rotulo: "Saldo negativo", tom: "crit", ordem: 0 },
  abaixo: { rotulo: "Abaixo do mínimo", tom: "warn", ordem: 1 },
  reserva: { rotulo: "Com reserva", tom: "violet", ordem: 2 },
  normal: { rotulo: "Normal", tom: "ok", ordem: 3 },
  zerado: { rotulo: "Sem saldo", tom: "off", ordem: 4 },
};
function situacao(r: Pos): Situacao {
  if (n(r.saldo) < 0) return "negativo";
  if (abaixo(r)) return "abaixo";
  if (n(r.reservado) > 0) return "reserva";
  if (n(r.saldo) === 0) return "zerado";
  return "normal";
}

export default function TelaEstoqueNavy() {
  const [aba, setAba] = useState<"posicao" | "movimentos">("posicao");
  const [pos, setPos] = useState<Pos[] | null>(null);
  const [mov30, setMov30] = useState<Mov[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [kardex, setKardex] = useState<Pos | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const h = hojeISO();
        const [a, b] = await Promise.all([
          fetch("/api/estoque?view=posicao", { cache: "no-store" }),
          fetch(`/api/estoque?view=movimentos&de=${somaDias(h, -30)}&ate=${h}`, { cache: "no-store" }),
        ]);
        const [ja, jb] = await Promise.all([a.json(), b.json()]);
        if (!a.ok) throw new Error(ja.error ?? a.statusText);
        setPos(ja.rows); setMov30(b.ok ? jb.rows : []);
      } catch (e) { setErro((e as Error).message); }
    })();
  }, []);

  return (
    <PaginaNavy>
      <CabecalhoTela area="Estoque" titulo="Estoque"
        sub="Posição e movimentação espelhadas do Omie (orders.estoque_posicao / estoque_movimentos) · disponível = saldo − reservado · clique num produto para o Kardex"
        acoes={<SegmentedControl value={aba} onChange={(v) => setAba(v as typeof aba)}
          options={[{ value: "posicao", label: "Posição" }, { value: "movimentos", label: "Movimentação" }]} />} />
      {erro && <Aviso>{erro}</Aviso>}
      {!pos ? <Carregando texto="Carregando posição…" /> : aba === "posicao"
        ? <Posicao pos={pos} mov30={mov30 ?? []} abrir={setKardex} />
        : <Movimentacao pos={pos} />}
      {kardex && <Kardex p={kardex} fechar={() => setKardex(null)} />}
    </PaginaNavy>
  );
}

function Posicao({ pos, mov30, abrir }: { pos: Pos[]; mov30: Mov[]; abrir: (p: Pos) => void }) {
  const [filtro, setFiltro] = useState<"saldo" | "todos" | "abaixo" | "reserva" | "negativo">("saldo");
  const [local, setLocal] = useState("");
  const [busca, setBusca] = useState("");
  const locais = useMemo(() => [...new Set(pos.map((r) => String(r.codigo_local_estoque)))], [pos]);

  const base = useMemo(() => {
    let rs = pos;
    if (filtro === "saldo") rs = rs.filter((r) => n(r.saldo) !== 0);
    if (filtro === "abaixo") rs = rs.filter(abaixo);
    if (filtro === "reserva") rs = rs.filter((r) => n(r.reservado) > 0);
    if (filtro === "negativo") rs = rs.filter((r) => n(r.saldo) < 0);
    if (local) rs = rs.filter((r) => String(r.codigo_local_estoque) === local);
    const t = busca.trim().toLowerCase();
    if (t) rs = rs.filter((r) => (r.descricao ?? "").toLowerCase().includes(t) || (r.codigo ?? "").toLowerCase().includes(t));
    return rs;
  }, [pos, filtro, local, busca]);

  // KPIs: as mesmas regras da tela antiga, sobre toda a posição.
  const comSaldo = pos.filter((r) => n(r.saldo) !== 0);
  const valor = comSaldo.reduce((s, r) => s + valorPos(r), 0);
  const reservado = pos.reduce((s, r) => s + n(r.reservado), 0);
  const valorReservado = pos.reduce((s, r) => s + n(r.reservado) * n(r.cmc), 0);
  // Produtos distintos (o mesmo produto pode aparecer em dois locais) — é o
  // que a árvore conta, e os dois números têm de bater.
  const distintos = (l: Pos[]) => new Set(l.map((r) => `${r.empresa}:${r.n_cod_prod}`)).size;
  const nAbaixo = distintos(pos.filter(abaixo)), nNeg = distintos(pos.filter((r) => n(r.saldo) < 0));
  const pendente = pos.reduce((s, r) => s + n(r.pendente), 0);
  const dataPos = pos[0]?.data_posicao ?? null;

  const kpis: Kpi[] = [
    { rotulo: "SKUs em estoque", valor: distintos(comSaldo).toLocaleString("pt-BR"), sub: `${pos.length.toLocaleString("pt-BR")} linhas produto × local · ${locais.length} locais` },
    { rotulo: "Valor em estoque", valor: kbrl(valor), sub: `custo médio (CMC)${dataPos ? ` · posição ${ddmmaa(dataPos)}` : ""}`, hero: true, title: brl(valor) },
    { rotulo: "Abaixo do mínimo", valor: String(nAbaixo), sub: "reposição sugerida", subTom: nAbaixo ? "warn" : "ok", onClick: () => setFiltro("abaixo") },
    { rotulo: "Reservado", valor: q(reservado), sub: `unidades · ${kbrl(valorReservado)} ao CMC`, onClick: () => setFiltro("reserva") },
    { rotulo: "Pendente", valor: q(pendente), sub: "unidades a receber" },
    { rotulo: "Saldo negativo", valor: String(nNeg), sub: "produtos — acertar no Omie", subTom: nNeg ? "crit" : "ok", onClick: () => setFiltro("negativo") },
  ];

  const colGraf = useMemo(() => {
    const m = new Map<string, { e: number; s: number; ne: number; ns: number }>();
    for (const x of mov30) {
      if (!x.dt_mov || x.cancelamento === "S") continue;
      const a = m.get(x.dt_mov) ?? { e: 0, s: 0, ne: 0, ns: 0 };
      if (x.tipo === "saida") { a.s += Math.abs(n(x.valor)); a.ns++; } else { a.e += Math.abs(n(x.valor)); a.ne++; }
      m.set(x.dt_mov, a);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, a]) => ({
      rotulo: ddmm(d), title: `${ddmm(d)} ${diaSemana(d)} · entradas ${brl(a.e)} (${a.ne}) · saídas ${brl(a.s)} (${a.ns})`,
      topo: kbrl(a.e + a.s).replace(" mil", "k"),
      segs: [{ v: a.e, cor: "var(--ww-brand-3)" }, { v: a.s, cor: "var(--ww-crit)" }],
    }));
  }, [mov30]);

  const top = [...comSaldo].sort((a, b) => valorPos(b) - valorPos(a)).slice(0, 8);
  const mxTop = Math.max(1, ...top.map(valorPos));
  const lado: Bloco[] = [
    ...top.map((r) => ({ k: "m" as const, rotulo: r.descricao ?? String(r.n_cod_prod), valor: kbrl(valorPos(r)),
      pct: (valorPos(r) / mxTop) * 100, tom: "info" as Tom, title: `${r.codigo ?? ""} · ${q(r.saldo)} × ${brl(n(r.cmc))}` })),
    { k: "t", t: `As 8 maiores posições somam ${kbrl(top.reduce((s, r) => s + valorPos(r), 0))} de ${kbrl(valor)}.` },
  ];

  /* Abre os grupos de alerta só quando cabem no olho — com centenas de
     produtos, abrir por padrão empurrava tudo o resto para fora da tela. */
  const abrirPorPadrao = (["negativo", "abaixo"] as Situacao[])
    .filter((s) => base.filter((r) => situacao(r) === s).length <= 15).map((s) => `s:${s}`);

  const colunas: ColunaNavy<Pos>[] = [
    { label: "Situação › produto › local" },
    { label: "Código", texto: (r) => r.codigo ?? String(r.n_cod_prod) },
    { label: "Saldo", align: "right", texto: (r) => q(r.saldo), numero: (r) => n(r.saldo) },
    { label: "Físico", align: "right", texto: (r) => q(r.fisico), numero: (r) => n(r.fisico) },
    { label: "Reserv.", align: "right", texto: (r) => q(r.reservado), numero: (r) => n(r.reservado) },
    { label: "Pend.", align: "right", texto: (r) => q(r.pendente), numero: (r) => n(r.pendente) },
    { label: "Disponível", texto: (r) => q(n(r.saldo) - n(r.reservado)), numero: (r) => n(r.saldo) - n(r.reservado) },
    { label: "Mín.", align: "right", texto: (r) => q(r.estoque_minimo), numero: (r) => n(r.estoque_minimo) },
    { label: "CMC", align: "right", texto: (r) => brl(n(r.cmc)), numero: (r) => n(r.cmc) },
    { label: "Preço unit.", align: "right", texto: (r) => brl(n(r.preco_unitario)), numero: (r) => n(r.preco_unitario) },
    { label: "Valor", align: "right", texto: (r) => brl(valorPos(r)), numero: valorPos },
  ];

  const montar = useCallback((rs: Pos[]): NoNavy[] => {
    const g = new Map<Situacao, Pos[]>();
    for (const r of rs) { const s = situacao(r); (g.get(s) ?? g.set(s, []).get(s)!).push(r); }
    const soma = (l: Pos[], f: (r: Pos) => number) => l.reduce((s, r) => s + f(r), 0);
    return [...g.entries()].sort(([a], [b]) => SIT[a].ordem - SIT[b].ordem).map(([s, l]) => {
      // Produto › local: o mesmo produto pode estar em mais de um local.
      const porProd = new Map<string, Pos[]>();
      for (const r of l) { const k = `${r.empresa}:${r.n_cod_prod}`; (porProd.get(k) ?? porProd.set(k, []).get(k)!).push(r); }
      const sl = soma(l, (r) => n(r.saldo)), rl = soma(l, (r) => n(r.reservado));
      return {
        id: `s:${s}`, nome: SIT[s].rotulo, sub: `${porProd.size.toLocaleString("pt-BR")} produto${porProd.size === 1 ? "" : "s"}`,
        cels: [cPill(SIT[s].rotulo, SIT[s].tom), cTexto(q(sl)), cMudo(""), cTexto(q(rl)), cTexto(q(soma(l, (r) => n(r.pendente)))),
          cBarra(`${q(sl - rl)} disp.`, sl > 0 ? Math.max(0, ((sl - rl) / sl) * 100) : 0, s === "negativo" ? "crit" : s === "abaixo" ? "warn" : "ok"),
          cMudo(""), cMudo(""), cMudo(""), cTexto(brl(soma(l, valorPos)), { peso: 700 })],
        filhos: [...porProd.values()].sort((a, b) => soma(b, valorPos) - soma(a, valorPos)).map((lp) => {
          const p = lp[0], sp = soma(lp, (r) => n(r.saldo)), rp = soma(lp, (r) => n(r.reservado)), minimo = n(p.estoque_minimo);
          const cels = (r: Pos | null, lst: Pos[]) => {
            const sd = r ? n(r.saldo) : sp, rv = r ? n(r.reservado) : rp, disp = sd - rv;
            return [cTexto(p.codigo ?? String(p.n_cod_prod), { cor: "var(--ww-text-2)" }),
              cTexto(q(sd), { tom: sd < 0 ? "crit" : undefined, peso: 600 }), cTexto(q(r ? r.fisico : soma(lst, (x) => n(x.fisico))), { cor: "var(--ww-text-2)" }),
              cTexto(q(rv)), cTexto(q(r ? r.pendente : soma(lst, (x) => n(x.pendente)))),
              cBarra(minimo ? `${q(disp)} · mín. ${q(minimo)}` : q(disp), minimo ? Math.min(100, Math.max(3, (disp / (minimo * 2)) * 100)) : disp > 0 ? 100 : 3,
                disp < 0 ? "crit" : minimo && disp < minimo ? "warn" : "ok"),
              cTexto(q(p.estoque_minimo), { tom: abaixo(p) ? "warn" : undefined }), cTexto(brl(n(p.cmc))), cTexto(brl(n(p.preco_unitario)), { cor: "var(--ww-text-2)" }),
              cTexto(brl(r ? valorPos(r) : soma(lst, valorPos)), { peso: 600 })];
          };
          return {
            id: `p:${s}:${p.empresa}:${p.n_cod_prod}`, nome: p.descricao ?? String(p.n_cod_prod),
            sub: `${p.empresa} · ${lp.length} local${lp.length === 1 ? "" : "is"}`,
            cels: cels(lp.length === 1 ? p : null, lp),
            acao: <button type="button" onClick={() => abrir(p)} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, cursor: "pointer",
              border: "1px solid var(--ww-border-strong)", background: "transparent", color: "var(--ww-text-muted)" }}>kardex</button>,
            filhos: lp.length > 1 ? lp.map((r) => ({ id: `l:${s}:${r.empresa}:${r.n_cod_prod}:${r.codigo_local_estoque}`,
              nome: `Local ${r.codigo_local_estoque}`, sub: r.data_posicao ? `posição ${ddmmaa(r.data_posicao)}` : undefined, cels: cels(r, [r]) })) : undefined,
          };
        }),
      };
    });
  }, [abrir]);

  return (<>
    <FaixaFiltros busca={busca} onBusca={setBusca} placeholder="Código, descrição…">
      {([["saldo", "Com saldo"], ["todos", "Todos"], ["abaixo", "Abaixo do mínimo"], ["reserva", "Com reserva"], ["negativo", "Saldo negativo"]] as const).map(([k, l]) => (
        <ChipFiltro key={k} ativo={filtro === k} onClick={() => setFiltro(k)}>{l}</ChipFiltro>
      ))}
      {locais.length > 1 && (<>
        <ChipFiltro ativo={!local} onClick={() => setLocal("")}>Todos os locais</ChipFiltro>
        {locais.map((l) => <ChipFiltro key={l} ativo={local === l} onClick={() => setLocal(local === l ? "" : l)}>Local {l}</ChipFiltro>)}
      </>)}
    </FaixaFiltros>
    <GradeKpis kpis={kpis} min={170} />
    <MeioTela
      grafico={<GraficoBarras titulo="Movimentação dos últimos 30 dias (valor)" colunas={colGraf}
        legenda={[{ nome: "Entradas", cor: "var(--ww-brand-3)" }, { nome: "Saídas", cor: "var(--ww-crit)" }]} />}
      lado={<PainelLateral titulo="Maiores posições" blocos={lado} />} />
    <ArvoreNavy titulo="Situação › produto › local" dica="Disponível = saldo − reservado · família de produto não está no espelho do Omie, por isso a árvore abre pela situação"
      colunas={colunas} registros={base} montar={montar} abertosIniciais={abrirPorPadrao} chave={filtro}
      grid="minmax(300px,2fr) 140px 100px 92px 92px 92px minmax(170px,1.2fr) 84px 110px 116px 136px" minWidth={1580}
      buscaNome={(r) => `${r.descricao ?? ""} ${r.codigo ?? ""}`}
      rodape={(rs) => <span>{rs.length.toLocaleString("pt-BR")} linhas · valor <b style={{ color: "var(--ww-text)" }}>{brl(rs.reduce((s, r) => s + valorPos(r), 0))}</b></span>} />
  </>);
}

function Movimentacao({ pos }: { pos: Pos[] }) {
  const h = hojeISO();
  const [de, setDe] = useState(somaDias(h, -30));
  const [ate, setAte] = useState(h);
  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [movs, setMovs] = useState<Mov[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    setMovs(null); setErro(null);
    (async () => {
      try {
        const r = await fetch(`/api/estoque?view=movimentos&de=${de}&ate=${ate}`, { signal: ctrl.signal, cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setMovs(j.rows);
      } catch (e) { if ((e as Error).name !== "AbortError") setErro((e as Error).message); }
    })();
    return () => ctrl.abort();
  }, [de, ate]);
  const codigoDe = useMemo(() => new Map(pos.map((p) => [p.n_cod_prod, p.codigo])), [pos]);

  const base = useMemo(() => {
    let rs = movs ?? [];
    if (tipo) rs = rs.filter((r) => (r.tipo ?? "") === tipo);
    const t = busca.trim().toLowerCase();
    if (t) rs = rs.filter((r) => [r.descricao, r.num_doc, r.des_origem, r.num_pedido].some((v) => (v ?? "").toLowerCase().includes(t)));
    return rs;
  }, [movs, tipo, busca]);

  const vivos = base.filter((r) => r.cancelamento !== "S");
  const ent = vivos.filter((r) => r.tipo !== "saida"), sai = vivos.filter((r) => r.tipo === "saida");
  const kpis: Kpi[] = [
    { rotulo: "Movimentos no período", valor: base.length.toLocaleString("pt-BR"), sub: `${ddmm(de)} a ${ddmm(ate)} · ${base.length - vivos.length} cancelados`, hero: true },
    { rotulo: "Entradas", valor: kbrl(ent.reduce((s, r) => s + Math.abs(n(r.valor)), 0)), sub: `${ent.length} movimentos · ${q(ent.reduce((s, r) => s + Math.abs(n(r.qtde)), 0))} un`, subTom: "ok" },
    { rotulo: "Saídas", valor: kbrl(sai.reduce((s, r) => s + Math.abs(n(r.valor)), 0)), sub: `${sai.length} movimentos · ${q(sai.reduce((s, r) => s + Math.abs(n(r.qtde)), 0))} un`, subTom: "crit" },
    { rotulo: "Produtos movimentados", valor: new Set(vivos.map((r) => r.id_prod)).size.toLocaleString("pt-BR"), sub: "distintos no período" },
  ];

  const colunas: ColunaNavy<Mov>[] = [
    { label: "Dia › movimento" },
    { label: "Código", texto: (r) => codigoDe.get(r.id_prod ?? -1) ?? String(r.id_prod ?? "") },
    { label: "Origem", texto: (r) => r.des_origem ?? "" },
    { label: "Operação", texto: (r) => r.operacao ?? "" },
    { label: "Doc / pedido", texto: (r) => r.num_doc ?? r.num_pedido ?? "" },
    { label: "Tipo", texto: (r) => r.tipo ?? "" },
    { label: "Qtde", align: "right", texto: (r) => q(r.qtde), numero: (r) => n(r.qtde) },
    { label: "Valor", align: "right", texto: (r) => brl(n(r.valor)), numero: (r) => n(r.valor) },
    { label: "CMC", align: "right", texto: (r) => brl(n(r.cmc)), numero: (r) => n(r.cmc) },
    { label: "Saldo", align: "right", texto: (r) => q(r.saldo), numero: (r) => n(r.saldo) },
  ];
  const montar = useCallback((rs: Mov[]): NoNavy[] => {
    const g = new Map<string, Mov[]>();
    for (const r of rs) { const k = r.dt_mov ?? "—"; (g.get(k) ?? g.set(k, []).get(k)!).push(r); }
    return [...g.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([d, l]) => {
      const e = l.filter((r) => r.tipo !== "saida" && r.cancelamento !== "S"), s = l.filter((r) => r.tipo === "saida" && r.cancelamento !== "S");
      return {
        id: `d:${d}`, nome: d === "—" ? "Sem data" : `${ddmm(d)} · ${diaSemana(d)}`, sub: `${l.length} movimentos · ${e.length} entradas · ${s.length} saídas`,
        cels: [cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""), cMudo(""),
          cTexto(`+${kbrl(e.reduce((t, r) => t + Math.abs(n(r.valor)), 0))} / −${kbrl(s.reduce((t, r) => t + Math.abs(n(r.valor)), 0))}`, { peso: 600 }), cMudo(""), cMudo("")],
        filhos: l.map((r) => {
          const canc = r.cancelamento === "S", saida = r.tipo === "saida";
          return {
            id: `m:${r.empresa}:${r.id_mov}`, nome: r.descricao ?? String(r.id_prod ?? "—"),
            sub: [canc ? "cancelado" : null, r.devolucao === "S" ? "devolução" : null, r.dt_emissao ? `emissão ${ddmm(r.dt_emissao)}` : null, r.codigo_local_estoque ? `local ${r.codigo_local_estoque}` : null].filter(Boolean).join(" · ") || undefined,
            cels: [cTexto(codigoDe.get(r.id_prod ?? -1) ?? String(r.id_prod ?? "—"), { cor: "var(--ww-text-2)" }), cTexto(r.des_origem ?? "—"),
              cTexto(r.operacao ?? "—", { cor: "var(--ww-text-2)" }), cTexto(r.num_doc ?? r.num_pedido ?? "—"),
              canc ? cPill("cancelado", "off") : cPill(r.tipo ?? "—", saida ? "crit" : "ok"),
              cTexto(`${saida ? "−" : "+"}${q(Math.abs(n(r.qtde)))}`, { tom: canc ? undefined : saida ? "crit" : "ok", peso: 600, cor: canc ? "var(--ww-text-faint)" : undefined }),
              cTexto(brl(n(r.valor)), { cor: canc ? "var(--ww-text-faint)" : undefined }), cTexto(brl(n(r.cmc)), { cor: "var(--ww-text-2)" }), cTexto(q(r.saldo))],
          };
        }),
      };
    });
  }, [codigoDe]);

  return (<>
    <FaixaFiltros busca={busca} onBusca={setBusca} placeholder="Produto, doc, origem, pedido…">
      <CampoData valor={de} onChange={setDe} /><span style={{ color: "var(--ww-text-faint)" }}>→</span><CampoData valor={ate} onChange={setAte} />
      {["entrada", "saida"].map((t) => <ChipFiltro key={t} ativo={tipo === t} onClick={() => setTipo(tipo === t ? "" : t)}>{t === "entrada" ? "Entradas" : "Saídas"}</ChipFiltro>)}
    </FaixaFiltros>
    {erro && <Aviso>{erro}</Aviso>}
    {!movs ? <Carregando texto="Carregando movimentos…" /> : (<>
      <GradeKpis kpis={kpis} min={190} />
      <ArvoreNavy titulo="Dia › movimento" dica="Cancelados aparecem esmaecidos e não somam"
        colunas={colunas} registros={base} montar={montar} abertosIniciais={[`d:${base[0]?.dt_mov ?? ""}`]}
        grid="minmax(280px,1.8fr) 130px minmax(170px,1.2fr) 96px 110px 110px 90px 116px 110px 90px" minWidth={1440}
        buscaNome={(r) => r.descricao ?? ""} vazio="Nenhum movimento no período."
        rodape={(rs) => <span>{rs.length.toLocaleString("pt-BR")} movimentos</span>} />
    </>)}
  </>);
}

function Kardex({ p, fechar }: { p: Pos; fechar: () => void }) {
  const [rows, setRows] = useState<Mov[] | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/estoque?view=movimentos&produto=${p.n_cod_prod}`);
        const j = await r.json();
        setRows(r.ok ? j.rows : []);
      } catch { setRows([]); }
    })();
  }, [p.n_cod_prod]);
  const th = { padding: "8px 10px", fontSize: 11.5, color: "var(--ww-text-faint)", textAlign: "left" as const, fontWeight: 600 };
  const td = { padding: "8px 10px", fontSize: 12.5, borderTop: "1px dashed var(--ww-border-subtle)" };
  return (
    <div onClick={fechar} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(5,10,25,.6)", display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(900px,100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", borderRadius: 18,
        background: "var(--ww-panel)", border: "1px solid var(--ww-border-strong)", boxShadow: "var(--shadow-float)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--ww-border)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, color: "var(--ww-text-faint)", fontWeight: 600 }}>Kardex · {p.codigo ?? p.n_cod_prod}</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{p.descricao ?? p.n_cod_prod}</div>
            <div style={{ fontSize: 12, color: "var(--ww-text-muted)", marginTop: 2 }}>
              Saldo {q(p.saldo)} · reservado {q(p.reservado)} · CMC {brl(n(p.cmc))} · valor {brl(valorPos(p))}
            </div>
          </div>
          <button type="button" onClick={fechar} style={{ fontSize: 20, background: "none", border: 0, color: "var(--ww-text-muted)", cursor: "pointer" }}>×</button>
        </div>
        <div style={{ overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--ww-panel-sunken)" }}>
              <tr><th style={th}>Data</th><th style={th}>Origem</th><th style={th}>Doc</th><th style={{ ...th, textAlign: "right" }}>Qtde</th>
                <th style={{ ...th, textAlign: "right" }}>Valor</th><th style={{ ...th, textAlign: "right" }}>CMC</th><th style={{ ...th, textAlign: "right" }}>Saldo</th></tr>
            </thead>
            <tbody>
              {rows === null && <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--ww-text-muted)" }}>Carregando…</td></tr>}
              {rows?.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--ww-text-faint)" }}>Sem movimentos sincronizados.</td></tr>}
              {rows?.map((r) => {
                const canc = r.cancelamento === "S", saida = r.tipo === "saida";
                return (
                  <tr key={r.id_mov} style={{ opacity: canc ? 0.45 : 1, textDecoration: canc ? "line-through" : "none" }}>
                    <td style={td}>{ddmmaa(r.dt_mov)}</td><td style={{ ...td, color: "var(--ww-text-2)" }}>{r.des_origem ?? "—"}</td>
                    <td style={{ ...td, color: "var(--ww-text-2)" }}>{r.num_doc ?? r.num_pedido ?? "—"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600, color: saida ? "var(--ww-crit-text)" : "var(--ww-ok-text)" }}>{saida ? "−" : "+"}{q(Math.abs(n(r.qtde)))}</td>
                    <td style={{ ...td, textAlign: "right" }}>{brl(n(r.valor))}</td><td style={{ ...td, textAlign: "right", color: "var(--ww-text-2)" }}>{brl(n(r.cmc))}</td>
                    <td style={{ ...td, textAlign: "right" }}>{q(r.saldo)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
