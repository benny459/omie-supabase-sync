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

import GerarPcDaRc from "@/components/operacao/GerarPcDaRc";
import OndeEsta from "./OndeEsta";
import "./operacao.css";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STATUS_META } from "@/lib/columns";
import { useUserPerms } from "../UserPermsProvider";
import { canApprove, canEdit, canReleasePv, canViewValues } from "@/lib/permissions";
import {
  montarPedido, fases, financeiro, margensProjeto, passa, noEscopo, dataMs, diasAte, dBR, isoDia, brl, pct, encerrado,
  ESTADO_LABEL, FILTRO_LABEL,
  type Compra, type Escopo, type Estado, type Filtros, type Pedido, type Periodo, type Rapida,
  servicoDoPedido, servicoAtrasado, tipoVenda, STATUS_SERVICO, type Servico,
  materialDoItem, MAT_MANUAL, type MatManual,
  ordenarPedidos, ORDEM_PADRAO, type Ordem, type OrdemCampo,
} from "@/lib/operacao-modelo";
import { chaveRentab, type RentabResumo } from "@/lib/rentabilidade";
import { mudarStatus, mudarStatusEmMassa, salvarCampo, CAMPOS, type Modulo } from "@/lib/approvals-write";
import { SO_QUEM_APROVA } from "@/lib/aprovacao-permissao";
import { buildBuckets, BucketTotals, projetoDoBucket, LinkAbrirProjeto, type Bucket, type BudgetSummary } from "../BoldAvulsosView";
import KpisNavy from "../navy/KpisNavy";
import LinhaDoTempo from "../navy/LinhaDoTempo";
import AddRowButton from "../AddRowButton";
import RcExcelDropZone from "../RcExcelDropZone";
import SyncNowButton from "../SyncNowButton";
import PcsExcluidosButton, { type PcEscondido } from "../PcsExcluidosButton";
import { AtribuicaoModal } from "../AtribuirClienteView";
import { supaBrowser } from "@/lib/supabase";
import { estadoPc } from "@/lib/situacao-pc";
import { ModalCancelarPc, ModalDevolverPc, SecaoAjustesPc } from "../compras/PcCancelarDevolver";
import GradeOperacao from "./GradeOperacao";
import ProjetosAtivosMenu, { EstrelaAtivo, PainelAtivos, chaveProjeto, useProjetosAtivos, type ItemMenu } from "../projeto/ProjetosAtivosMenu";
import { OcChip, useOcResumo } from "../vendas/OcAnexos";
import type { OcResumo } from "@/lib/vendas-anexos";

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
type AjustePcAberto = { acao: "cancelar" | "devolver"; empresa: string; pc: string; fornecedor: string; valor: number | null; codigoProjeto: number | null; pedidoId: string };
type Toast = { msg: string; desfazer?: () => void; erro?: boolean } | null;
type Visao = { nome: string; escopo: Escopo; periodo: Periodo; filtros: Filtros; rapida: Rapida | Rapida[]; q: string; ordem?: Ordem };

const VIEW_DO_MODULO: Record<Modulo, string> = { avulsos: "v_pc_avulsos", projetos: "v_pc_projetos", pcs: "v_pc_pcs" };

/** Linha manual só com RC + nº do PC (quando todas as linhas da RC já têm PC).
 *  Mesmo esquema do AddRowButton: ncod_ped negativo abaixo do menor existente. */
async function novaLinhaPc(head: AnyRow, rc: string, pc: string, modulo: Modulo): Promise<string | null> {
  const approval = supaBrowser().schema("approval" as never);
  const { data: minRows, error: mErr } = await approval.from("approvals")
    .select("ncod_ped").order("ncod_ped", { ascending: true }).limit(1);
  if (mErr) return mErr.message;
  const min = Number((minRows?.[0] as { ncod_ped?: number } | undefined)?.ncod_ped ?? 0);
  const linha: AnyRow = {
    empresa: s(head.empresa) || "SF", ncod_ped: Math.min(min, -1) - 1, modulo,
    source: "native", status: "PENDENTE",
    pv_os_label: s(head.pv_os_label) || null,
    rc_numero: rc || null, pc_numero_manual: pc,
    ...(head.codigo_projeto != null ? { codigo_projeto: head.codigo_projeto } : {}),
  };
  const { error } = await approval.from("approvals").insert(linha);
  return error?.message ?? null;
}

export default function TelaOperacao({ modulo, title, rows: rowsIniciais, parcial = false, parcialAtivos = false, avisoErro = null }: {
  modulo: Modulo; title: string; rows: AnyRow[];
  /** Só os não faturados chegaram até agora — o resto vem em segundo plano. */
  parcial?: boolean;
  /** Projetos (08/10/26): por enquanto só os cartões dos ★ ativos — os outros vêm em segundo plano. */
  parcialAtivos?: boolean;
  avisoErro?: string | null;
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
  // ?q=PV1966 (vindo do cartão da RC/PC em Compras) já abre a tela filtrada.
  // ?escopo=todos (09/10/26): vem do guia "Onde está?" — o achado pode estar faturado.
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const v = qs.get("q"); if (v) setQ(v);
    const e = qs.get("escopo"); if (e === "aberto" || e === "faturado" || e === "todos") setEscopo(e);
  }, []);
  const [periodo, setPeriodo] = useState<Periodo>("tudo");
  /* Ordem da lista: mais novo primeiro; clicar no cabeçalho reordena, de novo
     inverte (como no Excel). Gravada por módulo e nas visões salvas (06/10/26). */
  /* Projetos: do maior PJ para o menor (08/10/26, Benny — "em ordem decrescente"). */
  const [ordem, setOrdemSt] = useState<Ordem>(modulo === "projetos" ? { k: "pedido", d: -1 } : ORDEM_PADRAO);
  const [filtros, setFiltros] = useState<Filtros>({});
  /* Filtros rápidos marcados — vários ao mesmo tempo; cada um estreita a
     lista (E). Vazio = todos. (pedido do Benny, 01/10/2026) */
  const [marcados, setMarcados] = useState<Rapida[]>([]);
  const alternar = (k: Rapida) => setMarcados((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]));
  const temAlgumFiltro = marcados.length > 0 || !!q.trim() || periodo !== "tudo" || Object.values(filtros).some(Boolean);
  const limparTudo = () => { setMarcados([]); setQ(""); setPeriodo("tudo"); setFiltros({}); };
  const [vista, setVista] = useState<Vista>("lista");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [patches, setPatches] = useState<Map<string, AnyRow>>(new Map());
  const [toast, setToast] = useState<Toast>(null);
  const [drawer, setDrawerSt] = useState<string | null>(null);
  // PC nativo do Compras (sql/148, ncod_ped negativo) abre a folha dele no Compras.
  const setDrawer = useCallback((k: string | null) => { if (!k || !abrirPcNativo(k.split("|")[1])) setDrawerSt(k); }, []);
  /* Cancelar pedido / Devolver material (08/10/26, sql/146): o modal aberto, os PCs que
     acabaram de ser cancelados (somem já, sem esperar a recarga) e um tique para o resumo
     do budget e a seção "Cancelados / devolvidos" buscarem de novo. */
  const [ajustePc, setAjustePc] = useState<AjustePcAberto | null>(null);
  const [ocultosPc, setOcultosPc] = useState<Set<string>>(new Set());
  const [tickAjuste, setTickAjuste] = useState(0);
  const [gerarPcDe, setGerarPcDe] = useState<{ p: Pedido; rc: string; itens: Compra[] } | null>(null);
  const [painelFiltro, setPainelFiltro] = useState(false);
  const [menu, setMenu] = useState<"mais" | "export" | "visoes" | null>(null);
  const [logAberto, setLogAberto] = useState(false);
  const [visoes, setVisoes] = useState<Visao[]>([]);
  // Anotações por pedido (balãozinho): quem escreveu e quando ficam gravados no servidor.
  const [notas, setNotas] = useState<Record<string, Nota[]>>({});
  const [notasDe, setNotasDe] = useState<Pedido | null>(null);
  useEffect(() => {
    fetch(`/api/pedidos/notas?modulo=${modulo}`, { cache: "no-store" }).then((r) => r.json())
      .then((j) => setNotas(j.notas ?? {})).catch(() => {});
  }, [modulo]);
  const [limite, setLimite] = useState(120);
  const buscaRef = useRef<HTMLInputElement>(null);
  const chaveLS = `op:${modulo}`;

  useEffect(() => {
    try {
      const v = localStorage.getItem(`${chaveLS}:vista`) as Vista | null;
      if (v && ["lista", "tabela", "kanban", "tempo"].includes(v)) setVista(v);
      const vs = JSON.parse(localStorage.getItem(`${chaveLS}:visoes`) ?? "[]");
      if (Array.isArray(vs)) setVisoes(vs);
      const o = JSON.parse(localStorage.getItem(`${chaveLS}:ordem`) ?? "null") as Ordem | null;
      if (o?.k && (o.d === 1 || o.d === -1)) setOrdemSt(o);
    } catch { /* sem storage */ }
  }, [chaveLS]);
  const setOrdem = (o: Ordem) => { setOrdemSt(o); try { localStorage.setItem(`${chaveLS}:ordem`, JSON.stringify(o)); } catch { /* */ } };
  const ordenarPor = (k: OrdemCampo) => setOrdem(ordem.k === k
    ? { k, d: ordem.d === 1 ? -1 : 1 }
    : { k, d: k === "emissao" || k === "rc" || k === "pc" || k === "pv" || k === "mb" ? -1 : 1 });
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
  /* Linhas recarregadas da view viva para um pedido (depois de digitar um
     nº de PC): substituem as da carga inicial pela chave e acrescentam as
     novas — o PC aparece com fornecedor, valor e status sem recarregar tudo. */
  const [vivas, setVivas] = useState<Map<string, AnyRow>>(new Map());
  const rows = useMemo(() => {
    const base = vivas.size
      ? [...rowsIniciais.map((r) => vivas.get(`${s(r.empresa)}|${s(r.ncod_ped)}`) ?? r),
         ...[...vivas.entries()].filter(([k]) => !rowsIniciais.some((r) => `${s(r.empresa)}|${s(r.ncod_ped)}` === k)).map(([, r]) => r)]
      : rowsIniciais;
    return base.filter((r) => !ocultosPc.size || !ocultosPc.has(`${s(r.empresa)}|${s(r.pc_numero) || s(r.pc_numero_manual)}`)).map((r) => {
      const p = patches.get(`${s(r.empresa)}|${s(r.ncod_ped)}`);
      return p ? { ...r, ...p } : r;
    });
  }, [rowsIniciais, vivas, patches, ocultosPc]);
  const recarregarPedido = useCallback(async (p: Pedido) => {
    const pvsDoPedido = [...new Set(p.bucket.rows.map((r) => s(r.pv_os_label)).filter(Boolean))];
    const proj = modulo === "projetos" ? Number(p.bucket.rows.find((r) => r.codigo_projeto)?.codigo_projeto ?? 0) || 0 : 0;
    const qs = new URLSearchParams({ view: VIEW_DO_MODULO[modulo] });
    if (pvsDoPedido.length) qs.set("pv", pvsDoPedido.join(","));
    if (proj) qs.set("projeto", String(proj));
    const r = await fetch(`/api/list/rows?${qs}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    const novas = (j.rows ?? []) as AnyRow[];
    setVivas((m) => { const n = new Map(m); for (const x of novas) n.set(`${s(x.empresa)}|${s(x.ncod_ped)}`, x); return n; });
    // O que veio da view viva já reflete o gravado — descarta patches locais dessas linhas.
    setPatches((m) => { const n = new Map(m); for (const x of novas) n.delete(`${s(x.empresa)}|${s(x.ncod_ped)}`); return n; });
    return novas;
  }, [modulo]);

  const aplicar = useCallback((key: string, patch: AnyRow) =>
    setPatches((m) => { const n = new Map(m); n.set(key, { ...(n.get(key) ?? {}), ...patch }); return n; }), []);

  const groupBy = modulo === "projetos" ? "project" : modulo === "pcs" ? "pc" : "pvos";
  const buckets = useMemo(() => buildBuckets(rows, groupBy), [rows, groupBy]);
  const pedidos = useMemo(() => buckets.map((b) => montarPedido(b as never, modulo)), [buckets, modulo]);
  /* ★ Projetos ativos (08/10/26, Benny): "apontar em ordem decrescente os projetos ativos, para
     que traga a princípio apenas aqueles que determinei como ativos". Marca compartilhada
     (approval.rc_projetos_budget.ativo, sql/130). "Só ativos" é o padrão e fica gravado por
     pessoa no navegador; sem nenhum projeto marcado (ou antes da sql/130) mostra todos. */
  const pa = useProjetosAtivos(modulo === "projetos");
  const [soAtivos, setSoAtivosSt] = useState(true);
  const [painelAtivos, setPainelAtivos] = useState(false);
  useEffect(() => {
    if (modulo !== "projetos") return;
    try { if (localStorage.getItem("op:projetos:soAtivos") === "0") setSoAtivosSt(false); } catch { /* */ }
    // Chegou com uma busca na URL (guia "Onde está?"): procura em todos, sem gravar a preferência.
    if (new URLSearchParams(window.location.search).has("q")) setSoAtivosSt(false);
  }, [modulo]);
  const setSoAtivos = (v: boolean, gravar = true) => { setSoAtivosSt(v); if (gravar) try { localStorage.setItem("op:projetos:soAtivos", v ? "1" : "0"); } catch { /* */ } };
  const projDe = useCallback((p: Pedido) => {
    const r = p.bucket.rows.find((x) => Number(x.codigo_projeto ?? x.pv_codigo_projeto ?? 0) > 0);
    return r ? { empresa: (s(r.empresa) || "SF").toUpperCase(), codigo: Number(r.codigo_projeto ?? r.pv_codigo_projeto) } : null;
  }, []);
  const ehAtivo = useCallback((p: Pedido) => { const k = projDe(p); return !!k && pa.chaves.has(chaveProjeto(k.empresa, k.codigo)); }, [projDe, pa.chaves]);
  const filtroAtivos = modulo === "projetos" && soAtivos && pa.disponivel === true && pa.chaves.size > 0;
  const pedidosBase = useMemo(() => (filtroAtivos ? pedidos.filter(ehAtivo) : pedidos), [pedidos, filtroAtivos, ehAtivo]);
  const nAtivosNaLista = useMemo(() => (modulo === "projetos" ? pedidos.filter(ehAtivo).length : 0), [pedidos, ehAtivo, modulo]);
  /* ?abrir=<código do projeto>&empresa=SF (08/10/26, spec A.6): vindo do projeto
     ("mudar datas em Operação › Projetos"), abre o cartão já expandido e rola até ele. */
  const abrirFeito = useRef(false);
  useEffect(() => {
    if (abrirFeito.current || modulo !== "projetos" || !pedidos.length || pa.disponivel === null) return;
    const qs = new URLSearchParams(window.location.search);
    const cod = Number(qs.get("abrir") || 0);
    if (!cod) { abrirFeito.current = true; return; }
    const emp = (qs.get("empresa") || "").toUpperCase();
    const alvo = pedidos.find((p) => p.bucket.rows.some((r) => Number(r.codigo_projeto ?? r.pv_codigo_projeto ?? 0) === cod && (!emp || s(r.empresa).toUpperCase() === emp)));
    if (!alvo) return; // os faturados chegam em segundo plano — tenta de novo quando chegarem
    abrirFeito.current = true;
    if (alvo.faturado) setEscopo("todos");
    if (!ehAtivo(alvo)) setSoAtivosSt(false); // projeto fora dos ativos: mostra todos (sem gravar a preferência)
    setAbertos((x) => new Set(x).add(alvo.id));
    setTimeout(() => document.querySelector(`[data-pid="${CSS.escape(alvo.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
  }, [pedidos, modulo, ehAtivo, pa.disponivel]);
  /* De que proposta do CRM veio cada PV/OS (06/10/26, Benny) — chip na linha que
     abre a proposta no CRM do portal. Mapa por empresa: { PV1967: "OPS0610261008" }. */
  const [propostas, setPropostas] = useState<Record<string, string>>({});
  const empresasVistas = useMemo(() => [...new Set(pedidos.map((p) => s(p.bucket.rows[0]?.empresa) || "SF"))].sort().join(","), [pedidos]);
  useEffect(() => {
    if (!empresasVistas || modulo === "pcs") return;
    let vivo = true;
    void Promise.all(empresasVistas.split(",").map((e) => fetch(`/api/operacao/propostas?empresa=${encodeURIComponent(e)}`)
      .then((r) => (r.ok ? r.json() : {})).catch(() => ({}))))
      .then((ls: Record<string, string>[]) => { if (vivo) setPropostas(Object.assign({}, ...ls)); });
    return () => { vivo = false; };
  }, [empresasVistas, modulo]);
  /* OC do cliente e 📎 anexos de cada PV/OS (07/10/26, sql/110). */
  const pvosDe = useCallback((p: Pedido) => [...new Set([p.id, ...p.bucket.rows.map((r) => s(r.pv_os_label))]
    .map((l) => String(l).toUpperCase()).filter((l) => /^(PV|OS)\d+$/.test(l)))], []);
  const ocItens = useMemo(() => modulo === "pcs" ? [] : pedidos.flatMap((p) => {
    const empresa = s(p.bucket.rows[0]?.empresa) || "SF";
    return pvosDe(p).map((label) => ({ empresa, label }));
  }), [pedidos, modulo, pvosDe]);
  const ocMapa = useOcResumo(ocItens);
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
  /* 08/10/26: a lista chega em duas etapas (rápida → completa); o resumo de budget é pedido
     só para os projetos que ainda não foram pedidos e soma ao que já veio — antes refazia
     tudo a cada etapa. tickAjuste (cancelar/devolver PC) pede tudo de novo. */
  const budgetPedidos = useRef<{ tick: number; keys: Set<string> }>({ tick: -1, keys: new Set() });
  useEffect(() => {
    if (modulo !== "projetos") return;
    if (budgetPedidos.current.tick !== tickAjuste) budgetPedidos.current = { tick: tickAjuste, keys: new Set() };
    const ja = budgetPedidos.current.keys;
    const keys = new Set<string>();
    for (const r of rowsIniciais) {
      const emp = s(r.empresa), cod = Number(r.codigo_projeto ?? r.pv_codigo_projeto ?? 0);
      if (emp && cod > 0 && !ja.has(`${emp}|${cod}`)) keys.add(`${emp}|${cod}`);
    }
    if (!keys.size) return;
    for (const k of keys) ja.add(k);
    const lotes: string[][] = [];
    const todas = [...keys];
    for (let i = 0; i < todas.length; i += 300) lotes.push(todas.slice(i, i + 300)); // a rota lê até 300
    for (const lote of lotes) {
      fetch(`/api/rc-projetos/budget/summary?keys=${encodeURIComponent(lote.join(","))}`).then((r) => r.json()).then((j) => {
        setBudgetMap((atual) => {
          const m = new Map(atual);
          for (const row of j.rows ?? []) m.set(row.key, row);
          return m;
        });
      }).catch(() => { for (const k of lote) ja.delete(k); });
    }
  }, [modulo, rowsIniciais, tickAjuste]);
  const [escondidos, setEscondidos] = useState<PcEscondido[]>([]);
  const carregarEscondidos = useCallback(() => {
    fetch("/api/pcs/excluir", { cache: "no-store" }).then((r) => r.json())
      .then((j) => setEscondidos(j.linhas ?? j.rows ?? [])).catch(() => {});
  }, []);
  useEffect(() => { carregarEscondidos(); }, [carregarEscondidos]);

  /* Pago / Receb. no fim da barra de etapas (05/10/2026): o painel já sabe se
     as compras foram pagas e a venda recebida (sales.mv_rentab_pvos). Uma
     busca por carga, só os selos — sem R$. */
  const [cadeia, setCadeia] = useState<Record<string, RentabResumo>>({});
  /* 08/10/26: só as chaves ainda não pedidas, somadas ao que já veio (como o budget acima). */
  const cadeiaPedidas = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (modulo === "pcs") return;
    const ja = cadeiaPedidas.current;
    const chaves = [...new Set(rowsIniciais
      .filter((r) => r.pv_os_label)
      .map((r) => chaveRentab(s(r.empresa), s(r.pv_os_label))))].filter((c) => !ja.has(c));
    if (!chaves.length) return;
    for (const c of chaves) ja.add(c);
    fetch("/api/rentabilidade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chaves }) })
      .then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.resumo) setCadeia((atual) => ({ ...atual, ...j.resumo })); else for (const c of chaves) ja.delete(c); })
      .catch(() => { for (const c of chaves) ja.delete(c); });
  }, [modulo, rowsIniciais]);

  // ── filtros ───────────────────────────────────────────────────────────
  const noScope = useMemo(() => pedidosBase.filter((p) => noEscopo(p, escopo)), [pedidosBase, escopo]);
  const contagem = useMemo(() => {
    const soma = (a: Pedido[]) => a.reduce((x, p) => x + p.valorPv, 0);
    const ab = pedidosBase.filter((p) => !p.faturado), fa = pedidosBase.filter((p) => p.faturado);
    return { aberto: [ab.length, soma(ab)], faturado: [fa.length, soma(fa)], todos: [pedidosBase.length, soma(pedidosBase)] } as const;
  }, [pedidosBase]);
  const temFiltroCompra = !!((filtros.estado && filtros.estado !== "sem_pc") || filtros.fornecedor || filtros.categoria) || marcados.includes("minha");
  /* Uma função só decide quem aparece — a lista E os contadores dos botões
     usam ela (01/10/2026: contavam por conta própria e divergiam do filtro).
     O contador de cada botão respeita busca, período e painel de filtros. */
  const filtrarPor = useCallback((raps: Rapida[]) => {
    const qq = q.trim().toLowerCase();
    const lista: Rapida[] = raps.length ? raps : ["todos"];
    const soCompra = !!((filtros.estado && filtros.estado !== "sem_pc") || filtros.fornecedor || filtros.categoria) || lista.includes("minha") || lista.some((r) => r.startsWith("mat_"));
    // Status de serviço são exclusivos entre si: marcados juntos somam (OU);
    // com os demais filtros, estreitam (E).
    const status = lista.filter((r) => r.startsWith("serv_st:"));
    const resto = lista.filter((r) => !r.startsWith("serv_st:"));
    const restoOk = resto.length ? resto : (["todos"] as Rapida[]);
    const ok = (p: Pedido, c: Compra | null) =>
      restoOk.every((r) => passa(p, c, qq, periodo, filtros, r))
      && (!status.length || status.some((r) => passa(p, c, qq, periodo, filtros, r)));
    const out: { p: Pedido; compras: Compra[] }[] = [];
    for (const p of noScope) {
      const cs = p.compras.filter((c) => ok(p, c));
      if (cs.length) out.push({ p, compras: cs });
      else if (!p.compras.length && !soCompra && ok(p, null)) out.push({ p, compras: [] });
    }
    return out;
  }, [noScope, q, periodo, filtros]);
  /* Projetos (08/10/26, spec A2): em "Todos", os ★ ativos vêm primeiro — dentro de cada
     grupo vale a ordem escolhida. */
  const visiveis = useMemo(() => {
    const o = ordenarPedidos(filtrarPor(marcados), ordem, modulo);
    if (modulo !== "projetos" || filtroAtivos || !pa.chaves.size) return o;
    return [...o.filter((x) => ehAtivo(x.p)), ...o.filter((x) => !ehAtivo(x.p))];
  }, [filtrarPor, marcados, ordem, modulo, filtroAtivos, pa.chaves, ehAtivo]);
  /* Guia "Onde está?" (09/10/26): a busca sozinha, sem aba/filtros/★ ativos, acha algo aqui? */
  const naTelaSemFiltros = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq || visiveis.length) return 0;
    return pedidos.filter((p) => (p.compras.length ? p.compras.some((c) => passa(p, c, qq, "tudo", {}, "todos")) : passa(p, null, qq, "tudo", {}, "todos"))).length;
  }, [q, visiveis.length, pedidos]);
  const opcoes = useMemo(() => {
    const uniq = (a: string[]) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, "pt-BR"));
    return {
      tipo: uniq(noScope.map((p) => tipoVenda(p.tipo) || p.tipo)),
      etapaVenda: uniq(noScope.map((p) => p.etapaVenda)),
      projeto: ["Sem projeto", ...uniq(noScope.map((p) => p.projeto))],
      // Uma opção por fornecedor, sem distinguir caixa (o Omie tem INDFILTROS e Indfiltros).
      fornecedor: [...new Map(noScope.flatMap((p) => p.compras.map((c) => c.fornecedor)).filter(Boolean)
        .sort((a, b) => (a === a.toUpperCase() ? 1 : 0) - (b === b.toUpperCase() ? 1 : 0)) // maiúsculas por último → ganham no Map
        .map((x) => [x.toUpperCase(), x] as const)).values()].sort((x, y) => x.localeCompare(y, "pt-BR")),
      categoria: uniq(noScope.flatMap((p) => p.compras.map((c) => c.categoria))),
    };
  }, [noScope]);
  // Número de cada botão = quantos ficariam ao somar aquele filtro aos já marcados.
  const rapidas = useMemo(() => {
    const k: Rapida[] = ["minha", "atrasados", "sem_pc", "alarme", "pode_fat", "venda_atraso", "compra_atraso",
      "recusa", "serv_exec", "serv_atraso", "serv_agend", "serv_semos", "mat_estoque", "mat_sem_nf", "mat_parcial", "mat_alarme"];
    const r = Object.fromEntries(k.map((x) => [x, filtrarPor(marcados.includes(x) ? marcados : [...marcados, x]).length])) as Record<Rapida, number>;
    // Status de serviço: o número é o daquele status sozinho, com os demais filtros marcados.
    const semStatus = marcados.filter((x) => !x.startsWith("serv_st:"));
    for (const st of STATUS_SERVICO) {
      const key = `serv_st:${st.rotulo}` as Rapida;
      r[key] = filtrarPor([...semStatus, key]).length;
    }
    r.todos = filtrarPor([]).length;
    return r;
  }, [filtrarPor, marcados]);
  const fila = useMemo(() => noScope.flatMap((p) => p.compras.filter((c) => c.estado === "pendente")), [noScope]);
  const nFiltros = Object.values(filtros).filter(Boolean).length;

  const salvarVisao = () => {
    const nome = window.prompt("Nome desta visão:");
    if (!nome?.trim()) return;
    const nv = [...visoes.filter((v) => v.nome !== nome.trim()), { nome: nome.trim(), escopo, periodo, filtros, rapida: marcados, q, ordem }];
    setVisoes(nv);
    try { localStorage.setItem(`${chaveLS}:visoes`, JSON.stringify(nv)); } catch { /* */ }
  };
  const aplicarVisao = (v: Visao) => { setEscopo(v.escopo); setPeriodo(v.periodo); setFiltros(v.filtros); setMarcados(Array.isArray(v.rapida) ? v.rapida : v.rapida && v.rapida !== "todos" ? [v.rapida] : []); setQ(v.q); if (v.ordem) setOrdem(v.ordem); };
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

  const podeAjustarPc = ehAdmin || ["aprovador", "comprador"].includes(String(user?.role ?? ""));
  const abrirAjustePc = useCallback((acao: "cancelar" | "devolver", cs: Compra[]) => {
    const c = cs[0];
    if (!c?.pc) return;
    if (!podeAjustarPc) { mostrar({ msg: "Cancelar e devolver PC: só admin, aprovador ou comprador.", erro: true }); return; }
    // Cancelar = decisão sobre o pedido: só quem aprova (08/10/26, Benny). Devolver segue livre p/ comprador.
    if (acao === "cancelar" && !(ehAdmin || podeAprovar)) { mostrar({ msg: "Só quem aprova pode cancelar o pedido de compra.", erro: true }); return; }
    setAjustePc({ acao, empresa: s(c.row.empresa) || "SF", pc: c.pc, fornecedor: c.fornecedor, valor: cs.find((x) => x.pcValor != null)?.pcValor ?? null,
      codigoProjeto: Number(c.row.codigo_projeto ?? c.row.pv_codigo_projeto ?? 0) || null, pedidoId: c.pedidoId });
  }, [podeAjustarPc, mostrar, ehAdmin, podeAprovar]);
  const setStatus = useCallback(async (c: Compra, status: string) => {
    // PC do Compras (sql/148-149): decide pela rota do Compras, com a regra de projeto (Marcelo/budget).
    if (Number(c.row.ncod_ped) < 0) {
      const st = STATUS_COMPRAS[status];
      if (!st) { abrirPcNativo(c.row.ncod_ped); return; }
      const antesN = c.statusCodigo;
      aplicar(c.key, { status });
      const e = await decidirPcNativo([c.row], st);
      if (e) { aplicar(c.key, { status: antesN }); mostrar({ msg: `Não gravou (PC ${c.pc}): ${e}`, erro: true }); return; }
      mostrar({ msg: `PC ${c.pc}: ${OPCOES_STATUS.find((o) => o.v === status)?.l.toLowerCase() ?? status}` });
      return;
    }
    if (!podeAprovar) { mostrar({ msg: "Sem permissão para aprovar neste módulo.", erro: true }); return; }
    // "Cancelar pedido" cancela de verdade (sql/146) — abre o motivo em vez de só gravar o rótulo
    if (status === "CANCELAR_PEDIDO" && c.pc) { abrirAjustePc("cancelar", [c]); return; }
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
  }, [aplicar, modulo, mostrar, podeAprovar, abrirAjustePc]);

  const gravar = useCallback(async (c: Compra, campo: keyof typeof CAMPOS, valor: unknown, patch: AnyRow) => {
    if (abrirPcNativo(c.row.ncod_ped)) return false;
    const def = CAMPOS[campo] as { campo: string; historico?: boolean };
    const antes: AnyRow = Object.fromEntries(Object.keys(patch).map((k) => [k, c.row[k]]));
    aplicar(c.key, patch);
    const erro = await salvarCampo(c.row, def.campo, valor, modulo, { historico: def.historico });
    if (erro) { aplicar(c.key, antes); mostrar({ msg: `Não gravou: ${erro}`, erro: true }); return false; }
    // 07/10/26: a previsão do material é a do PC — PC nascido no painel recebe a data (sql/103)
    if (campo === "prevMateriais" && c.pc) {
      void fetch("/api/compras/previsao", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa: c.row.empresa, numero: c.pc, data: valor }) }).catch(() => null);
    }
    return true;
  }, [aplicar, modulo, mostrar]);

  /* Incluir um PC numa RC (01/10/2026): vai para as linhas da RC ainda sem
     PC; se todas já têm, cria uma linha manual só com RC + nº do PC. Depois
     recarrega o pedido — o PC entra na lista logo abaixo dos outros, já com
     fornecedor/valor/status do Omie, sem deixar buraco. */
  const incluirPc = useCallback(async (p: Pedido, rc: string, itens: Compra[], numero: string) => {
    const pc = numero.trim();
    if (!pc) return;
    if (itens.some((c) => c.pc === pc)) { mostrar({ msg: `O PC ${pc} já está nesta RC.`, erro: true }); return; }
    const semPc = itens.filter((c) => !c.pc);
    // PC que já está no pedido sem RC (ex.: PC do Omie ligado ao PV): só
    // pendura-o nesta RC, em vez de duplicar a linha.
    const solto = p.compras.find((c) => c.pc === pc && !c.rcNumero);
    if (solto && rc) {
      if (!(await gravar(solto, "rcNumero", rc, { rc_numero: rc }))) return;
    } else if (semPc.length) {
      for (const c of semPc) if (!(await gravar(c, "pc", pc, { pc_numero_manual: pc }))) return;
    } else {
      const head = itens[0]?.row ?? p.bucket.rows[0] ?? {};
      const erro = await novaLinhaPc(head, rc, pc, modulo);
      if (erro) { mostrar({ msg: `Não gravou: ${erro}`, erro: true }); return; }
    }
    mostrar({ msg: `PC ${pc} incluído — buscando dados no Omie…` });
    try {
      const novas = await recarregarPedido(p);
      const achou = novas.some((x) => s(x.pc_numero_manual) === pc && s(x.nome_fornecedor));
      mostrar(achou ? { msg: `PC ${pc} incluído.` }
        : { msg: `PC ${pc} gravado, mas não foi encontrado no Omie ainda — confira o número ou clique em Sync agora.`, erro: true });
    } catch (e) {
      mostrar({ msg: `PC ${pc} gravado; recarregue a página para ver os dados (${e instanceof Error ? e.message : e}).`, erro: true });
    }
  }, [gravar, mostrar, modulo, recarregarPedido]);

  /* Status do material por item, marcado à mão (01/10/2026). Grava pelo
     servidor — quem marcou e quando vêm da sessão. */
  const marcarMaterial: MarcarMaterial = useCallback(async (c, status, qtd, silencioso) => {
    const r = await fetch("/api/pedidos/material", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ empresa: s(c.row.empresa), ncod_ped: c.row.ncod_ped, modulo, status, qtd }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { if (!silencioso) mostrar({ msg: `Não gravou: ${j.error ?? r.statusText}`, erro: true }); return false; }
    const cf: Record<string, unknown> = { ...((c.row.custom_fields as Record<string, unknown> | null) ?? {}) };
    if (j.mat_status) cf.mat_status = j.mat_status; else delete cf.mat_status;
    aplicar(c.key, { custom_fields: cf });
    if (!silencioso) mostrar({ msg: status ? `Material: ${MAT_MANUAL.find((x) => x.v === status)?.t}` : "Material volta ao automático" });
    return true;
  }, [aplicar, modulo, mostrar]);
  /* Mesmo material para vários itens de uma vez (título da coluna ou barra de
     seleção). Item já recebido pela NF de entrada fica de fora. */
  const marcarMaterialLote: MarcarMaterialLote = useCallback(async (lista, status) => {
    const alvo = lista.filter((c) => c.recebidoEm == null && (c.matManual?.v ?? null) !== status);
    if (!alvo.length) { mostrar({ msg: "Nada a mudar — os itens já estão assim (ou já chegaram pela NF)." }); return; }
    let ok = 0; const fila = [...alvo];
    await Promise.all(Array.from({ length: 4 }, async () => { for (let c = fila.shift(); c; c = fila.shift()) if (await marcarMaterial(c, status, undefined, true)) ok++; }));
    const rot = status ? MAT_MANUAL.find((x) => x.v === status)?.t : "automático";
    mostrar(ok === alvo.length ? { msg: `${ok} ite${ok === 1 ? "m" : "ns"}: material ${rot}` }
      : { msg: `${ok} de ${alvo.length} itens gravados — os outros foram recusados (sem permissão?)`, erro: true });
  }, [marcarMaterial, mostrar]);

  const selCompras = useMemo(() => [...sel].map((k) => compraPorKey.get(k)).filter(Boolean) as Compra[], [sel, compraPorKey]);
  const emMassa = async (status: string, lista?: Compra[]) => {
    const todos = (lista ?? selCompras).filter((c) => c.temPc);
    const nativos = todos.filter((c) => Number(c.row.ncod_ped) < 0);
    if (nativos.length && STATUS_COMPRAS[status]) {
      const e = await decidirPcNativo(nativos.map((c) => c.row), STATUS_COMPRAS[status]);
      if (e) mostrar({ msg: `PCs do Compras: ${e}`, erro: true });
      else for (const c of nativos) aplicar(c.key, { status });
    }
    const alvo = todos.filter((c) => Number(c.row.ncod_ped) > 0);
    if (!alvo.length && nativos.length) { setSel(new Set()); return; }
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

  /* Menu "★ Projetos ativos": todos os projetos da lista (os ativos marcados) + ativos que não têm
     PV/PC aqui (só o nome do cadastro). Escolher abre o cartão já expandido e rola até ele. */
  const itensMenu = useMemo<ItemMenu[]>(() => {
    if (modulo !== "projetos") return [];
    const m = new Map<string, ItemMenu>();
    for (const p of pedidos) {
      const k = projDe(p); if (!k) continue;
      const ch = chaveProjeto(k.empresa, k.codigo);
      if (!m.has(ch)) m.set(ch, { empresa: k.empresa, codigo: k.codigo, nome: p.id, cliente: p.cliente || null, ativo: pa.chaves.has(ch) });
    }
    for (const a of pa.lista) {
      const ch = chaveProjeto(a.empresa, a.codigo_projeto);
      if (!m.has(ch)) m.set(ch, { empresa: a.empresa, codigo: a.codigo_projeto, nome: a.nome || `Projeto ${a.codigo_projeto}`, cliente: a.cliente, ativo: true });
    }
    return [...m.values()];
  }, [modulo, pedidos, projDe, pa.chaves, pa.lista]);
  const irPara = (it: ItemMenu) => {
    const alvo = pedidos.find((p) => { const k = projDe(p); return !!k && k.empresa === it.empresa && k.codigo === it.codigo; });
    if (!alvo) { window.location.href = `/projetos/${it.codigo}/materiais?empresa=${encodeURIComponent(it.empresa)}`; return; }
    if (filtroAtivos && !it.ativo) setSoAtivosSt(false);
    if (!noEscopo(alvo, escopo)) setEscopo("todos");
    // busca/filtros que esconderiam o projeto saem do caminho
    if (!visiveis.some((x) => x.p.id === alvo.id)) { setMarcados([]); setQ(""); setPeriodo("tudo"); setFiltros({}); }
    setLimite((l) => Math.max(l, pedidos.length));
    if (vista !== "lista") trocarVista("lista");
    setAbertos((x) => new Set(x).add(alvo.id));
    setTimeout(() => document.querySelector(`[data-pid="${CSS.escape(alvo.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };
  const alternarAtivo = (it: ItemMenu, ativo: boolean) => {
    void pa.alternar({ empresa: it.empresa, codigo_projeto: it.codigo, nome: it.nome, cliente: it.cliente ?? null }, ativo)
      .then((erro) => mostrar(erro ? { msg: `Não foi possível ${ativo ? "marcar" : "desmarcar"} ${it.nome}: ${erro}`, erro: true }
        : { msg: ativo ? `★ ${it.nome} marcado como ativo` : `${it.nome} saiu dos ativos`,
            desfazer: () => { void pa.alternar({ empresa: it.empresa, codigo_projeto: it.codigo, nome: it.nome, cliente: it.cliente ?? null }, !ativo); } }));
  };
  const podeMarcarAtivo = podeEditar || ehAdmin;

  // ── render ────────────────────────────────────────────────────────────
  const rotulo = modulo === "projetos" ? "projeto" : modulo === "pcs" ? "PC" : "pedido";
  const nomeId = (p: Pedido) => (modulo === "pcs" ? `PC ${p.id}` : p.id);
  const kpiBuckets = useMemo(() => visiveis.map(({ p }) => p.bucket), [visiveis]);
  const totalCompras = visiveis.reduce((a, x) => a + x.compras.length, 0);
  const drawerCompra = drawer ? compraPorKey.get(drawer) ?? null : null;

  /* ── Projetos: lista no desenho da spec A2 (08/10/26) ──
     Acima da lista só duas faixas: o topo (título, busca, visão) e UMA barra de filtros.
     Os filtros de atenção viram chips com bolinha da cor da severidade (vermelho = atraso,
     âmbar = aprovação/serviço, cinza = "sem"); os menos usados ficam em "≡ Mais filtros".
     Os indicadores (KpisNavy) ficam atrás do botão 📊 — a escolha fica gravada. */
  const pj = (modulo as string) === "projetos";
  const [verKpis, setVerKpisSt] = useState(false);
  useEffect(() => { if (!pj) return; try { setVerKpisSt(localStorage.getItem("op:projetos:kpis") === "1"); } catch { /* */ } }, [pj]);
  const alternarKpis = () => setVerKpisSt((v) => { try { localStorage.setItem("op:projetos:kpis", v ? "0" : "1"); } catch { /* */ } return !v; });
  type ChipAtencao = { k: Rapida; l: string; n: number; tom: "crit" | "warn" | "mute" | "ok" | "info"; desc: string; fixo: boolean };
  const chipsAtencao: ChipAtencao[] = !pj ? [] : [
    { k: "venda_atraso", l: "Venda em atraso", n: rapidas.venda_atraso, tom: "crit", desc: ALARMES["venda em atraso"].desc, fixo: true },
    { k: "compra_atraso", l: "Compra em atraso", n: rapidas.compra_atraso, tom: "crit", desc: ALARMES["compra em atraso"].desc, fixo: true },
    { k: "recusa", l: "Recusados", n: rapidas.recusa, tom: "crit", desc: ALARMES["recusa a resolver"].desc, fixo: true },
    { k: "mat_alarme", l: "Sem NF há +5d", n: rapidas.mat_alarme, tom: "crit", desc: ALARMES["material sem NF"].desc, fixo: true },
    { k: "minha", l: "Minha aprovação", n: rapidas.minha, tom: "warn", desc: ALARMES["aprovação pendente"].desc, fixo: true },
    { k: "serv_atraso", l: "Serviço em atraso", n: rapidas.serv_atraso, tom: "warn", desc: ALARME_SERV.atraso.desc, fixo: true },
    { k: "sem_pc", l: "Sem PC", n: rapidas.sem_pc, tom: "mute", desc: ALARMES["sem PC"].desc, fixo: true },
    { k: "serv_semos", l: "Sem OS", n: rapidas.serv_semos, tom: "mute", desc: ALARME_SERV.semos.desc, fixo: true },
    { k: "mat_sem_nf", l: "Recebido sem NF", n: rapidas.mat_sem_nf, tom: "warn", desc: "Itens com material recebido, NF de entrada ainda não lançada", fixo: false },
    { k: "mat_parcial", l: "Material parcial", n: rapidas.mat_parcial, tom: "warn", desc: "Itens recebidos em parte", fixo: false },
    { k: "mat_estoque", l: "Em estoque", n: rapidas.mat_estoque, tom: "info", desc: "Itens atendidos do estoque (não precisam de compra)", fixo: false },
    ...STATUS_SERVICO.map((st): ChipAtencao => ({ k: `serv_st:${st.rotulo}` as Rapida, l: `Serviço: ${st.rotulo}`, n: rapidas[`serv_st:${st.rotulo}` as Rapida] ?? 0,
      tom: st.tom === "crit" || st.tom === "warn" || st.tom === "ok" || st.tom === "info" ? st.tom : "mute", desc: `Serviço: ${st.desc}`, fixo: false })),
  ];
  const corTom = (t: ChipAtencao["tom"]) => (t === "crit" ? "var(--ww-crit)" : t === "warn" ? "var(--ww-warn)" : t === "ok" ? "var(--ww-ok)" : t === "info" ? "var(--ww-info)" : "var(--ww-text-faint)");
  const fchip = (c: ChipAtencao) => (
    <button key={c.k} type="button" className={`fchip ${marcados.includes(c.k) ? "on" : ""}`} style={{ "--k": corTom(c.tom) } as React.CSSProperties}
      onClick={() => alternar(c.k)} title={`${c.desc}${marcados.length && !marcados.includes(c.k) ? " · combina com os filtros marcados" : ""}`}>
      <i />{c.l}<span className="n">{c.n}</span>
    </button>
  );
  const nMaisAtivos = chipsAtencao.filter((c) => !c.fixo && marcados.includes(c.k)).length;

  return (
    <CadeiaCtx.Provider value={cadeia}>
    <div className={`op op-wrap op-${modulo}`} onClick={() => { setMenu(null); }}>
      {pj && (
        <>
          {/* ── faixa 1 · topo: título + contagem · ★ ativos · busca · visão ── */}
          <div className="pj-topo" onClick={(e) => e.stopPropagation()}>
            <div className="pj-tit">
              <div className="crumb">Operação › {title}</div>
              <div className="pj-tit-l">
                <h1>{title}</h1>
                <span className="cnt">{noScope.length} projetos · {noScope.reduce((a, p) => a + p.compras.length, 0)} compras</span>
                <SyncNowButton />
              </div>
            </div>
            {/* 09/10/26: busca logo a seguir ao título, à esquerda (regra do painel) */}
            <div className="search pj-busca">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input ref={buscaRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar PV, OS, PC, cliente ou fornecedor…" />
              <span className="kbd">⌘ K</span>
            </div>
            <span className="pj-sp" />
            <ProjetosAtivosMenu itens={itensMenu} onEscolher={irPara} onAlternar={alternarAtivo} pode={podeMarcarAtivo} disponivel={pa.disponivel} />
            {pa.disponivel === true && (
              <button type="button" className="btn sm" onClick={() => setPainelAtivos(true)}
                title="Escolher os projetos ativos (em andamento, em que se está atuando) — vale para todo mundo">⚙ Ativos</button>
            )}
            <div className="seg sm">
              {([["lista", "Lista"], ["tabela", "Tabela"], ["kanban", "Kanban"], ["tempo", "Linha do tempo"]] as const).map(([k, l]) => (
                <button key={k} className={vista === k ? "on" : ""} onClick={() => trocarVista(k)}>{l}</button>
              ))}
            </div>
            <div className="menu">
              <button className="btn sm ghost" title="Mais" onClick={() => setMenu(menu === "mais" ? null : "mais")}>•••</button>
              <div className={`pop ${menu === "mais" ? "open" : ""}`}>
                <div style={{ padding: "4px 6px" }}>
                  <PcsExcluidosButton linhas={escondidos} onMudou={() => { carregarEscondidos(); }} />
                  {escondidos.length === 0 && <span style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>🚫 PCs escondidos · 0</span>}
                </div>
                <button onClick={() => { setMenu(null); alternarKpis(); }}>📊 {verKpis ? "Esconder os indicadores" : "Mostrar os indicadores"}</button>
                <button onClick={() => { setMenu(null); setLogAberto(true); }}>🕘 Log de alterações</button>
                <div className="sep" />
                <button onClick={() => { setMenu(null); trocarVista("tabela"); }}>⚙️ Colunas e preferências</button>
                <button onClick={() => { window.location.search = "?classica=1"; }}>↩ Tela antiga (conferência)</button>
              </div>
            </div>
          </div>

          {/* ── faixa 2 · uma barra de filtros ── */}
          <div className="pj-filtros" onClick={(e) => e.stopPropagation()}>
            <div className="pj-frow">
              {pa.disponivel === true && (
                <>
                  <span className="lab">Mostrar</span>
                  <div className="seg sm" role="group" aria-label="Quais projetos mostrar">
                    <button className={soAtivos && pa.chaves.size > 0 ? "on" : ""} disabled={pa.chaves.size === 0}
                      title={pa.chaves.size ? "Mostra só os projetos marcados com ★" : "Nenhum projeto marcado com ★ ainda — clique em ⚙ Ativos"}
                      onClick={() => setSoAtivos(true)}>★ Só ativos <b>{nAtivosNaLista}</b></button>
                    <button className={!filtroAtivos ? "on" : ""} onClick={() => setSoAtivos(false)} title={parcialAtivos ? "Carregando os demais projetos…" : "Mostra todos os projetos (★ ativos primeiro)"}>Todos <b>{parcialAtivos ? "…" : pedidos.length}</b></button>
                  </div>
                  <span className="sep" />
                </>
              )}
              <span className="lab">Situação</span>
              <div className="seg sm">
                {(["aberto", "faturado", "todos"] as const).map((k) => (
                  <button key={k} className={escopo === k ? "on" : ""} onClick={() => setEscopo(k)}
                    title={`${parcial && k !== "aberto" ? "carregando…" : $(contagem[k][1])}${k === "aberto" ? " · não faturados" : k === "faturado" ? " · NF de saída emitida" : ""}`}>
                    {k === "faturado" ? "✓ Faturados" : k === "aberto" ? "Em aberto" : "Todos"} <b>{parcial && k !== "aberto" ? "…" : contagem[k][0]}</b>
                  </button>
                ))}
              </div>
              <span className="sep" />
              <span className="lab">Período</span>
              <div className="seg sm">
                {([["tudo", "Tudo", ""], ["7", "7 dias", "Emitidos (entraram no painel) nos últimos 7 dias"], ["30", "30 dias", "Emitidos (entraram no painel) nos últimos 30 dias"],
                  ["vence7", "Vence em 7d", "Prazo limite nos próximos 7 dias"], ["vencidos", "Vencidos", "Prazo limite já passou"]] as const).map(([k, l, t]) => (
                  <button key={k} className={periodo === k ? "on" : ""} title={t || undefined} onClick={() => setPeriodo(k)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="pj-frow">
              <span className="lab">Atenção</span>
              <button type="button" className={`fchip todos ${marcados.length === 0 ? "on" : ""}`} onClick={() => setMarcados([])}><b>Todos</b><span className="n">{rapidas.todos}</span></button>
              {chipsAtencao.filter((c) => marcados.includes(c.k) || (c.fixo && c.n > 0)).map(fchip)}
              <span className="pj-sp" />
              {podeAprovar && marcados.includes("minha") && fila.length > 0 && fila.length <= 30 && (
                <button className="btn sm ok" onClick={() => {
                  if (!window.confirm(`Aprovar as ${fila.length} compras aguardando aprovação? Cada uma passa pela mesma checagem de alçada e orçamento.`)) return;
                  void emMassa("APROVADO", fila);
                }}>✓ Aprovar todas ({fila.length})</button>
              )}
              {temAlgumFiltro && <button className="btn sm ghost" onClick={limparTudo} title="Limpa filtros rápidos, busca, período e painel de filtros">✕ Limpar</button>}
              <div style={{ position: "relative" }}>
                <button className="btn sm ghost" onClick={() => setPainelFiltro((x) => !x)}>
                  ≡ Mais filtros {nFiltros + nMaisAtivos > 0 && <span className="count">{nFiltros + nMaisAtivos}</span>}
                </button>
                <PainelFiltros aberto={painelFiltro} filtros={filtros} opcoes={opcoes} modulo={modulo}
                  onAplicar={(f) => { setFiltros(f); setPainelFiltro(false); }} onMudar={setFiltros} onFechar={() => setPainelFiltro(false)}
                  extra={<div className="pj-mais">
                    <h4>Atenção — mais filtros</h4>
                    <div className="pj-mais-chips">
                      {chipsAtencao.filter((c) => !c.fixo && (c.n > 0 || marcados.includes(c.k))).map(fchip)}
                      {chipsAtencao.filter((c) => c.fixo && c.n === 0 && !marcados.includes(c.k)).map((c) => (
                        <span key={c.k} className="fchip zero" title={`${c.desc} — nenhum agora`} style={{ "--k": corTom(c.tom) } as React.CSSProperties}><i />{c.l}<span className="n">0</span></span>
                      ))}
                    </div>
                  </div>} />
              </div>
              <div className="menu">
                <button className="btn sm ghost" onClick={() => setMenu(menu === "visoes" ? null : "visoes")}>Visões salvas{visoes.length ? ` (${visoes.length})` : ""} ▾</button>
                <div className={`pop ${menu === "visoes" ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
                  {visoes.length === 0 && <div className="pj-pop-vazio">Nenhuma visão salva ainda.</div>}
                  {visoes.map((v) => (
                    <div key={v.nome} className="pj-visao">
                      <button onClick={() => { aplicarVisao(v); setMenu(null); }}>{v.nome}</button>
                      <button className="x" title="Apagar visão" onClick={() => removerVisao(v.nome)}>✕</button>
                    </div>
                  ))}
                  <div className="sep" />
                  <button onClick={() => { setMenu(null); salvarVisao(); }}>+ Salvar visão atual</button>
                </div>
              </div>
            </div>
            {nFiltros > 0 && (
              <div className="pj-frow tokens">
                {(Object.keys(filtros) as (keyof Filtros)[]).filter((k) => filtros[k]).map((k) => (
                  <span key={k} className="token"><span>{FILTRO_LABEL[k]}:</span> {k === "estado" ? ESTADO_LABEL[filtros[k] as Estado] : filtros[k]}
                    <button onClick={() => setFiltros((f) => ({ ...f, [k]: undefined }))}>✕</button></span>
                ))}
                <button className="linkbtn" onClick={() => setFiltros({})}>Limpar tudo</button>
              </div>
            )}
            {(avisoErro || pa.disponivel === false || (pa.disponivel && pa.chaves.size === 0)) && (
              <div className="pj-aviso">
                {avisoErro ? `Mostrando só os não faturados — a carga completa falhou (${avisoErro}). Recarregue a página para tentar de novo.`
                  : pa.disponivel === false ? "Marcação de projetos ativos ainda não ligada no banco — mostrando todos."
                  : "Nenhum projeto marcado como ativo ainda — clique em ⚙ Ativos para escolher os projetos em andamento."}
              </div>
            )}
          </div>

          {verKpis && (
            <div className="pj-kpis">
              <KpisNavy buckets={kpiBuckets} formatarValor={(v) => $(v)} rotuloPedido={rotulo} escopo={escopo === "faturado" ? "faturado" : escopo} />
            </div>
          )}

          {/* cabeçalho da lista: dica de uso + legenda das cores do trilho (sem colunas de tabela) */}
          <div className="pj-list-hd">
            <span className="dica">
              {visiveis.length} projeto{visiveis.length === 1 ? "" : "s"} · {totalCompras} compras
              {vista === "lista" && <> · clique no projeto para abrir{!filtroAtivos && pa.chaves.size > 0 ? " · ★ ativos primeiro" : ""}</>}
              {" · "}ordenado por{" "}
              <select className="pj-ord" value={ordem.k} onChange={(e) => setOrdem({ k: e.target.value as OrdemCampo, d: ordem.d })}>
                {([["pedido", "nº do projeto"], ["emissao", "emissão"], ["cliente", "cliente"], ["prazo", "prazo"], ["etapas", "etapas"], ["servico", "serviço"], ["pv", "venda"], ["pc", "compras"]] as const)
                  .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button type="button" className="linkbtn" title={ordem.d === -1 ? "Decrescente — clique para crescente" : "Crescente — clique para decrescente"}
                onClick={() => setOrdem({ k: ordem.k, d: ordem.d === 1 ? -1 : 1 })}>{ordem.d === -1 ? "↓" : "↑"}</button>
              {(vista === "lista" || vista === "tabela") && (
                <> · <button className="linkbtn" onClick={() => setAbertos(new Set(visiveis.map((x) => x.p.id)))}>expandir todos</button>
                  {" · "}<button className="linkbtn" onClick={() => setAbertos(new Set())}>recolher</button></>
              )}
            </span>
            {vista === "lista" && (
              <span className="pj-legenda" title="Cores do trilho de etapas de cada projeto">
                <span style={{ "--k": "var(--ww-ok)" } as React.CSSProperties}>concluído</span>
                <span style={{ "--k": "var(--ww-warn)" } as React.CSSProperties}>em andamento</span>
                <span style={{ "--k": "var(--ww-crit)" } as React.CSSProperties}>atrasado</span>
                <span style={{ "--k": "color-mix(in srgb,var(--ww-text-faint) 45%,transparent)" } as React.CSSProperties}>não iniciado</span>
              </span>
            )}
          </div>
        </>
      )}

      {painelAtivos && (
        <PainelAtivos itens={itensMenu} pode={podeMarcarAtivo} onFechar={() => setPainelAtivos(false)}
          onSalvar={async (mud) => {
            const e = await pa.salvarLote(mud.map((m) => ({ empresa: m.empresa, codigo_projeto: m.codigo, nome: m.nome, cliente: m.cliente ?? null, ativo: m.ativo })));
            if (!e) { setSoAtivos(true); mostrar({ msg: `Projetos ativos salvos (${mud.length} alteraç${mud.length === 1 ? "ão" : "ões"})` }); }
            return e;
          }} />
      )}

      {!pj && <>
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
            <span className="sl">{k === "faturado" ? "✓ Faturados" : k === "aberto" ? "Em aberto" : "Todos"} <b>{parcial && k !== "aberto" ? "…" : contagem[k][0]}</b></span>
            <small>{parcial && k !== "aberto" ? "carregando…" : $(contagem[k][1])}{k === "aberto" ? " · não faturados" : k === "faturado" ? " · NF de saída emitida" : ""}</small>
          </button>
        ))}
      </div>
      {escopo !== "aberto" && (
        <div className="scopeNote">
          Mostrando <b>{escopo === "faturado" ? "somente faturados" : "em aberto + faturados"}</b> —{" "}
          <button className="linkbtn" onClick={() => setEscopo("aberto")}>voltar para em aberto</button>
        </div>
      )}

      {avisoErro && (
        <div className="scopeNote" style={{ color: "var(--ww-danger-text, #f87171)" }}>
          Mostrando só os não faturados — a carga completa falhou ({avisoErro}). Recarregue a página para tentar de novo.
        </div>
      )}

      {/* ── KPIs (os de antes) ── */}
      <div style={{ marginTop: 14 }}>
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
          <button className="btn sm" onClick={() => { setMarcados(["minha"]); trocarVista("lista"); }}>Revisar fila</button>
          {fila.length <= 30 && <button className="btn sm ok" onClick={() => {
            if (!window.confirm(`Aprovar as ${fila.length} compras da fila? Cada uma passa pela mesma checagem de alçada e orçamento.`)) return;
            void emMassa("APROVADO", fila);
          }}>✓ Aprovar todas</button>}
        </div>
      )}

      {/* Busca e filtros logo acima da lista que eles filtram (01/10/2026). */}
      {/* ── barra de topo: busca · período · filtros · vista ── */}
      <div className="toolbar" style={{ marginTop: 22 }} onClick={(e) => e.stopPropagation()}>
        <div className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input ref={buscaRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={modulo === "pcs" ? "Buscar PC, fornecedor ou descrição…" : "Buscar PV, OS, PC, cliente ou fornecedor…"} />
          <span className="kbd">⌘ K</span>
        </div>
        <div className="seg">
          {([["tudo", "Tudo", ""], ["7", "Entrou 7 dias", "Emitidos (entraram no painel) nos últimos 7 dias"], ["30", "Entrou 30 dias", "Emitidos (entraram no painel) nos últimos 30 dias"],
            ["vence7", "Vence em 7 dias", "Prazo limite nos próximos 7 dias"], ["vencidos", "Vencidos", "Prazo limite já passou"]] as const).map(([k, l, t]) => (
            <button key={k} className={periodo === k ? "on" : ""} title={t || undefined} onClick={() => setPeriodo(k)}>{l}</button>
          ))}
        </div>
        <div style={{ position: "relative" }}>
          <button className="btn" onClick={() => setPainelFiltro((x) => !x)}>
            ☰ Filtros {nFiltros > 0 && <span className="count">{nFiltros}</span>}
          </button>
          <PainelFiltros aberto={painelFiltro} filtros={filtros} opcoes={opcoes} modulo={modulo}
            onAplicar={(f) => { setFiltros(f); setPainelFiltro(false); }} onMudar={setFiltros} onFechar={() => setPainelFiltro(false)} />
        </div>
        <div className="seg">
          {([["lista", "Lista"], ["tabela", "Tabela"], ["kanban", "Kanban"], ["tempo", "Linha do tempo"]] as const).map(([k, l]) => (
            <button key={k} className={vista === k ? "on" : ""} onClick={() => trocarVista(k)}>{l}</button>
          ))}
        </div>
      </div>

      {/* ── visões rápidas + salvas ── */}
      <div className="qv">
        {(() => {
          const G: [string, [Rapida, string, number, AlarmeIcone][]][] = [
            ["Faturamento", [
              ["pode_fat", "Pode faturar", rapidas.pode_fat, ALARME_PODE_FAT],
              ["venda_atraso", "Venda em atraso", rapidas.venda_atraso, ALARMES["venda em atraso"]],
            ]],
            ["Compras", [
              ["compra_atraso", "Compra em atraso", rapidas.compra_atraso, ALARMES["compra em atraso"]],
              ["minha", "Minha aprovação", rapidas.minha, ALARMES["aprovação pendente"]],
              ["recusa", "Recusados", rapidas.recusa, ALARMES["recusa a resolver"]],
              ["sem_pc", "Sem PC", rapidas.sem_pc, ALARMES["sem PC"]],
              ["mat_alarme", "Sem NF há +5d", rapidas.mat_alarme, ALARMES["material sem NF"]],
              ["mat_sem_nf", "Recebido sem NF", rapidas.mat_sem_nf, { l: "", s: "", tom: "warn", desc: "Itens com material recebido, NF de entrada ainda não lançada", rap: "mat_sem_nf" }],
              ["mat_parcial", "Parcial", rapidas.mat_parcial, { l: "", s: "", tom: "warn", desc: "Itens recebidos em parte", rap: "mat_parcial" }],
              ["mat_estoque", "Em estoque", rapidas.mat_estoque, { l: "", s: "", tom: "info", desc: "Itens atendidos do estoque (não precisam de compra)", rap: "mat_estoque" }],
            ]],
            ["Serviços", [
              ["serv_atraso", "Serviço em atraso", rapidas.serv_atraso, ALARME_SERV.atraso],
              ...STATUS_SERVICO.map((st) => [`serv_st:${st.rotulo}` as Rapida, st.rotulo, rapidas[`serv_st:${st.rotulo}` as Rapida] ?? 0,
                { l: "", s: "", tom: st.tom, desc: `Serviço: ${st.desc}`, rap: `serv_st:${st.rotulo}` as Rapida } as AlarmeIcone] as [Rapida, string, number, AlarmeIcone]),
              ["serv_semos", "Sem OS", rapidas.serv_semos, ALARME_SERV.semos],
            ]],
          ];
          const vale = ([k, , n]: [Rapida, string, number, AlarmeIcone]) =>
            (marcados.includes(k) || n > 0)
            && !(modulo === "pcs" && (k === "sem_pc" || k === "venda_atraso" || k === "pode_fat"))
            && (modulo !== "pcs" || !k.startsWith("serv_"))
            && (modulo === "avulsos" || k !== "pode_fat");
          const chip = ([k, l, n, ic]: [Rapida, string, number, AlarmeIcone]) => (
            <button key={k} className={`chip ${marcados.includes(k) ? "on" : ""}`} onClick={() => alternar(k)}
              title={`${ic.desc}${marcados.length && !marcados.includes(k) ? " · combina com os filtros marcados" : ""}`}>
              {k.startsWith("serv_st:") || (k.startsWith("mat_") && k !== "mat_alarme") ? <span className={`pip-st ${ic.tom}`} /> : <Alm a={ic} chip />}{l} <b>{n}</b>
            </button>
          );
          return (
            <>
              <button className={`chip ${marcados.length === 0 ? "on" : ""}`} onClick={() => setMarcados([])}>Todos <b>{rapidas.todos}</b></button>
              {G.map(([nome, itens]) => {
                const vis = itens.filter(vale);
                if (!vis.length) return null;
                return (
                  <span key={nome} className="qv-g">
                    <span className="qv-gl">{nome}</span>
                    {vis.map(chip)}
                  </span>
                );
              })}
            </>
          );
        })()}
        {temAlgumFiltro && (
          <button className="chip limpar" onClick={limparTudo} title="Limpa filtros rápidos, busca, período e painel de filtros">✕ Limpar filtros</button>
        )}
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

      {/* ── cabeçalho da lista ── */}
      <div className="section-h">
        <span>
          {visiveis.length} {rotulo === "PC" ? "PCs" : `${rotulo}s`} · {totalCompras} compras
          {vista === "lista" && " · clique no pedido para abrir as compras"}
          <span className="legend"><i className="d" />concluído<i className="p" />em andamento<i className="l" />atrasado / bloqueado<i className="o" />não iniciado<i className="na" />não se aplica</span>
        </span>
        {(vista === "lista" || vista === "tabela") && (
          <span>
            <button className="linkbtn" onClick={() => setAbertos(new Set(visiveis.map((x) => x.p.id)))}>Expandir todos</button> ·{" "}
            <button className="linkbtn" onClick={() => setAbertos(new Set())}>Recolher</button>
          </span>
        )}
      </div>
      </>}

      {visiveis.length === 0 && (
        <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--ww-text-faint)" }}>
          Nada com estes filtros.
          {q.trim().length >= 2 && (
            <OndeEsta q={q} modulo={modulo} naTela={naTelaSemFiltros}
              onMostrarTudo={() => { setMarcados([]); setPeriodo("tudo"); setFiltros({}); setEscopo("todos"); if (modulo === "projetos") setSoAtivosSt(false); }} />
          )}
        </div>
      )}

      {vista === "lista" && (
        <>
          {visiveis.length > 0 && !pj && (
            <div className="pvh pvcols">
              <span />
              <span><OrdCab k="pedido" l={rotulo} o={ordem} on={ordenarPor} /> · <OrdCab k="emissao" l="emissão" o={ordem} on={ordenarPor} /></span>
              <span><OrdCab k="cliente" l={modulo === "pcs" ? "Fornecedor" : "Cliente"} o={ordem} on={ordenarPor} /> · alertas</span>
              <span><OrdCab k="etapas" l="Etapas" o={ordem} on={ordenarPor} /></span><span><OrdCab k="prazo" l="Prazo" o={ordem} on={ordenarPor} /></span>
              {modulo !== "pcs" && <span><OrdCab k="servico" l="Serviço" o={ordem} on={ordenarPor} /></span>}
              <span style={{ textAlign: "center" }}><OrdCab k="rc" l="RC" o={ordem} on={ordenarPor} /> · <OrdCab k="pc" l="PC" o={ordem} on={ordenarPor} /> · <OrdCab k="pv" l="PV" o={ordem} on={ordenarPor} /> · {modulo === "projetos" ? <span>M. proj. · M. real</span> : <OrdCab k="mb" l="M.B." o={ordem} on={ordenarPor} />}</span>
            </div>
          )}
          {visiveis.slice(0, limite).map(({ p, compras }) => (
            <CartaoPedido key={p.id} p={p} compras={compras} modulo={modulo} aberto={abertos.has(p.id)}
              propostas={[...new Set([p.id, ...p.bucket.rows.map((r) => s(r.pv_os_label))].map((l) => propostas[String(l).toUpperCase()]).filter(Boolean))]}
              ocs={modulo === "pcs" ? undefined : pvosDe(p).map((label) => ({ label, r: ocMapa.get(`${(s(p.bucket.rows[0]?.empresa) || "SF").toUpperCase()}|${label}`) }))}
              onToggle={() => toggleAberto(p.id)} nomeId={nomeId(p)} $={$}
              sel={sel} toggleSel={toggleSel} podeAprovar={podeAprovar} podeEditar={podeEditar} ehAdmin={ehAdmin}
              setStatus={setStatus} gravar={gravar} abrirDrawer={setDrawer} abrirAtrib={abrirAtrib} atrib={atrib}
              bucket={bucketPorId.get(p.id)} budgetMap={budgetMap} verValores={verValores}
              liberacao={modulo === "avulsos" ? { ativo: liberacao.has(p.id), pode: podeLiberar, alternar: () => void liberar(p) } : null}
              excluirPv={ehAdmin && modulo !== "pcs" ? () => void excluirPv(p) : null}
              statusLote={(lista, st) => {
                if (st === "CANCELAR_PEDIDO" && lista[0]?.pc) { abrirAjustePc("cancelar", lista); return; }
                if (lista.length === 1) void setStatus(lista[0], st); else void emMassa(st, lista);
              }}
              ajuste={{ abrir: abrirAjustePc, tick: tickAjuste, pode: podeAjustarPc, aoDesfazer: () => window.location.reload() }}
              incluirPc={(rc, itens, numero) => incluirPc(p, rc, itens, numero)}
              gerarPc={(rc, itens) => setGerarPcDe({ p, rc, itens })}
              filtrarRapida={(r) => { setMarcados((m) => (m.includes(r) ? m : [...m, r])); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              notas={notas[p.id] ?? []} abrirNotas={() => setNotasDe(p)} marcarMaterial={marcarMaterial} marcarMaterialLote={marcarMaterialLote}
              estrela={modulo === "projetos" && pa.disponivel === true ? (() => {
                const k = projDe(p); if (!k) return null;
                const it: ItemMenu = { empresa: k.empresa, codigo: k.codigo, nome: p.id, cliente: p.cliente || null, ativo: ehAtivo(p) };
                return { ativo: it.ativo, pode: podeMarcarAtivo, alternar: () => alternarAtivo(it, !it.ativo) };
              })() : null} />
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
        onMaterial={modulo !== "pcs" && podeEditar ? (st) => { void marcarMaterialLote(selCompras, st); setSel(new Set()); } : undefined}
        onCancelar={() => setSel(new Set())} />

      {/* ── gaveta ── */}
      {ajustePc?.acao === "cancelar" && (
        <ModalCancelarPc empresa={ajustePc.empresa} numero={ajustePc.pc} fornecedor={ajustePc.fornecedor} valor={ajustePc.valor}
          codigoProjeto={ajustePc.codigoProjeto} onFechar={() => setAjustePc(null)}
          onFeito={(r) => {
            setAjustePc(null);
            setOcultosPc((x) => new Set(x).add(`${ajustePc.empresa}|${ajustePc.pc}`));
            setTickAjuste((t) => t + 1);
            mostrar({ msg: `PC ${r.numero} cancelado${r.linhas_liberadas ? ` · ${r.linhas_liberadas} linha(s) da Lista voltaram a "sem PC"` : ""}${r.cancelar_no_omie ? " — é do Omie: cancele também no Omie" : ""}`, erro: r.cancelar_no_omie });
          }} />
      )}
      {ajustePc?.acao === "devolver" && (
        <ModalDevolverPc empresa={ajustePc.empresa} numero={ajustePc.pc} codigoProjeto={ajustePc.codigoProjeto} onFechar={() => setAjustePc(null)}
          onFeito={(r) => {
            const ped = porId.get(ajustePc.pedidoId);
            setAjustePc(null);
            setTickAjuste((t) => t + 1);
            if (ped) void recarregarPedido(ped).catch(() => null);
            mostrar({ msg: `Devolução ${r.tipo} do PC ${r.numero} registrada (${brl(r.valor)} saem do projeto)${r.linhas_liberadas ? ` · ${r.linhas_liberadas} linha(s) da Lista voltaram a "sem PC"` : ""}` });
          }} />
      )}
      {gerarPcDe && (
        <GerarPcDaRc rc={gerarPcDe.rc} empresa={s(gerarPcDe.p.bucket.rows[0]?.empresa) || "SF"}
          itensRc={gerarPcDe.itens.map((c) => Number((c.row.custom_fields as Record<string, unknown> | null)?.rc_compras)).filter((x) => Number.isFinite(x) && x > 0)}
          onFechar={() => setGerarPcDe(null)}
          onFeito={(num) => {
            const alvo = gerarPcDe.p;
            setGerarPcDe(null);
            mostrar({ msg: `Pedido de compra ${num} criado e ligado à RC ${gerarPcDe.rc} — segue para aprovação em Compras.` });
            void recarregarPedido(alvo).catch(() => null);
          }} />
      )}
      <Gaveta compra={drawerCompra} pedido={drawerCompra ? porId.get(drawerCompra.pedidoId) ?? null : null}
        onFechar={() => setDrawer(null)} $={$} podeAprovar={podeAprovar} podeEditar={podeEditar} ehAdmin={ehAdmin}
        setStatus={setStatus} gravar={gravar} />
      <LogAlteracoes aberto={logAberto} onFechar={() => setLogAberto(false)} compras={noScope.flatMap((p) => p.compras)} />

      {atribEdit && (
        <AtribuicaoModal pc={atribEdit} onClose={() => setAtribEdit(null)} onSaved={() => { setAtribEdit(null); setAtribTick((t) => t + 1); }} />
      )}

      {notasDe && (
        <PainelNotas p={notasDe} modulo={modulo} notas={notas[notasDe.id] ?? []}
          onFechar={() => setNotasDe(null)}
          onMudou={(lista) => setNotas((m) => ({ ...m, [notasDe.id]: lista }))}
          eu={user?.id ?? null} admin={ehAdmin} />
      )}
      <div className={`toast ${toast ? "show" : ""}`} style={toast?.erro ? { background: "var(--ww-crit)", color: "#fff" } : undefined}>
        <span>{toast?.msg}</span>
        {toast?.desfazer && <button onClick={() => { const d = toast.desfazer; setToast(null); d?.(); }}>Desfazer</button>}
        <button onClick={() => setToast(null)} style={{ color: "inherit", opacity: 0.6 }}>✕</button>
      </div>
    </div>
    </CadeiaCtx.Provider>
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
/** Filtros aplicam na hora em que a opção é escolhida (01/10/2026) — antes
 *  dependiam de um "Aplicar" que ficava fora da tela. */
function PainelFiltros({ aberto, filtros, opcoes, modulo, onAplicar, onMudar, onFechar, extra }: {
  aberto: boolean; filtros: Filtros; modulo: Modulo;
  /** Projetos (spec A2): os chips de atenção menos usados moram aqui. */
  extra?: React.ReactNode;
  opcoes: { tipo: string[]; etapaVenda: string[]; projeto: string[]; fornecedor: string[]; categoria: string[] };
  onAplicar: (f: Filtros) => void; onMudar: (f: Filtros) => void; onFechar: () => void;
}) {
  const [f, setF] = useState<Filtros>(filtros);
  useEffect(() => { if (aberto) setF(filtros); }, [aberto, filtros]);
  const campo = (k: keyof Filtros, lab: string, ops: string[], todos = "Todos", labels?: (v: string) => string) => (
    <div className="field">
      <label>{lab}</label>
      <select value={f[k] ?? ""} onChange={(e) => { const n = { ...f, [k]: e.target.value || undefined }; setF(n); onMudar(n); }}>
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
            {campo("tipo", "Tipo de venda", opcoes.tipo)}
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
      {extra}
      <footer>
        <button className="btn ghost sm" onClick={() => { setF({}); onAplicar({}); }}>Limpar</button>
        <button className="btn primary sm" onClick={onFechar}>Fechar</button>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
/** Selos Pago / Receb. por pedido — o mapa vem de /api/rentabilidade. */
const CadeiaCtx = createContext<Record<string, RentabResumo>>({});

/** Resumo da cadeia do pedido. Projeto junta vários PV/OS: pago e recebido
 *  só quando TODOS estão. */
function cadeiaDoPedido(p: Pedido, mapa: Record<string, RentabResumo>): RentabResumo | null {
  const doPedido = [...new Set(p.bucket.rows.filter((r) => r.pv_os_label).map((r) => chaveRentab(s(r.empresa), s(r.pv_os_label))))]
    .map((k) => mapa[k]).filter(Boolean);
  if (!doPedido.length) return null;
  if (doPedido.length === 1) return doPedido[0];
  const prs = doPedido.map((x) => x.pct_recebido).filter((x): x is number => x != null);
  return {
    n_pc: doPedido.reduce((a, x) => a + x.n_pc, 0),
    n_pago: doPedido.reduce((a, x) => a + x.n_pago, 0),
    pago_ok: doPedido.every((x) => x.pago_ok || x.n_pc === 0) && doPedido.some((x) => x.n_pc > 0),
    faturado: doPedido.every((x) => x.faturado),
    recebido_ok: doPedido.every((x) => x.recebido_ok),
    pct_recebido: prs.length ? prs.reduce((a, x) => a + x, 0) / prs.length : null,
  };
}

export function FasesBar({ p, modulo }: { p: Pedido; modulo: string }) {
  const mapa = useContext(CadeiaCtx);
  const { lista, atual } = fases(p, modulo, cadeiaDoPedido(p, mapa));
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

type MarcarMaterial = (c: Compra, status: MatManual["v"] | null, qtd?: number, silencioso?: boolean) => Promise<boolean>;
type MarcarMaterialLote = (lista: Compra[], status: MatManual["v"] | null) => Promise<void>;

/** Material do item: a NF de entrada do Omie manda (só leitura); senão o time
 *  marca Em estoque / Recebido sem NF / Parcial (com qtd) / Não vai mais. */
function MatCelula({ c, podeEditar, marcar }: { c: Compra; podeEditar: boolean; marcar: MarcarMaterial }) {
  const m = materialDoItem(c);
  const [qtdAberta, setQtdAberta] = useState(false);
  const [qtd, setQtd] = useState<string>(String(c.matManual?.qtd ?? ""));
  const quem = c.matManual?.por ? `Marcado por ${c.matManual.por}${c.matManual.em ? ` em ${dataHora(c.matManual.em)}` : ""}` : "";
  if (m.k === "recebido" || !podeEditar) {
    return <span className={`st mat ${m.tom}`} title={m.k === "recebido" ? (c.recebidoEm != null ? `NF de entrada ${c.nfFornecedor || ""} · ${dBR(c.recebidoEm)}` : `Recebido pela NF de entrada dos PCs ${(c.pcsRef ?? []).map((x) => x.pc).join(", ")}`) : quem || undefined}>{m.t}</span>;
  }
  if (qtdAberta) {
    return (
      <span className="mat-qtd" onClick={(e) => e.stopPropagation()}>
        <input type="number" min={0.01} step="any" className="in" value={qtd} autoFocus placeholder="qtd"
          onChange={(e) => setQtd(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget.nextSibling as HTMLButtonElement | null)?.click(); if (e.key === "Escape") setQtdAberta(false); }} />
        <span>/{c.qtd}</span>
        <button className="icon ok" title="Gravar parcial" onClick={async () => { const n = Number(qtd.replace(",", ".")); if (n > 0 && await marcar(c, "parcial", n)) setQtdAberta(false); }}>✓</button>
        <button className="icon" title="Cancelar" onClick={() => setQtdAberta(false)}>✕</button>
      </span>
    );
  }
  return (
    <select className={`matsel ${m.tom} ${m.manual ? "manual" : ""}`} value={c.matManual?.v ?? ""} title={quem || "Automático pelo PC/NF do Omie — escolha para marcar à mão"}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value as MatManual["v"] | "";
        if (v === "parcial") { setQtdAberta(true); return; }
        void marcar(c, v || null);
      }}>
      <option value="">{m.manual ? "↺ Automático" : `${m.t} (auto)`}</option>
      {MAT_MANUAL.map((x) => <option key={x.v} value={x.v}>{x.v === "parcial" && c.matManual?.v === "parcial" ? m.t : x.t}</option>)}
    </select>
  );
}

type Nota = { id: number; pedido: string; texto: string; autor_id: string | null; autor_nome: string | null; autor_email: string | null; criado_em: string };
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Balãozinho de anotações ao lado do nº do pedido: vazio = contorno; com
 *  anotações = preenchido com a quantidade; hover mostra a última. */
function Balao({ notas, onAbrir }: { notas: Nota[]; onAbrir: () => void }) {
  const ult = notas[notas.length - 1];
  return (
    <button type="button" className={`balao ${notas.length ? "tem" : ""}`}
      title={ult ? `${ult.autor_nome ?? "—"} · ${dataHora(ult.criado_em)}\n${ult.texto}${notas.length > 1 ? `\n(+${notas.length - 1} anteriores)` : ""}` : "Escrever uma anotação neste pedido"}
      onClick={(e) => { e.stopPropagation(); onAbrir(); }}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill={notas.length ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" />
      </svg>
      {notas.length > 0 && <span>{notas.length}</span>}
    </button>
  );
}

function PainelNotas({ p, modulo, notas, onFechar, onMudou, eu, admin }: {
  p: Pedido; modulo: Modulo; notas: Nota[]; onFechar: () => void; onMudou: (l: Nota[]) => void; eu: string | null; admin: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  useEffect(() => { fim.current?.scrollIntoView({ block: "end" }); }, [notas.length]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [onFechar]);
  const enviar = async () => {
    const t = texto.trim(); if (!t) return;
    setEnviando(true); setErro(null);
    const r = await fetch("/api/pedidos/notas", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ modulo, pedido: p.id, empresa: s(p.bucket.rows[0]?.empresa) || "SF", texto: t }) });
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) { setErro(j.error ?? "Não gravou"); return; }
    setTexto(""); onMudou([...notas, j.nota]);
  };
  const apagar = async (n: Nota) => {
    const r = await fetch(`/api/pedidos/notas?id=${n.id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.error ?? "Não apagou"); return; }
    onMudou(notas.filter((x) => x.id !== n.id));
  };
  // Portal no <body>: um ancestral do layout cria contexto de posicionamento e
  // o painel "fixed" ficava preso à altura da lista (só o rodapé aparecia).
  return createPortal(
    <div className="op"><div className="notas-fundo" onClick={onFechar}>
      <div className="notas" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Anotações de ${p.id}`}>
        <header><b>Anotações · {p.id}</b><span>{p.cliente}</span><button className="icon" onClick={onFechar} title="Fechar">✕</button></header>
        <div className="notas-lista">
          {notas.length === 0 && <p className="vazio">Nenhuma anotação ainda. Escreva a primeira abaixo — fica gravado quem escreveu e quando.</p>}
          {notas.map((n) => (
            <div key={n.id} className="nota">
              <div className="nota-cab"><b>{n.autor_nome ?? n.autor_email ?? "—"}</b><span>{dataHora(n.criado_em)}</span>
                {(n.autor_id === eu || admin) && <button className="linkbtn" onClick={() => void apagar(n)} title="Apagar esta anotação">apagar</button>}
              </div>
              <div className="nota-txt">{n.texto}</div>
            </div>
          ))}
          <div ref={fim} />
        </div>
        <footer>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} rows={3} autoFocus
            placeholder="Escreva uma anotação… (Ctrl+Enter para gravar)"
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void enviar(); } }} />
          <div className="notas-acoes">
            {erro && <span className="erro">{erro}</span>}
            <button className="btn primary sm" disabled={enviando || !texto.trim()} onClick={() => void enviar()}>{enviando ? "Gravando…" : "Gravar anotação"}</button>
          </div>
        </footer>
      </div>
    </div></div>,
    document.body,
  );
}

function TipoVenda({ t }: { t: string }) {
  const tv = tipoVenda(t);
  if (!tv) return t ? <span className="tipo">{t}</span> : null;
  return <span className={`tipo ${tv === "Mix" ? "mix" : tv === "Serviço" ? "serv" : "merc"}`}>{tv}</span>;
}

/** Alarmes do pedido como ícone (letra + símbolo, cor pelo tipo); o texto
 *  aparece ao passar o mouse e o clique filtra a lista por aquele alarme. */
type AlarmeIcone = { l: string; s: string; tom: "crit" | "warn" | "violet" | "mute" | "ok" | "okb" | "info"; desc: string; rap?: Rapida };
const ALARMES: Record<string, AlarmeIcone> = {
  "venda em atraso": { l: "V", s: "⚠", tom: "crit", desc: "Venda em atraso — o prazo da venda já passou", rap: "venda_atraso" },
  "compra em atraso": { l: "C", s: "⚠", tom: "crit", desc: "Compra em atraso — material com previsão vencida", rap: "compra_atraso" },
  "aprovação pendente": { l: "A", s: "…", tom: "warn", desc: "PC aguardando aprovação", rap: "minha" },
  "recusa a resolver": { l: "R", s: "✕", tom: "crit", desc: "PC recusado — falta resolver", rap: "recusa" },
  "sem PC": { l: "P", s: "∅", tom: "mute", desc: "Nenhum pedido de compra emitido ainda", rap: "sem_pc" },
  "sem projeto": { l: "J", s: "?", tom: "violet", desc: "Venda sem projeto no Omie", rap: "sem_projeto" },
  "PV incompleto": { l: "I", s: "!", tom: "violet", desc: "PV/OS incompleto no Omie" },
  "defasado Omie": { l: "O", s: "↻", tom: "violet", desc: "Dados defasados em relação ao Omie — rode o Sync" },
  "material sem NF": { l: "M", s: "⚠", tom: "crit", desc: "Material recebido sem NF de entrada há mais de 5 dias", rap: "mat_alarme" },
};
const ALARME_SERV: Record<"atraso" | "exec" | "agend" | "semos", AlarmeIcone> = {
  atraso: { l: "S", s: "⚠", tom: "crit", desc: "Serviço em atraso — previsão vencida e OS não concluída", rap: "serv_atraso" },
  exec: { l: "S", s: "✓", tom: "ok", desc: "Serviço executado — OS concluída", rap: "serv_exec" },
  agend: { l: "S", s: "◷", tom: "mute", desc: "Serviço agendado — OS vinculada, ainda não concluída", rap: "serv_agend" },
  semos: { l: "S", s: "∅", tom: "warn", desc: "Venda com serviço, mas sem OS vinculada no app de serviços", rap: "serv_semos" },
};
const ALARME_PODE_FAT: AlarmeIcone = { l: "F", s: "$", tom: "okb", desc: "Pode faturar — falta só emitir a NF de saída", rap: "pode_fat" };
function alarmeFaturamento(p: Pedido): AlarmeIcone {
  if (p.faturado) {
    if (p.etapaVenda === "Cancelado" && !p.nfSaida) return { l: "F", s: "✕", tom: "mute", desc: "Venda cancelada" };
    return { l: "F", s: "✓", tom: "ok", desc: `Faturado — NF de saída ${p.nfSaida || "emitida"}${p.fatEm ? ` em ${dBR(p.fatEm)}` : ""}` };
  }
  if (p.flags.some((f) => f.t === "pode faturar")) return ALARME_PODE_FAT;
  return { l: "F", s: "○", tom: "warn", desc: "Não faturado — NF de saída ainda não emitida" };
}
function Alm({ a, onFiltrar, chip }: { a: AlarmeIcone; onFiltrar?: (r: Rapida) => void; chip?: boolean }) {
  const clicavel = !!(a.rap && onFiltrar && !chip);
  return (
    <span className={`alm ${a.tom} ${clicavel ? "clk" : ""}`} title={chip ? undefined : `${a.desc}${clicavel ? " · clique para filtrar" : ""}`}
      onClick={clicavel ? (e) => { e.stopPropagation(); onFiltrar!(a.rap!); } : undefined}>
      <b>{a.l}</b><i>{a.s}</i>
    </span>
  );
}

/** Serviço como coluna do pedido (visível fechado): OS com link, status no
 *  critério da tela antiga, previsão/atraso e histórico. Só leitura — quem
 *  manda é o app de serviços. */
function CelServico({ sv }: { sv: Servico | null }) {
  if (!sv) return <div className="srv-nada" />;
  const d = sv.prev != null && sv.st !== "Concluída" && sv.st !== "Cancelada" ? diasAte(sv.prev) : null;
  const semOs = sv.rotulo === "Sem vínculo" && !sv.os;
  const hist = sv.historico.length
    ? "Mudanças da previsão:\n" + sv.historico.map((h) => `• ${h.data ? dBR(dataMs(h.data)) : "sem data"} (em ${dBR(dataMs(h.em))}${h.por ? ` por ${h.por}` : ""})`).join("\n")
    : "";
  return (
    <div className={`srv ${servicoAtrasado(sv) ? "atrasado" : ""}`} onClick={(e) => e.stopPropagation()}
      title={[sv.st === "Concluída" ? (sv.rotulo === "Concluída" ? "OS concluída e liberada no app de serviços" : "OS concluída, mas ainda não liberada para faturar no app de serviços")
        : semOs ? "A venda já aparece no Painel de Vendas do app de serviços, à espera de que gerem a OS. Quando a OS for criada lá, o nº, o status e a previsão aparecem aqui sozinhos."
        : `OS ${sv.rotulo}`, hist, "Vem do app de serviços"].filter(Boolean).join("\n\n")}>
      <span className="srv-k">Serviço</span>
      <div className="srv-l1">
        {/* "Sem vínculo" = venda com serviço ainda sem OS: ela já está na fila do
            Painel de Vendas do app de serviços (06/10/26) — mostra isso, com atalho. */}
        <span className={`st svc-st ${sv.tom}`}>{semOs ? "Aguardando OS" : sv.rotulo}</span>
        {sv.os
          ? <a className="mono svc-os" href={`https://app.waterworks.com.br/ordens-de-servico/${encodeURIComponent(sv.os)}`} target="_blank" rel="noopener noreferrer" title="Abrir a OS no app de serviços">{sv.os.replace(/-/g, "")} ↗</a>
          : semOs
            ? <a className="svc-os" href="https://app.waterworks.com.br/painel-de-vendas" target="_blank" rel="noopener noreferrer" title="Abrir o Painel de Vendas no app de serviços para gerar a OS">gerar OS ↗</a>
            : <span className="svc-os mute">sem OS</span>}
      </div>
      <div className={`srv-l2 ${d != null && d < 0 ? "late" : ""}`}>
        {sv.st === "Concluída" ? (sv.concluidoEm ? `concluída ${dBR(sv.concluidoEm)}` : "concluída")
          : sv.prev != null ? <>prev. {dBR(sv.prev)}{d != null && d < 0 ? <b> ⚠ {-d}d</b> : null}</> : "sem previsão"}
        {sv.alteracoes > 0 && <span className="svc-h"> · {sv.alteracoes}×</span>}
      </div>
      {sv.todos.length > 1 && (
        <span className="srv-mais" title={sv.todos.map((x) => `${x.pv || "sem PV"}: ${x.rotulo}${x.os ? ` · ${x.os}` : " · sem OS"}${x.prev && x.st !== "Concluída" ? ` · prev. ${dBR(x.prev)}` : ""}`).join("\n")}>
          +{sv.todos.length - 1} OS neste projeto
        </span>
      )}
    </div>
  );
}

/** NF de saída (faturamento ao cliente) — o que mais importa no pedido:
 *  sempre visível no cabeçalho, faturado ou não. */
function NfSaida({ p }: { p: Pedido }) {
  if (!p.faturado) return <span className="nfs no" title="NF de saída ainda não emitida">Não faturado</span>;
  if (p.etapaVenda === "Cancelado" && !p.nfSaida) return <span className="nfs cx">Cancelado</span>;
  return (
    <span className="nfs ok" title="NF de saída emitida">
      ✓ NF {p.nfSaida || "emitida"}{p.fatEm ? ` · ${dBR(p.fatEm).slice(0, 5)}` : ""}
    </span>
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

export function FinStrip({ p, $, projeto }: { p: Pedido; $: (v: number | null) => string; projeto?: { budget: number | null } }) {
  const F = financeiro(p);
  if (projeto) {
    /* Projeto (07/10/26): duas margens no lugar do M.B. — ver margensProjeto. */
    const M = margensProjeto(p, projeto.budget);
    const cel = (rot: string, x: { valor: number; pct: number } | null, dica: string) => (
      <div className={`mb ${mbCls(x?.pct ?? null)}`} title={dica}><label>{rot}</label><b>{x == null ? "—" : pct(x.pct)}</b>
        {x != null && <small>{$(x.valor)}</small>}</div>);
    return (
      <div className="fin proj">
        <div title="Budget de materiais (RC)"><label>RC</label><b>{$(projeto.budget)}</b></div>
        <div title={`${F.pcN} pedido(s) de compra`}><label>PC <span>{F.pcN}</span></label><b>{F.pcN ? $(F.pc) : "—"}</b></div>
        <div><label>PV</label><b>{$(p.valorPv)}</b></div>
        {cel("M. proj.", M.projetada, `Margem projetada = (PV − budget de materiais da RC) ÷ PV\n${$(p.valorPv)} − ${$(M.budget)}`)}
        {cel("M. real", M.real, M.real == null ? "Margem real = (PV − PCs aprovados) ÷ PV — sem PCs aprovados ainda, não há custo real"
          : `Margem real = (PV − PCs aprovados) ÷ PV\n${$(p.valorPv)} − ${$(M.aprov)} aprovados`
            + (M.pend ? `\nSe os ${$(M.pend)} aguardando aprovação forem aprovados: ${M.comPendentes ? `${pct(M.comPendentes.pct)} (${$(M.comPendentes.valor)})` : "—"}` : ""))}
      </div>
    );
  }
  return (
    <div className="fin" title="M.B. = (PV − custo) ÷ PV · custo usa o valor do PC quando existe, senão o da RC">
      <div><label>RC</label><b>{$(F.rc)}</b></div>
      <div><label>PC <span>{F.pcN} {F.pcN === 1 ? "pedido" : "pedidos"}</span></label><b>{F.pcN ? $(F.pc) : "—"}</b>{F.pcN ? <SeloDif d={F.dif} compacto /> : null}</div>
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
  if (!podeAprovar) return <span className={`st ${c.estado}`} title={`Só quem aprova pode aprovar ou reprovar (${SO_QUEM_APROVA})`}>{ESTADO_LABEL[c.estado]}</span>;
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
  statusLote: (lista: Compra[], status: string) => void;
  incluirPc: (rc: string, itens: Compra[], numero: string) => Promise<void>;
  gerarPc: (rc: string, itens: Compra[]) => void;
  filtrarRapida: (r: Rapida) => void;
  marcarMaterial: MarcarMaterial;
  marcarMaterialLote: MarcarMaterialLote;
  notas: Nota[];
  abrirNotas: () => void;
  /** Propostas do CRM que geraram o(s) PV/OS deste cartão. */
  propostas?: string[];
  /** OC do cliente e anexos de cada PV/OS do cartão (sql/110). */
  ocs?: { label: string; r?: OcResumo }[];
  /** ★ projeto ativo (só Projetos, 08/10/26). */
  estrela?: { ativo: boolean; pode: boolean; alternar: () => void } | null;
  /** Cancelar pedido / Devolver material (sql/146). */
  ajuste?: { abrir: (acao: "cancelar" | "devolver", cs: Compra[]) => void; tick: number; pode: boolean; aoDesfazer: () => void };
}) {
  const { p, compras, modulo, aberto, $ } = props;
  const d = diasAte(p.lim);
  const empresa = s(p.bucket.rows[0]?.empresa) || "SF";
  if ((modulo as string) === "projetos") return <CartaoProjeto {...props} />;
  return (
    <div data-pid={p.id} className={`pv ${aberto ? "open" : ""} ${p.faturado ? "isfat" : ""} ${!p.faturado && p.flags.some((f) => f.t === "pode faturar") ? "podefat" : ""}`}>
      <div className="pvh" onClick={props.onToggle}>
        <span className="chev">▸</span>
        <div className="pvid">
          <span className="pvid-l1">{props.estrela && <EstrelaAtivo ativo={props.estrela.ativo} pode={props.estrela.pode} onAlternar={props.estrela.alternar} />}{props.nomeId}<Balao notas={props.notas} onAbrir={props.abrirNotas} /></span>
          <small title={modulo === "pcs" ? "Data de emissão do PC" : modulo === "projetos" ? "Emissão do PV/OS mais antigo do projeto" : "Data de emissão do PV/OS no Omie"}>
            {p.emissao ? <>emitido <b>{dBR(p.emissao).replace(/\/(\d{2})(\d{2})$/, "/$2")}</b></> : "emissão —"}
          </small>
          <small>{p.compras.length} compra{p.compras.length === 1 ? "" : "s"}</small>
        </div>
        {/* Cliente e, logo ao lado, a situação do pedido (NF de saída + alertas);
            embaixo, tipo da venda (cor por Mercantil/Serviço/Mix), projeto e etapa. */}
        <div className="cli">
          <div className="cli-l1">
            <span className="cli-nome" title={p.cliente}>{p.cliente || "—"}</span>
            <span className="alms" onClick={(e) => e.stopPropagation()}>
              {modulo !== "pcs" && <Alm a={alarmeFaturamento(p)} onFiltrar={props.filtrarRapida} />}
              {p.flags.filter((f) => f.t !== "pode faturar").map((f) => <Alm key={f.t} a={ALARMES[f.t] ?? { l: "!", s: "", tom: "mute", desc: f.t }} onFiltrar={props.filtrarRapida} />)}
              {modulo !== "pcs" && (() => {
                const sv = servicoDoPedido(p);
                if (!servicoAtrasado(sv)) return null;
                const d = -(diasAte(sv!.prev) ?? 0);
                return <Alm a={{ ...ALARME_SERV.atraso, desc: `Serviço em atraso — previsão ${dBR(sv!.prev)} vencida há ${d}d (OS ${sv!.rotulo.toLowerCase()})` }} onFiltrar={props.filtrarRapida} />;
              })()}
            </span>
            {p.faturado && p.nfSaida && <span className="nf-num">NF {p.nfSaida}</span>}
          </div>
          <div className="cli-l2">
            {modulo === "pcs" ? <span className="tipo">PC avulso</span> : <TipoVenda t={p.tipo} />}
            {p.projeto && <span className="meta" title="Projeto">{p.projeto}</span>}
            {p.etapaVenda && <span className="meta" title="Etapa da venda no Omie">Etapa: <b>{p.etapaVenda}</b></span>}
            {(props.propostas ?? []).map((n) => (
              <a key={n} className="meta" href={`https://allka.ai/w/waterworks/crm/legado/${encodeURIComponent(n)}`}
                title={`Gerado da proposta ${n} do CRM — abrir no CRM`} onClick={(e) => e.stopPropagation()}
                style={{ textDecoration: "none", cursor: "pointer", color: "var(--ww-accent, #4f7cff)" }}>↗ {n}</a>
            ))}
            {/* OC do cliente + 📎: Avulsos sempre (para poder anexar); em Projetos só
                os PV/OS que já têm OC ou anexo, com o nº do PV/OS à frente. */}
            {(props.ocs ?? []).filter((o) => modulo === "avulsos" || o.r).map((o) => (
              <OcChip key={o.label} className="meta" empresa={empresa} label={o.label} resumo={o.r} compacto
                prefixo={modulo === "avulsos" ? undefined : o.label} />
            ))}
          </div>
        </div>
        <FasesBar p={p} modulo={modulo} />
        <div className="date">
          {p.lim ? dBR(p.lim).slice(0, 5) : "—"}
          {d != null && !p.faturado && <small className={d < 0 ? "late" : d <= 7 ? "soon" : ""}>{d < 0 ? `${-d}d atrasado` : `${d}d de folga`}</small>}
        </div>
        {modulo !== "pcs" && <CelServico sv={servicoDoPedido(p)} />}
        <FinStrip p={p} $={$} projeto={modulo === "projetos" && props.bucket ? (() => {
          const pj = projetoDoBucket(modulo, props.bucket!);
          const b = pj ? props.budgetMap.get(`${pj.empresaProj}|${pj.codProj}`) : undefined;
          return { budget: b?.budget_custos != null ? Number(b.budget_custos) : null };
        })() : undefined} />
      </div>

      {modulo === "projetos" && props.bucket && (
        <div className="pvfoot" style={{ justifyContent: "flex-start", paddingTop: 0 }} onClick={(e) => e.stopPropagation()}>
          {(() => { const pj = projetoDoBucket(modulo, props.bucket!); return pj ? <LinkAbrirProjeto {...pj} /> : null; })()}
          {/* aberto, o resumo compacto do projeto (logo abaixo) já mostra estes números */}
          {!aberto && <div style={{ flex: 1, maxWidth: 760 }}>
            <BucketTotals bucket={props.bucket} items={props.bucket.rows} modulo={modulo} canViewValues={props.verValores} budgetMap={props.budgetMap} />
          </div>}
        </div>
      )}

      {aberto && (
        <div className="pcs">
          {modulo === "projetos" && props.bucket && projetoDoBucket(modulo, props.bucket) ? (
            <GruposPcProjeto {...props} proj={projetoDoBucket(modulo, props.bucket)!} />
          ) : modulo !== "pcs" ? (
            <GruposRc {...props} />
          ) : (
            <>
              <div className="pcrow hd">
                <span />
                <span>Item / RC</span><span>Fornecedor</span><span style={{ textAlign: "right" }}>RC → PC</span>
                <span>PC #</span><span>Status</span><span>Prev. materiais</span><span />
              </div>
              {compras.map((c) => <LinhaCompra key={c.key} c={c} {...props} />)}
            </>
          )}
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

// ─────────────────────────────────────────────────────────────────────────
/* Projetos › linha do projeto (08/10/26, spec A2 · mockup painel-projetos-correcoes_2 tela 1).
   Uma linha em quatro colunas: identidade · trilho de etapas com "agora:" · prazo ·
   financeiro em duas barras + margem. Substitui a grade RC·PC·PV·M.proj·M.real e o bloco
   "BUDGET MATERIAIS · RC / Lançado / Projetado / APROV. / FALTA" que ficava embaixo.
   Valores em "k" na linha; o valor completo fica no tooltip. */
type PropsCartao = Parameters<typeof CartaoPedido>[0];

/** R$ curto para a linha: 294 → "R$ 294", 2.115 → "R$ 2.115", 743.054 → "R$ 743k", 1.2 mi. */
export function kBRL(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v), sinal = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sinal}R$ ${(a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e4) return `${sinal}R$ ${Math.round(a / 1000).toLocaleString("pt-BR")}k`;
  return `${sinal}R$ ${Math.round(a).toLocaleString("pt-BR")}`;
}

function CartaoProjeto(props: PropsCartao) {
  const { p, compras, aberto, $ } = props;
  const empresa = s(p.bucket.rows[0]?.empresa) || "SF";
  const proj = props.bucket ? projetoDoBucket("projetos", props.bucket) : null;
  const bsum = proj ? props.budgetMap.get(`${proj.empresaProj}|${proj.codProj}`) : undefined;
  return (
    <div data-pid={p.id} className={`pj ${aberto ? "open" : ""} ${p.faturado ? "isfat" : ""}`}>
      <div className="pj-row" onClick={props.onToggle} role="button" aria-expanded={aberto}>
        <IdProjeto {...props} empresa={empresa} />
        <TrilhoProjeto p={p} />
        <PrazoProjeto p={p} />
        <FinProjeto p={p} $={$} verValores={props.verValores} budget={bsum} />
      </div>
      {aberto && (
        <div className="pj-body">
          <div className="pj-acts" onClick={(e) => e.stopPropagation()}>
            {proj && <LinkAbrirProjeto {...proj} />}
            {props.podeEditar && (
              <AddRowButton empresa={empresa} modulo="projetos" pv_os_label={null}
                pvOsOptions={[...new Set(p.bucket.rows.map((r) => s(r.pv_os_label)).filter(Boolean))]}
                codigoProjeto={Number(p.bucket.rows.find((r) => r.codigo_projeto)?.codigo_projeto ?? 0) || undefined} />
            )}
            <span className="pj-sp" />
            {props.excluirPv && <button className="btn sm no" onClick={props.excluirPv} title="Tirar da lista (fica no Omie)">🗑 Excluir projeto</button>}
          </div>
          {proj ? <GruposPcProjeto {...props} compras={compras} proj={proj} budget={bsum} /> : (
            <>
              <GruposRc {...props} />
              {compras.length === 0 && <div className="pcrow"><span /><span style={{ color: "var(--ww-text-faint)" }}>Sem compras lançadas — a venda existe, a compra ainda não.</span></div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function IdProjeto(props: PropsCartao & { empresa: string }) {
  const { p, empresa } = props;
  const tv = tipoVenda(p.tipo);
  // Sinais que o trilho e o prazo não mostram sozinhos (os de atraso/aprovação já têm cor lá).
  const extras = p.flags.filter((f) => f.tom === "v" || f.t === "material sem NF");
  return (
    <div className="pj-id">
      {props.estrela
        ? <span className="pj-star"><EstrelaAtivo ativo={props.estrela.ativo} pode={props.estrela.pode} onAlternar={props.estrela.alternar} /></span>
        : <span className="pj-star" />}
      <div className="pj-id-c">
        <div className="nm"><span className="nm-t" title={props.nomeId}>{props.nomeId}</span><Balao notas={props.notas} onAbrir={props.abrirNotas} /></div>
        <div className="cl" title="Cliente · emissão do PV/OS mais antigo do projeto · compras">
          <span className="cl-n">{(p.cliente || "—").replace(/&amp;/g, "&")}</span>
          {" · "}{p.emissao ? `emitido ${dBR(p.emissao).replace(/\/(\d{2})(\d{2})$/, "/$2")}` : "emissão —"}
          {" · "}{p.compras.length} compra{p.compras.length === 1 ? "" : "s"}
        </div>
        <div className="pj-tags">
          {p.etapaVenda && <span className="pj-tag et" title="Etapa da venda no Omie">Etapa: {p.etapaVenda}</span>}
          {(tv || p.tipo) && <span className={`pj-tag ${tv === "Mix" ? "mix" : tv === "Serviço" ? "serv" : tv ? "merc" : ""}`}>{tv || p.tipo}</span>}
          {p.faturado && <span className="pj-tag ok" title={`NF de saída${p.fatEm ? ` · ${dBR(p.fatEm)}` : ""}`}>✓ NF {p.nfSaida || "emitida"}</span>}
          {extras.map((f) => <span key={f.t} className={`pj-tag ${f.tom === "r" ? "crit" : "violet"}`} title={ALARMES[f.t]?.desc ?? f.t}>{f.t}</span>)}
          {(props.propostas ?? []).map((n) => (
            <a key={n} className="pj-tag link" href={`https://allka.ai/w/waterworks/crm/legado/${encodeURIComponent(n)}`}
              title={`Gerado da proposta ${n} do CRM — abrir no CRM`} onClick={(e) => e.stopPropagation()}>↗ {n}</a>
          ))}
          {(props.ocs ?? []).filter((o) => o.r).map((o) => (
            <OcChip key={o.label} className="pj-tag" empresa={empresa} label={o.label} resumo={o.r} compacto prefixo={o.label} />
          ))}
        </div>
      </div>
    </div>
  );
}

const ROT_FASE: Record<string, string> = { "NF saída": "NF", "Receb.": "Receb" };
function TrilhoProjeto({ p }: { p: Pedido }) {
  const mapa = useContext(CadeiaCtx);
  const { lista, atual } = fases(p, "projetos", cadeiaDoPedido(p, mapa));
  const sv = servicoDoPedido(p);
  const semOs = !!sv && sv.rotulo === "Sem vínculo" && !sv.os;
  const svLate = servicoAtrasado(sv);
  const dSv = sv?.prev != null && sv.st !== "Concluída" && sv.st !== "Cancelada" ? diasAte(sv.prev) : null;
  const svHist = sv?.historico.length
    ? "Mudanças da previsão:\n" + sv.historico.map((h) => `• ${h.data ? dBR(dataMs(h.data)) : "sem data"} (em ${dBR(dataMs(h.em))}${h.por ? ` por ${h.por}` : ""})`).join("\n") : "";
  return (
    <div className="pj-rail">
      <div className="pj-steps" style={{ gridTemplateColumns: `repeat(${lista.length}, minmax(0,1fr))` }}>
        {lista.map((x) => (
          <div key={x.k} className={`pj-st ${x.s} ${x === atual ? "cur" : ""}`} title={`${x.k}: ${x.t}`}><i /><span>{ROT_FASE[x.k] ?? x.k}</span></div>
        ))}
      </div>
      <div className="cur">
        {atual
          ? <>agora: <b className={atual.s} title={atual.t}>{ROT_FASE[atual.k] ?? atual.k} · {atual.next || atual.t}{atual.s === "l" ? " (atrasado)" : ""}</b></>
          : p.faturado ? <><b className="d">✓ Faturado</b> · NF {p.nfSaida || "emitida"}{p.fatEm ? ` · ${dBR(p.fatEm)}` : ""}</> : <b className="d">✓ ciclo completo</b>}
        {sv && sv.st !== "Cancelada" && (
          <span className="pj-sv" onClick={(e) => e.stopPropagation()}
            title={[sv.st === "Concluída" ? "OS concluída" : semOs ? "A venda já está no Painel de Vendas do app de serviços, à espera de que gerem a OS." : `OS ${sv.rotulo}${sv.os ? ` · ${sv.os}` : ""}`,
              sv.prev != null ? `previsão ${dBR(sv.prev)}` : "", svHist,
              sv.todos.length > 1 ? sv.todos.map((x) => `${x.pv || "sem PV"}: ${x.rotulo}${x.os ? ` · ${x.os}` : " · sem OS"}`).join("\n") : "", "Vem do app de serviços"].filter(Boolean).join("\n\n")}>
            {" · serviço "}
            <span className={`pill ${svLate ? "crit" : sv.tom}`}>
              {semOs ? "aguardando OS" : sv.rotulo.toLowerCase()}
              {svLate && dSv != null ? ` · ⚠ ${-dSv}d` : sv.st !== "Concluída" && sv.prev != null ? ` · ${dBR(sv.prev).slice(0, 5)}` : ""}
            </span>
            {sv.os
              ? <a className="pj-os" href={`https://app.waterworks.com.br/ordens-de-servico/${encodeURIComponent(sv.os)}`} target="_blank" rel="noopener noreferrer" title="Abrir a OS no app de serviços">{sv.os.replace(/-/g, "")} ↗</a>
              : semOs ? <a className="pj-os" href="https://app.waterworks.com.br/painel-de-vendas" target="_blank" rel="noopener noreferrer" title="Abrir o Painel de Vendas no app de serviços para gerar a OS">gerar OS ↗</a> : null}
            {sv.todos.length > 1 && <span className="pj-os mute">+{sv.todos.length - 1} OS</span>}
          </span>
        )}
      </div>
    </div>
  );
}

function PrazoProjeto({ p }: { p: Pedido }) {
  const d = diasAte(p.lim);
  const late = d != null && d < 0 && !p.faturado;
  const soon = d != null && d >= 0 && d <= 7 && !p.faturado;
  const ano = p.lim != null && new Date(p.lim).getFullYear() !== new Date().getFullYear();
  return (
    <div className={`pj-prazo ${late ? "late" : soon ? "soon" : ""}`} title={p.lim ? `Prazo da venda (previsão do PV/OS) ${dBR(p.lim)}` : "Sem prazo no PV/OS"}>
      <div className="d">{p.lim ? (ano ? dBR(p.lim).replace(/\/(\d{2})(\d{2})$/, "/$2") : dBR(p.lim).slice(0, 5)) : "—"}</div>
      <small>{p.faturado ? "faturado" : d == null ? "sem prazo" : d < 0 ? `${-d}d atrasado` : d === 0 ? "vence hoje" : `${d}d de folga`}</small>
    </div>
  );
}

/** Quanto da venda do projeto já foi faturado: soma dos PV/OS encerrados (com NF de saída). */
function faturadoDoProjeto(p: Pedido): number {
  const porPv = new Map<string, AnyRow>();
  for (const r of p.bucket.rows) { const k = s(r.pv_os_label); if (k && !porPv.has(k)) porPv.set(k, r); }
  let v = 0;
  for (const r of porPv.values()) if (encerrado(r) && s(r.pv_etapa_texto) !== "Cancelado") v += Number(r.pv_valor_total ?? 0) || 0;
  return v;
}

function FinProjeto({ p, $, verValores, budget }: { p: Pedido; $: (v: number | null) => string; verValores: boolean; budget?: BudgetSummary }) {
  const bud = budget?.budget_custos != null ? Number(budget.budget_custos) : null;
  const M = margensProjeto(p, bud);
  const venda = p.valorPv;
  const fat = Math.min(venda, faturadoDoProjeto(p));
  const fatPct = venda > 0 ? fat / venda : 0;
  const pcs = M.aprov + M.pend;
  const escala = Math.max(venda, bud ?? 0, pcs) || 1;
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / escala) * 100))}%`;
  const k = (v: number | null) => (verValores ? kBRL(v) : "R$ •••");
  const estoura = bud != null && pcs > bud;
  const pcN = new Set(p.compras.filter((c) => c.pc).map((c) => c.pc)).size;
  return (
    <div className="pj-fin" onClick={(e) => e.stopPropagation()}>
      <span className="k">Venda</span>
      <div className="pj-bar" title={`Venda ${$(venda)} · faturado ${$(fat)} (${Math.round(fatPct * 100)}%)`}>
        <i style={{ width: w(venda), background: "var(--ww-info)" }} />
        {fat > 0 && <i style={{ width: w(fat), background: "var(--ww-ok)" }} />}
      </div>
      <span className="v num" title={$(venda)}>{k(venda)}<small>{p.faturado || fatPct >= 0.999 ? "faturado" : fat > 0 ? `${Math.round(fatPct * 100)}% faturado` : "a faturar"}</small></span>

      <span className="k">Compras</span>
      <div className="pj-bar"
        title={`${pcN} pedido(s) de compra · aprovados ${$(M.aprov)} · aguardando aprovação ${$(M.pend)}${bud != null ? ` · budget de materiais ${$(bud)}${estoura ? ` — estoura em ${$(pcs - bud)}` : ""}` : " · sem budget de materiais"}`}>
        {bud != null && <i className="bud" style={{ width: w(bud) }} />}
        {M.aprov > 0 && <i style={{ width: w(M.aprov), background: "var(--ww-info)" }} />}
        {M.pend > 0 && <i style={{ left: w(M.aprov), width: w(M.pend), background: "var(--ww-warn)" }} />}
      </div>
      <span className={`v num ${estoura ? "neg" : ""}`} title={`PCs ${$(pcs)}${bud != null ? ` de ${$(bud)} de budget` : ""}`}>{pcN ? k(pcs) : "R$ 0"}
        <small>{bud != null ? `de ${k(bud)} budget` : M.pend > 0 ? "aguardando" : "sem budget"}</small></span>

      <div className="mg">
        <span title={M.projetada ? `Margem projetada = (PV − budget de materiais da RC) ÷ PV\n${$(venda)} − ${$(bud)} = ${$(M.projetada.valor)}` : "Sem budget de materiais — não há margem projetada"}>
          margem <b className={mbCls(M.projetada?.pct ?? null)}>{M.projetada ? pct(M.projetada.pct) : "—"}</b> <span className="dim">proj.{M.projetada ? ` · ${k(M.projetada.valor)}` : ""}</span>
        </span>
        <span className="dim" title={M.real == null ? "Margem real = (PV − PCs aprovados) ÷ PV — sem PCs aprovados ainda, não há custo real"
          : `Margem real = (PV − PCs aprovados) ÷ PV\n${$(venda)} − ${$(M.aprov)} aprovados${M.pend ? `\nCom os ${$(M.pend)} aguardando: ${M.comPendentes ? pct(M.comPendentes.pct) : "—"}` : ""}`}>
          · real {M.real ? <b className={mbCls(M.real.pct)}>{pct(M.real.pct)}</b> : "—"}
        </span>
      </div>
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
        <div className="desc item-nome" title={c.desc}>{c.desc}
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

/** Pedido aberto em Avulsos/Projetos (pedido do Benny, 30/09/2026):
 *  cada RC é um grupo. À esquerda os itens — RC repetida em toda linha,
 *  item com qtd × unitário = total, e o valor da RC uma vez, no topo. À
 *  direita, alinhados ao topo do grupo, os PCs que atendem aquela RC:
 *  PC · fornecedor · status (aprovação) · previsão · status do material
 *  e, se o pedido tem serviço, o estado do serviço. Não há relação 1:1
 *  entre itens e PCs: um PC pode atender várias RCs e vice-versa. */
function GruposRc({ compras, p, sel, toggleSel, podeAprovar, podeEditar, ehAdmin, statusLote, incluirPc, gerarPc, marcarMaterial, marcarMaterialLote, gravar, abrirDrawer, $ }: {
  compras: Compra[]; p: Pedido; sel: Set<string>; toggleSel: (k: string) => void;
  podeAprovar: boolean; podeEditar: boolean; ehAdmin: boolean;
  statusLote: (lista: Compra[], status: string) => void;
  incluirPc: (rc: string, itens: Compra[], numero: string) => Promise<void>;
  gerarPc: (rc: string, itens: Compra[]) => void;
  marcarMaterial: MarcarMaterial;
  marcarMaterialLote: MarcarMaterialLote;
  gravar: Gravar; abrirDrawer: (k: string) => void; $: (v: number | null) => string;
}) {
  // Serviço é do pedido inteiro: aparece uma vez na faixa acima (FaixaServico).
  const servico = null as null | { st: string; prev: number | null };
  const empresa = s(p.bucket.rows[0]?.empresa) || "SF";

  const grupos = new Map<string, Compra[]>();
  for (const c of compras) {
    const k = c.rcNumero ? `rc:${c.rcNumero}` : `x:${c.key}`;
    grupos.set(k, [...(grupos.get(k) ?? []), c]);
  }
  const ordem = [...grupos.entries()].sort(([a], [b]) => {
    const na = a.startsWith("rc:") ? Number(a.slice(3)) || Infinity : Infinity;
    const nb = b.startsWith("rc:") ? Number(b.slice(3)) || Infinity : Infinity;
    return na - nb;
  });
  const somaRcs = compras.reduce((a, c) => a + c.rcTotal, 0);
  const comPcVis = compras.filter((c) => c.pc);
  const cls = `rcg ${servico ? "comserv" : ""}`;

  return (
    <>
      <div className={`${cls} rcg-hd`}>
        <div className="it"><span /><span>RC</span><span>Item</span>
          <span style={{ textAlign: "right" }}>Valor RC</span></div>
        <div className="pc"><span>PC</span><span>Fornecedor</span><span style={{ textAlign: "right" }}>Valor PC</span>
          <span className="hd-lote">Status
            {podeAprovar && comPcVis.length > 1 && (
              <select className="todos" value="" title="Mudar o status de todos os PCs deste pedido"
                onChange={(e) => {
                  const v = e.target.value; if (!v) return;
                  const alvo = comPcVis.filter((c) => c.statusCodigo !== v && c.estado !== "recebido");
                  if (!alvo.length) return;
                  const rot = OPCOES_STATUS.find((o) => o.v === v)?.l ?? v;
                  if (!window.confirm(`Mudar ${alvo.length} linha(s) de PC deste pedido para "${rot}"? Cada uma passa pela mesma checagem de alçada e orçamento.`)) return;
                  statusLote(alvo, v);
                }}>
                <option value="">todos ▾</option>
                {OPCOES_STATUS.filter((o) => !o.admin || ehAdmin).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            )}
          </span>
          <span className="hd-lote">Prev. material
            {podeEditar && comPcVis.some((c) => c.estado !== "recebido") && comPcVis.length > 1 && (
              <input type="date" className="todos" title="Mesma previsão para todos os PCs deste pedido ainda não recebidos"
                onChange={(e) => { const iso = e.target.value || null; if (!iso) return;
                  for (const c of comPcVis.filter((x) => x.estado !== "recebido")) void gravar(c, "prevMateriais", iso, { nova_prev_materiais: iso }); }} />
            )}
          </span>
          {/* 07/10/26: um só "Material" — o editável, ao lado da previsão (antes havia o
              seletor por item à esquerda e uma pílula repetida aqui). */}
          <span className="hd-lote">Material
            {podeEditar && compras.some((c) => c.pc && c.recebidoEm == null) && (
              <select className="todos" value="" title="Mudar o material de todos os PCs deste pedido"
                onChange={(e) => { const v = e.target.value; if (v) void marcarMaterialLote(compras.filter((c) => c.pc), v === "auto" ? null : (v as MatManual["v"])); }}>
                <option value="">todos ▾</option>
                {MAT_MANUAL.filter((x) => x.v !== "parcial").map((x) => <option key={x.v} value={x.v}>{x.t}</option>)}
                <option value="auto">↺ Automático</option>
              </select>
            )}
          </span><span>NF entrada</span>{servico && <span>Serviço</span>}<span /></div>
      </div>
      {ordem.map(([k, itens]) => {
        const totalRc = itens.reduce((a, c) => a + c.rcTotal, 0);
        const rc = itens[0].rcNumero;
        // PCs que atendem esta RC — um por número de PC.
        const porPc = new Map<string, Compra[]>();
        for (const c of itens) if (c.pc) porPc.set(c.pc, [...(porPc.get(c.pc) ?? []), c]);
        const pcs = [...porPc.entries()];
        const semPc = itens.filter((c) => !c.pc);
        return (
          <div key={k} className={cls}>
            <div className="it-col">
              {itensVisiveis(itens).map((c, idx) => (
                <div key={c.key} className={`it ${sel.has(c.key) ? "sel" : ""}`}>
                  <input type="checkbox" className="cb" checked={sel.has(c.key)} onChange={() => toggleSel(c.key)} />
                  <span>{rc
                    ? <a className={`rcnum ${idx ? "rep" : ""}`} href={linkCompras(rc, "RC", empresa)} title={`Abrir a RC ${rc} em Compras`}
                        onClick={(e) => e.stopPropagation()} style={{ textDecoration: "none", cursor: "pointer" }}>RC {rc}</a>
                    : <span className="rcnum vazio">sem RC</span>}</span>
                  <div className="desc item-nome" title={c.desc}>{c.desc}
                    <small>{c.qtd} × {$(c.unit)} = <b style={{ color: "var(--ww-text-muted)" }}>{$(c.rcTotal)}</b></small></div>
                  <div style={{ textAlign: "right" }} className="num">{idx === 0 ? <b>{$(totalRc)}</b> : null}</div>
                </div>
              ))}
            </div>
            <div className="pc-col">
              {pcs.map(([pc, cs]) => {
                const c = cs[0];
                const todosRecebidos = cs.every((x) => x.estado === "recebido");
                const recebidoEm = todosRecebidos ? Math.max(...cs.map((x) => x.recebidoEm ?? 0)) : null;
                const prev = cs.map((x) => x.prev).find((x) => x != null) ?? null;
                const aprovado = cs.some((x) => x.estado === "aprovado" || x.estado === "recebido");
                const late = !todosRecebidos && prev != null && (diasAte(prev) ?? 0) < 0;
                const mat = todosRecebidos ? { t: "Recebido", c: "recebido" }
                  : !aprovado ? { t: "—", c: "" }
                  : late ? { t: "Atrasado", c: "recusado" } : prev ? { t: "A caminho", c: "aprovado" } : { t: "Sem previsão", c: "pendente" };
                const pendente = cs.some((x) => x.estado === "pendente");
                const recusado = cs.find((x) => x.estado === "recusado");
                return (
                  <div key={pc} className="pc">
                    <a className="mono" href={linkCompras(pc, "PC", empresa)} title={`Abrir o PC ${pc} em Compras`}
                      onClick={(e) => e.stopPropagation()} style={{ color: "var(--ww-accent, inherit)", textDecoration: "none" }}>{pc}</a>
                    <span className="desc" title={c.fornecedor}>{c.fornecedor || "—"}<small>{c.categoria}</small></span>
                    <span className="num" style={{ textAlign: "right" }}><b>{c.pcValor != null ? $(c.pcValor) : "—"}</b></span>
                    <span>
                      {c.estado === "recebido"
                        ? <span className="st aprovado">Aprovado</span>
                        : <SeletorStatusLote cs={cs} podeAprovar={podeAprovar} ehAdmin={ehAdmin} statusLote={statusLote} />}
                    </span>
                    <span>
                      {!todosRecebidos && podeEditar
                        ? <input type="date" className={`in ${late ? "late" : ""}`} value={isoDia(prev)}
                            title={c.prevNova ? `Remarcada · original do PC ${dBR(c.prevOriginal)}` : "Previsão do PC"}
                            onChange={(e) => { const iso = e.target.value || null; for (const x of cs) void gravar(x, "prevMateriais", iso, { nova_prev_materiais: iso }); }} />
                        : <span className={late ? "late" : ""}>{prev ? dBR(prev) : "—"}</span>}
                      {late && <small className="atraso">⚠ {-(diasAte(prev) ?? 0)}d de atraso</small>}
                    </span>
                    <MatPc cs={cs} auto={mat} podeEditar={podeEditar} marcarLote={marcarMaterialLote} />
                    <NfEntrada cs={cs} late={late} aprovado={aprovado} />
                    {servico && <span className="desc">{servico.st}<small>{servico.prev ? `prev. ${dBR(servico.prev)}` : ""}</small></span>}
                    <span className="acts">
                      {pendente && podeAprovar && (
                        <>
                          <button className="icon ok" title="Aprovar" onClick={() => statusLote(cs, "APROVADO")}>✓</button>
                          <button className="icon" title="Recusar" onClick={() => statusLote(cs, "NAO_APROVADO")}>✕</button>
                        </>
                      )}
                      <button className="icon" title="Todos os campos" onClick={() => abrirDrawer(c.key)}>⋯</button>
                    </span>
                    {recusado && (
                      <div className="jrow">
                        <span>Motivo da recusa</span>
                        <InputTexto id={`jr-${recusado.key}`} className={`in ${!recusado.justificativa ? "need" : ""}`} valor={recusado.justificativa}
                          placeholder="Obrigatório — por que foi recusado?" disabled={!podeAprovar && !podeEditar}
                          onSalvar={(v) => { for (const x of cs) void gravar(x, "justificativa", v || null, { justificativa: v || null }); }} />
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Sempre um espaço para mais um PC, logo abaixo dos que já
                  existem — o PC digitado entra na lista, sem deixar buraco. */}
              {podeEditar && (
                <div className="pc pc-novo">
                  <span>
                    <InputTexto key={`novo-${pcs.map(([n]) => n).join(",")}`} mono className="in caixa" valor="" placeholder={pcs.length ? "+ PC" : "nº PC"}
                      onSalvar={(v) => { if (v.trim()) void incluirPc(rc, itens, v); }} />
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                  {rc && semPc.length > 0 && (() => {
                    // Selecionados nesta RC (sem PC) ou, sem seleção, todos os que faltam.
                    const marcados = semPc.filter((c) => sel.has(c.key));
                    const alvo = marcados.length ? marcados : semPc;
                    return (
                      <button className="btn sm primary" style={{ whiteSpace: "nowrap" }}
                        title={marcados.length ? "Gera um pedido de compra com os itens marcados desta RC" : "Gera um pedido de compra com os itens desta RC que ainda não têm PC (marque linhas para escolher só alguns)"}
                        onClick={() => gerarPc(rc, alvo)}>
                        + Gerar pedido de compra{alvo.length < itens.length ? ` (${alvo.length})` : ""}
                      </button>
                    );
                  })()}
                  {pcs.length === 0 && !p.compras.some((c) => c.pc) && <span className="desc" style={{ color: "var(--ww-text-faint)", fontSize: 12 }}>digite o nº de um pedido de compra já existente, ou use “Gerar pedido de compra” — fornecedor, valor e status vêm do Compras do painel</span>}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {compras.length > 0 && (
        <div className={`${cls} rcg-soma`}>
          <div className="it"><span /><span /><span style={{ textAlign: "right" }}>Soma das RCs</span><span style={{ textAlign: "right" }} className="num"><b>{$(somaRcs)}</b></span></div>
          <div className="pc" />
        </div>
      )}
    </>
  );
}

/** Projetos › pedido aberto, visão por PC (07/10/26, aprovado pelo Benny).
 *  Em cima, "RCs sem PC": uma linha por RC com o que ainda falta comprar e o
 *  atalho para gerar o pedido pela Lista de materiais (já filtrada na RC). Embaixo,
 *  uma linha por PC: nº em destaque, fornecedor, RCs que atende, valor, aprovação,
 *  Prev. material (a do PC), situação (mesmas cores da lista), material, NF de
 *  entrada e o link para ver os itens daquele PC na Lista de materiais. Sem as
 *  linhas "sem RC · PC 7262 · 1 × R$ 0,00" que só serviam para pendurar o PC. */
function GruposPcProjeto({ compras, p, podeAprovar, podeEditar, ehAdmin, statusLote, marcarMaterialLote, gravar, abrirDrawer, $, proj, budget, ajuste }: {
  compras: Compra[]; p: Pedido; podeAprovar: boolean; podeEditar: boolean; ehAdmin: boolean;
  statusLote: (lista: Compra[], status: string) => void; marcarMaterialLote: MarcarMaterialLote;
  gravar: Gravar; abrirDrawer: (k: string) => void; $: (v: number | null) => string;
  proj: { codProj: number; empresaProj: string };
  /** resumo do budget (rota budget/summary): Resultado esperado do fechamento */
  budget?: BudgetSummary;
  ajuste?: PropsCartao["ajuste"];
}) {
  const empresa = s(p.bucket.rows[0]?.empresa) || proj.empresaProj || "SF";
  const lista = (extra: string) => `/projetos/${proj.codProj}/materiais?${new URLSearchParams({ empresa, aba: "materiais" })}&${extra}`;
  // PCs (um por número)
  const pcs = new Map<string, Compra[]>();
  for (const c of compras) if (c.pc) pcs.set(c.pc, [...(pcs.get(c.pc) ?? []), c]);
  /* 💬 por PC (07/10/26): comentários no histórico do pedido (aparecem também no Compras) */
  const [coment, setComent] = useState<Record<string, number>>({});
  const [comentPc, setComentPc] = useState<string | null>(null);
  const chavePcs = [...pcs.keys()].join(",");
  useEffect(() => {
    if (!chavePcs) return;
    fetch(`/api/compras/comentarios?emp=${encodeURIComponent(empresa)}&pcs=${encodeURIComponent(chavePcs)}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => setComent(j.contagem ?? {})).catch(() => {});
  }, [empresa, chavePcs]);
  const situacao = (cs: Compra[]) => {
    const st = cs[0].statusCodigo;
    const aprov = /^APROVADO/.test(st) ? "aprovado" : st === "NAO_APROVADO" ? "nao_aprovado" : st === "CANCELAR_PEDIDO" ? "nao_aprovado" : "aguardando";
    const rec = cs.every((x) => x.recebidoEm != null) ? Math.max(...cs.map((x) => x.recebidoEm ?? 0)) : null;
    const parcial = !rec && cs.some((x) => x.recebidoEm != null);
    const dev = (cs.find((x) => x.row.pc_devolucao)?.row.pc_devolucao as { tipo?: "total" | "parcial" } | undefined)?.tipo ?? null;
    return estadoPc({ aprov, devolucao: dev, nf: cs.find((x) => x.nfFornecedor)?.nfFornecedor || null,
      dt_rec: rec ? new Date(rec).toISOString().slice(0, 10) : null, qtd: parcial ? 2 : null, qtd_recebida: parcial ? 1 : null });
  };
  return (
    <div className="pcproj">
      <ResumoBudgetProjeto key={`bud${ajuste?.tick ?? 0}`} empresa={empresa} codigo={proj.codProj} $={$} valorPv={p.valorPv} resultadoPct={budget?.resultado_bruto_esperado_pct != null ? Number(budget.resultado_bruto_esperado_pct) : null} />
      {/* 07/10/26 (Benny): sem RC nesta tela — RCs e o valor delas vivem na Lista de materiais,
          e o "Gerar pedido de compra" também. Vendas (PV/OS) à esquerda e pedidos de compra à
          direita, como a linha aberta dos Avulsos; em tela estreita, um embaixo do outro. */}
      <div className="pcproj-cq"><div className="pcproj-lados">
      <div className="lado vendas">
        <VendasDoProjeto empresa={empresa} codigo={proj.codProj} $={$} valorPv={p.valorPv} podeEditar={podeEditar} />
      </div>
      <div className="lado compras pcproj-bloco">
        <div className="pcproj-tit">Pedidos de compra</div>
        <div className="pcproj-hd"><span>PC</span><span>Fornecedor</span><span style={{ textAlign: "right" }}>Valor</span><span>Aprovação</span>
          <span>Prev. material</span><span>Situação</span><span>NF entrada</span><span /><span title="Comentários">💬</span><span /></div>
        {[...pcs.entries()].map(([pc, cs]) => {
          const c = cs[0];
          const todosRecebidos = cs.every((x) => x.estado === "recebido");
          const prev = cs.map((x) => x.prev).find((x) => x != null) ?? null;
          const aprovado = cs.some((x) => x.estado === "aprovado" || x.estado === "recebido");
          const late = !todosRecebidos && prev != null && (diasAte(prev) ?? 0) < 0;
          const mat = todosRecebidos ? { t: "Recebido", c: "recebido" } : !aprovado ? { t: "—", c: "" }
            : late ? { t: "Atrasado", c: "recusado" } : prev ? { t: "A caminho", c: "aprovado" } : { t: "Sem previsão", c: "pendente" };
          const st = situacao(cs);
          const pendente = cs.some((x) => x.estado === "pendente");
          const valor = cs.find((x) => x.pcValor != null)?.pcValor ?? null;
          return (
            <div key={pc} className="pcproj-pc">
              <a className="pcnum" href={linkCompras(pc, "PC", empresa)} title={`Abrir o PC ${pc} em Compras`}>{pc}</a>
              <span className="desc" title={c.fornecedor}>{c.fornecedor || "—"}<small>{c.categoria}</small></span>
              <b className="num" style={{ textAlign: "right" }}>{valor != null ? $(valor) : "—"}</b>
              <span>{c.estado === "recebido" ? <span className="st aprovado">Aprovado</span>
                : <SeletorStatusLote cs={cs} podeAprovar={podeAprovar} ehAdmin={ehAdmin} statusLote={statusLote} />}</span>
              <span>
                {!todosRecebidos && podeEditar
                  ? <input type="date" className={`in ${late ? "late" : ""}`} value={isoDia(prev)}
                      title={c.prevNova ? `Remarcada · original do PC ${dBR(c.prevOriginal)}` : "Previsão do PC"}
                      onChange={(e) => { const iso = e.target.value || null; for (const x of cs) void gravar(x, "prevMateriais", iso, { nova_prev_materiais: iso }); }} />
                  : <span className={late ? "late" : ""}>{prev ? dBR(prev) : "—"}</span>}
                {late && <small className="atraso">⚠ {-(diasAte(prev) ?? 0)}d de atraso</small>}
              </span>
              {/* uma informação por célula (07/10/26): o material marcado à mão vai no ⋯ */}
              <span><span className="sitpill" style={{ background: st.cor }}
                title={`${st.rot}${cs.some((x) => x.matManual?.v) ? ` · material marcado à mão: ${MAT_MANUAL.find((m) => m.v === cs.find((x) => x.matManual?.v)?.matManual?.v)?.t ?? ""}` : ""}`}>{st.rot}</span></span>
              <NfEntrada cs={cs} late={late} aprovado={aprovado} />
              <span className="acts">
                {pendente && podeAprovar && (
                  <>
                    <button className="icon ok" title="Aprovar" onClick={() => statusLote(cs, "APROVADO")}>✓</button>
                    <button className="icon" title="Recusar" onClick={() => statusLote(cs, "NAO_APROVADO")}>✕</button>
                  </>
                )}
              </span>
              <button type="button" className={`pcbal ${coment[pc] ? "tem" : ""}`} title={coment[pc] ? `${coment[pc]} comentário(s)` : "Comentar este PC"}
                onClick={() => setComentPc(pc)}>💬{coment[pc] ? <i>{coment[pc]}</i> : null}</button>
              <details className="pcmenu" onClick={(e) => e.stopPropagation()}>
                <summary title="Mais">⋯</summary>
                <div className="pcmenu-pop">
                  <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; abrirDrawer(c.key); }}>Todos os campos do PC</button>
                  <a href={lista(`pc=${encodeURIComponent(pc)}`)}>Ver itens na Lista de materiais</a>
                  {podeEditar && <label className="pcmenu-mat">Material (marcar à mão)
                    <MatPc cs={cs} auto={mat} podeEditar={podeEditar} marcarLote={marcarMaterialLote} /></label>}
                  {ajuste?.pode && <>
                    <button type="button" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; ajuste.abrir("devolver", cs); }}
                      title="O PC continua ativo; o material devolvido sai da conta do projeto e as linhas voltam a sem PC">↩ Devolver material…</button>
                    <button type="button" className="pcmenu-no" onClick={(e) => { (e.currentTarget.closest("details") as HTMLDetailsElement).open = false; ajuste.abrir("cancelar", cs); }}
                      title="Cancela de verdade: sai da tabela e das contas do projeto; as linhas da Lista voltam a sem PC">🚫 Cancelar pedido…</button>
                  </>}
                </div>
              </details>
            </div>
          );
        })}
        {!pcs.size && <div className="pcproj-vazio">Nenhum pedido de compra ainda — gere pela Lista de materiais.</div>}
        <SecaoAjustesPc empresa={empresa} codigo={proj.codProj} tick={ajuste?.tick} $={$} onMudou={() => ajuste?.aoDesfazer()} />
      </div>
      </div></div>
      {comentPc && <ComentariosPc empresa={empresa} pc={comentPc} onFechar={(n) => { if (n != null) setComent((c) => ({ ...c, [comentPc]: n })); setComentPc(null); }} />}
    </div>
  );
}

/** Resumo do projeto aberto (08/10/26, spec A2 item 5): UM bloco de budget com a mesma barra
 *  do cabeçalho do projeto (spec B.0) — PCs aprovados · aguardando aprovação · ainda a comprar ·
 *  o que estoura, com a marca "budget" — e, à direita, só Venda e Resultado esperado. Sai o
 *  bloco numérico "Lançado / Projetado / APROV. / FALTA". Mesma conta da Lista de materiais. */
function ResumoBudgetProjeto({ empresa, codigo, $, valorPv, resultadoPct }: {
  empresa: string; codigo: number; $: (v: number | null) => string; valorPv: number; resultadoPct: number | null;
}) {
  const [d, setD] = useState<{ budget: number | null; comp: number; proj: number; pago: number; aprov: number; pend: number } | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let vivo = true;
    /* a rota às vezes cai por tempo (projeto grande): tenta 3 vezes antes de desistir */
    const buscar = async () => {
      for (let k = 0; k < 3; k++) {
        try {
          // 1ª tentativa passa pela ponte PC → lista (09/10/26): compra direta entra na lista antes do resumo
          const r = await fetch(`/api/rc-projetos/compras?empresa=${encodeURIComponent(empresa)}&codigo=${codigo}${k === 0 ? "&ponte=1" : ""}`, { cache: "no-store" });
          if (r.ok) return await r.json();
        } catch { /* tenta de novo */ }
        await new Promise((ok) => setTimeout(ok, 1500 * (k + 1)));
      }
      return null;
    };
    void buscar().then((j: { itens?: { rc: string | null; pcs: unknown[]; estimado: number }[]; totais?: Record<string, number | null> } | null) => {
        if (!vivo) return;
        if (!j?.totais) { setFalhou(true); return; }
        const t = j.totais;
        const resto = (j.itens ?? []).filter((l) => !l.rc && !l.pcs.length).reduce((a, l) => a + (Number(l.estimado) || 0), 0);
        const comp = Number(t.comprometido) || 0;
        setD({ budget: (t.budget_lista ?? t.budget_plano) != null ? Number(t.budget_lista ?? t.budget_plano) : null, comp, proj: comp + resto, pago: Number(t.pago) || 0,
          aprov: t.pcs_aprovado != null ? Number(t.pcs_aprovado) : comp, pend: Number(t.pcs_pendente ?? 0) });
      }).catch(() => null);
    return () => { vivo = false; };
  }, [empresa, codigo]);
  const kv = (
    <div className="kv">
      <div title={$(valorPv)}><small>Venda</small><b className="num">{kBRL(valorPv)}</b></div>
      <div title="Resultado esperado do fechamento (CRM) = (venda − materiais − mão de obra − despesas) ÷ venda">
        <small>Resultado esp.</small><b className={`num ${resultadoPct == null ? "" : resultadoPct >= 0 ? "pos" : "neg"}`}>{resultadoPct == null ? "—" : pct(resultadoPct)}</b></div>
    </div>
  );
  if (!d) return <div className="pj-bud carregando"><div className="t">{falhou ? "Resumo do budget indisponível agora — abra o projeto para ver a Lista de materiais." : "Resumo do budget…"}</div>{kv}</div>;
  const escala = Math.max(d.budget ?? 0, d.proj, d.comp) * 1.02 || 1;
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / escala) * 100))}%`;
  const teto = d.budget ?? Infinity;
  const aComprar = Math.max(0, Math.min(d.proj, teto) - d.aprov - d.pend);
  const estoura = d.budget != null && d.proj > d.budget ? d.proj - d.budget : 0;
  return (
    <div className="pj-bud">
      <div className="esq">
        <div className="t">
          Budget de materiais <b className="num">{d.budget != null ? $(d.budget) : "—"}</b>
          {" · "}lista prevista <b className={`num ${estoura ? "neg" : ""}`}>{$(d.proj)}</b>
          {" · "}PCs <b className="num">{$(d.comp)}</b>
          {d.pago > 0 && <span className="dim"> · pago {$(d.pago)}</span>}
        </div>
        <div className="pj-track" aria-label="Barra de budget">
          <i style={{ left: 0, width: w(d.aprov), background: "var(--ww-info)" }} title={`PCs aprovados ${$(d.aprov)}`} />
          <i style={{ left: w(d.aprov), width: w(d.pend), background: "var(--ww-warn)" }} title={`Aguardando aprovação ${$(d.pend)}`} />
          <i style={{ left: w(d.aprov + d.pend), width: w(aComprar), background: "color-mix(in srgb,var(--ww-text-faint) 40%,transparent)" }} title={`Ainda a comprar ${$(aComprar)}`} />
          {estoura > 0 && <i style={{ left: w(d.budget ?? 0), width: w(estoura), background: "var(--ww-crit)" }} title={`Estoura o budget em ${$(estoura)} — PC que passar do budget fica para os administradores`} />}
          {d.budget != null && d.budget > 0 && <span className="marca" style={{ left: w(d.budget) }}><em>budget</em></span>}
        </div>
        <div className="pj-leg">
          <span style={{ "--k": "var(--ww-info)" } as React.CSSProperties}>aprovados <b className="num">{$(d.aprov)}</b></span>
          <span style={{ "--k": "var(--ww-warn)" } as React.CSSProperties}>aguardando <b className="num">{$(d.pend)}</b></span>
          <span style={{ "--k": "color-mix(in srgb,var(--ww-text-faint) 55%,transparent)" } as React.CSSProperties}>a comprar <b className="num">{$(aComprar)}</b></span>
          {d.budget == null ? <span className="dim">sem budget de materiais</span>
            : estoura > 0 ? <span style={{ "--k": "var(--ww-crit)" } as React.CSSProperties} title="PC que passar do budget fica para os administradores">estoura <b className="num">{$(estoura)}</b></span>
            : <span style={{ "--k": "var(--ww-ok)" } as React.CSSProperties}>sobra <b className="num">{$(d.budget - d.proj)}</b></span>}
        </div>
      </div>
      {kv}
    </div>
  );
}

/** Vendas do projeto (PV/OS) — 07/10/26, pedido do Benny: o lado da venda, como no
 *  Avulsos. Cada documento com evento, valor, % do total, previsão de faturamento
 *  (editável: a mesma da carteira do Faturamento, e o recebimento da parcela no
 *  Fluxo de caixa do projeto anda junto), recebimento previsto, situação e OC. */
type VendaDoc = {
  chave: string; tipo: string; rotulo: string; origem: string; evento: string | null; valor: number; oc: string | null;
  parcela: number | null; fat_inicial: string | null; fat_nova: string | null; receb_inicial: string | null; receb_nova: string | null;
  faturado: boolean; dt_fat: string | null; nf: string | null; recebido: boolean; titulo_ref: string | null; titulo_venc: string | null;
  titulo_indisponivel?: boolean;
};
const isoBR = (v: string | null | undefined) => (v ? dBR(Date.parse(`${v}T12:00:00`)) : "—");
const difD = (a: string | null, b: string | null) => (a && b ? Math.round((Date.parse(`${a}T12:00:00`) - Date.parse(`${b}T12:00:00`)) / 86400000) : 0);
/** Previsão de faturamento/recebimento (08/10/26, spec A): em cima a data VIGENTE (nova ou
 *  inicial — o campo nunca fica vazio), editável no lugar; embaixo a inicial riscada com o
 *  desvio em dias quando mudou, ou "= inicial". Escolher de novo a inicial apaga a nova. */
function DataPrev({ inicial, nova, atual, editavel, ocupado, onMudar, rotulo }: {
  inicial: string | null; nova: string | null; atual?: string | null; editavel: boolean; ocupado: boolean;
  onMudar: (v: string | null) => void; rotulo: string;
}) {
  const vigente = atual ?? nova ?? inicial;
  const desvio = difD(vigente, inicial);
  const mudou = !!vigente && !!inicial && desvio !== 0;
  const temOverride = !!nova || (!!atual && atual !== inicial);
  const enviar = (v: string | null) => {
    const alvo = !v || v === inicial ? null : v;
    if (alvo === (nova ?? (atual && atual !== inicial ? atual : null))) return;
    onMudar(alvo);
  };
  return (
    <span className="vprev">
      <span className="atual">
        {editavel
          ? <input type="date" key={`${vigente}`} defaultValue={vigente ?? ""} disabled={ocupado} className={mudou ? "mudou" : ""}
              title={`Previsão de ${rotulo} vigente — clique para mudar; escolher a inicial (${isoBR(inicial)}) volta à inicial. Muda o Fluxo de caixa do projeto.`}
              onBlur={(e) => enviar(e.currentTarget.value || null)}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
          : <b className="fixo">{isoBR(vigente)}</b>}
        {editavel && temOverride ? <button type="button" className="undo" title="Voltar à previsão inicial" onClick={() => onMudar(null)}>↺</button> : null}
      </span>
      {mudou
        ? <span className="ini" title={`Previsão inicial de ${rotulo} (resumo financeiro do projeto) — não muda`}><span className="ini-w">inicial </span><s>{isoBR(inicial)}</s>
            <em className={desvio > 0 ? "atraso" : "adianta"} title="desvio da previsão vigente contra a inicial">{desvio > 0 ? `+${desvio}` : desvio}d</em></span>
        : <span className="ini dim" title={`Previsão inicial de ${rotulo} (resumo financeiro do projeto)`}>{inicial ? "= inicial" : "sem previsão inicial"}</span>}
    </span>
  );
}
function VendasDoProjeto({ empresa, codigo, $, valorPv, podeEditar }: { empresa: string; codigo: number; $: (v: number | null) => string; valorPv: number; podeEditar: boolean }) {
  const [docs, setDocs] = useState<VendaDoc[] | null>(null);
  const [pode, setPode] = useState<{ editar: boolean; titulo: boolean }>({ editar: false, titulo: false });
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [gravando, setGravando] = useState<string | null>(null);
  const [toastV, setToastV] = useState<string | null>(null);
  useEffect(() => { if (!toastV) return; const t = setTimeout(() => setToastV(null), 4500); return () => clearTimeout(t); }, [toastV]);
  const carregar = useCallback(() => {
    fetch(`/api/rc-projetos/vendas?empresa=${encodeURIComponent(empresa)}&codigo=${codigo}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => { if (j.error) setErro(j.error); else { setErro(null); setDocs(j.docs ?? []); setPode(j.pode ?? { editar: false, titulo: false }); } })
      .catch((e) => setErro(String(e)));
  }, [empresa, codigo]);
  useEffect(() => { carregar(); }, [carregar]);
  const mudar = async (d: VendaDoc, campo: "faturamento" | "recebimento", data: string | null) => {
    setGravando(`${d.chave}|${campo}`); setAviso(null);
    try {
      const r = await fetch("/api/rc-projetos/vendas", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ empresa, codigo, chave: d.chave, campo, data }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      const avs = (j.avisos ?? []) as string[];
      setAviso(`${d.rotulo}: previsão de ${campo} ${data ? isoBR(data) : "de volta à inicial"}${avs.length ? ` · ${avs.join(" · ")}` : ""} · Fluxo de caixa${campo === "faturamento" ? " e carteira do Faturamento" : ""} atualizados.`);
      setToastV(avs.some((a) => a.includes("andou junto"))
        ? `${d.rotulo}: faturamento ${data ? isoBR(data) : "de volta à inicial"} — o recebimento andou junto, mantendo o prazo`
        : `${d.rotulo}: previsão de ${campo} ${data ? isoBR(data) : "de volta à inicial"} · a inicial continua guardada`);
      carregar();
    } catch (e) { setAviso(`Não gravou: ${(e as Error).message}`); } finally { setGravando(null); }
  };
  const tit = <div className="pcproj-tit" title="Previsão inicial (do resumo financeiro do projeto) e nova previsão — a nova manda no Fluxo de caixa do projeto e na carteira do Faturamento">Vendas (PV/OS) <small>— inicial → nova previsão</small></div>;
  if (erro) return <div className="pcproj-bloco">{tit}<small style={{ color: "var(--ww-text-faint)" }}>Não consegui ler as vendas: {erro}</small></div>;
  if (!docs) return <div className="pcproj-bloco">{tit}<small style={{ color: "var(--ww-text-faint)" }}>carregando…</small></div>;
  if (!docs.length) return null;
  const total = docs.reduce((a, d) => a + d.valor, 0);
  const confere = Math.abs(total - valorPv) < 0.05;
  const ed = podeEditar && pode.editar;
  return (
    <div className="pcproj-bloco">
      {tit}
      <div className="pcproj-vendas">
        <div className="hd"><span>Documento · evento</span><span style={{ textAlign: "right" }}>Valor</span><span>Faturamento</span><span>Recebimento</span><span>Situação</span></div>
        {docs.map((d) => (
          <div key={d.chave || d.rotulo} className="ln">
            <span className="doc">
              <span className="l1"><a className="rcnum" href={`/faturamento?${new URLSearchParams({ abrir: d.chave, q: d.rotulo, emp: empresa })}`} title={`Abrir ${d.rotulo} no Faturamento${d.origem === "Omie" ? " (espelhado do Omie)" : ""}`}>{d.rotulo}</a>
                {d.parcela ? <small className="parc">parcela {d.parcela}</small> : null}
                {d.origem === "Omie" && <small className="omie">Omie</small>}{d.oc && <small className="oc" title="OC do cliente">OC {d.oc}</small>}</span>
              <small title={d.evento ?? ""}>{(d.evento ?? "").replace(/^\s*\d+\s*·\s*/, "") || "—"}</small>
            </span>
            <span className="num" style={{ textAlign: "right" }}><b>{$(d.valor)}</b><small>{total ? `${Math.round((d.valor / total) * 1000) / 10}%` : ""}</small></span>
            {d.faturado
              ? <span className="vprev"><span className="atual"><b className="fixo">{isoBR(d.dt_fat)}</b><small className="fat" title="Data em que foi faturado">faturado</small></span>
                  {/* spec A.1: a linha da inicial só aparece quando a data de faturamento é diferente dela */}
                  {d.fat_inicial && d.dt_fat && difD(d.dt_fat, d.fat_inicial) !== 0
                    ? <span className="ini" title="Previsão inicial de faturamento — riscada quando mudou"><span className="ini-w">inicial </span><s>{isoBR(d.fat_inicial)}</s><em className={difD(d.dt_fat, d.fat_inicial) > 0 ? "atraso" : "adianta"}>{difD(d.dt_fat, d.fat_inicial) > 0 ? "+" : ""}{difD(d.dt_fat, d.fat_inicial)}d</em></span>
                    : null}</span>
              : <DataPrev rotulo="faturamento" inicial={d.fat_inicial} nova={d.fat_nova} editavel={ed && !!d.chave} ocupado={gravando === `${d.chave}|faturamento`} onMudar={(v) => void mudar(d, "faturamento", v)} />}
            {d.faturado && !d.titulo_ref
              ? <span className="vprev"><span className="atual">
                  {d.titulo_indisponivel
                    ? <b className="text-amber-600" title="A consulta do título a receber falhou agora — recarregue">vencimento indisponível</b>
                    : <b title="título não encontrado — veja em Financeiro › Receber">—</b>}</span>
                  <span className="ini dim">inicial {isoBR(d.receb_inicial)}</span></span>
              : <DataPrev rotulo="recebimento" inicial={d.receb_inicial} nova={d.faturado ? null : d.receb_nova} atual={d.faturado ? d.titulo_venc : null}
                  editavel={ed && !!d.parcela && !d.recebido && (!d.faturado || pode.titulo)} ocupado={gravando === `${d.chave}|recebimento`}
                  onMudar={(v) => void mudar(d, "recebimento", v)} />}
            <span className="stv">{d.recebido ? <span className="fb eq">Recebido</span>
              : d.faturado ? <span className="fb up" style={{ background: "transparent" }} title={d.nf ? `${d.tipo === "OS" ? "NF/recibo" : "NF"} ${d.nf}` : ""}>Faturado</span>
              : <span className="fb mute">A faturar</span>}
              {d.faturado && <small>{d.nf ? `${d.tipo === "OS" ? "NF/rec." : "NF"} ${d.nf}` : ""}{d.titulo_ref ? <> · <a href={`/financeiro/receber?q=${encodeURIComponent(d.nf ?? "")}`} title="Título a receber">título</a></> : null}</small>}</span>
          </div>))}
        <div className="ln tot"><span>Total · {docs.length} {docs.length === 1 ? "documento" : "documentos"}</span><b className="num" style={{ textAlign: "right" }}>{$(total)}</b>
          <span className="confere" style={{ color: confere ? "var(--ww-text-faint)" : "#e11d48" }}>{confere ? "confere com o PV do projeto" : `PV do projeto ${$(valorPv)} — diferença ${$(total - valorPv)}`}</span></div>
      </div>
      {aviso && <small style={{ display: "block", marginTop: 4, color: aviso.startsWith("Não") ? "#e11d48" : "var(--ww-text-muted)" }}>{aviso}</small>}
      {/* o cartão tem container-type (vira bloco de contenção do position:fixed) — o aviso vai para o body */}
      {toastV && typeof document !== "undefined" && createPortal(
        <div role="status" style={{ position: "fixed", left: 24, bottom: 24, zIndex: 90, background: "var(--ww-text)", color: "var(--ww-bg)", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 500, boxShadow: "0 8px 24px rgba(0,0,0,.25)" }}>{toastV}</div>,
        document.body)}
    </div>
  );
}

/** Comentários de um PC (07/10/26): quem escreveu e quando, e o campo para acrescentar. */
function ComentariosPc({ empresa, pc, onFechar }: { empresa: string; pc: string; onFechar: (n: number | null) => void }) {
  const [lista, setLista] = useState<{ texto: string; por: string | null; em: string | null }[] | null>(null);
  const [txt, setTxt] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    fetch(`/api/compras/comentarios?emp=${encodeURIComponent(empresa)}&pc=${encodeURIComponent(pc)}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => setLista(j.comentarios ?? [])).catch((e) => setErro(String(e)));
  }, [empresa, pc]);
  const enviar = async () => {
    if (!txt.trim()) return;
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/compras/comentarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ emp: empresa, pc, texto: txt }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setLista(j.comentarios ?? []); setTxt("");
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  };
  const quem = (a: string | null) => (a ? (a.includes("@") ? a.split("@")[0] : a) : "—");
  return createPortal(
    <div className="pccoment-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(lista?.length ?? null); }}>
      <div className="pccoment" role="dialog" aria-label={`Comentários do PC ${pc}`}>
        <div className="hd"><b>💬 PC {pc}</b><small>fica no histórico do pedido (Compras)</small><button type="button" onClick={() => onFechar(lista?.length ?? null)}>✕</button></div>
        <div className="corpo">
          {lista == null && !erro && <small>carregando…</small>}
          {lista?.length === 0 && <small>Nenhum comentário ainda.</small>}
          {lista?.map((c, i) => <div key={i} className="c"><div className="m"><b>{quem(c.por)}</b><small>{c.em ? new Date(c.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</small></div><div>{c.texto}</div></div>)}
          {erro && <small style={{ color: "#e11d48" }}>{erro}</small>}
        </div>
        <div className="pe"><textarea value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Escreva um comentário…" rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void enviar(); }} />
          <button type="button" disabled={ocupado || !txt.trim()} onClick={() => void enviar()}>{ocupado ? "…" : "Comentar"}</button></div>
      </div>
    </div>, document.body);
}

/** Material do PC (07/10/26): o seletor editável, no lugar da pílula repetida.
 *  "(auto)" é o que o PC/NF diz (Recebido, A caminho, Atrasado…); escolher marca
 *  todos os itens do PC à mão (Em estoque, Recebido sem NF, Não vai mais). */
function MatPc({ cs, auto, podeEditar, marcarLote }: {
  cs: Compra[]; auto: { t: string; c: string }; podeEditar: boolean; marcarLote: MarcarMaterialLote;
}) {
  const recebidoNf = cs.every((x) => x.recebidoEm != null);
  const manual = cs.map((x) => x.matManual?.v ?? "");
  const igual = manual.every((v) => v === manual[0]) ? manual[0] : "";
  const rotManual = MAT_MANUAL.find((x) => x.v === igual)?.t;
  if (recebidoNf || !podeEditar) {
    const t = rotManual ?? auto.t;
    return <span>{auto.c || rotManual ? <span className={`st ${auto.c || "pendente"}`}>{t}</span> : <span style={{ color: "var(--ww-text-faint)" }}>—</span>}</span>;
  }
  return (
    <span>
      <select className={`matsel ${igual ? "manual" : ""}`} value={igual}
        title={igual ? "Marcado à mão — escolha ↺ Automático para voltar ao que o PC/NF diz" : "Automático pelo PC/NF — escolha para marcar à mão"}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { const v = e.target.value as MatManual["v"] | ""; void marcarLote(cs, v || null); }}>
        <option value="">{igual ? "↺ Automático" : `${auto.t === "—" ? "Aguardando" : auto.t} (auto)`}</option>
        {MAT_MANUAL.filter((x) => x.v !== "parcial").map((x) => <option key={x.v} value={x.v}>{x.t}</option>)}
      </select>
    </span>
  );
}

/** Link direto para a RC/PC na tela de Compras (06/10/26) — <a> de verdade,
 *  para Cmd/meio-clique abrirem em outra aba. */
const linkCompras = (num: string, tipo: "RC" | "PC", emp: string) =>
  `/erp/compras?${new URLSearchParams({ abrir: num, tipo, emp })}`;

/** Status da NF de entrada do PC (Omie, só leitura): número + data quando
 *  chegou; senão aguardando — em vermelho se a previsão já venceu. */
function NfEntrada({ cs, late, aprovado }: { cs: Compra[]; late: boolean; aprovado: boolean }) {
  const nfs = [...new Set(cs.map((x) => x.nfFornecedor).filter(Boolean))];
  const datas = cs.map((x) => x.recebidoEm).filter((x): x is number => x != null);
  const todas = datas.length === cs.length;
  if (datas.length) {
    return (
      <span className="nf">
        <span className={`st ${todas ? "recebido" : "pendente"}`}>{todas ? "Recebida" : "Parcial"}</span>
        <small>{nfs.length ? `NF ${nfs.join(", ")}` : "NF s/ nº"} · {dBR(Math.max(...datas))}</small>
      </span>
    );
  }
  if (!aprovado) return <span style={{ color: "var(--ww-text-faint)" }}>—</span>;
  return <span className="nf"><span className={`st ${late ? "recusado" : "pendente"}`}>Aguardando NF</span></span>;
}

/** Linha criada só para pendurar mais um PC numa RC (sem item nem custo)
 *  não é item: some da coluna de itens quando a RC tem outras linhas. */
function itensVisiveis(itens: Compra[]): Compra[] {
  const soPc = (c: Compra) => !!c.pc && !s(c.row.rc_descricao) && c.rcTotal === 0 && Number(c.row.ncod_ped) < 0;
  const vis = itens.filter((c) => !soPc(c));
  return vis.length ? vis : itens;
}

/** Status de um PC que cobre várias linhas: muda todas de uma vez. */
function SeletorStatusLote({ cs, podeAprovar, ehAdmin, statusLote }: {
  cs: Compra[]; podeAprovar: boolean; ehAdmin: boolean; statusLote: (lista: Compra[], status: string) => void;
}) {
  const c = cs.find((x) => x.estado === "recusado") ?? cs.find((x) => x.estado === "pendente") ?? cs[0];
  if (!podeAprovar) return <span className={`st ${c.estado}`} title={`Só quem aprova pode aprovar ou reprovar (${SO_QUEM_APROVA})`}>{ESTADO_LABEL[c.estado]}</span>;
  const atual = c.statusCodigo || "PENDENTE";
  return (
    <select className={`stsel ${c.estado}`} value={atual} onChange={(e) => statusLote(cs, e.target.value)}>
      {OPCOES_STATUS.filter((o) => !o.admin || ehAdmin || o.v === atual).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      {!OPCOES_STATUS.some((o) => o.v === atual) && <option value={atual}>{STATUS_META[atual]?.label ?? atual}</option>}
    </select>
  );
}

// ─────────────────────────────────────────────────────────────────────────
/** Rótulo de coluna clicável: 1º clique ordena, 2º inverte (↑ crescente · ↓ decrescente). */
function OrdCab({ k, l, o, on }: { k: OrdemCampo; l: string; o: Ordem; on: (k: OrdemCampo) => void }) {
  const ativo = o.k === k;
  return (
    <button type="button" className="ordcab" onClick={() => on(k)} title={`Ordenar por ${l}${ativo ? " (clique de novo para inverter)" : ""}`}
      style={{ all: "unset", cursor: "pointer", font: "inherit", color: ativo ? "var(--ww-text, inherit)" : "inherit", fontWeight: ativo ? 700 : "inherit", textDecoration: ativo ? "underline" : "none", textUnderlineOffset: 3 }}>
      {l}{ativo ? (o.d === 1 ? " ↑" : " ↓") : ""}
    </button>
  );
}

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
function BarraMassa({ n, podeAprovar, podeEditar, temManual, onAprovar, onRecusar, onPrevisao, onMaterial, onEsconder, onApagar, onCancelar }: {
  n: number; podeAprovar: boolean; podeEditar: boolean; temManual: boolean;
  onMaterial?: (status: MatManual["v"] | null) => void;
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
          {onMaterial && (
            <select className="in" style={{ width: 150, borderColor: "var(--ww-border-strong)" }} value=""
              onChange={(e) => { const v = e.target.value; if (v) onMaterial(v === "auto" ? null : (v as MatManual["v"])); }}>
              <option value="">Material ▾</option>
              {MAT_MANUAL.filter((x) => x.v !== "parcial").map((x) => <option key={x.v} value={x.v}>{x.t}</option>)}
              <option value="auto">↺ Automático</option>
            </select>
          )}
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

/** PC criado no Compras do painel entra no Standalone com ncod_ped = -(9e12 + id)
    (sql/148). Aprovar e editar daqui gravaria na aprovação do Omie, então ele abre
    a folha do pedido no Compras. Devolve true quando redirecionou. */
function abrirPcNativo(ncod: unknown): boolean {
  const n = Number(ncod);
  if (!(n < 0)) return false;
  window.location.assign(`/erp/compras?pedido=${-n - 9_000_000_000_000}`);
  return true;
}

const STATUS_COMPRAS: Record<string, string> = { APROVADO: "aprovado", NAO_APROVADO: "nao_aprovado", PENDENTE: "aguardando" };

/** Aprova/reprova PCs do Compras pela /api/compras/acao. null = ok; senão o erro. */
async function decidirPcNativo(rows: Record<string, unknown>[], status: string): Promise<string | null> {
  const ids = rows.map((r) => -Number(r.ncod_ped) - 9_000_000_000_000).filter((n) => n > 0);
  try {
    const r = await fetch("/api/compras/acao", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "aprovar", ids, status }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return String(j.error ?? r.statusText);
    const f = (j.falhas ?? []) as { num: string; erro: string }[];
    return f.length ? f.map((x) => `PC ${x.num}: ${x.erro}`).join(" · ") : null;
  } catch (e) { return e instanceof Error ? e.message : String(e); }
}
