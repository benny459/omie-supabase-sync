// O cartão do fechamento vindo do CRM. Componente puro (sem estado): serve
// à página /projetos/[codigo]/fechamento, renderizada no servidor, e ao bloco
// do workspace, que busca pelo /api/crm-fechamento no cliente. Um desenho só
// para os dois — duplicar o JSX era garantir que um deles ficaria para trás.
import type { FechamentoCrm } from "@/lib/crm-fechamento";

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

export function CartaoFechamento({ f, temCpmc }: { f: FechamentoCrm; temCpmc: boolean }) {
  const rec = f.recebimento;
  const cu = f.custos;
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
          {temCpmc && (
            <a href={f.cpmcUrl} download
              title="Última versão publicada pelo CRM"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-bold border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition">
              ▦ Baixar CP/MC Excel
            </a>
          )}
          <a href={f.gerarUrl}
            title="Gera o CP/MC agora, direto do fechamento gravado no CRM — o mesmo arquivo do botão de lá (leva alguns segundos)"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-bold border border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition">
            ⟳ {temCpmc ? "Gerar atualizado" : "Gerar CP/MC agora"}
          </a>
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

          {/* Diretriz de custos da proposta — o resumo do que a planilha
              detalha, para se ter o todo antes de baixar o arquivo. */}
          {(cu.material > 0 || cu.maoDeObra > 0 || cu.despesas > 0) && (
            <>
              <div className="text-[11px] font-bold uppercase tracking-wide text-ww-muted mt-3 mb-1">
                Custos considerados na proposta
              </div>
              {cu.material > 0 && (
                <LinhaKV k="Materiais e equipamentos (CP)" v={brl(cu.material)} />
              )}
              {cu.maoDeObra > 0 && (
                <LinhaKV k="Mão de obra" v={brl(cu.maoDeObra)}
                  sub={cu.diarias > 0
                    ? `${cu.tecnicos} técnico(s) · ${cu.diarias} diária(s)`
                      + (cu.sabados || cu.domingos ? ` — ${cu.sabados} sáb, ${cu.domingos} dom` : "")
                    : undefined} />
              )}
              {cu.frete > 0 && (
                <LinhaKV k="Frete estimado" v={brl(cu.frete)}
                  sub={cu.freteViagens > 0 ? `${cu.freteViagens} viagem(ns) — por nossa conta só se confirmado acima` : undefined} />
              )}
              {cu.despesas > 0 && (
                <LinhaKV k="Demais despesas estimadas" v={brl(Math.max(0, cu.despesas - cu.frete))}
                  sub="Estadia, passagens, locação, alimentação…" />
              )}
              <LinhaKV k="Total de saídas previsto" v={brl(cu.material + cu.maoDeObra + cu.despesas)}
                sub="O detalhe, item a item e no tempo, está no CP/MC Excel" />
            </>
          )}
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

export default CartaoFechamento;
export { LinhaKV, dt, brl };
