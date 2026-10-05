"use client";

/**
 * Estoque › Movimentação (02/10/26).
 * Uma tabela só, com cabeçalho (Item · Tipo / Documento · Cliente / Projeto · Qtd · Valor unit. · Saldo após),
 * agrupada por dia. Junta os movimentos do Omie (NF de compra/venda/remessa — automáticos) e os do painel
 * (saída para obra, retorno, transferência, consumo, perda, devolução — lançados aqui, nunca vão ao Omie).
 * "+ Nova movimentação" registra; perda/avaria espera a aprovação do administrador (fila no topo).
 * "Configurar" (administrador): tipos de movimentação e justificativas de cada tipo.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { baixarCSV, hoje, nomeLocal, normMov, somaDias, type ItemEstoque, type MovEstoque } from "@/lib/estoque";
import { Pill, Thumb, brl, ddmm, dsem, invalidarItens, kbrl, postar, q, useToast } from "./comum";
import { ModalNovaMov } from "./NovaMovimentacao";
import { ModalSeparacao } from "./Separacao";
export { ModalNovaMov };

export type TipoMov = { id: number; codigo: string; nome: string; sentido: "entra" | "sai" | "transfere"; origem: "manual" | "omie" | "inventario";
  exige_aprovacao: boolean; exige_cliente_ou_projeto: boolean; exige_pc: boolean; ativo: boolean; ordem: number; descricao: string | null };
export type MotivoMov = { id: number; tipo_id: number; nome: string; ativo: boolean; ordem: number };
export type Usuario = { id: string; nome: string; email: string };
export type MovPainel = { id: number; tipo_id: number; n_cod_prod: number; quantidade: number; local_origem: number | null; local_destino: number | null;
  solicitante_nome: string; cliente: string | null; projeto: string | null; pv_os: string | null; pc_numero: string | null; motivo: string; obs: string | null;
  status: "aplicado" | "pendente" | "rejeitado" | "cancelado"; cmc: number; valor: number; created_by_email: string | null; created_at: string;
  aprovado_por_email: string | null; decisao_obs: string | null; lote_id: number | null };
export type LoteMov = { id: number; tipo_id: number; solicitante_nome: string; cliente: string | null; projeto: string | null; pv_os: string | null;
  motivo: string; obs: string | null; status: MovPainel["status"]; n_linhas: number; quantidade: number; valor: number; created_by_email: string | null; created_at: string };
export type ApoioMov = { tipos: TipoMov[]; motivos: MotivoMov[]; usuarios: Usuario[]; pendentes: number; admin: boolean; eu: { id: string; email: string } };

const normPainel = (r: Record<string, unknown>): MovPainel => ({
  ...(r as unknown as MovPainel), id: Number(r.id), tipo_id: Number(r.tipo_id), n_cod_prod: Number(r.n_cod_prod), quantidade: Number(r.quantidade),
  local_origem: r.local_origem == null ? null : Number(r.local_origem), local_destino: r.local_destino == null ? null : Number(r.local_destino),
  cmc: Number(r.cmc) || 0, valor: Number(r.valor) || 0, lote_id: r.lote_id == null ? null : Number(r.lote_id),
});
const diaSP = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const horaSP = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const SENTIDO: Record<TipoMov["sentido"], string> = { entra: "entra", sai: "sai", transfere: "transfere" };

/** Linha da tabela: um movimento do Omie ou do painel no mesmo formato. */
type Linha = {
  k: string; dia: string; fonte: "omie" | "painel"; id_prod: number | null; tipo: string; doc: string | null; sub: string | null;
  cliente: string | null; projeto: string | null; qtde: number; transfer: string | null; unit: number; saldo: number | null;
  apagado: boolean; status: MovPainel["status"] | null; local: string; mov?: MovPainel; solicitante: string | null; tipoKey: string; lote: number | null;
};

export function AbaMovs(props: { porId: Map<number, ItemEstoque>; itens: ItemEstoque[]; abrir: (p: ItemEstoque, aba?: string) => void }) {
  // Só no cliente: com render no servidor a aba não hidratava ao abrir o endereço direto (02/10/26).
  const [montado, setMontado] = useState(false);
  useEffect(() => { setMontado(true); }, []);
  if (!montado) return <div className="cartao vazio">Carregando movimentos…</div>;
  return <AbaMovsCliente {...props} />;
}

function AbaMovsCliente({ porId, itens, abrir }: {
  porId: Map<number, ItemEstoque>; itens: ItemEstoque[]; abrir: (p: ItemEstoque, aba?: string) => void;
}) {
  const h = hoje();
  const [dias, setDias] = useState<7 | 30 | 90>(7);
  const de = somaDias(h, -dias + 1), ate = h;
  const [fonte, setFonte] = useState<"todas" | "omie" | "painel">("todas");
  const [tipoF, setTipoF] = useState("");
  const [solF, setSolF] = useState("");
  const [busca, setBusca] = useState("");
  const [omie, setOmie] = useState<MovEstoque[] | null>(null);
  const [painel, setPainel] = useState<MovPainel[] | null>(null);
  const [apoio, setApoio] = useState<ApoioMov | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [lotes, setLotes] = useState<Map<number, LoteMov>>(new Map());
  const [lotesAbertos, setLotesAbertos] = useState<Set<number>>(new Set());
  const [nova, setNova] = useState(false);
  const [separar, setSeparar] = useState(false);
  const [config, setConfig] = useState(false);
  const [toast, avisar] = useToast();
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setOmie(null); setPainel(null); setErro(null);
    fetch(`/api/estoque/movimentos?de=${de}&ate=${ate}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setOmie((j.rows as Record<string, unknown>[]).map(normMov)); })
      .catch((e) => { if ((e as Error).name !== "AbortError") setErro((e as Error).message); });
    fetch(`/api/estoque/movimentacao?de=${de}&ate=${ate}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText);
        setPainel((j.movs as Record<string, unknown>[]).map(normPainel));
        setLotes(new Map(((j.lotes ?? []) as LoteMov[]).map((l) => [Number(l.id), { ...l, id: Number(l.id), tipo_id: Number(l.tipo_id), n_linhas: Number(l.n_linhas), quantidade: Number(l.quantidade), valor: Number(l.valor) }])));
        setApoio({ tipos: j.tipos, motivos: j.motivos, usuarios: j.usuarios, pendentes: j.pendentes, admin: j.admin, eu: j.eu }); })
      .catch((e) => { if ((e as Error).name !== "AbortError") setErro((e as Error).message); });
    return () => ctrl.abort();
  }, [de, ate, versao]);

  const tipoPorId = useMemo(() => new Map((apoio?.tipos ?? []).map((t) => [t.id, t])), [apoio]);
  const linhas = useMemo<Linha[]>(() => {
    const o: Linha[] = (omie ?? []).map((m) => ({
      k: `o${m.id_mov}`, dia: m.dt_mov, fonte: "omie", id_prod: m.id_prod ?? null, tipo: m.des_origem ?? "Omie", doc: m.doc ?? m.num_pedido, sub: null,
      cliente: m.cliente, projeto: m.projeto, qtde: m.qtde, transfer: null, unit: m.valor || 0, saldo: m.saldo, apagado: m.cancelado, status: null,
      local: nomeLocal(m.codigo_local_estoque), solicitante: null, tipoKey: `o:${m.des_origem ?? ""}`, lote: null,
    }));
    const p: Linha[] = (painel ?? []).map((m) => {
      const t = tipoPorId.get(m.tipo_id);
      const s = t?.sentido ?? "sai";
      return {
        k: `p${m.id}`, dia: diaSP(m.created_at), fonte: "painel", id_prod: m.n_cod_prod, tipo: t?.nome ?? "Movimentação do painel",
        doc: [m.pv_os && `PV/OS ${m.pv_os}`, m.pc_numero && `PC ${m.pc_numero}`].filter(Boolean).join(" · ") || null,
        sub: `pedido por ${m.solicitante_nome} · ${m.motivo}${m.obs ? ` — ${m.obs}` : ""} · ${horaSP(m.created_at)}`,
        cliente: m.cliente, projeto: m.projeto, qtde: s === "sai" ? -m.quantidade : m.quantidade,
        transfer: s === "transfere" ? `${nomeLocal(m.local_origem)} → ${nomeLocal(m.local_destino)}` : null,
        unit: m.cmc, saldo: null, apagado: m.status === "cancelado" || m.status === "rejeitado", status: m.status,
        local: s === "entra" ? nomeLocal(m.local_destino) : nomeLocal(m.local_origem), mov: m, solicitante: m.solicitante_nome, tipoKey: `p:${m.tipo_id}`,
        lote: m.lote_id,
      };
    });
    return [...p, ...o];
  }, [omie, painel, tipoPorId]);

  const t = busca.trim().toLowerCase();
  const rs = linhas.filter((l) => (fonte === "todas" || l.fonte === fonte) && (!tipoF || l.tipoKey === tipoF) && (!solF || l.solicitante === solF)
    && (!t || [porId.get(l.id_prod ?? -1)?.descricao, porId.get(l.id_prod ?? -1)?.codigo, porId.get(l.id_prod ?? -1)?.codigo_novo, l.doc, l.cliente, l.projeto, l.solicitante, l.tipo]
      .some((v) => (v ?? "").toLowerCase().includes(t))));
  const opcoesTipo = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of linhas) if (!m.has(l.tipoKey)) m.set(l.tipoKey, `${l.fonte === "omie" ? "Omie · " : ""}${l.tipo}`);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);
  const solicitantes = useMemo(() => [...new Set(linhas.map((l) => l.solicitante).filter(Boolean) as string[])].sort(), [linhas]);
  const porDia = useMemo(() => {
    const m = new Map<string, Linha[]>();
    for (const l of [...rs].sort((a, b) => b.dia.localeCompare(a.dia))) (m.get(l.dia) ?? m.set(l.dia, []).get(l.dia)!).push(l);
    return [...m.entries()];
  }, [rs]);
  const vivos = rs.filter((l) => !l.apagado && l.status !== "pendente");
  const v = (l: Linha[]) => l.reduce((s, x) => s + Math.abs(x.qtde) * (x.unit || 0), 0);
  const ent = vivos.filter((l) => l.qtde > 0 && !l.transfer), sai = vivos.filter((l) => l.qtde < 0);
  const pendTodas = (painel ?? []).filter((m) => m.status === "pendente");
  // fila: um lote pendente aparece uma vez (aprova/rejeita inteiro); movimento avulso, sozinho
  const pend = [...new Map(pendTodas.map((m) => [m.lote_id ? `l${m.lote_id}` : `m${m.id}`, m])).values()];
  const carregando = !omie || !painel;

  const decidir = async (m: MovPainel | { lote: number }, acao: "aprovar" | "rejeitar" | "cancelar") => {
    try { await postar("/api/estoque/movimentacao", "lote" in m ? { acao, lote_id: m.lote } : { acao, id: m.id }); avisar(acao === "aprovar" ? "Aprovada — saldo baixado" : acao === "rejeitar" ? "Rejeitada" : "Cancelada — saldo voltou", "ok"); invalidarItens(); setVersao((x) => x + 1); }
    catch (e) { avisar((e as Error).message, "crit"); }
  };


  // uma linha de movimento (dentro de lote: recuada)
  const linhaMov = (x: Linha, dentro: boolean) => {
    const p = porId.get(x.id_prod ?? -1);
    const cd = codigos(x);
    return (
                    <tr key={x.k} className={`click ${dentro ? "no-lote" : ""}`} style={{ opacity: x.apagado ? 0.45 : 1 }} onClick={() => p && abrir(p, "mov")}>
                      <td><div className="prod"><Thumb src={p?.foto} /><div><div className="n">{p?.descricao ?? `Produto ${x.id_prod}`}</div><div className="c"><span className="mono" title="Código no documento → código do item hoje">{cd.doc}{cd.hoje !== cd.doc ? <> → <b>{cd.hoje}</b></> : null}</span>{cd.mesclado && <> <Pill t="mesclado" tom="violet" /></>} · {x.transfer ?? x.local}</div></div></div></td>
                      <td>{x.tipo} {x.fonte === "painel" ? <Pill t={x.status === "aplicado" ? "interna" : x.status ?? ""} tom={x.status === "pendente" ? "warn" : x.status === "aplicado" ? "info" : "off"} /> : null}
                        <div className="mini">{[x.doc, x.sub].filter(Boolean).join(" · ") || "—"}</div>
                        {x.mov && apoio?.admin && x.status === "aplicado" && <button className="link mini" onClick={(ev) => { ev.stopPropagation(); decidir(x.mov!, "cancelar"); }}>cancelar</button>}</td>
                      <td className="opt">{x.cliente || x.projeto ? <><b>{x.cliente ?? "—"}</b><div className="mini">{x.projeto ?? ""}</div></> : x.qtde < 0 ? <span className="mini" style={{ color: "var(--ww-warn-text)" }}>sem cliente</span> : <span className="mini">—</span>}</td>
                      <td className="r" style={{ fontWeight: 600, color: `var(--ww-${x.apagado ? "off" : x.transfer ? "info" : x.qtde < 0 ? "crit" : "ok"}-text)` }}>{x.transfer ? "⇄ " : x.qtde > 0 ? "+" : "−"}{q(Math.abs(x.qtde))}</td>
                      <td className="r opt">{brl(x.unit)}</td>
                      <td className="r">{x.saldo == null ? <span className="mini">—</span> : q(x.saldo)}</td>
                    </tr>
    );
  };
  /** Código usado no documento e o código do item hoje (o mesclado responde no principal). */
  const codigos = (x: Linha) => {
    const p = porId.get(x.id_prod ?? -1);
    const hojeIt = p?.mesclado_em != null ? porId.get(p.mesclado_em) ?? p : p;
    return { doc: p ? p.codigo_omie ?? p.codigo : String(x.id_prod ?? ""), hoje: hojeIt ? hojeIt.codigo_novo ?? hojeIt.codigo : "", mesclado: !!p && p.mesclado_em != null,
      descricaoHoje: hojeIt?.descricao ?? "" };
  };
  const csv = () => baixarCSV(`movimentacao-${de}-a-${ate}.csv`, [
    ["Data", "Origem", "Tipo", "Documento", "Código no documento", "Código atual", "Item (hoje)", "Mesclado", "Local", "Cliente", "Projeto", "Solicitante", "Qtde", "Valor unit.", "Saldo após", "Situação"],
    ...rs.map((x) => { const c = codigos(x); return [x.dia, x.fonte === "omie" ? "Omie" : "Painel", x.tipo, x.doc ?? "", c.doc, c.hoje, c.descricaoHoje, c.mesclado ? "sim" : "",
      x.transfer ?? x.local, x.cliente ?? "", x.projeto ?? "", x.solicitante ?? "", x.qtde, x.unit, x.saldo ?? "", x.status ?? (x.apagado ? "cancelado" : "")]; }),
  ]);
  /** Junta, dentro do dia, as linhas do mesmo lote (lote com 2+ linhas vira uma linha que abre). */
  const blocosDoDia = (l: Linha[]): { lote: number | null; linhas: Linha[] }[] => {
    const out: { lote: number | null; linhas: Linha[] }[] = [], idx = new Map<number, number>();
    for (const x of l) {
      if (x.lote && l.filter((y) => y.lote === x.lote).length > 1) {
        const k = idx.get(x.lote);
        if (k == null) { idx.set(x.lote, out.length); out.push({ lote: x.lote, linhas: [x] }); } else out[k].linhas.push(x);
      } else out.push({ lote: null, linhas: [x] });
    }
    return out;
  };

  return (<>
    <div className="filtros">
      {([7, 30, 90] as const).map((d) => <button key={d} className={`chip ${dias === d ? "on" : ""}`} onClick={() => setDias(d)}>Últimos {d} dias</button>)}
      <select className="inp" value={fonte} onChange={(e) => setFonte(e.target.value as typeof fonte)} aria-label="Origem" style={{ height: 32 }}>
        <option value="todas">NF do Omie + internas</option><option value="omie">Só NF do Omie (automáticas)</option><option value="painel">Só internas (lançadas aqui)</option>
      </select>
      <select className="inp" value={tipoF} onChange={(e) => setTipoF(e.target.value)} aria-label="Tipo" style={{ height: 32, maxWidth: 230 }}>
        <option value="">Todos os tipos</option>{opcoesTipo.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {solicitantes.length > 0 && <select className="inp" value={solF} onChange={(e) => setSolF(e.target.value)} aria-label="Solicitante" style={{ height: 32 }}>
        <option value="">Qualquer solicitante</option>{solicitantes.map((s) => <option key={s}>{s}</option>)}
      </select>}
      <input className="inp" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto, cliente, projeto, doc…" style={{ width: 220 }} aria-label="Buscar movimentos" />
      <div className="sp" />
      <button className="btn sm" onClick={csv} disabled={carregando}>CSV</button>
      {apoio?.admin && <button className="btn sm" onClick={() => setConfig(true)}>Configurar tipos</button>}
      <button className="btn sm" onClick={() => setSeparar(true)} title="Reservar material para um projeto, em lote (devolver e consumir também)">Separar p/ projeto</button>
      <button className="btn sm pri" onClick={() => setNova(true)} disabled={!apoio}>+ Nova movimentação</button>
    </div>
    {erro && <div className="aviso t-crit">{erro}</div>}

    {pend.length > 0 && (
      <div className="cartao">
        <div className="head" style={{ padding: "12px 16px" }}><h3 style={{ margin: 0 }}>Aguardando aprovação</h3>
          <span className="mini">{pend.length} movimentação(ões) — perda/avaria só baixa o saldo depois de aprovada{apoio?.admin ? "" : " pelo administrador"}</span></div>
        <div className="scroll"><table className="tabela"><tbody>
          {pend.map((m) => { const p = porId.get(m.n_cod_prod); const tp = tipoPorId.get(m.tipo_id); const lt = m.lote_id ? lotes.get(m.lote_id) : null;
            const doLote = lt ? pendTodas.filter((x) => x.lote_id === lt.id) : [m];
            const alvo = lt ? { lote: lt.id } : m;
            return (
            <tr key={lt ? `l${lt.id}` : m.id}>
              <td>{lt && doLote.length > 1 ? <><b>Lote #{lt.id} · {doLote.length} itens</b><div className="mini">{tp?.nome} · {doLote.slice(0, 3).map((x) => porId.get(x.n_cod_prod)?.descricao ?? x.n_cod_prod).join(", ")}{doLote.length > 3 ? "…" : ""}</div></>
                : <><b>{p?.descricao ?? m.n_cod_prod}</b><div className="mini">{p?.codigo} · {tp?.nome}</div></>}</td>
              <td>{q(doLote.reduce((s2, x) => s2 + x.quantidade, 0))} un · {brl(doLote.reduce((s2, x) => s2 + x.quantidade * x.cmc, 0))}<div className="mini">{m.motivo}{m.obs ? ` — ${m.obs}` : ""}</div></td>
              <td className="opt">pedido por <b>{m.solicitante_nome}</b><div className="mini">lançado por {m.created_by_email} · {ddmm(diaSP(m.created_at))}</div></td>
              <td style={{ whiteSpace: "nowrap" }}>{apoio?.admin ? <>
                <button className="btn sm pri" onClick={() => decidir(alvo, "aprovar")}>{lt && doLote.length > 1 ? "Aprovar o lote" : "Aprovar"}</button>{" "}
                <button className="btn sm" onClick={() => decidir(alvo, "rejeitar")}>Rejeitar</button></> : <Pill t="aguardando" tom="warn" />}</td>
            </tr>
          ); })}
        </tbody></table></div>
      </div>
    )}

    <div className="cartao" style={{ overflow: "hidden" }}>
      <div className="tfoot" style={{ borderTop: 0, borderBottom: "1px solid var(--ww-border)" }}>
        {carregando ? <span>Carregando movimentos dos últimos {dias} dias…</span> : <span>
          <b style={{ color: "var(--ww-text)" }}>{q(rs.length)}</b> movimentos · entradas <b style={{ color: "var(--ww-ok-text)" }}>{kbrl(v(ent))}</b> · saídas <b style={{ color: "var(--ww-crit-text)" }}>{kbrl(v(sai))}</b>
          {" "}· {q(sai.filter((l) => !l.cliente && !l.projeto).length)} saídas sem cliente · {q(new Set(vivos.map((l) => l.id_prod)).size)} itens</span>}
      </div>
      <div className="scroll">
        <table className="tabela tab-movs">
          <thead><tr><th>Item</th><th>Tipo / Documento</th><th className="opt">Cliente / Projeto</th><th className="r">Qtd</th><th className="r opt">Valor unit.</th><th className="r" title="Saldo do item depois do movimento (o Omie informa; movimentos do painel mudam o saldo atual)">Saldo após</th></tr></thead>
          <tbody>
            {carregando && Array.from({ length: 8 }, (_, i) => (
              <tr key={`sk${i}`} className="skel"><td><span /></td><td><span /></td><td className="opt"><span /></td><td className="r"><span /></td><td className="r opt"><span /></td><td className="r"><span /></td></tr>
            ))}
            {!carregando && porDia.map(([d, l]) => {
              const ab = !fechados.has(d), e = l.filter((x) => x.qtde > 0 && !x.apagado && !x.transfer), s = l.filter((x) => x.qtde < 0 && !x.apagado);
              return [
                <tr key={`d${d}`} className="grp-fam" onClick={() => setFechados((f) => { const n = new Set(f); if (n.has(d)) n.delete(d); else n.add(d); return n; })}>
                  <td colSpan={6}>
                    <span style={{ display: "inline-flex", transform: `rotate(${ab ? 90 : 0}deg)`, transition: ".15s", marginRight: 8 }}>›</span>
                    <b>{ddmm(d)} · {dsem(d)}</b> <span className="mini">· {l.length} movimentos · {e.length} entradas · {s.length} saídas</span>
                    <span style={{ float: "right" }} className="num"><span style={{ color: "var(--ww-ok-text)" }}>+{kbrl(v(e))}</span> / <span style={{ color: "var(--ww-crit-text)" }}>−{kbrl(v(s))}</span></span>
                  </td>
                </tr>,
                ...(ab ? blocosDoDia(l).flatMap((bl) => {
                  if (bl.lote) {
                    const lt = lotes.get(bl.lote), aberto = lotesAbertos.has(bl.lote), x0 = bl.linhas[0];
                    const cab = (
                      <tr key={`lt${bl.lote}`} className="click lote-cab" onClick={() => setLotesAbertos((s0) => { const n = new Set(s0); if (n.has(bl.lote!)) n.delete(bl.lote!); else n.add(bl.lote!); return n; })}>
                        <td><div className="prod"><Thumb txt="LT" /><div><div className="n">Lote #{bl.lote} · {bl.linhas.length} itens {aberto ? "▾" : "▸"}</div>
                          <div className="c">{bl.linhas.slice(0, 3).map((x) => porId.get(x.id_prod ?? -1)?.descricao ?? x.id_prod).join(", ")}{bl.linhas.length > 3 ? "…" : ""}</div></div></div></td>
                        <td>{x0.tipo} <Pill t={x0.status === "aplicado" ? "interna" : x0.status ?? ""} tom={x0.status === "pendente" ? "warn" : x0.status === "aplicado" ? "info" : "off"} />
                          <div className="mini">{x0.sub}</div>
                          {apoio?.admin && x0.status === "aplicado" && <button className="link mini" onClick={(ev) => { ev.stopPropagation(); decidir({ lote: bl.lote! }, "cancelar"); }}>cancelar o lote</button>}</td>
                        <td className="opt">{lt?.cliente || lt?.projeto ? <><b>{lt?.cliente ?? "—"}</b><div className="mini">{lt?.projeto ?? ""}</div></> : <span className="mini">—</span>}</td>
                        <td className="r" style={{ fontWeight: 600 }}>{x0.transfer ? "⇄ " : x0.qtde > 0 ? "+" : "−"}{q(bl.linhas.reduce((s0, x) => s0 + Math.abs(x.qtde), 0))}</td>
                        <td className="r opt">{brl(bl.linhas.reduce((s0, x) => s0 + Math.abs(x.qtde) * x.unit, 0))}<div className="mini">total</div></td>
                        <td className="r"><span className="mini">—</span></td>
                      </tr>
                    );
                    return [cab, ...(aberto ? bl.linhas.map((x) => linhaMov(x, true)) : [])];
                  }
                  return [linhaMov(bl.linhas[0], false)];
                }) : []),
              ];
            })}
            {!carregando && !rs.length && <tr><td colSpan={6} className="vazio">Nenhum movimento nesse filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
    {separar && <ModalSeparacao fechar={() => { setSeparar(false); setVersao((x) => x + 1); }} />}
    {nova && apoio && <ModalNovaMov itens={itens} apoio={apoio} fechar={() => setNova(false)}
      ok={(lt) => { setNova(false); avisar(lt.status === "pendente" ? `Lote #${lt.id} lançado — aguardando aprovação do administrador` : `Lote #${lt.id} lançado (${lt.n_linhas} linha${lt.n_linhas > 1 ? "s" : ""}) — saldo atualizado`, "ok"); invalidarItens(); setVersao((x) => x + 1); }} />}
    {config && apoio && <ModalConfigMov apoio={apoio} fechar={() => setConfig(false)} mudou={(a) => setApoio((x) => (x ? { ...x, ...a } : x))} />}
    {toast}
  </>);
}

// ── Configurar tipos e justificativas (administrador) ────────────────────────
function ModalConfigMov({ apoio, fechar, mudou }: { apoio: ApoioMov; fechar: () => void; mudou: (a: Partial<ApoioMov>) => void }) {
  const [sel, setSel] = useState<number | "novo">(apoio.tipos.find((t) => t.origem === "manual")?.id ?? "novo");
  const t = sel === "novo" ? null : apoio.tipos.find((x) => x.id === sel) ?? null;
  const vazio = { nome: "", sentido: "sai" as TipoMov["sentido"], exige_aprovacao: false, exige_cliente_ou_projeto: false, exige_pc: false, ativo: true, descricao: "" };
  const [f, setF] = useState(t ? { ...vazio, ...t, descricao: t.descricao ?? "" } : vazio);
  useEffect(() => { setF(t ? { ...vazio, ...t, descricao: t.descricao ?? "" } : vazio); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const [novoMot, setNovoMot] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  const manual = !t || t.origem === "manual";
  const enviar = async (corpo: Record<string, unknown>) => {
    setIndo(true); setErro(null);
    try { const r = await postar<Partial<ApoioMov>>("/api/estoque/movimentacao", corpo); mudou({ tipos: r.tipos, motivos: r.motivos }); return true; }
    catch (e) { setErro((e as Error).message); return false; } finally { setIndo(false); }
  };
  const mots = t ? apoio.motivos.filter((m) => m.tipo_id === t.id) : [];
  return (
    <div className="est-ov mid" onClick={fechar} role="dialog" aria-modal="true" aria-label="Configurar tipos de movimentação">
      <div className="modal lg" onClick={(e) => e.stopPropagation()}>
        <div className="mh"><div><div style={{ fontSize: 16, fontWeight: 700 }}>Tipos de movimentação</div>
          <div className="mini">O que cada tipo faz com o saldo e o que ele exige. Os automáticos (NF do Omie) e o de inventário só mudam nome e descrição.</div></div>
          <button className="x" onClick={fechar} aria-label="Fechar">×</button></div>
        <div className="mb" style={{ display: "grid", gridTemplateColumns: "minmax(180px, 240px) 1fr", gap: 16 }}>
          <div style={{ display: "grid", gap: 4, alignContent: "start" }}>
            {apoio.tipos.map((x) => (
              <button key={x.id} type="button" className={`opcao ${sel === x.id ? "on" : ""}`} onClick={() => setSel(x.id)} style={{ textAlign: "left", opacity: x.ativo ? 1 : 0.5 }}>
                <b>{x.nome}</b><div className="mini">{x.origem === "omie" ? "automático (Omie)" : x.origem === "inventario" ? "aba Inventário" : SENTIDO[x.sentido]}{x.exige_aprovacao ? " · aprovação" : ""}{x.ativo ? "" : " · inativo"}</div></button>
            ))}
            <button type="button" className={`opcao ${sel === "novo" ? "on" : ""}`} onClick={() => setSel("novo")}><b>+ Novo tipo</b></button>
          </div>
          <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
            <label className="f">Nome<input className="inp" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></label>
            <label className="f">O que faz com o saldo
              <select className="inp" value={f.sentido} disabled={!manual} onChange={(e) => setF({ ...f, sentido: e.target.value as TipoMov["sentido"] })}>
                <option value="sai">Sai do estoque</option><option value="entra">Entra no estoque</option><option value="transfere">Transfere entre locais</option>
              </select></label>
            <label className="check"><input type="checkbox" disabled={!manual} checked={f.exige_aprovacao} onChange={(e) => setF({ ...f, exige_aprovacao: e.target.checked })} /> Precisa da aprovação do administrador</label>
            <label className="check"><input type="checkbox" disabled={!manual} checked={f.exige_cliente_ou_projeto} onChange={(e) => setF({ ...f, exige_cliente_ou_projeto: e.target.checked })} /> Exige cliente ou projeto</label>
            <label className="check"><input type="checkbox" disabled={!manual} checked={f.exige_pc} onChange={(e) => setF({ ...f, exige_pc: e.target.checked })} /> Exige número do PC</label>
            <label className="check"><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Ativo</label>
            <label className="f">Descrição (aparece no formulário)<input className="inp" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} /></label>
            <div><button className="btn pri" disabled={indo} onClick={() => enviar({ acao: "tipo_salvar", tipo: { ...f, id: t?.id } })}>{t ? "Salvar tipo" : "Criar tipo"}</button></div>
            {t && t.origem === "manual" && (<>
              <div style={{ fontWeight: 700, marginTop: 6 }}>Justificativas de “{t.nome}”</div>
              <div style={{ display: "grid", gap: 4 }}>
                {mots.map((m) => (
                  <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", opacity: m.ativo ? 1 : 0.5 }}>
                    <span style={{ flex: 1 }}>{m.nome}</span>
                    <button className="btn sm" disabled={indo} onClick={() => enviar({ acao: "motivo_salvar", motivo: { id: m.id, nome: m.nome, ativo: !m.ativo } })}>{m.ativo ? "Desativar" : "Reativar"}</button>
                  </div>
                ))}
                {!mots.length && <span className="mini">Nenhuma ainda — quem lança escreve a justificativa.</span>}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="inp" value={novoMot} onChange={(e) => setNovoMot(e.target.value)} placeholder="Nova justificativa" style={{ flex: 1 }} />
                <button className="btn" disabled={indo || !novoMot.trim()} onClick={async () => { if (await enviar({ acao: "motivo_salvar", motivo: { tipo_id: t.id, nome: novoMot } })) setNovoMot(""); }}>Adicionar</button>
              </div>
            </>)}
            {erro && <div className="aviso t-crit">{erro}</div>}
          </div>
        </div>
        <div className="mf"><button className="btn" onClick={fechar}>Fechar</button></div>
      </div>
    </div>
  );
}

/** Movimentações do painel na ficha do item (lista curta + botão "+ Nova movimentação"). */
export function MovsPainelItem({ item, itens, abrirNova, aoFechar }: { item: ItemEstoque; itens: ItemEstoque[]; abrirNova?: boolean; aoFechar?: () => void }) {
  const [d, setD] = useState<{ movs: MovPainel[]; apoio: ApoioMov } | null>(null);
  const [nova, setNovaSt] = useState(!!abrirNova);
  const setNova = (v: boolean) => { setNovaSt(v); if (!v) aoFechar?.(); };
  const [toast, avisar] = useToast();
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/estoque/movimentacao?n_cod_prod=${item.n_cod_prod}`, { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setD({ movs: (j.movs as Record<string, unknown>[]).map(normPainel), apoio: { tipos: j.tipos, motivos: j.motivos, usuarios: j.usuarios, pendentes: j.pendentes, admin: j.admin, eu: j.eu } });
  }, [item.n_cod_prod]);
  useEffect(() => { carregar(); }, [carregar]);
  const tipo = (id: number) => d?.apoio.tipos.find((t) => t.id === id);
  return (<>
    <div className="cartao">
      <div className="head" style={{ padding: "12px 16px" }}>
        <div style={{ flex: 1 }}><h3 style={{ margin: 0 }}>Movimentações internas (painel)</h3><span className="mini">saída para obra, retorno, transferência, consumo, perda… — não vão ao Omie</span></div>
        <button className="btn sm pri" disabled={!d} onClick={() => setNova(true)}>+ Nova movimentação</button>
      </div>
      {d && d.movs.length > 0 && <div className="scroll"><table className="tabela">
        <thead><tr><th>Data</th><th>Tipo</th><th className="opt">Cliente / Projeto</th><th>Solicitante</th><th className="r">Qtd</th></tr></thead>
        <tbody>{d.movs.map((m) => { const t = tipo(m.tipo_id); return (
          <tr key={m.id} style={{ opacity: m.status === "aplicado" || m.status === "pendente" ? 1 : 0.45 }}>
            <td>{ddmm(diaSP(m.created_at))}<div className="mini">{horaSP(m.created_at)}</div></td>
            <td>{t?.nome} {m.status !== "aplicado" && <Pill t={m.status} tom={m.status === "pendente" ? "warn" : "off"} />}<div className="mini">{m.motivo}{m.obs ? ` — ${m.obs}` : ""}</div></td>
            <td className="opt">{m.cliente ?? "—"}<div className="mini">{m.projeto ?? ""}</div></td>
            <td>{m.solicitante_nome}<div className="mini">lançado por {m.created_by_email}</div></td>
            <td className="r" style={{ fontWeight: 600 }}>{t?.sentido === "transfere" ? `⇄ ${q(m.quantidade)}` : `${t?.sentido === "entra" ? "+" : "−"}${q(m.quantidade)}`}</td>
          </tr>); })}</tbody>
      </table></div>}
      {d && !d.movs.length && <div className="vazio">Nenhuma movimentação interna deste item.</div>}
    </div>
    {nova && d && <ModalNovaMov itens={itens} itemFixo={item} apoio={d.apoio} fechar={() => setNova(false)}
      ok={(lt) => { setNova(false); avisar(lt.status === "pendente" ? "Lançada — aguardando aprovação" : "Movimentação lançada", "ok"); invalidarItens(); carregar(); }} />}
    {toast}
  </>);
}
