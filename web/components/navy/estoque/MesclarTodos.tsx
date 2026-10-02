"use client";

/**
 * Duplicidades › "Mesclar todos" (02/10/26) e a lista de mesclagens feitas.
 * Prévia de todos os grupos (só nomes iguais, ou todos inclusive parecidos) com o principal sugerido
 * (mais movimentos em 12 meses → maior valor em estoque → PC mais recente), editável por grupo.
 * Um clique mescla tudo num LOTE; cada grupo fica como mesclagem própria: dá para desfazer um grupo,
 * trocar o principal dele, ou desfazer o lote inteiro. Só o administrador. Nada vai ao Omie.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ItemEstoque } from "@/lib/estoque";
import { Pill, brl, ddmmaa, kbrl, postar, q } from "./comum";

type Membro = { n_cod_prod: number; codigo: string; codigo_novo: string | null; descricao: string; unidade: string | null; saldo: number; cmc: number; valor: number; mov12: number; ult_pc: string | null };
type GrupoPrevia = { chave: string; tipo: "exata" | "parecido"; sim_min: number; membros: Membro[]; principal: number; motivo: string };
type Totais = { grupos: number; exatas: number; parecidos: number; codigos_que_saem: number; grupos_grandes: number; valor_transferido: number; com_saldo: number };
type Escopo = "exatas" | "todos";

export function MesclarTodos({ fechar, feito, avisar }: {
  fechar: () => void; feito: () => Promise<void>; avisar: (t: string, tom?: "ok" | "crit") => void;
}) {
  const [escopo, setEscopo] = useState<Escopo>("exatas");
  const [prev, setPrev] = useState<Record<Escopo, { grupos: GrupoPrevia[]; totais: Totais } | null>>({ exatas: null, todos: null });
  const [erro, setErro] = useState<string | null>(null);
  const [princ, setPrinc] = useState<Record<string, number>>({});
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [confirmar, setConfirmar] = useState(false);
  const [indo, setIndo] = useState(false);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  useEffect(() => {
    for (const e of ["exatas", "todos"] as Escopo[]) {
      fetch(`/api/estoque/duplicidade?previa=${e}`, { cache: "no-store" })
        .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? r.statusText); setPrev((p) => ({ ...p, [e]: { grupos: j.grupos, totais: j.totais } })); })
        .catch((x) => setErro((x as Error).message));
    }
  }, []);

  const atual = prev[escopo];
  const grupos = useMemo(() => atual?.grupos ?? [], [atual]);
  const pid = useCallback((g: GrupoPrevia) => princ[g.chave] ?? g.principal, [princ]);
  const escolhidos = grupos.filter((g) => !fora.has(g.chave));
  const resumo = useMemo(() => {
    const sec = escolhidos.flatMap((g) => g.membros.filter((m) => m.n_cod_prod !== pid(g)));
    return { grupos: escolhidos.length, saem: sec.length, valor: sec.reduce((s, m) => s + m.valor, 0), editados: escolhidos.filter((g) => pid(g) !== g.principal).length };
  }, [escolhidos, pid]);

  const mesclar = async () => {
    if (!confirmar) { setConfirmar(true); return; }
    setIndo(true);
    try {
      const r = await postar("/api/estoque/duplicidade", {
        acao: "mesclar_lote", escopo,
        grupos: escolhidos.map((g) => ({ principal: pid(g), membros: g.membros.map((m) => m.n_cod_prod), tipo: g.tipo })),
      }) as { resultado?: { lote_id: number; grupos: number; erros: { principal: string; erro: string }[] } };
      const res = r.resultado;
      avisar(`Lote #${res?.lote_id}: ${res?.grupos ?? 0} grupos mesclados${res?.erros?.length ? ` · ${res.erros.length} com erro (${res.erros[0].erro})` : ""}`, res?.erros?.length ? "crit" : "ok");
      await feito();
      fechar();
    } catch (e) { avisar((e as Error).message, "crit"); setConfirmar(false); } finally { setIndo(false); }
  };

  const alterna = (k: string, s: Set<string>, set: (x: Set<string>) => void) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); set(n); };

  return (
    <div className="cartao" style={{ borderColor: "var(--ww-accent)" }}>
      <div className="head" style={{ padding: "14px 16px", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ margin: 0 }}>Mesclar todos</h3>
          <div className="mini">Cada grupo vira uma mesclagem própria dentro de um lote: depois dá para desfazer um grupo, trocar o principal ou desfazer o lote inteiro. Só no painel — nada vai ao Omie.</div>
        </div>
        <div className="seg" role="tablist">
          <button className={escopo === "exatas" ? "on" : ""} onClick={() => { setEscopo("exatas"); setConfirmar(false); }}>Só nomes iguais{prev.exatas ? <span className="b">{prev.exatas.totais.grupos}</span> : null}</button>
          <button className={escopo === "todos" ? "on" : ""} onClick={() => { setEscopo("todos"); setConfirmar(false); }}>Todos, inclusive parecidos{prev.todos ? <span className="b">{prev.todos.totais.grupos}</span> : null}</button>
        </div>
        <button className="btn sm" onClick={fechar}>Fechar</button>
      </div>
      {erro && <div className="aviso t-crit" style={{ margin: "0 16px 12px" }}>{erro}</div>}
      {!atual && !erro && <div className="vazio">Montando a prévia dos grupos…</div>}
      {atual && (<>
        <section className="kpis" style={{ padding: "0 16px" }}>
          <div className="kpi hero" style={{ cursor: "default" }}><div className="r">Grupos a mesclar</div><div className="v">{q(resumo.grupos)}</div><div className="s">de {q(grupos.length)} · {atual.totais.exatas} nome igual · {atual.totais.parecidos} parecidos</div></div>
          <div className="kpi" style={{ cursor: "default" }}><div className="r">Códigos que saem da lista</div><div className="v">{q(resumo.saem)}</div><div className="s">respondem no principal (Kardex, PCs, uso, saldo)</div></div>
          <div className="kpi" style={{ cursor: "default" }}><div className="r">Saldo transferido</div><div className="v">{kbrl(resumo.valor)}</div><div className="s">ao CMC · {atual.totais.com_saldo} códigos com saldo</div></div>
          <div className="kpi" style={{ cursor: "default" }}><div className="r">Principal trocado à mão</div><div className="v">{q(resumo.editados)}</div><div className="s">{atual.totais.grupos_grandes ? `${atual.totais.grupos_grandes} grupos com 4+ códigos — confira` : "nenhum grupo grande"}</div></div>
        </section>
        <div className="aviso t-info" style={{ margin: "0 16px 10px" }}>
          <span><b>Principal sugerido:</b> o código com mais movimentos nos últimos 12 meses; empate → maior valor em estoque; empate → PC mais recente. Clique noutro código do grupo para trocar. Desmarque o grupo para deixá-lo de fora.</span>
        </div>
        <div style={{ maxHeight: "60vh", overflow: "auto", borderTop: "1px solid var(--ww-border)" }}>
          {grupos.map((g) => {
            const p = pid(g), dentro = !fora.has(g.chave), ab = abertos.has(g.chave) || g.membros.length > 3;
            const pr = g.membros.find((m) => m.n_cod_prod === p)!;
            return (
              <div key={g.chave} className="grupo" style={{ opacity: dentro ? 1 : 0.5 }}>
                <div className="grupo-h" style={{ flexWrap: "wrap" }}>
                  <input type="checkbox" checked={dentro} onChange={() => alterna(g.chave, fora, setFora)} aria-label="Incluir este grupo" />
                  <b style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{pr.descricao}</b>
                  <Pill t={g.tipo === "exata" ? "nome igual" : `parecido ≥ ${Math.round(g.sim_min * 100)}%`} tom={g.tipo === "exata" ? "violet" : "info"} />
                  {g.membros.length > 3 && <Pill t={`${g.membros.length} códigos — confira`} tom="warn" />}
                  <div className="sp" />
                  <span className="mini">fica <b>{pr.codigo_novo ?? pr.codigo}</b>{p === g.principal ? ` · ${g.motivo}` : " · escolhido por você"}</span>
                  <button className="btn sm" onClick={() => alterna(g.chave, abertos, setAbertos)}>{ab ? "Fechar" : "Ver códigos"}</button>
                </div>
                {ab && (
                  <div className="cands">
                    {g.membros.map((m) => (
                      <div key={m.n_cod_prod} className={`cand ${m.n_cod_prod === p ? "princ" : ""}`} role="radio" aria-checked={m.n_cod_prod === p} tabIndex={0}
                        onClick={() => { setPrinc((x) => ({ ...x, [g.chave]: m.n_cod_prod })); setConfirmar(false); }}
                        onKeyDown={(e) => e.key === "Enter" && setPrinc((x) => ({ ...x, [g.chave]: m.n_cod_prod }))}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                          <input type="radio" readOnly checked={m.n_cod_prod === p} />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>{m.codigo_novo ? `${m.codigo_novo} · ` : ""}{m.codigo}</div>
                            <div className="mini" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.descricao}</div>
                          </div>
                          {m.n_cod_prod === p && <span style={{ marginLeft: "auto" }}><Pill t="principal" tom="ok" /></span>}
                        </div>
                        <div className="kv"><span>Movimentos 12 m</span><b>{q(m.mov12)}</b></div>
                        <div className="kv"><span>Saldo · valor</span><b style={{ color: m.saldo < 0 ? "var(--ww-crit-text)" : undefined }}>{q(m.saldo)} {(m.unidade ?? "").toLowerCase()} · {brl(m.valor)}</b></div>
                        <div className="kv"><span>Último PC</span><b>{ddmmaa(m.ult_pc)}</b></div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {!grupos.length && <div className="vazio">Nenhum grupo para mesclar neste escopo.</div>}
        </div>
        <div className="tfoot" style={{ gap: 10, flexWrap: "wrap" }}>
          <span>{q(resumo.grupos)} grupos · {q(resumo.saem)} códigos saem · {kbrl(resumo.valor)} transferidos</span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {confirmar && <button className="btn sm" onClick={() => setConfirmar(false)} disabled={indo}>Voltar</button>}
            <button className={`btn sm ${confirmar ? "crit" : "pri"}`} disabled={indo || !resumo.grupos} onClick={mesclar}>
              {indo ? "Mesclando…" : confirmar ? `Confirmar: mesclar ${q(resumo.grupos)} grupos agora` : `Mesclar ${q(resumo.grupos)} grupos`}
            </button>
          </span>
        </div>
      </>)}
    </div>
  );
}

// ── Mesclagens feitas (lotes e grupos) ──────────────────────────────────────
export type GrupoMescla = { id: number; lote_id: number | null; principal: number; membros: number[]; tipo: string; created_by_email: string | null; created_at: string };
export type LoteMescla = { id: number; escopo: string; n_grupos: number; n_erros: number; created_by_email: string | null; created_at: string };

export function ListaMesclagens({ grupos, lotes, porId, admin, abrir, aoMudar, avisar }: {
  grupos: GrupoMescla[]; lotes: LoteMescla[]; porId: Map<number, ItemEstoque>; admin: boolean;
  abrir: (p: ItemEstoque) => void; aoMudar: () => Promise<void>; avisar: (t: string, tom?: "ok" | "crit") => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const cod = (id: number) => { const p = porId.get(Number(id)); return p ? p.codigo_novo ?? p.codigo : String(id); };
  const quando = (s: string) => new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const fazer = async (k: string, corpo: Record<string, unknown>, ok: string) => {
    setOcupado(k);
    try {
      const r = await postar("/api/estoque/duplicidade", corpo) as { resultado?: { erros?: { erro: string }[] } };
      const er = r.resultado?.erros ?? [];
      avisar(er.length ? `${ok}, mas ${er.length} grupo(s) não: ${er[0].erro}` : ok, er.length ? "crit" : "ok");
      await aoMudar();
    } catch (e) { avisar((e as Error).message, "crit"); } finally { setOcupado(null); }
  };
  if (!grupos.length) return null;
  const blocos: { k: string; lote: LoteMescla | null; gs: GrupoMescla[] }[] = [
    ...lotes.map((l) => ({ k: `l${l.id}`, lote: l, gs: grupos.filter((g) => Number(g.lote_id) === Number(l.id)) })),
    { k: "avulsos", lote: null, gs: grupos.filter((g) => g.lote_id == null) },
  ].filter((b) => b.gs.length);

  return (
    <div className="cartao">
      <div className="head" style={{ padding: "12px 16px" }}><h3 style={{ margin: 0 }}>Mesclagens feitas</h3>
        <span className="mini">{q(grupos.length)} grupos ativos · {q(grupos.reduce((s, g) => s + g.membros.length - 1, 0))} códigos respondem num principal</span></div>
      {blocos.map((b) => {
        const ab = abertos.has(b.k) || b.gs.length <= 5;
        return (
          <div key={b.k}>
            <div className="mov-dia" onClick={() => setAbertos((s) => { const n = new Set(s); if (n.has(b.k)) n.delete(b.k); else n.add(b.k); return n; })} role="button" tabIndex={0}>
              <span style={{ display: "inline-flex", transform: `rotate(${ab ? 90 : 0}deg)`, transition: ".15s" }}>›</span>
              <b>{b.lote ? `Lote #${b.lote.id} · ${b.lote.escopo === "todos" ? "todos, inclusive parecidos" : "só nomes iguais"}` : "Grupos mesclados um a um"}</b>
              <span className="mini">{b.gs.length} grupos{b.lote ? ` · ${b.lote.created_by_email ?? "—"} · ${quando(b.lote.created_at)}` : ""}</span>
              <span style={{ marginLeft: "auto" }} onClick={(e) => e.stopPropagation()}>
                {admin && b.lote && <button className="btn sm" disabled={!!ocupado}
                  onClick={() => fazer(b.k, { acao: "desfazer_lote", id: b.lote!.id }, `Lote #${b.lote!.id} desfeito — saldos voltaram`)}>
                  {ocupado === b.k ? "Desfazendo…" : "Desfazer o lote inteiro"}</button>}
              </span>
            </div>
            {ab && (
              <div className="scroll"><table className="tabela"><tbody>
                {b.gs.map((g) => {
                  const pr = porId.get(Number(g.principal)), outros = g.membros.map(Number).filter((m) => m !== Number(g.principal));
                  return (
                    <tr key={g.id}>
                      <td style={{ minWidth: 200 }}>
                        <button className="link" onClick={() => pr && abrir(pr)}><b>{cod(g.principal)}</b></button> <span className="mini">← {outros.map(cod).join(", ")}</span>
                        <div className="mini" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 420 }}>{pr?.descricao ?? ""}</div>
                      </td>
                      <td><Pill t={g.tipo === "parecido" ? "parecido" : "nome igual"} tom={g.tipo === "parecido" ? "info" : "violet"} /></td>
                      <td style={{ whiteSpace: "nowrap" }}>{admin && <>
                        <select className="inp" style={{ height: 30, width: 150 }} disabled={!!ocupado} value="" aria-label="Trocar o principal"
                          onChange={(e) => { const id = Number(e.target.value); if (id) fazer(`g${g.id}`, { acao: "trocar_principal", id: g.id, principal: id }, `Principal agora é ${cod(id)}`); }}>
                          <option value="">Trocar principal…</option>
                          {outros.map((m) => <option key={m} value={m}>{cod(m)}</option>)}
                        </select>{" "}
                        <button className="btn sm" disabled={!!ocupado} onClick={() => fazer(`g${g.id}`, { acao: "desfazer_grupo", id: g.id }, "Grupo desfeito — saldos voltaram")}>
                          {ocupado === `g${g.id}` ? "…" : "Desfazer"}</button>
                      </>}</td>
                    </tr>
                  );
                })}
              </tbody></table></div>
            )}
          </div>
        );
      })}
    </div>
  );
}
