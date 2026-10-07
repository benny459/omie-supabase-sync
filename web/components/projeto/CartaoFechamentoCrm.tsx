// O cartão do fechamento vindo do CRM. Componente puro (sem estado): serve
// à página /projetos/[codigo]/fechamento, renderizada no servidor, e ao bloco
// do workspace, que busca pelo /api/crm-fechamento no cliente. Um desenho só
// para os dois — duplicar o JSX era garantir que um deles ficaria para trás.
//
// 07/10/26 (Benny): o Resumo do projeto passou a ser SÓ este cartão, e ele foi
// redesenhado em blocos — título maior (proposta, cliente e valor em destaque) e
// quatro cartões em grade responsiva: Projeto, Por conta de quem (selos),
// Custos considerados (com a barra de composição) e Recebimento (parcelas).
// Toda a informação de antes continua aqui.
import type { FechamentoCrm } from "@/lib/crm-fechamento";

const dt = (iso?: string) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso)
    ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR")
    : "—";
const brl = (v?: number) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Linha chave → valor. Exportada: outras telas a usam. */
function LinhaKV({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-ww-border/60 last:border-0">
      <span className="text-[12px] text-ww-textMuted shrink-0">{k}</span>
      <span className="text-right min-w-0">
        <span className="text-[13px] font-semibold text-ww-text tabular-nums">{v}</span>
        {sub ? <span className="block text-[11px] text-ww-textFaint">{sub}</span> : null}
      </span>
    </div>
  );
}

function Bloco({ titulo, dica, children, className = "" }: {
  titulo: string; dica?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-xl border border-ww-border bg-ww-panel p-4 min-w-0 ${className}`}>
      <header className="mb-2.5">
        <h3 className="text-[10.5px] font-bold uppercase tracking-[0.7px] text-ww-textFaint">{titulo}</h3>
        {dica && <p className="text-[11px] text-ww-textMuted mt-0.5">{dica}</p>}
      </header>
      {children}
    </section>
  );
}

/** Selo de "por conta de quem": nossa conta pesa no custo, por isso tem cor. */
function Selo({ rot, v, sim, nao }: { rot: string; v: boolean | undefined; sim: string; nao: string }) {
  const estilo = v == null
    ? "border-dashed border-ww-border text-ww-textFaint"
    : v ? "border-amber-400/60 bg-amber-500/10 text-amber-800 dark:text-amber-200"
        : "border-ww-border bg-ww-rowHover/60 text-ww-textMuted";
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12px] text-ww-text">{rot}</span>
      <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${estilo}`}>
        {v == null ? "não confirmado" : v ? sim : nao}
      </span>
    </div>
  );
}

export function CartaoFechamento({ f, temCpmc }: { f: FechamentoCrm; temCpmc: boolean }) {
  const rec = f.recebimento;
  const cu = f.custos;
  const cf = rec.confirmacoes || {};
  const parcelas = rec.parcelas || [];
  const total = Number(rec.valorTotal ?? f.valor) || 0;
  const demais = Math.max(0, cu.despesas - cu.frete);
  const totalSaidas = cu.material + cu.maoDeObra + cu.despesas;
  const temCustos = cu.material > 0 || cu.maoDeObra > 0 || cu.despesas > 0;
  /* Composição das saídas: materiais, mão de obra, frete e o resto das despesas. */
  const partes = [
    { rot: "Materiais (RC)", v: cu.material, cor: "bg-sky-500" },
    { rot: "Mão de obra", v: cu.maoDeObra, cor: "bg-violet-500" },
    { rot: "Frete", v: cu.frete, cor: "bg-amber-500" },
    { rot: "Demais despesas", v: demais, cor: "bg-rose-400" },
  ].filter((p) => p.v > 0);

  return (
    <div className="space-y-3">
      {/* ── Cabeçalho: proposta, cliente e valor ───────────────────────────── */}
      <div className="rounded-xl border border-ww-borderStrong bg-ww-panel px-4 sm:px-5 py-4 shadow-sm">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10.5px] font-bold uppercase tracking-[0.7px] text-ww-textFaint">Fechamento do CRM</span>
              <span className="font-mono text-[12px] font-semibold px-1.5 py-0.5 rounded bg-ww-accentSoft text-ww-accentText">{f.numero}</span>
              {f.status && <span className="text-[11px] text-ww-textMuted">{f.status}</span>}
            </div>
            <h2 className="mt-1 text-[20px] sm:text-[22px] font-semibold text-ww-text tracking-[-0.01em] truncate">
              {f.cliente || "—"}
            </h2>
            {rec.confirmadoPor && (
              <p className="text-[11.5px] text-ww-textMuted mt-0.5">
                Confirmado por {rec.confirmadoPor}{dt(rec.confirmadoEm) !== "—" ? ` em ${dt(rec.confirmadoEm)}` : ""}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.7px] text-ww-textFaint">Valor fechado</div>
            <div className="text-[26px] sm:text-[30px] font-bold tabular-nums text-ww-text leading-tight">{brl(total)}</div>
            {temCustos && total > 0 && (
              <div className="text-[11.5px] tabular-nums text-ww-textMuted">
                saídas previstas {brl(totalSaidas)} · sobra{" "}
                <strong className={total - totalSaidas >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}>
                  {brl(total - totalSaidas)}
                </strong>
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 flex-wrap">
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

      {/* ── Blocos ─────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Bloco titulo="Projeto" dica="a data-base conta tudo: entrega, etapas e saídas">
          <LinhaKV k="Início oficial" v={dt(rec.inicioProjeto)} sub="data-base do projeto" />
          <LinhaKV k="Prazo de entrega" v={rec.entregaPrazoDias ? `${rec.entregaPrazoDias} dias` : "—"} />
          <LinhaKV k="Entrega prevista" v={dt(rec.entregaPrevista)} />
          <LinhaKV k="Mão de obra sai em" v={`${rec.saidaDias?.maoObra ?? 0} dias após o início`} />
          <LinhaKV k="Despesas saem em" v={`${rec.saidaDias?.despesas ?? 0} dias após o início`} />
        </Bloco>

        <Bloco titulo="Por conta de quem" dica="o que é por nossa conta entra no custo">
          <div className="divide-y divide-ww-border/60">
            <Selo rot="Frete" v={cf.frete} sim="Nossa conta" nao="Cliente" />
            <Selo rot="Deslocamento e estadia" v={cf.deslocamento} sim="Nossa conta" nao="Cliente" />
            <Selo rot="Instalação" v={cf.instalacao} sim="Inclusa" nao="Não inclusa" />
            <Selo rot="Impostos" v={cf.impostos} sim="Inclusos no valor" nao="Por fora" />
          </div>
        </Bloco>

        <Bloco titulo="Custos considerados" dica="o resumo do CP/MC — o detalhe item a item está no Excel"
          className="md:col-span-2 xl:col-span-1">
          {!temCustos ? (
            <p className="text-[12px] text-ww-textFaint">O fechamento não trouxe custos.</p>
          ) : (
            <>
              {totalSaidas > 0 && (
                <div className="mb-2">
                  <div className="flex h-2.5 rounded-full overflow-hidden bg-ww-track" role="img"
                    aria-label={partes.map((p) => `${p.rot} ${Math.round((p.v / totalSaidas) * 100)}%`).join(", ")}>
                    {partes.map((p) => (
                      <span key={p.rot} className={p.cor} style={{ width: `${(p.v / totalSaidas) * 100}%` }}
                        title={`${p.rot}: ${brl(p.v)} (${Math.round((p.v / totalSaidas) * 100)}%)`} />
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-ww-textMuted">
                    {partes.map((p) => (
                      <span key={p.rot} className="inline-flex items-center gap-1">
                        <i className={`inline-block w-2 h-2 rounded-sm ${p.cor}`} />{p.rot} {Math.round((p.v / totalSaidas) * 100)}%
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {cu.material > 0 && <LinhaKV k="Materiais e equipamentos (RC)" v={brl(cu.material)} />}
              {cu.maoDeObra > 0 && (
                <LinhaKV k="Mão de obra" v={brl(cu.maoDeObra)}
                  sub={cu.diarias > 0
                    ? `${cu.tecnicos} técnico(s) · ${cu.diarias} diária(s)`
                      + (cu.sabados || cu.domingos ? ` — ${cu.sabados} sáb, ${cu.domingos} dom` : "")
                    : undefined} />
              )}
              {cu.frete > 0 && (
                <LinhaKV k="Frete estimado" v={brl(cu.frete)}
                  sub={cu.freteViagens > 0 ? `${cu.freteViagens} viagem(ns) — por nossa conta só se confirmado` : undefined} />
              )}
              {cu.despesas > 0 && (
                <LinhaKV k="Demais despesas" v={brl(demais)} sub="estadia, passagens, locação, alimentação…" />
              )}
              <div className="flex items-baseline justify-between gap-4 pt-2 mt-1 border-t border-ww-borderStrong">
                <span className="text-[12px] font-semibold text-ww-text">Total de saídas previsto</span>
                <span className="text-[15px] font-bold tabular-nums text-ww-text">{brl(totalSaidas)}</span>
              </div>
            </>
          )}
        </Bloco>

        <Bloco titulo={`Recebimento — ${rec.pagamentoDias ?? 0} dias do faturamento ao pagamento`}
          dica="o pagamento é a data que entra no fluxo de caixa"
          className="md:col-span-2 xl:col-span-3">
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full text-[12.5px] min-w-[520px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-ww-textFaint border-b border-ww-border">
                  <th className="py-1.5 font-semibold w-[56px]">%</th>
                  <th className="py-1.5 font-semibold">Evento</th>
                  <th className="py-1.5 font-semibold w-[90px]">NF</th>
                  <th className="py-1.5 font-semibold text-right w-[230px]">Faturamento → pagamento</th>
                  <th className="py-1.5 font-semibold text-right w-[130px]">Valor</th>
                </tr>
              </thead>
              <tbody>
                {parcelas.map((p, i) => (
                  <tr key={i} className="border-b border-ww-border/50 last:border-0">
                    <td className="py-1.5 tabular-nums font-semibold text-ww-text">{p.pct}%</td>
                    <td className="py-1.5 text-ww-text">{p.evento || "—"}</td>
                    <td className="py-1.5">
                      {p.tipo ? (
                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10.5px] font-semibold bg-ww-rowHover text-ww-textMuted">
                          {p.tipo === "mercantil" ? "Mercantil" : "Serviço"}
                        </span>
                      ) : <span className="text-ww-textFaint">—</span>}
                    </td>
                    <td className="py-1.5 text-right tabular-nums whitespace-nowrap">
                      <span className="text-ww-textMuted">{dt(p.faturamento || p.previsao)}</span>
                      <span className="mx-1.5 text-ww-textFaint">→</span>
                      <span className="font-semibold text-ww-text">{dt(p.previsao)}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums font-semibold text-ww-text">
                      {brl(total * (Number(p.pct) || 0) / 100)}
                    </td>
                  </tr>
                ))}
                {!parcelas.length && (
                  <tr><td colSpan={5} className="py-2 text-ww-textMuted">Sem parcelas lançadas.</td></tr>
                )}
              </tbody>
              {parcelas.length > 0 && (
                <tfoot>
                  <tr className="border-t border-ww-borderStrong">
                    <td className="pt-1.5 tabular-nums font-semibold text-ww-textMuted">
                      {parcelas.reduce((a, p) => a + (Number(p.pct) || 0), 0)}%
                    </td>
                    <td colSpan={3} className="pt-1.5 text-[11px] text-ww-textFaint">
                      O cliente paga {rec.pagamentoDias ?? 0} dias depois de faturado.
                    </td>
                    <td className="pt-1.5 text-right tabular-nums font-bold text-ww-text">{brl(total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Bloco>
      </div>
    </div>
  );
}

export default CartaoFechamento;
export { LinhaKV, dt, brl };
