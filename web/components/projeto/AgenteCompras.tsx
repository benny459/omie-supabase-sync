"use client";

// ✨ Agente de compras (08/10/26, spec F) — dentro da etapa ③ da Lista de materiais.
// Monta os lotes (um PC por fornecedor por data) com lib/planejamento-compras.montarLotes —
// a mesma função do servidor e do cron —, explica cada data, confere o caixa contra os
// recebimentos das vendas e deixa AGENDAR: no dia, o cron cria o PC (aguardando aprovação)
// e avisa no Webex. Janela e "simular comprar tudo hoje" recalculam na hora, sem gravar.

import { useCallback, useEffect, useMemo, useState } from "react";
import { montarLotes, recebimentosDasVendas, JANELA_PADRAO_DIAS, hojeIso, type ItemLote, type Lote, type LotePersistido, type Recebimento } from "@/lib/planejamento-compras";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const d2 = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : "—");
/** "**negrito**" do motivo → <b> */
const Negrito = ({ t }: { t: string }) => <>{t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <b key={i} className="text-ww-text font-semibold">{p.slice(2, -2)}</b> : <span key={i}>{p}</span>))}</>;

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? r.statusText);
  return j as T;
}

export default function AgenteCompras({ empresa, codigo, itens, forcados, podeGerar, onGerarPc, recarregarToken, filtroIds }: {
  empresa: string; codigo: number; itens: ItemLote[]; forcados: Set<string>; podeGerar: boolean;
  /** caixa de filtro da etapa ③ (08/10/26): só os lotes com algum item destes ids; null = todos */
  filtroIds?: Set<string> | null;
  /** abre a folha do Gerar pedido de compra com os itens do lote; `loteId` = lote agendado (marca "gerado" depois) */
  onGerarPc: (ids: string[], loteId: string | null) => void;
  /** muda quando a lista recarrega (PC gerado etc.) — relê os lotes gravados */
  recarregarToken?: number;
}) {
  const [janela, setJanela] = useState(JANELA_PADRAO_DIAS);
  const [janelaGravada, setJanelaGravada] = useState(JANELA_PADRAO_DIAS);
  const [sim, setSim] = useState(false);
  const [persistidos, setPersistidos] = useState<LotePersistido[]>([]);
  const [pendente, setPendente] = useState(false);
  const [rec, setRec] = useState<Recebimento[]>([]);
  const [manuais, setManuais] = useState<Map<string, string>>(new Map());
  const [motivosIa, setMotivosIa] = useState<Map<string, string>>(new Map());
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [conferido, setConferido] = useState<Map<string, string>>(new Map());

  const carregar = useCallback(async () => {
    try {
      const j = await json<{ janela: number; pendente?: boolean; persistidos: LotePersistido[] }>(await fetch(`/api/rc-projetos/lotes?empresa=${encodeURIComponent(empresa)}&codigo=${codigo}`, { cache: "no-store" }));
      setPersistidos((j.persistidos ?? []).map((l) => ({ ...l, itens: l.itens.map((id) => `db${id}`) })));
      setPendente(!!j.pendente);
      setJanela((x) => (x === janelaGravada ? j.janela : x)); setJanelaGravada(j.janela);
    } catch (e) { setMsg({ t: `Não consegui ler os lotes agendados: ${(e as Error).message}`, erro: true }); }
  }, [empresa, codigo]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, [carregar, recarregarToken]);
  useEffect(() => {
    fetch(`/api/rc-projetos/vendas?empresa=${encodeURIComponent(empresa)}&codigo=${codigo}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => setRec(recebimentosDasVendas(j.docs ?? []))).catch(() => setRec([]));
  }, [empresa, codigo]);

  const hoje = hojeIso();
  const opts = { janela, hoje, persistidos, recebimentos: rec, datasManuais: manuais, forcados };
  const lotes = useMemo(() => montarLotes(itens, { ...opts, simAgora: sim }), [itens, janela, persistidos, rec, manuais, forcados, sim]); // eslint-disable-line react-hooks/exhaustive-deps
  const plano = useMemo(() => (sim ? montarLotes(itens, { ...opts, simAgora: false }) : lotes), [lotes, sim]); // eslint-disable-line react-hooks/exhaustive-deps
  const menorSaldo = (ls: Lote[]) => ls.reduce<{ v: number; d: string | null }>((m, l) => (l.caixaSaldo < m.v ? { v: l.caixaSaldo, d: l.pedir } : m), { v: 0, d: null });

  const post = async (corpo: Record<string, unknown>, chave: string, ok: string) => {
    setOcupado(chave); setMsg(null);
    try {
      const j = await json<Record<string, unknown>>(await fetch("/api/rc-projetos/lotes", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo, ...corpo }) }));
      setMsg({ t: ok }); await carregar(); return j;
    } catch (e) { setMsg({ t: (e as Error).message, erro: true }); return null; }
    finally { setOcupado(null); }
  };
  const agendar = (l: Lote) => post({ acao: "agendar", lote: { forn: l.semFornecedor ? null : l.forn, base: l.base, pedir: l.pedir, motivo: motivosIa.get(l.chave) ?? l.motivo,
    itens: l.itens.map((x) => x.id.replace(/^db/, "")) } }, l.chave,
    `Agendado: em ${d2(l.pedir)} o agente cria o PC de ${l.forn} (aguardando aprovação) e avisa no Webex; na véspera, um lembrete.`);
  const conferir = async (l: Lote) => {
    setOcupado(`c${l.chave}`); setMsg(null);
    try {
      const j = await json<{ corpo: Record<string, unknown>; lote: { itens: string[] } }>(await fetch("/api/rc-projetos/lotes", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo, acao: "gerar", chave: l.id ?? l.chave, simular: true }) }));
      const c = j.corpo;
      setConferido((m) => new Map(m).set(l.chave, `✓ O agente conseguiria gerar: ${String(c.forn)} · categoria ${String(c.cat)} · ${j.lote.itens.length} item(ns) · previsão ${d2(String(c.previsao))}. Nada foi gravado.`));
    } catch (e) { setConferido((m) => new Map(m).set(l.chave, `✕ No dia o agente não geraria sozinho: ${(e as Error).message}`)); }
    finally { setOcupado(null); }
  };
  const explicar = async (l: Lote) => {
    setOcupado(`m${l.chave}`);
    try {
      const j = await json<{ texto: string; ia: boolean }>(await fetch("/api/rc-projetos/lotes", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo, acao: "motivo_ia", chave: l.id ?? l.chave }) }));
      if (j.ia) setMotivosIa((m) => new Map(m).set(l.chave, j.texto)); else setMsg({ t: "A IA não está disponível agora — fica a explicação padrão." });
    } catch (e) { setMsg({ t: (e as Error).message, erro: true }); }
    finally { setOcupado(null); }
  };

  const visiveis = filtroIds ? lotes.filter((l) => l.itens.some((x) => filtroIds.has(x.id))) : lotes;
  const total = lotes.reduce((a, l) => a + l.valor, 0);
  const neg = lotes.filter((l) => l.caixaNeg).length;
  const ultimo = lotes.filter((l) => l.status !== "gerado").map((l) => l.pedir).sort().pop();
  const msPlano = menorSaldo(plano.filter((l) => l.status !== "gerado")), msHoje = menorSaldo(lotes.filter((l) => l.status !== "gerado"));

  return (
    <div className="rounded-xl border border-ww-accent/45 bg-gradient-to-b from-ww-accentSoft to-transparent p-3 space-y-2.5" data-agente>
      <div className="flex items-center gap-3 flex-wrap">
        <b className="text-[13.5px] text-ww-text">✨ Agente de compras</b>
        <span className="text-[11px] text-ww-textMuted flex-1 min-w-[260px]">monta os lotes: junta itens do mesmo fornecedor cujas datas de pedir caem na mesma janela, confere o caixa (recebimentos das vendas) e, agendado, cria o PC no dia e avisa. Você só aprova.</span>
        <label className="text-[11px] text-ww-textMuted flex items-center gap-1.5">janela de consolidação
          <input type="number" min={0} max={60} value={janela} data-janela onChange={(e) => setJanela(Math.max(0, Math.min(60, Number(e.target.value) || 0)))}
            className="w-14 bg-transparent border border-ww-border rounded px-1.5 py-0.5 text-right text-[12px] text-ww-text" /> dias</label>
        {janela !== janelaGravada && !pendente && (
          <button type="button" className="text-[11px] text-ww-accent hover:underline" disabled={!!ocupado}
            onClick={() => void post({ acao: "janela", janela }, "janela", `Janela de ${janela} dias gravada como padrão da empresa.`)}>gravar como padrão</button>)}
        <label className="text-[11px] text-ww-textMuted flex items-center gap-1.5"><input type="checkbox" checked={sim} data-sim onChange={(e) => setSim(e.target.checked)} /> simular “comprar tudo hoje”</label>
      </div>
      {pendente && <p className="text-[11px] text-amber-700 dark:text-amber-300">Agendar ainda não está ativo (migração sql/129 pendente) — os lotes e o caixa já funcionam.</p>}
      {msg && <p className={`text-[11.5px] ${msg.erro ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-300"}`}>{msg.t}</p>}
      {filtroIds && lotes.length > 0 && <p className="text-[11px] text-ww-textMuted" data-lotes-filtrados>{visiveis.length} de {lotes.length} lote(s) com itens da caixa escolhida{visiveis.length < lotes.length ? ` · ${lotes.length - visiveis.length} oculto(s) pelo filtro` : ""}</p>}
      {!lotes.length
        ? <p className="text-[11.5px] text-ww-textMuted">Nada a comprar — todos os itens têm PC ou estão sem “necessário em”.</p>
        : !visiveis.length ? <p className="text-[11.5px] text-ww-textMuted">Nenhum lote com itens desta caixa.</p>
        : <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
          {visiveis.map((l) => {
            const cls = l.status === "gerado" ? "opacity-60 border-ww-border" : l.status === "agendado" ? "border-emerald-500/60" : l.atrasado ? "border-rose-500/60" : l.urgente ? "border-amber-500/60" : "border-ww-border";
            const pill = l.status === "gerado" ? ["PC gerado", "bg-ww-rowHover text-ww-textMuted"] : l.status === "agendado" ? ["🔔 agendado", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"]
              : l.atrasado ? ["pedir hoje", "bg-rose-500/15 text-rose-700 dark:text-rose-300"] : l.urgente ? ["esta semana", "bg-amber-500/15 text-amber-800 dark:text-amber-200"] : ["proposto", "bg-ww-accentSoft text-ww-accent"];
            return (
              <div key={l.chave} data-lote={l.chave} data-lote-forn={l.forn}
                className={`rounded-lg border bg-[rgb(var(--color-ww-panel))] p-2.5 flex flex-col gap-1.5 min-w-0 ${cls} ${l.forcado ? "ring-2 ring-ww-accent/60" : ""}`}>
                <div className="flex items-baseline justify-between gap-2"><b className="text-[12.5px] text-ww-text truncate" title={l.forn}>{l.forn}</b>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${pill[1]}`}>{pill[0]}</span></div>
                <div className="text-[18px] font-bold text-ww-text tabular-nums">{l.atrasado && l.status !== "gerado" && l.pedir === hoje ? "hoje" : d2(l.pedir)}
                  <small className="ml-1.5 text-[11px] font-medium text-ww-textFaint">pedir · chega ≈ {d2(l.chega)} · {l.prazo}d</small></div>
                <div className="text-[11.5px] text-ww-textMuted leading-snug">{motivosIa.get(l.chave) ? <>{motivosIa.get(l.chave)} <small className="text-ww-textFaint">(IA)</small></> : <Negrito t={l.motivo} />}</div>
                <ul className="text-[11.5px] space-y-0.5">{l.itens.map((x) => (
                  <li key={x.id} className={`flex justify-between gap-2 min-w-0 ${filtroIds && !filtroIds.has(x.id) ? "opacity-45" : ""}`}><span className="truncate" title={x.item}>{x.qtd} {x.un} · {x.item}</span><em className="not-italic text-ww-textFaint shrink-0">até {d2(x.plano.comprarAte)}</em></li>))}</ul>
                <div className="flex items-baseline justify-between"><small className="text-ww-textFaint">{l.itens.length} {l.itens.length === 1 ? "item" : "itens"}{l.pedidoNum ? ` · PC ${l.pedidoNum}` : ""}</small><b className="tabular-nums text-ww-text">{brl(l.valor)}</b></div>
                <div className={`text-[11px] px-2 py-1 rounded bg-ww-rowHover/60 ${l.caixaNeg ? "text-amber-700 dark:text-amber-300" : "text-ww-textMuted"}`}>{l.caixaMsg}</div>
                {conferido.get(l.chave) && <div className="text-[11px] text-ww-textMuted">{conferido.get(l.chave)}</div>}
                {l.status === "gerado" ? <small className="text-ww-textMuted">PC criado — aprovar em Compras › Aprovações PC</small> : (
                  <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                    <button type="button" disabled={!podeGerar || !!ocupado} onClick={() => onGerarPc(l.itens.map((x) => x.id), l.id)}
                      title={podeGerar ? "Abre a folha do pedido de compra com os itens do lote (dá para Simular antes)" : "Salve a lista antes"}
                      className="px-2 py-0.5 rounded bg-ww-accent text-white text-[11px] font-semibold hover:brightness-110 disabled:opacity-40">🧾 Gerar PC{l.atrasado ? " agora" : ""}</button>
                    {l.status !== "agendado"
                      ? <button type="button" disabled={!!ocupado || pendente || sim} onClick={() => void agendar(l)} data-agendar
                          title={`No dia ${d2(l.pedir)} o agente cria o PC (aguardando aprovação) e avisa no Webex; na véspera, um lembrete`}
                          className="px-2 py-0.5 rounded border border-ww-border text-[11px] hover:border-ww-accent disabled:opacity-40">{ocupado === l.chave ? "…" : `🔔 Agendar p/ ${d2(l.pedir)}`}</button>
                      : <button type="button" disabled={!!ocupado} onClick={() => void post({ acao: "cancelar", id: l.id }, l.chave, "Agendamento cancelado — os itens voltam para os lotes propostos.")}
                          className="px-2 py-0.5 rounded border border-ww-border text-[11px] hover:border-rose-400">cancelar agendamento</button>}
                    <label className="text-[11px] text-ww-textMuted flex items-center gap-1">mover p/
                      <input type="date" value={l.pedir} min={hoje} disabled={!!ocupado || sim}
                        onChange={(e) => { const v = e.target.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
                          if (l.status === "agendado" && l.id) void post({ acao: "mover", id: l.id, data: v }, l.chave, `Lote movido para ${d2(v)}.`);
                          else setManuais((m) => new Map(m).set(l.chave, v)); }}
                        className="bg-transparent border border-ww-border rounded px-1 py-0 text-[11px] text-ww-text" /></label>
                    <button type="button" disabled={!!ocupado} onClick={() => void conferir(l)} title="Confere, sem gravar, o PC que o agente montaria no dia (fornecedor, categoria, itens)"
                      className="text-[10.5px] text-ww-textMuted hover:text-ww-text">{ocupado === `c${l.chave}` ? "…" : "conferir PC"}</button>
                    <button type="button" disabled={!!ocupado} onClick={() => void explicar(l)} title="Reescreve a explicação com a Claude, só com os fatos do lote"
                      className="text-[10.5px] text-ww-textMuted hover:text-ww-text">{ocupado === `m${l.chave}` ? "…" : "✨ explicar"}</button>
                  </div>)}
              </div>);
          })}
        </div>}
      {lotes.length > 0 && (
        <div className="flex gap-2.5 flex-wrap text-[12px]" data-sim-resumo>
          <div className="rounded-lg bg-ww-rowHover/60 px-2.5 py-1.5">Total a comprar: <b className="tabular-nums">{brl(total)}</b> em <b>{lotes.length} lote(s)</b></div>
          <div className="rounded-lg bg-ww-rowHover/60 px-2.5 py-1.5">Lotes com caixa apertado: <b>{neg}</b></div>
          {ultimo && <div className="rounded-lg bg-ww-rowHover/60 px-2.5 py-1.5">Último pedido em <b>{d2(ultimo)}</b></div>}
          {sim && <div className="rounded-lg border border-amber-500/60 px-2.5 py-1.5">Simulando tudo hoje: menor saldo de caixa <b className="tabular-nums">{brl(msHoje.v)}</b>{msHoje.d ? ` (${d2(msHoje.d)})` : ""} × no plano <b className="tabular-nums">{brl(msPlano.v)}</b>{msPlano.d ? ` (${d2(msPlano.d)})` : ""} — desmarque para voltar ao plano.</div>}
        </div>)}
    </div>
  );
}
