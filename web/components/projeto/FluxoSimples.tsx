"use client";
// Fluxo de caixa do projeto, em três perguntas — e só.
//
//   1. Qual a agenda de ENTRADAS que veio da planilha, e quanto já entrou.
//   2. Qual a agenda de SAÍDAS, e quanto já saiu.
//   3. O budget do fechamento bate com os pedidos aprovados e pagos?
//
// A tela anterior respondia isso espalhado em faturamento por PV/OS,
// recebimento em quatro cartões, uma grade de digitação, três curvas diárias
// e duas tabelas cruas do ERP. Tudo verdadeiro, e junto demais para servir de
// resposta. O que saiu não sumiu do banco — só deixou de disputar a atenção.

import { useCallback, useEffect, useState } from "react";
import PlanoFechamento, { type PlanoCompleto } from "./PlanoFechamento";
import type { DadosComparado } from "./FluxoComparado";

/** Diferença de uma linha da agenda contra o fluxo INICIAL travado (07/10/26). */
type Delta = { dias: number | null; valor: number } | null;
const difDias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);

type Linha = {
  id: number; tipo: "entrada" | "saida"; descricao: string;
  categoria: string | null; data_prevista: string; valor: number; origem: string;
};
type Execucao = {
  requisitado: number; aprovado: number; recusado: number;
  a_pagar: number; pago: number; a_receber: number; recebido: number;
  qtd_requisitado: number; qtd_aprovado: number;
} | null;
type Orcamento = { valor_budget: number | null } | null;
/** O que o ERP já tem: título a receber, PV a faturar e PEDIDO DE COMPRA. */
type Previsto = {
  lado: "entrada" | "saida";
  fonte: "titulo_receber" | "pv_a_faturar" | "pedido_compra";
  referencia: string; descricao: string; valor: number; liquidado: number;
  situacao: string;
  data_manual: string | null; data_calculada: string | null; data_omie: string | null;
};
type Payload = {
  linhas: Linha[]; previsto: Previsto[]; execucao: Execucao; orcamento: Orcamento; error?: string;
};

/** Uma linha da agenda, venha do plano ou do ERP. */
type Item = {
  chave: string; data: string; desc: string; origem: string;
  valor: number; liquidado: number;
};
const FONTE: Record<Previsto["fonte"], string> = {
  titulo_receber: "Título", pv_a_faturar: "PV a faturar", pedido_compra: "Pedido de compra",
};

const brl = (v: number | null | undefined) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a.slice(2)}`;
};

/** Um número com rótulo. Três deles dizem o estado de um lado do caixa. */
function Num({ rot, val, tom, sub }: { rot: string; val: string; tom?: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] uppercase tracking-wide text-ww-textMuted">{rot}</div>
      <div className={`text-[16px] font-bold tabular-nums ${tom ?? "text-ww-text"}`}>{val}</div>
      {sub && <div className="text-[10.5px] text-ww-textFaint">{sub}</div>}
    </div>
  );
}

function Agenda({
  titulo, dica, linhas, itensErp, jaFoi, falta, rotJa, rotFalta, tom, rotLiq, deltas,
}: {
  titulo: string; dica: string; linhas: Linha[]; itensErp: Item[];
  jaFoi: number; falta: number; rotJa: string; rotFalta: string; tom: string; rotLiq: string;
  deltas?: Map<number, Delta>;
}) {
  const previsto = linhas.reduce((s, l) => s + Number(l.valor || 0), 0);
  const comDelta = !!deltas && deltas.size > 0;
  return (
    /* Recolhível (07/10/26): o gráfico em cima responde a pergunta; as tabelas são o detalhe. */
    <details open className="group viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0">
      <summary className="list-none cursor-pointer select-none flex items-start gap-2">
        <span aria-hidden className="mt-0.5 text-ww-textFaint transition-transform group-open:rotate-90">▸</span>
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">{titulo}</h3>
          <p className="text-[11px] text-ww-textMuted mt-0.5">{dica}</p>
        </div>
        <span className="ml-auto text-[13px] font-bold tabular-nums text-ww-text">{brl(previsto)}</span>
      </summary>
      <div className="space-y-3 mt-3">

      <div className="grid grid-cols-3 gap-3">
        <Num rot="Previsto na planilha" val={brl(previsto)} sub={`${linhas.length} lançamento(s)`} />
        <Num rot={rotJa} val={brl(jaFoi)} tom={tom} />
        <Num rot={rotFalta} val={brl(falta)} tom="text-ww-textMuted" />
      </div>

      {linhas.length === 0 ? (
        <p className="text-[11.5px] text-ww-textFaint">
          Nada na agenda do plano ainda — suba o CP/MC preenchido para ela entrar aqui.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-ww-textMuted border-b border-ww-border">
                <th className="py-1 font-semibold w-[92px]">Data</th>
                <th className="py-1 font-semibold">Descrição</th>
                <th className="py-1 font-semibold">Categoria</th>
                <th className="py-1 font-semibold text-right w-[120px]">Valor</th>
                {comDelta && (
                  <th className="py-1 font-semibold text-right w-[150px]"
                      title="Contra o fluxo inicial travado: dias que a data andou e diferença de valor">Δ vs inicial</th>
                )}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const dl = deltas?.get(l.id) ?? null;
                return (
                <tr key={l.id} className="border-b border-ww-border/50 last:border-0">
                  <td className="py-1 tabular-nums text-ww-textMuted">{dia(l.data_prevista)}</td>
                  <td className="py-1 text-ww-text">{l.descricao}</td>
                  <td className="py-1 text-ww-textMuted">{l.categoria || "—"}</td>
                  <td className="py-1 text-right tabular-nums">{brl(l.valor)}</td>
                  {comDelta && (
                    <td className="py-1 text-right tabular-nums text-[11.5px]">
                      {!dl ? <span className="text-ww-textFaint" title="Sem par no fluxo inicial">novo</span>
                        : (!dl.dias && Math.abs(dl.valor) < 0.5) ? <span className="text-ww-textFaint">=</span>
                        : <>
                            {dl.dias ? <span className={dl.dias > 0 ? "text-amber-600 dark:text-amber-300" : "text-sky-600 dark:text-sky-300"}>{dl.dias > 0 ? "+" : ""}{dl.dias} d</span> : null}
                            {dl.dias && Math.abs(dl.valor) >= 0.5 ? " · " : ""}
                            {Math.abs(dl.valor) >= 0.5 ? <span className="text-ww-textMuted">{dl.valor > 0 ? "+" : "−"}{brl(Math.abs(dl.valor))}</span> : null}
                          </>}
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* O que o ERP já tem para este projeto: do lado das saídas são os
          PEDIDOS DE COMPRA, que é onde o plano vira compromisso de verdade.
          Vem depois da agenda porque a agenda é a intenção e isto é o fato. */}
      {itensErp.length > 0 && (
        <div className="pt-1">
          <div className="text-[10.5px] uppercase tracking-wide text-ww-textMuted mb-1">
            Já no Omie · {itensErp.length} lançamento(s)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-ww-textMuted border-b border-ww-border">
                  <th className="py-1 font-semibold w-[92px]">Data</th>
                  <th className="py-1 font-semibold">Descrição</th>
                  <th className="py-1 font-semibold w-[130px]">Origem</th>
                  <th className="py-1 font-semibold text-right w-[120px]">Valor</th>
                  <th className="py-1 font-semibold text-right w-[110px]">{rotLiq}</th>
                </tr>
              </thead>
              <tbody>
                {itensErp.map((i) => (
                  <tr key={i.chave} className="border-b border-ww-border/50 last:border-0">
                    <td className="py-1 tabular-nums text-ww-textMuted">{dia(i.data)}</td>
                    <td className="py-1 text-ww-text">{i.desc}</td>
                    <td className="py-1 text-ww-textMuted">{i.origem}</td>
                    <td className="py-1 text-right tabular-nums">{brl(i.valor)}</td>
                    <td className={`py-1 text-right tabular-nums ${i.liquidado > 0 ? tom : "text-ww-textFaint"}`}>
                      {i.liquidado > 0 ? brl(i.liquidado) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    </details>
  );
}

export default function FluxoSimples({
  empresa, codigoProjeto, tetoPlano, comparado,
}: { empresa: string; codigoProjeto: number; tetoPlano: number; comparado?: DadosComparado | null }) {
  const [data, setData] = useState<Payload | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /* O plano é o que enche as duas agendas. O upload vive AQUI porque é aqui
     que a falta dele aparece — a tela diz "nada na agenda ainda" e o botão
     de resolver está na mesma dobra. */
  const [plano, setPlano] = useState<PlanoCompleto | null>(null);
  const carregarPlano = useCallback(async () => {
    try {
      const r = await fetch(
        `/api/rc-projetos/plano?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}`,
        { cache: "no-store" });
      if (r.ok) setPlano((await r.json()) as PlanoCompleto);
    } catch { /* sem plano, o botão continua oferecendo a importação */ }
  }, [empresa, codigoProjeto]);
  useEffect(() => { void carregarPlano(); }, [carregarPlano]);

  const carregar = useCallback(async () => {
    try {
      // 07/10/26: o banco às vezes estoura o statement timeout — tenta de novo duas vezes.
      for (let t = 0; ; t++) {
        const r = await fetch(
          `/api/rc-projetos/fluxo?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}`,
          { cache: "no-store" });
        const j = (await r.json()) as Payload;
        if (!r.ok && t < 2 && /timeout|canceling statement/i.test(j.error ?? "")) {
          await new Promise((ok) => setTimeout(ok, 1500)); continue;
        }
        if (!r.ok) { setErro(j.error ?? r.statusText); return; }
        setErro(null); setData(j); return;
      }
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }, [empresa, codigoProjeto]);
  useEffect(() => { void carregar(); }, [carregar]);

  if (erro) {
    return <div className="text-[12px] text-rose-600 dark:text-rose-300">Não consegui ler o fluxo: {erro}</div>;
  }
  if (!data) return <div className="text-[12px] text-ww-textMuted">Carregando o fluxo…</div>;

  const ex = data.execucao;
  /* A agenda vem do PLANO importado (parcelas e saídas do CP/MC). Desde
     21/09 esta tela lia só approval.projeto_fluxo_linha — a grade de
     digitação antiga, que a importação do plano não preenche — e por isso
     dizia "nada na agenda" em todo projeto com plano. Linhas digitadas na
     grade antiga, se houver, continuam a somar. Data da parcela: a ajustada
     manda sobre a do plano, como no bloco de premissas. */
  const doPlano: Linha[] = [
    ...(plano?.parcelas ?? []).map((pp) => ({
      id: -1000 - pp.parcela, tipo: "entrada" as const,
      descricao: pp.evento || `Parcela ${pp.parcela}`, categoria: "Parcela do fechamento",
      data_prevista: pp.dt_ajustada ?? pp.dt_plano ?? "", valor: Number(pp.valor || 0), origem: "plano",
    })),
    ...(plano?.saidas ?? []).filter((x) => x.no_fluxo).map((x) => ({
      id: -1 - x.id, tipo: "saida" as const,
      descricao: x.descricao || x.fornecedor || "Saída do plano",
      categoria: x.origem === "sem_pc" ? "Sem pedido de compra" : (x.etapa || "Material"),
      data_prevista: x.dt_prevista ?? "", valor: Number(x.valor || 0), origem: "plano",
    })),
  ];
  const agenda = [...doPlano, ...(data.linhas ?? [])]
    .sort((a, b) => (a.data_prevista || "9").localeCompare(b.data_prevista || "9"));
  const entradas = agenda.filter((l) => l.tipo === "entrada");
  /* Δ vs inicial (07/10/26): parcela pelo número; saída do plano pela descrição e,
     havendo repetidas, pela ordem. */
  const deltasEnt = new Map<number, Delta>();
  const deltasSai = new Map<number, Delta>();
  if (comparado && comparado.inicial_fonte === "congelado") {
    for (const pp of plano?.parcelas ?? []) {
      const ini = comparado.inicial.find((e) => e.tipo === "entrada" && e.ref === String(pp.parcela));
      const atual = pp.dt_ajustada ?? pp.dt_plano;
      deltasEnt.set(-1000 - pp.parcela, ini ? {
        dias: ini.data && atual ? difDias(atual, ini.data) : null, valor: Number(pp.valor || 0) - ini.valor } : null);
    }
    const usados = new Set<number>();
    const iniSai = comparado.inicial.filter((e) => e.tipo === "saida");
    for (const x of (plano?.saidas ?? []).filter((y) => y.no_fluxo)) {
      const desc = x.descricao || x.fornecedor || "Saída do plano";
      const k = iniSai.findIndex((e, i) => !usados.has(i) && e.descricao === desc);
      if (k < 0) { deltasSai.set(-1 - x.id, null); continue; }
      usados.add(k);
      const ini = iniSai[k];
      deltasSai.set(-1 - x.id, { dias: ini.data && x.dt_prevista ? difDias(x.dt_prevista, ini.data) : null,
        valor: Number(x.valor || 0) - ini.valor });
    }
  }
  const saidas = agenda.filter((l) => l.tipo === "saida");
  /* O que entrou e o que saiu vêm do ERP — título baixado e pedido pago. A
     agenda é previsão; caixa é o que o banco confirma. */
  const recebido = Number(ex?.recebido ?? 0);
  const aReceber = Number(ex?.a_receber ?? 0);
  const pago = Number(ex?.pago ?? 0);
  const aPagar = Number(ex?.a_pagar ?? 0);
  /* Data do lançamento do ERP: a manual manda sobre a calculada, e a do
     Omie é o último recurso — é a mesma ordem que a tabela antiga usava. */
  const doErp = (lado: "entrada" | "saida"): Item[] =>
    (data.previsto ?? []).filter((p) => p.lado === lado).map((p, i) => ({
      chave: `${p.fonte}|${p.referencia}|${i}`,
      data: p.data_manual || p.data_calculada || p.data_omie || "",
      desc: p.descricao || p.referencia,
      origem: `${FONTE[p.fonte]}${p.referencia ? ` ${p.referencia}` : ""}`,
      valor: Number(p.valor || 0), liquidado: Number(p.liquidado || 0),
    })).sort((a, b) => (a.data || "9").localeCompare(b.data || "9"));
  const budget = Number(data.orcamento?.valor_budget ?? 0) || tetoPlano;
  const aprovado = Number(ex?.aprovado ?? 0);
  const requisitado = Number(ex?.requisitado ?? 0);
  const sobra = budget - aprovado;

  return (
    <div className="space-y-3.5">
      {/* Subir o CP/MC preenchido: é daqui que saem as duas agendas. */}
      <PlanoFechamento empresa={empresa} codigoProjeto={codigoProjeto}
        podeEditar dados={plano} somenteImportar
        onMudou={() => { void carregarPlano(); void carregar(); }} />

      <Agenda
        titulo="Entradas" dica="a agenda que veio da planilha — e o que dela já caiu no caixa"
        linhas={entradas} itensErp={doErp("entrada")} jaFoi={recebido} falta={aReceber}
        rotJa="Já entrou" rotFalta="Ainda não entrou" rotLiq="Recebido"
        tom="text-emerald-600 dark:text-emerald-300" deltas={deltasEnt} />

      <Agenda
        titulo="Saídas" dica="a agenda de compras e despesas do plano, e os pedidos de compra que já existem no Omie"
        linhas={saidas} itensErp={doErp("saida")} jaFoi={pago} falta={aPagar}
        rotJa="Já saiu" rotFalta="Ainda não saiu" rotLiq="Pago"
        tom="text-rose-600 dark:text-rose-300" deltas={deltasSai} />

      <details open className="group viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0">
        <summary className="list-none cursor-pointer select-none flex items-start gap-2">
          <span aria-hidden className="mt-0.5 text-ww-textFaint transition-transform group-open:rotate-90">▸</span>
          <div>
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
            Budget × pedidos de compra
          </h3>
          <p className="text-[11px] text-ww-textMuted mt-0.5">
            o que o fechamento reservou, contra o que já foi aprovado e o que já foi pago
          </p>
          </div>
        </summary>
        <div className="space-y-3 mt-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Num rot="Budget do fechamento" val={brl(budget)} sub="reservado para gastar" />
          <Num rot="Requisitado" val={brl(requisitado)}
               sub={ex?.qtd_requisitado ? `${ex.qtd_requisitado} pedido(s)` : "nada pedido ainda"} />
          <Num rot="Aprovado" val={brl(aprovado)} tom="text-amber-600 dark:text-amber-300"
               sub="caixa comprometido" />
          <Num rot="Pago" val={brl(pago)} tom="text-rose-600 dark:text-rose-300" sub="saiu do caixa" />
        </div>
        {budget > 0 && (
          <div className={`text-[12px] ${sobra < 0 ? "text-rose-600 dark:text-rose-300" : "text-ww-textMuted"}`}>
            {sobra < 0
              ? <>Aprovado <strong>{brl(-sobra)} acima</strong> do budget do fechamento.</>
              : <>Resta <strong className="text-ww-text">{brl(sobra)}</strong> do budget por comprometer.</>}
          </div>
        )}
        </div>
      </details>
    </div>
  );
}
