"use client";

// As PREMISSAS do fechamento — o que foi combinado quando a proposta virou
// projeto, antes de existir título, pedido de compra ou nota.
//
// ── Por que isto precisa existir separado ──────────────────────────────────
// A tela mostrava o fluxo que o Omie conhece. Mas no começo o Omie não conhece
// nada: o PV pode nem estar emitido, e mão de obra e despesa de viagem NUNCA
// viram pedido de compra — não têm como aparecer sozinhas. O projeto abria
// vazio justamente quando mais se precisa dele, que é para decidir se fecha.
//
// ── A planilha é a fonte, a tela é a correção ──────────────────────────────
// O sistema de propostas gera a CP-MC. Importar evita redigitar 20 linhas de
// agenda de pagamento e deixa registrado QUAL revisão virou o plano. Depois
// tudo é editável aqui, porque a obra muda: a mão de obra é orçada antes de
// existir escala e a despesa antes da passagem ser comprada.
//
// ── O que NÃO é editável ───────────────────────────────────────────────────
// Evento, % e valor da parcela. São o acordo com o cliente; mudá-los na tela
// faria o baseline deixar de ser o que foi acordado, e o desvio passaria a
// medir contra um alvo móvel. Mudou a proposta → reimporta a revisão.

import { useCallback, useEffect, useRef, useState } from "react";
import { lerPlanoFechamento, type PlanoFechamento as Lido } from "@/lib/plano-fechamento";

export type PlanoCab = {
  proposta: string | null; cliente: string | null;
  data_base: string | null; valor_venda: number | null;
  prazo_entrega_dias: number | null; entrega_prevista: string | null;
  frete: string | null; deslocamento: string | null; instalacao: string | null;
  impostos: string | null; garantia: string | null;
  forma_pagamento: string | null; faturamento: string | null;
  observacoes: string | null;
  custo_materiais: number | null; custo_mao_obra: number | null;
  custo_despesas: number | null;
  margem_pct: number | null; margem_valor: number | null;
  importado_de: string | null; importado_em: string | null; importado_por: string | null;
};
export type PlanoParcela = {
  parcela: number; evento: string | null; pct: number | null;
  dt_plano: string | null; dt_ajustada: string | null;
  valor: number; num_titulo: string | null; observacao: string | null;
};
export type PlanoSaida = {
  id: number; origem: "material" | "sem_pc"; descricao: string | null;
  fornecedor: string | null; etapa: string | null;
  dias_apos_base: number | null; dt_prevista: string | null;
  valor: number; no_fluxo: boolean;
};
export type PlanoCompleto = {
  plano: PlanoCab | null; parcelas: PlanoParcela[]; saidas: PlanoSaida[];
};

const brl = (v: number | null | undefined) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (s: string | null) => {
  if (!s) return "—";
  const [a, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${a.slice(2)}`;
};
const hojeIso = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const diasEntre = (a: string, b: string) =>
  Math.round((new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000);

/** O evento da parcela, classificado para ganhar cor.
 *
 *  Não é enfeite: "fechamento" é dinheiro que entra na assinatura e "entrega"
 *  é dinheiro que depende da obra andar. São riscos diferentes, e quem lê a
 *  tabela precisa ver isso sem ler as quatro linhas. */
function tomDoEvento(ev: string | null): { rot: string; classe: string } {
  const e = (ev ?? "").toLowerCase();
  if (/fecha|assinat|pedido|entrada/.test(e))
    return { rot: ev ?? "—", classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" };
  if (/entreg|instala|comission|aceite|start|partida/.test(e))
    return { rot: ev ?? "—", classe: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30" };
  if (/\d+\s*dias?/.test(e))
    return { rot: ev ?? "—", classe: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" };
  return { rot: ev ?? "—", classe: "bg-ww-border/40 text-ww-textMuted border-ww-border" };
}

export default function PlanoFechamento({
  empresa, codigoProjeto, podeEditar, dados, onMudou,
}: {
  empresa: string; codigoProjeto: number; podeEditar: boolean;
  dados: PlanoCompleto | null;
  onMudou: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [avisosImport, setAvisosImport] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState<(Lido & { arquivo: string }) | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const plano = dados?.plano ?? null;
  const parcelas = dados?.parcelas ?? [];
  const saidas = dados?.saidas ?? [];

  // ── Importação ───────────────────────────────────────────────────────────
  const escolher = useCallback(async (f: File) => {
    setErro(null); setAviso(null);
    try {
      const lido = lerPlanoFechamento(await f.arrayBuffer());
      setAvisosImport(lido.avisos);
      setPrevia({ ...lido, arquivo: f.name });
    } catch (e) {
      setErro(`Não consegui ler a planilha: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const confirmarImport = useCallback(async () => {
    if (!previa) return;
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/rc-projetos/plano", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa, codigo_projeto: codigoProjeto,
          ...previa, importado_de: previa.arquivo,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setAviso(
        `Plano importado: ${j.parcelas} parcela(s) e ${j.saidas} saída(s).`
        + (j.ajustes_preservados
            ? ` ${j.ajustes_preservados} previsão(ões) que você já tinha ajustado foram mantidas.`
            : ""));
      setPrevia(null);
      if (arquivoRef.current) arquivoRef.current.value = "";
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setOcupado(false); }
  }, [previa, empresa, codigoProjeto, onMudou]);

  // ── Edições ──────────────────────────────────────────────────────────────
  const gravarLinha = useCallback(async (corpo: Record<string, unknown>) => {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/rc-projetos/plano/linha", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, ...corpo }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      onMudou();
    } finally { setOcupado(false); }
  }, [empresa, codigoProjeto, onMudou]);

  const gravarCab = useCallback(async (campo: string, valor: string) => {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/rc-projetos/plano", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, [campo]: valor }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      onMudou();
    } finally { setOcupado(false); }
  }, [empresa, codigoProjeto, onMudou]);

  const novaSaida = useCallback(async () => {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/rc-projetos/plano/linha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa, codigo_projeto: codigoProjeto,
          descricao: "Nova despesa", dt_prevista: plano?.data_base ?? hojeIso(), valor: 0,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      onMudou();
    } finally { setOcupado(false); }
  }, [empresa, codigoProjeto, plano, onMudou]);

  const apagarSaida = useCallback(async (id: number, desc: string) => {
    if (!window.confirm(`Remover "${desc}" do plano?`)) return;
    setOcupado(true); setErro(null);
    try {
      const r = await fetch(
        `/api/rc-projetos/plano/linha?empresa=${encodeURIComponent(empresa)}`
        + `&codigo_projeto=${codigoProjeto}&id=${id}`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      onMudou();
    } finally { setOcupado(false); }
  }, [empresa, codigoProjeto, onMudou]);

  // ── Totais ───────────────────────────────────────────────────────────────
  const totEnt = parcelas.reduce((a, p) => a + Number(p.valor || 0), 0);
  const totSai = saidas.filter((s) => s.no_fluxo).reduce((a, s) => a + Number(s.valor || 0), 0);
  const semPc = saidas.filter((s) => s.origem === "sem_pc");
  const materiais = saidas.filter((s) => s.origem === "material");
  const hoje = hojeIso();
  const escorregou = parcelas.filter((p) =>
    p.dt_ajustada && p.dt_plano && p.dt_ajustada !== p.dt_plano);

  const campo = (rot: string, chave: keyof PlanoCab, dica?: string) => (
    <div>
      <div className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">{rot}</div>
      {podeEditar ? (
        <input defaultValue={(plano?.[chave] as string) ?? ""} title={dica}
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== ((plano?.[chave] as string) ?? "")) void gravarCab(chave, v);
          }}
          placeholder="—"
          className="w-full mt-0.5 text-[11.5px] bg-transparent text-ww-text rounded px-1 py-0.5
                     border border-transparent hover:border-ww-border
                     focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
      ) : (
        <div className="mt-0.5 text-[11.5px] text-ww-text px-1 py-0.5">
          {(plano?.[chave] as string) || "—"}
        </div>
      )}
    </div>
  );

  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 space-y-3">
      <header className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
            Premissas do fechamento
          </h3>
          <p className="text-[11px] text-ww-textMuted mt-0.5 normal-case">
            {plano ? (
              <>
                {plano.proposta && <strong className="text-ww-text">{plano.proposta}</strong>}
                {plano.cliente && <> · {plano.cliente}</>}
                {" · "}{parcelas.length} parcela(s) · {saidas.length} saída(s) previstas.
                {plano.importado_em && (
                  <span className="text-ww-textFaint">
                    {" "}Importado de {plano.importado_de} em{" "}
                    {new Date(plano.importado_em).toLocaleDateString("pt-BR")}
                    {plano.importado_por ? ` por ${plano.importado_por}` : ""}.
                  </span>
                )}
              </>
            ) : (
              "O que foi combinado no fechamento: parcelas, condições e custos previstos. "
              + "É contra este plano que o previsto e o realizado medem desvio."
            )}
          </p>
        </div>
        {podeEditar && (
          <div className="ml-auto flex items-center gap-1.5">
            <input ref={arquivoRef} type="file" accept=".xlsx,.xlsm" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void escolher(f); }} />
            <button type="button" onClick={() => arquivoRef.current?.click()} disabled={ocupado}
              title="Lê a planilha CP-MC da proposta (abas Fluxo e MC)"
              className={`px-2.5 py-1 text-[11.5px] rounded-lg border transition disabled:opacity-40 ${
                plano ? "border-ww-border text-ww-textMuted hover:text-ww-text hover:bg-ww-rowHover"
                      : "border-ww-accent bg-ww-accent text-white font-semibold hover:brightness-110"}`}>
              {plano ? "Reimportar planilha" : "Importar planilha do fechamento"}
            </button>
          </div>
        )}
      </header>

      {erro && (
        <div className="p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-[11.5px] text-rose-700 dark:text-rose-300">
          {erro}
        </div>
      )}
      {aviso && (
        <div className="p-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-[11.5px] text-emerald-700 dark:text-emerald-300">
          {aviso}
        </div>
      )}

      {/* ── Prévia antes de gravar ──────────────────────────────────────────
          Importar SUBSTITUI o plano inteiro. Mostrar o que vai entrar antes de
          apagar o que está lá é o mínimo — e é onde as divergências da própria
          planilha aparecem. */}
      {previa && (
        <div className="p-3 rounded-lg border-2 border-ww-accent bg-ww-accentSoft space-y-2">
          <p className="text-[12px] text-ww-text">
            <strong>{previa.arquivo}</strong>
            {previa.proposta && <> · {previa.proposta}</>}
            {previa.cliente && <> · {previa.cliente}</>}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11.5px]">
            {[["Parcelas", `${previa.parcelas.length} · ${brl(previa.parcelas.reduce((a, p) => a + p.valor, 0))}`],
              ["Saídas", `${previa.saidas.length} · ${brl(previa.saidas.reduce((a, s) => a + s.valor, 0))}`],
              ["Valor de venda", brl(previa.valor_venda)],
              ["Início do projeto", dia(previa.data_base)]].map(([r, v]) => (
              <div key={r}>
                <div className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">{r}</div>
                <div className="text-ww-text tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          {avisosImport.length > 0 && (
            <ul className="text-[11px] text-amber-700 dark:text-amber-300 space-y-0.5 list-disc pl-4">
              {avisosImport.map((a) => <li key={a}>{a}</li>)}
            </ul>
          )}
          {plano && (
            <p className="text-[11px] text-ww-textMuted">
              Isto substitui o plano atual. As previsões de faturamento que você já ajustou
              são mantidas — elas são cronograma de obra, não proposta.
            </p>
          )}
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => void confirmarImport()} disabled={ocupado}
              className="px-3 py-1 text-[11.5px] rounded-lg bg-ww-accent text-white font-semibold hover:brightness-110 transition disabled:opacity-40">
              {ocupado ? "Gravando…" : "Gravar como plano"}
            </button>
            <button type="button" onClick={() => { setPrevia(null); setAvisosImport([]); }}
              className="px-2.5 py-1 text-[11.5px] rounded-lg border border-ww-border text-ww-textMuted hover:text-ww-text transition">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {!plano && !previa && (
        <p className="text-[11.5px] text-ww-textFaint py-2">
          Nenhum plano importado. Sem ele a tela só enxerga o que já existe no Omie —
          e no começo do projeto isso é quase nada: mão de obra e despesas de viagem
          nunca viram pedido de compra.
        </p>
      )}

      {plano && (
        <>
          {/* ── Condições ────────────────────────────────────────────────── */}
          <div className="rounded-lg border border-ww-border p-2.5">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-ww-textMuted mb-2">
              O que está e o que não está incluso
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-2">
              {campo("Frete", "frete")}
              {campo("Deslocamento e estadia", "deslocamento")}
              {campo("Instalação", "instalacao")}
              {campo("Impostos", "impostos")}
              {campo("Garantia", "garantia")}
              {campo("Forma de pagamento", "forma_pagamento")}
              {campo("Faturamento", "faturamento")}
              <div>
                <div className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
                  Início oficial
                </div>
                {podeEditar ? (
                  <input type="date" defaultValue={plano.data_base ?? ""}
                    title="Eixo das saídas que contam em dias — mão de obra, despesas"
                    onBlur={(e) => {
                      if (e.target.value !== (plano.data_base ?? "")) void gravarCab("data_base", e.target.value);
                    }}
                    className="w-full mt-0.5 text-[11.5px] bg-transparent text-ww-text rounded px-1 py-0.5
                               border border-transparent hover:border-ww-border
                               focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                ) : (
                  <div className="mt-0.5 text-[11.5px] text-ww-text px-1 py-0.5">{dia(plano.data_base)}</div>
                )}
              </div>
            </div>
            <p className="text-[10.5px] text-ww-textMuted mt-2">
              O que é <strong>por nossa conta</strong> vira saída de caixa e entra no fluxo abaixo.
              O que é do cliente não entra.
              {plano.entrega_prevista && <> Entrega prevista: <strong>{dia(plano.entrega_prevista)}</strong>
                {plano.prazo_entrega_dias ? ` (${plano.prazo_entrega_dias} dias)` : ""}.</>}
            </p>
          </div>

          {/* ── Margem projetada ─────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { r: "Valor de venda", v: brl(plano.valor_venda), t: "verde" },
              { r: "Materiais (CMV)", v: brl(plano.custo_materiais), t: "vermelho" },
              { r: "Mão de obra", v: brl(plano.custo_mao_obra), t: "vermelho" },
              { r: "Despesas", v: brl(plano.custo_despesas), t: "vermelho" },
              { r: "Custo total", v: brl((plano.custo_materiais ?? 0) + (plano.custo_mao_obra ?? 0) + (plano.custo_despesas ?? 0)), t: "vermelho" },
              { r: "Margem projetada",
                v: plano.margem_pct != null
                  ? `${Number(plano.margem_pct).toFixed(1).replace(".", ",")}%` : "—",
                s: brl(plano.margem_valor), t: "verde" },
            ].map((c) => (
              <div key={c.r} className={`rounded-lg border p-2 ${
                c.t === "verde" ? "border-emerald-500/25 bg-emerald-500/[0.05]"
                                : "border-rose-500/25 bg-rose-500/[0.05]"}`}>
                <div className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">{c.r}</div>
                <div className={`text-[13px] font-bold tabular-nums mt-0.5 ${
                  c.t === "verde" ? "text-emerald-600 dark:text-emerald-300"
                                  : "text-rose-600 dark:text-rose-300"}`}>{c.v}</div>
                {c.s && <div className="text-[10px] text-ww-textMuted tabular-nums">{c.s}</div>}
              </div>
            ))}
          </div>

          {/* ── Parcelas ─────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-ww-textMuted">
                Entradas — recebimento acordado no fechamento
              </span>
              <span className="text-[10.5px] text-ww-textFaint tabular-nums">
                {parcelas.length} parcela(s) · {brl(totEnt)}
              </span>
              {escorregou.length > 0 && (
                <span className="text-[10.5px] text-rose-600 dark:text-rose-400">
                  · {escorregou.length} com data diferente do plano
                </span>
              )}
            </div>
            <div className="overflow-x-auto border border-ww-border rounded-lg">
              <table className="w-full text-[11.5px] border-collapse">
                <thead className="bg-ww-bg">
                  <tr className="text-[10px] uppercase tracking-wider text-ww-textMuted">
                    <th className="text-left p-1.5 font-semibold w-[46px]">#</th>
                    <th className="text-left p-1.5 font-semibold min-w-[190px]">Evento</th>
                    <th className="text-right p-1.5 font-semibold w-[62px]">%</th>
                    <th className="text-left p-1.5 font-semibold w-[86px]">Plano</th>
                    <th className="text-left p-1.5 font-semibold w-[130px]">Previsão de faturamento</th>
                    <th className="text-right p-1.5 font-semibold w-[76px]">Desvio</th>
                    <th className="text-right p-1.5 font-semibold w-[106px]">Valor</th>
                    <th className="text-left p-1.5 font-semibold w-[100px]">Situação</th>
                    <th className="text-left p-1.5 font-semibold w-[96px]">Nº título</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelas.map((p) => {
                    const ev = tomDoEvento(p.evento);
                    const efetiva = p.dt_ajustada ?? p.dt_plano;
                    const desvio = p.dt_ajustada && p.dt_plano
                      ? diasEntre(p.dt_plano, p.dt_ajustada) : null;
                    const sit = p.num_titulo ? { r: "Faturada", c: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" }
                      : !efetiva ? { r: "Sem data", c: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" }
                      : efetiva < hoje ? { r: "Atrasada", c: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30" }
                      : { r: "A faturar", c: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" };
                    return (
                      <tr key={p.parcela} className="viz-row">
                        <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted tabular-nums">{p.parcela}</td>
                        <td className="p-1.5 border-b border-ww-border/50">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${ev.classe}`}>
                            {ev.rot}
                          </span>
                        </td>
                        <td className="p-1.5 border-b border-ww-border/50 text-right tabular-nums text-ww-textMuted">
                          {p.pct != null ? `${Number(p.pct).toFixed(0)}%` : "—"}
                        </td>
                        {/* O baseline fica visível mesmo depois de ajustado: é
                            contra ele que se enxerga o tamanho do desvio. */}
                        <td className={`p-1.5 border-b border-ww-border/50 tabular-nums ${
                          p.dt_ajustada ? "text-ww-textFaint line-through" : "text-ww-textMuted"}`}>
                          {dia(p.dt_plano)}
                        </td>
                        <td className="p-1 border-b border-ww-border/50">
                          {podeEditar ? (
                            <input type="date" defaultValue={p.dt_ajustada ?? ""}
                              title="Quando esta parcela vai ser faturada, pelo cronograma real"
                              onBlur={(e) => {
                                if ((e.target.value || null) !== (p.dt_ajustada ?? null)) {
                                  void gravarLinha({ tipo: "parcela", parcela: p.parcela, dt_ajustada: e.target.value });
                                }
                              }}
                              className="w-[122px] bg-transparent px-1 py-1 text-[11px] text-ww-text rounded
                                         border border-transparent hover:border-ww-border
                                         focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                          ) : (
                            <span className="px-1.5 text-ww-text tabular-nums">{dia(p.dt_ajustada)}</span>
                          )}
                        </td>
                        <td className="p-1.5 border-b border-ww-border/50 text-right tabular-nums">
                          {desvio == null ? <span className="text-ww-textFaint">—</span>
                            : desvio === 0 ? <span className="text-ww-textMuted">no prazo</span>
                            : <span className={desvio > 0
                                ? "text-rose-600 dark:text-rose-400 font-semibold"
                                : "text-emerald-600 dark:text-emerald-400 font-semibold"}>
                                {desvio > 0 ? "+" : ""}{desvio}d
                              </span>}
                        </td>
                        <td className="p-1.5 border-b border-ww-border/50 text-right tabular-nums text-ww-text">
                          {brl(p.valor)}
                        </td>
                        <td className="p-1.5 border-b border-ww-border/50">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold border ${sit.c}`}>
                            {sit.r}
                          </span>
                        </td>
                        <td className="p-1 border-b border-ww-border/50">
                          {podeEditar ? (
                            <input defaultValue={p.num_titulo ?? ""} placeholder="—"
                              title="O título do Omie que corresponde a esta parcela, quando faturada"
                              onBlur={(e) => {
                                if (e.target.value.trim() !== (p.num_titulo ?? "")) {
                                  void gravarLinha({ tipo: "parcela", parcela: p.parcela, num_titulo: e.target.value.trim() });
                                }
                              }}
                              className="w-[86px] bg-transparent px-1 py-1 text-[11px] text-ww-text rounded
                                         border border-transparent hover:border-ww-border
                                         focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                          ) : <span className="px-1.5 text-ww-textMuted">{p.num_titulo || "—"}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Saídas sem pedido de compra ──────────────────────────────── */}
          <div>
            <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-ww-textMuted">
                Saídas sem pedido de compra
              </span>
              <span className="text-[10.5px] text-ww-textFaint tabular-nums">
                {semPc.length} linha(s) · {brl(semPc.filter((s) => s.no_fluxo).reduce((a, s) => a + Number(s.valor || 0), 0))}
              </span>
              {podeEditar && (
                <button type="button" onClick={() => void novaSaida()} disabled={ocupado}
                  className="ml-auto text-[10.5px] text-ww-accent hover:underline disabled:opacity-40">
                  + acrescentar despesa
                </button>
              )}
            </div>
            <p className="text-[10.5px] text-ww-textMuted mb-1.5">
              Mão de obra e despesas de viagem <strong>nunca viram pedido de compra</strong> — se não
              estiverem aqui, não aparecem em lugar nenhum do fluxo.
            </p>
            {semPc.length === 0 ? (
              <p className="text-[11.5px] text-ww-textFaint py-1">Nenhuma.</p>
            ) : (
              <div className="overflow-x-auto border border-ww-border rounded-lg">
                <table className="w-full text-[11.5px] border-collapse">
                  <thead className="bg-ww-bg">
                    <tr className="text-[10px] uppercase tracking-wider text-ww-textMuted">
                      <th className="text-left p-1.5 font-semibold min-w-[220px]">Descrição</th>
                      <th className="text-left p-1.5 font-semibold w-[130px]">Data prevista</th>
                      <th className="text-right p-1.5 font-semibold w-[120px]">Valor</th>
                      <th className="text-left p-1.5 font-semibold w-[84px]">No fluxo?</th>
                      <th className="w-[34px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {semPc.map((s) => (
                      <tr key={s.id} className={`viz-row ${s.no_fluxo ? "" : "opacity-50"}`}>
                        <td className="p-1 border-b border-ww-border/50">
                          {podeEditar ? (
                            <input defaultValue={s.descricao ?? ""}
                              onBlur={(e) => {
                                if (e.target.value !== (s.descricao ?? "")) {
                                  void gravarLinha({ tipo: "saida", id: s.id, descricao: e.target.value });
                                }
                              }}
                              className="w-full bg-transparent px-1 py-1 text-[11.5px] text-ww-text rounded
                                         border border-transparent hover:border-ww-border
                                         focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                          ) : <span className="px-1.5 text-ww-text">{s.descricao}</span>}
                        </td>
                        <td className="p-1 border-b border-ww-border/50">
                          {podeEditar ? (
                            <input type="date" defaultValue={s.dt_prevista ?? ""}
                              onBlur={(e) => {
                                if ((e.target.value || null) !== (s.dt_prevista ?? null)) {
                                  void gravarLinha({ tipo: "saida", id: s.id, dt_prevista: e.target.value });
                                }
                              }}
                              className="w-[122px] bg-transparent px-1 py-1 text-[11px] text-ww-text rounded
                                         border border-transparent hover:border-ww-border
                                         focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                          ) : <span className="px-1.5 text-ww-text tabular-nums">{dia(s.dt_prevista)}</span>}
                          {s.dias_apos_base != null && (
                            <span className="block px-1.5 text-[9.5px] text-ww-textFaint">
                              +{s.dias_apos_base}d do início
                            </span>
                          )}
                        </td>
                        <td className="p-1 border-b border-ww-border/50 text-right">
                          {podeEditar ? (
                            <input type="number" step="0.01" defaultValue={Number(s.valor || 0)}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (Number.isFinite(v) && v !== Number(s.valor || 0)) {
                                  void gravarLinha({ tipo: "saida", id: s.id, valor: v });
                                }
                              }}
                              className="w-full text-right bg-transparent px-1 py-1 text-[11.5px] tabular-nums text-ww-text rounded
                                         border border-transparent hover:border-ww-border
                                         focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                          ) : <span className="px-1.5 tabular-nums text-ww-text">{brl(s.valor)}</span>}
                        </td>
                        <td className="p-1.5 border-b border-ww-border/50">
                          <input type="checkbox" checked={s.no_fluxo} disabled={!podeEditar || ocupado}
                            title="Desmarcar tira do fluxo sem apagar a linha"
                            onChange={(e) => void gravarLinha({ tipo: "saida", id: s.id, no_fluxo: e.target.checked })}
                            className="accent-ww-accent" />
                        </td>
                        <td className="p-1.5 border-b border-ww-border/50 text-right">
                          {podeEditar && (
                            <button type="button" disabled={ocupado}
                              onClick={() => void apagarSaida(s.id, s.descricao ?? "esta linha")}
                              title="Remover do plano"
                              className="text-[11px] text-ww-textFaint hover:text-rose-500 transition disabled:opacity-40">
                              ✕
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Agenda de materiais ──────────────────────────────────────── */}
          {materiais.length > 0 && (
            <details className="rounded-lg border border-ww-border">
              <summary className="cursor-pointer px-2.5 py-1.5 text-[11.5px] text-ww-textMuted hover:text-ww-text">
                Agenda de compras do plano — {materiais.length} vencimento(s) ·{" "}
                <span className="tabular-nums">
                  {brl(materiais.filter((s) => s.no_fluxo).reduce((a, s) => a + Number(s.valor || 0), 0))}
                </span>
              </summary>
              <div className="px-2.5 pb-2.5">
                <p className="text-[10.5px] text-ww-textMuted my-1.5">
                  O que a proposta projetou comprar, por fornecedor e vencimento. Conforme os pedidos
                  de compra forem sendo lançados no Omie, o cenário <strong>previsto</strong> passa a
                  usar os pedidos reais — esta agenda continua sendo o baseline.
                </p>
                <table className="w-full text-[11px] border-collapse">
                  <tbody>
                    {materiais.map((s) => (
                      <tr key={s.id} className="viz-row">
                        <td className="p-1 border-b border-ww-border/40 tabular-nums text-ww-textMuted w-[74px]">
                          {dia(s.dt_prevista)}
                        </td>
                        <td className="p-1 border-b border-ww-border/40 text-ww-text truncate" title={s.descricao ?? ""}>
                          {s.fornecedor}
                        </td>
                        <td className="p-1 border-b border-ww-border/40 text-ww-textFaint w-[110px]">{s.etapa}</td>
                        <td className="p-1 border-b border-ww-border/40 text-right tabular-nums text-ww-text w-[100px]">
                          {brl(s.valor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {/* O confronto que a planilha faz na aba Fluxo, aqui em uma linha. */}
          <p className="text-[11px] text-ww-textMuted">
            Plano: <strong className="text-emerald-600 dark:text-emerald-400">{brl(totEnt)}</strong> entram,{" "}
            <strong className="text-rose-600 dark:text-rose-400">{brl(totSai)}</strong> saem,{" "}
            resultado <strong className={totEnt - totSai >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
              {brl(totEnt - totSai)}
            </strong>.
          </p>
        </>
      )}
    </section>
  );
}
