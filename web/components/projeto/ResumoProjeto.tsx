"use client";

// As peças do resumo do projeto — cada aba monta a sua.
//
// ── Por que peças e não um bloco ───────────────────────────────────────────
// A tela virou seis abas. Os três KPIs ficam FIXOS acima delas, porque são a
// pergunta que não muda ("quanto fechei, quanto vou gastar, quanto sobra");
// a régua de execução vive no Resumo; o faturamento tem aba própria. Um
// componente monolítico obrigaria a desenhar tudo em todo lugar — que é o que
// deixava a tela com treze números antes da primeira tabela.
//
// ── A distinção que estas peças existem para fazer ─────────────────────────
// PLANEJADO não é CONSUMIDO, e FATURADO não é RECEBIDO. Dinheiro que sai
// passa por cinco estados (planejado → requisitado → aprovado → a pagar →
// pago) e dinheiro que entra por três (sem nota → em título → recebido).
// Cada peça mostra um desses eixos inteiro, com os estágios vazios à vista:
// ver quatro zeros em fila é a informação, não a ausência dela.

import type { PlanoCompleto } from "./PlanoFechamento";

/** Um pedido de venda ou ordem de serviço do projeto. */
export type Venda = {
  tipo: "PV" | "OS"; label: string; numero: string;
  valor: number; etapa_code: string | null; etapa_texto: string | null;
  dt_previsao: string | null; dt_faturado: string | null;
  num_nfe: string | null; faturado: boolean;
};

export type Execucao = {
  requisitado: number; aprovado: number; recusado: number;
  a_pagar: number; pago: number;
  a_receber: number; recebido: number;
  qtd_requisitado: number; qtd_aprovado: number;
};

const brl = (v: number | null | undefined) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** Curto, para a régua: cinco valores por extenso não cabem lado a lado sem
 *  quebrar, e quebrar destrói a leitura de sequência. */
const curto = (v: number) => {
  const n = Number(v || 0);
  if (n === 0) return "—";
  if (Math.abs(n) >= 1000)
    return `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return brl(n);
};
const dia = (s: string | null | undefined) => {
  if (!s) return "—";
  const [a, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${a.slice(2)}`;
};
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

/** Números derivados do plano — um lugar só, para as abas não divergirem. */
export function numerosDoPlano(plano: PlanoCompleto | null, teto: number | null) {
  const cab = plano?.plano ?? null;
  const parcelas = plano?.parcelas ?? [];
  const fechado = cab?.valor_fechado != null ? Number(cab.valor_fechado)
                : cab?.valor_venda   != null ? Number(cab.valor_venda) : null;
  const somaParcelas = parcelas.reduce((a, p) => a + Number(p.valor || 0), 0);
  const valor = fechado ?? somaParcelas;
  const pMat = Number(cab?.custo_materiais ?? 0);
  const pMao = Number(cab?.custo_mao_obra ?? 0);
  const pDes = Number(cab?.custo_despesas ?? 0);
  const planejado = teto ?? (pMat + pMao + pDes);
  return {
    cab, parcelas, fechado, somaParcelas, valor,
    pMat, pMao, pDes, planejado,
    temPlano: planejado > 0,
    resultado: valor - planejado,
    margem: valor > 0 ? ((valor - planejado) / valor) * 100 : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OS TRÊS KPIS — fixos acima das abas
// ─────────────────────────────────────────────────────────────────────────────
export function KpisProjeto({
  plano, teto, onEditarTeto, podeEditar,
}: {
  plano: PlanoCompleto | null;
  teto: number | null;
  onEditarTeto?: () => void;
  podeEditar: boolean;
}) {
  const n = numerosDoPlano(plano, teto);
  const { cab } = n;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Cartao rot="Valor fechado" valor={n.valor > 0 ? brl(n.valor) : "—"}
        tom="text-emerald-600 dark:text-emerald-300"
        nota={n.parcelas.length > 0
          ? `${n.parcelas.length} × ${brl(n.somaParcelas / n.parcelas.length)}`
          : "sem plano importado"}
        extra={cab?.valor_venda != null && n.fechado != null
          && Math.abs(n.fechado - Number(cab.valor_venda)) > 0.05
          ? `proposta calculava ${brl(cab.valor_venda)}` : undefined} />

      <Cartao rot="Custo planejado" valor={n.temPlano ? brl(n.planejado) : "—"}
        tom="text-ww-text"
        nota={n.temPlano ? undefined : "importe o plano do fechamento"}
        acao={podeEditar && onEditarTeto
          ? { rot: teto != null && Math.abs(teto - (n.pMat + n.pMao + n.pDes)) > 0.05
                ? "teto ajustado" : "ajustar",
              fn: onEditarTeto }
          : undefined}>
        {n.temPlano && n.pMat + n.pMao + n.pDes > 0 && (
          <Composicao mat={n.pMat} mao={n.pMao} desp={n.pDes} />
        )}
      </Cartao>

      <Cartao rot="Resultado planejado" valor={n.temPlano ? brl(n.resultado) : "—"}
        tom={n.resultado >= 0 ? "text-emerald-600 dark:text-emerald-300"
                              : "text-rose-600 dark:text-rose-300"}
        nota={n.temPlano && n.margem != null ? `${pct(n.margem)} do valor fechado` : undefined}
        // A margem da MC é OUTRA conta: desconta imposto e foi calculada sobre
        // o valor da proposta, não sobre o fechado. Nomeada, não misturada.
        extra={cab?.margem_pct != null ? `MC ${pct(Number(cab.margem_pct))} com impostos` : undefined} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. A RÉGUA — onde o dinheiro que sai parou
// ─────────────────────────────────────────────────────────────────────────────
export function ReguaExecucao({
  plano, execucao, teto,
}: {
  plano: PlanoCompleto | null; execucao: Execucao | null; teto: number | null;
}) {
  const n = numerosDoPlano(plano, teto);
  if (!n.temPlano) return null;

  const ex = execucao;
  const req = ex?.requisitado ?? 0;
  const apr = ex?.aprovado ?? 0;
  const aPagar = ex?.a_pagar ?? 0;
  const pag = ex?.pago ?? 0;
  const semDoc = Math.max(0, n.planejado - req - apr);

  const estagios = [
    { k: "pl", rot: "Planejado",   v: n.planejado, sub: "reservado no fechamento",
      tom: "bg-ww-border",  texto: "text-ww-text" },
    { k: "rq", rot: "Requisitado", v: req,
      sub: ex?.qtd_requisitado ? `${ex.qtd_requisitado} pedido(s) sem aprovação` : "nenhum pedido",
      tom: "bg-amber-500",  texto: "text-amber-600 dark:text-amber-300" },
    { k: "ap", rot: "Aprovado",    v: apr,
      sub: ex?.qtd_aprovado ? `${ex.qtd_aprovado} pedido(s)` : "caixa ainda não comprometido",
      tom: "bg-sky-500",    texto: "text-sky-600 dark:text-sky-300" },
    { k: "pg", rot: "A pagar",     v: aPagar, sub: "título com vencimento",
      tom: "bg-violet-500", texto: "text-violet-600 dark:text-violet-300" },
    { k: "ok", rot: "Pago",        v: pag,    sub: "saiu do caixa",
      tom: "bg-rose-500",   texto: "text-rose-600 dark:text-rose-300" },
  ];

  return (
    <div>
      <ol className="grid grid-cols-2 sm:grid-cols-5 gap-x-2 gap-y-3">
        {estagios.map((e, i) => (
          <li key={e.k} className="min-w-0">
            <div className="flex items-center gap-1">
              <span className="text-[9.5px] uppercase tracking-[0.6px] font-semibold text-ww-textFaint truncate">
                {e.rot}
              </span>
              {i < estagios.length - 1 && (
                <span aria-hidden className="text-ww-textFaint/50 text-[9px] ml-auto hidden sm:inline">→</span>
              )}
            </div>
            <div className={`text-[16px] font-semibold tabular-nums mt-0.5 leading-none ${
              e.v <= 0.005 ? "text-ww-textFaint" : e.texto}`}>
              {curto(e.v)}
            </div>
            <div className="mt-1.5 h-1 rounded-full bg-ww-border/50 overflow-hidden">
              <div className={`h-full rounded-full ${e.tom}`}
                style={{ width: `${n.planejado > 0 ? Math.min(100, (e.v / n.planejado) * 100) : 0}%` }} />
            </div>
            <div className="mt-1 text-[9.5px] text-ww-textMuted leading-tight">{e.sub}</div>
          </li>
        ))}
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
        {semDoc > 0.005 && (
          Math.abs(semDoc - (n.pMao + n.pDes)) < 0.05 ? (
            <> Os outros <strong className="text-ww-text">{brl(semDoc)}</strong> são mão de obra e
              despesas, que por natureza nunca viram pedido de compra.</>
          ) : (
            <> Outros <strong className="text-ww-text">{brl(semDoc)}</strong> do planejado não têm
              documento nenhum
              {n.pMao + n.pDes > 0.005 && <>, dos quais {brl(n.pMao + n.pDes)} são mão de obra e
                despesas, que nunca viram pedido de compra</>}.
            </>
          )
        )}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. FATURAMENTO — os PV/OS, um por um
// ─────────────────────────────────────────────────────────────────────────────
export function Faturamento({ vendas }: { vendas: Venda[] }) {
  if (!vendas.length) {
    return (
      <p className="text-[11.5px] text-ww-textFaint">
        Nenhum pedido de venda ou ordem de serviço ligada a este projeto no Omie.
      </p>
    );
  }
  const faturadas = vendas.filter((v) => v.faturado);
  const vlFat = faturadas.reduce((a, v) => a + Number(v.valor || 0), 0);
  const vlFalta = vendas.filter((v) => !v.faturado).reduce((a, v) => a + Number(v.valor || 0), 0);

  return (
    <div>
      <p className="text-[11px] text-ww-textMuted tabular-nums mb-2">
        {faturadas.length} de {vendas.length} faturada(s) ·{" "}
        <strong className="text-emerald-600 dark:text-emerald-300">{brl(vlFat)}</strong>
        {vlFalta > 0.5 && <> · falta emitir {brl(vlFalta)}</>}
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {vendas.map((v) => (
          <li key={`${v.tipo}${v.numero}`}
            className={`rounded-lg border px-2.5 py-2 min-w-0 ${
              v.faturado ? "border-emerald-500/35 bg-emerald-500/[0.07]"
                         : "border-ww-border bg-ww-bg/40"}`}>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-[11.5px] font-semibold text-ww-text">{v.label}</span>
              <span className="ml-auto text-[12px] tabular-nums text-ww-text">{brl(v.valor)}</span>
            </div>
            <div className="mt-1 flex items-center gap-1 flex-wrap">
              <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9.5px] font-semibold ${
                v.faturado ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                           : "bg-sky-500/12 text-sky-700 dark:text-sky-300"}`}>
                {v.faturado ? "Faturado" : (v.etapa_texto ?? "A faturar")}
              </span>
              {v.num_nfe && <span className="text-[9.5px] text-ww-textMuted">NF {v.num_nfe}</span>}
            </div>
            <div className="mt-1 text-[9.5px] text-ww-textFaint tabular-nums">
              {v.faturado && v.dt_faturado
                ? `emitida em ${dia(v.dt_faturado)}`
                : v.dt_previsao ? `previsão ${dia(v.dt_previsao)}` : "sem data"}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. RECEBIMENTO — o eixo do dinheiro que entra
// ─────────────────────────────────────────────────────────────────────────────
export function Recebimento({
  execucao, vendas, plano, teto,
}: {
  execucao: Execucao | null; vendas: Venda[];
  plano: PlanoCompleto | null; teto: number | null;
}) {
  const n = numerosDoPlano(plano, teto);
  const recebido = execucao?.recebido ?? 0;
  const aReceber = execucao?.a_receber ?? 0;
  const pago = execucao?.pago ?? 0;
  /** Falta faturar sai dos PV/OS, não do título: título só existe DEPOIS da
   *  nota, então medir por ele começa a conta pelo fim. */
  const semNota = vendas.length
    ? vendas.filter((v) => !v.faturado).reduce((a, v) => a + Number(v.valor || 0), 0)
    : Math.max(0, n.valor - recebido - aReceber);
  const caixa = recebido - pago;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {[
        { rot: "Recebido", v: brl(recebido),
          tom: recebido > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-ww-textFaint",
          sub: "entrou no caixa" },
        { rot: "Em título, a receber", v: brl(aReceber), tom: "text-ww-text",
          sub: "nota emitida, aguardando pagamento" },
        { rot: "Ainda sem nota", v: brl(semNota),
          tom: semNota > 0 ? "text-amber-600 dark:text-amber-300" : "text-ww-textFaint",
          sub: "PV/OS que ainda não foram faturados" },
        { rot: "Caixa do projeto hoje", v: brl(caixa),
          tom: caixa >= 0 ? "text-emerald-600 dark:text-emerald-300"
                          : "text-rose-600 dark:text-rose-300",
          sub: caixa < 0 ? "você está financiando" : "entrou mais do que saiu" },
      ].map((c) => (
        <div key={c.rot} className="rounded-lg border border-ww-border bg-ww-bg/40 px-2.5 py-2">
          <div className="text-[9.5px] uppercase tracking-[0.6px] font-bold text-ww-textFaint">
            {c.rot}
          </div>
          <div className={`text-[16px] font-semibold tabular-nums leading-tight mt-0.5 ${c.tom}`}>
            {c.v}
          </div>
          <div className="text-[9.5px] text-ww-textMuted leading-tight mt-0.5">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. CONDIÇÕES COMERCIAIS
// ─────────────────────────────────────────────────────────────────────────────
export function CondicoesComerciais({ plano }: { plano: PlanoCompleto | null }) {
  const cab = plano?.plano ?? null;
  const parcelas = plano?.parcelas ?? [];
  if (!cab) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <Mini rot="Pagamento"
        valor={parcelas.length
          ? `${parcelas.length}× de ${parcelas[0]?.pct != null
              ? `${Number(parcelas[0].pct).toFixed(0)}%` : "—"}`
          : "—"}
        nota={parcelas.some((p) => p.dias != null)
          ? `${parcelas.map((p) => (p.dias != null ? p.dias : "?")).join(" · ")} dias${
              cab.eixo_pagamento ? ` de ${dia(cab.eixo_pagamento)}` : ""}`
          : undefined}
        // "28 ddl" é o que estava escrito na proposta antes de alguém definir
        // as parcelas — a planilha anota que "o fechamento só lhe pôs datas".
        origem={cab.prop_pagamento ?? cab.forma_pagamento
          ? `na proposta: ${cab.prop_pagamento ?? cab.forma_pagamento}` : undefined} />

      <Mini rot="Entrega"
        valor={cab.prazo_entrega_dias ? `${cab.prazo_entrega_dias} dias` : "—"}
        nota={cab.data_base || cab.entrega_prevista
          ? `${dia(cab.data_base)} → ${dia(cab.entrega_prevista)}` : undefined}
        origem={cab.prop_prazo ? `na proposta: ${cab.prop_prazo}` : undefined} />

      <div className="rounded-lg border border-ww-border bg-ww-bg/40 px-2.5 py-2 min-w-0">
        <div className="text-[9.5px] uppercase tracking-[0.6px] font-bold text-ww-textFaint">
          Por conta de quem
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {([["Frete", cab.frete], ["Deslocamento", cab.deslocamento],
             ["Instalação", cab.instalacao], ["Impostos", cab.impostos]] as const)
            .map(([rot, v]) => {
              const cl = deQuem(v);
              return (
                <span key={rot} title={v ?? "não informado"}
                  className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    cl === "nosso" ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                    : cl === "incluso" ? "bg-sky-500/12 text-sky-700 dark:text-sky-300"
                    : "border border-dashed border-ww-border text-ww-textFaint"}`}>
                  {rot}
                </span>
              );
            })}
        </div>
        <div className="mt-1.5 text-[9.5px] text-ww-textFaint">
          <span className="text-rose-600 dark:text-rose-400">vermelho</span> sai do nosso caixa ·
          azul está incluso no preço
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Peças menores
// ─────────────────────────────────────────────────────────────────────────────
function Cartao({ rot, valor, tom, nota, extra, acao, children }: {
  rot: string; valor: string; tom: string; nota?: string; extra?: string;
  acao?: { rot: string; fn: () => void }; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-ww-border bg-ww-panel px-4 py-3.5 min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[9.5px] uppercase tracking-[0.7px] font-bold text-ww-textFaint">{rot}</span>
        {acao && (
          <button type="button" onClick={acao.fn}
            className="ml-auto text-[10px] text-ww-textFaint hover:text-ww-accent transition">
            {acao.rot}
          </button>
        )}
      </div>
      <div className={`text-[23px] font-semibold tabular-nums tracking-[-0.5px] leading-tight mt-1 ${tom}`}>
        {valor}
      </div>
      {nota && <div className="text-[11px] text-ww-textMuted truncate" title={nota}>{nota}</div>}
      {extra && <div className="text-[10px] text-ww-textFaint truncate" title={extra}>{extra}</div>}
      {children}
    </div>
  );
}

function Mini({ rot, valor, nota, origem }: {
  rot: string; valor: string; nota?: string; origem?: string;
}) {
  return (
    <div className="rounded-lg border border-ww-border bg-ww-bg/40 px-2.5 py-2 min-w-0">
      <div className="text-[9.5px] uppercase tracking-[0.6px] font-bold text-ww-textFaint">{rot}</div>
      <div className="text-[15px] font-semibold text-ww-text tabular-nums leading-tight mt-0.5 truncate"
           title={valor}>{valor}</div>
      {nota && <div className="text-[10.5px] text-ww-textMuted tabular-nums truncate" title={nota}>{nota}</div>}
      {origem && <div className="text-[9.5px] text-ww-textFaint truncate" title={origem}>{origem}</div>}
    </div>
  );
}

/** De que é feito o custo planejado — em barra, com cor por natureza.
 *
 *  As MESMAS cores da régua: materiais esmeralda, mão de obra azul, despesas
 *  violeta. Repetir a cor entre os blocos é o que permite ligar "71% é
 *  material" a "o requisitado é tudo material". */
function Composicao({ mat, mao, desp }: { mat: number; mao: number; desp: number }) {
  const tot = mat + mao + desp;
  const fatias = [
    { rot: "materiais", v: mat,  tom: "bg-emerald-500" },
    { rot: "obra",      v: mao,  tom: "bg-sky-500" },
    { rot: "despesas",  v: desp, tom: "bg-violet-500" },
  ].filter((f) => f.v > 0);
  return (
    <div className="mt-2">
      {/* gap de 2px: sem ele, duas cores de luminosidade parecida leem como
          uma faixa só. */}
      <div className="flex gap-[2px] h-1.5">
        {fatias.map((f) => (
          <div key={f.rot} className={`${f.tom} rounded-[2px]`}
            style={{ width: `${(f.v / tot) * 100}%` }}
            title={`${f.rot}: ${brl(f.v)}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
        {fatias.map((f) => (
          <span key={f.rot} className="inline-flex items-center gap-1 text-[10px] text-ww-textMuted">
            <span aria-hidden className={`w-1.5 h-1.5 rounded-[1px] ${f.tom}`} />
            {f.rot}{" "}
            <span className="tabular-nums text-ww-textFaint">{Math.round((f.v / tot) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** De quem é a conta. A planilha escreve em português corrido, então a
 *  classificação é por texto — e o que importa distinguir é uma coisa só:
 *  sai do nosso caixa ou não. É daí que o fluxo sabe o que somar. */
function deQuem(v: string | null | undefined): "nosso" | "incluso" | "outro" {
  const t = (v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!t || t === "—" || /nao informado/.test(t)) return "outro";
  if (/nossa|nosso/.test(t)) return "nosso";
  if (/inclus/.test(t)) return "incluso";
  return "outro";
}
