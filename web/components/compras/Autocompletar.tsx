"use client";

import { useEffect, useRef, useState } from "react";

export type Opcao<T> = { label: string; sub?: string; v: T };

/** Campo com lista de sugestões (setas, Enter, Esc). A fonte pode ser local
 *  (filtro em memória) ou remota (rota /api/compras/buscar) — debounce 200ms. */
export default function Autocompletar<T>({
  id, value, onChange, fonte, onPick, placeholder, className = "in", disabled, erro, minimo = 0, autoFocus,
}: {
  id?: string; value: string; onChange?: (v: string) => void;
  fonte: (q: string) => Promise<Opcao<T>[]> | Opcao<T>[];
  onPick: (o: Opcao<T>) => void; placeholder?: string; className?: string; disabled?: boolean;
  erro?: boolean; minimo?: number; autoFocus?: boolean;
}) {
  const [opts, setOpts] = useState<Opcao<T>[]>([]);
  const [aberto, setAberto] = useState(false);
  const [hl, setHl] = useState(0);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pedido = useRef(0);

  const buscar = (q: string) => {
    if (t.current) clearTimeout(t.current);
    if (q.trim().length < minimo) { setOpts([]); return; }
    t.current = setTimeout(async () => {
      const n = ++pedido.current;
      try {
        const r = await fonte(q.trim().toLowerCase());
        if (n === pedido.current) { setOpts(r.slice(0, 14)); setHl(0); }
      } catch { /* sem sugestões */ }
    }, 200);
  };
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);

  const escolher = (o: Opcao<T> | undefined) => {
    if (!o) return;
    onPick(o); setAberto(false); setOpts([]);
  };

  return (
    <>
      <input id={id} className={`${className}${erro ? " err" : ""}`} value={value} placeholder={placeholder}
        disabled={disabled} autoComplete="off" autoFocus={autoFocus}
        onChange={(e) => { onChange?.(e.target.value); setAberto(true); buscar(e.target.value); }}
        onFocus={() => { setAberto(true); buscar(value); }}
        onBlur={() => setTimeout(() => setAberto(false), 140)}
        onKeyDown={(e) => {
          if (!aberto || !opts.length) return;
          if (e.key === "ArrowDown") { setHl((h) => Math.min(h + 1, opts.length - 1)); e.preventDefault(); }
          else if (e.key === "ArrowUp") { setHl((h) => Math.max(h - 1, 0)); e.preventDefault(); }
          else if (e.key === "Enter") { escolher(opts[hl]); e.preventDefault(); }
          else if (e.key === "Escape") { setAberto(false); e.stopPropagation(); }
        }} />
      {aberto && opts.length > 0 && (
        <div className="aclist" role="listbox">
          {opts.map((o, i) => (
            <button type="button" key={i} className={i === hl ? "hl" : ""}
              onMouseDown={(e) => { e.preventDefault(); escolher(o); }}>
              {o.label}{o.sub && <small>{o.sub}</small>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
