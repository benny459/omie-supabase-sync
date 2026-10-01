"use client";

/**
 * Ficha do item do estoque (/estoque/[codigo]) — fase 1, só leitura.
 * Porte da ficha do mockup web/docs/mockups/estoque-ficha-item: foto (placeholder até a fase 2),
 * indicadores, saldo por local, abas Onde foi usado · Movimentação · Pedidos de compra ·
 * Fornecedores e preços · Auditoria, e ‹ › para andar pela lista filtrada.
 * Ajustar saldo / alarme / foto / pedir compra chegam nas fases 2–3 (botões "em breve").
 */

import "./estoque.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  alarme, auditoria, baixarCSV, cobertura, consumoDia, dias, hoje, nomeLocal, normItem, normMov, normPc, pcAberto,
  precosPorFornecedor, quebras, situacao, somaDias, valorItem,
  type AbaFicha, type ItemEstoque, type MovEstoque, type PcItem, type Tom,
} from "@/lib/estoque";
import {
  IconeCaixa, Lupa, PaletaEstoque, Pill, Seta, brl, ddmmaa, kbrl, lerNavegacao, marcarRecente, q,
  useAtalhoPaleta, useItensEstoque,
} from "./comum";

type Ficha = { item: ItemEstoque; movs: MovEstoque[]; pcs: PcItem[]; dups: { tipo: string; sim: number; item: ItemEstoque | null }[] };
const ABAS: AbaFicha[] = ["uso", "mov", "compras", "forn", "auditoria"];
const EM_BREVE = "Em breve — próxima fase do Estoque v2";

export default function FichaItemNavy({ codigo, abaInicial }: { codigo: string; abaInicial?: string }) {
  const router = useRouter();
  const [f, setF] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<AbaFicha>(ABAS.includes(abaInicial as AbaFicha) ? (abaInicial as AbaFicha) : "uso");
  const [pal, setPal] = useState(false);
  const [nav, setNav] = useState<string[]>([]);
  const { dados } = useItensEstoque();

  useEffect(() => { setNav(lerNavegacao()); }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    setF(null); setErro(null);
    fetch(`/api/estoque/item/${encodeURIComponent(codigo)}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        const item = normItem(j.item);
        marcarRecente(item.n_cod_prod);
        setF({
          item, movs: (j.movs as Record<string, unknown>[]).map(normMov), pcs: (j.pcs as Record<string, unknown>[]).map(normPc),
          dups: (j.dups as { tipo: string; sim: number; item: Record<string, unknown> | null }[])
            .map((d) => ({ tipo: d.tipo, sim: Number(d.sim), item: d.item ? normItem(d.item) : null })),
        });
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") setErro((e as Error).message); });
    return () => ctrl.abort();
  }, [codigo]);

  const ir = useCallback((cod: string, a?: string) => router.push(`/estoque/${encodeURIComponent(cod)}${a ? `?aba=${a}` : ""}`), [router]);
  const idx = nav.indexOf(codigo);
  const andar = (d: number) => { if (idx < 0 || !nav.length) return; ir(nav[(idx + d + nav.length) % nav.length], aba); };

  const abrirPal = useCallback(() => setPal(true), []);
  useAtalhoPaleta(abrirPal);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (pal || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) return;
      if (e.key === "ArrowRight" && e.altKey) andar(1);
      if (e.key === "ArrowLeft" && e.altKey) andar(-1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const porId = useMemo(() => new Map((dados?.itens ?? []).map((p) => [p.n_cod_prod, p])), [dados]);

  return (
    <div className="est">
      <div className="crumbs">
        <button className="link" onClick={() => router.push("/estoque")}><Seta dir="esq" />Estoque</button>
        <span>/</span><span>{f?.item.codigo ?? codigo}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {idx >= 0 && nav.length > 1 && <span className="mini">{idx + 1} de {q(nav.length)}</span>}
          <button className="btn sm" onClick={() => andar(-1)} disabled={idx < 0} title="Item anterior da lista (Alt ←)" aria-label="Item anterior"><Seta dir="esq" /></button>
          <button className="btn sm" onClick={() => andar(1)} disabled={idx < 0} title="Próximo item da lista (Alt →)" aria-label="Próximo item"><Seta dir="dir" /></button>
          <button className="btn sm" onClick={abrirPal}><Lupa />Ir para… <span className="kbd">⌘K</span></button>
        </span>
      </div>

      {erro && <div className="aviso t-crit">{erro}</div>}
      {!f && !erro && <div className="cartao vazio">Carregando ficha…</div>}
      {f && <Conteudo f={f} aba={aba} setAba={setAba} ir={ir} />}

      {pal && dados && (
        <PaletaEstoque itens={dados.itens} fechar={() => setPal(false)}
          onItem={(p) => ir(p.codigo)}
          onPc={(id) => { const p = porId.get(id); if (p) ir(p.codigo, "compras"); }}
          onCliente={(nome) => { router.push(`/estoque?cliente=${encodeURIComponent(nome)}`); }} />
      )}
    </div>
  );
}

function Conteudo({ f, aba, setAba, ir }: { f: Ficha; aba: AbaFicha; setAba: (a: AbaFicha) => void; ir: (cod: string, a?: string) => void }) {
  const router = useRouter();
  const p = f.item, s = p.saldo, cob = cobertura(p), [st, tom] = situacao(p);
  const ano = somaDias(hoje(), -365), dois = somaDias(hoje(), -730);
  const usos = f.movs.filter((m) => m.qtde < 0 && !m.cancelado && m.dt_mov >= ano);
  const pcs24 = f.pcs.filter((x) => (x.emissao ?? "") >= dois);
  const precos = useMemo(() => precosPorFornecedor(f.pcs), [f.pcs]);
  const temDup = f.dups.length > 0;
  const pts = useMemo(() => auditoria(p, f.movs, f.pcs, temDup), [p, f.movs, f.pcs, temDup]);
  const nA = pts.filter((x) => x.tom === "crit" || x.tom === "warn").length;
  const ultPc = f.pcs.filter((x) => x.valor_unit > 0)[0];
  const abertos = pcs24.filter(pcAberto);

  return (
    <div className="cartao">
      <div className="ficha-top">
        <div className="foto">
          <div className="icone"><IconeCaixa /></div>
          <span className="src">sem foto</span>
          <div className="acoes">
            <button className="btn sm" disabled title={EM_BREVE}>Buscar na web</button>
            <button className="btn sm" disabled title={EM_BREVE}>Enviar</button>
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Pill t={st} tom={tom} />
            <Pill t={alarme(p)[0]} tom={alarme(p)[1]} />
            {temDup && <Pill t="possível duplicidade" tom="violet" />}
            {p.ajuste !== 0 && <Pill t="saldo ajustado no painel" tom="info" />}
          </div>
          <div className="titulo-item">{p.descricao}</div>
          <div className="meta">
            <span>Código {p.codigo}</span><span>{p.unidade}</span>{p.ncm && <span>NCM {p.ncm}</span>}<span>id Omie {p.n_cod_prod}</span>
            {precos[0] && <span>Fornecedor principal: {precos[0].fornecedor}</span>}
          </div>
          <div className="stats">
            <Stat r="Saldo" v={q(s)} s={p.ajuste !== 0 ? `Omie: ${q(p.saldo_omie)}` : `${p.unidade.toLowerCase()} · Omie`} cor={s < 0 ? "var(--ww-crit-text)" : undefined} />
            <Stat r="Pendente" v={q(p.pendente)} s={`${abertos.length} PC${abertos.length === 1 ? "" : "s"} aberto${abertos.length === 1 ? "" : "s"} (24 m)`} />
            <Stat r="Consumo / mês" v={consumoDia(p) ? q(Math.round(consumoDia(p) * 30)) : "—"} s="média de 90 dias" />
            <Stat r="Cobertura" v={cob === null ? "—" : `${cob > 999 ? "999+" : q(cob)} d`}
              s={cob === null ? "sem consumo" : cob === 0 ? "em ruptura" : `até ~${ddmmaa(somaDias(hoje(), Math.min(cob, 3650)))}`} />
            <Stat r="CMC" v={brl(p.cmc)} s={ultPc ? `últ. PC ${brl(ultPc.valor_unit)}` : "custo médio"} />
            <Stat r="Valor" v={kbrl(valorItem(p))} s="saldo × CMC" />
          </div>
          {p.locais.length > 1 && (
            <div className="locais">
              {p.locais.map((l) => (
                <div key={l.local} className="stat"><span className="mini">{nomeLocal(l.local)}</span>{" "}
                  <b className="num" style={{ color: l.saldo < 0 ? "var(--ww-crit-text)" : undefined }}>{q(l.saldo)}</b></div>
              ))}
            </div>
          )}
          <div className="acoes-item">
            <button className="btn pri" disabled title={EM_BREVE}>Ajustar saldo</button>
            <button className="btn" disabled title={EM_BREVE}>Definir alarme</button>
            <button className="btn" onClick={() => setAba("auditoria")}>Auditoria{nA ? <> <span className="pill t-warn" style={{ padding: "0 7px" }}>{nA}</span></> : null}</button>
            <button className="btn" disabled title={EM_BREVE}>Pedir compra</button>
          </div>
        </div>
      </div>

      <div className="subtabs" role="tablist">
        {([["uso", "Onde foi usado", usos.length], ["mov", "Movimentação", f.movs.length], ["compras", "Pedidos de compra", pcs24.length],
          ["forn", "Fornecedores e preços", precos.length], ["auditoria", "Auditoria", nA]] as [AbaFicha, string, number][]).map(([k, l, nn]) => (
          <button key={k} className={aba === k ? "on" : ""} onClick={() => setAba(k)} role="tab" aria-selected={aba === k}>
            {l}<span className={`cnt ${k === "auditoria" && nn ? "w" : ""}`}>{nn}</span>
          </button>
        ))}
      </div>
      <div className="painel">
        {aba === "uso" && <AbaUso p={p} usos={usos} filtrarCliente={(c) => router.push(`/estoque?cliente=${encodeURIComponent(c)}`)} />}
        {aba === "mov" && <AbaMov p={p} movs={f.movs} />}
        {aba === "compras" && <AbaCompras p={p} pcs={pcs24} abertos={abertos} />}
        {aba === "forn" && <AbaForn pcs={f.pcs} precos={precos} />}
        {aba === "auditoria" && <AbaAuditoria pts={pts} dups={f.dups} setAba={setAba} ir={ir} />}
      </div>
    </div>
  );
}

function Stat({ r, v, s, cor }: { r: string; v: string; s: string; cor?: string }) {
  return (
    <div className="stat"><div className="r1">{r}</div><div className="v1" style={{ color: cor }} title={v}>{v}</div><div className="s1">{s}</div></div>
  );
}

// ── Onde foi usado ───────────────────────────────────────────────────────────
function AbaUso({ p, usos, filtrarCliente }: { p: ItemEstoque; usos: MovEstoque[]; filtrarCliente: (c: string) => void }) {
  const [por, setPor] = useState<"cliente" | "projeto">("cliente");
  if (!usos.length) return <div className="vazio">Sem saídas nos últimos 12 meses.</div>;
  const u = p.unidade.toLowerCase();
  const m = new Map<string, number>();
  usos.forEach((x) => { const k = (por === "cliente" ? x.cliente : x.projeto) || `Sem ${por} vinculado`; m.set(k, (m.get(k) ?? 0) - x.qtde); });
  const lst = [...m.entries()].sort((a, b) => b[1] - a[1]), mx = lst[0][1], tot = lst.reduce((a, x) => a + x[1], 0);
  return (
    <div className="grid2">
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Por {por} · 12 meses</h3>
          <div className="seg" style={{ marginLeft: "auto" }}>
            <button className={por === "cliente" ? "on" : ""} onClick={() => setPor("cliente")}>Cliente</button>
            <button className={por === "projeto" ? "on" : ""} onClick={() => setPor("projeto")}>Projeto</button>
          </div>
        </div>
        <div className="lista-barras">
          {lst.slice(0, 15).map(([nome, v]) => {
            const sem = nome.startsWith("Sem "), clicavel = !sem && por === "cliente";
            return (
              <div key={nome} className="l" style={clicavel ? { cursor: "pointer" } : undefined} onClick={clicavel ? () => filtrarCliente(nome) : undefined}
                title={clicavel ? `Ver todos os itens usados por ${nome}` : undefined}>
                <span className="nm" style={sem ? { color: "var(--ww-warn-text)" } : undefined}>{nome}</span>
                <div className="barra"><i style={{ width: `${(v / mx) * 100}%`, background: sem ? "var(--ww-warn)" : "var(--ww-brand-3)" }} /></div>
                <span className="r num">{q(v)} {u}</span>
              </div>
            );
          })}
        </div>
        <div className="nota">{q(tot)} {u} em {usos.length} saídas. Clique num cliente para ver todos os itens que ele usou. Saídas sem cliente são remessas e ajustes: o cliente da remessa entra com o sync de remessas (fase 5).</div>
      </div>
      <div>
        <h3>Saídas</h3>
        <div style={{ maxHeight: 420, overflow: "auto" }}>
          <table className="tabela">
            <thead><tr><th>Data</th><th>Cliente / projeto</th><th>Pedido</th><th className="r">Qtde</th></tr></thead>
            <tbody>
              {usos.slice().reverse().map((x) => (
                <tr key={x.id_mov}>
                  <td className="num">{ddmmaa(x.dt_mov)}</td>
                  <td>{x.cliente ? <><div style={{ fontWeight: 600 }}>{x.cliente}</div><div className="mini">{x.projeto || "sem projeto"}</div></>
                    : <span style={{ color: "var(--ww-warn-text)" }}>{x.des_origem} — sem cliente</span>}</td>
                  <td className="mini">{x.pv_numero ? `PV ${x.pv_numero}` : x.num_pedido || x.doc}</td>
                  <td className="r num" style={{ color: "var(--ww-crit-text)" }}>−{q(-x.qtde)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Movimentação (Kardex) ────────────────────────────────────────────────────
function AbaMov({ p, movs }: { p: ItemEstoque; movs: MovEstoque[] }) {
  if (!movs.length) return <div className="vazio">Sem movimentos sincronizados.</div>;
  const qb = quebras(movs);
  const csv = () => baixarCSV(`kardex-${p.codigo}-${hoje()}.csv`, [
    ["Data", "Origem", "Local", "Doc / pedido", "Cliente", "Projeto", "Qtde", "Valor unit.", "Saldo", "Cancelado", "Saldo não fecha"],
    ...movs.map((m, i) => [m.dt_mov, m.des_origem, nomeLocal(m.codigo_local_estoque), m.doc ?? m.num_pedido, m.cliente, m.projeto,
      m.qtde, m.valor, m.saldo, m.cancelado ? "sim" : "", qb.has(i) ? "sim" : ""]),
  ]);
  return (<>
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
      <h3 style={{ margin: 0 }}>Saldo ao longo do tempo · 12 meses</h3>
      <span className="mini">pontos em coral = saldo que não fecha com o movimento anterior</span>
      <button className="btn sm" style={{ marginLeft: "auto" }} onClick={csv}>Exportar Kardex</button>
    </div>
    <GraficoSaldo movs={movs} qb={qb} />
    <div style={{ maxHeight: 460, overflow: "auto", marginTop: 12 }}>
      <table className="tabela">
        <thead><tr><th>Data</th><th>Origem</th><th>Doc / pedido</th><th className="opt">Cliente</th><th className="r">Qtde</th><th className="r opt">Valor unit.</th><th className="r">Saldo</th><th /></tr></thead>
        <tbody>
          {movs.map((m, i) => [m, i] as const).reverse().map(([m, i]) => (
            <tr key={m.id_mov} style={{ opacity: m.cancelado ? 0.45 : 1, textDecoration: m.cancelado ? "line-through" : undefined }}>
              <td className="num">{ddmmaa(m.dt_mov)}</td>
              <td>{m.des_origem}{p.locais.length > 1 && <div className="mini">{nomeLocal(m.codigo_local_estoque)}</div>}</td>
              <td className="mini">{m.doc}{m.pv_numero && <div>PV {m.pv_numero}</div>}</td>
              <td className="opt">{m.cliente ?? ""}</td>
              <td className="r num" style={{ fontWeight: 600, color: `var(--ww-${m.qtde < 0 ? "crit" : "ok"}-text)` }}>{m.qtde > 0 ? "+" : "−"}{q(Math.abs(m.qtde))}</td>
              <td className="r num opt">{brl(m.valor)}</td>
              <td className="r num" style={qb.has(i) ? { color: "var(--ww-crit-text)", fontWeight: 700 } : undefined}>{q(m.saldo)}</td>
              <td>{qb.has(i) ? <Pill t="não fecha" tom="crit" /> : m.cancelado ? <Pill t="cancelado" tom="off" /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="nota">Kardex completo sincronizado do Omie (orders.estoque_movimentos), com cliente e projeto pelo pedido de venda.</div>
  </>);
}

function GraficoSaldo({ movs, qb }: { movs: MovEstoque[]; qb: Set<number> }) {
  const W = 900, H = 220, P = { l: 52, r: 12, t: 14, b: 24 }, H0 = hoje();
  const x0 = new Date(somaDias(H0, -365) + "T12:00:00Z").getTime(), x1 = new Date(H0 + "T12:00:00Z").getTime();
  const porLoc: Record<string, number> = {};
  const pts: { t: number; v: number; bad: boolean; m: MovEstoque }[] = [];
  movs.forEach((m, i) => {
    if (m.cancelado) return;
    porLoc[m.codigo_local_estoque] = m.saldo;
    pts.push({ t: new Date(m.dt_mov + "T12:00:00Z").getTime(), v: Object.values(porLoc).reduce((a, b) => a + b, 0), bad: qb.has(i), m });
  });
  if (!pts.length) return null;
  const ini = [...pts].reverse().find((x) => x.t <= x0);
  const vis = pts.filter((x) => x.t > x0);
  const serie = [...(ini ? [{ ...ini, t: x0 }] : []), ...vis];
  if (!serie.length) return <div className="vazio">Sem movimentos nos últimos 12 meses.</div>;
  const ys = serie.map((x) => x.v), y0 = Math.min(0, ...ys), y1 = Math.max(1, ...ys) * 1.1;
  const X = (t: number) => P.l + ((t - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (v: number) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  let d = "";
  serie.forEach((x, i) => { d += i ? `H${X(x.t).toFixed(1)}V${Y(x.v).toFixed(1)}` : `M${X(Math.max(x.t, x0)).toFixed(1)},${Y(x.v).toFixed(1)}`; });
  d += `H${X(x1)}`;
  const tk = [...new Set([y0, 0, y1 / 2, y1 / 1.1])];
  const meses = [0, 3, 6, 9, 12].map((k) => somaDias(H0, Math.round(-365 + k * 30.4)));
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Saldo ao longo do tempo">
      {tk.map((v) => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke="var(--ww-border)" strokeDasharray={v ? "3 4" : undefined} />
          <text x={P.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--ww-text-faint)">{q(Math.round(v))}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--ww-brand-2)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
      {vis.filter((x) => x.bad).map((x) => (
        <circle key={x.m.id_mov} cx={X(x.t)} cy={Y(x.v)} r="5" fill="var(--ww-crit)">
          <title>{`${ddmmaa(x.m.dt_mov)} · ${x.m.des_origem ?? ""} ${x.m.doc ?? ""} · saldo ${q(x.m.saldo)} não fecha`}</title>
        </circle>
      ))}
      {meses.map((m) => <text key={m} x={X(new Date(m + "T12:00:00Z").getTime())} y={H - 6} fontSize="10.5" textAnchor="middle" fill="var(--ww-text-faint)">{m.slice(5, 7)}/{m.slice(2, 4)}</text>)}
    </svg>
  );
}

// ── Pedidos de compra ────────────────────────────────────────────────────────
function AbaCompras({ p, pcs, abertos }: { p: ItemEstoque; pcs: PcItem[]; abertos: PcItem[] }) {
  if (!pcs.length) return <div className="vazio">Nenhum pedido de compra nos últimos 24 meses.</div>;
  const u = p.unidade.toLowerCase(), qAb = abertos.reduce((a, x) => a + x.qtd - x.qtd_recebida, 0);
  const sit = (x: PcItem): [string, Tom] => {
    if (x.qtd_recebida > x.qtd) return ["recebido a mais", "crit"];
    if (!pcAberto(x)) return [x.etapa === "80" ? "conferido" : "recebido", "ok"];
    if (x.qtd_recebida > 0) return ["parcial", "info"];
    const d = dias(x.emissao) ?? 0;
    return d > 60 ? [`aberto há ${d} d`, "warn"] : ["aberto", "info"];
  };
  return (<>
    {abertos.length > 0 && Math.abs(qAb - p.pendente) > 0.001 && (
      <div className="aviso t-warn" style={{ marginBottom: 12 }}>
        <span>{abertos.length} PC{abertos.length > 1 ? "s" : ""} com saldo a receber ({q(qAb)} {u}), mas o Omie mostra <b>{q(p.pendente)} pendente</b>. Revise os PCs antigos: baixar ou cancelar.</span>
      </div>
    )}
    <div style={{ maxHeight: 480, overflow: "auto" }}>
      <table className="tabela">
        <thead><tr><th>PC</th><th>Inclusão</th><th>Fornecedor</th><th className="opt">Projeto</th><th className="r">Pedido</th><th className="r">Recebido</th><th className="r">Unit.</th><th className="r opt">Total</th><th>Situação</th></tr></thead>
        <tbody>
          {pcs.map((x) => {
            const [t, tm] = sit(x);
            return (
              <tr key={`${x.pedido_id}:${x.numero}:${x.qtd}:${x.valor_unit}`}>
                <td style={{ fontWeight: 600 }}>{x.numero}{x.origem === "painel" && <div className="mini">painel</div>}</td>
                <td className="num">{ddmmaa(x.emissao)}</td>
                <td>{x.fornecedor || "— fornecedor não cadastrado"}</td>
                <td className="opt mini">{x.projeto ?? ""}</td>
                <td className="r num">{q(x.qtd)}</td>
                <td className="r num">{q(x.qtd_recebida)}</td>
                <td className="r num">{brl(x.valor_unit)}</td>
                <td className="r num opt">{brl(x.qtd * x.valor_unit)}</td>
                <td><Pill t={t} tom={tm} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <div className="nota">Últimos 24 meses · pedidos de compra do painel e o histórico do Omie (compras.*). Recebido/conferido = etapa do PC no painel ou NF casada; parcial = quantidade recebida menor que a pedida.</div>
  </>);
}

// ── Fornecedores e preços ────────────────────────────────────────────────────
function AbaForn({ pcs, precos }: { pcs: PcItem[]; precos: ReturnType<typeof precosPorFornecedor> }) {
  if (!precos.length) return <div className="vazio">Sem histórico de compra deste item.</div>;
  const total = precos.reduce((a, x) => a + x.n, 0);
  const mn = Math.min(...precos.map((x) => x.min)), mx = Math.max(...precos.map((x) => x.max));
  const med = precos.reduce((a, x) => a + x.media * x.n, 0) / total;
  const dois = somaDias(hoje(), -730);
  const serie = pcs.filter((x) => x.valor_unit > 0 && (x.emissao ?? "") >= dois).sort((a, b) => ((a.emissao ?? "") > (b.emissao ?? "") ? 1 : -1));
  const ult = pcs.find((x) => x.valor_unit > 0);
  return (
    <div className="grid2">
      <div>
        <h3>Por fornecedor · todo o histórico</h3>
        <table className="tabela">
          <thead><tr><th>Fornecedor</th><th className="r">PCs</th><th className="r">Mín.</th><th className="r">Médio</th><th className="r">Máx.</th><th className="opt">Faixa</th><th>Último</th></tr></thead>
          <tbody>
            {precos.map((x) => (
              <tr key={x.fornecedor}>
                <td style={{ fontWeight: 600 }}>{x.fornecedor}</td><td className="r num">{x.n}</td>
                <td className="r num">{brl(x.min)}</td><td className="r num" style={{ fontWeight: 600 }}>{brl(x.media)}</td><td className="r num">{brl(x.max)}</td>
                <td className="opt" style={{ minWidth: 110 }}>
                  <div className="barra" style={{ position: "relative" }}>
                    <i style={{ position: "absolute", left: `${(x.min / mx) * 100}%`, width: `${Math.max(2, ((x.max - x.min) / mx) * 100)}%`, background: "var(--ww-brand-3)" }} />
                  </div>
                </td>
                <td className="num">{ddmmaa(x.ultima)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Resumo</h3>
        <div className="prev">
          Mínimo <b>{brl(mn)}</b> · médio <b>{brl(med)}</b> · máximo <b>{brl(mx)}</b> · {total} PCs<br />
          {ult && <>Última compra <b>{brl(ult.valor_unit)}</b> em {ddmmaa(ult.emissao)} ({ult.fornecedor || "fornecedor não cadastrado"}) —{" "}
            <span style={{ color: `var(--ww-${ult.valor_unit > med * 1.1 ? "warn" : "ok"}-text)` }}>
              {ult.valor_unit >= med ? `${Math.round((ult.valor_unit / med - 1) * 100)}% acima` : `${Math.round((1 - ult.valor_unit / med) * 100)}% abaixo`} da média
            </span></>}
        </div>
        {serie.length > 1 && (<><h3 style={{ marginTop: 14 }}>Preço unitário por PC · 24 meses</h3><GraficoPreco pcs={serie} med={med} /></>)}
        <div className="nota">Fonte: pedidos de compra (compras.itens.valor_unit). Valores muito baixos costumam ser bonificação ou erro de unidade e puxam a média.</div>
      </div>
    </div>
  );
}

function GraficoPreco({ pcs, med }: { pcs: PcItem[]; med: number }) {
  const W = 560, H = 170, P = { l: 58, r: 10, t: 12, b: 20 };
  const xs = pcs.map((x) => new Date((x.emissao ?? "") + "T12:00:00Z").getTime()), x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 864e5);
  const y1 = Math.max(...pcs.map((x) => x.valor_unit)) * 1.1;
  const X = (t: number) => P.l + ((t - x0) / (x1 - x0)) * (W - P.l - P.r), Y = (v: number) => P.t + (1 - v / y1) * (H - P.t - P.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Preço por PC">
      <line x1={P.l} x2={W - P.r} y1={Y(med)} y2={Y(med)} stroke="var(--ww-text-faint)" strokeDasharray="4 4" />
      <text x={P.l + 4} y={Y(med) - 4} fontSize="10" fill="var(--ww-text-faint)">média {brl(med)}</text>
      <text x={P.l - 6} y={Y(0) + 3} textAnchor="end" fontSize="10" fill="var(--ww-text-faint)">0</text>
      <text x={P.l - 6} y={Y(y1 / 1.1) + 3} textAnchor="end" fontSize="10" fill="var(--ww-text-faint)">{brl(y1 / 1.1)}</text>
      {pcs.map((x, i) => (
        <circle key={i} cx={X(xs[i])} cy={Y(x.valor_unit)} r="4"
          fill={x.valor_unit < med * 0.6 || x.valor_unit > med * 1.5 ? "var(--ww-warn)" : "var(--ww-brand-3)"}>
          <title>{`PC ${x.numero} · ${ddmmaa(x.emissao)} · ${brl(x.valor_unit)} · ${x.fornecedor ?? ""}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ── Auditoria ────────────────────────────────────────────────────────────────
const ICONES: Record<string, string> = {
  alerta: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  quebra: "M4 12h16M4 7h16M4 17h16M8 3l8 18", soma: "M18 4H6l6 8-6 8h12", preco: "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  pc: "M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6", mais: "M12 5v14M5 12h14",
  semcli: "M4 21v-1a6 6 0 0 1 9-5.2M17 17l4 4M21 17l-4 4M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  dup: "M8 8h13v13H8zM4 16V5a2 2 0 0 1 2-2h11", sino: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  zero: "M5 19L19 5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", parado: "M10 9v6M14 9v6M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", ok: "M20 6L9 17l-5-5",
};

function AbaAuditoria({ pts, dups, setAba, ir }: {
  pts: ReturnType<typeof auditoria>; dups: Ficha["dups"]; setAba: (a: AbaFicha) => void; ir: (cod: string, a?: string) => void;
}) {
  return (
    <div className="grid2">
      <div>
        <h3>Verificações automáticas</h3>
        {pts.map((x, i) => (
          <div key={i} className="aud">
            <div className={`ic t-${x.tom}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={ICONES[x.icone] ?? ""} />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}><div className="tt">{x.titulo}</div><div className="dd">{x.detalhe}</div></div>
            {x.acao && (
              <div className="ac">
                {x.acao.emBreve
                  ? <button className="btn sm" disabled title={EM_BREVE}>{x.acao.rotulo}</button>
                  : <button className="btn sm" onClick={() => x.acao?.aba && setAba(x.acao.aba)}>{x.acao.rotulo}</button>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div>
        <h3>Possíveis duplicidades</h3>
        {dups.length ? dups.map((d, i) => d.item && (
          <div key={i} className="aud" style={{ cursor: "pointer" }} onClick={() => d.item && ir(d.item.codigo)}>
            <div className="ic t-violet"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d={ICONES.dup} /></svg></div>
            <div style={{ minWidth: 0 }}>
              <div className="tt">{d.item.codigo} · {d.item.descricao}</div>
              <div className="dd">{d.tipo === "exata" ? "nome igual" : `parecido ${Math.round(d.sim * 100)}%`} · saldo {q(d.item.saldo)} · CMC {brl(d.item.cmc)}</div>
            </div>
          </div>
        )) : <div className="nota">Nenhum outro código com descrição igual ou parecida.</div>}
        <h3 style={{ marginTop: 16 }}>Histórico de alterações no painel</h3>
        <div className="nota">Ajuste de saldo, alarme, foto e mesclagem passam a ser gravados aqui (quem, quando, antes e depois) quando essas ações chegarem.</div>
        <button className="btn sm" style={{ marginTop: 10 }} onClick={() => window.print()}>Imprimir / PDF da auditoria</button>
      </div>
    </div>
  );
}
