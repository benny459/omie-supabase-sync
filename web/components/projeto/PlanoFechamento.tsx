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
  valor_fechado: number | null;
  confirmado_por: string | null; confirmado_em: string | null;
  eixo_pagamento: string | null;
  prop_pagamento: string | null; prop_faturamento: string | null;
  prop_prazo: string | null; prop_frete: string | null;
  prop_garantia: string | null; prop_instalacao: string | null;
  prop_observacoes: string | null;
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
  parcela: number; evento: string | null; pct: number | null; dias: number | null;
  dt_plano: string | null; dt_ajustada: string | null;
  valor: number; num_titulo: string | null; observacao: string | null;
};
export type PlanoSaida = {
  id: number; origem: "material" | "sem_pc"; descricao: string | null;
  fornecedor: string | null; etapa: string | null;
  dias_apos_base: number | null; dt_prevista: string | null;
  valor: number; no_fluxo: boolean;
};
export type PlanoCusto = {
  id: number; grupo: "efetivo" | "despesa"; descricao: string | null;
  qtd_pessoas: number | null; valor_unit: number | null;
  quantidade: number | null; subtotal: number; observacao: string | null;
};
export type PlanoCompleto = {
  plano: PlanoCab | null; parcelas: PlanoParcela[]; saidas: PlanoSaida[];
  custos: PlanoCusto[];
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
  const custos = dados?.custos ?? [];

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

  const novaSaida = useCallback(async (origem: "material" | "sem_pc" = "sem_pc") => {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/rc-projetos/plano/linha", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa, codigo_projeto: codigoProjeto, origem,
          descricao: origem === "material" ? "Nova compra" : "Nova despesa",
          etapa: origem === "material" ? "Fabricação" : null,
          dt_prevista: plano?.data_base ?? hojeIso(), valor: 0,
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
                {plano.confirmado_por && (
                  <span className="text-ww-textMuted">
                    {" "}Fechado por <strong className="text-ww-text">{plano.confirmado_por}</strong>
                    {plano.confirmado_em ? ` em ${plano.confirmado_em}` : ""}.
                  </span>
                )}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-[11.5px]">
            {([
              ["Parcelas", `${previa.parcelas.length} · ${brl(previa.parcelas.reduce((a, p) => a + p.valor, 0))}`],
              ["Saídas", `${previa.saidas.length} · ${brl(previa.saidas.reduce((a, s) => a + s.valor, 0))}`],
              // O FECHADO, não o calculado: era isto que ia para o banco, e a
              // prévia mostrava o outro número — quem conferisse veria um valor
              // e gravaria outro.
              [previa.valor_fechado != null ? "Valor fechado" : "Valor de venda",
               brl(previa.valor_fechado ?? previa.valor_venda)],
              ["Início do projeto", dia(previa.data_base)],
              // Só aparece quando difere do início: iguais, é ruído.
              ...(previa.eixo_pagamento && previa.eixo_pagamento !== previa.data_base
                ? [["Prazos contam de", dia(previa.eixo_pagamento)] as [string, string]] : []),
            ] as Array<[string, string]>).map(([r, v]) => (
              <div key={r}>
                <div className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">{r}</div>
                <div className="text-ww-text tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          {previa.confirmado_por && (
            <p className="text-[11px] text-ww-textMuted">
              Fechado por <strong className="text-ww-text">{previa.confirmado_por}</strong>
              {previa.confirmado_em ? ` em ${previa.confirmado_em}` : ""}.
            </p>
          )}
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
          {/* Pagamento, entrega, faturamento e "por conta de quem" subiram
              para o resumo do topo: são o que define se o projeto se paga
              sozinho, e ficavam abaixo da dobra. Aqui ficam só os campos
              crus, para corrigir. */}
          {podeEditar && (
            <details className="rounded-lg border border-ww-border">
              <summary className="cursor-pointer px-2.5 py-1.5 text-[11.5px] text-ww-textMuted hover:text-ww-text">
                Editar as condições comerciais
              </summary>
              <div className="px-2.5 pb-2.5 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2">
                {campo("Frete", "frete")}
                {campo("Deslocamento e estadia", "deslocamento")}
                {campo("Instalação", "instalacao")}
                {campo("Impostos", "impostos")}
                {campo("Garantia", "garantia")}
                {campo("Forma de pagamento (proposta)", "forma_pagamento")}
                {campo("Faturamento", "faturamento")}
                <div>
                  <div className="text-[9px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
                    Início oficial
                  </div>
                  <input type="date" defaultValue={plano.data_base ?? ""}
                    title="Eixo das saídas que contam em dias — mão de obra, despesas"
                    onBlur={(e) => {
                      if (e.target.value !== (plano.data_base ?? "")) void gravarCab("data_base", e.target.value);
                    }}
                    className="w-full mt-0.5 text-[11.5px] bg-transparent text-ww-text rounded px-1 py-0.5
                               border border-transparent hover:border-ww-border
                               focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                </div>
              </div>
              {plano.garantia && (
                <p className="px-2.5 pb-2 text-[10.5px] text-ww-textMuted">
                  Garantia: {plano.garantia}
                </p>
              )}
            </details>
          )}

          {/* Os seis cartões de valor que ficavam aqui subiram para o resumo
              do topo. Repetidos nos dois lugares, faziam a mesma grandeza
              aparecer com dois nomes — e era parte do motivo de a tela ter
              treze números antes de qualquer tabela. */}

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
                    <th className="text-right p-1.5 font-semibold w-[56px]">Dias</th>
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
                        <td className="p-1.5 border-b border-ww-border/50 text-right tabular-nums text-ww-textFaint"
                            title={plano.eixo_pagamento
                              ? `Contados de ${dia(plano.eixo_pagamento)}` : undefined}>
                          {p.dias != null ? `${p.dias}d` : "—"}
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
                <button type="button" onClick={() => void novaSaida("sem_pc")} disabled={ocupado}
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

          {/* ── Agenda de compras ────────────────────────────────────────
              Editável na própria linha, como planilha. A agenda nasce do
              arquivo, mas corrigir um vencimento ou um valor não justifica
              reexportar a proposta e reimportar — e quem não pode corrigir
              acaba não corrigindo. */}
          {(materiais.length > 0 || podeEditar) && (
            <details className="rounded-lg border border-ww-border" open={materiais.length > 0 && materiais.length <= 6}>
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
                {materiais.length === 0 ? (
                  <p className="text-[11.5px] text-ww-textFaint py-1">Nenhuma compra no plano.</p>
                ) : (
                  <div className="overflow-x-auto border border-ww-border rounded-lg">
                    <table className="w-full text-[11.5px] border-collapse">
                      <thead className="bg-ww-bg">
                        <tr className="text-[10px] uppercase tracking-wider text-ww-textMuted">
                          <th className="text-left p-1.5 font-semibold w-[122px]">Vencimento</th>
                          <th className="text-left p-1.5 font-semibold min-w-[230px]">Fornecedor</th>
                          <th className="text-left p-1.5 font-semibold w-[124px]">Etapa</th>
                          <th className="text-right p-1.5 font-semibold w-[118px]">Valor</th>
                          <th className="text-left p-1.5 font-semibold w-[72px]">No fluxo?</th>
                          <th className="w-[32px]" />
                        </tr>
                      </thead>
                      <tbody>
                        {materiais.map((s) => (
                          <tr key={s.id} className={`viz-row ${s.no_fluxo ? "" : "opacity-50"}`}>
                            <td className="p-1 border-b border-ww-border/40">
                              {podeEditar ? (
                                <input type="date" defaultValue={s.dt_prevista ?? ""}
                                  onBlur={(e) => {
                                    if ((e.target.value || null) !== (s.dt_prevista ?? null)) {
                                      void gravarLinha({ tipo: "saida", id: s.id, dt_prevista: e.target.value });
                                    }
                                  }}
                                  className="w-[114px] bg-transparent px-1 py-1 text-[11px] tabular-nums text-ww-text rounded
                                             border border-transparent hover:border-ww-border
                                             focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                              ) : <span className="px-1.5 tabular-nums text-ww-textMuted">{dia(s.dt_prevista)}</span>}
                            </td>
                            <td className="p-1 border-b border-ww-border/40">
                              {podeEditar ? (
                                <input defaultValue={s.fornecedor ?? ""} placeholder="—"
                                  onBlur={(e) => {
                                    if (e.target.value !== (s.fornecedor ?? "")) {
                                      // Descrição acompanha o fornecedor: é ela
                                      // que aparece no fluxo, e deixá-la para
                                      // trás faria a linha mudar de nome só na
                                      // metade dos lugares.
                                      void gravarLinha({ tipo: "saida", id: s.id,
                                        fornecedor: e.target.value,
                                        descricao: `${e.target.value}${s.etapa ? ` · ${s.etapa}` : ""}` });
                                    }
                                  }}
                                  className="w-full bg-transparent px-1 py-1 text-[11.5px] text-ww-text rounded
                                             border border-transparent hover:border-ww-border
                                             focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                              ) : <span className="px-1.5 text-ww-text">{s.fornecedor}</span>}
                            </td>
                            <td className="p-1 border-b border-ww-border/40">
                              {podeEditar ? (
                                <input defaultValue={s.etapa ?? ""} placeholder="—"
                                  onBlur={(e) => {
                                    if (e.target.value !== (s.etapa ?? "")) {
                                      void gravarLinha({ tipo: "saida", id: s.id, etapa: e.target.value });
                                    }
                                  }}
                                  className="w-full bg-transparent px-1 py-1 text-[11px] text-ww-textMuted rounded
                                             border border-transparent hover:border-ww-border
                                             focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                              ) : <span className="px-1.5 text-ww-textFaint">{s.etapa}</span>}
                            </td>
                            <td className="p-1 border-b border-ww-border/40 text-right">
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
                            <td className="p-1.5 border-b border-ww-border/40">
                              <input type="checkbox" checked={s.no_fluxo} disabled={!podeEditar || ocupado}
                                title="Desmarcar tira do fluxo sem apagar a linha"
                                onChange={(e) => void gravarLinha({ tipo: "saida", id: s.id, no_fluxo: e.target.checked })}
                                className="accent-ww-accent" />
                            </td>
                            <td className="p-1.5 border-b border-ww-border/40 text-right">
                              {podeEditar && (
                                <button type="button" disabled={ocupado}
                                  onClick={() => void apagarSaida(s.id, s.fornecedor ?? "esta linha")}
                                  title="Remover do plano"
                                  className="text-[11px] text-ww-textFaint hover:text-rose-500 transition disabled:opacity-40">
                                  ✕
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-ww-bg">
                        <tr className="border-t border-ww-borderStrong">
                          <td className="p-1.5 font-semibold text-ww-textMuted text-[10.5px]" colSpan={3}>
                            {materiais.filter((s) => s.no_fluxo).length} no fluxo
                          </td>
                          <td className="p-1.5 text-right font-bold tabular-nums text-ww-text">
                            {brl(materiais.filter((s) => s.no_fluxo).reduce((a, s) => a + Number(s.valor || 0), 0))}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
                {podeEditar && (
                  <button type="button" onClick={() => void novaSaida("material")} disabled={ocupado}
                    className="mt-1.5 text-[10.5px] text-ww-accent hover:underline disabled:opacity-40">
                    + acrescentar compra
                  </button>
                )}
              </div>
            </details>
          )}

          {/* ── Como se chegou no custo que não vira pedido de compra ────
              O total já está no card acima. O que falta é a composição: "a mão
              de obra estourou" só vira decisão quando se sabe que eram 1
              engenheiro por 2 dias e 1 técnico por 8,5 dias EQUIVALENTES — e
              que os equivalentes já embutem sábado (1,5×) e domingo (2×). */}
          {custos.length > 0 && (
            <details className="rounded-lg border border-ww-border">
              <summary className="cursor-pointer px-2.5 py-1.5 text-[11.5px] text-ww-textMuted hover:text-ww-text">
                Efetivo e despesas consideradas —{" "}
                <span className="tabular-nums">
                  {brl(custos.reduce((a, x) => a + Number(x.subtotal || 0), 0))}
                </span>
              </summary>
              <div className="px-2.5 pb-2.5 space-y-2.5">
                {([["efetivo", "Efetivo técnico", "Dias equiv."],
                   ["despesa", "Despesas operacionais", "Diárias / qtd"]] as const).map(([g, rot, colQtd]) => {
                  const linhas = custos.filter((x) => x.grupo === g);
                  if (!linhas.length) return null;
                  return (
                    <div key={g}>
                      <div className="flex items-baseline gap-2 mt-1.5 mb-1">
                        <span className="text-[10px] uppercase tracking-wider font-semibold text-ww-textMuted">
                          {rot}
                        </span>
                        <span className="text-[10.5px] text-ww-textFaint tabular-nums">
                          {brl(linhas.reduce((a, x) => a + Number(x.subtotal || 0), 0))}
                        </span>
                      </div>
                      <table className="w-full text-[11px] border-collapse">
                        <thead>
                          <tr className="text-[9.5px] uppercase tracking-wider text-ww-textFaint">
                            <th className="text-left  p-1 font-semibold">Item</th>
                            <th className="text-right p-1 font-semibold w-[54px]">Pessoas</th>
                            <th className="text-right p-1 font-semibold w-[90px]">
                              {g === "efetivo" ? "Custo/dia" : "Valor unit."}
                            </th>
                            <th className="text-right p-1 font-semibold w-[84px]">{colQtd}</th>
                            <th className="text-right p-1 font-semibold w-[96px]">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody>
                          {linhas.map((x) => (
                            <tr key={x.id} className="viz-row">
                              <td className="p-1 border-b border-ww-border/40 text-ww-text">
                                {x.descricao}
                                {x.observacao && (
                                  <span className="block text-[9.5px] text-ww-textFaint">{x.observacao}</span>
                                )}
                              </td>
                              <td className="p-1 border-b border-ww-border/40 text-right tabular-nums text-ww-textMuted">
                                {x.qtd_pessoas ?? "—"}
                              </td>
                              <td className="p-1 border-b border-ww-border/40 text-right tabular-nums text-ww-textMuted">
                                {x.valor_unit != null ? brl(x.valor_unit) : "—"}
                              </td>
                              <td className="p-1 border-b border-ww-border/40 text-right tabular-nums text-ww-textMuted">
                                {x.quantidade ?? "—"}
                              </td>
                              <td className="p-1 border-b border-ww-border/40 text-right tabular-nums text-ww-text">
                                {brl(x.subtotal)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
                <p className="text-[10.5px] text-ww-textMuted">
                  Dias equivalentes já embutem o multiplicador por turno: sábado 1,5× e domingo 2×.
                  Nada disto vira pedido de compra — é a única composição que existe destes custos.
                </p>
              </div>
            </details>
          )}

          {/* ── O que o cliente aceitou ──────────────────────────────────
              Separado do "confirmado" de propósito, porque a planilha separa:
              "É este o texto que foi ao PDF e que o cliente aceitou". Quando
              o confirmado difere do proposto, a diferença é o que foi decidido
              DEPOIS — e é ela que vira discussão se houver desacordo. */}
          {(plano.prop_pagamento || plano.prop_faturamento || plano.prop_prazo
            || plano.prop_frete || plano.prop_garantia || plano.prop_instalacao
            || plano.prop_observacoes) && (
            <details className="rounded-lg border border-ww-border">
              <summary className="cursor-pointer px-2.5 py-1.5 text-[11.5px] text-ww-textMuted hover:text-ww-text">
                Texto da proposta — o que foi ao PDF e o cliente aceitou
              </summary>
              <div className="px-2.5 pb-2.5">
                <table className="w-full text-[11px] border-collapse mt-1">
                  <tbody>
                    {([["Pagamento", plano.prop_pagamento, plano.forma_pagamento],
                       ["Faturamento", plano.prop_faturamento, plano.faturamento],
                       ["Prazo de entrega", plano.prop_prazo,
                        plano.prazo_entrega_dias ? `${plano.prazo_entrega_dias} dias` : null],
                       ["Frete", plano.prop_frete, plano.frete],
                       ["Garantia", plano.prop_garantia, plano.garantia],
                       ["Instalação", plano.prop_instalacao, plano.instalacao],
                       ["Observações", plano.prop_observacoes, null]] as const)
                      .filter(([, v]) => v)
                      .map(([rot, naProposta, confirmado]) => {
                        const mudou = !!confirmado && !!naProposta
                          && confirmado.trim().toLowerCase() !== naProposta.trim().toLowerCase();
                        return (
                          <tr key={rot} className="viz-row">
                            <td className="p-1 border-b border-ww-border/40 text-ww-textFaint w-[128px] align-top">
                              {rot}
                            </td>
                            <td className="p-1 border-b border-ww-border/40 text-ww-text align-top">
                              {naProposta}
                            </td>
                            <td className="p-1 border-b border-ww-border/40 align-top w-[46%]">
                              {mudou && (
                                <span className="text-ww-accent">
                                  → no fechamento: <strong>{confirmado}</strong>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
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
