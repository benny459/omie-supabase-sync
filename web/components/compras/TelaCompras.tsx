"use client";

/**
 * Compras — Requisições e Pedidos (desde 01/10/2026 o pedido de compra nasce
 * e vive no painel; o Omie fica como histórico importado).
 *
 * Porte do mockup "Compras mockup 2026-10-01": Kanban com as etapas do Omie
 * (Requisição → Pedido → Aprovação → Faturado → Recebido → Conferido, arrasta
 * para mudar), Tabela com as colunas do Omie, folha de incluir/alterar e
 * recebimento com a NF que chega pela Focus.
 */

import "./compras.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CabecalhoTela, PaginaNavy, Carregando, Aviso } from "@/components/navy/tela/KitTela";
import FolhaPedido from "./FolhaPedido";
import FolhaRecebimento from "./FolhaRecebimento";
import ModalEnviar from "./ModalEnviar";
import {
  ETAPAS, ETAPA, ETAPA_AJUDA, APROV_LABEL, money, dBR, rel, hoje, diffDias, situacao, atrasado, rcAtendida,
  type PedidoLista, type Etapa, type Refs,
} from "@/lib/compras";

type Col = { k: string; l: string; v: (p: PedidoLista) => string | number | null | undefined; r?: boolean; sum?: boolean; tr?: boolean;
  h?: (p: PedidoLista) => React.ReactNode };

const LIMITE_COLUNA = 60;
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } };
const COLS_PADRAO = ["situacao", "aprov", "num", "forn", "valor", "etapaNome", "previsao", "numForn", "contato", "cat", "conta", "comprador", "proj", "rcs", "pv"];

export default function TelaCompras() {
  const emp = "SF";
  const [lista, setLista] = useState<PedidoLista[] | null>(null);
  const [nfSug, setNfSug] = useState<Record<string, number>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [refs, setRefs] = useState<Refs | null>(null);
  const [historico, setHistorico] = useState("365");
  const [view, setView] = useState<"kanban" | "tabela">("kanban");
  const [q, setQ] = useState("");
  const [comprador, setComprador] = useState("");
  const [projeto, setProjeto] = useState("");
  const [periodo, setPeriodo] = useState("");
  const [soAtraso, setSoAtraso] = useState(false);
  const [soNf, setSoNf] = useState(false);
  const [origem, setOrigem] = useState<"" | "painel" | "omie">("");
  const [filtroAprov, setFiltroAprovS] = useState<"" | "pendente" | "aprovado">("");
  const setFiltroAprov = (v: "" | "pendente" | "aprovado") => { setFiltroAprovS(v); lsSet("cmp-filtro-aprov", v); };
  useEffect(() => { const v = lsGet("cmp-filtro-aprov"); if (v === "pendente" || v === "aprovado") setFiltroAprovS(v); }, []);
  const [enviar, setEnviar] = useState<number | null>(null);
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({ k: "emissao", dir: -1 });
  const [group, setGroup] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [cols, setCols] = useState<string[]>(COLS_PADRAO);
  const [colf, setColf] = useState<Record<string, string>>({});
  const [menuNovo, setMenuNovo] = useState(false);
  const [menuCols, setMenuCols] = useState(false);
  const [ctx, setCtx] = useState<{ p: PedidoLista; x: number; y: number } | null>(null);
  const [folha, setFolha] = useState<{ id: number | null; tipo?: "RC" | "PC"; fromRC?: number | null } | null>(null);
  const [receb, setReceb] = useState<{ id: number | null } | null>(null);
  const [confirma, setConfirma] = useState<{ texto: string; acao: () => Promise<void> } | null>(null);
  const [toastMsg, setToastMsg] = useState<{ m: string; erro?: boolean } | null>(null);
  const [mais, setMais] = useState<Record<string, number>>({});
  const [arrasto, setArrasto] = useState<string | null>(null);
  const tt = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string, e?: boolean) => {
    setToastMsg({ m, erro: e });
    if (tt.current) clearTimeout(tt.current);
    tt.current = setTimeout(() => setToastMsg(null), e ? 5000 : 2800);
  }, []);

  useEffect(() => {
    const v = lsGet("cmp-view"); if (v === "tabela" || v === "kanban") setView(v);
    const c = lsGet("cmp-cols"); if (c) { try { const l = JSON.parse(c); if (Array.isArray(l) && l.length) setCols(l); } catch { /* padrão */ } }
    const h = lsGet("cmp-historico"); if (h) setHistorico(h);
  }, []);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/compras?desde=${historico}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setLista(j.pedidos); setNfSug(j.nfSug ?? {}); setErro(null);
    } catch (e) { setErro((e as Error).message); }
  }, [historico]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    fetch(`/api/compras/refs?emp=${emp}`).then((r) => r.json()).then((j) => { if (!j.error) setRefs(j); }).catch(() => null);
  }, []);
  useEffect(() => {
    // Fecha menus ao apertar FORA deles (mousedown): com "click" no document o
    // próprio clique que abre o menu do cartão já o fechava.
    const fechar = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.(".dropdown, .kebab, [data-menu]")) return;
      setMenuNovo(false); setMenuCols(false); setCtx(null);
    };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, []);

  const parcDesc = useCallback((cod?: string) => refs?.parcelas.find((p) => p.cod === cod)?.desc ?? cod ?? "", [refs]);
  const todos = lista ?? [];
  const filtrados = useMemo(() => {
    const t = q.toLowerCase().trim();
    return todos.filter((p) => {
      if (comprador && p.comprador !== comprador) return false;
      if (projeto && p.proj !== projeto) return false;
      if (periodo && p.emissao && diffDias(hoje(), p.emissao) > Number(periodo)) return false;
      if (soAtraso && !atrasado(p)) return false;
      if (soNf && !nfSug[p.id]) return false;
      if (origem && p.origem !== origem) return false;
      if (t) {
        const hay = [p.num, p.forn, p.proj, p.cat, p.comprador, p.contato, p.nf, p.cnpj, p.pv, p.pvCliente, p.busca,
          ...(p.rcs ?? []), ...(p.cobPcs ?? [])].join(" ").toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [todos, q, comprador, projeto, periodo, soAtraso, soNf, nfSug, origem]);

  // ── ações ────────────────────────────────────────────────────────────────
  const acao = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch("/api/compras/acao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j;
  }, []);

  const aprovar = useCallback(async (ids: number[]) => {
    if (!ids.length) { toast("Nada a aprovar"); return; }
    try {
      const r = await acao({ acao: "aprovar", ids, status: "aprovado" }) as { alterados: number; falhas: { num: string; erro: string }[] };
      toast(r.falhas.length ? `${r.alterados} aprovado(s); ${r.falhas.length} não: ${r.falhas[0].num} — ${r.falhas[0].erro}` : `${r.alterados} pedido(s) aprovados`, r.falhas.length > 0);
      carregar();
    } catch (e) { toast((e as Error).message, true); }
  }, [acao, carregar, toast]);

  const mover = useCallback(async (p: PedidoLista, cod: Etapa) => {
    if (p.etapa === cod) return;
    if (p.etapa === "20") { setFolha({ id: null, tipo: "PC", fromRC: p.id }); toast(`Novo pedido a partir da Requisição ${p.num} — escolha o fornecedor`); return; }
    if (cod === "20") { toast("Pedido não volta a ser requisição", true); return; }
    if (cod === "15") cod = "10"; // não há mais coluna de Aprovação
    if (cod === "10" && (p.etapa === "10" || p.etapa === "15")) return;
    if (cod === "35" && p.aprov !== "aprovado") { toast("Só pedido APROVADO vai para Enviado ao fornecedor — aprove primeiro", true); return; }
    if (["40", "60", "80"].includes(cod) && p.origem === "painel" && p.aprov !== "aprovado") { toast("Pedido ainda não aprovado — aprove antes de avançar", true); return; }
    if (cod === "60" && !p.nf) { setReceb({ id: p.id }); return; }
    if (cod === "35") { setEnviar(p.id); return; }
    try {
      await acao({ acao: "mover", id: p.id, etapa: cod });
      toast(`${p.tipo === "RC" ? "Requisição" : "Pedido"} ${p.num} movido para ${ETAPA[cod].nome}`);
      carregar();
    } catch (e) { toast((e as Error).message, true); }
  }, [acao, carregar, toast]);

  const duplicar = useCallback(async (id: number) => {
    try {
      const r = await acao({ acao: "duplicar", id }) as { id: number; num: string };
      toast(`Criado ${r.num} a partir do original`); setFolha({ id: r.id }); carregar();
    } catch (e) { toast((e as Error).message, true); }
  }, [acao, carregar, toast]);


  const ctxAct = async (k: string, p: PedidoLista) => {
    setCtx(null);
    try {
      if (k === "open") setFolha({ id: p.id });
      if (k === "dup") await duplicar(p.id);
      if (k === "gerar") setFolha({ id: null, tipo: "PC", fromRC: p.id });
      if (k === "solic") { await acao({ acao: "aprovar", ids: [p.id], status: "aguardando" }); toast(`Aprovação solicitada para o ${p.num}`); carregar(); }
      if (k === "aprovar") await aprovar([p.id]);
      if (k === "receb") setReceb({ id: p.id });
      if (k === "conf") await mover(p, "80");
      if (k === "print" || k === "enviar") setEnviar(p.id);
      if (k === "venda") setFolha({ id: p.id });
      if (k === "cancel") setConfirma({ texto: `Cancelar o ${p.tipo === "RC" ? "requisição" : "pedido"} ${p.num}?`, acao: async () => {
        await acao({ acao: "cancelar", id: p.id }); toast(`${p.num} cancelado`); carregar();
      } });
    } catch (e) { toast((e as Error).message, true); }
  };

  // ── resumo ───────────────────────────────────────────────────────────────
  /** Requisição vale o SALDO (o que falta comprar); pedido vale o total. */
  const valorDe = (p: PedidoLista) => Number(p.tipo === "RC" ? (p.saldo ?? p.valor) : p.valor) || 0;
  const soma = (l: PedidoLista[]) => l.reduce((a, p) => a + valorDe(p), 0);
  const porEtapa = (c: Etapa) => filtrados.filter((p) => p.etapa === c);
  const atrasados = filtrados.filter(atrasado);
  const comNf = filtrados.filter((p) => nfSug[p.id]);

  // ── tabela ───────────────────────────────────────────────────────────────
  const COLS: Col[] = useMemo(() => [
    { k: "situacao", l: "Situação", v: situacao, h: (p) => { const s = situacao(p); const c = p.etapa === "80" ? "p-conf" : s === "Recebido" ? "p-rec" : s.includes("atrasada") ? "p-crit" : s.startsWith("Requisição") ? "p-off" : p.etapa === "35" ? "p-env" : p.etapa === "40" ? "p-fat" : "p-warn"; return <span className={`pill ${c}`}>{p.etapa === "80" ? "Conferido" : p.etapa === "35" ? "Enviado" : p.etapa === "40" ? "Faturado" : s}</span>; } },
    { k: "aprov", l: "Situação da Aprovação", v: (p) => APROV_LABEL[p.aprov], h: (p) => p.aprov === "aprovado" ? <span className="pill p-ok">✓ Aprovado</span> : p.aprov === "aguardando" ? <span className="pill p-vio">Aguardando</span> : <span className="faint">{APROV_LABEL[p.aprov]}</span> },
    { k: "num", l: "Número", v: (p) => p.num, h: (p) => <b>{p.num}</b> },
    { k: "tipo", l: "Tipo", v: (p) => p.tipo },
    { k: "forn", l: "Fornecedor", v: (p) => p.forn ?? "", tr: true },
    { k: "cnpj", l: "CNPJ/CPF", v: (p) => p.cnpj ?? "" },
    { k: "valor", l: "Valor (RC = saldo)", v: (p) => valorDe(p), r: true, sum: true, h: (p) => <span className="num">{money(valorDe(p))}</span> },
    { k: "etapaNome", l: "Etapa", v: (p) => ETAPA[p.etapa]?.nome ?? p.etapa },
    { k: "emissao", l: "Inclusão", v: (p) => p.emissao ?? "", h: (p) => dBR(p.emissao) },
    { k: "previsao", l: "Previsão de Entrega", v: (p) => p.previsao ?? "", h: (p) => <span className={atrasado(p) ? "pill p-crit" : ""}>{dBR(p.previsao, true)}</span> },
    { k: "numForn", l: "Nº do Pedido do Fornecedor", v: (p) => p.numForn ?? "" },
    { k: "contato", l: "Contato", v: (p) => p.contato ?? "" },
    { k: "contrato", l: "Contrato", v: (p) => p.contrato ?? "" },
    { k: "cat", l: "Categoria", v: (p) => p.cat ?? "", h: (p) => p.cat ? <span className="tag">{p.cat}</span> : null },
    { k: "conta", l: "Conta Corrente", v: (p) => p.conta ?? "" },
    { k: "comprador", l: "Comprador", v: (p) => p.comprador ?? "" },
    { k: "proj", l: "Projeto", v: (p) => p.proj ?? "", tr: true },
    { k: "parc", l: "Parcelas", v: (p) => parcDesc(p.parc) },
    { k: "itens", l: "Itens", v: (p) => p.nItens, r: true },
    { k: "nf", l: "NF-e", v: (p) => p.nf ?? "", h: (p) => p.nf ? p.nf : nfSug[p.id] ? <span className="pill p-sky">NF chegou</span> : "" },
    { k: "dtRec", l: "Recebido em", v: (p) => p.dtRec ?? "", h: (p) => dBR(p.dtRec) },
    { k: "rcs", l: "Requisição ⇄ Pedido", v: (p) => p.tipo === "RC" ? (p.cobPcs ?? []).map((n) => "PC " + n).join(", ") : (p.rcs ?? []).map((n) => "RC " + n).join(", ") },
    { k: "pv", l: "Venda de origem (PV/OS)", v: (p) => p.pv ? `${p.pv}${p.pvCliente ? " · " + p.pvCliente : ""}` : "", tr: true },
    { k: "obsInt", l: "Obs. interna", v: (p) => p.obsInt ?? "", tr: true },
    { k: "origem", l: "Origem", v: (p) => (p.origem === "omie" ? "Omie (histórico)" : "Painel"), h: (p) => <span className={`tag ${p.origem === "omie" ? "orig-omie" : "orig-painel"}`}>{p.origem === "omie" ? "Omie" : "Painel"}</span> },
    { k: "enviado", l: "Enviado ao fornecedor", v: (p) => p.enviadoEm ?? "", h: (p) => p.enviadoEm ? <span className="pill p-env">{dBR(p.enviadoEm.slice(0, 10))}{p.enviadoMeio === "whatsapp" ? " · WhatsApp" : p.enviadoMeio === "email" ? " · e-mail" : ""}</span> : "" },
  ], [parcDesc, nfSug]);
  const COL = useMemo(() => Object.fromEntries(COLS.map((c) => [c.k, c])), [COLS]);
  const colsVis = cols.map((k) => COL[k]).filter(Boolean) as Col[];
  const tabelaLinhas = useMemo(() => {
    let l = filtrados.filter((p) => colsVis.every((c) => { const f = (colf[c.k] ?? "").toLowerCase(); return !f || String(c.v(p) ?? "").toLowerCase().includes(f); }));
    const sc = COL[sort.k] ?? (sort.k === "emissao" ? COL.emissao : null);
    if (sc) l = [...l].sort((a, b) => { const x = sc.v(a) ?? "", y = sc.v(b) ?? ""; return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
    return l;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtrados, colf, sort, cols, COL]);
  const selValor = todos.filter((p) => sel.has(p.id)).reduce((a, p) => a + (Number(p.valor) || 0), 0);

  // ── kanban: cartão ───────────────────────────────────────────────────────
  const cartao = (p: PedidoLista) => {
    const isNF = ["40", "60", "80"].includes(p.etapa) && p.nf;
    const late = atrasado(p);
    const cond = p.tipo === "RC" ? `com ${p.nItens} ${p.nItens === 1 ? "item" : "itens"}` : (parcDesc(p.parc) || "").toLowerCase();
    return (
      <article key={p.id} className={`card${p.tipo === "PC" && (p.etapa === "10" || p.etapa === "15") ? (p.aprov === "aprovado" ? " aprovado" : " pendente") : late ? " late" : ""}${arrasto === String(p.id) ? " dragging" : ""}`} draggable tabIndex={0}
        style={{ ["--c" as string]: p.tipo === "PC" && (p.etapa === "10" || p.etapa === "15") ? (p.aprov === "aprovado" ? "#22C55E" : "#8B5CF6") : ETAPA[p.etapa]?.cor }}
        aria-label={`${p.tipo} ${p.num}`}
        onClick={(e) => { if ((e.target as HTMLElement).closest(".kebab")) return; setFolha({ id: p.id }); }}
        onKeyDown={(e) => { if (e.key === "Enter") setFolha({ id: p.id }); }}
        onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(p.id)); setArrasto(String(p.id)); }}
        onDragEnd={() => setArrasto(null)}>
        <div className="l1">
          <span className="no">{p.tipo === "PC" && (p.etapa === "10" || p.etapa === "15") && (p.aprov === "aprovado"
              ? <span className="badge-ap ok">✓ Aprovado</span> : <span className="badge-ap pend">Pendente</span>)}
            {p.tipo === "RC" ? `Requisição Nº ${p.num}` : isNF
            ? <>NF-e Nº {String(p.nf).split(",")[0].padStart(9, "0")} <span className="faint">· Pedido {p.num}</span></> : `Pedido Nº ${p.num}`}</span>
          <button className="kebab" aria-label="Ações" onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setCtx({ p, x: Math.min(r.left, window.innerWidth - 250), y: Math.min(r.bottom + 4, window.innerHeight - 380) }); }}>⋮</button>
        </div>
        <div className={`forn${p.forn ? "" : " none"}`}>{p.forn || "Sem fornecedor definido"}</div>
        {p.etapa === "60" || p.etapa === "80" ? <div className="ent">Recebido em: {rel(p.dtRec)}</div>
          : p.etapa === "40" ? <div className="ent">Faturado pelo fornecedor · entrega {rel(p.previsao)}</div>
          : <div className={`ent${late ? " late" : ""}`}>Entrega prevista para: {rel(p.previsao)}{late ? " · atrasada" : ""}</div>}
        <div className="val"><b className="num">{money(valorDe(p))}</b>
          {p.tipo === "RC" && p.saldo != null && Math.abs((p.saldo ?? 0) - p.valor) > 0.005 && <span className="faint" title="Saldo a comprar / valor original">saldo de {money(p.valor)}</span>}
          <span className="muted">{cond}</span>
</div>
        {p.tipo === "PC" && (p.etapa === "10" || p.etapa === "15") && p.aprov === "aprovado" && (p.aprovEm || p.aprovPor) &&
          <div className="ent">{p.aprovEm ? dBR(p.aprovEm.slice(0, 10), true) : ""}{p.aprovPor ? ` por ${p.aprovPor.split("@")[0]}` : ""}</div>}
        {p.tipo === "PC" && (p.etapa === "10" || p.etapa === "15") && p.aprov !== "aprovado" &&
          <div className="ent"><button className="btn sm ok" style={{ height: 24, padding: "0 10px", fontSize: 11.5 }}
            onClick={(ev) => { ev.stopPropagation(); aprovar([p.id]); }}>✓ Aprovar</button></div>}
        {p.enviadoEm && p.tipo === "PC" && p.etapa === "35" ? <div className="ent">✉ {dBR(p.enviadoEm.slice(0, 10), true)}
          {p.enviadoMeio === "whatsapp" ? " · WhatsApp" : p.enviadoMeio === "email" ? " · e-mail" : ""}</div> : null}
        {nfSug[p.id] ? <div className="ent"><span className="pill p-sky">📄 NF chegou pela Focus</span><span className="faint">confira no recebimento</span></div> : null}
        {p.tipo === "RC"
          ? <div className="ent">{p.cobPcs?.length ? <><span className="pill p-sky">{p.cobDone}/{p.cobTotal} itens atendidos{p.parciais ? ` · ${p.parciais} parcial` : ""}</span> {p.cobPcs.map((n) => "PC " + n).join(", ")}</> : <span className="faint">Nenhum item comprado ainda</span>}</div>
          : p.rcs?.length ? <div className="ent">⇠ atende {p.rcs.map((n) => "RC " + n).join(", ")}</div> : null}
        <div className="meta">
          {p.proj && <span className="tag" title="Projeto">{p.proj}</span>}
          {p.comprador && <span className="tag" title="Comprador">👤 {p.comprador}</span>}
          {p.pv && <span className="tag" title="Venda de origem">↔ {p.pv}{p.pvCliente ? " · " + p.pvCliente : ""}</span>}
          <span className={`tag ${p.origem === "omie" ? "orig-omie" : "orig-painel"}`}>{p.origem === "omie" ? "Omie (histórico)" : "Painel"}</span>
        </div>
      </article>
    );
  };

  const projetos = useMemo(() => [...new Set(todos.map((p) => p.proj).filter(Boolean) as string[])].sort(), [todos]);
  const compradores = useMemo(() => [...new Set(todos.map((p) => p.comprador).filter(Boolean) as string[])].sort(), [todos]);
  /* Recebe: pedido em Aprovação/Faturado; também em "Pedido de Compra" quando
     a NF já chegou pela Focus ou ele já está aprovado. Do painel, só aprovado. */
  const podeReceber = (p: PedidoLista) => p.tipo === "PC" && (["15", "35", "40"].includes(p.etapa) ||
    (p.etapa === "10" && (!!nfSug[p.id] || p.aprov === "aprovado")));
  const candidatosReceb = todos.filter((p) => podeReceber(p) && (p.origem === "omie" || p.aprov === "aprovado"));

  return (
    <div className="cmp">
      <PaginaNavy>
        <CabecalhoTela area="Compras · Pedidos" titulo="Compras — Requisições e Pedidos"
          sub="Requisição → Pedido de Compra → Aprovação → Faturado pelo Fornecedor → Recebido → Conferido. Arraste os cartões para mudar de etapa. Pedidos novos nascem aqui; os do Omie ficam como histórico."
          acoes={<>
            <div className="seg">
              <button className={view === "kanban" ? "on" : ""} onClick={() => { setView("kanban"); lsSet("cmp-view", "kanban"); }}>▦ Kanban</button>
              <button className={view === "tabela" ? "on" : ""} onClick={() => { setView("tabela"); lsSet("cmp-view", "tabela"); }}>☰ Tabela</button>
            </div>
            <div style={{ position: "relative" }}>
              <button className="btn pri" data-menu onClick={(e) => { e.stopPropagation(); setMenuNovo((v) => !v); }}>＋ Incluir ▾</button>
              {menuNovo && (
                <div className="dropdown abs" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => { setMenuNovo(false); setFolha({ id: null, tipo: "RC" }); }}>📝<span><b>Nova Requisição</b><small>Pedido interno, sem fornecedor obrigatório</small></span></button>
                  <button onClick={() => { setMenuNovo(false); setFolha({ id: null, tipo: "PC" }); }}>🧾<span><b>Novo Pedido de Compra</b><small>Fornecedor + categoria obrigatórios</small></span></button>
                  <button onClick={() => { setMenuNovo(false); setReceb({ id: null }); }}>📦<span><b>Novo Recebimento</b><small>Registrar NF-e/chegada de um pedido</small></span></button>
                </div>
              )}
            </div>
          </>} />

        {erro && <Aviso>Não carregou: {erro}</Aviso>}

        <div className="filtros">
          <select className="sel" value={comprador} onChange={(e) => setComprador(e.target.value)} aria-label="Comprador">
            <option value="">Todos os compradores</option>{compradores.map((c) => <option key={c}>{c}</option>)}</select>
          <select className="sel" value={projeto} onChange={(e) => setProjeto(e.target.value)} aria-label="Projeto">
            <option value="">Todos os projetos</option>{projetos.map((c) => <option key={c}>{c}</option>)}</select>
          <select className="sel" value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
            <option value="">Todos os períodos</option><option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select>
          <select className="sel" value={historico} aria-label="Histórico carregado" title="Quanto do histórico do Omie carregar"
            onChange={(e) => { setHistorico(e.target.value); lsSet("cmp-historico", e.target.value); setLista(null); }}>
            <option value="365">Histórico: último ano</option><option value="1095">Histórico: 3 anos</option><option value="todos">Histórico: tudo</option></select>
          <select className="sel" value={origem} onChange={(e) => setOrigem(e.target.value as "" | "painel" | "omie")} aria-label="Origem">
            <option value="">Todas as origens</option><option value="painel">Emitidos pela plataforma</option><option value="omie">Histórico do Omie</option></select>
          <button className={`chipf${soAtraso ? " on" : ""}`} onClick={() => setSoAtraso((v) => !v)}>⚠ Entrega atrasada{lista ? ` · ${atrasados.length}` : ""}</button>
          <button className={`chipf${soNf ? " on" : ""}`} style={soNf ? { borderColor: "#0EA5E9", color: "#0369A1", background: "color-mix(in srgb,#0EA5E9 14%,transparent)" } : undefined}
            onClick={() => setSoNf((v) => !v)}>📄 NF chegou (Focus){lista ? ` · ${comNf.length}` : ""}</button>
          {view === "tabela" && (
            <>
              <select className="sel" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Agrupar por">
                <option value="">Agrupar por: nada</option><option value="etapaNome">Etapa</option><option value="forn">Fornecedor</option>
                <option value="proj">Projeto</option><option value="comprador">Comprador</option><option value="situacao">Situação</option></select>
              {sel.size > 0 && <>
                <span className="muted">{sel.size} selecionado(s) · {money(selValor)}</span>
                <button className="btn ok" onClick={() => { aprovar(todos.filter((p) => sel.has(p.id) && p.tipo === "PC" && p.aprov !== "aprovado").map((p) => p.id)); setSel(new Set()); }}>✓ Aprovar selecionados</button>
              </>}
              <div style={{ position: "relative" }}>
                <button className="btn" data-menu onClick={(e) => { e.stopPropagation(); setMenuCols((v) => !v); }}>Colunas · {colsVis.length}/{COLS.length}</button>
                {menuCols && (
                  <div className="dropdown abs" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px" }}>
                      <b style={{ fontSize: 12 }}>Colunas</b>
                      <span><button className="linkbtn" style={{ display: "inline" }} onClick={() => { setCols(COLS.map((c) => c.k)); lsSet("cmp-cols", JSON.stringify(COLS.map((c) => c.k))); }}>todas</button>
                        <button className="linkbtn" style={{ display: "inline" }} onClick={() => { setCols(COLS_PADRAO); lsSet("cmp-cols", JSON.stringify(COLS_PADRAO)); }}>padrão</button></span>
                    </div>
                    <div className="colpick">{COLS.map((c) => (
                      <label key={c.k}><input type="checkbox" checked={cols.includes(c.k)} onChange={(e) => {
                        const n = COLS.map((x) => x.k).filter((k) => (k === c.k ? e.target.checked : cols.includes(k)));
                        setCols(n); lsSet("cmp-cols", JSON.stringify(n));
                      }} /> {c.l}</label>))}</div>
                  </div>
                )}
              </div>
            </>
          )}
          <div className="busca">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº, fornecedor, CNPJ, produto, PV/OS…" />
          </div>
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: -6 }}>
          {lista ? `${filtrados.length} de ${todos.length} registros${historico !== "todos" ? " (histórico do Omie limitado ao filtro acima)" : ""}` : ""}
        </div>

        {!lista && !erro && <Carregando texto="Carregando compras…" />}

        {lista && view === "kanban" && (
          <div className="board">
            {ETAPAS.filter((e) => e.cod !== "15").map((e) => {
              const ocultas = e.cod === "20" ? filtrados.filter((p) => p.etapa === "20" && rcAtendida(p)).length : 0;
              // Aprovação vive DENTRO da coluna Pedido de Compra (01/10/26): etapa 15 entra aqui
              const daColuna = (p: PedidoLista) => e.cod === "10" ? (p.etapa === "10" || p.etapa === "15") : p.etapa === e.cod;
              const itens = filtrados.filter((p) => daColuna(p) && !rcAtendida(p))
                .filter((p) => e.cod !== "10" || !filtroAprov || (filtroAprov === "aprovado" ? p.aprov === "aprovado" : p.aprov !== "aprovado"))
                .sort((a, b) => (b.emissao ?? "").localeCompare(a.emissao ?? "") || b.id - a.id);
              const lim = mais[e.cod] ?? LIMITE_COLUNA;
              return (
                <div key={e.cod} className="col" data-cod={e.cod} style={{ ["--c" as string]: e.cor }}
                  onDragOver={(ev) => { ev.preventDefault(); ev.currentTarget.classList.add("drop"); }}
                  onDragLeave={(ev) => ev.currentTarget.classList.remove("drop")}
                  onDrop={(ev) => { ev.preventDefault(); ev.currentTarget.classList.remove("drop");
                    const p = todos.find((x) => String(x.id) === ev.dataTransfer.getData("text/plain")); if (p) mover(p, e.cod); }}>
                  <div className="colh">
                    <div className="t"><b><span className="badge-n">{itens.length}</span>{e.nome}</b><span className="tot num">{money(soma(itens))}</span></div>
                    <span className="n">{ETAPA_AJUDA[e.cod] ?? (e.cod === "20" ? "saldo a comprar" : e.cod === "10" ? "pendente ou aprovado" : e.plural)}{ocultas ? ` · ${ocultas} atendida(s) ocultas` : ""}</span>
                    {e.cod === "10" && (() => {
                      const base = filtrados.filter((p) => (p.etapa === "10" || p.etapa === "15") && p.tipo === "PC");
                      const apr = base.filter((p) => p.aprov === "aprovado"), pen = base.filter((p) => p.aprov !== "aprovado");
                      return (
                        <div className="segap" role="tablist" aria-label="Aprovação">
                          {([["pendente", "⏳ Pendentes", pen], ["aprovado", "✓ Aprovados", apr]] as const).map(([k, l, arr]) => (
                            <button key={k} role="tab" aria-selected={filtroAprov === k} className={`${k}${filtroAprov === k ? " on" : ""}`}
                              title={filtroAprov === k ? "Clique de novo para ver os dois" : `Ver só os ${l.slice(2).toLowerCase()}`}
                              onClick={() => setFiltroAprov(filtroAprov === k ? "" : k)}>
                              <b>{l} {arr.length}</b><small>{money(soma(arr as PedidoLista[]))}</small></button>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <div className="cards">
                    {itens.slice(0, lim).map((p) => cartao(p))}
                    {itens.length > lim && <button className="btn sm ghost" onClick={() => setMais((m) => ({ ...m, [e.cod]: lim + LIMITE_COLUNA }))}>
                      Mostrar mais {Math.min(LIMITE_COLUNA, itens.length - lim)} de {itens.length - lim}</button>}
                    {!itens.length && <div className="empty">Nenhum registro nesta etapa</div>}
                  </div>
                  {e.cod === "20" && <div className="colf"><button className="btn sm" onClick={() => setFolha({ id: null, tipo: "RC" })}>＋ Nova Requisição</button></div>}
                  {e.cod === "10" && <div className="colf"><button className="btn sm" onClick={() => setFolha({ id: null, tipo: "PC" })}>＋ Novo Pedido de Compra</button></div>}
                  {e.cod === "35" && <div className="colf"><span className="hint" style={{ display: "block", textAlign: "center" }}>Arraste um pedido aprovado para cá para enviar</span></div>}
                  {e.cod === "60" && <div className="colf"><button className="btn sm" onClick={() => setReceb({ id: null })}>＋ Novo Recebimento</button></div>}
                </div>
              );
            })}
          </div>
        )}

        {lista && view === "tabela" && (
          <div className="tbl-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ width: 34 }}><input type="checkbox" aria-label="Selecionar todos"
                    checked={tabelaLinhas.length > 0 && tabelaLinhas.every((p) => sel.has(p.id))}
                    onChange={(e) => setSel((s) => { const n = new Set(s); tabelaLinhas.forEach((p) => (e.target.checked ? n.add(p.id) : n.delete(p.id))); return n; })} /></th>
                  {colsVis.map((c) => (
                    <th key={c.k} className={c.r ? "r" : ""} onClick={() => setSort((s) => (s.k === c.k ? { k: c.k, dir: (-s.dir) as 1 | -1 } : { k: c.k, dir: 1 }))}>
                      {c.l} {sort.k === c.k ? (sort.dir > 0 ? "↑" : "↓") : ""}</th>
                  ))}
                  <th style={{ width: 70 }} />
                </tr>
                <tr className="flt"><th />{colsVis.map((c) => (
                  <th key={c.k}><input value={colf[c.k] ?? ""} placeholder="filtrar" aria-label={`Filtrar ${c.l}`}
                    onChange={(e) => setColf((f) => ({ ...f, [c.k]: e.target.value }))} /></th>))}<th /></tr>
              </thead>
              <tbody>
                {(() => {
                  const linha = (p: PedidoLista) => (
                    <tr key={p.id} className={sel.has(p.id) ? "chk" : ""} onClick={(e) => {
                      if ((e.target as HTMLElement).matches("input[type=checkbox]")) return; setFolha({ id: p.id }); }}>
                      <td><input type="checkbox" aria-label="Selecionar" checked={sel.has(p.id)}
                        onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} /></td>
                      {colsVis.map((c) => (
                        <td key={c.k} className={`${c.r ? "r" : ""}${c.tr ? " trunc" : ""}`} title={c.tr ? String(c.v(p) ?? "") : undefined}>
                          {c.h ? c.h(p) : String(c.v(p) ?? "")}</td>))}
                      <td style={{ whiteSpace: "nowrap" }}>
                        {p.tipo === "PC" && <button className="btn sm ghost" title="Imprimir / PDF / enviar ao fornecedor" onClick={(e) => { e.stopPropagation(); setEnviar(p.id); }}>🖨</button>}
                        <button className="kebab" aria-label="Ações" onClick={(e) => { e.stopPropagation(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setCtx({ p, x: Math.min(r.left - 200, window.innerWidth - 250), y: Math.min(r.bottom + 4, window.innerHeight - 380) }); }}>⋮</button>
                      </td>
                    </tr>
                  );
                  if (!tabelaLinhas.length) return <tr><td colSpan={colsVis.length + 2} className="empty">Nenhum registro encontrado</td></tr>;
                  if (!group) return tabelaLinhas.slice(0, 2000).map(linha);
                  const g: Record<string, PedidoLista[]> = {};
                  tabelaLinhas.forEach((p) => {
                    const key = (group === "etapaNome" ? ETAPA[p.etapa]?.nome : group === "situacao" ? situacao(p)
                      : (p as unknown as Record<string, string | undefined>)[group]) || "(vazio)";
                    (g[key] = g[key] ?? []).push(p);
                  });
                  return Object.entries(g).sort((a, b) => b[1].length - a[1].length).flatMap(([key, arr]) => [
                    <tr key={"g" + key} className="grp"><td /><td colSpan={colsVis.length}>{key} · {arr.length} · <span className="num">{money(soma(arr))}</span></td></tr>,
                    ...arr.map(linha),
                  ]);
                })()}
              </tbody>
              <tfoot><tr><td />{colsVis.map((c, i) => (
                <td key={c.k} className={c.r ? "r" : ""}>{c.sum ? <span className="num">Σ {money(tabelaLinhas.reduce((a, p) => a + (Number(c.v(p)) || 0), 0))}</span>
                  : i === 0 ? `${tabelaLinhas.length} registros${tabelaLinhas.length > 2000 && !group ? " (2.000 à vista)" : ""}` : ""}</td>))}<td /></tr></tfoot>
            </table>
          </div>
        )}
      </PaginaNavy>

      {ctx && (() => {
        const p = ctx.p;
        const it: [string, string, boolean?][] = [["open", "Abrir"], ["dup", p.tipo === "RC" ? "Duplicar Requisição" : "Duplicar Pedido"]];
        if (p.etapa === "20") it.push(["gerar", "Gerar Pedido de Compra"]);
        if (p.tipo === "PC" && p.etapa === "10" && p.aprov === "nao_solicitada") it.push(["solic", "Solicitar aprovação"]);
        if (p.tipo === "PC" && ["15", "10"].includes(p.etapa) && p.aprov === "aprovado") it.push(["enviar", "Enviar ao fornecedor (e-mail / marcar)"]);
        if (["10", "15"].includes(p.etapa) && p.tipo === "PC" && p.aprov !== "aprovado") it.push(["aprovar", "Aprovar"]);
        if (podeReceber(p)) it.push(["receb", nfSug[p.id] ? "Registrar recebimento (NF chegou)" : "Registrar recebimento"]);
        if (p.etapa === "60") it.push(["conf", "Marcar como conferido"]);
        if (p.tipo === "PC") it.push(["print", "Imprimir / PDF para fornecedor"]);
        if (p.tipo === "RC") it.push(["venda", p.pv ? "Trocar venda vinculada" : "Vincular à venda (PV/OS)"]);
        it.push(["cancel", p.tipo === "RC" ? "Cancelar requisição" : "Cancelar pedido", p.origem !== "painel"]);
        const info = [p.contato && `👤 ${p.contato}`, p.proj && `📁 ${p.proj}`, p.cnpj && `🏷 ${p.cnpj}`].filter(Boolean) as string[];
        return (
          <div className="dropdown" style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
            {it.map(([k, l, off]) => <button key={k} disabled={off} title={off ? "Pedido do Omie (histórico): só leitura" : undefined} onClick={() => ctxAct(k, p)}>{l}</button>)}
            {info.length > 0 && <div style={{ borderTop: "1px solid var(--line)", margin: "4px 0", padding: "6px 10px", fontSize: 12, color: "var(--tx-3)", display: "grid", gap: 3 }}>
              {info.map((x) => <div key={x}>{x}</div>)}</div>}
          </div>
        );
      })()}

      {confirma && (
        <div className="cmp-scrim" style={{ justifyContent: "center", alignItems: "center", zIndex: 100 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirma(null); }}>
          <div className="card2" style={{ width: "min(420px,92vw)", display: "grid", gap: 12 }} role="dialog" aria-modal="true">
            <b>{confirma.texto}</b>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => setConfirma(null)}>Voltar</button>
              <button className="btn pri" onClick={async () => { const c = confirma; setConfirma(null); try { await c.acao(); } catch (e) { toast((e as Error).message, true); } }}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {folha && (
        <FolhaPedido key={`${folha.id}-${folha.tipo}-${folha.fromRC}`} id={folha.id} tipoNovo={folha.tipo} fromRC={folha.fromRC}
          refs={refs} emp={emp} toast={toast} onClose={() => setFolha(null)}
          onSalvo={(id, msg, abrirPcDaRc) => {
            if (msg) toast(msg);
            carregar();
            if (abrirPcDaRc) setFolha({ id: null, tipo: "PC", fromRC: abrirPcDaRc }); else setFolha(null);
            void id;
          }}
          onReceber={(id) => { setFolha(null); setReceb({ id }); }}
          onDuplicar={(id) => { setFolha(null); duplicar(id); }}
          onImprimir={(id) => { setFolha(null); setEnviar(id); }} />
      )}
      {receb && (
        <FolhaRecebimento id={receb.id} candidatos={candidatosReceb} toast={toast} onClose={() => setReceb(null)}
          onFeito={(m) => { setReceb(null); toast(m); carregar(); }} />
      )}
      {enviar != null && <ModalEnviar id={enviar} toast={toast} onClose={() => setEnviar(null)}
        onEnviado={(m) => { setEnviar(null); toast(m); carregar(); }} />}
      {toastMsg && <div className={`cmp-toast${toastMsg.erro ? " erro" : ""}`} role="status">{toastMsg.m}</div>}
    </div>
  );
}
