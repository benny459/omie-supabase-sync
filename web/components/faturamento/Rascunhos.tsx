"use client";
import { useCallback, useEffect, useState } from "react";

/** Rascunhos da folha "Nova emissão" (05/10/26) — continuar, descartar ou duplicar. */
export type Rascunho = {
  id: number; empresa: string; tipo: string; operacao: string | null; origem: string; chave: string | null; rotulo: string | null;
  cliente_nome: string | null; destinatario: string | null; projeto: string | null; valor_total: number; titulo: string | null;
  criado_por: string | null; criado_em: string; atualizado_por: string | null; atualizado_em: string;
};

const TIPO_ROT: Record<string, string> = { nfe: "NF-e", recibo: "Recibo (OS)", nfse: "NFS-e (prefeitura)" };
const OP_ROT: Record<string, string> = { remessa: "Simples remessa", conserto: "Remessa p/ conserto", devolucao: "Devolução" };
const fmt = (n: number) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quando = (s: string) => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const quem = (e: string | null) => (e ?? "").split("@")[0] || "—";

export default function Rascunhos({ q, continuar, avisar, onMudou }: {
  q: string; continuar: (id: number) => void; avisar: (m: string) => void; onMudou?: () => void;
}) {
  const [lista, setLista] = useState<Rascunho[] | null>(null);
  const carregar = useCallback(() => {
    fetch("/api/faturamento/rascunhos", { cache: "no-store" }).then((x) => x.json())
      .then((j) => setLista(j.rascunhos ?? [])).catch(() => setLista([]));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function descartar(r: Rascunho) {
    if (!window.confirm(`Descartar o rascunho "${r.titulo ?? r.cliente_nome ?? `#${r.id}`}"?`)) return;
    const j = await fetch("/api/faturamento/rascunhos", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: r.id, status: "descartado" }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (j.error) { avisar(`Rascunho: ${j.error}`); return; }
    avisar("Rascunho descartado"); carregar(); onMudou?.();
  }
  async function duplicar(r: Rascunho) {
    const j = await fetch("/api/faturamento/rascunhos", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "duplicar", id: r.id }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (j.error) { avisar(`Rascunho: ${j.error}`); return; }
    avisar("Rascunho duplicado"); carregar();
  }

  const t = q.trim().toLowerCase();
  const rows = (lista ?? []).filter((r) => !t || `${r.titulo ?? ""} ${r.cliente_nome ?? ""} ${r.rotulo ?? ""} ${r.projeto ?? ""}`.toLowerCase().includes(t));
  if (!lista) return <p style={{ color: "var(--f-tx3)", fontSize: 13 }}>Carregando rascunhos…</p>;
  if (!rows.length) return (
    <p style={{ color: "var(--f-tx3)", fontSize: 13, padding: "18px 4px" }}>
      Nenhum rascunho. Na folha de emissão, use <b>Salvar rascunho</b> (ela também salva sozinha a cada ~20 s e ao fechar sem emitir).
    </p>
  );
  return (
    <table className="fl">
      <thead>
        <tr><th>Rascunho</th><th>Tipo</th><th>Cliente / destinatário</th><th>Projeto</th><th style={{ textAlign: "right" }}>Valor</th><th>Atualizado</th><th style={{ textAlign: "right" }}>Ações</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><b>#{r.id}</b>{r.rotulo && <div className="orig">{r.rotulo}</div>}</td>
            <td>{r.operacao && r.operacao !== "venda" ? OP_ROT[r.operacao] ?? r.operacao : TIPO_ROT[r.tipo] ?? r.tipo}<div className="orig">{r.empresa} · {r.origem === "existente" ? "de PV/OS" : "novo"}</div></td>
            <td>{r.cliente_nome ?? r.destinatario ?? "—"}</td>
            <td>{r.projeto ?? "—"}</td>
            <td className="mono" style={{ textAlign: "right" }}>{fmt(r.valor_total)}</td>
            <td>{quando(r.atualizado_em)}<div className="orig">por {quem(r.atualizado_por ?? r.criado_por)}</div></td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              <button className="btn sm pri" onClick={() => continuar(r.id)}>Continuar</button>{" "}
              <button className="btn sm" onClick={() => duplicar(r)}>Duplicar</button>{" "}
              <button className="btn sm ghost" onClick={() => descartar(r)}>Descartar</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
