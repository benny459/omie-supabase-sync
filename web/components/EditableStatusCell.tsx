"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { STATUS_META, STATUS_ORDER } from "@/lib/columns";
import { useUserPerms } from "./UserPermsProvider";

// Status que só admin pode aplicar — protegido também na API route.
const ADMIN_ONLY_STATUS = new Set(["CANCELAR_PEDIDO"]);

/**
 * Dropdown editável de status. O menu é renderizado via portal no document.body
 * pra escapar de overflow-hidden/overflow-auto de containers pais (tabela, card).
 * Posição é calculada a partir do bounding-rect do botão — segue ele mesmo se
 * o user scrollar horizontal na tabela.
 */
export default function EditableStatusCell({
  empresa,
  ncod_ped,
  modulo,
  current,
  valorPc,
}: {
  empresa: string;
  ncod_ped: number;
  modulo: string;
  current: string | null | undefined;
  valorPc: number | null;
}) {
  const router = useRouter();
  const currentUser = useUserPerms();
  const isAdmin = currentUser?.is_admin === true || currentUser?.role === "admin";
  const [open, setOpen]     = useState(false);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState<string | null>(null);
  const [value, setValue]   = useState<string>(current ?? "PENDENTE");
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; alignRight: boolean } | null>(null);

  useEffect(() => { setValue(current ?? "PENDENTE"); }, [current]);

  // Fecha no click fora + ESC
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  // Calcula posição ao abrir e reposiciona em scroll/resize
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    function place() {
      const rect = btnRef.current!.getBoundingClientRect();
      const menuWidth = 260;
      const vpW = window.innerWidth;
      const alignRight = rect.left + menuWidth > vpW - 16;
      setPos({
        top: rect.bottom + 6,
        left: alignRight ? rect.right - menuWidth : rect.left,
        alignRight,
      });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  async function apply(next: string) {
    if (next === value) { setOpen(false); return; }
    setBusy(true); setErr(null);
    const res = await fetch("/api/approvals/set-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa, ncod_ped, status: next, modulo, valorPc }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? `HTTP ${res.status}`);
      return;
    }
    setValue(next);
    setOpen(false);
    router.refresh();
  }

  const meta = STATUS_META[value] ?? STATUS_META.PENDENTE;

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        disabled={busy}
        title={err ?? "Clique para mudar status"}
        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition hover:brightness-110 shadow-sm ${meta.tone} ${busy ? "opacity-60" : ""}`}
      >
        <span>{meta.label}</span>
        <span className="text-[9px] opacity-80">▾</span>
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: 260, zIndex: 9999 }}
          onClick={(e) => e.stopPropagation()}
          className="p-2 bg-white border border-slate-200 rounded-xl shadow-2xl space-y-1.5"
        >
          {STATUS_ORDER.map((code) => {
            const m = STATUS_META[code];
            if (!m) return null;
            // Status admin-only (ex: Cancelar Pedido) só aparece pra admin
            if (ADMIN_ONLY_STATUS.has(code) && !isAdmin) return null;
            const selected = code === value;
            return (
              <button
                key={code}
                onClick={() => apply(code)}
                disabled={busy}
                className={`w-full flex items-center justify-between px-4 py-2 rounded-full text-[12px] font-bold transition hover:brightness-110 shadow-sm ${m.tone}`}
              >
                <span className="flex-1 text-center">{m.label}</span>
                {selected && <span className="ml-2 text-sm">✓</span>}
              </button>
            );
          })}
          {err && <div className="text-[10px] text-rose-700 px-2 pt-1">{err}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
