"use client";

// O topo do projeto: as premissas, os valores e o consumo — num bloco só.
//
// ── O que havia antes ──────────────────────────────────────────────────────
// Treze números em três faixas de cartões: seis do fluxo, seis do plano, mais
// o teto. Nenhum deles errado, e juntos ilegíveis — quem abria a tela não
// sabia por onde começar, e a mesma grandeza aparecia com dois nomes em dois
// lugares ("saídas previstas" e "custo total").
//
// ── A distinção que a tela não fazia ───────────────────────────────────────
// PLANEJADO não é CONSUMIDO. A planilha dizer que vamos gastar R$ 48.617 em
// materiais não significa que gastamos — significa que reservamos. Só vira
// consumo quando existe pedido de compra no Omie, e só vira dinheiro quando o
// título é pago. Eram três estados apresentados como um.
//
// Agora são três perguntas, nesta ordem, que é a ordem em que se pergunta:
//   1. O que foi fechado?          valor, parcelas, prazo
//   2. Quanto planejamos gastar?   e em quê
//   3. Quanto já consumimos?       em compra, e quanto virou pagamento

import type { PlanoCompleto } from "./PlanoFechamento";

const brl = (v: number | null | undefined) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (s: string | null | undefined) => {
  if (!s) return "—";
  const [a, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${a.slice(2)}`;
};
const pctTxt = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

export default function ResumoProjeto({
  plano, entradasOmie, saidasOmie, recebido, pago, teto, onEditarTeto, podeEditar,
}: {
  plano: PlanoCompleto | null;
  /** Entradas que o Omie conhece (PV a faturar + títulos). */
  entradasOmie: number;
  /** Saídas que o Omie conhece — pedidos de compra lançados. É o CONSUMO. */
  saidasOmie: number;
  recebido: number;
  pago: number;
  /** Teto vigente: o manual, se houver; senão o do plano. */
  teto: number | null;
  onEditarTeto?: () => void;
  podeEditar: boolean;
}) {
  const cab = plano?.plano ?? null;
  const parcelas = plano?.parcelas ?? [];

  // ── 1. O que foi fechado ─────────────────────────────────────────────────
  const fechado = cab?.valor_fechado != null ? Number(cab.valor_fechado)
                : cab?.valor_venda != null ? Number(cab.valor_venda)
                : null;
  const somaParcelas = parcelas.reduce((a, p) => a + Number(p.valor || 0), 0);
  // Sem plano, o que o Omie conhece é o melhor que se tem.
  const valorProjeto = fechado ?? (somaParcelas || entradasOmie);

  // ── 2. Quanto planejamos gastar ──────────────────────────────────────────
  const pMat = cab?.custo_materiais != null ? Number(cab.custo_materiais) : 0;
  const pMao = cab?.custo_mao_obra  != null ? Number(cab.custo_mao_obra)  : 0;
  const pDes = cab?.custo_despesas  != null ? Number(cab.custo_despesas)  : 0;
  const planejado = pMat + pMao + pDes;
  const temPlano = planejado > 0;

  /** Resultado planejado = fechado − custo. NÃO é a margem da MC: aquela
   *  desconta imposto e foi calculada sobre o valor da proposta, não sobre o
   *  fechado. Dar o mesmo nome aos dois faria alguém comparar percentuais que
   *  não medem a mesma coisa. */
  const resultado = valorProjeto - planejado;
  const margemSimples = valorProjeto > 0 ? (resultado / valorProjeto) * 100 : null;

  // ── 3. Quanto já consumimos ──────────────────────────────────────────────
  //
  // O consumo mede COMPRA REAL contra o planejado. Mão de obra e despesa nunca
  // viram pedido de compra, então seu "consumido" é zero por construção até
  // alguém pagar — e é por isso que a linha diz o que falta ter compra.
  const base = teto ?? (planejado || null);
  const consumo = base && base > 0 ? (saidasOmie / base) * 100 : null;
  const semCompra = Math.max(0, pMao + pDes);
  const sobra = base != null ? base - saidasOmie : null;
  const estourou = consumo != null && consumo > 100;

  const naturezas = temPlano ? [
    { rot: "Materiais",   prev: pMat, real: saidasOmie, viraPc: true,  tom: "bg-emerald-500" },
    { rot: "Mão de obra", prev: pMao, real: 0,          viraPc: false, tom: "bg-sky-500" },
    { rot: "Despesas",    prev: pDes, real: 0,          viraPc: false, tom: "bg-violet-500" },
  ].filter((x) => x.prev > 0) : [];

  const aFaturar = Math.max(0, valorProjeto - entradasOmie);

  return (
    <section className="rounded-xl border border-ww-border bg-ww-panel p-3.5 space-y-3.5">
      {/* ── 1. O QUE FOI FECHADO ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
            Valor fechado
          </div>
          <div className="text-[24px] font-bold tabular-nums tracking-[-0.6px] text-emerald-600 dark:text-emerald-300 leading-tight">
            {brl(valorProjeto)}
          </div>
          <div className="text-[10.5px] text-ww-textMuted">
            {parcelas.length > 0
              ? `${parcelas.length} parcela(s) de ${brl(somaParcelas / parcelas.length)}`
              : "sem plano importado"}
            {cab?.valor_venda != null && fechado != null
              && Math.abs(fechado - Number(cab.valor_venda)) > 0.05 && (
              <span className="text-ww-textFaint"> · proposta calculava {brl(cab.valor_venda)}</span>
            )}
          </div>
        </div>

        {temPlano && (
          <>
            <Sep />
            <div>
              <div className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
                Planejamos gastar
              </div>
              <div className="text-[24px] font-bold tabular-nums tracking-[-0.6px] text-rose-600 dark:text-rose-300 leading-tight">
                {brl(planejado)}
              </div>
              <div className="text-[10.5px] text-ww-textMuted tabular-nums">
                materiais {brl(pMat)} · mão de obra {brl(pMao)} · despesas {brl(pDes)}
              </div>
            </div>

            <Sep />
            <div>
              <div className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
                Resultado planejado
              </div>
              <div className={`text-[24px] font-bold tabular-nums tracking-[-0.6px] leading-tight ${
                resultado >= 0 ? "text-emerald-600 dark:text-emerald-300"
                               : "text-rose-600 dark:text-rose-300"}`}>
                {brl(resultado)}
              </div>
              <div className="text-[10.5px] text-ww-textMuted">
                {margemSimples != null && `${pctTxt(margemSimples)} do valor fechado`}
                {/* A margem da MC é outra conta: desconta imposto e foi feita
                    sobre o valor da proposta. Fica ao lado, nomeada, em vez de
                    disputar o mesmo rótulo. */}
                {cab?.margem_pct != null && (
                  <span className="text-ww-textFaint">
                    {" "}· MC: {pctTxt(Number(cab.margem_pct))} com impostos
                  </span>
                )}
              </div>
            </div>
          </>
        )}

        {(cab?.entrega_prevista || cab?.data_base) && (
          <>
            <Sep />
            <div>
              <div className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
                Prazo
              </div>
              <div className="text-[13px] font-semibold tabular-nums text-ww-text mt-1">
                {dia(cab?.data_base)} → {dia(cab?.entrega_prevista)}
              </div>
              <div className="text-[10.5px] text-ww-textMuted">
                {cab?.prazo_entrega_dias ? `${cab.prazo_entrega_dias} dias de entrega` : "entrega"}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── 2. CONSUMO ───────────────────────────────────────────────────────
          A pergunta que a tela não respondia: quanto do planejado virou compra
          de verdade. Planejar não é gastar, e a barra mede pedido de compra
          lançado no Omie — não a intenção da planilha. */}
      {(temPlano || teto != null) && (
        <div className="rounded-lg border border-ww-border/70 bg-ww-bg/40 p-2.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
              Consumo do planejado
            </span>
            <span className="text-[12px] tabular-nums text-ww-text">
              <strong className={estourou ? "text-rose-600 dark:text-rose-300" : ""}>
                {brl(saidasOmie)}
              </strong>
              <span className="text-ww-textMuted"> comprados de {brl(base ?? 0)}</span>
            </span>
            {consumo != null && (
              <span className={`text-[11px] tabular-nums ${
                estourou ? "text-rose-600 dark:text-rose-300 font-semibold"
                         : consumo > 85 ? "text-amber-600 dark:text-amber-300" : "text-ww-textMuted"}`}>
                {consumo.toFixed(0)}%
                {estourou && ` — ${brl(saidasOmie - (base ?? 0))} acima`}
              </span>
            )}
            <span className="ml-auto text-[10.5px] text-ww-textMuted tabular-nums">
              {brl(pago)} já pago
              {sobra != null && <> · {brl(Math.max(0, sobra))} de folga</>}
            </span>
            {podeEditar && onEditarTeto && (
              <button type="button" onClick={onEditarTeto}
                title="Definir um teto diferente do que a proposta planejou"
                className="text-[10.5px] text-ww-accent hover:underline">
                ajustar teto
              </button>
            )}
          </div>

          <div className="mt-2 h-2 rounded-full bg-ww-border/60 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${
              estourou ? "bg-rose-500" : (consumo ?? 0) > 85 ? "bg-amber-500" : "bg-emerald-500"}`}
              style={{ width: `${Math.min(100, consumo ?? 0)}%` }} />
          </div>

          {naturezas.length > 0 && (
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {naturezas.map((n) => {
                const p = n.prev > 0 ? Math.min(100, (n.real / n.prev) * 100) : 0;
                return (
                  <div key={n.rot}>
                    <div className="flex items-baseline justify-between gap-1">
                      <span className="text-[9.5px] uppercase tracking-[0.6px] font-bold text-ww-textFaint">
                        {n.rot}
                      </span>
                      <span className="text-[11px] tabular-nums text-ww-text">{brl(n.prev)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-ww-border/60 overflow-hidden">
                      <div className={`h-full rounded-full ${n.tom}`} style={{ width: `${p}%` }} />
                    </div>
                    <div className="mt-0.5 text-[10px] text-ww-textMuted tabular-nums">
                      {n.viraPc
                        ? `${brl(n.real)} em pedido de compra`
                        : "reservado · não vira pedido de compra"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {semCompra > 0 && (
            <p className="mt-2 text-[10.5px] text-ww-textMuted">
              <strong className="text-ww-text">{brl(semCompra)}</strong> do planejado são mão de obra
              e despesas: estão <strong>reservados</strong>, não comprados. Não têm como aparecer
              como pedido de compra — só saem do caixa quando forem pagos.
            </p>
          )}
        </div>
      )}

      {/* ── 3. RECEBIMENTO ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[11.5px]">
        <span className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
          Recebimento
        </span>
        <span className="tabular-nums text-ww-textMuted">
          <strong className="text-emerald-600 dark:text-emerald-300">{brl(recebido)}</strong> recebido
        </span>
        <span className="tabular-nums text-ww-textMuted">
          <strong className="text-ww-text">{brl(entradasOmie)}</strong> já faturado (no Omie)
        </span>
        {aFaturar > 0.5 && (
          <span className="tabular-nums text-ww-textMuted">
            <strong className="text-ww-text">{brl(aFaturar)}</strong> ainda a faturar
          </span>
        )}
        {/* O número que responde "estou financiando este projeto?" */}
        <span className="ml-auto tabular-nums">
          <span className="text-ww-textMuted">caixa do projeto hoje: </span>
          <strong className={recebido - pago >= 0
            ? "text-emerald-600 dark:text-emerald-300"
            : "text-rose-600 dark:text-rose-300"}>
            {brl(recebido - pago)}
          </strong>
          {recebido - pago < 0 && (
            <span className="text-ww-textMuted"> — você está financiando</span>
          )}
        </span>
      </div>
    </section>
  );
}

function Sep() {
  return <span aria-hidden className="hidden sm:block w-px self-stretch bg-ww-border/70" />;
}
