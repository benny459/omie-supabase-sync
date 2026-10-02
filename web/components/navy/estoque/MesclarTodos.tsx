"use client";

/**
 * Duplicidades › "Mesclar todos" (02/10/26) e a lista de mesclagens feitas.
 * Prévia de todos os grupos (só nomes iguais, ou todos inclusive parecidos) com o principal sugerido
 * (mais movimentos em 12 meses → maior valor em estoque → PC mais recente), editável por grupo.
 * Cada grupo mostra "antes (cada código) → depois (principal)": saldo, movimentos, PCs, fornecedores e preços.
 * Barra de ação fixa no rodapé da tela; confirmação em 2 passos com o resumo do que vai acontecer.
 * Um clique mescla tudo num LOTE; cada grupo fica como mesclagem própria: dá para desfazer um grupo,
 * trocar o principal dele, ou desfazer o lote inteiro. Só o administrador. Nada vai ao Omie.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ItemEstoque } from "@/lib/estoque";
import { Pill, brl, ddmmaa, kbrl, postar, q } from "./comum";

type Forn = { fornecedor: string; n: number; soma: number; min: number; max: number; ult: string | null };
type Membro = { n_cod_prod: number; codigo: string; codigo_novo: string | null; descricao: string; unidade: string | null; saldo: number; cmc: number; valor: number; mov12: number; ult_pc: string | null; n_pcs: number; fornecedores: Forn[] };
type GrupoPrevia = { chave: string; tipo: "exata" | "parecido"; sim_min: number; membros: Membro[]; principal: number; motivo: string };
type Totais = { grupos: number; exatas: number; parecidos: number; codigos_que_saem: number; grupos_grandes: number; valor_transferido: number; com_saldo: number };
type Escopo = "exatas" | "todos";

/** O que o principal passa a ter depois da mesclagem (soma de todos os códigos do grupo). */
function depois(g: GrupoPrevia) {
  const forn = new Map<string, Forn>();
  for (const m of g.membros) for (const f of m.fornecedores) {
    const a = forn.get(f.fornecedor);
    forn.set(f.fornecedor, a ? { fornecedor: f.fornecedor, n: a.n + f.n, soma: a.soma + f.soma, min: Math.min(a.min, f.min), max: Math.max(a.max, f.max), ult: [a.ult, f.ult].filter(Boolean).sort().slice(-1)[0] ?? null } : { ...f });
  }
  // CMC do principal depois: média ponderada pelo estoque positivo de cada código (igual à ficha);
  // se nenhum tem estoque positivo, o maior CMC do grupo
  const qPos = g.membros.reduce((s, m) => s + Math.max(m.saldo, 0), 0);
  const cmc = qPos > 0 ? g.membros.reduce((s, m) => s + Math.max(m.saldo, 0) * m.cmc, 0) / qPos : Math.max(...g.membros.map((m) => m.cmc));
  const saldo = g.membros.reduce((s, m) => s + m.saldo, 0);
  return {
    saldo, cmc,
    valor: Math.max(saldo, 0) * cmc,
    mov12: g.membros.reduce((s, m) => s + m.mov12, 0),
    n_pcs: g.membros.reduce((s, m) => s + m.n_pcs, 0),
    fornecedores: [...forn.values()].sort((a, b) => b.n - a.n),
  };
}

const GARANTIA = "Nada se perde: movimentos, PCs, fornecedores e preços, usos por cliente e saldo dos outros códigos passam a aparecer na ficha do principal. O código antigo continua achável (⌘K leva ao principal) e a mesclagem pode ser desfeita.";

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
    return {
      grupos: escolhidos.length, saem: sec.length, valor: sec.reduce((s, m) => s + m.valor, 0), editados: escolhidos.filter((g) => pid(g) !== g.principal).length,
      mov12: sec.reduce((s, m) => s + m.mov12, 0), pcs: sec.reduce((s, m) => s + m.n_pcs, 0), negativos: sec.filter((m) => m.saldo < 0).length,
    };
  }, [escolhidos, pid]);

  const mesclar = async () => {
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
  const nomeEscopo = escopo === "exatas" ? "só nomes iguais" : "todos, inclusive parecidos";
  const explicaSaldo = "Soma de saldo × CMC dos códigos que saem da lista. Fica negativa quando esses códigos estão com saldo negativo (saiu mais do que entrou no Omie): o principal herda esse negativo — nada é apagado, só muda de código.";

  return (
    <div className="cartao" style={{ borderColor: "var(--ww-accent)", paddingBottom: 84 }}>
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
        <div className="aviso t-ok" style={{ margin: "0 16px 10px" }}><span><b>Mesclar não perde nada.</b> {GARANTIA}</span></div>
        <section className="kpis" style={{ padding: "0 16px" }}>
          <div className="kpi hero" style={{ cursor: "default" }}><div className="r">Grupos a mesclar</div><div className="v">{q(resumo.grupos)}</div><div className="s">de {q(grupos.length)} · {atual.totais.exatas} nome igual · {atual.totais.parecidos} parecidos</div></div>
          <div className="kpi" style={{ cursor: "default" }}><div className="r">Códigos que saem da lista</div><div className="v">{q(resumo.saem)}</div><div className="s">{q(resumo.mov12)} movimentos (12 m) e {q(resumo.pcs)} PCs deles passam ao principal</div></div>
          <div className="kpi" style={{ cursor: "default" }} title={explicaSaldo}><div className="r">Saldo transferido ao principal ⓘ</div><div className="v">{kbrl(resumo.valor)}</div>
            <div className="s">{resumo.valor < 0 ? `negativo porque ${q(resumo.negativos)} dos códigos que saem estão com saldo negativo — o principal herda, nada some` : "saldo × CMC dos códigos que saem"}</div></div>
          <div className="kpi" style={{ cursor: "default" }}><div className="r">Principal trocado à mão</div><div className="v">{q(resumo.editados)}</div><div className="s">{atual.totais.grupos_grandes ? `${atual.totais.grupos_grandes} grupos com 4+ códigos — confira` : "nenhum grupo grande"}</div></div>
        </section>
        <div className="aviso t-info" style={{ margin: "0 16px 10px" }}>
          <span><b>Principal sugerido:</b> o código com mais movimentos nos últimos 12 meses; empate → maior valor em estoque; empate → PC mais recente. Em “Ver códigos”, clique noutro código para trocar e veja o antes → depois. Desmarque o grupo para deixá-lo de fora.</span>
        </div>
        <div style={{ maxHeight: "60vh", overflow: "auto", borderTop: "1px solid var(--ww-border)" }}>
          {grupos.map((g) => {
            const p = pid(g), dentro = !fora.has(g.chave), ab = abertos.has(g.chave);
            const pr = g.membros.find((m) => m.n_cod_prod === p)!;
            const dp = depois(g);
            return (
              <div key={g.chave} className="grupo" style={{ opacity: dentro ? 1 : 0.5 }}>
                <div className="grupo-h" style={{ flexWrap: "wrap" }}>
                  <input type="checkbox" checked={dentro} onChange={() => { alterna(g.chave, fora, setFora); setConfirmar(false); }} aria-label="Incluir este grupo" />
                  <b style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{pr.descricao}</b>
                  <Pill t={g.tipo === "exata" ? "nome igual" : `parecido ≥ ${Math.round(g.sim_min * 100)}%`} tom={g.tipo === "exata" ? "violet" : "info"} />
                  {g.membros.length > 3 && <Pill t={`${g.membros.length} códigos — confira`} tom="warn" />}
                  <div className="sp" />
                  <span className="mini">fica <b>{pr.codigo_novo ?? pr.codigo}</b>{p === g.principal ? ` · ${g.motivo}` : " · escolhido por você"}</span>
                  <button className="btn sm" onClick={() => alterna(g.chave, abertos, setAbertos)}>{ab ? "Fechar" : "Ver códigos"}</button>
                </div>
                {ab && (<>
                  <div className="mini" style={{ padding: "0 16px 6px" }}>Antes — cada código (clique para escolher o principal)</div>
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
                        <div className="kv"><span>Saldo · valor</span><b style={{ color: m.saldo < 0 ? "var(--ww-crit-text)" : undefined }}>{q(m.saldo)} {(m.unidade ?? "").toLowerCase()} · {brl(m.valor)}</b></div>
                        <div className="kv"><span>Movimentos 12 m</span><b>{q(m.mov12)}</b></div>
                        <div className="kv"><span>PCs · fornecedores</span><b>{q(m.n_pcs)} · {q(m.fornecedores.length)}</b></div>
                        <div className="kv"><span>Último PC</span><b>{ddmmaa(m.ult_pc)}</b></div>
                      </div>
                    ))}
                  </div>
                  <div className="prev" style={{ margin: "4px 16px 14px" }}>
                    <b>Depois — tudo no principal {pr.codigo_novo ?? pr.codigo}</b><br />
                    Saldo <b style={{ color: dp.saldo < 0 ? "var(--ww-crit-text)" : undefined }}>{q(dp.saldo)} {(pr.unidade ?? "").toLowerCase()}</b> · CMC ponderado <b title="Média pelo estoque positivo de cada código">{brl(dp.cmc)}</b> · valor <b>{brl(dp.valor)}</b> · <b>{q(dp.mov12)}</b> movimentos em 12 m · <b>{q(dp.n_pcs)}</b> PCs · <b>{q(dp.fornecedores.length)}</b> fornecedores
                    {dp.fornecedores.length > 0 && (
                      <div className="scroll" style={{ marginTop: 8 }}><table className="tabela">
                        <thead><tr><th>Fornecedor</th><th className="r">Compras</th><th className="r">Mín.</th><th className="r">Média</th><th className="r">Máx.</th><th className="opt">Última</th></tr></thead>
                        <tbody>{dp.fornecedores.slice(0, 8).map((f) => (
                          <tr key={f.fornecedor}><td>{f.fornecedor}</td><td className="r">{q(f.n)}</td><td className="r">{brl(f.min)}</td><td className="r">{brl(f.soma / Math.max(f.n, 1))}</td><td className="r">{brl(f.max)}</td><td className="opt">{ddmmaa(f.ult)}</td></tr>
                        ))}</tbody>
                      </table>{dp.fornecedores.length > 8 && <div className="mini" style={{ paddingTop: 4 }}>+ {dp.fornecedores.length - 8} fornecedores</div>}</div>
                    )}
                  </div>
                </>)}
              </div>
            );
          })}
          {!grupos.length && <div className="vazio">Nenhum grupo para mesclar neste escopo.</div>}
        </div>

        {/* Barra fixa: sempre visível enquanto a prévia está aberta. */}
        <div className="barra-acao" role="region" aria-label="Mesclar os grupos selecionados">
          <div style={{ minWidth: 0, flex: 1 }}>
            <b>{q(resumo.grupos)} grupos selecionados</b> <span className="mini">· {nomeEscopo} · {q(resumo.saem)} códigos saem · saldo transferido {kbrl(resumo.valor)}</span>
          </div>
          <button className="btn sm pri" disabled={indo || !resumo.grupos} onClick={() => setConfirmar(true)}>Mesclar {q(resumo.grupos)} grupos selecionados…</button>
        </div>

        {confirmar && (
          <div className="est-ov" onClick={() => !indo && setConfirmar(false)} role="dialog" aria-modal="true" aria-label="Confirmar mesclagem">
            <div className="pal" style={{ width: "min(900px, 100%)" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--ww-border)" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Confirmar: mesclar {q(resumo.grupos)} grupos ({nomeEscopo})</div>
                <div className="mini">{q(resumo.saem)} códigos saem da lista · {q(resumo.mov12)} movimentos (12 m) e {q(resumo.pcs)} PCs passam aos principais · saldo transferido {kbrl(resumo.valor)}{resumo.valor < 0 ? " (negativo: os códigos que saem estão negativos)" : ""}</div>
              </div>
              <div style={{ padding: 16, display: "grid", gap: 10, maxHeight: "60vh", overflow: "auto" }}>
                <div className="aviso t-ok"><span><b>Mesclar não perde nada.</b> {GARANTIA}</span></div>
                <div className="scroll"><table className="tabela">
                  <thead><tr><th>Principal ← códigos que entram</th><th className="r">Saldo depois</th><th className="r">CMC ponderado</th><th className="r">Valor depois</th><th className="r">Mov. 12 m</th><th className="r">PCs</th><th className="r">Fornec.</th></tr></thead>
                  <tbody>{escolhidos.map((g) => {
                    const p = pid(g), pr = g.membros.find((m) => m.n_cod_prod === p)!, dp = depois(g);
                    return (
                      <tr key={g.chave}>
                        <td><b>{pr.codigo_novo ?? pr.codigo}</b> <span className="mini">← {g.membros.filter((m) => m.n_cod_prod !== p).map((m) => m.codigo_novo ?? m.codigo).join(", ")}</span>
                          <div className="mini" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pr.descricao}</div></td>
                        <td className="r" style={{ color: dp.saldo < 0 ? "var(--ww-crit-text)" : undefined }}>{q(dp.saldo)}</td>
                        <td className="r">{brl(dp.cmc)}</td><td className="r">{brl(dp.valor)}</td><td className="r">{q(dp.mov12)}</td><td className="r">{q(dp.n_pcs)}</td><td className="r">{q(dp.fornecedores.length)}</td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              </div>
              <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--ww-border)", flexWrap: "wrap", alignItems: "center" }}>
                <span className="mini" style={{ flex: 1 }}>Cada grupo vira uma mesclagem própria (desfaz sozinho); o lote inteiro também desfaz. Nada vai ao Omie.</span>
                <button className="btn" onClick={() => setConfirmar(false)} disabled={indo}>Voltar</button>
                <button className="btn crit" onClick={mesclar} disabled={indo}>{indo ? "Mesclando…" : `Confirmar: mesclar ${q(resumo.grupos)} grupos agora`}</button>
              </div>
            </div>
          </div>
        )}
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
