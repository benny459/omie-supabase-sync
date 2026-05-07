export const fmtBRL = (v: number | string | null | undefined) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export const fmtNum = (v: number | string | null | undefined, digits = 0) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

export const fmtDate = (v: string | null | undefined) => {
  if (!v) return "—";
  // Suporta "dd/MM/yyyy" (Omie legado), "yyyy-mm-dd", ISO, ou Date-like.
  const s = String(v).trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("pt-BR");
  return s;
};

export const fmtDateTime = (v: string | null | undefined) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};

export const fmtBool = (v: boolean | null | undefined) =>
  v == null ? "—" : v ? "✓" : "✗";

export const fmtPct = (v: number | string | null | undefined) => {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
};

export const fmtDays = (v: number | null | undefined) => {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n === 1 ? "1 dia" : `${n} dias`;
};
