"use client";

// O topo do projeto: três números, uma régua e uma linha.
//
// ── O que havia ───────────────────────────────────────────────────────────
// Três faixas empilhadas com a MESMA aparência — mesma borda, mesmo fundo,
// mesmo peso — e treze valores. Sem hierarquia, a tela não dizia por onde
// começar, e o olho tratava o total do projeto e o subtotal de despesa como
// se fossem a mesma coisa.
//
// ── O erro que era pior que o layout ──────────────────────────────────────
// Dizia "R$ 48.617,27 já comprado" sobre um pedido em etapa de REQUISIÇÃO,
// sem aprovação e sem um único título a pagar. Não havia compra: havia um
// pedido esperando alguém aprovar.
//
// Dinheiro que sai de um projeto passa por cinco estados, e eles não são
// intercambiáveis:
//
//   PLANEJADO    a planilha reservou. Não existe documento.
//   REQUISITADO  existe pedido, ninguém aprovou. Pode ser recusado.
//   APROVADO     autorizado — é AQUI que o caixa fica comprometido.
//   A PAGAR      virou título com vencimento. Dívida com data.
//   PAGO         saiu do caixa.
//
// A régua mostra os cinco de uma vez, na ordem em que o dinheiro anda. É mais
// honesta que uma barra de progresso porque não some com os estágios vazios:
// ver quatro zeros em fila é a informação.

import type { PlanoCompleto } from "./PlanoFechamento";

export type Execucao = {
  requisitado: number; aprovado: number; recusado: number;
  a_pagar: number; pago: number;
  a_receber: number; recebido: number;
  qtd_requisitado: number; qtd_aprovado: number;
};

const brl = (v: number | null | undefined) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Curto, para a régua: R$ 48,6 mil. Cinco valores por extenso não cabem lado
 *  a lado sem quebrar, e quebrar destrói a leitura de sequência. */
const curto = (v: number) => {
  const n = Number(v || 0);
  if (n === 0) return "—";
  if (Math.abs(n) >= 1000) return `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return brl(n);
};
const dia = (s: string | null | undefined) => {
  if (!s) return "—";
  const [a, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${a.slice(2)}`;
};
const pctTxt = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

export default function ResumoProjeto({
  plano, execucao, entradasOmie, saidasOmie, teto, onEditarTeto, podeEditar,
}: {
  plano: PlanoCompleto | null;
  execucao: Execucao | null;
  entradasOmie: number;
  saidasOmie: number;
  teto: number | null;
  onEditarTeto?: () => void;
  podeEditar: boolean;
}) {
  const cab = plano?.plano ?? null;
  const parcelas = plano?.parcelas ?? [];
  const ex = execucao;

  const fechado = cab?.valor_fechado != null ? Number(cab.valor_fechado)
                : cab?.valor_venda   != null ? Number(cab.valor_venda) : null;
  const somaParcelas = parcelas.reduce((a, p) => a + Number(p.valor || 0), 0);
  const valor = fechado ?? (somaParcelas || entradasOmie);

  const pMat = Number(cab?.custo_materiais ?? 0);
  const pMao = Number(cab?.custo_mao_obra ?? 0);
  const pDes = Number(cab?.custo_despesas ?? 0);
  const planejado = teto ?? (pMat + pMao + pDes);
  const temPlano = planejado > 0;

  const resultado = valor - planejado;
  const margem = valor > 0 ? (resultado / valor) * 100 : null;

  /** Os cinco estágios, na ordem em que o dinheiro anda.
   *
   *  `pendente` é o que ainda não tem documento nenhum — nem requisição. É o
   *  que sobra do planejado, e inclui mão de obra e despesa, que nunca vão
   *  ter pedido de compra por natureza. */
  const req = ex?.requisitado ?? 0;
  const apr = ex?.aprovado ?? 0;
  const pag = ex?.pago ?? 0;
  const aPagar = ex?.a_pagar ?? 0;
  const semDocumento = Math.max(0, planejado - req - apr);

  const estagios = [
    { k: "planejado",   rot: "Planejado",   v: planejado, sub: "reservado no fechamento",
      tom: "bg-ww-border",     texto: "text-ww-text" },
    { k: "requisitado", rot: "Requisitado", v: req,       sub: ex?.qtd_requisitado ? `${ex.qtd_requisitado} pedido(s) sem aprovação` : "nenhum pedido",
      tom: "bg-amber-500",     texto: "text-amber-600 dark:text-amber-300" },
    { k: "aprovado",    rot: "Aprovado",    v: apr,       sub: ex?.qtd_aprovado ? `${ex.qtd_aprovado} pedido(s)` : "caixa ainda não comprometido",
      tom: "bg-sky-500",       texto: "text-sky-600 dark:text-sky-300" },
    { k: "a_pagar",     rot: "A pagar",     v: aPagar,    sub: "título com vencimento",
      tom: "bg-violet-500",    texto: "text-violet-600 dark:text-violet-300" },
    { k: "pago",        rot: "Pago",        v: pag,       sub: "saiu do caixa",
      tom: "bg-rose-500",      texto: "text-rose-600 dark:text-rose-300" },
  ];

  const recebido = ex?.recebido ?? 0;
  const aReceber = ex?.a_receber ?? 0;
  const aFaturar = Math.max(0, valor - entradasOmie);
  const caixa = recebido - pag;

  return (
    <section className="rounded-xl border border-ww-border bg-ww-panel overflow-hidden">
      {/* ── Os três números que definem o projeto ───────────────────────────
          Hierarquia por TAMANHO, não por cor de caixa: um deles é o que se
          olha primeiro e os outros dois existem para ele significar algo. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-ww-border/70">
        <Numero rot="Valor fechado" valor={brl(valor)} tom="text-emerald-600 dark:text-emerald-300"
          nota={parcelas.length > 0
            ? `${parcelas.length} × ${brl(somaParcelas / parcelas.length)}`
            : "sem plano importado"}
          extra={cab?.valor_venda != null && fechado != null
            && Math.abs(fechado - Number(cab.valor_venda)) > 0.05
            ? `proposta calculava ${brl(cab.valor_venda)}` : undefined} />

        <Numero rot="Custo planejado" valor={temPlano ? brl(planejado) : "—"}
          tom="text-ww-text"
          nota={temPlano
            ? `materiais ${brl(pMat)} · obra ${brl(pMao)} · despesas ${brl(pDes)}`
            : "importe o plano do fechamento"}
          acao={podeEditar && onEditarTeto
            ? { rot: teto != null && Math.abs(teto - (pMat + pMao + pDes)) > 0.05 ? "teto ajustado" : "ajustar", fn: onEditarTeto }
            : undefined} />

        <Numero rot="Resultado planejado"
          valor={temPlano ? brl(resultado) : "—"}
          tom={resultado >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}
          nota={temPlano && margem != null ? `${pctTxt(margem)} do valor fechado` : ""}
          // A margem da MC é OUTRA conta: desconta imposto e foi feita sobre o
          // valor da proposta. Nomeada, não misturada.
          extra={cab?.margem_pct != null ? `MC ${pctTxt(Number(cab.margem_pct))} com impostos` : undefined} />
      </div>

      {/* ── A régua: onde o dinheiro parou ──────────────────────────────────
          Fundo próprio para se ler como outro assunto, sem precisar de borda
          grossa. Os estágios vazios NÃO somem: quatro zeros em fila são a
          informação principal deste projeto. */}
      {temPlano && (
        <div className="bg-ww-bg/50 border-t border-ww-border/70 px-3.5 py-3">
          <div className="flex items-baseline gap-2 mb-2.5">
            <span className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
              Execução da despesa
            </span>
            <span className="text-[10.5px] text-ww-textMuted">
              o mesmo dinheiro, em cada estágio — da reserva ao pagamento
            </span>
          </div>

          <ol className="grid grid-cols-2 sm:grid-cols-5 gap-x-2 gap-y-3">
            {estagios.map((e, i) => {
              const frac = planejado > 0 ? Math.min(1, e.v / planejado) : 0;
              const vazio = e.v <= 0.005;
              return (
                <li key={e.k} className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[9.5px] uppercase tracking-[0.6px] font-semibold text-ww-textFaint truncate">
                      {e.rot}
                    </span>
                    {i < estagios.length - 1 && (
                      <span aria-hidden className="text-ww-textFaint/50 text-[9px] ml-auto hidden sm:inline">→</span>
                    )}
                  </div>
                  <div className={`text-[15px] font-semibold tabular-nums mt-0.5 leading-none ${
                    vazio ? "text-ww-textFaint" : e.texto}`}>
                    {curto(e.v)}
                  </div>
                  <div className="mt-1.5 h-1 rounded-full bg-ww-border/50 overflow-hidden">
                    <div className={`h-full rounded-full ${e.tom}`}
                      style={{ width: `${frac * 100}%` }} />
                  </div>
                  <div className="mt-1 text-[9.5px] text-ww-textMuted leading-tight">{e.sub}</div>
                </li>
              );
            })}
          </ol>

          {/* A frase que a régua não consegue dizer sozinha. */}
          <p className="mt-2.5 text-[11px] text-ww-textMuted leading-relaxed">
            {apr <= 0.005 && req > 0.005 ? (
              <>
                <strong className="text-amber-600 dark:text-amber-300">Nada foi comprado ainda.</strong>{" "}
                O pedido de {brl(req)} está aguardando aprovação — pode ser recusado e o valor pode
                mudar. O caixa só fica comprometido quando alguém aprova.
              </>
            ) : apr > 0.005 ? (
              <><strong className="text-ww-text">{brl(apr)}</strong> aprovados comprometem o caixa;{" "}
                {aPagar > 0.005 ? <>{brl(aPagar)} já viraram título a pagar.</> : <>ainda sem título emitido.</>}</>
            ) : (
              <>Nenhum pedido de compra lançado neste projeto.</>
            )}
            {/* Quando o que falta documentar É a mão de obra + despesas, dizer
                o valor duas vezes é ruído — a frase fica mais curta e mais
                exata nomeando a causa em vez de repetir o número. */}
            {semDocumento > 0.005 && (
              Math.abs(semDocumento - (pMao + pDes)) < 0.05 ? (
                <> Os outros <strong className="text-ww-text">{brl(semDocumento)}</strong> são
                  mão de obra e despesas, que por natureza nunca viram pedido de compra.</>
              ) : (
                <> Outros <strong className="text-ww-text">{brl(semDocumento)}</strong> do planejado
                  não têm documento nenhum
                  {pMao + pDes > 0.005 && <>, dos quais {brl(pMao + pDes)} são mão de obra e
                    despesas, que nunca viram pedido de compra</>}.
                </>
              )
            )}
          </p>
        </div>
      )}

      {/* ── Recebimento: uma linha, não uma faixa ───────────────────────── */}
      <div className="border-t border-ww-border/70 px-3.5 py-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px]">
        <span className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">
          Recebimento
        </span>
        <Par rot="recebido" v={brl(recebido)} forte={recebido > 0} tom="text-emerald-600 dark:text-emerald-300" />
        <Par rot="a receber" v={brl(aReceber)} />
        {aFaturar > 0.5 && <Par rot="ainda a faturar" v={brl(aFaturar)} />}
        <span className="ml-auto tabular-nums text-ww-textMuted">
          caixa do projeto hoje{" "}
          <strong className={caixa >= 0
            ? "text-emerald-600 dark:text-emerald-300"
            : "text-rose-600 dark:text-rose-300"}>{brl(caixa)}</strong>
          {caixa < 0 && <span className="text-ww-textFaint"> · você está financiando</span>}
        </span>
        {(cab?.data_base || cab?.entrega_prevista) && (
          <span className="w-full sm:w-auto text-[10.5px] text-ww-textFaint tabular-nums">
            {dia(cab?.data_base)} → {dia(cab?.entrega_prevista)}
            {cab?.prazo_entrega_dias ? ` · ${cab.prazo_entrega_dias}d` : ""}
          </span>
        )}
      </div>
    </section>
  );
}

/** Um dos três números do topo. */
function Numero({ rot, valor, tom, nota, extra, acao }: {
  rot: string; valor: string; tom: string; nota?: string; extra?: string;
  acao?: { rot: string; fn: () => void };
}) {
  return (
    <div className="px-3.5 py-3 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">{rot}</span>
        {acao && (
          <button type="button" onClick={acao.fn}
            className="ml-auto text-[10px] text-ww-textFaint hover:text-ww-accent transition">
            {acao.rot}
          </button>
        )}
      </div>
      <div className={`text-[22px] font-semibold tabular-nums tracking-[-0.5px] leading-tight mt-0.5 ${tom}`}>
        {valor}
      </div>
      {nota && <div className="text-[10.5px] text-ww-textMuted truncate" title={nota}>{nota}</div>}
      {extra && <div className="text-[10px] text-ww-textFaint truncate" title={extra}>{extra}</div>}
    </div>
  );
}

function Par({ rot, v, forte, tom }: { rot: string; v: string; forte?: boolean; tom?: string }) {
  return (
    <span className="tabular-nums text-ww-textMuted">
      <strong className={forte ? (tom ?? "text-ww-text") : "text-ww-text"}>{v}</strong> {rot}
    </span>
  );
}
