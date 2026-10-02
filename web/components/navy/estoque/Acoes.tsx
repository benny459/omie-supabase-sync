"use client";

/**
 * Diálogos do Estoque v2 que gravam (sempre SÓ no painel — nada vai ao Omie):
 *   ModalSenha    — entra numa janela de inventário com a senha que o Benny passou
 *   ModalAjuste   — ajuste de saldo por local (prévia entrada/saída, valor ao CMC, saldo final)
 *   ModalMesclar  — escolhe o código principal, mostra a prévia e mescla (admin)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { nomeLocal, type ItemEstoque } from "@/lib/estoque";
import { brl, ddmmaa, entrarInventario, escopoTxt, postar, q, type SessaoInv } from "./comum";

function Ov({ children, fechar, lg }: { children: React.ReactNode; fechar: () => void; lg?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [fechar]);
  return (
    <div className="est-ov mid" onClick={fechar} role="dialog" aria-modal="true">
      <div className={`modal ${lg ? "lg" : ""}`} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}

const Cab = ({ t, s, fechar }: { t: string; s?: string; fechar: () => void }) => (
  <div className="mh">
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{t}</div>
      {s && <div className="mini" style={{ marginTop: 2, color: "var(--ww-text-muted)", fontSize: 12 }}>{s}</div>}
    </div>
    <button className="x" onClick={fechar} aria-label="Fechar">×</button>
  </div>
);

// ── Senha da janela ──────────────────────────────────────────────────────────
export function ModalSenha({ fechar, ok }: { fechar: () => void; ok: (s: SessaoInv) => void }) {
  const [c, setC] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => { setTimeout(() => inp.current?.focus(), 10); }, []);
  const entrar = async () => {
    setIndo(true); setErro(null);
    try { ok(await entrarInventario(c)); } catch (e) { setErro((e as Error).message); } finally { setIndo(false); }
  };
  return (
    <Ov fechar={fechar}>
      <Cab t="Senha de inventário" s="O Benny gera a senha ao abrir uma janela de inventário. Ela vale até a janela vencer." fechar={fechar} />
      <div className="mb">
        <label className="f">Senha (6 caracteres)
          <input ref={inp} className="inp" value={c} maxLength={8} autoComplete="off" spellCheck={false}
            onChange={(e) => setC(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && c.length >= 6 && entrar()}
            style={{ fontFamily: "ui-monospace, Menlo, monospace", letterSpacing: ".3em", fontSize: 18, height: 44 }} />
        </label>
        {erro && <div className="aviso t-crit">{erro}</div>}
      </div>
      <div className="mf"><button className="btn" onClick={fechar}>Cancelar</button>
        <button className="btn pri" onClick={entrar} disabled={indo || c.replace(/[^A-Z0-9]/gi, "").length < 6}>{indo ? "Conferindo…" : "Entrar"}</button></div>
    </Ov>
  );
}

// ── Ajuste de saldo ──────────────────────────────────────────────────────────
const MOTIVOS = ["Inventário / contagem", "Perda ou avaria", "Erro de lançamento", "Consumo interno não lançado", "Transferência entre locais"];

export function ModalAjuste({ p, sessao, fechar, ok }: { p: ItemEstoque; sessao: SessaoInv; fechar: () => void; ok: () => void }) {
  const esc = sessao.janela.escopo ?? {};
  const locais = esc.local ? p.locais.filter((l) => l.local === esc.local) : p.locais;
  const inicial = Math.max(0, locais.findIndex((l) => l.saldo < 0));
  const [li, setLi] = useState(inicial);
  const loc = locais[li];
  const [cont, setCont] = useState<string>(loc ? String(Math.max(0, loc.saldo)) : "0");
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  useEffect(() => { if (loc) setCont(String(Math.max(0, loc.saldo))); }, [li]); // eslint-disable-line react-hooks/exhaustive-deps

  const foraEscopo = !!esc.familia && (p.familia ?? "") !== esc.familia;
  const c = Number(String(cont).replace(",", "."));
  const d = loc && Number.isFinite(c) ? c - loc.saldo : 0, v = Math.abs(d) * (loc?.cmc || p.cmc), u = p.unidade.toLowerCase();
  const salvar = async () => {
    setIndo(true); setErro(null);
    try {
      await postar("/api/estoque/ajuste", { codigo: sessao.codigo, empresa: p.empresa, n_cod_prod: p.n_cod_prod, local: loc.local, contagem: c, motivo, obs });
      ok();
    } catch (e) { setErro((e as Error).message); } finally { setIndo(false); }
  };
  return (
    <Ov fechar={fechar}>
      <Cab t="Ajustar saldo" s={`${p.codigo} · ${p.descricao}`} fechar={fechar} />
      <div className="mb">
        <div className="aviso t-info">Janela <b>{sessao.janela.nome}</b> · {escopoTxt(esc, nomeLocal)} · vale até {new Date(sessao.janela.valida_ate).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}. O ajuste fica só no painel — não vai ao Omie.</div>
        {foraEscopo && <div className="aviso t-warn">Esta janela vale só para a família <b>{esc.familia}</b>; este item é da família {p.familia ?? "(sem família)"}.</div>}
        {!locais.length ? <div className="aviso t-warn">Este item não tem o local da janela.</div> : (<>
          <div className="row3">
            <label className="f">Local
              <select className="inp" value={li} onChange={(e) => setLi(Number(e.target.value))}>
                {locais.map((l, i) => <option key={l.local} value={i}>{nomeLocal(l.local)}</option>)}
              </select>
            </label>
            <label className="f">Saldo atual<input className="inp" disabled value={q(loc.saldo)} /></label>
            <label className="f">Contagem física<input className="inp" type="number" step="any" min={0} value={cont} onChange={(e) => setCont(e.target.value)} /></label>
          </div>
          <div className="row2">
            <label className="f">Motivo
              <select className="inp" value={motivo} onChange={(e) => setMotivo(e.target.value)}>{MOTIVOS.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className="f">Custo do ajuste<input className="inp" disabled value={`CMC atual (${brl(loc.cmc || p.cmc)})`} /></label>
          </div>
          <label className="f">Observação<textarea className="inp" value={obs} onChange={(e) => setObs(e.target.value)} placeholder={`Ex.: contagem do almoxarifado em ${ddmmaa(new Date().toISOString())}`} /></label>
          <div className="prev">
            {!Number.isFinite(c) || c < 0 ? "Informe a contagem (0 ou mais)." : d === 0 ? "Sem diferença — nada a lançar." : (<>
              Vai lançar <b style={{ color: `var(--ww-${d > 0 ? "ok" : "crit"}-text)` }}>{d > 0 ? "entrada" : "saída"} de {q(Math.abs(d))} {u}</b> · <b>{brl(v)}</b> ao CMC<br />
              Saldo do {nomeLocal(loc.local)} passa de <b>{q(loc.saldo)}</b> para <b>{q(c)}</b> · total do item fica <b>{q(p.saldo - loc.saldo + c)}</b>
            </>)}
          </div>
        </>)}
        {erro && <div className="aviso t-crit">{erro}</div>}
      </div>
      <div className="mf"><span className="sp">Fica gravado com a janela, quem, quando, saldo antes, contagem, diferença e valor.</span>
        <button className="btn" onClick={fechar}>Cancelar</button>
        <button className="btn pri" onClick={salvar} disabled={indo || foraEscopo || !loc || !Number.isFinite(c) || c < 0 || d === 0}>{indo ? "Gravando…" : "Ajustar"}</button></div>
    </Ov>
  );
}

// ── Mesclar duplicidade ──────────────────────────────────────────────────────
export function ModalMesclar({ itens, fechar, ok, tipo = "exata" }: { itens: ItemEstoque[]; fechar: () => void; ok: (principal: ItemEstoque) => void; tipo?: "exata" | "parecido" }) {
  const ord = useMemo(() => [...itens].sort((a, b) => b.n_mov - a.n_mov), [itens]);
  const [pid, setPid] = useState(ord[0].n_cod_prod);
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  const principal = ord.find((x) => x.n_cod_prod === pid)!, sec = ord.filter((x) => x.n_cod_prod !== pid);
  const locais = [...new Set(ord.flatMap((x) => x.locais.map((l) => l.local)))];
  const soma = (l: string) => ord.reduce((a, x) => a + (x.locais.find((y) => y.local === l)?.saldo ?? 0), 0);
  const u = principal.unidade.toLowerCase();
  const qPos = ord.reduce((a, x) => a + Math.max(x.saldo, 0), 0);
  const cmcPond = qPos > 0 ? ord.reduce((a, x) => a + Math.max(x.saldo, 0) * x.cmc, 0) / qPos : Math.max(...ord.map((x) => x.cmc));
  const mesclar = async () => {
    setIndo(true); setErro(null);
    try {
      // um grupo = uma mesclagem (desfaz inteira ou troca o principal depois)
      await postar("/api/estoque/duplicidade", { acao: "mesclar_grupo", principal: principal.n_cod_prod, membros: ord.map((x) => x.n_cod_prod), tipo });
      ok(principal);
    } catch (e) { setErro((e as Error).message); } finally { setIndo(false); }
  };
  return (
    <Ov fechar={fechar} lg>
      <Cab t="Mesclar duplicidade" s="Escolha o código que fica. O saldo dos outros passa para ele (por local) e eles saem da lista. Nada vai ao Omie." fechar={fechar} />
      <div className="mb">
        <div style={{ display: "grid", gap: 8 }}>
          {ord.map((x) => (
            <div key={x.n_cod_prod} className={`opcao ${x.n_cod_prod === pid ? "on" : ""}`} onClick={() => setPid(x.n_cod_prod)} role="radio" aria-checked={x.n_cod_prod === pid}>
              <input type="radio" checked={x.n_cod_prod === pid} onChange={() => setPid(x.n_cod_prod)} style={{ marginTop: 3 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{x.codigo} <span style={{ fontWeight: 400, color: "var(--ww-text-muted)" }}>· {x.descricao}</span></div>
                <div className="mini" style={{ color: "var(--ww-text-muted)", fontSize: 12 }}>
                  saldo {q(x.saldo)} {u} ({x.locais.map((l) => `${nomeLocal(l.local)} ${q(l.saldo)}`).join(" + ")}) · CMC {brl(x.cmc)} · {q(x.n_mov)} movimentos · última {ddmmaa(x.ult_mov)}
                </div>
              </div>
              {x.n_cod_prod === pid && <span className="aviso t-ok" style={{ padding: "2px 9px", borderRadius: 999, fontWeight: 600, fontSize: 11.5 }}>principal</span>}
            </div>
          ))}
        </div>
        <div className="prev">
          <b>Depois da mesclagem — {principal.codigo}</b><br />
          {locais.map((l) => <span key={l}>{nomeLocal(l)}: <b>{q(soma(l))}</b> {u}{"  ·  "}</span>)}
          total <b>{q(ord.reduce((a, x) => a + x.saldo, 0))}</b> {u} · CMC ponderado <b title="Média pelo estoque positivo de cada código">{brl(cmcPond)}</b> · valor <b>{brl(Math.max(ord.reduce((a, x) => a + x.saldo, 0), 0) * cmcPond)}</b><br />
          <b>Nada se perde:</b> a ficha de {principal.codigo} passa a mostrar também o Kardex, os PCs, fornecedores e preços e os usos de {sec.map((s) => s.codigo).join(", ")} ({q(sec.reduce((a, s) => a + s.n_mov, 0))} movimentos); o código antigo continua achável no ⌘K.
          {sec.some((s) => Math.abs(s.cmc - principal.cmc) / Math.max(principal.cmc, 0.01) > 0.5) && <><br /><span style={{ color: "var(--ww-warn-text)" }}>CMC bem diferente entre os códigos — confira se são mesmo o mesmo item.</span></>}
        </div>
        {erro && <div className="aviso t-crit">{erro}</div>}
      </div>
      <div className="mf"><span className="sp">Grava ajustes “mesclagem” (o administrador pode desfazer).</span>
        <button className="btn" onClick={fechar}>Cancelar</button>
        <button className="btn pri" onClick={mesclar} disabled={indo}>{indo ? "Mesclando…" : `Mesclar em ${principal.codigo}`}</button></div>
    </Ov>
  );
}
