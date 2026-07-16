"use client";

// Balão de comentários por PV/OS. Fica visível no header do BucketCard.
// - Click abre popover (portal + fixed pos pra não ser cortado pelo overflow).
// - Lista cronológica reversa (mais novo em cima) com autor + BRT dd/mm/yy hh:mm.
// - Textarea + botão pra postar novo comentário.
// - Contador na pill (fetch lazy: 1a vez que o popover abre).

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Comentario = {
  id: string;
  autor_email: string;
  texto: string;
  created_at: string;
};

// Formata timestamp em BRT: dd/mm/yy HH:mm
function fmtBRT(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

// Trim email pra ficar mais curto (fulano@waterworks.com.br → fulano)
function shortAuthor(email: string): string {
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export default function PvOsComentarios({
  empresa,
  pvOsLabel,
}: {
  empresa: string;
  pvOsLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<Comentario[]>([]);
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [novoTexto, setNovoTexto] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);

  // Fetch inicial só quando abrir a primeira vez (lazy)
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/comentarios/pv-os?empresa=${encodeURIComponent(empresa)}&pv_os_label=${encodeURIComponent(pvOsLabel)}`,
        { cache: "no-store" },
      );
      if (r.ok) {
        const j = await r.json();
        setItems(j.items ?? []);
      }
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [empresa, pvOsLabel]);

  useEffect(() => {
    if (open && !loaded) void fetchList();
  }, [open, loaded, fetchList]);

  // Portal position — recalcula em resize/scroll
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      // Prefere abrir pra baixo. Se não couber, força pra cima.
      const spaceBelow = window.innerHeight - r.bottom;
      const preferHeight = 380;
      const top = spaceBelow > preferHeight ? r.bottom + 4 : Math.max(8, r.top - preferHeight - 4);
      setPopPos({ top, left: r.left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // Fecha ao clicar fora (checa portal também)
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  async function postar() {
    const t = novoTexto.trim();
    if (!t || posting) return;
    setPosting(true);
    try {
      const r = await fetch("/api/comentarios/pv-os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, pv_os_label: pvOsLabel, texto: t }),
      });
      const j = await r.json();
      if (!r.ok) {
        alert(`Erro: ${j.error ?? r.statusText}`);
        return;
      }
      setItems((prev) => [j.item, ...prev]);
      setNovoTexto("");
    } finally {
      setPosting(false);
    }
  }

  const count = items.length;
  const hasComments = loaded && count > 0;

  const popover = open && popPos && typeof document !== "undefined"
    ? createPortal(
        <div ref={popRef}
             style={{ top: popPos.top, left: popPos.left }}
             className="fixed z-[60] w-[380px] max-h-[420px] flex flex-col bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md shadow-xl"
             onClick={(e) => e.stopPropagation()}>
          <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <span>💬</span>
              <span>Comentários da equipe</span>
              {count > 0 && (
                <span className="text-[10px] font-semibold text-slate-400 tabular-nums">· {count}</span>
              )}
            </div>
            <span className="text-[10px] font-mono text-slate-400">{pvOsLabel}</span>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto px-3 py-2 min-h-[80px]">
            {loading ? (
              <div className="text-[11px] italic text-slate-500 text-center py-4">Carregando…</div>
            ) : items.length === 0 ? (
              <div className="text-[11px] italic text-slate-500 text-center py-4">
                Nenhum comentário ainda — seja o primeiro a deixar uma observação.
              </div>
            ) : (
              <ul className="space-y-2">
                {items.map((c) => (
                  <li key={c.id} className="rounded border border-slate-100 dark:border-slate-800 px-2.5 py-1.5 bg-slate-50/50 dark:bg-slate-800/30">
                    <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-700 dark:text-slate-200 truncate" title={c.autor_email}>
                        {shortAuthor(c.autor_email)}
                      </span>
                      <span className="tabular-nums whitespace-nowrap">{fmtBRT(c.created_at)} BRT</span>
                    </div>
                    <div className="text-[12px] text-slate-800 dark:text-slate-100 whitespace-pre-wrap mt-0.5">
                      {c.texto}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Compositor */}
          <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40">
            <textarea
              value={novoTexto}
              onChange={(e) => setNovoTexto(e.target.value)}
              placeholder="Escreva uma observação…"
              rows={2}
              className="w-full text-[12px] px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-200 dark:focus:ring-sky-900 resize-none"
              onKeyDown={(e) => {
                // Cmd/Ctrl+Enter posta
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void postar();
                }
              }}
            />
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[9.5px] text-slate-400">⌘+Enter pra enviar</span>
              <button type="button" onClick={() => void postar()}
                disabled={posting || novoTexto.trim() === ""}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold transition ${
                  posting || novoTexto.trim() === ""
                    ? "bg-slate-200 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600"
                    : "bg-sky-600 text-white hover:bg-sky-700"
                }`}>
                {posting ? "Enviando…" : "Comentar"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button ref={btnRef} type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Comentários da equipe — click pra ver/adicionar observações"
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border transition ${
          hasComments
            ? "border-sky-400 dark:border-sky-700 bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 hover:bg-sky-100 dark:hover:bg-sky-900/50"
            : "border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
        }`}>
        <span className="text-[13px] leading-none">💬</span>
        {hasComments ? (
          <span className="tabular-nums">{count}</span>
        ) : (
          <span className="text-[10px] opacity-70">obs</span>
        )}
      </button>
      {popover}
    </>
  );
}
