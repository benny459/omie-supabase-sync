"use client";

/**
 * Vendas avulsas — recriação da tela de referência do Allka Navy.
 *
 * É uma RECRIAÇÃO, não uma adaptação. A tela antiga tem outra composição
 * (cartões com bolinhas de pipeline e caixas de valor à direita); trocar
 * pedaços por cima dela produzia um híbrido que não era nem uma coisa nem
 * outra. Aqui a página segue a ordem do modelo:
 *
 *   cabeçalho (área · título · fonte · acções) → faixa de alarmes clicável
 *   → KPIs → gráfico + painel lateral → tabela em árvore
 *
 * Regra nº 1 do handoff: nenhuma regra de negócio muda. Alarmes vêm de
 * computeBucketAlarms, aprovação de STATUS_META, valores passam por
 * canViewValues. Nada é recalculado aqui.
 *
 * Vive em rota própria para poder ser comparada lado a lado com a tela em
 * produção antes de a substituir.
 */

import { useEffect, useMemo, useState } from "react";
import { computeBucketAlarms, type AlarmKind } from "@/lib/alarmes";
import { STATUS_META } from "@/lib/columns";
/* ORDEM_TRILHO casa 1:1 com o `ETAPAS` do PipelineRail — os rótulos do
   tooltip vêm de lá, a ordem vem daqui, e as duas listas têm de bater. */
import { estadoDoPipeline, ORDEM_TRILHO, type EstadoEtapa } from "@/lib/pipeline-estado";
import { canViewValues } from "@/lib/permissions";
import { useUserPerms } from "../UserPermsProvider";
import KpisNavy, { pedidoEncerrado } from "./KpisNavy";
import TreeTable from "./TreeTable";
import { montarPedidos, bucketsDosPedidos, montarArvore, COLUNAS_TABELA as COLUNAS, GRUPOS_TABELA as GRUPOS_COL, GRID_TABELA } from "@/lib/navy-pedidos";
import ListaPedidos, { type Pedido } from "./ListaPedidos";
import LinhaDoTempo from "./LinhaDoTempo";
import KanbanRaias from "./KanbanRaias";
import { SegmentedControl } from "./primitivos";
import { Button, FilterChip, StatusPill, type Tom } from "./primitivos";

type AnyRow = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const MASCARA = "R$ •••••";

/* Grupos de alarme — a faixa clicável que o handoff pede. Os nomes e a
   repartição são os do Daily Webex, para as contagens baterem: é a mesma
   computeBucketAlarms que alimenta o relatório. */
const GRUPOS: { chave: string; rotulo: string; tom: Tom; kinds: AlarmKind[] }[] = [
  { chave: "vendas",      rotulo: "Vendas",      tom: "crit",   kinds: ["venda", "pvos_incompl", "sem_projeto", "aguarda_liberacao", "retido_cliente"] },
  { chave: "compras",     rotulo: "Compras",     tom: "warn",   kinds: ["compra", "sem_rc", "sem_pc", "defas_omie"] },
  { chave: "aprovacoes",  rotulo: "Aprovações",  tom: "violet", kinds: ["aprov_bloq", "aprov_pend"] },
  { chave: "servicos",    rotulo: "Serviços",    tom: "info",   kinds: ["sem_vinculo", "agend_vazio", "agend_venc"] },
  { chave: "faturamento", rotulo: "Faturamento", tom: "ok",     kinds: ["pode_faturar"] },
];

export default function TelaAvulsosNavy() {
  const perms = useUserPerms();
  const podeVerValores = canViewValues(perms, "avulsos");
  const dinheiro = (v: number) => (podeVerValores ? BRL.format(v) : MASCARA);

  const [rows, setRows] = useState<AnyRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [grupoSel, setGrupoSel] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [vista, setVista] = useState("lista");
  /* Lembra a escolha entre sessões: quem trabalha o histórico não quer voltar
     a "em aberto" a cada reload. O default na primeira visita é "aberto". */
  const [escopo, setEscopo] = useState<"aberto" | "faturado" | "todos">("aberto");
  useEffect(() => {
    const g = localStorage.getItem("navy:avulsos:escopo");
    if (g === "aberto" || g === "faturado" || g === "todos") setEscopo(g);
  }, []);
  const mudarEscopo = (v: string) => {
    const e = v as "aberto" | "faturado" | "todos";
    setEscopo(e);
    localStorage.setItem("navy:avulsos:escopo", e);
  };
  const [sinalExpandir, setSinalExpandir] = useState<number | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch("/api/list/rows?view=v_pc_avulsos&count=exact",
                              { cache: "no-store", signal: ctrl.signal });
        const j = await r.json();
        if (!r.ok) { setErro(j.error ?? r.statusText); setRows([]); return; }
        setRows((j.rows ?? []) as AnyRow[]);
      } catch (e) {
        if ((e as Error).name !== "AbortError") { setErro((e as Error).message); setRows([]); }
      }
    })();
    return () => ctrl.abort();
  }, []);

  const hoje = useMemo(() => Date.now(), []);

  /* Buckets por PV/OS — mesmo agrupamento do painel. */
  const todosBuckets = useMemo(() => {
    const m = new Map<string, { pv_os_label: string; cliente: string | null; rows: AnyRow[] }>();
    for (const r of rows ?? []) {
      const k = s(r.pv_os_label) || "—";
      let b = m.get(k);
      if (!b) { b = { pv_os_label: k, cliente: (r.pv_cliente_fantasia as string) ?? null, rows: [] }; m.set(k, b); }
      b.rows.push(r);
    }
    return [...m.values()];
  }, [rows]);

  /* Escopo de faturamento. A vista tem ~1428 PV/OS mas só ~113 em aberto: sem
     isto a tela abria numa página inteira de pedidos fechados de 2024, porque
     a ordem é alfabética e os antigos vêm primeiro. O default é "em aberto" —
     é o que a operação precisa de ver — e o faturado fica a um clique.

     O corte é feito AQUI, antes dos alarmes e dos KPIs, para que a faixa de
     alarmes, os cartões e a lista falem todos do mesmo conjunto. Se filtrasse
     só a lista, clicar em "Vendas 42" mostraria menos de 42. */
  const contagemEscopo = useMemo(() => {
    let aberto = 0;
    for (const b of todosBuckets) if (!pedidoEncerrado(b.rows[0] ?? {})) aberto += 1;
    return { aberto, faturado: todosBuckets.length - aberto, todos: todosBuckets.length };
  }, [todosBuckets]);

  const buckets = useMemo(() => {
    if (escopo === "todos") return todosBuckets;
    const querAberto = escopo === "aberto";
    return todosBuckets.filter((b) => !pedidoEncerrado(b.rows[0] ?? {}) === querAberto);
  }, [todosBuckets, escopo]);

  /* Alarmes por bucket — uma vez, reaproveitados pela faixa e pelos chips. */
  const alarmesPorBucket = useMemo(() => {
    const m = new Map<string, Set<AlarmKind>>();
    for (const b of buckets) m.set(b.pv_os_label, computeBucketAlarms(b.rows, hoje));
    return m;
  }, [buckets, hoje]);

  const contagemGrupo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const g of GRUPOS) {
      c[g.chave] = buckets.filter((b) => {
        const a = alarmesPorBucket.get(b.pv_os_label);
        return a && g.kinds.some((k) => a.has(k));
      }).length;
    }
    return c;
  }, [buckets, alarmesPorBucket]);

  const visiveis = useMemo(() => {
    let lista = buckets;
    if (grupoSel) {
      const g = GRUPOS.find((x) => x.chave === grupoSel);
      if (g) lista = lista.filter((b) => {
        const a = alarmesPorBucket.get(b.pv_os_label);
        return a && g.kinds.some((k) => a.has(k));
      });
    }
    const q = busca.trim().toLowerCase();
    if (q) lista = lista.filter((b) =>
      b.pv_os_label.toLowerCase().includes(q) ||
      (b.cliente ?? "").toLowerCase().includes(q) ||
      b.rows.some((r) => s(r.nome_fornecedor).toLowerCase().includes(q)
                      || s(r.pc_numero).includes(q)));
    return lista;
  }, [buckets, grupoSel, busca, alarmesPorBucket]);

  /* Árvore: Pedido → Lote. Um PC é um PC — a dedupe vive aqui, e não em cada
     vista, porque foi o erro que se repetiu três vezes hoje. */
  /* Pedidos para as vistas. A dedupe por PC vive AQUI, num sítio só — foi o
     erro que hoje se repetiu três vezes por estar espalhado por cada vista.
     O trilho vem de `estadoDoPipeline`, as mesmas regras que a tela antiga
     usa nos dots — antes eu tinha aqui uma aproximação minha e o trilho lia
     quase tudo igual. */
  const pedidos: Pedido[] = useMemo(
    () => montarPedidos(visiveis, { modulo: "avulsos", hoje, alarmes: alarmesPorBucket }),
    [visiveis, hoje, alarmesPorBucket]);
  const bucketsLote = useMemo(() => bucketsDosPedidos(pedidos), [pedidos]);
  const arvore = useMemo(() => montarArvore(pedidos, dinheiro), [pedidos, dinheiro]);

  const totalGeral = useMemo(
    () => visiveis.reduce((t, b) => t + n(b.rows[0]?.pv_valor_total), 0), [visiveis]);

  return (
    <div style={{ padding: "var(--space-page-y) var(--space-page-x) 48px", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Cabeçalho da página — área, título, de onde vêm os dados, acções */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        padding: "16px 20px", borderRadius: "var(--radius-panel)",
        background: "var(--ww-panel-grad)", border: "1px solid var(--ww-border)",
        boxShadow: "var(--shadow-card)",
      }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={{
            fontSize: "var(--text-chip)", fontWeight: 700, letterSpacing: "var(--tracking-label)",
            textTransform: "uppercase", color: "var(--ww-accent-text)",
          }}>Operação</div>
          <h1 style={{
            margin: "2px 0 0", fontSize: "var(--text-h1)", fontWeight: 700,
            letterSpacing: "var(--tracking-tight)", color: "var(--ww-text)",
          }}>Vendas avulsas</h1>
          <div style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-muted)", marginTop: 2 }}>
            Bucket por PV/OS · pipeline RC → PC → Aprovação → Materiais (approval.v_pc_avulsos)
          </div>
        </div>
        <Button variant="ghost" onClick={() => window.location.reload()}>Recarregar</Button>
      </div>

      {erro && (
        <div style={{
          padding: "10px 14px", borderRadius: "var(--radius-card)",
          background: "var(--ww-crit-soft)", color: "var(--ww-crit-text)", fontSize: "var(--text-body-sm)",
        }}>Erro ao carregar: {erro}</div>
      )}

      {/* Os filtros já não vivem aqui. Estavam em duas faixas entaladas entre
          o cabeçalho e os KPIs, e era isso que fazia a página ler pesada: o
          modelo vai do cabeçalho DIRECTO aos KPIs. Passaram para dentro da
          secção da lista, encostados ao que filtram — ver a barra lá abaixo. */}

      {rows === null ? (
        <div style={{ padding: 40, textAlign: "center", color: "var(--ww-text-muted)", fontSize: "var(--text-body-sm)" }}>
          Carregando…
        </div>
      ) : (
        <>
          <KpisNavy buckets={visiveis} formatarValor={dinheiro} escopo={escopo} />

          {/* Tabela em árvore */}
          <section style={{
            borderRadius: "var(--radius-section)", background: "var(--ww-panel-grad)",
            border: "1px solid var(--ww-border)", boxShadow: "var(--shadow-section)",
            overflow: "hidden",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              padding: "14px 18px",
            }}>
              <div style={{ flex: "1 1 240px" }}>
                <div style={{ fontSize: "var(--text-h2)", fontWeight: 700, color: "var(--ww-text)" }}>
                  Pedidos · compras · itens
                </div>
                <div style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-muted)" }}>
                  {/* Acompanha o escopo: dizer "o que está em aberto" com o
                      filtro em Faturados descrevia a tela errada. */}
                  {escopo === "aberto" ? "O que está em aberto" :
                   escopo === "faturado" ? "O que já faturou" : "Aberto e faturado"}
                  {" "}— pedido resume, compra liga RC → PC → aprovação → materiais, item mostra quanto chegou
                </div>
              </div>
              <SegmentedControl
                options={[
                  { value: "lista", label: "Lista" },
                  { value: "tempo", label: "Linha do tempo" },
                  { value: "tabela", label: "Tabela" },
                  { value: "kanban", label: "Kanban" },
                ]}
                value={vista} onChange={setVista} />
              <Button variant="ghost" onClick={() => setSinalExpandir(Date.now())}>Expandir tudo</Button>
              <Button variant="ghost" onClick={() => setSinalExpandir(-Date.now())}>Recolher</Button>
            </div>

            {/* Barra de filtros — dentro da secção, encostada à lista que
                governa. A primeira coisa da barra é o escopo de faturamento,
                porque é a primeira decisão: ver o que está por fazer ou o que
                já saiu. Depois os alarmes, depois a busca — do mais grosso
                para o mais fino. */}
            <div style={{
              display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
              padding: "10px 18px 12px",
              borderTop: "1px solid var(--ww-border-subtle)",
              borderBottom: "1px solid var(--ww-border-subtle)",
              background: "var(--ww-panel-sunken)",
            }}>
              <SegmentedControl
                value={escopo}
                onChange={mudarEscopo}
                options={[
                  { value: "aberto",   label: `Em aberto · ${contagemEscopo.aberto}` },
                  { value: "faturado", label: `Faturados · ${contagemEscopo.faturado}` },
                  { value: "todos",    label: `Todos · ${contagemEscopo.todos}` },
                ]}
              />
              <span aria-hidden style={{
                width: 1, alignSelf: "stretch", margin: "2px 4px",
                background: "var(--ww-border-subtle)",
              }} />
              {GRUPOS.map((g) => (
                <FilterChip key={g.chave} active={grupoSel === g.chave}
                  onClick={() => setGrupoSel(grupoSel === g.chave ? null : g.chave)}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                    {g.rotulo}
                    <StatusPill tone={g.tom}>{contagemGrupo[g.chave] ?? 0}</StatusPill>
                  </span>
                </FilterChip>
              ))}
              <input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar PV/OS, cliente, PC, fornecedor…"
                style={{
                  flex: "1 1 220px", minWidth: 180, padding: "7px 13px",
                  borderRadius: "var(--radius-pill)", fontSize: "var(--text-body-sm)",
                  background: "var(--ww-panel)", color: "var(--ww-text)",
                  border: "1px solid var(--ww-border-subtle)", outline: "none",
                }} />
              {(grupoSel || busca) && (
                <Button variant="ghost"
                  onClick={() => { setGrupoSel(null); setBusca(""); }}>Limpar</Button>
              )}
            </div>

            {vista === "lista" ? (
              <div style={{ padding: "0 18px 18px" }}>
                <ListaPedidos
                  pedidos={pedidos} dinheiro={dinheiro}
                  empresa={s(pedidos[0]?.head?.empresa) || "SF"}
                  abrirTudo={sinalExpandir}
                />
              </div>
            ) : vista === "tempo" ? (
              <div style={{ padding: "0 18px 18px" }}>
                <LinhaDoTempo buckets={bucketsLote} formatarValor={dinheiro} />
              </div>
            ) : vista === "kanban" ? (
              <div style={{ padding: "0 18px 18px", overflowX: "auto" }}>
                <KanbanRaias buckets={bucketsLote} formatarValor={dinheiro} />
              </div>
            ) : (
              <TreeTable columns={COLUNAS} groups={GRUPOS_COL} grid={GRID_TABELA} rows={arvore} minWidth={1240} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
