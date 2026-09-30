// Monta, a partir dos buckets do painel, o que as vistas Navy consomem:
// pedidos (Lista), buckets deduplicados (Linha do tempo, Kanban) e a árvore
// da Tabela. Vivia dentro de TelaAvulsosNavy; saiu daqui em 30/09/2026 para
// a tela principal (BoldAvulsosView) usar as MESMAS regras — Avulsos,
// Projetos e PCs Standalone passam todos por aqui.
//
// Regra nº 1 do handoff: nenhuma regra de negócio muda. Alarmes vêm de
// computeBucketAlarms, aprovação de STATUS_META, trilho de estadoDoPipeline.

import { computeBucketAlarms, type AlarmKind } from "@/lib/alarmes";
import { STATUS_META } from "@/lib/columns";
import { estadoDoPipeline, ORDEM_TRILHO, type EstadoEtapa } from "@/lib/pipeline-estado";
import { CelulaBarra, CelulaPill, CelulaTexto, type NoArvore } from "@/components/navy/TreeTable";
import type { Pedido } from "@/components/navy/ListaPedidos";
import type { Tom } from "@/components/navy/primitivos";

type AnyRow = Record<string, unknown>;
const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

export type BucketNavy = { pv_os_label: string; cliente: string | null; rows: AnyRow[] };

/* Colunas e grupos do modelo: RC (1) · PC (2) · Aprovação (1) · Materiais (3). */
export const COLUNAS_TABELA = [
  { label: "Pedido › compra › item" },
  { label: "Custo", align: "right" as const },
  { label: "PC · fornecedor" },
  { label: "Valor PC", align: "right" as const },
  { label: "Status" },
  { label: "Recebido" },
  { label: "Status · previsão" },
  { label: "NF fornec.", align: "right" as const },
];
export const GRUPOS_TABELA: { label: string; span: number; tone: Tom }[] = [
  { label: "RC",        span: 1, tone: "warn" },
  { label: "PC",        span: 2, tone: "info" },
  { label: "Aprovação", span: 1, tone: "ok" },
  { label: "Materiais", span: 3, tone: "violet" },
];
export const GRID_TABELA =
  "minmax(280px,1.6fr) 110px minmax(150px,1.1fr) 110px 150px 130px minmax(160px,1.2fr) 90px";

export function montarPedidos(
  buckets: BucketNavy[],
  opts: { modulo: string; hoje: number; alarmes?: Map<string, Set<AlarmKind>> },
): Pedido[] {
  const alarmesPorBucket = opts.alarmes ?? new Map(
    buckets.map((b) => [b.pv_os_label, computeBucketAlarms(b.rows, opts.hoje)] as const));
  const visiveis = buckets;
  return visiveis.map((b0) => {
    /* Bucket de projeto chega sem cliente — vem da primeira linha que tiver. */
    // PC Standalone: a segunda coluna é o fornecedor — não há cliente.
    const b = opts.modulo === "pcs"
      ? { ...b0, cliente: (b0.rows.map((r) => s(r.nome_fornecedor).replace(/&amp;/g, "&")).find(Boolean) ?? null) }
      : b0.cliente ? b0 : {
      ...b0,
      cliente: (b0.rows.map((r) => s(r.pv_cliente_fantasia) || s(r.pv_cliente) || s(r.cliente_fantasia))
        .find(Boolean) ?? null),
    };
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
    const pipe = estadoDoPipeline(b.rows, { modulo: opts.modulo });
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
    /* PC Standalone não tem venda, RC nem projeto por definição — os alarmes
       de venda eram ruído em todos os 1.452 cartões. Ficam compra, aprovação
       e defasagem. */
    const soCompra = new Set<AlarmKind>(["compra", "defas_omie", "aprov_bloq", "aprov_pend"]);
    for (const kind of al) {
      if (opts.modulo === "pcs" && !soCompra.has(kind)) continue;
      const m = mapa[kind]; if (m) chips.push({ texto: m.t, tom: m.tom });
    }

    return { pv_os_label: b.pv_os_label, cliente: b.cliente, rows: b.rows, lotes, head, chips, rail };
  });
}


/** Buckets já deduplicados (um PC é um PC) para o tempo e o kanban. */
export function bucketsDosPedidos(pedidos: Pedido[]): BucketNavy[] {
  return pedidos.map((p) => ({ pv_os_label: p.pv_os_label, cliente: p.cliente, rows: p.lotes }));
}

export function montarArvore(pedidos: Pedido[], dinheiro: (v: number) => string): NoArvore[] {
  return pedidos.map((p) => ({
    id: p.pv_os_label,
    name: p.pv_os_label,
    sub: `${p.cliente ?? "—"} · ${p.lotes.length} compra${p.lotes.length === 1 ? "" : "s"}`,
    cells: (() => {
      /* Linha do pedido como no modelo: contagens em pílula, recebimento com
         barra, fornecedores por extenso. Aprovação conta só quem tem PC —
         é o PC que entra no workflow (mesma regra dos chips da Lista). */
      const comPc = p.lotes.filter((r) => s(r.pc_numero) || s(r.pc_numero_manual));
      const aprov = comPc.filter((r) => STATUS_META[s(r.status)]?.isApproved).length;
      const receb = p.lotes.filter((r) => s(r.mt_data_recebimento_nf)).length;
      const forn = [...new Set(comPc.map((r) => s(r.nome_fornecedor)).filter(Boolean))];
      const bloq = comPc.some((r) => /BLOQ/i.test(s(r.status)));
      return [
        dinheiro(p.lotes.reduce((t, r) => t + n(r.rc_custo) * (n(r.rc_qtd) || 1), 0)),
        <CelulaTexto key="pc" t={`${comPc.length}/${p.lotes.length} PCs`}
          tone={comPc.length >= p.lotes.length ? "info" : "warn"}
          sub={forn.length ? (forn.length > 2 ? `${forn.slice(0, 2).join(", ")} +${forn.length - 2}` : forn.join(", ")) : undefined} />,
        dinheiro(p.lotes.reduce((t, r) => t + n(r.valor_total), 0)),
        comPc.length
          ? <CelulaPill key="ap" tone={bloq ? "crit" : aprov >= comPc.length ? "ok" : "warn"}>{aprov}/{comPc.length} aprovados</CelulaPill>
          : <CelulaTexto key="ap" t="—" sub="sem PC" />,
        <CelulaBarra key="rec" valor={`${receb}/${p.lotes.length}`}
          pct={p.lotes.length ? (receb / p.lotes.length) * 100 : 0}
          tone={receb >= p.lotes.length && p.lotes.length ? "ok" : "warn"} />,
        <CelulaPill key="prev" tone={receb >= p.lotes.length && p.lotes.length ? "ok" : "warn"}
          sub={s(p.head.pv_data_previsao) ? `previsão limite ${s(p.head.pv_data_previsao)}` : undefined}>
          {receb}/{p.lotes.length} recebidos
        </CelulaPill>,
        <CelulaTexto key="nf" t={s(p.head.pv_num_nfe) || "—"} />,
      ];
    })(),
    children: p.lotes.map((r, i) => {
      const meta = STATUS_META[s(r.status)];
      const pc = s(r.pc_numero) || s(r.pc_numero_manual);
      return {
        id: `${p.pv_os_label}:${s(r.ncod_ped)}:${i}`,
        name: `Compra ${i + 1}`,
        sub: s(r.rc_numero) ? `RC ${s(r.rc_numero)}` : undefined,
        /* Mesma regra da Lista: aprovação, materiais e valor pertencem ao PC.
           Sem PC a view devolve status "PENDENTE" por omissão e a linha
           passava a afirmar uma pendência que não existe — a requisição ainda
           nem virou compra. Colunas do PC ficam vazias. */
        cells: pc
          ? [
              dinheiro(n(r.rc_custo) * (n(r.rc_qtd) || 1)),
              <CelulaTexto key="pc" t={`PC ${pc}`} sub={s(r.nome_fornecedor) || undefined} />,
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
            ]
          : [
              dinheiro(n(r.rc_custo) * (n(r.rc_qtd) || 1)),
              <CelulaTexto key="pc" t="—" sub="sem PC emitido" />,
              null, null, null, null, null,
            ],
      };
    }),
  }));
}

