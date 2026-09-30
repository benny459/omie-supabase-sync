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
import TreeTable, { CelulaBarra, CelulaPill, CelulaTexto, type NoArvore } from "./TreeTable";
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

/* Colunas e grupos do modelo: RC (1) · PC (2) · Aprovação (1) · Materiais (3).
   A grelha é a do handoff, ao pixel. */
const COLUNAS = [
  { label: "Pedido › compra › item" },
  { label: "Custo", align: "right" as const },
  { label: "PC · fornecedor" },
  { label: "Valor PC", align: "right" as const },
  { label: "Status" },
  { label: "Recebido" },
  { label: "Status · previsão" },
  { label: "NF fornec.", align: "right" as const },
];

const GRUPOS_COL: { label: string; span: number; tone: Tom }[] = [
  { label: "RC",        span: 1, tone: "warn" },
  { label: "PC",        span: 2, tone: "info" },
  { label: "Aprovação", span: 1, tone: "ok" },
  { label: "Materiais", span: 3, tone: "violet" },
];

const GRID_TABELA =
  "minmax(280px,1.6fr) 110px minmax(150px,1.1fr) 110px 150px 130px minmax(160px,1.2fr) 90px";

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
  const pedidos: Pedido[] = useMemo(() => visiveis.map((b) => {
    /* Identidade de um lote: o PC, quando existe. Quando não existe, a RC —
       mesma regra do IDENTIDADE_DO_BLOCO da grelha (rc_numero + descrição),
       porque duas linhas com a mesma RC e a mesma descrição são a mesma
       requisição vista duas vezes, não duas requisições. Sem isto, linhas
       só-RC escapavam à dedupe e reapareciam a dobrar no tempo e no kanban.
       Empate: ganha a linha do Omie (ncod_ped > 0) sobre a manual. */
    const porChave = new Map<string, AnyRow>();
    const soltas: AnyRow[] = [];
    for (const r of b.rows) {
      const pc = s(r.pc_numero) || s(r.pc_numero_manual);
      const rc = s(r.rc_numero);
      const chave = pc ? `pc:${pc}` : rc ? `rc:${rc}|${s(r.rc_descricao)}` : "";
      if (!chave) { soltas.push(r); continue; }
      const ant = porChave.get(chave);
      if (!ant || (n(r.ncod_ped) > 0 && n(ant.ncod_ped) < 0)) porChave.set(chave, r);
    }
    const lotes = [...porChave.values(), ...soltas];
    const head = b.rows[0] ?? {};
    const al = alarmesPorBucket.get(b.pv_os_label) ?? new Set<AlarmKind>();

    /* Aprovação só conta sobre quem tem PC — é o PC que entra no workflow.
       Contar sobre todos os lotes produzia chips impossíveis como "1/0
       aprovados" (o PV1929 tem uma linha só-RC marcada APROVADO e nenhum PC). */
    const comPcLotes = lotes.filter((r) => s(r.pc_numero) || s(r.pc_numero_manual));
    const comPc = comPcLotes.length;
    const comRc = lotes.filter((r) => s(r.rc_numero)).length;
    const aprov = comPcLotes.filter((r) => STATUS_META[s(r.status)]?.isApproved).length;
    const receb = lotes.filter((r) => s(r.mt_data_recebimento_nf)).length;
    /* Trilho: as regras do pipeline da tela antiga, agora partilhadas.
       Avalia sobre `b.rows` (não sobre `lotes`) porque as regras de RC/PC
       contam cadastro incompleto, e a dedupe podia esconder uma cópia
       incompleta. `aprov_bloq` continua a mandar: um bloqueio explícito é
       pior do que a média que a regra de aprovação produz. */
    const pipe = estadoDoPipeline(b.rows, { modulo: "avulsos" });
    const traduz: Record<EstadoEtapa, Tom> =
      { green: "ok", yellow: "warn", red: "crit", off: "off" };
    const rail: Tom[] = ORDEM_TRILHO.map((etapa) => {
      if (etapa === "aprovacao" && al.has("aprov_bloq")) return "crit";
      return traduz[pipe[etapa]];
    });

    const chips: { texto: string; tom: Tom }[] = [
      { texto: `${comPc}/${lotes.length} PCs`, tom: comPc >= lotes.length ? "ok" : "warn" },
      ...(comPc > 0
        ? [{ texto: `${aprov}/${comPc} aprovados`, tom: (aprov >= comPc ? "ok" : "warn") as Tom }]
        : []),
      { texto: `${receb}/${lotes.length} recebidos`, tom: receb >= lotes.length ? "ok" : "info" },
    ];
    const mapa: Partial<Record<AlarmKind, { t: string; tom: Tom }>> = {
      venda: { t: "venda em atraso", tom: "crit" },
      pvos_incompl: { t: "PV incompleto", tom: "crit" },
      sem_projeto: { t: "sem projeto", tom: "crit" },
      aguarda_liberacao: { t: "aguarda liberação", tom: "warn" },
      retido_cliente: { t: "retido no cliente", tom: "warn" },
      sem_rc: { t: "sem RC", tom: "crit" },
      sem_pc: { t: "sem PC", tom: "crit" },
      compra: { t: "compra em atraso", tom: "warn" },
      defas_omie: { t: "defasado Omie", tom: "warn" },
      aprov_bloq: { t: "aprovação bloqueada", tom: "crit" },
      aprov_pend: { t: "aprovação pendente", tom: "warn" },
      pode_faturar: { t: "pode faturar", tom: "ok" },
    };
    for (const kind of al) { const m = mapa[kind]; if (m) chips.push({ texto: m.t, tom: m.tom }); }

    return { pv_os_label: b.pv_os_label, cliente: b.cliente, rows: b.rows, lotes, head, chips, rail };
  }), [visiveis, alarmesPorBucket]);

  /* Os buckets que o tempo e o kanban recebem. Antes levavam `visiveis` — as
     linhas cruas — e por isso o mesmo PC (ou a mesma RC) aparecia a dobrar
     nessas duas vistas enquanto a lista e a tabela mostravam um só. A dedupe
     só vale a pena se TODAS as vistas beberem dela. */
  const bucketsLote = useMemo(
    () => pedidos.map((p) => ({ pv_os_label: p.pv_os_label, cliente: p.cliente, rows: p.lotes })),
    [pedidos],
  );

  const arvore: NoArvore[] = useMemo(() => pedidos.map((p) => ({
    id: p.pv_os_label,
    name: p.pv_os_label,
    sub: `${p.cliente ?? "—"} · ${p.lotes.length} compra${p.lotes.length === 1 ? "" : "s"}`,
    cells: [
      dinheiro(p.lotes.reduce((t, r) => t + n(r.rc_custo) * (n(r.rc_qtd) || 1), 0)),
      <CelulaTexto key="pc" t={`${p.lotes.filter((r) => s(r.pc_numero) || s(r.pc_numero_manual)).length} PC(s)`}
        sub={s(p.head.tipo_omie) || undefined} />,
      dinheiro(p.lotes.reduce((t, r) => t + n(r.valor_total), 0)),
      <CelulaTexto key="ap"
        t={`${p.lotes.filter((r) => STATUS_META[s(r.status)]?.isApproved).length}/${p.lotes.length}`} />,
      <CelulaTexto key="rec"
        t={`${p.lotes.filter((r) => s(r.mt_data_recebimento_nf)).length}/${p.lotes.length}`} />,
      <CelulaTexto key="prev" t={s(p.head.pv_data_previsao) ? `limite ${s(p.head.pv_data_previsao)}` : "—"} />,
      <CelulaTexto key="nf" t={s(p.head.pv_num_nfe) || "—"} />,
    ],
    children: p.lotes.map((r, i) => {
      const meta = STATUS_META[s(r.status)];
      const pc = s(r.pc_numero) || s(r.pc_numero_manual);
      return {
        id: `${p.pv_os_label}:${s(r.ncod_ped)}:${i}`,
        name: `Compra ${i + 1}`,
        sub: s(r.rc_numero) ? `RC ${s(r.rc_numero)}` : undefined,
        cells: [
          dinheiro(n(r.rc_custo) * (n(r.rc_qtd) || 1)),
          <CelulaTexto key="pc" t={pc ? `PC ${pc}` : "—"} sub={s(r.nome_fornecedor) || undefined} />,
          dinheiro(n(r.valor_total)),
          meta
            ? <CelulaPill key="ap" tone={meta.isApproved ? "ok" : "warn"}
                sub={s(r.aprovador_email).split("@")[0] || undefined}>{meta.label}</CelulaPill>
            : <CelulaTexto key="ap" t="—" />,
          <CelulaTexto key="rec" t={s(r.mt_data_recebimento_nf) || "—"} />,
          <CelulaTexto key="prev"
            t={s(r.mt_status_fornecimento) || "—"}
            sub={s(r.nova_prev_materiais) || s(r.dt_previsao) || undefined} />,
          <CelulaTexto key="nf" t={s(r.mt_nf_fornecedor) || "—"} />,
        ],
      };
    }),
  })), [pedidos, dinheiro]);

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

      {/* Escopo de faturamento — a primeira decisão de leitura da tela, por
          isso vive acima dos alarmes: define sobre que conjunto tudo o resto
          (contagens, KPIs, lista) se refere. */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <SegmentedControl
          value={escopo}
          onChange={mudarEscopo}
          options={[
            { value: "aberto",   label: `Em aberto · ${contagemEscopo.aberto}` },
            { value: "faturado", label: `Faturados · ${contagemEscopo.faturado}` },
            { value: "todos",    label: `Todos · ${contagemEscopo.todos}` },
          ]}
        />
        <span style={{ fontSize: "var(--text-micro)", color: "var(--ww-text-faint)" }}>
          {escopo === "aberto"   ? "Só o que ainda não faturou — é o que a operação tem em mãos."
         : escopo === "faturado" ? "PV/OS já faturados ou cancelados — histórico, não carteira."
         : "Tudo, aberto e fechado."}
        </span>
      </div>

      {/* Faixa de grupos de alarme — clicar aplica o filtro do grupo */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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
            flex: "1 1 260px", minWidth: 200, padding: "7px 13px",
            borderRadius: "var(--radius-pill)", fontSize: "var(--text-body-sm)",
            background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
            border: "1px solid var(--ww-border-subtle)", outline: "none",
          }} />
      </div>

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
                  O que está em aberto — pedido resume, compra liga RC → PC → aprovação → materiais, item mostra quanto chegou
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
