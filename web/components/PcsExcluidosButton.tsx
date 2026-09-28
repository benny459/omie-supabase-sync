"use client";

/**
 * "N PC escondidos" — a porta de volta da exclusão de pedido de compra.
 *
 * Esconder um PC é reversível por desenho (só marca em platform.excluded_pc),
 * mas reversível sem botão não vale nada: ninguém esconde nada se não souber
 * como trazer de volta. Este é o botão.
 *
 * Só aparece quando há algo escondido — sem exclusões, não ocupa espaço.
 */

import { useCallback, useEffect, useState } from "react";

type Escondido = {
  empresa: string;
  pc_numero: string;
  motivo: string | null;
  excluded_at: string;
  excluded_by: string | null;
};

export default function PcsExcluidosButton() {
  const [linhas, setLinhas] = useState<Escondido[]>([]);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch("/api/pcs/excluir", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setLinhas((j.rows ?? []) as Escondido[]);
    } catch { /* silencioso: é um extra, não pode derrubar a página */ }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function restaurar(e: Escondido) {
    setErro(null);
    setOcupado(`${e.empresa}|${e.pc_numero}`);
    try {
      const r = await fetch("/api/pcs/excluir", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", empresa: e.empresa, pcs: [e.pc_numero] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error ?? r.statusText); setOcupado(null); return; }
      // Reload duro: a lista é buscada no client e o PC tem de reaparecer na grade.
      window.location.reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setOcupado(null);
    }
  }

  /* Restaurar tudo de uma vez. Fica dentro do modal e atrás de confirmação de
     propósito: é a tecla que desfaz o trabalho de muita gente, e deve custar
     a carregar. Uma empresa de cada vez, que é como a API aceita. */
  async function restaurarTodos() {
    const porEmpresa = new Map<string, string[]>();
    for (const l of linhas) {
      const atual = porEmpresa.get(l.empresa) ?? [];
      atual.push(l.pc_numero);
      porEmpresa.set(l.empresa, atual);
    }
    const resumo = [...porEmpresa.entries()]
      .map(([emp, pcs]) => `${emp}: ${pcs.length}`).join(" · ");
    if (!confirm(
      `Trazer de volta TODOS os ${linhas.length} pedidos de compra escondidos?\n\n`
      + `${resumo}\n\nEles voltam à grade e aos totais dos projetos.`
    )) return;
    setErro(null);
    setOcupado("__todos__");
    try {
      for (const [empresa, pcs] of porEmpresa) {
        const r = await fetch("/api/pcs/excluir", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore", empresa, pcs }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setErro(`${empresa}: ${j.error ?? r.statusText}`);
          setOcupado(null);
          return;
        }
      }
      window.location.reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
      setOcupado(null);
    }
  }

  if (linhas.length === 0) return null;

  const dataCurta = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
  };

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        title="Pedidos de compra escondidos do painel — clique para trazer de volta"
        className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-amber-400/60 text-amber-600 dark:text-amber-300 hover:bg-amber-500 hover:text-white transition">
        🚫 {linhas.length} PC escondido{linhas.length !== 1 ? "s" : ""}
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
             onClick={() => setAberto(false)}>
          <div onClick={(ev) => ev.stopPropagation()}
               className="bg-ww-panel rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-start justify-between p-5 pb-3">
              <div>
                <h3 className="font-semibold text-ww-text">Pedidos de compra escondidos</h3>
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
                    <th className="py-1.5 pr-3 font-semibold">Empresa</th>
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
                        <td className="py-1.5 pr-3 text-ww-textMuted">{e.empresa}</td>
                        <td className="py-1.5 pr-3 text-ww-textMuted">{e.motivo || "—"}</td>
                        <td className="py-1.5 pr-3 text-ww-textMuted tabular-nums">{dataCurta(e.excluded_at)}</td>
                        <td className="py-1.5 text-right">
                          <button
                            disabled={ocupado === chave}
                            onClick={() => restaurar(e)}
                            className="px-2.5 py-1 text-[11px] font-semibold border border-emerald-400/60 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600 hover:text-white rounded-md transition disabled:opacity-40">
                            {ocupado === chave ? "Trazendo…" : "↩ Trazer de volta"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Rodapé: a ação em massa vive aqui, discreta e com confirmação. */}
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
