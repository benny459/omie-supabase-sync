"use client";

/**
 * Chip "N PC escondido(s)" + modal para trazer de volta.
 *
 * Esconder um PC é reversível por desenho (só marca em platform.excluded_pc),
 * mas reversível sem botão não vale nada: ninguém esconde nada se não souber
 * como desfazer. Este é o botão.
 *
 * Componente controlado: quem chama passa a lista já filtrada. Assim o mesmo
 * componente serve o chip global do topo e o chip de cada projeto, sem cada
 * card ir buscar a lista por conta própria.
 */

import { useState } from "react";

export type PcEscondido = {
  empresa: string;
  pc_numero: string;
  motivo: string | null;
  excluded_at: string;
  excluded_by: string | null;
  /** Todos os projetos onde este PC aparecia. Pode ser mais de um. */
  projetos?: string[];
  valor_total?: number | null;
};

const brl = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function PcsExcluidosButton({
  linhas,
  titulo = "Pedidos de compra escondidos",
  compacto = false,
  onMudou,
}: {
  linhas: PcEscondido[];
  titulo?: string;
  /** true no chip de um projeto: menor, sem a palavra "PC" repetida. */
  compacto?: boolean;
  onMudou: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function chamar(empresa: string, pcs: string[], marca: string) {
    setErro(null);
    setOcupado(marca);
    try {
      const r = await fetch("/api/pcs/excluir", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", empresa, pcs }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error ?? r.statusText); setOcupado(null); return false; }
      return true;
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setOcupado(null);
      return false;
    }
  }

  async function restaurarUm(e: PcEscondido) {
    const ok = await chamar(e.empresa, [e.pc_numero], `${e.empresa}|${e.pc_numero}`);
    // Reload duro: a grade é buscada no client e o PC tem de reaparecer nela.
    if (ok) { onMudou(); window.location.reload(); }
  }

  /* Restaurar tudo de uma vez fica atrás de confirmação: é a tecla que desfaz
     o trabalho de quem limpou a vista, e deve custar a carregar. */
  async function restaurarTodos() {
    const porEmpresa = new Map<string, string[]>();
    for (const l of linhas) {
      const atual = porEmpresa.get(l.empresa) ?? [];
      atual.push(l.pc_numero);
      porEmpresa.set(l.empresa, atual);
    }
    const resumo = [...porEmpresa.entries()].map(([e, p]) => `${e}: ${p.length}`).join(" · ");
    if (!confirm(
      `Trazer de volta ${linhas.length} pedido(s) de compra?\n\n${resumo}\n\n`
      + `Voltam à grade e aos totais.`
    )) return;
    for (const [empresa, pcs] of porEmpresa) {
      const ok = await chamar(empresa, pcs, "__todos__");
      if (!ok) return;
    }
    onMudou();
    window.location.reload();
  }

  if (linhas.length === 0) return null;

  const dataCurta = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
  };

  return (
    <>
      <button
        onClick={(ev) => { ev.stopPropagation(); setAberto(true); }}
        title="Pedidos de compra escondidos — clique para trazer de volta"
        className={`rounded-full font-semibold border border-amber-400/60 text-amber-600 dark:text-amber-300 hover:bg-amber-500 hover:text-white transition ${
          compacto ? "px-1.5 py-px text-[10px] uppercase tracking-[0.3px]" : "px-2 py-0.5 text-[11px]"
        }`}>
        🚫 {linhas.length}{compacto ? " escondido" + (linhas.length !== 1 ? "s" : "") : ` PC escondido${linhas.length !== 1 ? "s" : ""}`}
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={() => setAberto(false)}>
          <div onClick={(ev) => ev.stopPropagation()}
               className="bg-ww-panel rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-start justify-between p-5 pb-3">
              <div>
                <h3 className="font-semibold text-ww-text">{titulo}</h3>
                <p className="text-xs text-ww-textMuted mt-0.5">
                  Saíram da vista e dos totais. O dado continua no Omie — trazer de volta é imediato.
                </p>
              </div>
              <button onClick={() => setAberto(false)}
                      className="text-ww-textFaint hover:text-ww-text text-lg leading-none">×</button>
            </div>

            {erro && (
              <div className="mx-5 mb-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                {erro}
              </div>
            )}

            <div className="overflow-y-auto px-5 pb-5">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-ww-panel">
                  <tr className="text-ww-textMuted text-left">
                    <th className="py-1.5 pr-3 font-semibold">PC</th>
                    {/* A coluna serve as duas origens: um PC de projeto traz o
                        nome do projeto, um de venda avulsa traz o PV/OS. */}
                    <th className="py-1.5 pr-3 font-semibold">Projeto · PV/OS</th>
                    <th className="py-1.5 pr-3 font-semibold text-right">Valor</th>
                    <th className="py-1.5 pr-3 font-semibold">Motivo</th>
                    <th className="py-1.5 pr-3 font-semibold">Quando</th>
                    <th className="py-1.5 font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((e) => {
                    const chave = `${e.empresa}|${e.pc_numero}`;
                    return (
                      <tr key={chave} className="border-t border-ww-border">
                        <td className="py-1.5 pr-3 font-mono text-ww-text">{e.pc_numero}</td>
                        <td className="py-1.5 pr-3 text-ww-textMuted">{e.projetos?.length ? e.projetos.join(" · ") : "—"}</td>
                        <td className="py-1.5 pr-3 text-ww-textMuted tabular-nums text-right">{brl(e.valor_total)}</td>
                        <td className="py-1.5 pr-3 text-ww-textMuted">{e.motivo || "—"}</td>
                        <td className="py-1.5 pr-3 text-ww-textMuted tabular-nums">{dataCurta(e.excluded_at)}</td>
                        <td className="py-1.5 text-right">
                          <button
                            disabled={ocupado != null}
                            onClick={() => restaurarUm(e)}
                            className="px-2.5 py-1 text-[11px] font-semibold border border-emerald-400/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white rounded-md transition disabled:opacity-40 whitespace-nowrap">
                            {ocupado === chave ? "Trazendo…" : "↩ Trazer de volta"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-ww-border">
              <span className="text-[11px] text-ww-textMuted">
                {linhas.length} escondido{linhas.length !== 1 ? "s" : ""}
              </span>
              <button
                disabled={ocupado != null}
                onClick={restaurarTodos}
                className="px-3 py-1.5 text-[11px] font-semibold text-ww-textMuted border border-ww-border rounded-md hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition disabled:opacity-40">
                {ocupado === "__todos__" ? "Trazendo todos…" : "↩ Trazer todos de volta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
