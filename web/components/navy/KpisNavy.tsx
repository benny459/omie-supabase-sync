"use client";

/**
 * KPIs do topo — os quatro cards do modelo, na mesma ordem e forma:
 * carteira com sparkline · donut de aprovação com legenda · barras de
 * recebimento semanal · barras por estado.
 *
 * Do handoff: "Se algum KPI não for desejado, remover — não inventar métrica
 * nova sem fonte." Por isso cada número aqui tem origem declarada e nenhum é
 * estimado.
 *
 * Tudo calculado sobre os buckets JÁ FILTRADOS: os cards respondem ao filtro
 * de cima, senão diriam uma coisa e a lista outra.
 */

import { useMemo } from "react";
import { STATUS_META, ehHistoricoOmie } from "@/lib/columns";
import { tom, type Tom } from "./primitivos";

type AnyRow = Record<string, unknown>;
type Bucket = { pv_os_label: string; rows: AnyRow[] };

const s = (v: unknown) => String(v ?? "").trim();
const n = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

/** Mesma regra de lib/alarmes.ts. A redundância é intencional lá, para
 *  imunizar contra lag de sync do Omie — copiá-la pela metade daria uma
 *  carteira maior do que a real. */
export function pedidoEncerrado(head: AnyRow): boolean {
  const etapa = s(head.pv_etapa_texto);
  return s(head.pv_dt_fat) !== "" || s(head.pv_num_nfe) !== ""
      || etapa === "Faturado" || etapa === "Cancelado";
}

const PENDENTES = new Set(["PENDENTE", "PRE_SELECAO"]);
const BLOQUEADOS = new Set(["NAO_APROVADO", "REJEITADO_VALIDADE"]);

const CARD: React.CSSProperties = {
  borderRadius: "var(--radius-panel)", padding: "18px 20px",
  background: "var(--ww-panel-grad)", border: "1px solid var(--ww-border)",
  boxShadow: "var(--shadow-card)", minWidth: 0,
};

export default function KpisNavy({
  buckets, formatarValor, rotuloPedido = "pedido", escopo = "aberto",
}: {
  buckets: Bucket[];
  formatarValor: (v: number) => string;
  rotuloPedido?: string;
  /** Qual metade do faturamento a tela está a mostrar — muda o cartão-herói. */
  escopo?: "aberto" | "faturado" | "todos";
}) {
  const contarEncerrados = escopo === "faturado";
  const tituloHero = contarEncerrados ? "Faturado" : "Carteira em aberto";
  const k = useMemo(() => {
    let carteira = 0, abertos = 0, compras = 0;
    let apr = 0, pend = 0, bloq = 0, semPc = 0;
    let aReceber = 0, aguardaAprov = 0, recebidas = 0;
    const porSemana = new Map<string, number>();
    // Série da carteira por mês de emissão — dá a forma do sparkline.
    const porMes = new Map<string, number>();

    for (const b of buckets) {
      const head = b.rows[0] ?? {};
      /* O cartão-herói soma o lado do faturamento que se está a ver. Em
         "Em aberto"/"Todos" é a carteira (não encerrados); em "Faturados"
         seriam zero pedidos e o cartão ficava a mostrar R$ 0,00 com o
         gráfico vazio — um zero que parece um dado e não é. */
      if (pedidoEncerrado(head) === contarEncerrados) {
        /* PC Standalone não tem venda: a "carteira" é o valor dos PCs ainda
           não recebidos, datada pela emissão do PC. */
        const ehPc = rotuloPedido === "PC";
        const valor = ehPc
          ? b.rows.filter((r) => !s(r.mt_data_recebimento_nf)).reduce((a, r) => a + n(r.valor_total), 0)
          : n(head.pv_valor_total);
        carteira += valor;
        abertos += 1;
        const em = ehPc ? s(head.dt_inclusao) : s(head.pv_emissao);
        const mes = em.length >= 10
          ? (em.includes("/") ? `${em.slice(6, 10)}-${em.slice(3, 5)}` : em.slice(0, 7))
          : "";
        if (mes) porMes.set(mes, (porMes.get(mes) ?? 0) + valor);
      }

      // Um PC é um PC — a mesma dedupe do resto da tela.
      const porPc = new Map<string, AnyRow>();
      const semNumero: AnyRow[] = [];
      for (const r of b.rows) {
        const pc = s(r.pc_numero) || s(r.pc_numero_manual);
        if (!pc) { semNumero.push(r); continue; }
        const ant = porPc.get(pc);
        if (!ant || (n(r.ncod_ped) > 0 && n(ant.ncod_ped) < 0)) porPc.set(pc, r);
      }
      const lotes = [...porPc.values(), ...semNumero];
      compras += lotes.length;
      if (porPc.size === 0) semPc += 1;

      for (const r of lotes) {
        const temPc = !!(s(r.pc_numero) || s(r.pc_numero_manual));
        const st = s(r.status);
        const aprovado = STATUS_META[st]?.isApproved === true;
        if (temPc) {
          if (aprovado) apr += 1;
          else if (PENDENTES.has(st)) pend += 1;
          else if (BLOQUEADOS.has(st)) bloq += 1;
        }
        const rec = s(r.mt_data_recebimento_nf);
        if (rec) {
          recebidas += 1;
          const d = new Date(rec);
          if (!Number.isNaN(d.getTime())) {
            const seg = new Date(d);
            seg.setDate(d.getDate() - ((d.getDay() + 6) % 7));
            const chave = seg.toISOString().slice(0, 10);
            porSemana.set(chave, (porSemana.get(chave) ?? 0) + n(r.valor_total));
          }
        } else if (!temPc) {
          // sem PC ainda não é compra em curso
        } else if (aprovado) aReceber += 1;
        else if (!ehHistoricoOmie(r)) aguardaAprov += 1;   // sql/159: histórico do Omie não aguarda nada
      }
    }

    const semanas = [...porSemana.entries()].sort((a, b2) => a[0].localeCompare(b2[0])).slice(-6);
    const meses = [...porMes.entries()].sort((a, b2) => a[0].localeCompare(b2[0])).slice(-8);
    return { carteira, abertos, compras, apr, pend, bloq, semPc,
             aReceber, aguardaAprov, recebidas, semanas, meses,
             totalPc: apr + pend + bloq,
             recTot: semanas.reduce((t, [, v]) => t + v, 0) };
  }, [buckets, contarEncerrados]);

  /* Donut por conic-gradient, como no modelo — sem biblioteca de gráfico para
     um anel de quatro fatias. */
  const fatias: { t: string; nv: number; cor: string }[] = [
    { t: "Aprovados",  nv: k.apr,   cor: "var(--ww-ok)" },
    { t: "Pendentes",  nv: k.pend,  cor: "var(--ww-warn)" },
    { t: "Bloqueados", nv: k.bloq,  cor: "var(--ww-crit)" },
    { t: `Sem PC (${rotuloPedido}s)`, nv: k.semPc, cor: "var(--ww-off)" },
  ];
  const totalDonut = Math.max(1, k.apr + k.pend + k.bloq + k.semPc);
  let acc = 0;
  const paradas = fatias.map((f) => {
    const ini = (acc / totalDonut) * 360; acc += f.nv;
    const fim = (acc / totalDonut) * 360;
    return `${f.cor} ${ini}deg ${fim}deg`;
  }).join(", ");

  const maxSemana = Math.max(1, ...k.semanas.map(([, v]) => v));
  const maxMes = Math.max(1, ...k.meses.map(([, v]) => v));
  const barras: { t: string; nv: number; tone: Tom }[] = [
    { t: "Recebidas",     nv: k.recebidas,    tone: "ok" },
    { t: "A receber",     nv: k.aReceber,     tone: "info" },
    { t: "Aguarda aprov.", nv: k.aguardaAprov, tone: "warn" },
  ];
  const maxBarra = Math.max(1, ...barras.map((b) => b.nv));

  const pontos = k.meses.length > 1
    ? k.meses.map(([, v], i) =>
        `${(i / (k.meses.length - 1)) * 300},${70 - (v / maxMes) * 58}`).join(" ")
    : "";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 16 }}>
      {/* 1 — Carteira, com sparkline */}
      <div style={{ ...CARD, background: "var(--ww-hero-grad)", color: "var(--ww-hero-text)" }}>
        <div style={{ fontSize: "var(--text-body-sm)", fontWeight: 700 }}>{tituloHero}</div>
        <div style={{
          fontSize: "var(--text-kpi-hero)", fontWeight: 700,
          letterSpacing: "var(--tracking-tight)", marginTop: 4,
        }}>{formatarValor(k.carteira)}</div>
        <div style={{ fontSize: "var(--text-meta)", color: "var(--ww-hero-text-2)" }}>
          {k.abertos} {rotuloPedido}{k.abertos === 1 ? "" : "s"} · {k.compras} compra{k.compras === 1 ? "" : "s"}
        </div>
        {pontos && (
          <svg viewBox="0 0 300 70" preserveAspectRatio="none" style={{ width: "100%", height: 54, marginTop: 8 }}>
            <defs>
              <linearGradient id="sparkNavy" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--ww-accent-sky)" stopOpacity=".35" />
                <stop offset="1" stopColor="var(--ww-accent-sky)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon points={`0,70 ${pontos} 300,70`} fill="url(#sparkNavy)" />
            <polyline points={pontos} fill="none" stroke="var(--ww-accent-sky)" strokeWidth="2.5" />
          </svg>
        )}
      </div>

      {/* 2 — Aprovação, donut + legenda */}
      <div style={{ ...CARD, display: "flex", gap: 18, alignItems: "center" }}>
        <div style={{
          flex: "none", width: 118, height: 118, borderRadius: "50%",
          background: `conic-gradient(${paradas})`, display: "grid", placeItems: "center",
          boxShadow: "0 0 24px rgba(108,203,255,.18)",
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: "50%", background: "var(--ww-panel-sunken)",
            display: "grid", placeItems: "center", textAlign: "center",
          }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 600, color: "var(--ww-text)" }}>
                {k.apr}/{k.totalPc}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--ww-text-muted)" }}>PCs aprov.</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ww-text)" }}>Aprovação de PCs</div>
          {fatias.map((f) => (
            <div key={f.t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ww-text-2)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: f.cor }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.t}</span>
              <span style={{ fontWeight: 600 }}>{f.nv}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 3 — Recebimento semanal */}
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ww-text)" }}>Recebimento semanal</div>
        <div style={{
          fontSize: "var(--text-kpi)", fontWeight: 700, color: "var(--ww-text)",
          letterSpacing: "var(--tracking-tight)", marginTop: 2,
        }}>{formatarValor(k.recTot)}</div>
        {k.semanas.length === 0 ? (
          <div style={{ fontSize: "var(--text-meta)", color: "var(--ww-text-faint)", marginTop: 8 }}>
            Nenhuma NF recebida no que está filtrado.
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 62, marginTop: 10 }}>
            {k.semanas.map(([semana, v]) => (
              <div key={semana} title={`${semana} · ${formatarValor(v)}`}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{
                  width: "100%", borderRadius: "var(--radius-bar) var(--radius-bar) 0 0",
                  height: `${Math.max(3, (v / maxSemana) * 44)}px`, background: "var(--ww-accent)",
                }} />
                <span style={{ fontSize: 9.5, color: "var(--ww-text-faint)" }}>
                  {semana.slice(8)}/{semana.slice(5, 7)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4 — Compras por estado. O modelo diz "Itens por status"; conta-se aqui
              por COMPRA porque contar item exige agregar orders.pedidos_compra
              sobre o conjunto visível, que muda a cada filtro. O rótulo diz o
              que está a ser contado em vez de fingir que é item. */}
      <div style={CARD}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ww-text)" }}>Compras por status</div>
        <div style={{
          fontSize: "var(--text-kpi)", fontWeight: 700, color: "var(--ww-text)",
          letterSpacing: "var(--tracking-tight)", marginTop: 2,
        }}>{k.compras}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 10 }}>
          {barras.map((b) => (
            <div key={b.t} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
              <span style={{ width: 104, color: "var(--ww-text-muted)" }}>{b.t}</span>
              <span style={{ flex: 1, height: 5, borderRadius: "var(--radius-bar)", background: "var(--ww-track)" }}>
                <span style={{
                  display: "block", height: "100%", borderRadius: "var(--radius-bar)",
                  width: `${(b.nv / maxBarra) * 100}%`, background: tom(b.tone).dot,
                }} />
              </span>
              <span style={{ width: 34, textAlign: "right", fontWeight: 600, color: tom(b.tone).fg }}>{b.nv}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
