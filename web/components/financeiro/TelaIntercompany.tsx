"use client";
// Intercompany (05/10/26): títulos de uma empresa pagos/recebidos por conta de
// outra empresa do grupo. Ex.: conta da CD paga pelo C6 da SF ⇒ "CD deve à SF".
import { useCallback, useEffect, useMemo, useState } from "react";

type Saldo = { devedora: string; credora: string; valor: number; n: number };
type Item = { id: number; data: string; natureza: "P" | "R"; valor: number; empresa_credora: string; empresa_devedora: string;
  ref: string | null; contraparte: string | null; documento: string | null; conta: string | null; status: "aberto" | "liquidado" | "anulado";
  obs: string | null; liquidado_em: string | null; liquidado_por: string | null; liquidacao_obs: string | null; anulado_motivo: string | null };

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dt = (s: string | null) => (s ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString("pt-BR") : "—");

export default function TelaIntercompany() {
  const [d, setD] = useState<{ saldos: Saldo[]; itens: Item[] } | null>(null);
  const [st, setSt] = useState<"aberto" | "liquidado" | "anulado" | "todos">("aberto");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [obs, setObs] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const carregar = useCallback(async () => {
    const r = await fetch("/api/financeiro/intercompany", { cache: "no-store" });
    const j = await r.json(); if (!r.ok) { setMsg(j.error ?? "Erro"); return; } setD(j); setSel(new Set());
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const itens = useMemo(() => (d?.itens ?? []).filter((i) => st === "todos" || i.status === st), [d, st]);
  const totSel = itens.filter((i) => sel.has(i.id)).reduce((s, i) => s + Number(i.valor), 0);
  async function post(body: object) {
    const r = await fetch("/api/financeiro/intercompany", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) { setMsg(j.error ?? "Erro"); return; } setMsg(null); setObs(""); carregar();
  }
  return (
    <div className="space-y-4">
      <div>
        <div className="text-[12px] text-ww-textMuted">Financeiro</div>
        <h1 className="text-[26px] font-semibold text-ww-text tracking-[-0.022em]">Intercompany</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">Contas de uma empresa pagas ou recebidas pelo banco de outra empresa do grupo. Nasce sozinho na baixa ou na conciliação; estornar a baixa anula o lançamento.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {(d?.saldos ?? []).length === 0 && <div className="text-[13px] text-ww-textMuted">Nenhum saldo em aberto entre as empresas.</div>}
        {(d?.saldos ?? []).map((s) => (
          <div key={s.devedora + s.credora} className="rounded-xl border border-ww-border bg-ww-surface px-4 py-3 min-w-[220px]">
            <div className="text-[12px] text-ww-textMuted"><b className="text-ww-text">{s.devedora}</b> deve à <b className="text-ww-text">{s.credora}</b></div>
            <div className="text-[22px] font-bold text-ww-text tabular-nums">{brl(s.valor)}</div>
            <div className="text-[11.5px] text-ww-textMuted">{s.n} lançamento{s.n > 1 ? "s" : ""} em aberto</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(["aberto", "liquidado", "anulado", "todos"] as const).map((k) => (
          <button key={k} onClick={() => { setSt(k); setSel(new Set()); }} className={`px-3 py-1.5 rounded-lg text-[12.5px] border ${st === k ? "border-ww-accent text-ww-text" : "border-ww-border text-ww-textMuted"}`}>{k === "todos" ? "Todos" : k[0].toUpperCase() + k.slice(1)}</button>
        ))}
        {sel.size > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[12.5px] text-ww-textMuted">{sel.size} selecionado(s) · <b className="text-ww-text">{brl(totSel)}</b></span>
            <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Como foi acertado (ex.: TED SF→CD 10/10)" className="h-8 px-2 rounded-lg border border-ww-border bg-ww-surface text-[12.5px] w-[280px]" />
            <button onClick={() => post({ acao: "liquidar", ids: [...sel], obs })} className="h-8 px-3 rounded-lg bg-ww-accent text-white text-[12.5px] font-semibold">Marcar como liquidado</button>
          </div>
        )}
      </div>
      {msg && <div className="text-[12.5px] text-red-400">{msg}</div>}
      <div className="rounded-xl border border-ww-border overflow-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-[12px] uppercase tracking-wide text-ww-text bg-ww-surface">
            <th className="p-2 w-8"></th><th className="p-2">Data</th><th className="p-2">Quem deve</th><th className="p-2">A quem</th><th className="p-2">Tipo</th><th className="p-2">Contraparte / documento</th><th className="p-2">Conta usada</th><th className="p-2">Situação</th><th className="p-2 text-right">Valor</th><th className="p-2"></th>
          </tr></thead>
          <tbody>
            {itens.length === 0 && <tr><td colSpan={10} className="p-4 text-ww-textMuted">Nada por aqui.</td></tr>}
            {itens.map((i) => (
              <tr key={i.id} className="border-t border-ww-border">
                <td className="p-2">{i.status === "aberto" && <input type="checkbox" checked={sel.has(i.id)} onChange={(e) => { const s = new Set(sel); e.target.checked ? s.add(i.id) : s.delete(i.id); setSel(s); }} />}</td>
                <td className="p-2 tabular-nums">{dt(i.data)}</td>
                <td className="p-2 font-semibold">{i.empresa_devedora}</td>
                <td className="p-2 font-semibold">{i.empresa_credora}</td>
                <td className="p-2">{i.natureza === "P" ? "Pagamento" : "Recebimento"}</td>
                <td className="p-2">{i.contraparte ?? "—"}<div className="text-[11.5px] text-ww-textMuted">{i.documento ?? ""}{i.obs ? " · " + i.obs : ""}</div></td>
                <td className="p-2">{i.conta ?? "—"}</td>
                <td className="p-2">{i.status === "aberto" ? "Em aberto" : i.status === "liquidado" ? `Liquidado ${dt(i.liquidado_em)}${i.liquidacao_obs ? " · " + i.liquidacao_obs : ""}` : `Anulado${i.anulado_motivo ? " · " + i.anulado_motivo : ""}`}</td>
                <td className="p-2 text-right tabular-nums font-semibold">{brl(i.valor)}</td>
                <td className="p-2 text-right">{i.status === "liquidado" && <button onClick={() => post({ acao: "reabrir", id: i.id })} className="text-[12px] text-ww-accent underline">reabrir</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
