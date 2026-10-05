"use client";

/**
 * Painel "Casar" da conciliação (05/10/26, sql/73) — um componente só para a tela de
 * Conciliação bancária e para as abas de conciliação do Pagar v3 / Receber v1.
 *
 * Abre pela direita com um movimento do extrato e mostra:
 *  • candidatos de TODOS os títulos em aberto (Omie + painel) com a pontuação e os motivos
 *    (valor exato/próximo, vencimento, CNPJ/nome/nº do documento no histórico, nosso número,
 *    aprendido) e grupos de parcelas cuja soma bate;
 *  • busca livre: nome/fantasia, CNPJ, NF, PV/OS/PC, nº do título, valor ("1.234,56"),
 *    faixa de valor e de vencimento, todas as empresas;
 *  • seleção múltipla com total × movimento e o que fazer com a diferença
 *    (juros/multa, desconto, deixar parcial);
 *  • criar título e conciliar (com fornecedor/cliente do cadastro e categoria), transferência
 *    entre contas, ignorar com motivo e criar regra num clique.
 * Ao casar, o trecho do histórico fica associado ao cliente/fornecedor ("aprendido").
 *
 * Teclado (com o painel aberto): "/" vai para a busca, Enter casa a seleção (ou o 1º
 * candidato), Esc fecha. j/k na lista continuam a navegar entre movimentos.
 *
 * Uso: <CasarHost /> montado uma vez na tela; abrir com abrirCasar(movimentoId).
 * Depois de qualquer ação o host dispara o evento "conc:atualizar" (a tela recarrega).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Cand = {
  ref: string; natureza: "P" | "R"; empresa: string; origem: string; contraparte: string | null; razao: string | null; cnpj: string | null;
  documento: string | null; nf: string | null; pedido: string | null; vencimento: string | null; previsao: string | null;
  valor: number; saldo: number; fase: string | null; score: number; motivos: string[];
};
type Grupo = { grupo: true; chave: string; contraparte: string | null; cnpj: string | null; n: number; soma: number; vencimento: string | null;
  rotulo: string; motivos: string[]; itens: { ref: string; saldo: number; documento: string | null; vencimento: string | null; contraparte: string | null }[] };
type MovInfo = { id: number; empresa: string; cod_cc: number; data: string; valor: number; memo: string | null; nome: string | null;
  natureza: "P" | "R"; restante: number; chave: string | null };
type Resp = { movimento: MovInfo; aliases: { contraparte: string; cnpj: string | null; usos: number }[]; candidatos: Cand[]; grupos: Grupo[]; pode_baixar?: boolean };
type Transf = { id: number; empresa: string; cod_cc: number; data: string; valor: number; memo: string | null; conta: string | null };
type Pessoa = { codigo: number; razao: string; fantasia: string | null; doc: string | null };

export function abrirCasar(movimentoId: number) {
  window.dispatchEvent(new CustomEvent("conc:casar", { detail: { movimentoId } }));
}

const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dm = (s: string | null) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(2, 4)}` : "—");
const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".")) || 0;
const fmtIn = (v: number) => v.toFixed(2).replace(".", ",");

const C = {
  bg: "var(--ww-panel, var(--panel, #0f1a2c))", bg2: "var(--ww-panel-sunken, var(--panel2, #13203a))",
  line: "var(--ww-border, var(--line, #1e2d48))", line2: "var(--ww-border-strong, var(--line2, #28395a))",
  tx: "var(--ww-text, var(--tx, #e8eef8))", tx2: "var(--ww-text-muted, var(--tx2, #9fb0cc))", tx3: "var(--ww-text-faint, var(--tx3, #6b7d9c))",
  ok: "var(--ww-ok-text, #22c55e)", bad: "var(--ww-crit-text, #ef4444)", warn: "var(--ww-warn-text, #f59e0b)", ac: "var(--ww-accent-text, #60a5fa)",
};
const inp: React.CSSProperties = { padding: "6px 9px", borderRadius: 9, fontSize: 12.5, border: `1px solid ${C.line2}`, background: C.bg2, color: C.tx, outline: "none" };
const btn = (cor: string, cheio = false): React.CSSProperties => ({
  fontSize: 12.5, padding: "6px 12px", borderRadius: 9, cursor: "pointer", border: `1px solid ${cheio ? cor : C.line2}`,
  background: cheio ? cor : "transparent", color: cheio ? "#06121f" : cor, fontWeight: 600, whiteSpace: "nowrap",
});
const chip = (cor: string): React.CSSProperties => ({ fontSize: 10.5, padding: "1px 7px", borderRadius: 999, border: `1px solid ${cor}`, color: cor, whiteSpace: "nowrap" });
const corMotivo = (m: string) => m.startsWith("valor exato") || m.startsWith("soma exata") ? C.ok
  : m.startsWith("CNPJ") || m.startsWith("nosso") || m.startsWith("aprendido") || m.startsWith("nº") ? C.ac
  : m.startsWith("nome") ? C.ac : C.tx2;

export function CasarHost() {
  const [mov, setMov] = useState<number | null>(null);
  useEffect(() => {
    const h = (e: Event) => setMov((e as CustomEvent<{ movimentoId: number }>).detail?.movimentoId ?? null);
    window.addEventListener("conc:casar", h);
    return () => window.removeEventListener("conc:casar", h);
  }, []);
  if (!mov) return null;
  return <CasarPainel key={mov} movimentoId={mov} onFechar={() => setMov(null)} />;
}

export default function CasarPainel({ movimentoId, onFechar }: { movimentoId: number; onFechar: () => void }) {
  const [d, setD] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aba, setAba] = useState<"casar" | "criar" | "transf" | "ignorar">("casar");
  const [q, setQ] = useState("");
  const [vmin, setVmin] = useState(""); const [vmax, setVmax] = useState("");
  const [vde, setVde] = useState(""); const [vate, setVate] = useState("");
  const [todas, setTodas] = useState(false);
  const [sel, setSel] = useState<Record<string, { valor: string; cand: { contraparte: string | null; documento: string | null; saldo: number } }>>({});
  const [dif, setDif] = useState<"juros" | "desconto" | "parcial">("parcial");
  const [aprender, setAprender] = useState(true);
  const buscaRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    try {
      const p = new URLSearchParams({ candidatos: String(movimentoId), lim: "80" });
      if (q.trim()) p.set("q", q.trim());
      if (vmin.trim()) p.set("vmin", String(num(vmin))); if (vmax.trim()) p.set("vmax", String(num(vmax)));
      if (vde) p.set("venc_de", vde); if (vate) p.set("venc_ate", vate); if (todas) p.set("todas", "1");
      const r = await fetch(`/api/financeiro/conciliacao?${p}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setD(j);
    } catch (e) { setErro((e as Error).message); }
    finally { setCarregando(false); }
  }, [movimentoId, q, vmin, vmax, vde, vate, todas]);

  // primeira carga imediata; buscas com pausa
  const primeira = useRef(true);
  useEffect(() => {
    if (primeira.current) { primeira.current = false; carregar(); return; }
    const t = setTimeout(carregar, 400);
    return () => clearTimeout(t);
  }, [carregar]);

  const m = d?.movimento;
  const restante = m ? Number(m.restante) : 0;
  const soma = useMemo(() => r2(Object.values(sel).reduce((s, x) => s + num(x.valor), 0)), [sel]);
  const diferenca = r2(restante - soma); // >0: movimento maior que os títulos; <0: títulos maiores

  function marcar(ref: string, cand: { contraparte: string | null; documento: string | null; saldo: number }, ligar: boolean) {
    setSel((s) => {
      const n = { ...s };
      if (!ligar) { delete n[ref]; return n; }
      const usado = Object.values(s).reduce((a, x) => a + num(x.valor), 0);
      const v = Math.max(0, Math.min(Number(cand.saldo), r2(restante - usado)));
      n[ref] = { valor: fmtIn(v > 0 ? v : Number(cand.saldo)), cand };
      return n;
    });
  }

  async function post(corpo: object, ok: string) {
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const r = await fetch("/api/financeiro/conciliacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setAviso(ok); window.dispatchEvent(new Event("conc:atualizar"));
      return j;
    } catch (e) { setErro((e as Error).message); return null; }
    finally { setOcupado(false); }
  }

  async function casar(itensDiretos?: { ref: string; valor: number }[]) {
    if (!m) return;
    let itens: { ref: string; valor: number; juros?: number; desconto?: number }[];
    if (itensDiretos) itens = itensDiretos;
    else {
      itens = Object.entries(sel).map(([ref, x]) => ({ ref, valor: r2(num(x.valor)) })).filter((x) => x.valor > 0);
      if (!itens.length) return;
      if (Math.abs(diferenca) >= 0.005) {
        if (diferenca > 0 && dif === "juros") itens[0] = { ...itens[0], juros: diferenca };
        else if (diferenca < 0 && dif === "desconto") itens[0] = { ...itens[0], desconto: -diferenca };
        else if (diferenca < 0) { // baixa parcial: tira o excesso do último título
          const k = itens.length - 1; itens[k] = { ...itens[k], valor: r2(itens[k].valor + diferenca) };
          if (itens[k].valor <= 0) { setErro("A seleção passa o valor do movimento — tire um título ou use desconto."); return; }
        }
      }
    }
    const j = await post({ acao: "casar", movimento_id: m.id, casar: itens, aprender },
      `Casado em ${itens.length} título(s)${aprender && m.chave ? ` · "${m.chave}" aprendido` : ""}`);
    if (j) { setSel({}); if (Number(j.restante ?? 0) <= 0.004) setTimeout(onFechar, 600); else carregar(); }
  }

  // teclado do painel
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      const emCampo = !!alvo && (alvo.tagName === "INPUT" || alvo.tagName === "SELECT" || alvo.tagName === "TEXTAREA");
      if (e.key === "Escape") { e.stopPropagation(); onFechar(); return; }
      if (e.key === "/" && !emCampo) { e.preventDefault(); e.stopPropagation(); setAba("casar"); setTimeout(() => buscaRef.current?.focus(), 0); return; }
      if (e.key === "Enter" && !emCampo && aba === "casar" && !ocupado && d?.pode_baixar) {
        e.preventDefault(); e.stopPropagation();
        if (Object.keys(sel).length) { casar(); return; }
        const c1 = d?.candidatos[0];
        if (c1 && restante > 0) casar([{ ref: c1.ref, valor: Math.min(Number(c1.saldo), restante) }]);
      }
    }
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  });

  return (
    <div role="dialog" aria-label="Casar movimento" style={{
      position: "fixed", top: 0, right: 0, bottom: 0, width: "min(760px, 100vw)", zIndex: 60, background: C.bg,
      borderLeft: `1px solid ${C.line2}`, boxShadow: "-20px 0 50px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", color: C.tx,
    }}>
      {/* cabeçalho do movimento */}
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${C.line}`, display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: C.tx3, letterSpacing: ".06em", textTransform: "uppercase" }}>
            Casar movimento · {m ? `${dm(m.data)} · ${m.empresa}` : "…"}
          </div>
          <div style={{ fontSize: 14, marginTop: 3, wordBreak: "break-word" }}>{m ? (m.memo || m.nome || "—") : "Carregando…"}</div>
          {m?.nome && m.memo && <div style={{ fontSize: 12, color: C.tx2 }}>{m.nome}</div>}
          {!!d?.aliases?.length && <div style={{ fontSize: 11.5, color: C.ac, marginTop: 3 }}>aprendido: {d.aliases.map((a) => a.contraparte).join(", ")}</div>}
        </div>
        {m && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: m.valor < 0 ? C.bad : C.ok }}>{m.valor < 0 ? "−" : "+"}{brl(Math.abs(m.valor))}</div>
            <div style={{ fontSize: 11.5, color: C.tx2 }}>{restante > 0.004 ? `falta casar ${brl(restante)}` : "todo casado"}</div>
          </div>
        )}
        <button type="button" onClick={onFechar} title="Fechar (Esc)" style={{ ...btn(C.tx2), padding: "4px 10px" }}>✕</button>
      </div>

      {/* abas */}
      <div style={{ display: "flex", gap: 4, padding: "8px 18px 0", borderBottom: `1px solid ${C.line}` }}>
        {([["casar", m?.natureza === "R" ? "Casar com contas a receber" : "Casar com contas a pagar"], ["criar", "Criar título"], ["transf", "Transferência"], ["ignorar", "Ignorar"]] as const).map(([k, t]) => (
          <button key={k} type="button" onClick={() => setAba(k)} style={{
            fontSize: 12.5, padding: "7px 12px", border: 0, borderBottom: `2px solid ${aba === k ? C.ac : "transparent"}`,
            background: "transparent", color: aba === k ? C.tx : C.tx2, cursor: "pointer", fontWeight: aba === k ? 600 : 500,
          }}>{t}</button>
        ))}
      </div>

      {erro && <div style={{ margin: "10px 18px 0", padding: "8px 12px", borderRadius: 9, border: `1px solid ${C.bad}`, color: C.bad, fontSize: 12.5 }}>{erro}</div>}
      {aviso && <div style={{ margin: "10px 18px 0", padding: "8px 12px", borderRadius: 9, border: `1px solid ${C.ok}`, color: C.ok, fontSize: 12.5 }}>{aviso}</div>}

      <div style={{ flex: 1, overflow: "auto", padding: "12px 18px" }}>
        {aba === "casar" && (<>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            <input ref={buscaRef} value={q} onChange={(e) => setQ(e.target.value)} autoFocus
              placeholder="Buscar: cliente/fornecedor, CNPJ, NF, PV/OS/PC, nº do título ou valor (1.234,56)   [ / ]"
              style={{ ...inp, flex: "1 1 320px" }} />
            <input value={vmin} onChange={(e) => setVmin(e.target.value)} placeholder="valor de" inputMode="decimal" style={{ ...inp, width: 88 }} />
            <input value={vmax} onChange={(e) => setVmax(e.target.value)} placeholder="até" inputMode="decimal" style={{ ...inp, width: 80 }} />
            <span style={{ fontSize: 11.5, color: C.tx3 }}>venc.</span>
            <input type="date" value={vde} onChange={(e) => setVde(e.target.value)} style={{ ...inp, width: 132 }} />
            <input type="date" value={vate} onChange={(e) => setVate(e.target.value)} style={{ ...inp, width: 132 }} />
            <label style={{ fontSize: 12, color: C.tx2, display: "inline-flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={todas} onChange={(e) => setTodas(e.target.checked)} /> todas as empresas
            </label>
            {(q || vmin || vmax || vde || vate || todas) && (
              <button type="button" style={btn(C.tx2)} onClick={() => { setQ(""); setVmin(""); setVmax(""); setVde(""); setVate(""); setTodas(false); }}>limpar</button>
            )}
          </div>

          {carregando && !d && <div style={{ fontSize: 12.5, color: C.tx2 }}>Procurando títulos em aberto…</div>}

          {!!d?.grupos?.length && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.tx3, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 6 }}>Grupos (soma exata)</div>
              {d.grupos.map((g) => (
                <div key={g.chave} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 10px", marginBottom: 6, display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}><b>{g.contraparte ?? "—"}</b> · {g.rotulo} · {brl(g.soma)}</div>
                    <div style={{ fontSize: 11.5, color: C.tx3 }}>{g.itens.map((i) => `${i.documento ?? i.ref} ${brl(i.saldo)}`).join(" + ")}</div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>{g.motivos.map((x) => <span key={x} style={chip(corMotivo(x))}>{x}</span>)}</div>
                  </div>
                  {d.pode_baixar && <button type="button" disabled={ocupado} style={btn(C.ok, true)}
                    onClick={() => casar(g.itens.map((i) => ({ ref: i.ref, valor: Number(i.saldo) })))}>casar grupo</button>}
                </div>
              ))}
            </div>
          )}

          {d && (
            <div style={{ fontSize: 11, color: C.tx3, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 6 }}>
              {q || vmin || vmax || vde || vate ? `Resultado da busca · ${d.candidatos.length}` : `Sugestões · ${d.candidatos.length}`}
              {carregando && " · atualizando…"}
            </div>
          )}
          {d && !d.candidatos.length && (
            <div style={{ fontSize: 12.5, color: C.tx2, padding: "8px 0" }}>
              {q || vmin || vmax || vde || vate ? "Nada encontrado com essa busca." : "Sem sugestão segura. Busque pelo nome, CNPJ, NF ou valor acima — ou crie o título na aba \"Criar título\"."}
            </div>
          )}
          {d?.candidatos.map((c, i) => {
            const on = c.ref in sel;
            const venc = c.previsao && c.previsao !== c.vencimento ? `prev. ${dm(c.previsao)} · venc. ${dm(c.vencimento)}` : `venc. ${dm(c.vencimento)}`;
            return (
              <label key={c.ref} style={{
                display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 10, alignItems: "start", padding: "8px 10px", marginBottom: 6,
                borderRadius: 10, border: `1px solid ${on ? C.ac : C.line}`, background: on ? C.bg2 : "transparent", cursor: "pointer",
              }}>
                <input type="checkbox" checked={on} onChange={(e) => marcar(c.ref, c, e.target.checked)} style={{ marginTop: 3 }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, display: "block" }}>
                    {i === 0 && !q && <span style={{ fontSize: 10, color: C.ok, fontWeight: 700, marginRight: 6 }}>1º</span>}
                    <b>{c.contraparte ?? "—"}</b>{c.razao && c.razao !== c.contraparte ? <span style={{ color: C.tx3 }}> · {c.razao}</span> : null}
                  </span>
                  <span style={{ fontSize: 11.5, color: C.tx2 }}>
                    {[c.documento, c.nf ? `NF ${c.nf}` : null, c.pedido ? `Ped. ${c.pedido}` : null, venc, c.cnpj ? `CNPJ ${c.cnpj}` : null,
                      c.origem === "omie" ? "Omie" : "painel", c.empresa, c.fase && !["A VENCER", "VENCE HOJE", "ATRASADO", "liberado"].includes(c.fase) ? c.fase : (c.fase === "ATRASADO" ? "atrasado" : null)]
                      .filter(Boolean).join(" · ")}
                  </span>
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                    {c.motivos.map((x) => <span key={x} style={chip(corMotivo(x))}>{x}</span>)}
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, display: "block" }}>{brl(c.saldo)}</span>
                  {Number(c.valor) !== Number(c.saldo) && <span style={{ fontSize: 11, color: C.tx3, display: "block" }}>de {brl(c.valor)}</span>}
                  <span style={{ fontSize: 11, color: c.score >= 80 ? C.ok : c.score >= 50 ? C.warn : C.tx3 }}>{c.score} pts</span>
                  {on && (
                    <input value={sel[c.ref].valor} onClick={(e) => e.preventDefault()} inputMode="decimal"
                      onChange={(e) => { const v = e.target.value; setSel((s) => ({ ...s, [c.ref]: { ...s[c.ref], valor: v } })); }}
                      style={{ ...inp, width: 110, marginTop: 4, textAlign: "right" }} title="Quanto abate deste título" />
                  )}
                </span>
              </label>
            );
          })}
        </>)}

        {aba === "criar" && m && <CriarTitulo m={m} restante={restante} ocupado={ocupado} post={post} onFeito={onFechar} />}
        {aba === "transf" && m && <Transferencia m={m} ocupado={ocupado} post={post} onFeito={onFechar} />}
        {aba === "ignorar" && m && <Ignorar m={m} ocupado={ocupado} post={post} onFeito={onFechar} />}
      </div>

      {/* rodapé de seleção */}
      {aba === "casar" && m && d?.pode_baixar && (
        <div style={{ borderTop: `1px solid ${C.line}`, padding: "10px 18px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {Object.keys(sel).length ? (<>
            <span style={{ fontSize: 13 }}>
              {Object.keys(sel).length} título(s) · <b>{brl(soma)}</b> de {brl(restante)}
              {Math.abs(diferenca) >= 0.005 && <span style={{ color: C.warn }}> · diferença {brl(Math.abs(diferenca))}</span>}
            </span>
            {Math.abs(diferenca) >= 0.005 && (
              <select value={dif} onChange={(e) => setDif(e.target.value as typeof dif)} style={{ ...inp, padding: "5px 8px" }}>
                {diferenca > 0
                  ? (<><option value="parcial">deixar o resto pendente</option><option value="juros">lançar a diferença como juros/multa</option></>)
                  : (<><option value="desconto">quitar os títulos com desconto</option><option value="parcial">baixa parcial (abate só o valor do movimento)</option></>)}
              </select>
            )}
            <button type="button" style={btn(C.tx2)} onClick={() => setSel({})}>limpar</button>
          </>) : (
            <span style={{ fontSize: 12, color: C.tx3 }}>Marque um ou mais títulos — ou Enter para casar com o 1º.</span>
          )}
          <label style={{ fontSize: 12, color: C.tx2, display: "inline-flex", gap: 4, alignItems: "center", marginLeft: "auto" }} title="Guarda o trecho do histórico → cliente/fornecedor para as próximas sugestões">
            <input type="checkbox" checked={aprender} onChange={(e) => setAprender(e.target.checked)} /> aprender
          </label>
          <button type="button" disabled={ocupado || restante <= 0.004 || (!Object.keys(sel).length && !d.candidatos.length)} style={btn(C.ok, true)}
            onClick={() => {
              if (Object.keys(sel).length) casar();
              else { const c1 = d.candidatos[0]; if (c1) casar([{ ref: c1.ref, valor: Math.min(Number(c1.saldo), restante) }]); }
            }}>
            {ocupado ? "Casando…" : Object.keys(sel).length ? "Casar (Enter)" : "Casar com o 1º (Enter)"}
          </button>
        </div>
      )}
      {aba === "casar" && d && !d.pode_baixar && (
        <div style={{ borderTop: `1px solid ${C.line}`, padding: "10px 18px", fontSize: 12, color: C.tx3 }}>Sem permissão para baixar títulos — só consulta.</div>
      )}
    </div>
  );
}

// ── Criar título e conciliar ─────────────────────────────────────────────────
const cacheCats = new Map<string, { codigo: string; descricao: string }[]>();
function CriarTitulo({ m, restante, ocupado, post, onFeito }: {
  m: MovInfo; restante: number; ocupado: boolean; post: (c: object, ok: string) => Promise<unknown>; onFeito: () => void;
}) {
  const chave = `${m.empresa}:${m.natureza}`;
  const [cats, setCats] = useState(cacheCats.get(chave) ?? []);
  const [cat, setCat] = useState("");
  const [desc, setDesc] = useState(m.memo ?? m.nome ?? "");
  const [qp, setQp] = useState("");
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [pessoa, setPessoa] = useState<Pessoa | null>(null);
  const [regra, setRegra] = useState(false);
  const [contem, setContem] = useState(m.chave ?? (m.memo ?? "").replace(/\d{3,}.*$/, "").trim().slice(0, 40));
  useEffect(() => {
    if (cacheCats.has(chave)) return;
    fetch(`/api/financeiro/aux?empresa=${m.empresa}&tipo=${m.natureza === "P" ? "pagar" : "receber"}`).then((r) => r.json()).then((j) => {
      const cs = ((j.categorias ?? []) as { codigo: string; descricao: string }[]).map((c) => ({ codigo: c.codigo, descricao: c.descricao }));
      cacheCats.set(chave, cs); setCats(cs);
    }).catch(() => null);
  }, [chave, m.empresa, m.natureza]);
  useEffect(() => {
    if (qp.trim().length < 2) { setPessoas([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/cadastros?papel=${m.natureza === "P" ? "fornecedor" : "cliente"}&emp=${m.empresa}&q=${encodeURIComponent(qp.trim())}`)
        .then((r) => r.json()).then((j) => setPessoas(((j.linhas ?? []) as Pessoa[]).slice(0, 8))).catch(() => null);
    }, 300);
    return () => clearTimeout(t);
  }, [qp, m.natureza, m.empresa]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
      <div style={{ color: C.tx2 }}>Cria {m.natureza === "P" ? "uma conta a pagar" : "uma conta a receber"} de <b>{brl(restante)}</b> com a data do movimento e já concilia.</div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ color: C.tx3 }}>{m.natureza === "P" ? "Fornecedor" : "Cliente"} (cadastro)</span>
        {pessoa ? (
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <b>{pessoa.fantasia || pessoa.razao}</b><span style={{ color: C.tx3 }}>{pessoa.doc ?? ""}</span>
            <button type="button" style={btn(C.tx2)} onClick={() => setPessoa(null)}>trocar</button>
          </span>
        ) : (<>
          <input value={qp} onChange={(e) => setQp(e.target.value)} placeholder="nome, fantasia ou CNPJ" style={inp} />
          {pessoas.map((p) => (
            <button key={p.codigo} type="button" onClick={() => { setPessoa(p); setPessoas([]); }}
              style={{ ...btn(C.tx), textAlign: "left", fontWeight: 500 }}>{p.fantasia || p.razao} <span style={{ color: C.tx3 }}>· {p.doc ?? "sem doc"}</span></button>
          ))}
        </>)}
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ color: C.tx3 }}>Categoria</span>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={inp}>
          <option value="">escolha…</option>
          {cats.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descricao}</option>)}
        </select>
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ color: C.tx3 }}>Descrição</span>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} style={inp} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={ocupado || !cat || restante <= 0.004} style={btn(C.ok, true)}
          onClick={async () => {
            const j = await post({ acao: "lancar", movimento_id: m.id, categoria: cat, descricao: desc || m.memo, pessoa: pessoa ? String(pessoa.codigo) : null },
              `Título criado e conciliado: ${brl(restante)}`);
            if (j) setTimeout(onFeito, 600);
          }}>Criar título e conciliar</button>
        <button type="button" style={btn(C.tx2)} onClick={() => setRegra((v) => !v)}>{regra ? "fechar regra" : "criar regra…"}</button>
      </div>
      {regra && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: `1px dashed ${C.line}`, paddingTop: 10 }}>
          <span style={{ color: C.tx2 }}>Sempre que o histórico contiver</span>
          <input value={contem} onChange={(e) => setContem(e.target.value)} style={{ ...inp, width: 200 }} />
          <span style={{ color: C.tx2 }}>→ lançar na categoria escolhida (só nesta conta)</span>
          <button type="button" disabled={ocupado || contem.trim().length < 3 || !cat} style={btn(C.ac)}
            onClick={() => post({ acao: "regra_criar", contem, acao_regra: "lancar", categoria: cat, descricao: desc || null,
              natureza: m.natureza, empresa: m.empresa, cod_cc: m.cod_cc }, `Regra criada: "${contem}" — vale nas próximas importações`)}>salvar regra</button>
        </div>
      )}
    </div>
  );
}

// ── Transferência entre contas ───────────────────────────────────────────────
function Transferencia({ m, ocupado, post, onFeito }: {
  m: MovInfo; ocupado: boolean; post: (c: object, ok: string) => Promise<unknown>; onFeito: () => void;
}) {
  const [lista, setLista] = useState<Transf[] | null>(null);
  useEffect(() => {
    fetch(`/api/financeiro/conciliacao?transferencia=${m.id}`).then((r) => r.json()).then((j) => setLista(j.candidatos ?? [])).catch(() => setLista([]));
  }, [m.id]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
      <div style={{ color: C.tx2 }}>Movimento entre contas próprias: não baixa título. Os dois lados ficam marcados como transferência (dá para desfazer).</div>
      {!lista && <div style={{ color: C.tx3 }}>Procurando o outro lado…</div>}
      {lista && !lista.length && <div style={{ color: C.tx3 }}>Nenhum movimento oposto de {brl(Math.abs(m.valor))} em outra conta (±3 dias). O extrato da outra conta pode não ter sido importado.</div>}
      {lista?.map((t) => (
        <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", border: `1px solid ${C.line}`, borderRadius: 10, padding: "8px 10px" }}>
          <span style={{ flex: 1 }}>{t.conta ?? t.cod_cc} ({t.empresa}) · {dm(t.data)} · {t.memo ?? "—"}</span>
          <b style={{ color: t.valor < 0 ? C.bad : C.ok }}>{t.valor < 0 ? "−" : "+"}{brl(Math.abs(t.valor))}</b>
          <button type="button" disabled={ocupado} style={btn(C.ok, true)}
            onClick={async () => { if (await post({ acao: "transferencia", movimento_id: m.id, par: t.id }, "Transferência entre contas marcada nos dois extratos")) setTimeout(onFeito, 600); }}>
            é este
          </button>
        </div>
      ))}
      <div>
        <button type="button" disabled={ocupado} style={btn(C.tx2)}
          onClick={async () => { if (await post({ acao: "transferencia", movimento_id: m.id, par: null }, "Marcado como transferência (sem o outro lado)")) setTimeout(onFeito, 600); }}>
          marcar como transferência sem o outro lado
        </button>
      </div>
    </div>
  );
}

// ── Ignorar ─────────────────────────────────────────────────────────────────
function Ignorar({ m, ocupado, post, onFeito }: {
  m: MovInfo; ocupado: boolean; post: (c: object, ok: string) => Promise<unknown>; onFeito: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [regra, setRegra] = useState(false);
  const [contem, setContem] = useState(m.chave ?? (m.memo ?? "").replace(/\d{3,}.*$/, "").trim().slice(0, 40));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
      <div style={{ color: C.tx2 }}>Para o que não tem título nem deve virar um (estorno, aplicação/resgate, ajuste…). Fica registado com o motivo.</div>
      <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="motivo" style={inp} />
      <label style={{ fontSize: 12, color: C.tx2, display: "inline-flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={regra} onChange={(e) => setRegra(e.target.checked)} /> ignorar sempre que o histórico contiver
        <input value={contem} onChange={(e) => setContem(e.target.value)} disabled={!regra} style={{ ...inp, width: 180 }} />
      </label>
      <div>
        <button type="button" disabled={ocupado || !motivo.trim()} style={btn(C.tx, true)}
          onClick={async () => {
            if (regra && contem.trim().length >= 3) {
              await post({ acao: "regra_criar", contem, acao_regra: "ignorar", motivo, natureza: m.natureza, empresa: m.empresa, cod_cc: m.cod_cc }, "Regra criada");
            }
            if (await post({ acao: "ignorar", movimento_id: m.id, motivo }, "Movimento ignorado")) setTimeout(onFeito, 600);
          }}>Ignorar</button>
      </div>
    </div>
  );
}
