"use client";

// Seletor de pedido de compra — extraído de RcProjetoItensBlock para poder ser
// usado também pela grade de materiais. Comportamento idêntico ao original:
// busca com debounce, lista os PCs do projeto e devolve o escolhido.

import { useEffect, useRef, useState } from "react";

export type PcSearchResult = {
  pc_numero: string;
  valor_total: number | null;
  nome_fornecedor: string | null;
  dt_previsao: string | null;
  dt_inclusao: string | null;
  projeto_nome: string | null;
};

const fmtBR = (s: string | null | undefined): string => {
  if (!s) return "—";
  const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : String(s);
};
const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

export default function PcPickerModal({
  empresa, codigoProjeto, title, onClose, onConfirm,
}: {
  empresa: string;
  codigoProjeto: number;
  title: string;
  onClose: () => void;
  onConfirm: (pc: PcSearchResult) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PcSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const url = `/api/pcs/search?empresa=${encodeURIComponent(empresa)}&codigo_projeto=${codigoProjeto}&q=${encodeURIComponent(q)}&limit=50`;
        const r = await fetch(url);
        if (r.ok) {
          const j = await r.json();
          setRows((j.rows ?? []) as PcSearchResult[]);
        }
      } finally { setLoading(false); }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, empresa, codigoProjeto]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
         onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-ww-panel rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b border-ww-border flex items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ww-text text-[15px]">{title}</h3>
            <p className="text-[11px] text-ww-textMuted mt-0.5">
              Escolha um PC existente do Omie para <strong>{empresa}</strong>. Busque por número, fornecedor ou projeto.
            </p>
          </div>
          <button onClick={onClose} className="text-ww-textFaint hover:text-ww-text dark:hover:text-slate-100 text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-3 border-b border-ww-border ">
          <input autoFocus type="text" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Nº do PC, fornecedor ou projeto…"
            className="w-full px-3 py-2 text-sm border border-ww-border rounded-md bg-ww-panel text-ww-text focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="p-4 text-[12px] text-ww-textMuted italic">Buscando…</div>}
          {!loading && rows.length === 0 && (
            <div className="p-4 text-[12px] text-ww-textMuted italic">Nenhum PC encontrado. Ajuste a busca.</div>
          )}
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <li key={r.pc_numero}>
                <button onClick={() => onConfirm(r)}
                  className="w-full text-left px-5 py-2.5 hover:bg-violet-50 dark:hover:bg-violet-950/40 transition flex items-center gap-4">
                  <div className="min-w-[80px]">
                    <div className="font-mono text-[13px] font-bold text-violet-800 dark:text-violet-200">PC {r.pc_numero}</div>
                    <div className="text-[10px] text-ww-textMuted tabular-nums">{fmtBR(r.dt_inclusao)}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-ww-text truncate">{r.nome_fornecedor ?? "—"}</div>
                    <div className="text-[10.5px] text-ww-textMuted truncate">{r.projeto_nome ?? "—"}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[12px] font-bold tabular-nums text-emerald-800 dark:text-emerald-300 whitespace-nowrap">
                      {r.valor_total != null ? fmtBRL(Number(r.valor_total)) : "—"}
                    </div>
                    <div className="text-[10px] text-ww-textMuted tabular-nums">Prev: {fmtBR(r.dt_previsao)}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="px-5 py-3 border-t border-ww-border text-[10.5px] text-ww-textMuted ">
          Clique em um PC pra confirmar. Itens que já tinham PC serão sobrescritos.
        </div>
      </div>
    </div>
  );
}
