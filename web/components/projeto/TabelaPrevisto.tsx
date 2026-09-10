"use client";

// O fluxo que o Omie já sabe — e a coluna onde o cronograma corrige a data.
//
// ── O problema que resolve ───────────────────────────────────────────────────
// Na Brasterapica as previsões estavam todas em agosto e a nota nem tinha sido
// emitida. O painel mostrava tudo vermelho, e não havia onde dizer "a nota sai
// em 20/09". Consertar no Omie título a título é o que ninguém faz.
//
// ── A coluna que se preenche é a EMISSÃO ─────────────────────────────────────
// A previsão de recebimento sai de emissão + prazo do PV. Pedir as duas datas
// seria pedir para redigitar o prazo comercial, e a cópia divergiria do ERP no
// primeiro ajuste. A previsão manual fica disponível para o prazo que o sistema
// não lê e para parcelamento irregular.
//
// ── Não é editável fora disso, de propósito ──────────────────────────────────
// Valor, fornecedor e origem vêm do Omie e são recalculados a cada leitura.
// Deixar editar aqui criaria uma segunda verdade sobre o mesmo pedido.

import { useCallback, useState } from "react";

export type LinhaPrevisto = {
  parcela: number;
  parcelas_total: number;
  lado: "entrada" | "saida";
  fonte: "titulo_receber" | "pv_a_faturar" | "pedido_compra";
  referencia: string;
  descricao: string;
  valor: number;
  liquidado: number;
  situacao: string;
  data_omie: string | null;
  dt_emissao: string | null;
  prazo_dias: number | null;
  data_calculada: string | null;
  data_manual: string | null;
  data_efetiva: string | null;
  atraso_dias: number | null;
  data_baseline: string | null;
  desvio_dias: number | null;
};

const brl = (v: number) =>
  Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const dia = (s: string | null) => {
  if (!s) return "—";
  const [a, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${a.slice(2)}`;
};

const FONTE_ROT: Record<string, string> = {
  titulo_receber: "Título",
  pv_a_faturar:   "PV a faturar",
  pedido_compra:  "Pedido de compra",
};

const SITUACAO: Record<string, { rot: string; classe: string }> = {
  recebido:  { rot: "Recebido",  classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  pago:      { rot: "Pago",      classe: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  a_vencer:  { rot: "A vencer",  classe: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30" },
  a_faturar: { rot: "A faturar", classe: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30" },
  atrasado:  { rot: "Atrasado",  classe: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30" },
  sem_data:  { rot: "Sem data",  classe: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
};

export default function TabelaPrevisto({
  linhas, lado, empresa, codigoProjeto, podeEditar, onMudou,
}: {
  linhas: LinhaPrevisto[];
  lado: "entrada" | "saida";
  empresa: string;
  codigoProjeto: number;
  podeEditar: boolean;
  onMudou: () => void;
}) {
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const doLado = linhas.filter((l) => l.lado === lado);
  const total = doLado.reduce((a, l) => a + Number(l.valor || 0), 0);
  const atrasado = doLado.filter((l) => l.situacao === "atrasado")
                         .reduce((a, l) => a + Number(l.valor || 0), 0);
  const escorregou = doLado.filter((l) => (l.desvio_dias ?? 0) > 0);

  const gravar = useCallback(async (
    l: LinhaPrevisto,
    campo: "dt_emissao_prevista" | "dt_previsao_manual",
    valor: string,
  ) => {
    const chave = `${l.fonte}|${l.referencia}|${l.parcela}`;
    setSalvando(chave); setErro(null);
    try {
      const r = await fetch("/api/rc-projetos/fluxo/cronograma", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa, codigo_projeto: codigoProjeto,
          fonte: l.fonte, referencia: l.referencia, parcela: l.parcela ?? 0,
          // Manda os DOIS campos sempre: a rota apaga o ajuste quando os dois
          // vêm vazios, e mandar só um faria o outro sumir sem querer.
          dt_emissao_prevista: campo === "dt_emissao_prevista" ? valor || null : l.dt_emissao,
          dt_previsao_manual:  campo === "dt_previsao_manual"  ? valor || null : l.data_manual,
          prazo_dias_aplicado: l.prazo_dias,
        }),
      });
      const j = await r.json();
      if (!r.ok) { setErro(j.error ?? r.statusText); return; }
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally { setSalvando(null); }
  }, [empresa, codigoProjeto, onMudou]);

  if (!doLado.length) {
    return (
      <p className="text-[11.5px] text-ww-textFaint py-2">
        Nada {lado === "entrada" ? "a receber" : "a pagar"} veio do Omie para este projeto.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {erro && (
        <div className="p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-[11.5px] text-rose-700 dark:text-rose-300">
          {erro}
        </div>
      )}

      <div className="overflow-x-auto border border-ww-border rounded-lg">
        <table className="w-full text-[11.5px] border-collapse">
          <thead className="bg-ww-panel sticky top-0 z-10">
            <tr className="text-[10px] uppercase tracking-wider text-ww-textMuted">
              <th className="text-left  p-1.5 font-semibold w-[120px]">Origem</th>
              <th className="text-left  p-1.5 font-semibold min-w-[200px]">Quem</th>
              <th className="text-right p-1.5 font-semibold w-[110px]">Valor</th>
              <th className="text-left  p-1.5 font-semibold w-[92px]">No Omie</th>
              <th className="text-left  p-1.5 font-semibold w-[132px]">Emissão da NF</th>
              <th className="text-left  p-1.5 font-semibold w-[92px]">Nova previsão</th>
              <th className="text-left  p-1.5 font-semibold w-[96px]">Situação</th>
              <th className="text-right p-1.5 font-semibold w-[84px]">Desvio</th>
            </tr>
          </thead>
          <tbody>
            {doLado.map((l) => {
              const chave = `${l.fonte}|${l.referencia}|${l.parcela}`;
              const sit = SITUACAO[l.situacao] ?? SITUACAO.sem_data;
              const ajustada = !!l.dt_emissao || !!l.data_manual;
              return (
                <tr key={chave} className="viz-row">
                  <td className="p-1.5 border-b border-ww-border/50 text-ww-textMuted whitespace-nowrap">
                    {FONTE_ROT[l.fonte]}
                    <span className="ml-1 font-mono text-[10px] text-ww-textFaint">{l.referencia}</span>
                  </td>
                  <td className="p-1.5 border-b border-ww-border/50 text-ww-text truncate max-w-[280px]"
                      title={l.descricao}>{l.descricao}</td>
                  <td className="p-1.5 border-b border-ww-border/50 text-right tabular-nums text-ww-text">
                    {brl(l.valor)}
                  </td>
                  {/* A data do ERP fica visível mesmo depois de ajustada: é
                      contra ela que se enxerga o tamanho da correção. */}
                  <td className={`p-1.5 border-b border-ww-border/50 tabular-nums ${
                    ajustada ? "text-ww-textFaint line-through" : "text-ww-textMuted"}`}>
                    {dia(l.data_omie)}
                  </td>
                  <td className="p-1 border-b border-ww-border/50">
                    {podeEditar ? (
                      <div className="flex items-center gap-1">
                        <input type="date" defaultValue={l.dt_emissao ?? ""}
                          onBlur={(e) => {
                            if ((e.target.value || null) !== (l.dt_emissao ?? null)) {
                              void gravar(l, "dt_emissao_prevista", e.target.value);
                            }
                          }}
                          title="Quando a nota vai ser emitida, pelo cronograma"
                          className="w-[112px] bg-transparent px-1 py-1 text-[11px] text-ww-text rounded
                                     border border-transparent hover:border-ww-border
                                     focus:border-ww-accent focus:bg-ww-accentSoft outline-none" />
                        {salvando === chave && <span className="text-[10px] text-ww-textFaint">…</span>}
                      </div>
                    ) : <span className="px-1.5 text-ww-textMuted tabular-nums">{dia(l.dt_emissao)}</span>}
                  </td>
                  {/* Calculada, não digitada — e o prazo aparece pra conta não
                      ser mágica. */}
                  <td className="p-1.5 border-b border-ww-border/50 tabular-nums">
                    {l.data_efetiva ? (
                      <span className={ajustada ? "text-ww-accent font-semibold" : "text-ww-text"}>
                        {dia(l.data_efetiva)}
                        {l.dt_emissao && l.prazo_dias != null && !l.data_manual && (
                          <span className="block text-[9.5px] text-ww-textFaint font-normal">
                            +{l.prazo_dias}d
                          </span>
                        )}
                      </span>
                    ) : <span className="text-ww-textFaint">—</span>}
                  </td>
                  <td className="p-1.5 border-b border-ww-border/50">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${sit.classe}`}>
                      {sit.rot}
                    </span>
                    {l.atraso_dias != null && (
                      <span className="ml-1 text-[10px] text-rose-500 tabular-nums">{l.atraso_dias}d</span>
                    )}
                  </td>
                  {/* Desvio só existe depois de uma aprovação: sem foto
                      congelada não há contra o que medir, e um zero ali
                      mentiria dizendo "não mudou nada". */}
                  <td className="p-1.5 border-b border-ww-border/50 text-right tabular-nums">
                    {l.desvio_dias == null ? (
                      <span className="text-ww-textFaint" title="Sem plano aprovado para comparar">—</span>
                    ) : l.desvio_dias === 0 ? (
                      <span className="text-ww-textMuted">no prazo</span>
                    ) : (
                      <span className={l.desvio_dias > 0
                        ? "text-rose-600 dark:text-rose-400 font-semibold"
                        : "text-emerald-600 dark:text-emerald-400 font-semibold"}
                        title={`Aprovado para ${dia(l.data_baseline)}`}>
                        {l.desvio_dias > 0 ? "+" : ""}{l.desvio_dias}d
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-ww-panel">
            <tr className="border-t border-ww-borderStrong">
              <td className="p-1.5 font-bold text-ww-text" colSpan={2}>
                {doLado.length} do Omie
              </td>
              <td className="p-1.5 text-right font-bold tabular-nums text-ww-text">{brl(total)}</td>
              <td colSpan={5} className="p-1.5 text-[10.5px] text-ww-textMuted">
                {atrasado > 0 && (
                  <span className="text-rose-600 dark:text-rose-400">
                    {brl(atrasado)} com data já vencida
                  </span>
                )}
                {escorregou.length > 0 && (
                  <span className="ml-2">
                    · {escorregou.length} linha(s) escorregaram desde a aprovação
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
