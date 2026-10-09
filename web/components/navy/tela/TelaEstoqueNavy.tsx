"use client";

/**
 * Estoque v2 — lista (fase 1, só leitura). Porte do mockup web/docs/mockups/estoque-ficha-item
 * (branch mockup/estoque-v2): ⌘K para ir a qualquer item, lista com filtros que contam,
 * ordenação por coluna, CSV e páginas de 100; abas Duplicidades e Movimentação.
 * A ficha do item vive em /estoque/[codigo] (FichaItemNavy).
 *
 * Fonte: /api/estoque/itens (orders.v_estoque_item — saldo vem pronto de v_estoque_saldo_local)
 * e /api/estoque/movimentos (orders.v_estoque_mov_cli, com cliente/projeto).
 * Organizar por ordem alfabética ou por família (orders.produto_familia). Aba Inventário: janelas
 * com senha temporária (ajuste SÓ no painel). Duplicidades: mesclar (admin) e "não é duplicidade".
 * Códigos mesclados saem da lista (a ficha deles leva ao principal). Foto: miniatura do bucket "produtos".
 */

import { TblFit } from "@/components/TabelaFit";
import "../estoque/estoque.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  alarme, alertasLista, baixarCSV, textoBusca, cobertura, consumoDia, dias, hoje, nomeLocal, normMov, parado, situacao, somaDias,
  temAlarme, valorItem, type ItemEstoque, type MovEstoque, type ParDup,
} from "@/lib/estoque";
import {
  Lupa, PaletaEstoque, Pill, Thumb, brl, ddmm, ddmmaa, dsem, guardarNavegacao, kbrl, postar, q, useAtalhoPaleta, useItensEstoque,
  useSessaoInv, useToast,
} from "../estoque/comum";
import { ModalMesclar } from "../estoque/Acoes";
import { ListaMesclagens, MesclarTodos, type GrupoMescla, type LoteMescla } from "../estoque/MesclarTodos";
import AbaInventario from "../estoque/Inventario";
import { AbaMovs } from "../estoque/Movimentacoes";

export type Aba = "itens" | "dups" | "movs" | "inv";
/** Rota de cada aba — desde 02/10/26 as abas são a 2ª linha do menu (AppSidebar › MODULES). */
export const ROTA_ABA: Record<Aba, string> = { itens: "/estoque", dups: "/estoque/duplicidades", movs: "/estoque/movimentacao", inv: "/estoque/inventario" };
const TITULO: Record<Aba, string> = { itens: "Itens", dups: "Duplicidades", movs: "Movimentação", inv: "Inventário" };
/** Para que serve cada aba — uma linha, sem jargão (pedido do Benny, 02/10/26). */
const PARA_QUE: Record<Aba, string> = {
  itens: "Tudo o que está em estoque: quanto tem, quanto dura e onde está. Clique num item para abrir a ficha.",
  movs: "Tudo o que entrou e saiu, dia a dia — as NF do Omie e as movimentações lançadas aqui (obra, transferência, consumo, perda…).",
  inv: "Contagem física: com a senha da janela de inventário, confira e acerte o saldo (o acerto fica só no painel).",
  dups: "Itens cadastrados duas vezes. Junte os códigos e tudo (saldo, compras, movimentos) passa a ficar num só.",
};
type Filtro = { k: string; rotulo: string; f: (p: ItemEstoque) => boolean; title?: string };

/** Itens sem NCM válido na tabela oficial (05/10/26) — preenchido por /api/fiscal/ncm?op=sem_ncm. */
let SEM_NCM: Set<string> = new Set();
const FILTROS: Filtro[] = [
  { k: "todos", rotulo: "Todos", f: () => true },
  { k: "saldo", rotulo: "Com saldo", f: (p) => p.saldo !== 0 },
  { k: "ruptura", rotulo: "Ruptura", f: (p) => situacao(p)[0] === "Ruptura", title: "Tem consumo nos últimos 90 dias e saldo ≤ 0" },
  { k: "negativo", rotulo: "Saldo negativo", f: (p) => p.saldo < 0 },
  { k: "cobertura", rotulo: "Cobertura < 30 d", f: (p) => { const c = cobertura(p); return c !== null && c < 30; } },
  { k: "alarme", rotulo: "Alarme disparado", f: (p) => ["crit", "warn"].includes(alarme(p)[1]), title: "Alarmes por peça chegam na fase 2" },
  { k: "semalarme", rotulo: "Consumo sem alarme", f: (p) => consumoDia(p) > 0 && !temAlarme(p) },
  { k: "dup", rotulo: "Em duplicidade (itens)", f: (p) => p.duplicidade, title: "Itens que aparecem em algum grupo de duplicidade (a aba Duplicidades conta grupos)" },
  { k: "parado", rotulo: "Parado +180 d", f: parado },
  { k: "semncm", rotulo: "Sem NCM válido", f: (p) => SEM_NCM.has(p.codigo_novo ?? "") || SEM_NCM.has(p.codigo_omie ?? "") || SEM_NCM.has(p.codigo),
    title: "Sem NCM, ou NCM que não existe na tabela oficial — abra o item e use “Localizar NCM”" },
  { k: "audit", rotulo: "Com alerta de auditoria", f: (p) => alertasLista(p) > 0,
    title: "Saldo negativo (total ou por local), PC aberto > 60 dias, recebido a mais, duplicidade, consumo sem alarme ou CMC zerado. A ficha mostra também quebra de Kardex e preço fora da curva." },
];

type Col = { k: string; rotulo: string; v: (p: ItemEstoque) => string | number; cls?: string };
const COLS: Col[] = [
  { k: "item", rotulo: "Item", v: (p) => p.descricao },
  { k: "sit", rotulo: "Situação", v: (p) => situacao(p)[0] },
  { k: "saldo", rotulo: "Saldo ⓘ", v: (p) => p.saldo, cls: "r" },
  { k: "pend", rotulo: "Pendente", v: (p) => p.pendente, cls: "r opt tf-p2" },
  { k: "al", rotulo: "Alarme", v: (p) => alarme(p)[0], cls: "opt tf-p3" },
  { k: "cob", rotulo: "Cobertura", v: (p) => cobertura(p) ?? 1e9 },
  { k: "ult", rotulo: "Última mov.", v: (p) => p.ult_mov ?? "", cls: "opt tf-p3" },
  { k: "cmc", rotulo: "CMC", v: (p) => p.cmc, cls: "r opt tf-p2" },
  { k: "valor", rotulo: "Valor", v: valorItem, cls: "r" },
];

const ESTADO = "est-lista-v1";
const ORG = "est-organizar-v1";
const SEM_FAMILIA = "Sem família";
type EstadoLista = { filtro: string; busca: string; ordem: [string, number]; limite: number };
const estadoInicial = (): EstadoLista => {
  const base: EstadoLista = { filtro: "saldo", busca: "", ordem: ["valor", -1], limite: 100 };
  try { const { aba: _a, ...salvo } = JSON.parse(sessionStorage.getItem(ESTADO) || "{}"); void _a; return { ...base, ...salvo }; } catch { return base; }
};

export default function TelaEstoqueNavy({ clienteInicial, aba = "itens" }: { clienteInicial?: string | null; aba?: Aba }) {
  const router = useRouter();
  const { dados, erro, recarregar } = useItensEstoque();
  const [sessao] = useSessaoInv();
  const irAba = useCallback((a: Aba) => router.push(ROTA_ABA[a]), [router]);
  const [st, setSt] = useState<EstadoLista>({ filtro: "saldo", busca: "", ordem: ["valor", -1], limite: 100 });
  const [pronto, setPronto] = useState(false);
  const [pal, setPal] = useState(false);
  const [cliente, setCliente] = useState<string | null>(clienteInicial ?? null);
  const [idsCliente, setIdsCliente] = useState<Set<number> | null>(null);

  useEffect(() => { setSt(estadoInicial()); setPronto(true); }, []);
  useEffect(() => { if (pronto) try { sessionStorage.setItem(ESTADO, JSON.stringify(st)); } catch {} }, [st, pronto]);
  const muda = useCallback((p: Partial<EstadoLista>) => setSt((s) => ({ ...s, ...p })), []);

  // Filtro "usados por cliente" (vem do ⌘K, da ficha ou de ?cliente=).
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      if (cliente) u.searchParams.set("cliente", cliente); else u.searchParams.delete("cliente");
      window.history.replaceState(null, "", u.pathname + u.search);
    } catch {}
    if (!cliente) { setIdsCliente(null); return; }
    let vivo = true;
    fetch(`/api/estoque/busca?cliente=${encodeURIComponent(cliente)}`).then((r) => r.json())
      .then((j) => vivo && setIdsCliente(new Set((j.ids ?? []).map(Number)))).catch(() => vivo && setIdsCliente(new Set()));
    return () => { vivo = false; };
  }, [cliente]);

  const abrirPal = useCallback(() => setPal(true), []);
  useAtalhoPaleta(abrirPal);
  useEffect(() => { try { if (new URL(window.location.href).searchParams.get("paleta")) setPal(true); } catch {} }, []);

  const [ncmVersao, setNcmVersao] = useState(0);
  useEffect(() => {
    fetch("/api/fiscal/ncm?op=sem_ncm").then((r) => r.json()).then((j: { itens?: { codigo: string; codigo_omie: string | null }[] }) => {
      SEM_NCM = new Set((j.itens ?? []).flatMap((i) => [i.codigo, i.codigo_omie]).filter((c): c is string => !!c));
      setNcmVersao((v) => v + 1);
    }).catch(() => null);
  }, []);
  const todosItens = useMemo(() => dados?.itens ?? [], [dados]);
  /** Códigos mesclados em outro saem da lista (continuam no ⌘K e na ficha, com o aviso). */
  const itens = useMemo(() => todosItens.filter((p) => !p.mesclado_em), [todosItens]);
  const porId = useMemo(() => new Map(todosItens.map((p) => [p.n_cod_prod, p])), [todosItens]);

  const lista = useMemo(() => {
    const f = (FILTROS.find((x) => x.k === st.filtro) ?? FILTROS[1]).f, t = st.busca.trim().toLowerCase();
    let rs = itens.filter(f);
    if (idsCliente) rs = rs.filter((p) => idsCliente.has(p.n_cod_prod));
    if (t) rs = rs.filter((p) => textoBusca(p).toLowerCase().includes(t));
    const col = (COLS.find((c) => c.k === st.ordem[0]) ?? COLS[8]).v, d = st.ordem[1];
    return [...rs].sort((a, b) => { const x = col(a), y = col(b); return (x > y ? 1 : x < y ? -1 : 0) * d; });
  }, [itens, st.filtro, st.busca, st.ordem, idsCliente, ncmVersao]);

  const abrir = useCallback((p: ItemEstoque, aba?: string) => {
    const nav = lista.some((x) => x.n_cod_prod === p.n_cod_prod) ? lista : itens;
    guardarNavegacao(nav.map((x) => x.codigo));
    router.push(`/estoque/${encodeURIComponent(p.codigo)}${aba ? `?aba=${aba}` : ""}`);
  }, [lista, itens, router]);

  const nDups = useMemo(() => grupos(dados?.dups ?? []).length, [dados]);

  return (
    <div className="est">
      <header className="cartao head">
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1>{TITULO[aba]}{aba === "inv" && sessao ? <span className="b" style={{ marginLeft: 10, fontSize: 12, verticalAlign: "middle", padding: "2px 8px", borderRadius: 999, background: "var(--ww-ok-soft)", color: "var(--ww-ok-text)" }}>sessão aberta</span> : null}</h1>
          <div className="sub">{PARA_QUE[aba]}</div>
        </div>
        {aba === "itens" && <button className="btn pri" onClick={() => router.push("/estoque/novo")} style={{ fontWeight: 700, padding: "0 18px", height: 40 }}>+ Novo item</button>}
      </header>

      {erro && <div className="aviso t-crit">{erro}</div>}
      {!dados && !erro && aba !== "movs" && <div className="cartao vazio">Carregando itens…</div>}

      {dados && aba === "itens" && (
        <AbaItens itens={itens} lista={lista} st={st} muda={muda} abrir={abrir}
          cliente={cliente} carregandoCliente={!!cliente && !idsCliente} limparCliente={() => setCliente(null)} nDups={nDups} irDups={() => irAba("dups")} />
      )}
      {dados && aba === "dups" && <AbaDups dups={dados.dups} porId={porId} abrir={abrir} admin={dados.admin} recarregar={recarregar} />}
      {aba === "movs" && <AbaMovs porId={porId} itens={itens} abrir={abrir} />}
      {dados && aba === "inv" && <AbaInventario admin={dados.admin} itens={itens} aoMudar={recarregar} />}

      {pal && dados && (
        <PaletaEstoque itens={todosItens} fechar={() => setPal(false)}
          onItem={(p) => abrir(p)}
          onPc={(id) => { const p = porId.get(id); if (p) abrir(p, "compras"); }}
          onCliente={(nome) => { setCliente(nome); muda({ filtro: "todos" }); if (aba !== "itens") router.push(`/estoque?cliente=${encodeURIComponent(nome)}`); }} />
      )}
    </div>
  );
}

// ── Itens ────────────────────────────────────────────────────────────────────
function AbaItens({ itens, lista, st, muda, abrir, cliente, carregandoCliente, limparCliente, nDups, irDups }: {
  itens: ItemEstoque[]; lista: ItemEstoque[]; st: EstadoLista; muda: (p: Partial<EstadoLista>) => void;
  abrir: (p: ItemEstoque) => void; cliente: string | null; carregandoCliente: boolean; limparCliente: () => void; nDups: number; irDups: () => void;
}) {
  const conta = useMemo(() => Object.fromEntries(FILTROS.map((f) => [f.k, itens.filter(f.f).length])), [itens, lista]);
  const vt = itens.reduce((s, p) => s + valorItem(p), 0);
  const parados = itens.filter(parado), vpar = parados.reduce((s, p) => s + valorItem(p), 0);
  const comSaldo = itens.filter((p) => p.saldo > 0).length;

  // Os cartões SÃO os filtros (clique = filtra; de novo = volta para "Com saldo").
  const kpi = (k: string, rotulo: string, v: string, s: string, tom = "", glow = "", titulo?: string) => (
    <button key={k} className={`kpi ${st.filtro === k ? "on" : ""}`} style={glow ? ({ "--glow": glow } as React.CSSProperties) : undefined}
      title={titulo} aria-pressed={st.filtro === k} onClick={() => muda({ filtro: st.filtro === k ? "saldo" : k, limite: 100 })}>
      <div className="r">{rotulo}</div><div className="v">{v}</div><div className={`s ${tom}`}>{s}</div>
    </button>
  );
  const [maisAberto, setMaisAberto] = useState(false);
  const MAIS = ["cobertura", "alarme", "semalarme", "dup", "semncm", "audit"];
  const filtroMais = MAIS.includes(st.filtro) ? FILTROS.find((f) => f.k === st.filtro) : null;

  // Organizar: A–Z (ordem da coluna escolhida) ou por família (grupos que abrem/fecham). Fica no navegador.
  const [org, setOrgSt] = useState<"alfa" | "familia">("alfa");
  useEffect(() => { try { if (localStorage.getItem(ORG) === "familia") setOrgSt("familia"); } catch {} }, []);
  const setOrg = (v: "alfa" | "familia") => { setOrgSt(v); try { localStorage.setItem(ORG, v); } catch {} };
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const alterna = (f: string) => setAbertas((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const semFamilia = itens.filter((p) => !p.familia).length;
  const grupos = useMemo(() => {
    const m = new Map<string, ItemEstoque[]>();
    for (const p of lista) { const k = p.familia || SEM_FAMILIA; (m.get(k) ?? m.set(k, []).get(k)!).push(p); }
    return [...m.entries()].sort(([a], [b]) => (a === SEM_FAMILIA ? 1 : b === SEM_FAMILIA ? -1 : a.localeCompare(b, "pt-BR")));
  }, [lista]);
  const visiveis = lista.slice(0, st.limite);

  const csv = () => baixarCSV(`estoque-${hoje()}.csv`, [
    ["Código novo", "Código Omie", "Descrição", "Família", "Un", "Situação", "Saldo", "Pendente", "Reservado", "Consumo 90 d", "Cobertura (dias)", "Última mov.", "CMC", "Valor", "Locais"],
    ...lista.map((p) => [p.codigo_novo ?? "", p.codigo_omie ?? p.codigo, p.descricao, p.familia ?? "", p.unidade, situacao(p)[0], p.saldo, p.pendente, p.reservado, p.consumo_90d,
      cobertura(p) ?? "", p.ult_mov ?? "", p.cmc, Math.round(valorItem(p) * 100) / 100,
      p.locais.map((l) => `${nomeLocal(l.local)} ${l.saldo}`).join(" + ")]),
  ]);

  return (<>
    <section className="kpis k4">
      {kpi("saldo", "Valor em estoque ⓘ", kbrl(vt), `${q(comSaldo)} itens com saldo · ao CMC`, "", "", "Saldo = posição do Omie + ajustes e movimentações lançados no painel")}
      {kpi("ruptura", "Em ruptura", q(conta.ruptura), "têm consumo e não têm saldo", "crit", "rgba(255,107,74,.26)")}
      {kpi("negativo", "Saldo negativo", q(conta.negativo), "saldo impossível — conferir", "crit", "rgba(154,130,255,.3)")}
      {kpi("parado", "Parado há +180 dias", kbrl(vpar), `${q(parados.length)} itens · ${Math.round((vpar / Math.max(vt, 1)) * 100)}% do valor`, "warn", "rgba(59,184,255,.22)")}
    </section>
    {nDups > 0 && <div className="aviso t-info"><span>{q(nDups)} grupos de itens cadastrados duas vezes.</span><span style={{ flex: 1 }} /><button className="btn sm" onClick={irDups}>Ver duplicidades</button></div>}

    <div className="cartao">
      <div className="head" style={{ padding: "12px 16px", gap: 10 }}>
        {/* 09/10/26: a busca vem sempre primeiro, à esquerda (regra do painel) */}
        <input className="inp" value={st.busca} onChange={(e) => muda({ busca: e.target.value, limite: 100 })}
          placeholder="Buscar item, código, família…" style={{ width: 280 }} aria-label="Filtrar a lista" />
        <div className="filtros" style={{ flex: 1, position: "relative" }}>
          {FILTROS.filter((f) => f.k === "todos" || f.k === "saldo").map((f) => (
            <button key={f.k} className={`chip ${st.filtro === f.k ? "on" : ""}`} title={f.title}
              onClick={() => muda({ filtro: f.k, limite: 100 })}>{f.rotulo} <b>{q(conta[f.k])}</b></button>
          ))}
          {filtroMais && <button className="chip on" onClick={() => muda({ filtro: "saldo", limite: 100 })}>{filtroMais.rotulo} <b>{q(conta[filtroMais.k])}</b> ✕</button>}
          <button className="chip" onClick={() => setMaisAberto((x) => !x)} aria-expanded={maisAberto}>Mais filtros ▾</button>
          {maisAberto && (
            <div className="menu-mais" onMouseLeave={() => setMaisAberto(false)}>
              {FILTROS.filter((f) => MAIS.includes(f.k)).map((f) => (
                <button key={f.k} className={st.filtro === f.k ? "on" : ""} title={f.title} onClick={() => { muda({ filtro: f.k, limite: 100 }); setMaisAberto(false); }}>
                  {f.rotulo} <b>{q(conta[f.k])}</b></button>
              ))}
            </div>
          )}
        </div>
        <div className="seg" title="Organizar a lista">
          <button className={org === "alfa" ? "on" : ""} onClick={() => setOrg("alfa")}>A–Z</button>
          <button className={org === "familia" ? "on" : ""} onClick={() => setOrg("familia")}>Família</button>
        </div>
        <button className="btn sm" onClick={csv}>CSV</button>
      </div>
      {cliente && (
        <div style={{ padding: "0 16px 10px" }}>
          <span className="tag-x">Usados por: {cliente}{carregandoCliente ? " (carregando…)" : ""}
            <button onClick={limparCliente} aria-label="Tirar filtro de cliente">×</button></span>
        </div>
      )}
      {st.busca.trim() && (
        <div className="busca-ativa" role="status">
          Filtrando por “{st.busca.trim()}” · {q(lista.length)} de {q(itens.length)} itens{org === "familia" ? ` em ${grupos.length} famílias` : ""}
          <button onClick={() => muda({ busca: "", limite: 100 })}>limpar ✕</button>
        </div>
      )}
      {org === "familia" && semFamilia === itens.length && (
        <div style={{ padding: "0 16px 10px" }}><div className="aviso t-info">As famílias ainda não chegaram do Omie (sincronização de produtos em andamento). Por enquanto todos os itens aparecem em “Sem família”.</div></div>
      )}
      <TblFit className="scroll tf-col1" style={{ maxHeight: "calc(100vh - 160px)" }}>
        <table className="tabela">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.k} className={`th-sort ${c.cls ?? ""} ${st.ordem[0] === c.k ? "on" : ""}`} title={c.k === "saldo" ? "Saldo = posição do Omie + ajustes e movimentações lançados no painel" : undefined}
                  onClick={() => muda({ ordem: [c.k, st.ordem[0] === c.k ? -st.ordem[1] : c.k === "item" ? 1 : -1] })}>
                  {c.rotulo}{st.ordem[0] === c.k ? (st.ordem[1] > 0 ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {org === "alfa" && visiveis.map((p) => <LinhaItem key={`${p.empresa}:${p.n_cod_prod}`} p={p} abrir={abrir} />)}
            {org === "familia" && grupos.map(([fam, l]) => {
              const aberto = abertas.has(fam);
              return [
                <tr key={`f:${fam}`} className="grp-fam" onClick={() => alterna(fam)}>
                  <td colSpan={9}>
                    <span style={{ display: "inline-flex", transform: `rotate(${aberto ? 90 : 0}deg)`, transition: ".15s", marginRight: 8 }}>›</span>
                    {fam} <span className="mini">· {q(l.length)} itens · {brl(l.reduce((s, p) => s + valorItem(p), 0))}{l.some((p) => p.saldo < 0) ? ` · ${l.filter((p) => p.saldo < 0).length} negativo(s)` : ""}</span>
                  </td>
                </tr>,
                ...(aberto ? l.map((p) => <LinhaItem key={`${p.empresa}:${p.n_cod_prod}`} p={p} abrir={abrir} />) : []),
              ];
            })}
            {!lista.length && <tr><td colSpan={9} className="vazio">Nenhum item nesse filtro.</td></tr>}
          </tbody>
        </table>
        {org === "alfa" && lista.length > st.limite && (
          <div className="mais">
            <button className="btn sm" onClick={() => muda({ limite: st.limite + 100 })}>
              Mostrar mais {Math.min(100, lista.length - st.limite)} de {q(lista.length - st.limite)} restantes
            </button>
          </div>
        )}
      </TblFit>
      <div className="tfoot">
        <span>{q(lista.length)} itens{org === "familia" ? ` em ${grupos.length} famílias` : ""} · valor <b style={{ color: "var(--ww-text)" }}>{brl(lista.reduce((s, p) => s + valorItem(p), 0))}</b></span>
        {org === "familia" && grupos.length > 1 && (
          <span style={{ marginLeft: "auto" }}>
            <button className="btn sm" onClick={() => setAbertas(new Set(grupos.map(([f]) => f)))}>Abrir todas</button>{" "}
            <button className="btn sm" onClick={() => setAbertas(new Set())}>Fechar todas</button>
          </span>
        )}
      </div>
    </div>
  </>);
}

function LinhaItem({ p, abrir }: { p: ItemEstoque; abrir: (p: ItemEstoque) => void }) {
  const [st, tom] = situacao(p), [al, atom] = alarme(p), cob = cobertura(p);
  return (
    <tr className="click" onClick={() => abrir(p)}>
      <td>
        <div className="prod"><Thumb src={p.foto} />
          <div>
            <div className="n">{p.descricao}{p.duplicidade && <span className="dup">duplicidade?</span>}</div>
            <div className="c">{p.codigo_novo ? <><b style={{ color: "var(--ww-text-2)" }}>{p.codigo_novo}</b> · Omie {p.codigo_omie ?? p.codigo}</> : p.codigo} · {p.locais.map((l) => nomeLocal(l.local)).join(" + ")}{p.familia ? ` · ${p.familia}` : ""}
              {p.ajuste !== 0 && <span className="ajustado" title={`Omie ${q(p.saldo_omie)} · ajuste no painel ${p.ajuste > 0 ? "+" : ""}${q(p.ajuste)}`}> · ajustado</span>}</div>
          </div>
        </div>
      </td>
      <td><Pill t={st} tom={tom} /></td>
      <td className="r" style={{ fontWeight: 600, color: p.saldo < 0 ? "var(--ww-crit-text)" : undefined }}>{q(p.saldo)}{p.reservado_proj ? <div className="disp-res" title={`Separado para ${p.n_projetos} projeto(s) — disponível = saldo − separado`}>disp. {q(p.saldo - p.reservado_proj)} · sep. {q(p.reservado_proj)}</div> : null}</td>
      <td className="r opt tf-p2">{p.pendente ? q(p.pendente) : <span className="mini">—</span>}</td>
      <td className="opt tf-p3"><Pill t={al} tom={atom} /></td>
      <td>
        {cob === null ? <span className="mini">sem consumo</span> : (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="barra" style={{ width: 70 }}>
              <i style={{ width: `${Math.min(100, Math.max(3, cob / 1.8))}%`, background: `var(--ww-${cob === 0 ? "crit" : cob < 30 ? "warn" : "ok"})` }} />
            </div>
            <span className="num">{cob > 999 ? "999+" : q(cob)} d</span>
          </div>
        )}
      </td>
      <td className="opt tf-p3"><span className="num">{ddmmaa(p.ult_mov)}</span>{p.ult_mov && <span className="mini"> · {dias(p.ult_mov)} d</span>}</td>
      <td className="r opt tf-p2">{brl(p.cmc)}</td>
      <td className="r" style={{ fontWeight: 600 }}>{brl(valorItem(p))}</td>
    </tr>
  );
}

// ── Duplicidades (só leitura; decisões na fase 4) ───────────────────────────
type Grupo = { k: string; ids: number[]; tipo: "exata" | "similar"; sim: number };
function grupos(dups: ParDup[]): Grupo[] {
  const ex = new Map<string, Set<number>>(), out: Grupo[] = [];
  for (const d of dups) {
    if (d.tipo === "exata") {
      const k = `${d.empresa}:${d.chave ?? d.prod_a}`;
      const s = ex.get(k) ?? ex.set(k, new Set()).get(k)!;
      s.add(d.prod_a); s.add(d.prod_b);
    } else out.push({ k: `s:${d.prod_a}-${d.prod_b}`, ids: [d.prod_a, d.prod_b], tipo: "similar", sim: d.sim });
  }
  return [...[...ex.entries()].map(([k, s]) => ({ k, ids: [...s], tipo: "exata" as const, sim: 1 })), ...out];
}

function AbaDups({ dups, porId, abrir, admin, recarregar }: {
  dups: ParDup[]; porId: Map<number, ItemEstoque>; abrir: (p: ItemEstoque) => void; admin: boolean; recarregar: () => Promise<void>;
}) {
  const [f, setF] = useState<"todos" | "exata" | "similar" | "saldo">("todos");
  const [mesclar, setMesclar] = useState<{ its: ItemEstoque[]; tipo: "exata" | "parecido" } | null>(null);
  const [todosAberto, setTodosAberto] = useState(false);
  const [toast, avisar] = useToast();
  const [decisoes, setDecisoes] = useState<Decisao[] | null>(null);
  const [gruposM, setGruposM] = useState<GrupoMescla[]>([]);
  const [lotes, setLotes] = useState<LoteMescla[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const carregarDec = useCallback(async () => {
    const r = await fetch("/api/estoque/duplicidade", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) { setDecisoes(j.decisoes); setGruposM(j.grupos ?? []); setLotes(j.lotes ?? []); }
  }, []);
  const aposMudar = useCallback(async () => { await recarregar(); await carregarDec(); }, [recarregar, carregarDec]);
  useEffect(() => { carregarDec(); }, [carregarDec]);
  // aquece a prévia do "Mesclar todos" (a 1ª chamada da função é lenta) — resultado descartado
  useEffect(() => { if (admin) fetch("/api/estoque/duplicidade?previa=exatas", { cache: "no-store" }).catch(() => null); }, [admin]);

  const todos = useMemo(() => grupos(dups).filter((g) => g.ids.every((i) => porId.has(i))), [dups, porId]);
  const itensDe = (g: Grupo) => g.ids.map((i) => porId.get(i)!);
  const ambos = (g: Grupo) => itensDe(g).every((p) => p.saldo !== 0);
  const peso = (g: Grupo) => itensDe(g).reduce((s, p) => s + Math.abs(p.saldo) * p.cmc, 0);
  const rs = (f === "exata" ? todos.filter((g) => g.tipo === "exata") : f === "similar" ? todos.filter((g) => g.tipo === "similar") : f === "saldo" ? todos.filter(ambos) : todos)
    .slice().sort((a, b) => Number(b.tipo === "exata") - Number(a.tipo === "exata") || peso(b) - peso(a));

  const naoE = async (g: Grupo) => {
    setOcupado(g.k);
    try {
      const its = itensDe(g);
      for (let i = 0; i < its.length; i++) for (let j = i + 1; j < its.length; j++)
        await postar("/api/estoque/duplicidade", { acao: "nao_e", empresa: its[i].empresa, a: its[i].n_cod_prod, b: its[j].n_cod_prod });
      await recarregar(); await carregarDec(); avisar("Marcado como não duplicidade — o par saiu da lista", "ok");
    } catch (e) { avisar((e as Error).message, "crit"); } finally { setOcupado(null); }
  };
  const desfazer = async (d: Decisao) => {
    setOcupado(`d${d.id}`);
    try { await postar("/api/estoque/duplicidade", { acao: "desfazer", id: d.id }); await recarregar(); await carregarDec(); avisar(d.decisao === "mesclado" ? "Mesclagem desfeita — saldos voltaram" : "O par voltou para a lista", "ok"); }
    catch (e) { avisar((e as Error).message, "crit"); } finally { setOcupado(null); }
  };
  const cod = (id: number | null) => (id != null ? porId.get(Number(id))?.codigo ?? String(id) : "—");

  return (<>
    {todosAberto && <MesclarTodos fechar={() => setTodosAberto(false)} feito={aposMudar} avisar={avisar} />}
    <div className="aviso t-info" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
      <details><summary style={{ cursor: "pointer", fontWeight: 600 }}>Como funciona</summary><span><b>Como achamos:</b> (1) <b>nome igual</b>: o mesmo nome em códigos diferentes, ignorando acentos, espaços e pontuação; (2) <b>parecido</b>: nomes quase iguais (85% ou mais), com as mesmas medidas e números. A lista atualiza a cada 6 horas. <b>Mesclar</b> (só o administrador) escolhe o código que fica, passa o saldo dos outros para ele por ajustes do painel e tira os outros da lista; Kardex, PCs e usos dos mesclados passam a responder no principal e o ⌘K leva o código antigo ao principal. <b>Mesclar todos</b> faz todos os grupos de uma vez (cada um desfaz sozinho). <b>Não é duplicidade</b> fica gravado e o par não volta. Nada vai ao Omie.</span></details>
    </div>
    <div className="filtros">
      {([["todos", "Todos", todos.length], ["exata", "Nome igual", todos.filter((g) => g.tipo === "exata").length],
        ["similar", "Parecido", todos.filter((g) => g.tipo === "similar").length], ["saldo", "Com saldo nos dois", todos.filter(ambos).length]] as const)
        .map(([k, l, nn]) => <button key={k} className={`chip ${f === k ? "on" : ""}`} onClick={() => setF(k)}>{l} <b>{nn}</b></button>)}
      <div className="sp" />
      {!todosAberto && <button className="btn pri" style={{ fontWeight: 700 }} disabled={!admin || !todos.length} title={admin ? "Prévia de todos os grupos com o principal sugerido" : "Só o administrador (Benny) mescla"}
        onClick={() => setTodosAberto(true)}>Mesclar todos ({q(todos.length)} grupos)…</button>}
    </div>
    <div className="cartao">
      {rs.map((g) => {
        const its = itensDe(g).sort((a, b) => b.n_mov - a.n_mov);
        const cm = its.map((i) => i.cmc).filter((x) => x > 0), dif = cm.length > 1 && Math.max(...cm) / Math.min(...cm) > 1.5;
        return (
          <div key={g.k} className="grupo">
            <div className="grupo-h">
              <b>{its[0].descricao}</b>
              <Pill t={g.tipo === "exata" ? "nome igual" : `parecido ${Math.round(g.sim * 100)}%`} tom={g.tipo === "exata" ? "violet" : "info"} />
              {dif && <Pill t="CMC diferente" tom="warn" />}
              <div className="sp" />
              <button className="btn sm" disabled={ocupado === g.k} onClick={() => naoE(g)}>{ocupado === g.k ? "Gravando…" : "Não é duplicidade"}</button>
              <button className="btn sm pri" disabled={!admin} title={admin ? undefined : "Só o administrador (Benny) mescla"} onClick={() => setMesclar({ its, tipo: g.tipo === "exata" ? "exata" : "parecido" })}>Mesclar…</button>
            </div>
            <div className="cands">
              {its.map((p, i) => (
                <div key={p.n_cod_prod} className={`cand ${i === 0 ? "princ" : ""}`} onClick={() => abrir(p)} role="button" tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && abrir(p)}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                    <Thumb />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{p.codigo}</div>
                      <div className="mini" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.descricao}</div>
                    </div>
                    {i === 0 && <span style={{ marginLeft: "auto" }}><Pill t="mais usado" tom="info" /></span>}
                  </div>
                  <div className="kv"><span>Saldo</span><b style={{ color: p.saldo < 0 ? "var(--ww-crit-text)" : undefined }}>{q(p.saldo)} {p.unidade.toLowerCase()}</b></div>
                  <div className="kv"><span>CMC</span><b className={dif ? "diff" : ""}>{brl(p.cmc)}</b></div>
                  <div className="kv"><span>Movimentos · última</span><b>{q(p.n_mov)} · {ddmmaa(p.ult_mov)}</b></div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {!rs.length && <div className="vazio">Nada para revisar.</div>}
    </div>

    <ListaMesclagens grupos={gruposM} lotes={lotes} porId={porId} admin={admin} abrir={abrir} aoMudar={aposMudar} avisar={avisar} />

    {decisoes && decisoes.filter((d) => d.grupo_id == null).length > 0 && (
      <div className="cartao">
        <div className="head" style={{ padding: "12px 16px" }}><h3 style={{ margin: 0 }}>Decisões tomadas</h3></div>
        <div className="scroll"><table className="tabela">
          <thead><tr><th>Decisão</th><th>Códigos</th><th className="opt">Quem / quando</th><th /></tr></thead>
          <tbody>
            {decisoes.filter((d) => d.grupo_id == null).map((d) => (
              <tr key={d.id}>
                <td>{d.decisao === "mesclado" ? <Pill t="mesclado" tom="violet" /> : <Pill t="não é duplicidade" tom="off" />}</td>
                <td>{d.decisao === "mesclado" ? <><b>{cod(d.secundario)}</b> → <b>{cod(d.principal)}</b></> : <>{cod(d.prod_a)} × {cod(d.prod_b)}</>}</td>
                <td className="opt">{d.created_by_email ?? "—"}<div className="mini">{new Date(d.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</div></td>
                <td>{admin && <button className="btn sm" disabled={ocupado === `d${d.id}`} onClick={() => desfazer(d)}>Desfazer</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    )}
    {mesclar && <ModalMesclar itens={mesclar.its} tipo={mesclar.tipo} fechar={() => setMesclar(null)}
      ok={async (pr) => { setMesclar(null); await recarregar(); await carregarDec(); avisar(`Mesclado em ${pr.codigo}`, "ok"); }} />}
    {toast}
  </>);
}

type Decisao = { id: number; empresa: string; prod_a: number; prod_b: number; decisao: "nao_e" | "mesclado"; principal: number | null; secundario: number | null; grupo_id: number | null; created_by_email: string | null; created_at: string };
