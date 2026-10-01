"use client";

/**
 * Estoque v2 — lista (fase 1, só leitura). Porte do mockup web/docs/mockups/estoque-ficha-item
 * (branch mockup/estoque-v2): ⌘K para ir a qualquer item, lista com filtros que contam,
 * ordenação por coluna, CSV e páginas de 100; abas Duplicidades e Movimentação.
 * A ficha do item vive em /estoque/[codigo] (FichaItemNavy).
 *
 * Fonte: /api/estoque/itens (orders.v_estoque_item — saldo vem pronto de v_estoque_saldo_local)
 * e /api/estoque/movimentos (orders.v_estoque_mov_cli, com cliente/projeto).
 * Ajuste de saldo, alarme, foto e mesclagem são as fases 2–4: botões aparecem "em breve".
 */

import "../estoque/estoque.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  alarme, alertasLista, baixarCSV, cobertura, consumoDia, dias, hoje, nomeLocal, normMov, parado, situacao, somaDias,
  temAlarme, valorItem, type ItemEstoque, type MovEstoque, type ParDup,
} from "@/lib/estoque";
import {
  Lupa, PaletaEstoque, Pill, Thumb, brl, ddmm, ddmmaa, dsem, guardarNavegacao, kbrl, q, useAtalhoPaleta, useItensEstoque,
} from "../estoque/comum";

type Aba = "itens" | "dups" | "movs";
type Filtro = { k: string; rotulo: string; f: (p: ItemEstoque) => boolean; title?: string };

const FILTROS: Filtro[] = [
  { k: "todos", rotulo: "Todos", f: () => true },
  { k: "saldo", rotulo: "Com saldo", f: (p) => p.saldo !== 0 },
  { k: "ruptura", rotulo: "Ruptura", f: (p) => situacao(p)[0] === "Ruptura", title: "Tem consumo nos últimos 90 dias e saldo ≤ 0" },
  { k: "negativo", rotulo: "Saldo negativo", f: (p) => p.saldo < 0 },
  { k: "cobertura", rotulo: "Cobertura < 30 d", f: (p) => { const c = cobertura(p); return c !== null && c < 30; } },
  { k: "alarme", rotulo: "Alarme disparado", f: (p) => ["crit", "warn"].includes(alarme(p)[1]), title: "Alarmes por peça chegam na fase 2" },
  { k: "semalarme", rotulo: "Consumo sem alarme", f: (p) => consumoDia(p) > 0 && !temAlarme(p) },
  { k: "dup", rotulo: "Duplicidade", f: (p) => p.duplicidade },
  { k: "parado", rotulo: "Parado +180 d", f: parado },
  { k: "audit", rotulo: "Com alerta de auditoria", f: (p) => alertasLista(p) > 0,
    title: "Saldo negativo (total ou por local), PC aberto > 60 dias, recebido a mais, duplicidade, consumo sem alarme ou CMC zerado. A ficha mostra também quebra de Kardex e preço fora da curva." },
];

type Col = { k: string; rotulo: string; v: (p: ItemEstoque) => string | number; cls?: string };
const COLS: Col[] = [
  { k: "item", rotulo: "Item", v: (p) => p.descricao },
  { k: "sit", rotulo: "Situação", v: (p) => situacao(p)[0] },
  { k: "saldo", rotulo: "Saldo", v: (p) => p.saldo, cls: "r" },
  { k: "pend", rotulo: "Pendente", v: (p) => p.pendente, cls: "r opt" },
  { k: "al", rotulo: "Alarme", v: (p) => alarme(p)[0], cls: "opt" },
  { k: "cob", rotulo: "Cobertura", v: (p) => cobertura(p) ?? 1e9 },
  { k: "ult", rotulo: "Última mov.", v: (p) => p.ult_mov ?? "", cls: "opt" },
  { k: "cmc", rotulo: "CMC", v: (p) => p.cmc, cls: "r opt" },
  { k: "valor", rotulo: "Valor", v: valorItem, cls: "r" },
];

const ESTADO = "est-lista-v1";
type EstadoLista = { aba: Aba; filtro: string; busca: string; ordem: [string, number]; limite: number };
const estadoInicial = (): EstadoLista => {
  const base: EstadoLista = { aba: "itens", filtro: "saldo", busca: "", ordem: ["valor", -1], limite: 100 };
  try { return { ...base, ...JSON.parse(sessionStorage.getItem(ESTADO) || "{}") }; } catch { return base; }
};

export default function TelaEstoqueNavy({ clienteInicial }: { clienteInicial?: string | null }) {
  const router = useRouter();
  const { dados, erro } = useItensEstoque();
  const [st, setSt] = useState<EstadoLista>({ aba: "itens", filtro: "saldo", busca: "", ordem: ["valor", -1], limite: 100 });
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

  const itens = useMemo(() => dados?.itens ?? [], [dados]);
  const porId = useMemo(() => new Map(itens.map((p) => [p.n_cod_prod, p])), [itens]);

  const lista = useMemo(() => {
    const f = (FILTROS.find((x) => x.k === st.filtro) ?? FILTROS[1]).f, t = st.busca.trim().toLowerCase();
    let rs = itens.filter(f);
    if (idsCliente) rs = rs.filter((p) => idsCliente.has(p.n_cod_prod));
    if (t) rs = rs.filter((p) => `${p.descricao} ${p.codigo}`.toLowerCase().includes(t));
    const col = (COLS.find((c) => c.k === st.ordem[0]) ?? COLS[8]).v, d = st.ordem[1];
    return [...rs].sort((a, b) => { const x = col(a), y = col(b); return (x > y ? 1 : x < y ? -1 : 0) * d; });
  }, [itens, st.filtro, st.busca, st.ordem, idsCliente]);

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
          <div className="area">Estoque</div>
          <h1>Estoque</h1>
          <div className="sub">
            {dados ? `${q(itens.length)} itens · posição do Omie ${ddmmaa(itens[0]?.data_posicao)} · saldo = espelho do Omie` : "Carregando posição…"}
          </div>
        </div>
        <div className="goto" onClick={abrirPal} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && abrirPal()}>
          <Lupa /><span>Ir para item — código, nome, nº do PC, cliente…</span><span className="kbd">⌘K</span>
        </div>
        <div className="seg" role="tablist">
          <button className={st.aba === "itens" ? "on" : ""} onClick={() => muda({ aba: "itens" })}>Itens</button>
          <button className={st.aba === "dups" ? "on" : ""} onClick={() => muda({ aba: "dups" })}>Duplicidades{nDups ? <span className="b">{nDups}</span> : null}</button>
          <button className={st.aba === "movs" ? "on" : ""} onClick={() => muda({ aba: "movs" })}>Movimentação</button>
        </div>
      </header>

      {erro && <div className="aviso t-crit">{erro}</div>}
      {!dados && !erro && <div className="cartao vazio">Carregando itens…</div>}

      {dados && st.aba === "itens" && (
        <AbaItens itens={itens} lista={lista} st={st} muda={muda} abrir={abrir}
          cliente={cliente} carregandoCliente={!!cliente && !idsCliente} limparCliente={() => setCliente(null)} nDups={nDups} />
      )}
      {dados && st.aba === "dups" && <AbaDups dups={dados.dups} porId={porId} abrir={abrir} />}
      {dados && st.aba === "movs" && <AbaMovs porId={porId} abrir={abrir} />}

      {pal && dados && (
        <PaletaEstoque itens={itens} fechar={() => setPal(false)}
          onItem={(p) => abrir(p)}
          onPc={(id) => { const p = porId.get(id); if (p) abrir(p, "compras"); }}
          onCliente={(nome) => { setCliente(nome); muda({ aba: "itens", filtro: "todos" }); }} />
      )}
    </div>
  );
}

// ── Itens ────────────────────────────────────────────────────────────────────
function AbaItens({ itens, lista, st, muda, abrir, cliente, carregandoCliente, limparCliente, nDups }: {
  itens: ItemEstoque[]; lista: ItemEstoque[]; st: EstadoLista; muda: (p: Partial<EstadoLista>) => void;
  abrir: (p: ItemEstoque) => void; cliente: string | null; carregandoCliente: boolean; limparCliente: () => void; nDups: number;
}) {
  const conta = useMemo(() => Object.fromEntries(FILTROS.map((f) => [f.k, itens.filter(f.f).length])), [itens]);
  const vt = itens.reduce((s, p) => s + valorItem(p), 0);
  const parados = itens.filter(parado), vpar = parados.reduce((s, p) => s + valorItem(p), 0);
  const comSaldo = itens.filter((p) => p.saldo > 0).length;

  const kpi = (k: string, rotulo: string, v: string, s: string, tom = "", glow = "", hero = false, onClick?: () => void) => (
    <button key={k} className={`kpi ${hero ? "hero" : ""}`} style={glow ? ({ "--glow": glow } as React.CSSProperties) : undefined}
      onClick={onClick ?? (() => muda({ filtro: k, limite: 100 }))}>
      <div className="r">{rotulo}</div><div className="v">{v}</div><div className={`s ${tom}`}>{s}</div>
    </button>
  );

  const csv = () => baixarCSV(`estoque-${hoje()}.csv`, [
    ["Código", "Descrição", "Un", "Situação", "Saldo", "Pendente", "Reservado", "Consumo 90 d", "Cobertura (dias)", "Última mov.", "CMC", "Valor", "Locais"],
    ...lista.map((p) => [p.codigo, p.descricao, p.unidade, situacao(p)[0], p.saldo, p.pendente, p.reservado, p.consumo_90d,
      cobertura(p) ?? "", p.ult_mov ?? "", p.cmc, Math.round(valorItem(p) * 100) / 100,
      p.locais.map((l) => `${nomeLocal(l.local)} ${l.saldo}`).join(" + ")]),
  ]);

  const visiveis = lista.slice(0, st.limite);
  return (<>
    <section className="kpis">
      {kpi("saldo", "Valor em estoque", kbrl(vt), `${q(comSaldo)} itens com saldo · ao CMC`, "", "", true)}
      {kpi("ruptura", "Em ruptura", q(conta.ruptura), "têm consumo e saldo ≤ 0", "crit", "rgba(255,107,74,.26)")}
      {kpi("negativo", "Saldo negativo", q(conta.negativo), "ajustar — saldo impossível", "crit", "rgba(154,130,255,.3)")}
      {kpi("semalarme", "Consumo sem alarme", q(conta.semalarme), "alarmes por peça: fase 2", "warn", "rgba(245,197,66,.26)")}
      {kpi("dup", "Possíveis duplicidades", q(nDups), "grupos para revisar", "", "rgba(154,130,255,.3)", false, () => muda({ aba: "dups" }))}
      {kpi("parado", "Parado +180 dias", kbrl(vpar), `${q(parados.length)} itens · ${Math.round((vpar / Math.max(vt, 1)) * 100)}% do valor`, "warn", "rgba(59,184,255,.22)")}
    </section>

    <div className="cartao">
      <div className="head" style={{ padding: "12px 16px", gap: 10 }}>
        <div className="filtros" style={{ flex: 1 }}>
          {FILTROS.map((f) => (
            <button key={f.k} className={`chip ${st.filtro === f.k ? "on" : ""}`} title={f.title}
              onClick={() => muda({ filtro: f.k, limite: 100 })}>{f.rotulo} <b>{q(conta[f.k])}</b></button>
          ))}
        </div>
        <input className="inp" value={st.busca} onChange={(e) => muda({ busca: e.target.value, limite: 100 })}
          placeholder="Filtrar a lista…" style={{ width: 220 }} aria-label="Filtrar a lista" />
        <button className="btn sm" onClick={csv}>CSV</button>
      </div>
      {cliente && (
        <div style={{ padding: "0 16px 10px" }}>
          <span className="tag-x">Usados por: {cliente}{carregandoCliente ? " (carregando…)" : ""}
            <button onClick={limparCliente} aria-label="Tirar filtro de cliente">×</button></span>
        </div>
      )}
      <div className="scroll">
        <table className="tabela">
          <thead>
            <tr>
              {COLS.map((c) => (
                <th key={c.k} className={`th-sort ${c.cls ?? ""} ${st.ordem[0] === c.k ? "on" : ""}`}
                  onClick={() => muda({ ordem: [c.k, st.ordem[0] === c.k ? -st.ordem[1] : c.k === "item" ? 1 : -1] })}>
                  {c.rotulo}{st.ordem[0] === c.k ? (st.ordem[1] > 0 ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiveis.map((p) => <LinhaItem key={`${p.empresa}:${p.n_cod_prod}`} p={p} abrir={abrir} />)}
            {!visiveis.length && <tr><td colSpan={9} className="vazio">Nenhum item nesse filtro.</td></tr>}
          </tbody>
        </table>
        {lista.length > st.limite && (
          <div className="mais">
            <button className="btn sm" onClick={() => muda({ limite: st.limite + 100 })}>
              Mostrar mais {Math.min(100, lista.length - st.limite)} de {q(lista.length - st.limite)} restantes
            </button>
          </div>
        )}
      </div>
      <div className="tfoot">
        <span>{q(lista.length)} itens · valor <b style={{ color: "var(--ww-text)" }}>{brl(lista.reduce((s, p) => s + valorItem(p), 0))}</b></span>
      </div>
    </div>
  </>);
}

function LinhaItem({ p, abrir }: { p: ItemEstoque; abrir: (p: ItemEstoque) => void }) {
  const [st, tom] = situacao(p), [al, atom] = alarme(p), cob = cobertura(p);
  return (
    <tr className="click" onClick={() => abrir(p)}>
      <td>
        <div className="prod"><Thumb />
          <div>
            <div className="n">{p.descricao}{p.duplicidade && <span className="dup">duplicidade?</span>}</div>
            <div className="c">{p.codigo} · {p.locais.map((l) => nomeLocal(l.local)).join(" + ")}</div>
          </div>
        </div>
      </td>
      <td><Pill t={st} tom={tom} /></td>
      <td className="r" style={{ fontWeight: 600, color: p.saldo < 0 ? "var(--ww-crit-text)" : undefined }}>{q(p.saldo)}</td>
      <td className="r opt">{p.pendente ? q(p.pendente) : <span className="mini">—</span>}</td>
      <td className="opt"><Pill t={al} tom={atom} /></td>
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
      <td className="opt"><span className="num">{ddmmaa(p.ult_mov)}</span>{p.ult_mov && <span className="mini"> · {dias(p.ult_mov)} d</span>}</td>
      <td className="r opt">{brl(p.cmc)}</td>
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

function AbaDups({ dups, porId, abrir }: { dups: ParDup[]; porId: Map<number, ItemEstoque>; abrir: (p: ItemEstoque) => void }) {
  const [f, setF] = useState<"todos" | "exata" | "similar" | "saldo">("todos");
  const todos = useMemo(() => grupos(dups).filter((g) => g.ids.every((i) => porId.has(i))), [dups, porId]);
  const itensDe = (g: Grupo) => g.ids.map((i) => porId.get(i)!);
  const ambos = (g: Grupo) => itensDe(g).every((p) => p.saldo !== 0);
  const peso = (g: Grupo) => itensDe(g).reduce((s, p) => s + Math.abs(p.saldo) * p.cmc, 0);
  const rs = (f === "exata" ? todos.filter((g) => g.tipo === "exata") : f === "similar" ? todos.filter((g) => g.tipo === "similar") : f === "saldo" ? todos.filter(ambos) : todos)
    .slice().sort((a, b) => Number(b.tipo === "exata") - Number(a.tipo === "exata") || peso(b) - peso(a));
  return (<>
    <div className="aviso t-info">
      <span><b>Como achamos:</b> (1) <b>nome igual</b>: descrição sem acento, espaço e pontuação idêntica em códigos diferentes; (2) <b>parecido</b>: similaridade de trigramas ≥ 85% (pg_trgm), com as mesmas medidas/números e sem trocar códigos curtos (C×LR, AZ×PT). Atualiza a cada 6 horas. <b>Mesclar</b> e <b>Não é duplicidade</b> chegam na próxima fase.</span>
    </div>
    <div className="filtros">
      {([["todos", "Todos", todos.length], ["exata", "Nome igual", todos.filter((g) => g.tipo === "exata").length],
        ["similar", "Parecido", todos.filter((g) => g.tipo === "similar").length], ["saldo", "Com saldo nos dois", todos.filter(ambos).length]] as const)
        .map(([k, l, nn]) => <button key={k} className={`chip ${f === k ? "on" : ""}`} onClick={() => setF(k)}>{l} <b>{nn}</b></button>)}
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
              <button className="btn sm" disabled title="Em breve (fase 4)">Não é duplicidade</button>
              <button className="btn sm pri" disabled title="Em breve (fase 4)">Mesclar…</button>
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
  </>);
}

// ── Movimentação ─────────────────────────────────────────────────────────────
function AbaMovs({ porId, abrir }: { porId: Map<number, ItemEstoque>; abrir: (p: ItemEstoque, aba?: string) => void }) {
  const h = hoje();
  const [de, setDe] = useState(somaDias(h, -30));
  const [ate, setAte] = useState(h);
  const [tipo, setTipo] = useState<"" | "entrada" | "saida" | "semcli">("");
  const [busca, setBusca] = useState("");
  const [movs, setMovs] = useState<MovEstoque[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ctrl = new AbortController();
    setMovs(null); setErro(null);
    fetch(`/api/estoque/movimentos?de=${de}&ate=${ate}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setMovs((j.rows as Record<string, unknown>[]).map(normMov)); })
      .catch((e) => { if ((e as Error).name !== "AbortError") setErro((e as Error).message); });
    return () => ctrl.abort();
  }, [de, ate]);

  const t = busca.trim().toLowerCase();
  const rs = (movs ?? []).filter((m) =>
    (!tipo || (tipo === "entrada" ? m.qtde > 0 : m.qtde < 0)) && (tipo !== "semcli" || (!m.cancelado && !m.cliente))
    && (!t || [porId.get(m.id_prod ?? -1)?.descricao, porId.get(m.id_prod ?? -1)?.codigo, m.doc, m.cliente, m.projeto, m.num_pedido]
      .some((v) => (v ?? "").toLowerCase().includes(t))));
  const vivos = rs.filter((m) => !m.cancelado), ent = vivos.filter((m) => m.qtde > 0), sai = vivos.filter((m) => m.qtde < 0);
  const v = (l: MovEstoque[]) => l.reduce((s, m) => s + Math.abs(m.qtde) * (m.valor || 0), 0);
  const porDia = new Map<string, MovEstoque[]>();
  rs.forEach((m) => { (porDia.get(m.dt_mov) ?? porDia.set(m.dt_mov, []).get(m.dt_mov)!).push(m); });
  const primeiro = rs[0]?.dt_mov;
  const aberto = (d: string) => abertos.size ? abertos.has(d) : d === primeiro;
  const alterna = (d: string) => setAbertos((s) => {
    const n = new Set(s.size ? s : primeiro ? [primeiro] : []);
    if (n.has(d)) n.delete(d); else n.add(d);
    return n;
  });

  return (<>
    <div className="filtros">
      <input type="date" className="inp" value={de} onChange={(e) => setDe(e.target.value)} style={{ borderRadius: 999, height: 32 }} aria-label="De" />
      <span className="mini">→</span>
      <input type="date" className="inp" value={ate} onChange={(e) => setAte(e.target.value)} style={{ borderRadius: 999, height: 32 }} aria-label="Até" />
      {([["entrada", "Entradas"], ["saida", "Saídas"], ["semcli", "Saída sem cliente"]] as const).map(([k, l]) => (
        <button key={k} className={`chip ${tipo === k ? "on" : ""}`} onClick={() => setTipo(tipo === k ? "" : k)}>{l}</button>
      ))}
      <div className="sp" />
      <input className="inp" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto, doc, cliente…" style={{ width: 240 }} aria-label="Buscar movimentos" />
    </div>
    {erro && <div className="aviso t-crit">{erro}</div>}
    {!movs && !erro && <div className="cartao vazio">Carregando movimentos…</div>}
    {movs && (<>
      <section className="kpis">
        <div className="kpi hero" style={{ cursor: "default" }}><div className="r">Movimentos no período</div><div className="v">{q(rs.length)}</div><div className="s">{ddmm(de)} a {ddmm(ate)} · {rs.length - vivos.length} cancelados</div></div>
        <div className="kpi" style={{ cursor: "default" }}><div className="r">Entradas</div><div className="v">{kbrl(v(ent))}</div><div className="s">{ent.length} movimentos</div></div>
        <div className="kpi" style={{ cursor: "default", "--glow": "rgba(255,107,74,.26)" } as React.CSSProperties}><div className="r">Saídas</div><div className="v">{kbrl(v(sai))}</div><div className="s">{sai.length} movimentos · {sai.filter((m) => !m.cliente).length} sem cliente</div></div>
        <div className="kpi" style={{ cursor: "default" }}><div className="r">Itens movimentados</div><div className="v">{q(new Set(vivos.map((m) => m.id_prod)).size)}</div><div className="s">distintos</div></div>
      </section>
      <div className="cartao" style={{ overflow: "hidden" }}>
        {[...porDia.entries()].map(([d, l]) => {
          const e = l.filter((m) => m.qtde > 0 && !m.cancelado), s = l.filter((m) => m.qtde < 0 && !m.cancelado), ab = aberto(d);
          return (
            <div key={d}>
              <div className="mov-dia" onClick={() => alterna(d)} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === "Enter" && alterna(d)}>
                <span style={{ display: "inline-flex", transform: `rotate(${ab ? 90 : 0}deg)`, transition: ".15s" }}>›</span>
                <b>{ddmm(d)} · {dsem(d)}</b>
                <span className="mini">{l.length} movimentos · {e.length} entradas · {s.length} saídas</span>
                <span style={{ marginLeft: "auto" }} className="num">
                  <span style={{ color: "var(--ww-ok-text)" }}>+{kbrl(v(e))}</span> / <span style={{ color: "var(--ww-crit-text)" }}>−{kbrl(v(s))}</span>
                </span>
              </div>
              {ab && (
                <div className="scroll"><table className="tabela"><tbody>
                  {l.map((m) => {
                    const p = porId.get(m.id_prod ?? -1);
                    return (
                      <tr key={m.id_mov} className="click" style={{ opacity: m.cancelado ? 0.45 : 1 }} onClick={() => p && abrir(p, "mov")}>
                        <td><div className="prod"><Thumb /><div><div className="n">{p?.descricao ?? `Produto ${m.id_prod}`}</div><div className="c">{p?.codigo ?? ""} · {nomeLocal(m.codigo_local_estoque)}</div></div></div></td>
                        <td>{m.des_origem}<div className="mini">{m.doc}</div></td>
                        <td className="opt">{m.cliente ? <><b>{m.cliente}</b><div className="mini">{m.projeto ?? ""}</div></> : m.qtde < 0 ? <span className="mini" style={{ color: "var(--ww-warn-text)" }}>sem cliente</span> : null}</td>
                        <td className="r" style={{ fontWeight: 600, color: `var(--ww-${m.cancelado ? "off" : m.qtde < 0 ? "crit" : "ok"}-text)` }}>{m.qtde > 0 ? "+" : "−"}{q(Math.abs(m.qtde))}</td>
                        <td className="r opt">{brl(m.valor)}</td>
                        <td className="r">{q(m.saldo)}</td>
                      </tr>
                    );
                  })}
                </tbody></table></div>
              )}
            </div>
          );
        })}
        {!rs.length && <div className="vazio">Nenhum movimento no período.</div>}
      </div>
    </>)}
  </>);
}
