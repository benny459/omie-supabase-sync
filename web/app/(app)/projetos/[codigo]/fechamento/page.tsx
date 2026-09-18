// /projetos/[codigo]/fechamento — o resumo do fechamento vindo do CRM.
// Acessada pelo botão "Fechamento CRM" no bucket do /projetos. Mostra o que
// foi confirmado ao ganhar a proposta linkada a este projeto e oferece o
// CP/MC Excel para download — é a porta da engenharia de planejamento, sem
// precisar de acesso ao CRM.

import Link from "next/link";
import { fetchFechamentosDoProjeto, cpmcExiste, type FechamentoCrm } from "@/lib/crm-fechamento";

export const dynamic = "force-dynamic";

type Params = { codigo: string };

const dt = (iso?: string) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso)
    ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR")
    : "—";
const brl = (v?: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function LinhaKV({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-ww-border/60 last:border-0">
      <span className="text-[12px] text-ww-muted shrink-0">{k}</span>
      <span className="text-right">
        <span className="text-[13px] font-semibold">{v}</span>
        {sub ? <span className="block text-[11px] text-ww-muted">{sub}</span> : null}
      </span>
    </div>
  );
}

function CartaoFechamento({ f, temCpmc }: { f: FechamentoCrm; temCpmc: boolean }) {
  const rec = f.recebimento;
  const cf = rec.confirmacoes || {};
  const conta = (v: boolean | undefined, sim: string, nao: string) =>
    v == null ? "— não confirmado —" : v ? sim : nao;
  const parcelas = rec.parcelas || [];
  return (
    <div className="bg-ww-panel border-2 border-ww-borderStrong rounded-[12px] overflow-hidden shadow-md">
      <div className="px-5 py-3 border-b border-ww-border bg-ww-bg/60 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[15px] font-bold">🏆 {f.numero}</div>
          <div className="text-[12px] text-ww-muted">
            {f.cliente || "—"} · {brl(rec.valorTotal ?? f.valor)}
            {rec.confirmadoPor ? ` · confirmado por ${rec.confirmadoPor}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {temCpmc ? (
            <a href={f.cpmcUrl} download
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-bold border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition">
              ▦ Baixar CP/MC Excel
            </a>
          ) : (
            <span className="text-[11px] text-ww-muted border border-ww-border rounded-md px-2.5 py-1.5"
              title="O arquivo sobe quando o fechamento é salvo no CRM (ou ao gerar o CP/MC por lá)">
              CP/MC ainda não publicado pelo CRM
            </span>
          )}
          <a href={f.crmUrl} target="_blank" rel="noreferrer"
            className="text-[11.5px] text-sky-700 dark:text-sky-300 underline">
            abrir no CRM ↗
          </a>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-x-8 gap-y-2 px-5 py-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-ww-muted mb-1">Projeto</div>
          <LinhaKV k="Início oficial" v={dt(rec.inicioProjeto)}
            sub="Data-base: entrega, etapas e saídas contam daqui" />
          <LinhaKV k="Prazo de entrega" v={rec.entregaPrazoDias ? `${rec.entregaPrazoDias} dias` : "—"}
            sub={rec.entregaPrevista ? `Entrega prevista: ${dt(rec.entregaPrevista)}` : undefined} />
          <LinhaKV k="Mão de obra sai em" v={`${rec.saidaDias?.maoObra ?? 0} dias após o início`} />
          <LinhaKV k="Despesas saem em" v={`${rec.saidaDias?.despesas ?? 0} dias após o início`} />
          <div className="text-[11px] font-bold uppercase tracking-wide text-ww-muted mt-3 mb-1">Por conta de quem</div>
          <LinhaKV k="Frete" v={conta(cf.frete, "Por nossa conta", "Por conta do cliente")} />
          <LinhaKV k="Deslocamento e estadia" v={conta(cf.deslocamento, "Por nossa conta", "Por conta do cliente")} />
          <LinhaKV k="Instalação" v={conta(cf.instalacao, "Inclusa", "Não inclusa")} />
          <LinhaKV k="Impostos" v={conta(cf.impostos, "Inclusos no valor", "Por fora")} />
        </div>
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-ww-muted mb-1">
            Recebimento — {rec.pagamentoDias ?? 0} dias do faturamento ao pagamento
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-ww-muted">
                <th className="py-1 font-semibold">%</th>
                <th className="py-1 font-semibold">Evento</th>
                <th className="py-1 font-semibold">NF</th>
                <th className="py-1 font-semibold text-right">Faturamento</th>
                <th className="py-1 font-semibold text-right">Pagamento</th>
                <th className="py-1 font-semibold text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {parcelas.map((p, i) => (
                <tr key={i} className="border-t border-ww-border/60">
                  <td className="py-1">{p.pct}%</td>
                  <td className="py-1">{p.evento || "—"}</td>
                  <td className="py-1">{p.tipo === "mercantil" ? "Mercantil" : p.tipo === "servico" ? "Serviço" : "—"}</td>
                  <td className="py-1 text-right">{dt(p.faturamento || p.previsao)}</td>
                  <td className="py-1 text-right font-semibold">{dt(p.previsao)}</td>
                  <td className="py-1 text-right">{brl((Number(rec.valorTotal ?? f.valor) || 0) * (Number(p.pct) || 0) / 100)}</td>
                </tr>
              ))}
              {!parcelas.length && (
                <tr><td colSpan={6} className="py-2 text-ww-muted">Sem parcelas lançadas.</td></tr>
              )}
            </tbody>
          </table>
          <p className="text-[11px] text-ww-muted mt-2">
            O pagamento é a data que entra no fluxo de caixa — o cliente paga
            {" "}{rec.pagamentoDias ?? 0} dias depois de faturado.
          </p>
        </div>
      </div>
    </div>
  );
}

export default async function ProjetoFechamentoPage({ params }: { params: Promise<Params> }) {
  const { codigo } = await params;
  const codigoProjeto = Number(codigo);
  if (!Number.isFinite(codigoProjeto) || codigoProjeto <= 0) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-rose-700">Código de projeto inválido.</p>
        <Link href="/projetos" className="text-sky-700 underline text-sm">← Voltar para Projetos</Link>
      </div>
    );
  }

  let fechamentos: FechamentoCrm[] = [];
  let erro = "";
  try {
    fechamentos = await fetchFechamentosDoProjeto(codigoProjeto);
  } catch (e) {
    erro = e instanceof Error ? e.message : String(e);
  }
  const existencia = await Promise.all(fechamentos.map((f) => cpmcExiste(f.cpmcUrl)));

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-4">
      <div className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[18px] font-bold">Fechamento do CRM</h1>
          <p className="text-[12px] text-ww-muted">
            O que foi confirmado ao ganhar a proposta linkada a este projeto — e o CP/MC Excel para o planejamento.
          </p>
        </div>
        <Link href="/projetos" className="text-sky-700 dark:text-sky-300 underline text-sm">← Voltar para Projetos</Link>
      </div>

      {erro && (
        <div className="border border-rose-300 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 rounded-md px-4 py-3 text-[13px]">
          Não consegui falar com o CRM: {erro}
        </div>
      )}
      {!erro && !fechamentos.length && (
        <div className="border border-ww-border bg-ww-panel rounded-md px-4 py-4 text-[13px] text-ww-muted">
          Nenhuma proposta do CRM está linkada a este projeto ainda. O link é
          feito no CRM, no <strong>resumo do fechamento</strong> da proposta
          (campo &quot;Projeto no painel&quot;) — feito isso, o resumo e o
          download aparecem aqui na hora.
        </div>
      )}
      {fechamentos.map((f, i) => (
        <CartaoFechamento key={f.numero} f={f} temCpmc={existencia[i]} />
      ))}
    </div>
  );
}
