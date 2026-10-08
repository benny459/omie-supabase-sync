"use client";

/**
 * Cancelar pedido de compra e Devolver material (08/10/26, sql/146 · /api/pcs/ajuste).
 *
 *   ModalCancelarPc   — pede o motivo e mostra, ANTES de gravar, o que vai acontecer
 *                       (dry-run no banco): origem do PC, quantas linhas da Lista voltam a
 *                       "sem PC" e, se o PC veio do Omie, o aviso "cancele também no Omie".
 *   ModalDevolverPc   — itens e quantidades devolvidos, motivo, NF de devolução (nº/data);
 *                       o PC segue ativo; link para emitir a NF de devolução no Faturamento
 *                       (só abre a folha preenchida — não emite nada).
 *   SecaoAjustesPc    — "Cancelados / devolvidos (N)", recolhida, no fim da tabela de PCs
 *                       do projeto; "desfazer" só para admin.
 * Usados na Operação › Projetos (tabela de PCs) e no Compras (menu do pedido e folha).
 */

import "./pc-ajuste.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const brl = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const quem = (a: string | null | undefined) => (a ? (a.includes("@") ? a.split("@")[0] : a) : "—");
const quando = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const diaBR = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "");
const qtdBR = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/pcs/ajuste", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j;
}

/** Link para a folha "NF-e de devolução (de compra)" do Faturamento, preenchida (não emite). */
export function linkNfDevolucao(empresa: string, a: { nf?: string | null; motivo?: string | null; pc: string }) {
  const q = new URLSearchParams({ devolucao: "1", emp: empresa, pc: a.pc });
  if (a.nf) q.set("nf", a.nf);
  if (a.motivo) q.set("motivo", a.motivo);
  return `/faturamento?${q}`;
}

type Previa = { origem: "painel" | "omie" | "sem_cadastro"; valor: number | null; linhas_liberadas: number; cancelar_no_omie: boolean };

export function ModalCancelarPc({ empresa, numero, fornecedor, valor, codigoProjeto, onFechar, onFeito }: {
  empresa: string; numero: string; fornecedor?: string | null; valor?: number | null; codigoProjeto?: number | null;
  onFechar: () => void; onFeito: (r: Previa & { numero: string }) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    // dry-run: a função roda no banco e desfaz tudo — só para mostrar o que vai acontecer
    post({ acao: "cancelar", empresa, numero, motivo: "prévia", codigo_projeto: codigoProjeto, simular: true })
      .then((j) => setPrevia(j)).catch((e) => setErro((e as Error).message));
  }, [empresa, numero, codigoProjeto]);
  const confirmar = async () => {
    setOcupado(true); setErro(null);
    try { onFeito({ ...(await post({ acao: "cancelar", empresa, numero, motivo, codigo_projeto: codigoProjeto })), numero }); }
    catch (e) { setErro((e as Error).message); setOcupado(false); }
  };
  const omie = previa?.origem === "omie";
  return createPortal(
    <div className="pcaj-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="pcaj" role="dialog" aria-modal="true" aria-label={`Cancelar o PC ${numero}`}>
        <div className="hd"><b>Cancelar o pedido de compra {numero}</b><button type="button" aria-label="Fechar" onClick={onFechar}>✕</button></div>
        <div className="corpo">
          <div className="pcaj-id">{fornecedor || "—"} · <b className="num">{brl(previa?.valor ?? valor ?? null)}</b></div>
          {previa ? (
            <ul className="pcaj-efeitos">
              <li>Sai da tabela de PCs, do comprometido, da barra de budget, da margem real e do fluxo de caixa do projeto.</li>
              <li>{previa.linhas_liberadas
                ? <><b>{previa.linhas_liberadas}</b> linha(s) da Lista de materiais voltam a <b>sem PC</b> (com um comentário) — dá para gerar um PC novo para elas.</>
                : "Nenhuma linha da Lista de materiais está ligada a este PC."}</li>
              <li>Fica em “Cancelados / devolvidos”, no fim da tabela, com o motivo, quem e quando.</li>
              {previa.origem === "painel" && <li>PC do painel: fica cancelado também no Compras.</li>}
            </ul>
          ) : !erro && <small className="dim">conferindo o que vai acontecer…</small>}
          {omie && <div className="pcaj-aviso" role="alert"><b>Este PC veio do Omie.</b> O painel não escreve no Omie: aqui ele fica cancelado só no painel. <b>Cancele também no Omie</b>, senão ele continua lá (e no financeiro do Omie).</div>}
          {previa?.origem === "sem_cadastro" && <div className="pcaj-aviso">Este PC não está no Compras do painel — ele só sai das telas (como o “Excluir PC”). Se existir no Omie, cancele lá também.</div>}
          <label className="pcaj-campo"><span>Motivo do cancelamento <i>obrigatório</i></span>
            <textarea autoFocus rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: fornecedor não tem prazo; trocamos de fornecedor" /></label>
          {erro && <div className="pcaj-erro">{erro}</div>}
        </div>
        <div className="pe">
          <button type="button" className="btn sm" onClick={onFechar}>Voltar</button>
          <button type="button" className="btn sm no" disabled={ocupado || !motivo.trim() || !previa} onClick={() => void confirmar()}>
            {ocupado ? "Cancelando…" : omie ? "Cancelar no painel" : "Cancelar pedido"}</button>
        </div>
      </div>
    </div>, document.body);
}

type ItemPc = { id: number; cod: string | null; desc: string; un: string | null; qtd: number; vu: number; rec: number | null };
type PcNum = { id: number; num: string; forn: string | null; valor: number; origem: string; nf: string | null; chave: string | null;
  itens: ItemPc[]; devolvido: Record<string, number>; valorItem: Record<string, number>; cancelamento: unknown };

export function ModalDevolverPc({ empresa, numero, codigoProjeto, onFechar, onFeito }: {
  empresa: string; numero: string; codigoProjeto?: number | null;
  onFechar: () => void; onFeito: (r: { numero: string; tipo: "total" | "parcial"; valor: number; linhas_liberadas: number }) => void;
}) {
  const [pc, setPc] = useState<PcNum | null>(null);
  const [qtd, setQtd] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState("");
  const [nfNum, setNfNum] = useState("");
  const [nfData, setNfData] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [previa, setPrevia] = useState<{ linhas_liberadas: number; tipo: string } | null>(null);
  useEffect(() => {
    fetch(`/api/pcs/ajuste?empresa=${encodeURIComponent(empresa)}&numero=${encodeURIComponent(numero)}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setPc(j.pc); })
      .catch((e) => setErro((e as Error).message));
  }, [empresa, numero]);
  const linhas = useMemo(() => (pc?.itens ?? []).map((i) => {
    const ja = Number(pc?.devolvido?.[String(i.id)] ?? 0);
    const resta = Math.max(0, (Number(i.qtd) || 0) - ja);
    const vu = (Number(pc?.valorItem?.[String(i.id)] ?? 0) / (Number(i.qtd) || 1)) || Number(i.vu) || 0;
    const q = Math.min(resta, Math.max(0, Number(String(qtd[i.id] ?? "").replace(",", ".")) || 0));
    return { i, ja, resta, vu, q, v: Math.round(vu * q * 100) / 100 };
  }), [pc, qtd]);
  const itens = linhas.filter((l) => l.q > 0).map((l) => ({ pc_item_id: l.i.id, qtd: l.q }));
  const total = linhas.reduce((a, l) => a + l.v, 0);
  const tudo = linhas.length > 0 && linhas.every((l) => l.q >= l.resta - 1e-9);
  const chaveItens = JSON.stringify(itens);
  // prévia (dry-run) do que vai acontecer com a Lista de materiais
  useEffect(() => {
    if (!itens.length) { setPrevia(null); return; }
    const t = window.setTimeout(() => {
      post({ acao: "devolver", empresa, numero, motivo: "prévia", itens, codigo_projeto: codigoProjeto, simular: true })
        .then((j) => setPrevia(j)).catch(() => setPrevia(null));
    }, 350);
    return () => window.clearTimeout(t);
  }, [chaveItens]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirmar = async () => {
    setOcupado(true); setErro(null);
    try {
      const j = await post({ acao: "devolver", empresa, numero, motivo, itens, nf_numero: nfNum, nf_data: nfData, codigo_projeto: codigoProjeto });
      onFeito({ numero, tipo: j.tipo, valor: Number(j.valor) || 0, linhas_liberadas: Number(j.linhas_liberadas) || 0 });
    } catch (e) { setErro((e as Error).message); setOcupado(false); }
  };
  return createPortal(
    <div className="pcaj-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="pcaj largo" role="dialog" aria-modal="true" aria-label={`Devolver material do PC ${numero}`}>
        <div className="hd"><b>Devolver material · PC {numero}</b><button type="button" aria-label="Fechar" onClick={onFechar}>✕</button></div>
        <div className="corpo">
          {pc && <div className="pcaj-id">{pc.forn || "—"} · PC <b className="num">{brl(pc.valor)}</b>{pc.nf ? <> · NF de entrada {pc.nf}</> : null}{pc.origem === "omie" ? " · do Omie" : ""}</div>}
          <p className="dim">O pedido <b>continua ativo</b>. O que voltar ao fornecedor sai da conta do projeto (comprometido, budget, margem, fluxo) e as linhas da Lista voltam a “sem PC” pela quantidade devolvida.</p>
          {!pc && !erro && <small className="dim">carregando os itens…</small>}
          {pc && (
            <div className="pcaj-scroll"><table className="pcaj-t">
              <thead><tr><th>Item</th><th className="r">No PC</th><th className="r">Já devolvido</th><th className="r">Devolver</th><th className="r">Valor</th></tr></thead>
              <tbody>{linhas.map((l) => (
                <tr key={l.i.id} className={l.q > 0 ? "on" : ""}>
                  <td><span className="desc">{l.i.desc}</span>{l.i.cod ? <small> {l.i.cod}</small> : null}</td>
                  <td className="r num">{qtdBR(Number(l.i.qtd) || 0)} {l.i.un ?? ""}</td>
                  <td className="r num">{l.ja ? qtdBR(l.ja) : "—"}</td>
                  <td className="r">{l.resta > 0
                    ? <span className="pcaj-q"><input type="number" min={0} max={l.resta} step="any" inputMode="decimal" aria-label={`Quantidade devolvida de ${l.i.desc}`}
                        value={qtd[l.i.id] ?? ""} placeholder="0" onChange={(e) => setQtd((m) => ({ ...m, [l.i.id]: e.target.value }))} />
                        <button type="button" className="lk" title="Devolver tudo o que resta deste item" onClick={() => setQtd((m) => ({ ...m, [l.i.id]: String(l.resta) }))}>tudo</button></span>
                    : <small className="dim">devolvido</small>}</td>
                  <td className="r num">{l.q > 0 ? brl(l.v) : ""}</td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan={3}>
                <button type="button" className="lk" onClick={() => setQtd(Object.fromEntries(linhas.map((l) => [l.i.id, String(l.resta)])))}>devolver tudo</button>
                {itens.length > 0 && <span className="pcaj-tipo"> · devolução <b>{tudo ? "total" : "parcial"}</b></span>}</td>
                <td className="r"><small>sai do projeto</small></td><td className="r num"><b>{brl(total)}</b></td></tr></tfoot>
            </table></div>
          )}
          {previa && <div className="pcaj-ok">{previa.linhas_liberadas ? <><b>{previa.linhas_liberadas}</b> linha(s) da Lista de materiais voltam a “sem PC” (as de parte da quantidade ganham uma linha “repor”).</> : "Nenhuma linha da Lista está ligada a esses itens."}</div>}
          <label className="pcaj-campo"><span>Motivo <i>obrigatório</i></span>
            <textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: material com defeito; veio a mais" /></label>
          <div className="pcaj-nf">
            <label className="pcaj-campo"><span>NF de devolução nº <i>opcional</i></span><input value={nfNum} onChange={(e) => setNfNum(e.target.value)} placeholder="nº da NF" /></label>
            <label className="pcaj-campo">Data<input type="date" value={nfData} onChange={(e) => setNfData(e.target.value)} /></label>
            <a className="pcaj-link" href={linkNfDevolucao(empresa, { nf: pc?.nf, motivo, pc: numero })} target="_blank" rel="noreferrer"
              title="Abre o Faturamento com a NF-e de devolução (de compra) preenchida a partir da NF de entrada — não emite nada sozinho">emitir NF de devolução ↗</a>
          </div>
          {erro && <div className="pcaj-erro">{erro}</div>}
        </div>
        <div className="pe">
          <button type="button" className="btn sm" onClick={onFechar}>Voltar</button>
          <button type="button" className="btn sm pri" disabled={ocupado || !motivo.trim() || !itens.length} onClick={() => void confirmar()}>
            {ocupado ? "Registrando…" : `Registrar devolução${itens.length ? ` (${brl(total)})` : ""}`}</button>
        </div>
      </div>
    </div>, document.body);
}

type Canc = { numero: string; origem: string; fornecedor: string | null; valor: number | null; motivo: string; por: string | null; em: string; linhas: number };
type Dev = { id: number; numero: string; tipo: "total" | "parcial"; valor: number; valor_pc: number | null; motivo: string; nf_numero: string | null; nf_data: string | null;
  por: string | null; em: string; fornecedor: string | null; origem: string; nf_entrada: string | null; linhas: number;
  itens: { desc: string | null; qtd: number; un: string | null; valor: number }[] };

/** "Cancelados / devolvidos (N)" — recolhida, no fim da tabela de PCs do projeto. */
export function SecaoAjustesPc({ empresa, codigo, tick, $, onMudou }: {
  empresa: string; codigo: number; tick?: number; $?: (v: number | null) => string; onMudou?: (acao: "desfazer_cancelamento" | "desfazer_devolucao", numero: string) => void;
}) {
  const [d, setD] = useState<{ cancelados: Canc[]; devolucoes: Dev[]; admin: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const money = $ ?? brl;
  const carregar = useCallback(() => {
    fetch(`/api/pcs/ajuste?empresa=${encodeURIComponent(empresa)}&codigo=${codigo}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => { if (j.error) setErro(j.error); else setD({ cancelados: j.cancelados ?? [], devolucoes: j.devolucoes ?? [], admin: !!j.admin }); })
      .catch(() => setErro("indisponível"));
  }, [empresa, codigo]);
  useEffect(() => { carregar(); }, [carregar, tick]);
  const n = (d?.cancelados.length ?? 0) + (d?.devolucoes.length ?? 0);
  if (!d || n === 0) return null;
  const desfazer = async (acao: "desfazer_cancelamento" | "desfazer_devolucao", numero: string, id?: number) => {
    if (!window.confirm(acao === "desfazer_cancelamento" ? `Desfazer o cancelamento do PC ${numero}? Ele volta à tabela e às contas do projeto.` : `Desfazer a devolução do PC ${numero}?`)) return;
    try { await post({ acao, empresa, numero, id }); carregar(); onMudou?.(acao, numero); }
    catch (e) { setErro((e as Error).message); }
  };
  return (
    <div className={`pcaj-sec ${aberto ? "open" : ""}`}>
      <button type="button" className="pcaj-sec-hd" aria-expanded={aberto} onClick={() => setAberto((x) => !x)}>
        <span className="car">{aberto ? "▾" : "▸"}</span> Cancelados / devolvidos <b>({n})</b>
        <small>fora da conta do projeto — ficam aqui para rastreio</small>
      </button>
      {aberto && (
        <div className="pcaj-sec-corpo">
          {d.cancelados.map((c) => (
            <div key={`c${c.numero}`} className="pcaj-lin">
              <span className="pc num">{c.numero}</span>
              <span className="pill canc">Cancelado</span>
              <span className="forn">{c.fornecedor || "—"}{c.origem === "omie" && <small className="omie" title="O painel não escreve no Omie"> · do Omie — cancelar também lá</small>}</span>
              <b className="num r">{money(c.valor)}</b>
              <span className="mot" title={c.motivo}>{c.motivo}</span>
              <small className="dim">{quem(c.por)} · {quando(c.em)}{c.linhas ? ` · ${c.linhas} linha(s) liberadas` : ""}</small>
              <span className="acs">{d.admin && <button type="button" className="lk" onClick={() => void desfazer("desfazer_cancelamento", c.numero)}>desfazer cancelamento</button>}</span>
            </div>
          ))}
          {d.devolucoes.map((v) => (
            <div key={`d${v.id}`} className="pcaj-lin">
              <span className="pc num">{v.numero}</span>
              <span className="pill dev">{v.tipo === "total" ? "Devolução total" : "Devolução parcial"}</span>
              <span className="forn" title={v.itens.map((i) => `${qtdBR(Number(i.qtd))} ${i.un ?? ""} × ${i.desc ?? ""}`).join("\n")}>{v.fornecedor || "—"}
                <small> · {v.itens.map((i) => `${qtdBR(Number(i.qtd))} × ${i.desc ?? ""}`).join("; ")}</small></span>
              <b className="num r" title={v.valor_pc != null ? `de ${money(v.valor_pc)} do PC` : undefined}>−{money(v.valor)}</b>
              <span className="mot" title={v.motivo}>{v.motivo}{v.nf_numero ? ` · NF dev. ${v.nf_numero}${v.nf_data ? ` de ${diaBR(v.nf_data)}` : ""}` : ""}</span>
              <small className="dim">{quem(v.por)} · {quando(v.em)}{v.linhas ? ` · ${v.linhas} linha(s) liberadas` : ""}</small>
              <span className="acs">
                {!v.nf_numero && <a className="lk" href={linkNfDevolucao(empresa, { nf: v.nf_entrada, motivo: v.motivo, pc: v.numero })} target="_blank" rel="noreferrer">emitir NF de devolução ↗</a>}
                {d.admin && <button type="button" className="lk" onClick={() => void desfazer("desfazer_devolucao", v.numero, v.id)}>desfazer</button>}
              </span>
            </div>
          ))}
          {erro && <div className="pcaj-erro">{erro}</div>}
        </div>
      )}
    </div>
  );
}
