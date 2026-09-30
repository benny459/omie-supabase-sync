"use client";

/**
 * Operação — Avulsos, Projetos e PCs Standalone no desenho do mockup de
 * 30/09/2026 (web/docs/mockups/avulsos-mockup-2026-09-30.html).
 *
 * O que o mockup muda, e que esta tela implementa:
 *   • Edição deixa de ser um modo: em Lista, Tabela e Kanban aprova/recusa,
 *     nº do PC e previsão mudam direto na linha. Recusar abre o motivo.
 *   • Barra de topo em 4 blocos: busca · período · Filtros (Venda × Compra
 *     num painel só) · modo de visualização; filtros ativos viram tokens.
 *   • Visões rápidas (Minha aprovação, Atrasados, Sem PC, Com alarme).
 *   • Em aberto × Faturados × Todos nas abas do topo.
 *   • Fases com nome e a etapa travada + próximo passo; RC · PC · PV · M.B.
 *   • Seleção em massa com barra flutuante; sync/exportar/log em menus.
 *
 * Os KPIs são os de antes (KpisNavy) — decisão do Benny.
 * Toda gravação passa por lib/approvals-write (mesmos caminhos da grade
 * antiga). A grade antiga continua em ?classica=1 até a conferência final.
 */

import "./operacao.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STATUS_META } from "@/lib/columns";
import { useUserPerms } from "../UserPermsProvider";
import { canApprove, canEdit, canReleasePv, canViewValues } from "@/lib/permissions";
import {
  montarPedido, fases, financeiro, passa, noEscopo, dataMs, diasAte, dBR, isoDia, brl, pct,
  ESTADO_LABEL, FILTRO_LABEL,
  type Compra, type Escopo, type Estado, type Filtros, type Pedido, type Periodo, type Rapida,
} from "@/lib/operacao-modelo";
import { mudarStatus, mudarStatusEmMassa, salvarCampo, CAMPOS, type Modulo } from "@/lib/approvals-write";
import { buildBuckets, BucketTotals, projetoDoBucket, LinkAbrirProjeto, type Bucket, type BudgetSummary } from "../BoldAvulsosView";
import KpisNavy from "../navy/KpisNavy";
import LinhaDoTempo from "../navy/LinhaDoTempo";
import AddRowButton from "../AddRowButton";
import RcExcelDropZone from "../RcExcelDropZone";
import SyncNowButton from "../SyncNowButton";
import PcsExcluidosButton, { type PcEscondido } from "../PcsExcluidosButton";
import { AtribuicaoModal } from "../AtribuirClienteView";
import { supaBrowser } from "@/lib/supabase";
import GradeOperacao from "./GradeOperacao";

type AnyRow = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "").trim();

/** Status que dá para escolher na linha — os códigos reais do painel. */
export const OPCOES_STATUS: { v: string; l: string; admin?: boolean }[] = [
  { v: "PENDENTE", l: "Aguarda aprovação" },
  { v: "APROVADO", l: "Aprovado" },
  { v: "APROVADO_FAT_DIRETO", l: "Aprovado fat. direto" },
  { v: "NAO_APROVADO", l: "Recusado" },
  { v: "REJEITADO_VALIDADE", l: "Rejeitado por validade" },
  { v: "PRE_SELECAO", l: "Pré-seleção" },
  { v: "N_A", l: "N/A" },
  { v: "CANCELAR_PEDIDO", l: "Cancelar pedido", admin: true },
];
export const RECUSAS = new Set(["NAO_APROVADO", "REJEITADO_VALIDADE", "CANCELAR_PEDIDO"]);

type Vista = "lista" | "tabela" | "kanban" | "tempo";
type Toast = { msg: string; desfazer?: () => void; erro?: boolean } | null;
type Visao = { nome: string; escopo: Escopo; periodo: Periodo; filtros: Filtros; rapida: Rapida; q: string };

export default function TelaOperacao({ modulo, title, rows: rowsIniciais }: {
  modulo: Modulo; title: string; rows: AnyRow[];
}) {
  const user = useUserPerms();
  const podeAprovar = canApprove(user, modulo);
  const podeEditar = canEdit(user, modulo, "rc") || canEdit(user, modulo, "pc");
  const ehAdmin = !!(user?.is_admin || user?.role === "admin");
  const podeLiberar = canReleasePv(user);
  const verValores = canViewValues(user, modulo);
  const $ = useCallback((v: number | null | undefined) => (verValores ? brl(v) : "R$ •••"), [verValores]);

  // ── estado da tela ────────────────────────────────────────────────────
  const [escopo, setEscopo] = useState<Escopo>("aberto");
  const [q, setQ] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("tudo");
  const [filtros, setFiltros] = useState<Filtros>({});
  const [rapida, setRapida] = useState<Rapida>("todos");
  const [vista, setVista] = useState<Vista>("lista");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [patches, setPatches] = useState<Map<string, AnyRow>>(new Map());
  const [toast, setToast] = useState<Toast>(null);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [painelFiltro, setPainelFiltro] = useState(false);
  const [menu, setMenu] = useState<"mais" | "export" | null>(null);
  const [logAberto, setLogAberto] = useState(false);
  const [visoes, setVisoes] = useState<Visao[]>([]);
  const [limite, setLimite] = useState(120);
  const buscaRef = useRef<HTMLInputElement>(null);
  const chaveLS = `op:${modulo}`;

  useEffect(() => {
    try {
      const v = localStorage.getItem(`${chaveLS}:vista`) as Vista | null;
      if (v && ["lista", "tabela", "kanban", "tempo"].includes(v)) setVista(v);
      const vs = JSON.parse(localStorage.getItem(`${chaveLS}:visoes`) ?? "[]");
      if (Array.isArray(vs)) setVisoes(vs);
    } catch { /* sem storage */ }
  }, [chaveLS]);
  const trocarVista = (v: Vista) => { setVista(v); try { localStorage.setItem(`${chaveLS}:vista`, v); } catch { /* */ } };

  // ⌘K / Ctrl+K foca a busca.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); buscaRef.current?.focus(); }
      if (e.key === "Escape") { setPainelFiltro(false); setMenu(null); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const mostrar = useCallback((t: Toast) => {
    setToast(t);
    if (t) setTimeout(() => setToast((x) => (x === t ? null : x)), t.erro ? 9000 : 6000);
  }, []);

  // ── dados ─────────────────────────────────────────────────────────────
  const rows = useMemo(() => rowsIniciais.map((r) => {
    const p = patches.get(`${s(r.empresa)}|${s(r.ncod_ped)}`);
    return p ? { ...r, ...p } : r;
  }), [rowsIniciais, patches]);
  const aplicar = useCallback((key: string, patch: AnyRow) =>
    setPatches((m) => { const n = new Map(m); n.set(key, { ...(n.get(key) ?? {}), ...patch }); return n; }), []);

  const groupBy = modulo === "projetos" ? "project" : modulo === "pcs" ? "pc" : "pvos";
  const buckets = useMemo(() => buildBuckets(rows, groupBy), [rows, groupBy]);
  const pedidos = useMemo(() => buckets.map((b) => montarPedido(b as never, modulo)), [buckets, modulo]);
  const porId = useMemo(() => new Map(pedidos.map((p) => [p.id, p])), [pedidos]);
  const bucketPorId = useMemo(() => new Map(buckets.map((b) => [b.pv_os_label, b])), [buckets]);

  // Liberação (só Avulsos) e atribuição de cliente (só PCs) — como na grade antiga.
  const [liberacao, setLiberacao] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (modulo !== "avulsos") return;
    fetch("/api/avulsos/liberacao", { cache: "no-store" }).then((r) => r.json())
      .then((j) => setLiberacao(new Set(Object.keys(j.map ?? {})))).catch(() => {});
  }, [modulo]);
  type Atrib = { soma_pct: number; clientes: { codigo_cliente_omie: number; nome: string; percentual: number }[] };
  const [atrib, setAtrib] = useState<Map<string, Atrib>>(new Map());
  const [atribTick, setAtribTick] = useState(0);
  const [atribEdit, setAtribEdit] = useState<Parameters<typeof AtribuicaoModal>[0]["pc"] | null>(null);
  useEffect(() => {
    if (modulo !== "pcs") return;
    fetch("/api/pcs/atribuicao", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      const m = new Map<string, Atrib>();
      for (const p of j.atribuidos ?? []) m.set(`${p.empresa}|${p.pc_numero}`, {
        soma_pct: Number(p.soma_pct ?? 0),
        clientes: (p.clientes ?? []).map((c: { codigo_cliente_omie: number; nome?: string; percentual: number }) =>
          ({ codigo_cliente_omie: c.codigo_cliente_omie, nome: c.nome ?? `Omie #${c.codigo_cliente_omie}`, percentual: Number(c.percentual) })),
      });
      setAtrib(m);
    }).catch(() => {});
  }, [modulo, atribTick]);
  const [budgetMap, setBudgetMap] = useState<Map<string, BudgetSummary>>(new Map());
  useEffect(() => {
    if (modulo !== "projetos") return;
    const keys = new Set<string>();
    for (const r of rowsIniciais) {
      const emp = s(r.empresa), cod = Number(r.codigo_projeto ?? r.pv_codigo_projeto ?? 0);
      if (emp && cod > 0) keys.add(`${emp}|${cod}`);
    }
    if (!keys.size) return;
    fetch(`/api/rc-projetos/budget/summary?keys=${encodeURIComponent([...keys].join(","))}`).then((r) => r.json()).then((j) => {
      const m = new Map<string, BudgetSummary>();
      for (const row of j.rows ?? []) m.set(row.key, row);
      setBudgetMap(m);
    }).catch(() => {});
  }, [modulo, rowsIniciais]);
  const [escondidos, setEscondidos] = useState<PcEscondido[]>([]);
  const carregarEscondidos = useCallback(() => {
    fetch("/api/pcs/excluir", { cache: "no-store" }).then((r) => r.json())
      .then((j) => setEscondidos(j.linhas ?? j.rows ?? [])).catch(() => {});
  }, []);
  useEffect(() => { carregarEscondidos(); }, [carregarEscondidos]);

  // ── filtros ───────────────────────────────────────────────────────────
  const noScope = useMemo(() => pedidos.filter((p) => noEscopo(p, escopo)), [pedidos, escopo]);
  const contagem = useMemo(() => {
    const soma = (a: Pedido[]) => a.reduce((x, p) => x + p.valorPv, 0);
    const ab = pedidos.filter((p) => !p.faturado), fa = pedidos.filter((p) => p.faturado);
    return { aberto: [ab.length, soma(ab)], faturado: [fa.length, soma(fa)], todos: [pedidos.length, soma(pedidos)] } as const;
  }, [pedidos]);
  const temFiltroCompra = !!(filtros.estado || filtros.fornecedor || filtros.categoria) || rapida === "minha" || rapida === "sem_pc";
  const visiveis = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const out: { p: Pedido; compras: Compra[] }[] = [];
    for (const p of noScope) {
      const cs = p.compras.filter((c) => passa(p, c, qq, periodo, filtros, rapida));
      if (cs.length) out.push({ p, compras: cs });
      else if (!p.compras.length && !temFiltroCompra && passa(p, null, qq, periodo, filtros, rapida)) out.push({ p, compras: [] });
    }
    return out;
  }, [noScope, q, periodo, filtros, rapida, temFiltroCompra]);
  const opcoes = useMemo(() => {
    const uniq = (a: string[]) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, "pt-BR"));
    return {
      tipo: uniq(noScope.map((p) => p.tipo)),
      etapaVenda: uniq(noScope.map((p) => p.etapaVenda)),
      projeto: ["Sem projeto", ...uniq(noScope.map((p) => p.projeto))],
      fornecedor: uniq(noScope.flatMap((p) => p.compras.map((c) => c.fornecedor))),
      categoria: uniq(noScope.flatMap((p) => p.compras.map((c) => c.categoria))),
    };
  }, [noScope]);
  const rapidas = useMemo(() => {
    const it = noScope.flatMap((p) => p.compras);
    return {
      todos: noScope.length,
      minha: it.filter((c) => c.estado === "pendente").length,
      atrasados: noScope.filter((p) => p.flags.some((f) => f.tom === "r" && f.t.includes("atraso"))).length,
      sem_pc: it.filter((c) => c.estado === "sem_pc").length,
      alarme: noScope.filter((p) => p.flags.some((f) => f.t !== "sem PC")).length,
    };
  }, [noScope]);
  const fila = useMemo(() => noScope.flatMap((p) => p.compras.filter((c) => c.estado === "pendente")), [noScope]);
  const nFiltros = Object.values(filtros).filter(Boolean).length;

  const salvarVisao = () => {
    const nome = window.prompt("Nome desta visão:");
    if (!nome?.trim()) return;
    const nv = [...visoes.filter((v) => v.nome !== nome.trim()), { nome: nome.trim(), escopo, periodo, filtros, rapida, q }];
    setVisoes(nv);
    try { localStorage.setItem(`${chaveLS}:visoes`, JSON.stringify(nv)); } catch { /* */ }
  };
  const aplicarVisao = (v: Visao) => { setEscopo(v.escopo); setPeriodo(v.periodo); setFiltros(v.filtros); setRapida(v.rapida); setQ(v.q); };
  const removerVisao = (nome: string) => {
    const nv = visoes.filter((v) => v.nome !== nome);
    setVisoes(nv);
    try { localStorage.setItem(`${chaveLS}:visoes`, JSON.stringify(nv)); } catch { /* */ }
  };

  // ── ações ─────────────────────────────────────────────────────────────
  const compraPorKey = useMemo(() => {
    const m = new Map<string, Compra>();
    for (const p of pedidos) for (const c of p.compras) m.set(c.key, c);
    return m;
  }, [pedidos]);

  const setStatus = useCallback(async (c: Compra, status: string) => {
    if (!podeAprovar) { mostrar({ msg: "Sem permissão para aprovar neste módulo.", erro: true }); return; }
    const antes = c.statusCodigo;
    aplicar(c.key, { status });
    const r = await mudarStatus(c.row, status, modulo);
    if (!r.ok) {
      aplicar(c.key, { status: antes });
      mostrar({ msg: `Não gravou (${c.pc ? `PC ${c.pc}` : c.desc}): ${r.erro}`, erro: true });
      return;
    }
    const rot = OPCOES_STATUS.find((o) => o.v === status)?.l ?? status;
    mostrar({
      msg: `${c.pedidoId} · ${c.desc}: ${rot.toLowerCase()}`,
      desfazer: async () => {
        aplicar(c.key, { status: antes });
        const u = await mudarStatus(c.row, antes || "PENDENTE", modulo);
        if (!u.ok) mostrar({ msg: `Não desfez: ${u.erro}`, erro: true });
      },
    });
    if (RECUSAS.has(status) && !c.justificativa) setTimeout(() => document.getElementById(`jr-${c.key}`)?.focus(), 40);
  }, [aplicar, modulo, mostrar, podeAprovar]);

  const gravar = useCallback(async (c: Compra, campo: keyof typeof CAMPOS, valor: unknown, patch: AnyRow) => {
    const def = CAMPOS[campo] as { campo: string; historico?: boolean };
    const antes: AnyRow = Object.fromEntries(Object.keys(patch).map((k) => [k, c.row[k]]));
    aplicar(c.key, patch);
    const erro = await salvarCampo(c.row, def.campo, valor, modulo, { historico: def.historico });
    if (erro) { aplicar(c.key, antes); mostrar({ msg: `Não gravou: ${erro}`, erro: true }); return false; }
    return true;
  }, [aplicar, modulo, mostrar]);

  const selCompras = useMemo(() => [...sel].map((k) => compraPorKey.get(k)).filter(Boolean) as Compra[], [sel, compraPorKey]);
  const emMassa = async (status: string, lista?: Compra[]) => {
    const alvo = (lista ?? selCompras).filter((c) => c.temPc);
    if (!alvo.length) { mostrar({ msg: "Nenhuma das selecionadas tem PC — sem PC não há o que aprovar.", erro: true }); return; }
    const antes = new Map(alvo.map((c) => [c.key, c.statusCodigo]));
    for (const c of alvo) aplicar(c.key, { status });
    const r = await mudarStatusEmMassa(alvo.map((c) => c.row), status, modulo);
    for (const f of r.falhas) aplicar(`${s(f.row.empresa)}|${s(f.row.ncod_ped)}`, { status: antes.get(`${s(f.row.empresa)}|${s(f.row.ncod_ped)}`) });
    setSel(new Set());
    mostrar(r.falhas.length
      ? { msg: `${r.ok} gravada(s) · ${r.falhas.length} recusada(s) pelo servidor: ${r.falhas[0].erro}`, erro: true }
      : { msg: `${r.ok} compra(s): ${OPCOES_STATUS.find((o) => o.v === status)?.l.toLowerCase()}`,
          desfazer: async () => {
            for (const c of alvo) aplicar(c.key, { status: antes.get(c.key) });
            await Promise.all(alvo.map((c) => mudarStatus(c.row, antes.get(c.key) || "PENDENTE", modulo)));
          } });
  };
  const previsaoEmMassa = async (iso: string) => {
    const alvo = selCompras.filter((c) => c.temPc && c.estado !== "recebido");
    let ok = 0;
    for (const c of alvo) if (await gravar(c, "prevMateriais", iso, { nova_prev_materiais: iso })) ok++;
    setSel(new Set());
    mostrar({ msg: `Previsão ${dBR(dataMs(iso))} em ${ok} compra(s)` });
  };
  const esconderPcs = async () => {
    const alvo = selCompras.filter((c) => c.pc);
    const empresas = new Set(alvo.map((c) => s(c.row.empresa)));
    if (!alvo.length) return;
    if (empresas.size > 1) { mostrar({ msg: "Esconda PCs de uma empresa por vez.", erro: true }); return; }
    const motivo = window.prompt(`Esconder ${alvo.length} PC(s) da lista? Motivo (opcional):`);
    if (motivo === null) return;
    const r = await fetch("/api/pcs/excluir", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "exclude", empresa: [...empresas][0], pcs: [...new Set(alvo.map((c) => c.pc))], motivo }) });
    if (!r.ok) { mostrar({ msg: `Não escondeu: ${(await r.json().catch(() => ({}))).error ?? r.statusText}`, erro: true }); return; }
    window.location.reload();
  };
  const apagarManuais = async () => {
    const alvo = selCompras.filter((c) => Number(c.row.ncod_ped) < 0);
    if (!alvo.length || !window.confirm(`Apagar ${alvo.length} linha(s) manual(is)? Linhas do Omie não são apagadas.`)) return;
    const r = await fetch("/api/approvals/batch-delete", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: alvo.map((c) => ({ empresa: c.row.empresa, ncod_ped: c.row.ncod_ped })) }) });
    if (!r.ok) { mostrar({ msg: `Não apagou: ${(await r.json().catch(() => ({}))).error ?? r.statusText}`, erro: true }); return; }
    window.location.reload();
  };
  const toggleSel = (k: string) => setSel((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleAberto = (id: string) => setAbertos((x) => { const n = new Set(x); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const liberar = async (p: Pedido) => {
    const vai = !liberacao.has(p.id);
    setLiberacao((x) => { const n = new Set(x); if (vai) n.add(p.id); else n.delete(p.id); return n; });
    const r = await fetch("/api/avulsos/liberacao", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pv_os_label: p.id, empresa: s(p.bucket.rows[0]?.empresa) || "SF", aguardando: vai }) });
    if (!r.ok) mostrar({ msg: "Não gravou a liberação.", erro: true });
  };
  const excluirPv = async (p: Pedido) => {
    if (!window.confirm(`Tirar ${p.id} da lista (fica no Omie)?`)) return;
    const motivo = window.prompt("Motivo (opcional):") ?? "";
    const r = await fetch("/api/admin/exclude-pv-os", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "exclude", empresa: s(p.bucket.rows[0]?.empresa) || "SF", pv_os_label: p.id, motivo }) });
    if (!r.ok) { mostrar({ msg: "Não excluiu.", erro: true }); return; }
    window.location.reload();
  };
  const abrirAtrib = (c: Compra) => {
    const r = c.row, info = atrib.get(`${s(r.empresa)}|${c.pc}`);
    setAtribEdit({
      empresa: s(r.empresa) || "SF", pc_numero: c.pc, valor_total: String(r.valor_total ?? "0"),
      projeto_nome: (r.projeto_nome as string | null) ?? null, _dt_inclusao_d: s(r._dt_inclusao_d),
      codigo_projeto: r.codigo_projeto != null ? Number(r.codigo_projeto) : null,
      clientes: info?.clientes, soma_pct: info?.soma_pct,
    });
  };

  // ── render ────────────────────────────────────────────────────────────
  const rotulo = modulo === "projetos" ? "projeto" : modulo === "pcs" ? "PC" : "pedido";
  const nomeId = (p: Pedido) => (modulo === "pcs" ? `PC ${p.id}` : p.id);
  const kpiBuckets = useMemo(() => visiveis.map(({ p }) => p.bucket), [visiveis]);
  const totalCompras = visiveis.reduce((a, x) => a + x.compras.length, 0);
  const drawerCompra = drawer ? compraPorKey.get(drawer) ?? null : null;

  return (
    <div className="op op-wrap" onClick={() => { setMenu(null); }}>
      {/* ── cabeçalho ── */}
      <div className="top">
        <div>
          <div className="crumb">Operação › {title}</div>
          <h1>{title}</h1>
          <div className="sub">
            <span>{noScope.length} {rotulo === "PC" ? "PCs" : modulo === "projetos" ? "projetos" : "PV/OS"} · {noScope.reduce((a, p) => a + p.compras.length, 0)} compras</span>
            <span style={{ color: "var(--ww-border-strong)" }}>|</span>
            <SyncNowButton />
          </div>
        </div>
        <div className="hright" onClick={(e) => e.stopPropagation()}>
          {modulo === "avulsos" && (
            <div className="menu">
              <button className="btn" onClick={() => setMenu(menu === "export" ? null : "export")}>⤓ Exportar ▾</button>
              <div className={`pop ${menu === "export" ? "open" : ""}`}>
                <button onClick={() => { window.location.href = "/api/relatorios/avulsos-daily/pdf"; }}>📄 PDF do report</button>
                <button onClick={() => window.open("/relatorios/avulsos-daily", "_blank")}>📊 Report completo</button>
                <button onClick={() => { setMenu(null); void enviarWebex(mostrar); }}>📤 Enviar ao Webex</button>
              </div>
            </div>
          )}
          <div className="menu">
            <button className="btn ghost" title="Mais" onClick={() => setMenu(menu === "mais" ? null : "mais")}>•••</button>
            <div className={`pop ${menu === "mais" ? "open" : ""}`}>
              <div style={{ padding: "4px 6px" }}>
                <PcsExcluidosButton linhas={escondidos} onMudou={() => { carregarEscondidos(); }} />
                {escondidos.length === 0 && <span style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>🚫 PCs escondidos · 0</span>}
              </div>
              <button onClick={() => { setMenu(null); setLogAberto(true); }}>🕘 Log de alterações</button>
              <div className="sep" />
              <button onClick={() => { setMenu(null); trocarVista("tabela"); }}>⚙️ Colunas e preferências</button>
              <button onClick={() => { window.location.search = "?classica=1"; }}>↩ Tela antiga (conferência)</button>
            </div>
          </div>
        </div>
      </div>

      {/* ── escopo ── */}
      <div className="scope">
        {(["aberto", "faturado", "todos"] as const).map((k) => (
          <button key={k} className={`${escopo === k ? "on" : ""} ${k === "faturado" ? "fat" : ""}`} onClick={() => setEscopo(k)}>
            <span className="sl">{k === "faturado" ? "✓ Faturados" : k === "aberto" ? "Em aberto" : "Todos"} <b>{contagem[k][0]}</b></span>
            <small>{$(contagem[k][1])}{k === "aberto" ? " · não faturados" : k === "faturado" ? " · NF de saída emitida" : ""}</small>
          </button>
        ))}
      </div>
      {escopo !== "aberto" && (
        <div className="scopeNote">
          Mostrando <b>{escopo === "faturado" ? "somente faturados" : "em aberto + faturados"}</b> —{" "}
          <button className="linkbtn" onClick={() => setEscopo("aberto")}>voltar para em aberto</button>
        </div>
      )}

      {/* ── barra de topo: busca · período · filtros · vista ── */}
      <div className="toolbar" onClick={(e) => e.stopPropagation()}>
        <div className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input ref={buscaRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={modulo === "pcs" ? "Buscar PC, fornecedor ou descrição…" : "Buscar PV, OS, PC, cliente ou fornecedor…"} />
          <span className="kbd">⌘ K</span>
        </div>
        <div className="seg">
          {([["tudo", "Tudo"], ["7", "7 dias"], ["30", "30 dias"], ["vencidos", "Vencidos"]] as const).map(([k, l]) => (
            <button key={k} className={periodo === k ? "on" : ""} onClick={() => setPeriodo(k)}>{l}</button>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button className="btn" onClick={() => setPainelFiltro((x) => !x)}>
            ☰ Filtros {nFiltros > 0 && <span className="count">{nFiltros}</span>}
          </button>
          <PainelFiltros aberto={painelFiltro} filtros={filtros} opcoes={opcoes} modulo={modulo}
            onAplicar={(f) => { setFiltros(f); setPainelFiltro(false); }} onFechar={() => setPainelFiltro(false)} />
        </div>
        <div className="seg">
          {([["lista", "Lista"], ["tabela", "Tabela"], ["kanban", "Kanban"], ["tempo", "Linha do tempo"]] as const).map(([k, l]) => (
            <button key={k} className={vista === k ? "on" : ""} onClick={() => trocarVista(k)}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── visões rápidas + salvas ── */}
      <div className="qv">
        {([["todos", "Todos", rapidas.todos, ""], ["minha", "Minha aprovação", rapidas.minha, "var(--ww-warn)"],
           ["atrasados", "Atrasados", rapidas.atrasados, "var(--ww-crit)"], ["sem_pc", "Sem PC", rapidas.sem_pc, "var(--ww-text-faint)"],
           ["alarme", "Com alarme", rapidas.alarme, "var(--ww-violet)"]] as const)
          .filter(([k]) => !(modulo === "pcs" && k === "sem_pc"))
          .map(([k, l, n, cor]) => (
            <button key={k} className={`chip ${rapida === k ? "on" : ""}`} onClick={() => setRapida(k)}>
              {cor && <span className="pip" style={{ background: cor }} />}{l} <b>{n}</b>
            </button>
          ))}
        <span className="spacer" />
        <span style={{ color: "var(--ww-text-faint)", fontSize: 12, display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          Visões salvas ·
          {visoes.map((v) => (
            <span key={v.nome} className="token" style={{ height: 24 }}>
              <button className="linkbtn" style={{ color: "inherit", width: "auto" }} onClick={() => aplicarVisao(v)}>{v.nome}</button>
              <button title="Apagar visão" onClick={() => removerVisao(v.nome)}>✕</button>
            </span>
          ))}
          <button className="linkbtn" onClick={salvarVisao}>+ Salvar visão atual</button>
        </span>
      </div>
      {nFiltros > 0 && (
        <div className="tokens">
          {(Object.keys(filtros) as (keyof Filtros)[]).filter((k) => filtros[k]).map((k) => (
            <span key={k} className="token"><span>{FILTRO_LABEL[k]}:</span> {k === "estado" ? ESTADO_LABEL[filtros[k] as Estado] : filtros[k]}
              <button onClick={() => setFiltros((f) => ({ ...f, [k]: undefined }))}>✕</button></span>
          ))}
          <button className="linkbtn" onClick={() => setFiltros({})}>Limpar tudo</button>
        </div>
      )}

      {/* ── KPIs (os de antes) ── */}
      <div style={{ marginTop: 18 }}>
        <KpisNavy buckets={kpiBuckets} formatarValor={(v) => $(v)} rotuloPedido={rotulo} escopo={escopo === "faturado" ? "faturado" : escopo} />
      </div>

      {/* ── fila de aprovação ── */}
      {podeAprovar && fila.length > 0 && (
        <div className="banner">
          <div className="ic">!</div>
          <p>
            <b>{fila.length} compra{fila.length > 1 ? "s" : ""} aguardando sua aprovação</b> · {$(fila.reduce((a, c) => a + (c.pcValor ?? c.rcTotal), 0))}
            <small>
              {(() => { const d = fila.map((c) => c.aprovarAte).filter((x): x is number => x != null).sort((a, b) => a - b)[0];
                return d ? `Mais antiga vence em ${dBR(d)} — aprove direto na lista ou selecione várias.` : "Aprove direto na lista ou selecione várias."; })()}
            </small>
          </p>
          <button className="btn sm" onClick={() => { setRapida("minha"); trocarVista("lista"); }}>Revisar fila</button>
          <button className="btn sm ok" onClick={() => {
            if (!window.confirm(`Aprovar as ${fila.length} compras da fila? Cada uma passa pela mesma checagem de alçada e orçamento.`)) return;
            void emMassa("APROVADO", fila);
          }}>✓ Aprovar todas</button>
        </div>
      )}

      {/* ── cabeçalho da lista ── */}
      <div className="section-h">
        <span>
          {visiveis.length} {rotulo === "PC" ? "PCs" : `${rotulo}s`} · {totalCompras} compras
          {vista === "lista" && " · clique no pedido para abrir as compras"}
          <span className="legend"><i className="d" />concluído<i className="p" />em andamento<i className="l" />atrasado / bloqueado<i />não iniciado<i className="na" />não se aplica</span>
        </span>
        {(vista === "lista" || vista === "tabela") && (
          <span>
            <button className="linkbtn" onClick={() => setAbertos(new Set(visiveis.map((x) => x.p.id)))}>Expandir todos</button> ·{" "}
            <button className="linkbtn" onClick={() => setAbertos(new Set())}>Recolher</button>
          </span>
        )}
      </div>

      {visiveis.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--ww-text-faint)" }}>Nada com estes filtros.</div>
      )}

      {vista === "lista" && (
        <>
          {visiveis.slice(0, limite).map(({ p, compras }) => (
            <CartaoPedido key={p.id} p={p} compras={compras} modulo={modulo} aberto={abertos.has(p.id)}
              onToggle={() => toggleAberto(p.id)} nomeId={nomeId(p)} $={$}
              sel={sel} toggleSel={toggleSel} podeAprovar={podeAprovar} podeEditar={podeEditar} ehAdmin={ehAdmin}
              setStatus={setStatus} gravar={gravar} abrirDrawer={setDrawer} abrirAtrib={abrirAtrib} atrib={atrib}
              bucket={bucketPorId.get(p.id)} budgetMap={budgetMap} verValores={verValores}
              liberacao={modulo === "avulsos" ? { ativo: liberacao.has(p.id), pode: podeLiberar, alternar: () => void liberar(p) } : null}
              excluirPv={ehAdmin && modulo !== "pcs" ? () => void excluirPv(p) : null} />
          ))}
          {visiveis.length > limite && (
            <div style={{ textAlign: "center", margin: 14 }}>
              <button className="btn" onClick={() => setLimite((l) => l + 120)}>Mostrar mais {Math.min(120, visiveis.length - limite)} de {visiveis.length - limite}</button>
            </div>
          )}
        </>
      )}

      {vista === "tabela" && (
        <GradeOperacao visiveis={visiveis} modulo={modulo} $={$} podeAprovar={podeAprovar} podeEditar={podeEditar} ehAdmin={ehAdmin}
          sel={sel} setSel={setSel} setStatus={setStatus} gravar={gravar} abrirDrawer={setDrawer} nomeId={nomeId} />
      )}

      {vista === "kanban" && (
        <Kanban visiveis={visiveis} $={$} nomeId={nomeId} podeAprovar={podeAprovar} podeEditar={podeEditar}
          setStatus={setStatus} gravar={gravar} abrirDrawer={setDrawer} />
      )}

      {vista === "tempo" && (
        <LinhaDoTempo
          buckets={visiveis.map(({ p, compras }) => ({ pv_os_label: nomeId(p), cliente: p.cliente, rows: compras.map((c) => c.row) }))}
          formatarValor={(v) => $(v)}
          onLoteClick={(r) => setDrawer(`${s(r.empresa)}|${s(r.ncod_ped)}`)}
          acaoBucket={modulo === "projetos" ? (b) => {
            const orig = bucketPorId.get(b.pv_os_label);
            const pj = orig ? projetoDoBucket(modulo, orig) : null;
            return pj ? <LinkAbrirProjeto {...pj} /> : null;
          } : undefined} />
      )}

      {/* ── barra de seleção em massa ── */}
      <BarraMassa n={sel.size} podeAprovar={podeAprovar} podeEditar={podeEditar || ehAdmin || podeAprovar}
        temManual={selCompras.some((c) => Number(c.row.ncod_ped) < 0)}
        onAprovar={() => void emMassa("APROVADO")} onRecusar={() => void emMassa("NAO_APROVADO")}
        onPrevisao={(iso) => void previsaoEmMassa(iso)} onEsconder={() => void esconderPcs()} onApagar={() => void apagarManuais()}
        onCancelar={() => setSel(new Set())} />

      {/* ── gaveta ── */}
      <Gaveta compra={drawerCompra} pedido={drawerCompra ? porId.get(drawerCompra.pedidoId) ?? null : null}
        onFechar={() => setDrawer(null)} $={$} podeAprovar={podeAprovar} podeEditar={podeEditar} ehAdmin={ehAdmin}
        setStatus={setStatus} gravar={gravar} />
      <LogAlteracoes aberto={logAberto} onFechar={() => setLogAberto(false)} compras={noScope.flatMap((p) => p.compras)} />

      {atribEdit && (
        <AtribuicaoModal pc={atribEdit} onClose={() => setAtribEdit(null)} onSaved={() => { setAtribEdit(null); setAtribTick((t) => t + 1); }} />
      )}

      <div className={`toast ${toast ? "show" : ""}`} style={toast?.erro ? { background: "var(--ww-crit)", color: "#fff" } : undefined}>
        <span>{toast?.msg}</span>
        {toast?.desfazer && <button onClick={() => { const d = toast.desfazer; setToast(null); d?.(); }}>Desfazer</button>}
        <button onClick={() => setToast(null)} style={{ color: "inherit", opacity: 0.6 }}>✕</button>
      </div>
    </div>
  );
}

async function enviarWebex(mostrar: (t: Toast) => void) {
  try {
    const r = await fetch("/api/relatorios/avulsos-daily", { cache: "no-store" });
    if (!r.ok) throw new Error("falha ao ler report");
    const data = await r.json();
    const now = new Date();
    const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
    const lines: string[] = [`### 📊 Report Avulsos — ${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}`, ""];
    type Sec = { title: string; emoji: string; items: { label: string; count: number; val: number; owner: string; link: string; delta_count: number | null }[] };
    for (const sec of data.sections as Sec[]) {
      lines.push(`**${sec.emoji} ${sec.title}**`);
      for (const it of sec.items) {
        const delta = it.delta_count == null ? "" : it.delta_count > 0 ? ` (📈 +${it.delta_count})` : it.delta_count < 0 ? ` (📉 ${it.delta_count})` : " (=)";
        lines.push(`- ${it.label}: **${it.count}**${it.val > 0 ? ` · ${fmt(it.val)}` : ""}${delta} · [ver](${it.link}) — ${it.owner}`);
      }
      lines.push("");
    }
    lines.push(`_Total PVs abertos: ${data.total_pvs}_`, "", "📈 [Ver evolução (gráfico + histórico) →](https://painel.waterworks.com.br/relatorios/avulsos-daily)");
    const send = await fetch("/api/relatorios/avulsos-daily/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: lines.join("\n") }) });
    const sj = await send.json();
    if (!send.ok) throw new Error(sj.error ?? send.statusText);
    mostrar({ msg: "Report enviado ao Webex" });
  } catch (e) {
    mostrar({ msg: `Webex: ${e instanceof Error ? e.message : String(e)}`, erro: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────
function PainelFiltros({ aberto, filtros, opcoes, modulo, onAplicar, onFechar }: {
  aberto: boolean; filtros: Filtros; modulo: Modulo;
  opcoes: { tipo: string[]; etapaVenda: string[]; projeto: string[]; fornecedor: string[]; categoria: string[] };
  onAplicar: (f: Filtros) => void; onFechar: () => void;
}) {
  const [f, setF] = useState<Filtros>(filtros);
  useEffect(() => { if (aberto) setF(filtros); }, [aberto, filtros]);
  const campo = (k: keyof Filtros, lab: string, ops: string[], todos = "Todos", labels?: (v: string) => string) => (
    <div className="field">
      <label>{lab}</label>
      <select value={f[k] ?? ""} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value || undefined }))}>
        <option value="">{todos}</option>
        {ops.map((o) => <option key={o} value={o}>{labels ? labels(o) : o}</option>)}
      </select>
    </div>
  );
  return (
    <div className={`fpanel ${aberto ? "open" : ""}`}>
      <div className="fgrid">
        {modulo !== "pcs" ? (
          <div>
            <h4>Venda (PV/OS)</h4>
            {campo("tipo", "Tipo Omie", opcoes.tipo)}
            {campo("etapaVenda", "Etapa venda", opcoes.etapaVenda, "Todas")}
            {campo("projeto", "Projeto", opcoes.projeto)}
          </div>
        ) : <div><h4>Venda</h4><p style={{ color: "var(--ww-text-faint)", fontSize: 12 }}>PC Standalone não tem venda.</p></div>}
        <div>
          <h4>Compra (RC/PC)</h4>
          {campo("estado", "Etapa PC", Object.keys(ESTADO_LABEL), "Todas", (v) => ESTADO_LABEL[v as Estado])}
          {campo("fornecedor", "Fornecedor", opcoes.fornecedor)}
          {campo("categoria", "Categoria", opcoes.categoria, "Todas")}
        </div>
      </div>
      <footer>
        <button className="btn ghost sm" onClick={() => { setF({}); onAplicar({}); }}>Limpar</button>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost sm" onClick={onFechar}>Cancelar</button>
          <button className="btn primary sm" onClick={() => onAplicar(f)}>Aplicar</button>
        </span>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
export function FasesBar({ p, modulo }: { p: Pedido; modulo: string }) {
  const { lista, atual } = fases(p, modulo);
  const nx = atual ? (atual.next || atual.t) : "";
  return (
    <div className="stg-wrap">
      <div className="stgs">
        {lista.map((x) => (
          <div key={x.k} className={`stg ${x.s} ${x === atual ? "cur" : ""}`} title={`${x.k}: ${x.t}`}><span>{x.k}</span><i /></div>
        ))}
      </div>
      <div className={`stg-next ${atual ? atual.s : "d"}`}>
        {atual ? <><b>{atual.k}</b> · {nx}</> : p.faturado ? <><b>✓ Faturado</b> · NF {p.nfSaida}{p.fatEm ? ` · ${dBR(p.fatEm)}` : ""}</> : "✓ ciclo completo"}
      </div>
    </div>
  );
}

export function SeloDif({ d, compacto }: { d: number | null; compacto?: boolean }) {
  if (d == null) return <span className="fb mute">sem PC</span>;
  if (Math.abs(d) < 0.005) return <span className="fb eq">= RC</span>;
  return d > 0
    ? <span className="fb up" title="PC acima da requisição">▲ {pct(d)}{compacto ? "" : " vs RC"}</span>
    : <span className="fb dn" title="PC abaixo da requisição">▼ {pct(-d)}{compacto ? "" : " vs RC"}</span>;
}
const mbCls = (m: number | null) => (m == null ? "" : m >= 0.35 ? "good" : m >= 0.2 ? "warn" : "bad");

export function FinStrip({ p, $ }: { p: Pedido; $: (v: number | null) => string }) {
  const F = financeiro(p);
  return (
    <div className="fin" title="M.B. = (PV − custo) ÷ PV · custo usa o valor do PC quando existe, senão o da RC">
      <div><label>RC</label><b>{$(F.rc)}</b></div>
      <div><label>PC <span>{F.pcN}/{F.total}</span></label><b>{F.pcN ? $(F.pc) : "—"}</b>{F.pcN ? <SeloDif d={F.dif} compacto /> : null}</div>
      <div><label>PV</label><b>{$(p.valorPv)}</b></div>
      <div className={`mb ${mbCls(F.mb)}`}><label>M.B.{F.estimada ? "*" : ""}</label><b>{F.mb == null ? "—" : pct(F.mb)}</b></div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
type Gravar = (c: Compra, campo: keyof typeof CAMPOS, valor: unknown, patch: AnyRow) => Promise<boolean>;

export function SeletorStatus({ c, podeAprovar, ehAdmin, setStatus }: {
  c: Compra; podeAprovar: boolean; ehAdmin: boolean; setStatus: (c: Compra, v: string) => void;
}) {
  if (c.estado === "sem_pc") return <span className="st sem_pc">Sem PC</span>;
  if (c.estado === "recebido") return <span className="st recebido" title={`NF de entrada ${c.nfFornecedor || ""} · ${dBR(c.recebidoEm)}`}>Recebido</span>;
  if (!podeAprovar) return <span className={`st ${c.estado}`}>{ESTADO_LABEL[c.estado]}</span>;
  const atual = c.statusCodigo || "PENDENTE";
  return (
    <select className={`stsel ${c.estado}`} value={atual} onClick={(e) => e.stopPropagation()}
      onChange={(e) => setStatus(c, e.target.value)}>
      {OPCOES_STATUS.filter((o) => !o.admin || ehAdmin || o.v === atual).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      {!OPCOES_STATUS.some((o) => o.v === atual) && <option value={atual}>{STATUS_META[atual]?.label ?? atual}</option>}
    </select>
  );
}

function InputTexto({ valor, placeholder, onSalvar, className = "in", id, mono, disabled }: {
  valor: string; placeholder?: string; onSalvar: (v: string) => void; className?: string; id?: string; mono?: boolean; disabled?: boolean;
}) {
  const [v, setV] = useState(valor);
  useEffect(() => setV(valor), [valor]);
  return (
    <input id={id} className={`${className} ${!v ? "empty" : ""} ${mono ? "mono" : ""}`} value={v} placeholder={placeholder} disabled={disabled}
      onClick={(e) => e.stopPropagation()} onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setV(valor); (e.target as HTMLInputElement).blur(); } }}
      onBlur={() => { if (v.trim() !== valor.trim()) onSalvar(v.trim()); }} />
  );
}

function CartaoPedido(props: {
  p: Pedido; compras: Compra[]; modulo: Modulo; aberto: boolean; onToggle: () => void; nomeId: string;
  $: (v: number | null) => string; sel: Set<string>; toggleSel: (k: string) => void;
  podeAprovar: boolean; podeEditar: boolean; ehAdmin: boolean;
  setStatus: (c: Compra, v: string) => void; gravar: Gravar; abrirDrawer: (k: string) => void;
  abrirAtrib: (c: Compra) => void; atrib: Map<string, { soma_pct: number }>;
  bucket?: Bucket; budgetMap: Map<string, BudgetSummary>; verValores: boolean;
  liberacao: { ativo: boolean; pode: boolean; alternar: () => void } | null;
  excluirPv: (() => void) | null;
}) {
  const { p, compras, modulo, aberto, $ } = props;
  const d = diasAte(p.lim);
  const empresa = s(p.bucket.rows[0]?.empresa) || "SF";
  return (
    <div className={`pv ${aberto ? "open" : ""} ${p.faturado ? "isfat" : ""}`}>
      <div className="pvh" onClick={props.onToggle}>
        <span className="chev">▸</span>
        <div className="pvid">{props.nomeId}<small>{p.tipo || (modulo === "pcs" ? "PC avulso" : "—")} · {p.compras.length} compra{p.compras.length === 1 ? "" : "s"}</small></div>
        <div className="cli">
          {p.cliente || "—"}
          <small>{[p.projeto, p.etapaVenda].filter(Boolean).join(" · ") || (modulo === "pcs" ? "fornecedor" : "")}</small>
          {p.flags.length > 0 && <div className="tags">{p.flags.map((f) => <span key={f.t} className={`tag ${f.tom}`}>{f.t}</span>)}</div>}
        </div>
        <FasesBar p={p} modulo={modulo} />
        <div className="date">
          {p.lim ? dBR(p.lim).slice(0, 5) : "—"}
          {d != null && !p.faturado && <small className={d < 0 ? "late" : d <= 7 ? "soon" : ""}>{d < 0 ? `${-d}d atrasado` : `${d}d de folga`}</small>}
        </div>
        <FinStrip p={p} $={$} />
      </div>

      {modulo === "projetos" && props.bucket && (
        <div className="pvfoot" style={{ justifyContent: "flex-start", paddingTop: 0 }} onClick={(e) => e.stopPropagation()}>
          {(() => { const pj = projetoDoBucket(modulo, props.bucket!); return pj ? <LinkAbrirProjeto {...pj} /> : null; })()}
          <div style={{ flex: 1, maxWidth: 760 }}>
            <BucketTotals bucket={props.bucket} items={props.bucket.rows} modulo={modulo} canViewValues={props.verValores} budgetMap={props.budgetMap} />
          </div>
        </div>
      )}

      {aberto && (
        <div className="pcs">
          <div className="pcrow hd">
            <span />
            <span>Item / RC</span><span>Fornecedor</span><span style={{ textAlign: "right" }}>RC → PC</span>
            <span>PC #</span><span>Status</span><span>Prev. materiais</span><span />
          </div>
          {compras.map((c) => <LinhaCompra key={c.key} c={c} {...props} />)}
          {compras.length === 0 && <div className="pcrow"><span /><span style={{ color: "var(--ww-text-faint)" }}>Sem compras lançadas — a venda existe, a compra ainda não.</span></div>}
          <div className="pvfoot" onClick={(e) => e.stopPropagation()}>
            <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {props.podeEditar && modulo !== "pcs" && (
                <AddRowButton empresa={empresa} modulo={modulo}
                  pv_os_label={modulo === "avulsos" ? p.id : null}
                  pvOsOptions={modulo === "projetos" ? [...new Set(p.bucket.rows.map((r) => s(r.pv_os_label)).filter(Boolean))] : undefined}
                  codigoProjeto={modulo === "projetos" ? Number(p.bucket.rows.find((r) => r.codigo_projeto)?.codigo_projeto ?? 0) || undefined : undefined} />
              )}
              {props.podeEditar && modulo === "avulsos" && <RcExcelDropZone empresa={empresa} pv_os_label={p.id} modulo={modulo} />}
            </span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {props.liberacao && (props.liberacao.pode || props.liberacao.ativo) && (
                <button className={`btn sm ${props.liberacao.ativo ? "" : "ghost"}`} disabled={!props.liberacao.pode} onClick={props.liberacao.alternar}
                  title="Marca o pedido como aguardando liberação do cliente">
                  {props.liberacao.ativo ? "⏸ Aguardando liberação" : "Marcar aguardando liberação"}
                </button>
              )}
              {props.excluirPv && <button className="btn sm no" onClick={props.excluirPv} title="Tirar da lista (fica no Omie)">🗑 Excluir {modulo === "projetos" ? "projeto" : "PV/OS"}</button>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function LinhaCompra({ c, sel, toggleSel, podeAprovar, podeEditar, ehAdmin, setStatus, gravar, abrirDrawer, $, modulo, abrirAtrib, atrib }: {
  c: Compra; sel: Set<string>; toggleSel: (k: string) => void; podeAprovar: boolean; podeEditar: boolean; ehAdmin: boolean;
  setStatus: (c: Compra, v: string) => void; gravar: Gravar; abrirDrawer: (k: string) => void;
  $: (v: number | null) => string; modulo: Modulo; abrirAtrib: (c: Compra) => void; atrib: Map<string, { soma_pct: number }>;
}) {
  const recusada = c.estado === "recusado";
  const prevLate = c.prev != null && c.estado !== "recebido" && (diasAte(c.prev) ?? 0) < 0;
  const somaAtrib = atrib.get(`${s(c.row.empresa)}|${c.pc}`)?.soma_pct ?? 0;
  return (
    <>
      <div className={`pcrow ${sel.has(c.key) ? "sel" : ""}`}>
        <input type="checkbox" className="cb" checked={sel.has(c.key)} onChange={() => toggleSel(c.key)} />
        <div className="desc">{c.desc}
          <small>{c.rcNumero ? `RC ${c.rcNumero} · ` : ""}{c.qtd} × {$(c.unit)}</small></div>
        <div className="desc">{c.fornecedor || <span style={{ color: "var(--ww-text-faint)" }}>—</span>}<small>{c.categoria}</small></div>
        <div style={{ textAlign: "right" }} className="num">
          {$(c.rcTotal)}
          <small style={{ display: "block", fontSize: 11, color: "var(--ww-text-faint)" }}>
            {c.pcValor != null ? <>PC {$(c.pcValor)}{c.pcLinhas > 1 ? ` · ${c.pcLinhas} itens` : ""} <SeloDif d={c.dif} compacto /></> : <span className="fb mute">sem PC</span>}
          </small>
        </div>
        <div>
          {c.temPc && Number(c.row.ncod_ped) > 0
            ? <span className="mono">{c.pc}</span>
            : podeEditar && modulo !== "pcs"
              ? <InputTexto id={`pc-${c.key}`} mono valor={s(c.row.pc_numero_manual)} placeholder="nº PC"
                  onSalvar={(v) => void gravar(c, "pc", v || null, { pc_numero_manual: v || null })} />
              : <span className="mono">{c.pc || "—"}</span>}
        </div>
        <div><SeletorStatus c={c} podeAprovar={podeAprovar} ehAdmin={ehAdmin} setStatus={setStatus} /></div>
        <div>
          {c.temPc && c.estado !== "recebido" && podeEditar
            ? <input type="date" className={`in ${prevLate ? "late" : ""}`} value={isoDia(c.prev)} onClick={(e) => e.stopPropagation()}
                title={c.prevNova ? `Remarcada · original do PC ${dBR(c.prevOriginal)}` : "Previsão do PC"}
                onChange={(e) => { const iso = e.target.value || null; void gravar(c, "prevMateriais", iso, { nova_prev_materiais: iso }); }} />
            : <span className={prevLate ? "late" : ""}>{c.estado === "recebido" ? `recebido ${dBR(c.recebidoEm)}` : c.prev ? dBR(c.prev) : "—"}</span>}
        </div>
        <div className="acts">
          {c.estado === "pendente" && podeAprovar && (
            <>
              <button className="icon ok" title="Aprovar" onClick={() => setStatus(c, "APROVADO")}>✓</button>
              <button className="icon" title="Recusar" onClick={() => setStatus(c, "NAO_APROVADO")}>✕</button>
            </>
          )}
          {c.estado === "sem_pc" && podeEditar && modulo !== "pcs" && (
            <button className="btn sm" onClick={() => document.getElementById(`pc-${c.key}`)?.focus()}>+ PC</button>
          )}
          {modulo === "pcs" && c.pc && (
            <button className="btn sm" title="Clientes que dividem este PC (exigido para aprovar)" onClick={() => abrirAtrib(c)}
              style={somaAtrib >= 99.99 ? undefined : { borderColor: "var(--ww-warn)", color: "var(--ww-warn-text)" }}>
              {somaAtrib >= 99.99 ? "Clientes ✓" : "Atribuir cliente"}
            </button>
          )}
          <button className="icon" title="Todos os campos" onClick={() => abrirDrawer(c.key)}>⋯</button>
        </div>
        {recusada && (
          <div className="jrow">
            <span>Motivo da recusa</span>
            <InputTexto id={`jr-${c.key}`} className={`in ${!c.justificativa ? "need" : ""}`} valor={c.justificativa}
              placeholder="Obrigatório — por que foi recusado?" disabled={!podeAprovar && !podeEditar}
              onSalvar={(v) => void gravar(c, "justificativa", v || null, { justificativa: v || null })} />
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function Kanban({ visiveis, $, nomeId, podeAprovar, podeEditar, setStatus, gravar, abrirDrawer }: {
  visiveis: { p: Pedido; compras: Compra[] }[]; $: (v: number | null) => string; nomeId: (p: Pedido) => string;
  podeAprovar: boolean; podeEditar: boolean; setStatus: (c: Compra, v: string) => void; gravar: Gravar; abrirDrawer: (k: string) => void;
}) {
  const todas = visiveis.flatMap(({ p, compras }) => compras.map((c) => ({ p, c })));
  const cols: [string, (c: Compra) => boolean][] = [
    ["Sem PC", (c) => c.estado === "sem_pc"],
    ["Aguarda aprovação", (c) => c.estado === "pendente" || c.estado === "recusado"],
    ["Aprovado · a receber", (c) => c.estado === "aprovado"],
    ["Recebido", (c) => c.estado === "recebido"],
  ];
  return (
    <div className="kb">
      {cols.map(([t, f]) => {
        const it = todas.filter(({ c }) => f(c));
        return (
          <div key={t} className="kcol">
            <h5>{t}<span>{it.length}</span></h5>
            {it.slice(0, 60).map(({ p, c }) => (
              <div key={c.key} className="kcard" onClick={() => abrirDrawer(c.key)}>
                <div className="t"><span>{nomeId(p)}</span><span>{c.fornecedor || "—"}</span></div>
                <div className="m">{c.desc}</div>
                <div className="b" onClick={(e) => e.stopPropagation()}>
                  <span>{$(c.pcValor ?? c.rcTotal)} {c.pcValor != null ? <SeloDif d={c.dif} compacto /> : <span className="fb mute">sem PC</span>}</span>
                  {c.estado === "pendente" && podeAprovar && (
                    <span style={{ display: "flex", gap: 4 }}>
                      <button className="btn sm ok" onClick={() => setStatus(c, "APROVADO")}>✓ Aprovar</button>
                      <button className="icon" title="Recusar" onClick={() => setStatus(c, "NAO_APROVADO")}>✕</button>
                    </span>
                  )}
                  {c.estado === "sem_pc" && podeEditar && Number(c.row.ncod_ped) < 0 && (
                    <InputTexto mono valor="" placeholder="+ nº PC" className="in" onSalvar={(v) => v && void gravar(c, "pc", v, { pc_numero_manual: v })} />
                  )}
                  {c.estado === "recebido" && <span style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>NF {c.nfFornecedor || "—"}</span>}
                </div>
                {c.estado !== "sem_pc" && (
                  <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                    <SeletorStatus c={c} podeAprovar={podeAprovar} ehAdmin={false} setStatus={setStatus} />
                    <button className="icon" onClick={() => abrirDrawer(c.key)}>⋯</button>
                  </div>
                )}
              </div>
            ))}
            {it.length > 60 && <div style={{ fontSize: 12, color: "var(--ww-text-faint)", padding: 6 }}>+ {it.length - 60} — use os filtros para afunilar</div>}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function BarraMassa({ n, podeAprovar, podeEditar, temManual, onAprovar, onRecusar, onPrevisao, onEsconder, onApagar, onCancelar }: {
  n: number; podeAprovar: boolean; podeEditar: boolean; temManual: boolean;
  onAprovar: () => void; onRecusar: () => void; onPrevisao: (iso: string) => void; onEsconder: () => void; onApagar: () => void; onCancelar: () => void;
}) {
  const [data, setData] = useState("");
  return (
    <div className={`bulk ${n > 0 ? "show" : ""}`}>
      <span className="n">{n} selecionada{n === 1 ? "" : "s"}</span>
      {podeAprovar && <button className="btn sm ok" onClick={onAprovar}>✓ Aprovar</button>}
      {podeAprovar && <button className="btn sm" onClick={onRecusar}>✕ Recusar</button>}
      {podeEditar && (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <span className="vsep" />
          <input type="date" className="in" style={{ width: 150, borderColor: "var(--ww-border-strong)" }} value={data} onChange={(e) => setData(e.target.value)} />
          <button className="btn sm" disabled={!data} onClick={() => { onPrevisao(data); setData(""); }}>Previsão</button>
          <span className="vsep" />
          <button className="btn sm ghost" onClick={onEsconder} title="Some da lista; volta pelo menu ⋯ › PCs escondidos">🚫 Esconder PC</button>
          {temManual && <button className="btn sm no" onClick={onApagar}>🗑 Apagar manuais</button>}
        </span>
      )}
      <button className="btn sm ghost" onClick={onCancelar}>Cancelar</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
function Gaveta({ compra: c, pedido, onFechar, $, podeAprovar, podeEditar, ehAdmin, setStatus, gravar }: {
  compra: Compra | null; pedido: Pedido | null; onFechar: () => void; $: (v: number | null) => string;
  podeAprovar: boolean; podeEditar: boolean; ehAdmin: boolean; setStatus: (c: Compra, v: string) => void; gravar: Gravar;
}) {
  const [hist, setHist] = useState<{ action: string; user_email: string | null; diff: unknown; created_at: string }[] | null>(null);
  useEffect(() => {
    setHist(null);
    if (!c) return;
    supaBrowser().schema("approval" as never).from("audit_log")
      .select("action, user_email, diff, created_at").eq("empresa", c.row.empresa).eq("ncod_ped", c.row.ncod_ped)
      .order("created_at", { ascending: false }).limit(30)
      .then(({ data }) => setHist((data ?? []) as never));
  }, [c?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const campo = (l: string, v: React.ReactNode) => (
    <div className="field"><label>{l}</label><div style={{ minHeight: 20 }}>{v || <span style={{ color: "var(--ww-text-faint)" }}>—</span>}</div></div>
  );
  return (
    <>
      <div className={`scrim ${c ? "show" : ""}`} onClick={onFechar} />
      <div className={`drawer ${c ? "show" : ""}`}>
        {c && pedido && (
          <>
            <div className="dh">
              <div className="t">
                <div>
                  <div className="crumb">{pedido.id} · {pedido.cliente}</div>
                  <h3>{c.desc}</h3>
                </div>
                <button className="icon" onClick={onFechar}>✕</button>
              </div>
              <div style={{ marginTop: 8 }}><SeletorStatus c={c} podeAprovar={false} ehAdmin={ehAdmin} setStatus={setStatus} /></div>
            </div>
            <div className="db">
              {c.temPc && c.estado !== "recebido" && podeAprovar && (
                <>
                  <h4>Decisão</h4>
                  <div className="decide">
                    <button className={`a ${c.estado === "aprovado" ? "on" : ""}`} onClick={() => setStatus(c, "APROVADO")}>✓ Aprovar</button>
                    <button className={`p ${c.estado === "pendente" ? "on" : ""}`} onClick={() => setStatus(c, "PENDENTE")}>Pendente</button>
                    <button className={`r ${c.estado === "recusado" ? "on" : ""}`} onClick={() => setStatus(c, "NAO_APROVADO")}>✕ Recusar</button>
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>Justificativa {c.estado === "recusado" && <b style={{ color: "var(--ww-crit)" }}>· obrigatória na recusa</b>}</label>
                    <InputTexto className="in" valor={c.justificativa} placeholder="Motivo / observação da aprovação"
                      onSalvar={(v) => void gravar(c, "justificativa", v || null, { justificativa: v || null })} />
                  </div>
                </>
              )}
              <h4>Requisição</h4>
              <div className="row2">{campo("RC nº", c.rcNumero)}{campo("Qtd × custo", `${c.qtd} × ${$(c.unit)}`)}</div>
              <div className="calc"><span>Total RC</span><b>{$(c.rcTotal)}</b></div>
              <h4>Pedido de compra</h4>
              <div className="row2">{campo("PC #", c.pc)}{campo("Valor PC", c.pcValor != null ? <>{$(c.pcValor)} <SeloDif d={c.dif} /></> : null)}</div>
              <div className="row2">{campo("Fornecedor", c.fornecedor)}{campo("Categoria", c.categoria)}</div>
              <div className="row2">{campo("Pagamento", c.pagamento)}{campo("Aprovar até", dBR(c.aprovarAte))}</div>
              <h4>Datas</h4>
              <div className="row2">
                <div className="field"><label>Prev. materiais</label>
                  {c.temPc && c.estado !== "recebido" && podeEditar
                    ? <input type="date" className="in" style={{ borderColor: "var(--ww-border-strong)" }} value={isoDia(c.prev)}
                        onChange={(e) => { const iso = e.target.value || null; void gravar(c, "prevMateriais", iso, { nova_prev_materiais: iso }); }} />
                    : <div>{dBR(c.prev) || "—"}</div>}
                  {c.prevNova && <small style={{ color: "var(--ww-text-faint)" }}>original do PC: {dBR(c.prevOriginal)}</small>}
                </div>
                {campo("Prev. serviços", dBR(c.prevServicos))}
              </div>
              <div className="row2">{campo("Limite PV", dBR(pedido.lim))}{campo("Recebido", c.recebidoEm ? `${dBR(c.recebidoEm)} · NF ${c.nfFornecedor}` : "")}</div>
              <h4>Histórico</h4>
              <div className="hist">
                {hist === null ? <p>Carregando…</p> : hist.length === 0 ? <p>Sem alterações registradas.</p> : hist.map((h, i) => (
                  <p key={i}><b>{new Date(h.created_at).toLocaleString("pt-BR")}</b> · {h.user_email ?? "sistema"} · {h.action}
                    {h.diff && typeof h.diff === "object" && h.action === "update" ? ` — ${Object.keys(h.diff as object).filter((k) => k !== "updated_at").join(", ")}` : ""}</p>
                ))}
              </div>
            </div>
            <div className="df"><button className="btn" onClick={onFechar}>Fechar</button></div>
          </>
        )}
      </div>
    </>
  );
}

function LogAlteracoes({ aberto, onFechar, compras }: { aberto: boolean; onFechar: () => void; compras: Compra[] }) {
  const [linhas, setLinhas] = useState<{ ncod_ped: number; action: string; user_email: string | null; diff: unknown; created_at: string }[] | null>(null);
  useEffect(() => {
    if (!aberto) return;
    const ncods = [...new Set(compras.map((c) => Number(c.row.ncod_ped)))].slice(0, 800);
    if (!ncods.length) { setLinhas([]); return; }
    supaBrowser().schema("approval" as never).from("audit_log")
      .select("ncod_ped, action, user_email, diff, created_at").in("ncod_ped", ncods)
      .neq("user_email", null).order("created_at", { ascending: false }).limit(150)
      .then(({ data }) => setLinhas((data ?? []) as never));
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps
  const porNcod = new Map(compras.map((c) => [Number(c.row.ncod_ped), c]));
  return (
    <>
      <div className={`scrim ${aberto ? "show" : ""}`} onClick={onFechar} />
      <div className={`drawer ${aberto ? "show" : ""}`}>
        <div className="dh"><div className="t"><h3>🕘 Log de alterações</h3><button className="icon" onClick={onFechar}>✕</button></div>
          <div className="crumb">As 150 mais recentes feitas por pessoas nesta lista</div></div>
        <div className="db">
          <div className="hist">
            {linhas === null ? <p>Carregando…</p> : linhas.length === 0 ? <p>Nada registrado.</p> : linhas.map((h, i) => {
              const c = porNcod.get(Number(h.ncod_ped));
              return (
                <p key={i}><b>{new Date(h.created_at).toLocaleString("pt-BR")}</b> · {h.user_email} · {h.action}
                  {c ? ` · ${c.pedidoId} · ${c.desc}` : ""}
                  {h.diff && typeof h.diff === "object" && h.action === "update" ? ` — ${Object.keys(h.diff as object).filter((k) => k !== "updated_at").join(", ")}` : ""}</p>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
