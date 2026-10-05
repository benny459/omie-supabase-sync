"use client";

import { useEffect, useMemo, useState } from "react";
import { limpo } from "@/lib/faturamento/montar";

/* Recibos em lote (05/10/26): o Benny busca "4729, 4735, 4738", seleciona as OS
   e emite todos de uma vez. Cada OS é montada no servidor exatamente como a folha
   "Revisar e emitir recibo" faria (forma/conta herdadas do último faturamento do
   cliente, instrução de pagamento), passa pelo mesmo pré-voo e é emitida pelo
   mesmo caminho da emissão avulsa — uma de cada vez, na ordem da lista. */

type DocLote = { chave: string; tipo: "PV" | "OS"; rotulo: string; cliente: string | null; fantasia?: string | null };
type Checagem = { item: string; ok: boolean; nivel: "erro" | "aviso"; detalhe: string };
type Parc = { vencimento: string; valor: number; forma?: string | null };
type Cond = { forma_recebimento?: string | null; conta_nome?: string | null; conta_corrente?: number | null; projeto?: string | null; categoria?: string | null; instrucao_pagamento?: string | null };
type Linha = {
  d: DocLote; estado: "carregando" | "pronto" | "bloqueado" | "emitindo" | "emitido" | "falhou";
  documento?: unknown; cond?: Cond; parcelas?: Parc[]; liquido?: number; erros?: string[]; bloqueio?: string | null;
  numero?: string | null; url?: string | null; msg?: string | null;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const FORMAS: Record<string, string> = { PIX: "PIX", BOL: "Boleto", TRA: "Transferência", TED: "TED", DEP: "Depósito", DIN: "Dinheiro", CHQ: "Cheque", CRT: "Cartão" };

export default function LoteRecibos({ empresa, docs, prod, admin, fechar, abrirFolha, onEmitido }: {
  empresa: string; docs: DocLote[]; prod: boolean; admin: boolean;
  fechar: () => void; abrirFolha: (chave: string) => void; onEmitido: () => void;
}) {
  const [linhas, setLinhas] = useState<Linha[]>(() => docs.map((d) => d.tipo === "PV"
    ? { d, estado: "bloqueado", bloqueio: "PV fatura por NF-e — use a folha" }
    : { d, estado: "carregando" }));
  const [teste, setTeste] = useState(false);
  const [rodando, setRodando] = useState(false);
  const muda = (chave: string, p: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.d.chave === chave ? { ...l, ...p } : l)));

  // Monta cada OS no servidor (sem enviar nada), 3 de cada vez.
  useEffect(() => {
    let vivo = true;
    const fila = docs.filter((d) => d.tipo === "OS");
    const um = async (d: DocLote) => {
      const r = await fetch("/api/faturamento/carteira", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ empresa, chave: d.chave, acao: "lote" }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
      if (!vivo) return;
      if (r.error) { muda(d.chave, { estado: "bloqueado", bloqueio: r.error }); return; }
      const erros = ((r.checagens ?? []) as Checagem[]).filter((c) => !c.ok && c.nivel === "erro").map((c) => `${c.item}: ${c.detalhe}`);
      muda(d.chave, {
        estado: r.pode_emitir && !r.bloqueio ? "pronto" : "bloqueado", documento: r.documento,
        cond: (r.documento?.condicao ?? {}) as Cond, parcelas: r.parcelas ?? [], liquido: r.liquido ?? r.total,
        erros, bloqueio: r.bloqueio ?? (r.pode_emitir === false && !erros.length ? "pré-voo com pendências" : null),
      });
    };
    (async () => { for (let i = 0; i < fila.length; i += 3) await Promise.all(fila.slice(i, i + 3).map(um)); })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prontas = linhas.filter((l) => l.estado === "pronto");
  const carregando = linhas.some((l) => l.estado === "carregando");
  const emitidos = linhas.filter((l) => l.estado === "emitido" && l.url);
  const total = useMemo(() => prontas.reduce((a, l) => a + Number(l.liquido ?? 0), 0), [prontas]);

  async function emitirTodos() {
    const n = prontas.length;
    if (!n) return;
    const amb = teste ? "TESTE (homologação, sem numeração real)" : prod ? "PRODUÇÃO — recibos reais, com numeração sequencial" : "homologação";
    if (!window.confirm(`Emitir ${n} recibo(s) — ${BRL.format(total)} — em ${amb}?\n\n${prontas.map((l) => `${l.d.rotulo} · ${limpo(l.d.fantasia || l.d.cliente || "")}`).join("\n")}`)) return;
    setRodando(true);
    for (const l of prontas) {
      muda(l.d.chave, { estado: "emitindo" });
      const r = await fetch("/api/faturamento/carteira", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ empresa, chave: l.d.chave, acao: "emitir", documento: l.documento, forcar_homologacao: teste }) })
        .then((x) => x.json()).catch((e) => ({ error: String(e) }));
      const e = r.emissao as { status?: string; numero?: string | null; mensagem?: string | null } | undefined;
      if (r.error || !e) muda(l.d.chave, { estado: "falhou", msg: r.error ?? "sem resposta" });
      else muda(l.d.chave, { estado: e.status === "autorizada" ? "emitido" : "falhou", numero: e.numero ?? null, url: r.pdf_url ?? null, msg: e.status === "autorizada" ? null : e.mensagem ?? e.status ?? null });
    }
    setRodando(false);
    onEmitido();
  }

  function abrirTodos() {
    const ps = emitidos.map((l) => new URL(l.url!, location.origin).searchParams.get("p")).filter(Boolean) as string[];
    if (ps.length) window.open(`/api/faturamento/arquivo?${ps.map((p) => `p=${encodeURIComponent(p)}`).join("&")}`, "_blank", "noopener");
  }

  const selo = (l: Linha) => ({
    carregando: <span className="lt-st">montando…</span>,
    pronto: <span className="lt-st ok">✓ pronto</span>,
    bloqueado: <span className="lt-st bad">não emite</span>,
    emitindo: <span className="lt-st">emitindo…</span>,
    emitido: <span className="lt-st ok">✓ nº {l.numero}</span>,
    falhou: <span className="lt-st bad">✗ falhou</span>,
  })[l.estado];

  return (
    <>
      <div className="fpv-scrim" onClick={rodando ? undefined : fechar} />
      <aside className="fpv-drawer fpv-form fpv-lote">
        <div className="dh">
          <button className="x" onClick={fechar} disabled={rodando}>✕</button>
          <h2><span className="tag os">OS</span>Emitir recibos em lote</h2>
          <div className="c">Cada recibo sai como na folha “Revisar e emitir recibo”: forma e conta do último faturamento do cliente, parcelas pela condição da OS. Para mudar algo, abra a OS na folha.</div>
        </div>
        <div className="db">
          <table className="lt">
            <thead><tr><th>OS</th><th>Cliente</th><th className="r">A receber</th><th>Vencimento</th><th>Forma · conta</th><th>Projeto · categoria</th><th>Situação</th></tr></thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.d.chave} className={l.estado === "bloqueado" || l.estado === "falhou" ? "ruim" : ""}>
                  <td><b>{l.d.rotulo}</b></td>
                  <td>{limpo(l.d.fantasia || l.d.cliente || "")}</td>
                  <td className="r mono">{l.liquido != null ? BRL.format(l.liquido) : "—"}</td>
                  <td>{(l.parcelas ?? []).map((p, i) => <div key={i}>{dataBR(p.vencimento)}{(l.parcelas?.length ?? 0) > 1 ? ` · ${BRL.format(p.valor)}` : ""}</div>)}</td>
                  <td>{l.cond ? <>{FORMAS[String(l.cond.forma_recebimento ?? "").toUpperCase()] ?? l.cond.forma_recebimento ?? "—"}<div className="sub2">{l.cond.conta_nome ?? (l.cond.conta_corrente ? `conta ${l.cond.conta_corrente}` : "sem conta")}</div></> : "—"}</td>
                  <td>{l.cond ? <>{l.cond.projeto || <i className="bad">sem projeto</i>}<div className="sub2">{l.cond.categoria || <i className="bad">sem categoria</i>}</div></> : "—"}</td>
                  <td>
                    {selo(l)}
                    {l.estado === "bloqueado" && <div className="sub2 bad">{[l.bloqueio, ...(l.erros ?? [])].filter(Boolean).join(" · ")}</div>}
                    {l.estado === "falhou" && <div className="sub2 bad">{l.msg}</div>}
                    {l.estado === "emitido" && l.url && <a className="sub2" href={l.url} target="_blank" rel="noopener">abrir recibo ↗</a>}
                    {(l.estado === "bloqueado" || l.estado === "pronto") && !rodando && l.d.tipo === "OS" && (
                      <button className="lk" onClick={() => abrirFolha(l.d.chave)}>abrir na folha</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {prontas.some((l) => !l.cond?.instrucao_pagamento) && (
            <div className="alert" style={{ marginTop: 12 }}>Algum recibo vai sem dados de pagamento (conta sem banco/PIX cadastrado) — complete em Cadastros › Bancos e contas ou abra na folha.</div>
          )}
        </div>
        <div className="df">
          <div className="sum">
            {carregando ? "Montando as OS…" : <>{prontas.length} pronto(s){linhas.length - prontas.length > 0 ? ` · ${linhas.filter((l) => l.estado === "bloqueado").length} não emite(m)` : ""}<b className="mono">{BRL.format(total)}</b></>}
          </div>
          {admin && <label className="fld chk" title="Sai um recibo de teste (homologação), sem usar a numeração real"><input type="checkbox" checked={teste} disabled={rodando} onChange={(e) => setTeste(e.target.checked)} /> Teste (forçar homologação)</label>}
          {emitidos.length > 0 && <button className="btn" onClick={abrirTodos}>Abrir todos / imprimir ({emitidos.length})</button>}
          <button className="btn" onClick={fechar} disabled={rodando}>{emitidos.length ? "Fechar" : "Cancelar"}</button>
          <button className="btn pri" disabled={rodando || carregando || !prontas.length} onClick={emitirTodos}>
            {rodando ? "Emitindo…" : `Emitir ${prontas.length} recibo${prontas.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </aside>
    </>
  );
}
