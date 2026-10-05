"use client";

/**
 * Rentabilidade (P6, 05/10/2026) — a cadeia de cada venda, do PV/OS ao
 * dinheiro recebido: receita × PCs ligados × pago × faturado × recebido.
 * Fonte única: /api/rentabilidade (sales.mv_rentab_pvos). A margem é a mesma
 * da Avulsos e da ficha do cliente: (PV − PC) / PV, só onde há custo lançado.
 */

import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  PaginaNavy, CabecalhoTela, FaixaFiltros, ChipFiltro, CampoData, GradeKpis, Carregando, Aviso, BotaoTela,
  cartao, brl, kbrl, pct, ddmmaa, hojeISO, somaDias, type Kpi,
} from "./KitTela";
import { tom, type Tom } from "../primitivos";
import { ETAPA_CADEIA, type CadeiaPedido, type EtapaCadeia, type RentabPvos } from "@/lib/rentabilidade";

type Periodo = "mes" | "90" | "12m" | "ano" | "tudo" | "livre";
type Visao = "pedidos" | "clientes";

const ETAPA_TOM: Record<EtapaCadeia, Tom> = {
  pedido: "off", rc: "info", pc: "info", nf_entrada: "info", recebido_material: "violet",
  conferido: "violet", pago: "warn", faturado: "warn", recebido: "ok",
};

function Selo({ t, tone, title }: { t: string; tone: Tom; title?: string }) {
  const c = tom(tone);
  return (
    <span title={title} style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 999,
      fontSize: 11.5, fontWeight: 600, background: c.bg, color: c.fg, whiteSpace: "nowrap",
    }}><i style={{ width: 6, height: 6, borderRadius: 999, background: c.dot }} />{t}</span>
  );
}

const mbTom = (m: number | null): Tom => (m == null ? "off" : m < 0 ? "crit" : m < 0.15 ? "warn" : "ok");
const fmtMb = (m: number | null) => (m == null ? "—" : pct(m * 100));

function intervalo(p: Periodo, de: string, ate: string): { de: string | null; ate: string | null } {
  const hoje = hojeISO();
  if (p === "mes") return { de: hoje.slice(0, 8) + "01", ate: hoje };
  if (p === "90") return { de: somaDias(hoje, -90), ate: hoje };
  if (p === "12m") return { de: somaDias(hoje, -365), ate: hoje };
  if (p === "ano") return { de: hoje.slice(0, 4) + "-01-01", ate: hoje };
  if (p === "livre") return { de: de || null, ate: ate || null };
  return { de: null, ate: null };
}

export default function TelaRentabilidade() {
  const sp = useSearchParams();
  const pedidoUrl = (sp.get("pedido") ?? "").toUpperCase();
  const empresaUrl = (sp.get("empresa") ?? "").toUpperCase();

  const [periodo, setPeriodo] = useState<Periodo>(pedidoUrl ? "tudo" : "12m");
  const [de, setDe] = useState(""); const [ate, setAte] = useState("");
  const [empresa, setEmpresa] = useState(empresaUrl || "");
  const [projeto, setProjeto] = useState("");
  const [visao, setVisao] = useState<Visao>("pedidos");
  const [busca, setBusca] = useState(pedidoUrl);
  const [soComCusto, setSoComCusto] = useState(false);
  const [linhas, setLinhas] = useState<RentabPvos[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<string | null>(pedidoUrl && empresaUrl ? `${empresaUrl}|${pedidoUrl}` : null);
  const [limite, setLimite] = useState(200);

  const { de: d0, ate: d1 } = intervalo(periodo, de, ate);
  useEffect(() => {
    setLinhas(null); setErro(null);
    const qs = new URLSearchParams({ modo: "lista" });
    if (d0) qs.set("de", d0);
    if (d1) qs.set("ate", d1);
    if (empresa) qs.set("empresa", empresa);
    fetch(`/api/rentabilidade?${qs}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j; })
      .then((j) => setLinhas(j.linhas ?? []))
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, [d0, d1, empresa]);

  const projetos = useMemo(() => [...new Set((linhas ?? []).map((l) => l.projeto).filter(Boolean) as string[])].sort(), [linhas]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (linhas ?? []).filter((l) =>
      (!projeto || l.projeto === projeto)
      && (!soComCusto || l.custo > 0)
      && (!q || [l.label, l.cliente, l.cnpj_cpf, l.projeto, l.nf].some((v) => (v ?? "").toLowerCase().includes(q))));
  }, [linhas, projeto, soComCusto, busca]);

  const tot = useMemo(() => {
    const t = { receita: 0, custo: 0, recMed: 0, custoMed: 0, nMed: 0, pago: 0, aPagar: 0, recebido: 0, aReceber: 0, faturado: 0 };
    for (const l of filtradas) {
      t.receita += Number(l.receita_pv); t.custo += Number(l.custo);
      if (Number(l.custo) > 0) { t.recMed += Number(l.receita_pv); t.custoMed += Number(l.custo); t.nMed++; }
      t.pago += Number(l.pago); t.aPagar += Number(l.a_pagar);
      t.recebido += Number(l.recebido); t.aReceber += Number(l.a_receber);
      t.faturado += Number(l.receita_nf ?? 0);
    }
    return t;
  }, [filtradas]);
  const mbTotal = tot.recMed > 0 ? (tot.recMed - tot.custoMed) / tot.recMed : null;

  const clientes = useMemo(() => {
    const m = new Map<string, { chave: string; cliente: string; n: number; receita: number; custo: number; recMed: number; custoMed: number; aPagar: number; recebido: number; aReceber: number }>();
    for (const l of filtradas) {
      const k = `${l.empresa}|${l.codigo_cliente ?? l.cliente}`;
      const c = m.get(k) ?? { chave: k, cliente: l.cliente ?? "—", n: 0, receita: 0, custo: 0, recMed: 0, custoMed: 0, aPagar: 0, recebido: 0, aReceber: 0 };
      c.n++; c.receita += Number(l.receita_pv); c.custo += Number(l.custo);
      if (Number(l.custo) > 0) { c.recMed += Number(l.receita_pv); c.custoMed += Number(l.custo); }
      c.aPagar += Number(l.a_pagar); c.recebido += Number(l.recebido); c.aReceber += Number(l.a_receber);
      m.set(k, c);
    }
    return [...m.values()].sort((a, b) => b.receita - a.receita);
  }, [filtradas]);

  const kpis: Kpi[] = [
    { rotulo: "Vendido (PV/OS)", valor: kbrl(tot.receita), sub: `${filtradas.length} pedidos · ${kbrl(tot.faturado)} faturado`, hero: true },
    { rotulo: "Margem bruta", valor: mbTotal == null ? "—" : pct(mbTotal * 100),
      sub: `${kbrl(tot.recMed - tot.custoMed)} sobre ${tot.nMed} pedidos com custo`,
      title: "(PV − PCs ligados) / PV, só nos PV/OS com compra lançada — a mesma conta da Avulsos" },
    { rotulo: "Compras (PCs)", valor: kbrl(tot.custo), sub: `${kbrl(tot.pago)} pagos` },
    { rotulo: "A pagar", valor: kbrl(tot.aPagar), sub: "PCs ligados ainda não pagos" },
    { rotulo: "A receber", valor: kbrl(tot.aReceber), sub: `${kbrl(tot.recebido)} já recebidos` },
  ];

  return (
    <PaginaNavy>
      <CabecalhoTela area="BI" titulo="Rentabilidade"
        sub="Cada venda do pedido ao dinheiro: PV/OS × compras ligadas × pago × faturado × recebido. Mesma margem da Avulsos e da ficha do cliente."
        acoes={<>
          <BotaoTela primario={visao === "pedidos"} onClick={() => setVisao("pedidos")}>Por pedido</BotaoTela>
          <BotaoTela primario={visao === "clientes"} onClick={() => setVisao("clientes")}>Por cliente</BotaoTela>
        </>} />

      <FaixaFiltros busca={busca} onBusca={setBusca} placeholder="PV/OS, cliente, CNPJ, projeto, NF…">
        {([["mes", "Mês"], ["90", "90 dias"], ["12m", "12 meses"], ["ano", "Ano"], ["tudo", "Tudo"], ["livre", "Período"]] as [Periodo, string][]).map(([k, t]) => (
          <ChipFiltro key={k} ativo={periodo === k} onClick={() => setPeriodo(k)}>{t}</ChipFiltro>
        ))}
        {periodo === "livre" && <><CampoData valor={de} onChange={setDe} title="Emissão a partir de" /><CampoData valor={ate} onChange={setAte} title="Emissão até" /></>}
        {(["", "SF", "CD", "WW"]).map((e) => <ChipFiltro key={e || "todas"} ativo={empresa === e} onClick={() => setEmpresa(e)}>{e || "Todas"}</ChipFiltro>)}
        <select value={projeto} onChange={(e) => setProjeto(e.target.value)} style={sel} title="Projeto">
          <option value="">Todos os projetos</option>
          {projetos.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <ChipFiltro ativo={soComCusto} onClick={() => setSoComCusto((v) => !v)} title="Só os pedidos que têm compra lançada (os que entram na margem)">Com custo</ChipFiltro>
      </FaixaFiltros>

      {erro && <Aviso>{erro}</Aviso>}
      {!linhas && !erro ? <Carregando /> : <>
        <GradeKpis kpis={kpis} />

        {visao === "clientes" ? (
          <div style={{ ...cartao, overflowX: "auto" }}>
            <table style={tabela}>
              <thead><tr>{["Cliente", "Pedidos", "Vendido", "Compras", "M.B.", "A pagar", "Recebido", "A receber"].map((h, i) => <th key={h} style={{ ...th, textAlign: i > 0 ? "right" : "left" }}>{h}</th>)}</tr></thead>
              <tbody>
                {clientes.length === 0 && <tr><td colSpan={8} style={vazio}>Nenhum pedido no filtro.</td></tr>}
                {clientes.slice(0, limite).map((c) => {
                  const mb = c.recMed > 0 ? (c.recMed - c.custoMed) / c.recMed : null;
                  return (
                    <tr key={c.chave} style={linha} onClick={() => { setBusca(c.cliente); setVisao("pedidos"); }} title="Ver os pedidos deste cliente">
                      <td style={td}><b>{c.cliente}</b></td>
                      <td style={num}>{c.n}</td>
                      <td style={num}>{brl(c.receita)}</td>
                      <td style={num}>{brl(c.custo)}</td>
                      <td style={num}><Selo t={fmtMb(mb)} tone={mbTom(mb)} /></td>
                      <td style={num}>{brl(c.aPagar)}</td>
                      <td style={num}>{brl(c.recebido)}</td>
                      <td style={num}>{brl(c.aReceber)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {clientes.length > limite && <Mais onClick={() => setLimite((l) => l + 200)} resta={clientes.length - limite} />}
          </div>
        ) : (
          <div style={{ ...cartao, overflowX: "auto" }}>
            <table style={tabela}>
              <thead><tr>{["Pedido", "Cliente", "Emissão", "Projeto", "Vendido", "Compras", "M.B.", "Etapa", "Pago", "Recebido"].map((h, i) => (
                <th key={h} style={{ ...th, textAlign: i >= 4 && i <= 6 ? "right" : "left" }}>{h}</th>))}</tr></thead>
              <tbody>
                {filtradas.length === 0 && <tr><td colSpan={10} style={vazio}>Nenhum pedido no filtro.</td></tr>}
                {filtradas.slice(0, limite).map((l) => {
                  const k = `${l.empresa}|${l.label}`;
                  const ab = aberto === k;
                  return (
                    <Fragment key={k}>
                      <tr style={{ ...linha, background: ab ? "var(--ww-panel-sunken)" : undefined }} onClick={() => setAberto(ab ? null : k)}>
                        <td style={td}><b>{l.label}</b>{l.nativo && <span style={{ fontSize: 10.5, color: "var(--ww-accent-text)", fontWeight: 700 }}> · painel</span>}
                          <div style={sub}>{l.empresa}{l.nf ? ` · NF ${l.nf}` : ""}</div></td>
                        <td style={{ ...td, maxWidth: 260 }}>{l.cliente ?? "—"}</td>
                        <td style={td}>{ddmmaa(l.emissao)}</td>
                        <td style={td}>{l.projeto ?? "—"}</td>
                        <td style={num}>{brl(l.receita_pv)}</td>
                        <td style={num}>{l.n_pc ? brl(l.custo) : <span style={{ color: "var(--ww-text-faint)" }}>sem PC</span>}</td>
                        <td style={num}><Selo t={fmtMb(l.margem_pct)} tone={mbTom(l.margem_pct)} /></td>
                        <td style={td}><Selo t={ETAPA_CADEIA[l.etapa_cadeia] ?? l.etapa_cadeia} tone={ETAPA_TOM[l.etapa_cadeia] ?? "off"} /></td>
                        <td style={td}>{l.n_pc ? <Selo t={`${l.n_pago}/${l.n_pc}`} tone={l.pago_ok ? "ok" : l.n_pago ? "warn" : "off"} title={`${brl(l.pago)} pagos · ${brl(l.a_pagar)} a pagar`} /> : "—"}</td>
                        <td style={td}>{Number(l.titulos_receber) > 0
                          ? <Selo t={l.recebido_ok ? "Recebido" : `${Math.round(Number(l.recebido) / Number(l.titulos_receber) * 100)}%`} tone={l.recebido_ok ? "ok" : Number(l.recebido) > 0 ? "warn" : "off"}
                              title={`${brl(l.recebido)} recebidos · ${brl(l.a_receber)} a receber`} />
                          : l.faturado ? <Selo t="Sem título" tone="crit" title="Faturado, mas nenhum título a receber ligado a este pedido" /> : "—"}</td>
                      </tr>
                      {ab && <tr><td colSpan={10} style={{ padding: 0, background: "var(--ww-panel-sunken)" }}><Cadeia empresa={l.empresa} pedido={l.label} /></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {filtradas.length > limite && <Mais onClick={() => setLimite((x) => x + 200)} resta={filtradas.length - limite} />}
          </div>
        )}
      </>}
    </PaginaNavy>
  );
}

function Mais({ onClick, resta }: { onClick: () => void; resta: number }) {
  return (
    <div style={{ padding: 12, textAlign: "center" }}>
      <BotaoTela onClick={onClick}>Mostrar mais ({resta} restantes)</BotaoTela>
    </div>
  );
}

/** A cadeia de um pedido: RCs → PCs (NF, recebimento, pagamento) → títulos a receber. */
function Cadeia({ empresa, pedido }: { empresa: string; pedido: string }) {
  const [c, setC] = useState<CadeiaPedido | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/rentabilidade?modo=cadeia&empresa=${encodeURIComponent(empresa)}&pedido=${encodeURIComponent(pedido)}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); return j; })
      .then(setC).catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, [empresa, pedido]);
  if (erro) return <div style={{ padding: 16 }}><Aviso>{erro}</Aviso></div>;
  if (!c) return <div style={{ padding: 16, color: "var(--ww-text-muted)", fontSize: 12.5 }}>Carregando a cadeia…</div>;
  const p = c.pedido;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, padding: 16 }}>
      <Bloco titulo={`Requisições (${c.rcs.length})`}>
        {c.rcs.length === 0 ? <Vazio t="Nenhuma RC ligada." /> : c.rcs.map((r) => (
          <LinhaB key={r.numero} a={<b>RC {r.numero}</b>} b={`${r.itens} ${r.itens === 1 ? "item" : "itens"}`} c={brl(r.custo)} />))}
      </Bloco>
      <Bloco titulo={`Pedidos de compra (${c.pcs.length})`}>
        {c.pcs.length === 0 ? <Vazio t="Nenhum PC ligado." /> : c.pcs.map((pc) => {
          const pago = Math.max(Number(pc.pago_painel), Number(pc.pago_omie));
          const quitado = pc.quitado_omie === true || pago >= Number(pc.valor_total) - 0.01;
          return (
            <LinhaB key={pc.numero}
              a={<><b>PC {pc.numero}</b><div style={sub}>{pc.fornecedor_nome ?? "—"}</div></>}
              b={<span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                {pc.nf ? <Selo t={`NF ${pc.nf}`} tone="info" /> : <Selo t="sem NF" tone="off" />}
                {pc.etapa === "80" ? <Selo t="Conferido" tone="violet" /> : pc.dt_rec ? <Selo t={`Receb. ${ddmmaa(pc.dt_rec)}`} tone="violet" /> : null}
                <Selo t={quitado ? "Pago" : pago > 0 ? `Pago ${brl(pago)}` : "A pagar"} tone={quitado ? "ok" : pago > 0 ? "warn" : "off"} />
              </span>}
              c={brl(pc.valor_total)} />
          );
        })}
      </Bloco>
      <Bloco titulo={`A receber (${c.receber.length})`}>
        {c.receber.length === 0 ? <Vazio t={p?.faturado ? "Faturado, mas sem título a receber ligado." : "Ainda não faturado."} /> : c.receber.map((t, i) => (
          <LinhaB key={i} a={<><b>{t.numero_parcela ?? t.num_parcela ?? "—"}</b><div style={sub}>venc. {ddmmaa(t.vencimento)}{t.nf ? ` · NF ${t.nf}` : ""}</div></>}
            b={<Selo t={t.status_titulo ?? "—"} tone={Number(t.recebido) >= Number(t.valor_documento) - 0.01 ? "ok" : Number(t.recebido) > 0 ? "warn" : "off"} />}
            c={brl(t.valor_documento)} />))}
      </Bloco>
      {p && (
        <Bloco titulo="Resultado">
          <LinhaB a="Vendido (PV/OS)" c={brl(p.receita_pv)} />
          {p.receita_nf != null && <LinhaB a="Faturado (NF)" c={brl(p.receita_nf)} />}
          <LinhaB a="Compras ligadas" c={brl(p.custo)} />
          <LinhaB a={<b>Margem bruta</b>} c={<b>{p.margem != null ? `${brl(p.margem)} · ${fmtMb(p.margem_pct)}` : "—"}</b>} />
          <LinhaB a="Pago aos fornecedores" c={`${brl(p.pago)} de ${brl(p.custo)}`} />
          <LinhaB a="Recebido do cliente" c={`${brl(p.recebido)} de ${brl(p.titulos_receber)}`} />
        </Bloco>
      )}
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div style={{ ...cartao, padding: "12px 14px" }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: "var(--ww-text)" }}>{titulo}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}
function LinhaB({ a, b, c }: { a: ReactNode; b?: ReactNode; c?: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: "var(--ww-text-2)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>{a}</div>
      {b != null && <div>{b}</div>}
      {c != null && <div style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: "var(--ww-text)" }}>{c}</div>}
    </div>
  );
}
const Vazio = ({ t }: { t: string }) => <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>{t}</div>;

const tabela: CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th: CSSProperties = { padding: "14px 12px", fontSize: 13, fontWeight: 600, color: "var(--ww-text-faint)", borderBottom: "1px solid var(--ww-border)", whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "10px 12px", verticalAlign: "top", color: "var(--ww-text)" };
const num: CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const sub: CSSProperties = { fontSize: 11, color: "var(--ww-text-faint)", marginTop: 2 };
const linha: CSSProperties = { borderBottom: "1px solid var(--ww-border)", cursor: "pointer" };
const vazio: CSSProperties = { padding: 28, textAlign: "center", color: "var(--ww-text-muted)" };
const sel: CSSProperties = {
  height: 32, padding: "0 10px", borderRadius: 999, fontSize: 12.5, fontFamily: "inherit",
  border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
};
