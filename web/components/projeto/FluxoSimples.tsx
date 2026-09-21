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
  titulo, dica, linhas, itensErp, jaFoi, falta, rotJa, rotFalta, tom, rotLiq,
}: {
  titulo: string; dica: string; linhas: Linha[]; itensErp: Item[];
  jaFoi: number; falta: number; rotJa: string; rotFalta: string; tom: string; rotLiq: string;
}) {
  const previsto = linhas.reduce((s, l) => s + Number(l.valor || 0), 0);
  return (
    <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 space-y-3">
      <header>
        <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">{titulo}</h3>
        <p className="text-[11px] text-ww-textMuted mt-0.5">{dica}</p>
      </header>

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
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id} className="border-b border-ww-border/50 last:border-0">
                  <td className="py-1 tabular-nums text-ww-textMuted">{dia(l.data_prevista)}</td>
                  <td className="py-1 text-ww-text">{l.descricao}</td>
                  <td className="py-1 text-ww-textMuted">{l.categoria || "—"}</td>
                  <td className="py-1 text-right tabular-nums">{brl(l.valor)}</td>
                </tr>
              ))}
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
    </section>
  );
}

export default function FluxoSimples({
  empresa, codigoProjeto, tetoPlano,
}: { empresa: string; codigoProjeto: number; tetoPlano: number }) {
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
      const r = await fetch(
        `/api/rc-projetos/fluxo?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}`,
        { cache: "no-store" });
      const j = (await r.json()) as Payload;
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      setErro(null); setData(j);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }, [empresa, codigoProjeto]);
  useEffect(() => { void carregar(); }, [carregar]);

  if (erro) {
    return <div className="text-[12px] text-rose-600 dark:text-rose-300">Não consegui ler o fluxo: {erro}</div>;
  }
  if (!data) return <div className="text-[12px] text-ww-textMuted">Carregando o fluxo…</div>;

  const ex = data.execucao;
  const entradas = (data.linhas ?? []).filter((l) => l.tipo === "entrada");
  const saidas = (data.linhas ?? []).filter((l) => l.tipo === "saida");
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
        tom="text-emerald-600 dark:text-emerald-300" />

      <Agenda
        titulo="Saídas" dica="a agenda de compras e despesas do plano, e os pedidos de compra que já existem no Omie"
        linhas={saidas} itensErp={doErp("saida")} jaFoi={pago} falta={aPagar}
        rotJa="Já saiu" rotFalta="Ainda não saiu" rotLiq="Pago"
        tom="text-rose-600 dark:text-rose-300" />

      <section className="viz-panel bg-ww-panel border border-ww-border rounded-xl p-3.5 min-w-0 space-y-3">
        <header>
          <h3 className="text-[12.5px] font-semibold text-ww-text tracking-wide uppercase">
            Budget × pedidos de compra
          </h3>
          <p className="text-[11px] text-ww-textMuted mt-0.5">
            o que o fechamento reservou, contra o que já foi aprovado e o que já foi pago
          </p>
        </header>
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
      </section>
    </div>
  );
}
