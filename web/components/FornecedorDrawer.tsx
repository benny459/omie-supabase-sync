"use client";

/**
 * Retrato de um fornecedor, aberto ao lado da lista de Contas a Pagar.
 *
 * A pergunta que responde é "como é trabalhar com este?", e isso não se lê
 * numa janela de 90 dias — por isso o histórico é inteiro. Sai da mesma view
 * que a grade, então os números batem com o que está na tela atrás.
 */

import { useEffect, useState } from "react";

type Resumo = {
  titulos: number;
  total: number;
  em_aberto: number; qtd_aberto: number;
  vencido: number; qtd_vencido: number;
  pago: number; qtd_pago: number;
  ticket_medio: number;
  primeiro_titulo: string | null;
  ultimo_titulo: string | null;
  atraso_medio_dias: number | null;
  pontualidade_pct: number | null;
  base_pontualidade: number;
};
type Linha = {
  cod_titulo: number;
  vencimento: string | null;
  pagamento: string | null;
  valor_documento: number | string | null;
  val_aberto: number | string | null;
  status_titulo: string | null;
  categoria: string | null;
  projeto: string | null;
  num_titulo: string | null;
};
type Resp = {
  fornecedor: { cod: number; nome: string | null; razao: string | null; cnpj_cpf: string | null };
  resumo: Resumo;
  por_categoria: { nome: string; total: number; qtd: number }[];
  por_ano: { ano: string; total: number; qtd: number }[];
  ultimos: Linha[];
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const money = (v: number | string | null | undefined) => BRL.format(Number(v ?? 0));
const dataBR = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
};

function Stat({ label, valor, sub, tone = "text-ww-text" }: {
  label: string; valor: string; sub?: string; tone?: string;
}) {
  return (
    <div className="min-w-[120px]">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint">{label}</div>
      <div className={`text-[17px] font-bold tracking-[-0.4px] ${tone}`}>{valor}</div>
      {sub && <div className="text-[11px] text-ww-textMuted">{sub}</div>}
    </div>
  );
}

export default function FornecedorDrawer({
  cod, empresa, tipo, rotulo, onClose,
}: {
  cod: number;
  empresa?: string;
  tipo: "pagar" | "receber";
  rotulo: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      setData(null); setErro(null);
      try {
        const p = new URLSearchParams({ cod: String(cod), tipo });
        if (empresa) p.set("empresa", empresa);
        const r = await fetch(`/api/financeiro/fornecedor?${p}`, { signal: ctrl.signal });
        const j = await r.json();
        if (!r.ok) { setErro(j.error ?? r.statusText); return; }
        setData(j as Resp);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setErro((e as Error).message);
      }
    })();
    return () => ctrl.abort();
  }, [cod, empresa, tipo]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const r = data?.resumo;
  const maxCat = Math.max(1, ...(data?.por_categoria ?? []).map((c) => c.total));
  const maxAno = Math.max(1, ...(data?.por_ano ?? []).map((a) => a.total));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[620px] h-full bg-ww-panel border-l border-ww-border shadow-2xl flex flex-col">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-ww-border">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint">{rotulo}</div>
            <h3 className="text-[17px] font-bold text-ww-text truncate">
              {data?.fornecedor.nome ?? "Carregando…"}
            </h3>
            {data?.fornecedor.razao && data.fornecedor.razao !== data.fornecedor.nome && (
              <div className="text-[11px] text-ww-textMuted truncate">{data.fornecedor.razao}</div>
            )}
            {data?.fornecedor.cnpj_cpf && (
              <div className="text-[11px] text-ww-textFaint font-mono">{data.fornecedor.cnpj_cpf}</div>
            )}
          </div>
          <button onClick={onClose} className="text-ww-textFaint hover:text-ww-text text-xl leading-none">×</button>
        </div>

        {erro && (
          <div className="m-5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{erro}</div>
        )}
        {!data && !erro && (
          <div className="p-8 text-center text-[12px] text-ww-textMuted">Carregando histórico…</div>
        )}

        {data && r && (
          <div className="overflow-y-auto px-5 py-4 space-y-5">
            {/* Onde estamos hoje */}
            <div className="flex flex-wrap gap-5">
              <Stat label="Em aberto" valor={money(r.em_aberto)}
                    sub={`${r.qtd_aberto} título${r.qtd_aberto === 1 ? "" : "s"}`}
                    tone={r.em_aberto > 0 ? "text-amber-600 dark:text-amber-400" : "text-ww-text"} />
              <Stat label="Vencido" valor={money(r.vencido)}
                    sub={`${r.qtd_vencido} título${r.qtd_vencido === 1 ? "" : "s"}`}
                    tone={r.vencido > 0 ? "text-rose-600 dark:text-rose-400" : "text-ww-textMuted"} />
              <Stat label="Já pago" valor={money(r.pago)} sub={`${r.qtd_pago} baixado(s)`}
                    tone="text-emerald-600 dark:text-emerald-400" />
            </div>

            {/* Como é trabalhar com ele */}
            <div className="flex flex-wrap gap-5 pt-4 border-t border-ww-border">
              <Stat label="Histórico" valor={`${r.titulos}`}
                    sub={r.primeiro_titulo ? `desde ${dataBR(r.primeiro_titulo)}` : undefined} />
              <Stat label="Ticket médio" valor={money(r.ticket_medio)} />
              {/* Sem baixas não há prazo a medir — melhor dizer isso do que mostrar 0. */}
              <Stat
                label="Pontualidade"
                valor={r.pontualidade_pct == null ? "—" : `${Math.round(r.pontualidade_pct * 100)}%`}
                sub={r.base_pontualidade ? `em ${r.base_pontualidade} baixados` : "sem baixas para medir"}
                tone={r.pontualidade_pct == null ? "text-ww-textMuted"
                      : r.pontualidade_pct >= 0.9 ? "text-emerald-600 dark:text-emerald-400"
                      : r.pontualidade_pct >= 0.6 ? "text-amber-600 dark:text-amber-400"
                      : "text-rose-600 dark:text-rose-400"} />
              <Stat
                label="Atraso médio"
                valor={r.atraso_medio_dias == null ? "—"
                       : `${r.atraso_medio_dias > 0 ? "+" : ""}${r.atraso_medio_dias.toFixed(1)} d`}
                sub={r.atraso_medio_dias != null && r.atraso_medio_dias <= 0 ? "paga em dia ou antes" : undefined}
                tone={r.atraso_medio_dias == null ? "text-ww-textMuted"
                      : r.atraso_medio_dias <= 0 ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400"} />
            </div>

            {/* Em que ele entra */}
            {data.por_categoria.length > 0 && (
              <div className="pt-4 border-t border-ww-border">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint mb-2">Por categoria</div>
                <div className="space-y-1.5">
                  {data.por_categoria.map((c) => (
                    <div key={c.nome}>
                      <div className="flex justify-between gap-2 text-[11px]">
                        <span className="truncate text-ww-textMuted" title={c.nome}>{c.nome}</span>
                        <span className="font-medium text-ww-text whitespace-nowrap">{money(c.total)}</span>
                      </div>
                      <div className="h-1 rounded-full bg-ww-border/60 mt-0.5">
                        <div className="h-1 rounded-full bg-ww-accent/70" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Volume ao longo do tempo */}
            {data.por_ano.length > 1 && (
              <div className="pt-4 border-t border-ww-border">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint mb-2">Por ano</div>
                <div className="flex items-end gap-1.5 h-[70px]">
                  {data.por_ano.map((a) => (
                    <div key={a.ano} className="flex-1 flex flex-col items-center justify-end gap-1"
                         title={`${a.ano}: ${money(a.total)} em ${a.qtd} título(s)`}>
                      <div className="w-full rounded-t bg-ww-accent/60"
                           style={{ height: `${Math.max(2, (a.total / maxAno) * 56)}px` }} />
                      <span className="text-[9px] text-ww-textFaint">{a.ano.slice(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Os últimos, para reconhecer o padrão */}
            <div className="pt-4 border-t border-ww-border">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ww-textFaint mb-2">
                Últimos títulos
              </div>
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left text-ww-textFaint">
                    <th className="py-1 pr-2 font-semibold">Venc.</th>
                    <th className="py-1 pr-2 font-semibold">Pago em</th>
                    <th className="py-1 pr-2 font-semibold">Categoria</th>
                    <th className="py-1 pr-2 font-semibold text-right">Valor</th>
                    <th className="py-1 font-semibold text-right">Aberto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ultimos.map((l) => (
                    <tr key={l.cod_titulo} className="border-t border-ww-border/60">
                      <td className="py-1 pr-2 whitespace-nowrap text-ww-text">{dataBR(l.vencimento)}</td>
                      <td className="py-1 pr-2 whitespace-nowrap text-ww-textMuted">{dataBR(l.pagamento)}</td>
                      <td className="py-1 pr-2 truncate max-w-[150px] text-ww-textMuted" title={l.categoria ?? ""}>
                        {l.categoria ?? "—"}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums text-ww-text">{money(l.valor_documento)}</td>
                      <td className={`py-1 text-right tabular-nums ${
                        Number(l.val_aberto ?? 0) > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-ww-textFaint"
                      }`}>
                        {Number(l.val_aberto ?? 0) > 0 ? money(l.val_aberto) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
