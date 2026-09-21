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
type Payload = { linhas: Linha[]; execucao: Execucao; orcamento: Orcamento; error?: string };

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
  titulo, dica, linhas, jaFoi, falta, rotJa, rotFalta, tom,
}: {
  titulo: string; dica: string; linhas: Linha[];
  jaFoi: number; falta: number; rotJa: string; rotFalta: string; tom: string;
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
          Nada na agenda ainda — suba o CP/MC preenchido para o plano entrar aqui.
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
    </section>
  );
}

export default function FluxoSimples({
  empresa, codigoProjeto, tetoPlano,
}: { empresa: string; codigoProjeto: number; tetoPlano: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [erro, setErro] = useState<string | null>(null);

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
  const budget = Number(data.orcamento?.valor_budget ?? 0) || tetoPlano;
  const aprovado = Number(ex?.aprovado ?? 0);
  const requisitado = Number(ex?.requisitado ?? 0);
  const sobra = budget - aprovado;

  return (
    <div className="space-y-3.5">
      <Agenda
        titulo="Entradas" dica="a agenda que veio da planilha — e o que dela já caiu no caixa"
        linhas={entradas} jaFoi={recebido} falta={aReceber}
        rotJa="Já entrou" rotFalta="Ainda não entrou"
        tom="text-emerald-600 dark:text-emerald-300" />

      <Agenda
        titulo="Saídas" dica="a agenda de compras e despesas — e o que dela já foi pago"
        linhas={saidas} jaFoi={pago} falta={aPagar}
        rotJa="Já saiu" rotFalta="Ainda não saiu"
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
