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
import { canViewValues } from "@/lib/permissions";
import { useUserPerms } from "../UserPermsProvider";
import KpisNavy from "./KpisNavy";
import TreeTable, { CelulaBarra, CelulaPill, CelulaTexto, type NoArvore } from "./TreeTable";
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

const COLUNAS = [
  { label: "Pedido › lote › item" },
  { label: "RC", width: "110px" },
  { label: "PC · fornecedor", width: "minmax(150px,1.1fr)" },
  { label: "Valor", width: "110px", align: "right" as const },
  { label: "Aprovação", width: "150px" },
  { label: "Materiais", width: "130px" },
  { label: "Recebimento", width: "minmax(160px,1.2fr)" },
  { label: "Total", width: "90px", align: "right" as const },
];

export default function TelaAvulsosNavy() {
  const perms = useUserPerms();
  const podeVerValores = canViewValues(perms, "avulsos");
  const dinheiro = (v: number) => (podeVerValores ? BRL.format(v) : MASCARA);

  const [rows, setRows] = useState<AnyRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [grupoSel, setGrupoSel] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

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
  const buckets = useMemo(() => {
    const m = new Map<string, { pv_os_label: string; cliente: string | null; rows: AnyRow[] }>();
    for (const r of rows ?? []) {
      const k = s(r.pv_os_label) || "—";
      let b = m.get(k);
      if (!b) { b = { pv_os_label: k, cliente: (r.pv_cliente_fantasia as string) ?? null, rows: [] }; m.set(k, b); }
      b.rows.push(r);
    }
    return [...m.values()];
  }, [rows]);

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
  const arvore: NoArvore[] = useMemo(() => visiveis.map((b) => {
    const porPc = new Map<string, AnyRow>();
    const semPc: AnyRow[] = [];
    for (const r of b.rows) {
      const pc = s(r.pc_numero) || s(r.pc_numero_manual);
      if (!pc) { semPc.push(r); continue; }
      const ant = porPc.get(pc);
      if (!ant || (n(r.ncod_ped) > 0 && n(ant.ncod_ped) < 0)) porPc.set(pc, r);
    }
    const lotes = [...porPc.values(), ...semPc];
    const head = b.rows[0] ?? {};
    const totalPc = lotes.reduce((t, r) => t + n(r.valor_total), 0);
    const recebidos = lotes.filter((r) => s(r.mt_data_recebimento_nf)).length;
    const aprovados = lotes.filter((r) => STATUS_META[s(r.status)]?.isApproved).length;
    const comPc = lotes.filter((r) => s(r.pc_numero) || s(r.pc_numero_manual)).length;

    return {
      id: b.pv_os_label,
      name: b.pv_os_label,
      sub: `${b.cliente ?? "—"} · ${lotes.length} lote${lotes.length === 1 ? "" : "s"}`,
      cells: [
        <CelulaTexto key="rc" t={`${lotes.filter((r) => s(r.rc_numero)).length}/${lotes.length}`} />,
        <CelulaTexto key="pc" t={`${comPc} com PC`} sub={s(head.tipo_omie) || undefined} />,
        dinheiro(n(head.pv_valor_total)),
        <CelulaBarra key="ap" valor={`${aprovados}/${comPc || 0}`}
          pct={comPc ? (aprovados / comPc) * 100 : 0} tone={aprovados === comPc && comPc > 0 ? "ok" : "warn"} />,
        <CelulaBarra key="mat" valor={`${recebidos}/${lotes.length}`}
          pct={lotes.length ? (recebidos / lotes.length) * 100 : 0}
          tone={recebidos === lotes.length && lotes.length > 0 ? "ok" : "info"} />,
        <CelulaTexto key="rec" t={s(head.pv_dt_fat) ? `faturado ${s(head.pv_dt_fat)}` : "—"} />,
        dinheiro(totalPc),
      ],
      children: lotes.map((r, i) => {
        const pc = s(r.pc_numero) || s(r.pc_numero_manual);
        const st = s(r.status);
        const meta = STATUS_META[st];
        return {
          id: `${b.pv_os_label}:${s(r.ncod_ped)}:${i}`,
          name: pc ? `PC ${pc}` : s(r.rc_numero) ? `RC ${s(r.rc_numero)}` : "lote",
          sub: s(r.nome_fornecedor) || s(r.rc_descricao) || undefined,
          cells: [
            <CelulaTexto key="rc" t={s(r.rc_numero) || "—"} />,
            <CelulaTexto key="pc" t={pc || "—"} sub={s(r.codigo_categoria) || undefined} />,
            dinheiro(n(r.valor_total)),
            meta
              ? <CelulaPill key="ap" tone={meta.isApproved ? "ok" : st === "PENDENTE" || st === "PRE_SELECAO" ? "warn" : "crit"}
                  sub={s(r.aprovador_email) || undefined}>{meta.label}</CelulaPill>
              : <CelulaTexto key="ap" t="—" />,
            s(r.mt_status_fornecimento)
              ? <StatusPill key="mat" tone="ok">{s(r.mt_status_fornecimento)}</StatusPill>
              : <CelulaTexto key="mat" t="—" />,
            <CelulaTexto key="rec"
              t={s(r.mt_data_recebimento_nf) ? `NF ${s(r.mt_nf_fornecedor) || "—"}` : "—"}
              sub={s(r.mt_data_recebimento_nf) || s(r.dt_previsao) || undefined} />,
            dinheiro(n(r.valor_total)),
          ],
        };
      }),
    };
  }), [visiveis, dinheiro]);

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
          <KpisNavy buckets={visiveis} formatarValor={dinheiro} />

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
                  Pedido › lote
                </div>
                <div style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-muted)" }}>
                  {visiveis.length} pedido{visiveis.length === 1 ? "" : "s"} · {dinheiro(totalGeral)} em PV
                </div>
              </div>
            </div>
            <TreeTable columns={COLUNAS} rows={arvore} minWidth={1180} />
          </section>
        </>
      )}
    </div>
  );
}
