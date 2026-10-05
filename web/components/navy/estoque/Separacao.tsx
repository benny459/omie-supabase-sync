"use client";

/**
 * Separação de material para PROJETO (05/10/26, pedido do Benny).
 * "Quando fechamos um projeto, separamos material para ele — movimentar como se já estivesse separado, em batelada."
 *
 * Reserva por projeto (sql/63): separar tira do DISPONÍVEL e põe no RESERVADO do projeto (saldo igual);
 * devolver faz o inverso; consumir dá saída real do reservado (movimento "Consumo em projeto", CMC vai para o projeto).
 * Cada lançamento é um lote atômico, desfazível inteiro. Nada vai ao Omie.
 *
 *  - ModalSeparacao: escolhe o projeto (código PJ…/nome), carrega os itens das RC/PC do projeto + já separados,
 *    quantidade editável por linha (padrão = o que falta, limitado ao disponível), "+ item", "Colar do Excel",
 *    faltantes (copiar lista para comprar) e histórico de lotes com "Desfazer".
 *  - SecaoSeparadosProjeto: a seção "Materiais separados" da tela do projeto (devolver/consumir por item).
 *  - ReservasDoItem: na ficha do item, o reservado por projeto.
 *  - BadgeSeparadoProjeto: selo na lista de Projetos (uma chamada para todos os projetos).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { nomeLocal, textoBusca, type ItemEstoque } from "@/lib/estoque";
import { Pill, brl, postar, q, useItensEstoque, useToast, invalidarItens } from "./comum";
import "./estoque.css";

type Tipo = "separar" | "devolver" | "consumir";
type Projeto = { codigo: number; nome: string; separados?: number };
type Cand = {
  n_cod_prod: number; codigo: string | null; codigo_omie: string | null; descricao: string | null; unidade: string | null;
  saldo: number; disponivel: number; separado: number; necessario: number | null; origem: "RC" | "PC" | "separado"; cmc: number;
  local_sugerido: number | null; no_estoque: boolean;
};
type Linha = Cand & { k: number; qtd: string };
export type LoteSep = {
  id: number; tipo: Tipo; projeto_codigo: number; projeto_nome: string | null; solicitante_nome: string | null; motivo: string | null;
  obs: string | null; status: "aplicado" | "desfeito"; n_linhas: number; quantidade: number; valor: number; created_by_email: string | null;
  created_at: string; desfeito_por_email: string | null; desfeito_em: string | null;
};

const ROTULO: Record<Tipo, string> = { separar: "Separar p/ projeto", devolver: "Devolver ao estoque", consumir: "Consumir no projeto" };
const DICA: Record<Tipo, string> = {
  separar: "Tira do disponível e reserva para o projeto. O saldo do estoque não muda.",
  devolver: "O material separado volta a ficar disponível para qualquer uso.",
  consumir: "Baixa do estoque o que foi separado — o custo (CMC) vai para o projeto.",
};
let SEQ = 1;
const num = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".")) || 0;
const n = (v: unknown) => Number(v ?? 0) || 0;
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

async function pegar<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? r.statusText);
  return (j as { dados: T }).dados;
}
const normCand = (c: Record<string, unknown>): Cand => ({
  ...(c as unknown as Cand), n_cod_prod: n(c.n_cod_prod), saldo: n(c.saldo), disponivel: n(c.disponivel), separado: n(c.separado),
  necessario: c.necessario == null ? null : n(c.necessario), cmc: n(c.cmc), local_sugerido: c.local_sugerido == null ? null : n(c.local_sugerido),
});
const normLote = (l: Record<string, unknown>): LoteSep => ({ ...(l as unknown as LoteSep), id: n(l.id), projeto_codigo: n(l.projeto_codigo),
  n_linhas: n(l.n_linhas), quantidade: n(l.quantidade), valor: n(l.valor) });

/** Quantidade sugerida conforme o tipo. */
function sugerida(c: Cand, tipo: Tipo): number {
  if (tipo === "separar") return Math.max(0, Math.min(Math.max(0, (c.necessario ?? 0) - c.separado), Math.max(0, c.disponivel)));
  return c.separado;
}

// ── Busca de projeto ─────────────────────────────────────────────────────────
function BuscaProjeto({ valor, setValor }: { valor: Projeto | null; setValor: (p: Projeto | null) => void }) {
  const [txt, setTxt] = useState(valor?.nome ?? "");
  const [lista, setLista] = useState<Projeto[] | null>(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => { setTxt(valor?.nome ?? ""); }, [valor]);
  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => {
      pegar<Record<string, unknown>[]>(`/api/estoque/separacao?acao=projetos&q=${encodeURIComponent(txt.trim())}`)
        .then((r) => setLista(r.map((p) => ({ codigo: n(p.codigo), nome: String(p.nome), separados: n(p.separados) })))).catch(() => setLista([]));
    }, 200);
    return () => clearTimeout(t);
  }, [txt, aberto]);
  return (
    <div style={{ position: "relative" }}>
      <input className="inp" value={txt} placeholder="código (PJ364, 41_VP…) ou nome do projeto" style={{ width: "100%" }}
        onChange={(e) => { setTxt(e.target.value); setAberto(true); if (!e.target.value) setValor(null); }}
        onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 180)} />
      {aberto && (
        <div className="auto-lista">
          {lista === null && <div className="mini" style={{ padding: 8 }}>Buscando…</div>}
          {lista?.map((p) => (
            <button key={p.codigo} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setValor(p); setTxt(p.nome); setAberto(false); }}>
              <b>{p.nome}</b>{p.separados ? <span className="mini"> · {p.separados} item(ns) já separado(s)</span> : null}
            </button>
          ))}
          {lista && !lista.length && <div className="mini" style={{ padding: 8 }}>Nenhum projeto com “{txt}”.</div>}
        </div>
      )}
    </div>
  );
}

// ── Modal de lançamento em lote ─────────────────────────────────────────────
export function ModalSeparacao({ fechar, ok, projetoInicial = null, tipoInicial = "separar" }: {
  fechar: () => void; ok?: (lote: LoteSep) => void; projetoInicial?: Projeto | null; tipoInicial?: Tipo;
}) {
  const { dados } = useItensEstoque();
  const itens = useMemo(() => (dados?.itens ?? []).filter((p) => !p.mesclado_em), [dados]);
  const porCodigo = useMemo(() => {
    const m = new Map<string, ItemEstoque>();
    for (const p of itens) for (const c of [p.codigo, p.codigo_novo, p.codigo_omie, ...(p.codigos_antigos ?? [])]) if (c) m.set(String(c).toUpperCase(), p);
    return m;
  }, [itens]);
  const [tipo, setTipo] = useState<Tipo>(tipoInicial);
  const [projeto, setProjeto] = useState<Projeto | null>(projetoInicial);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [solic, setSolic] = useState("");
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [busca, setBusca] = useState("");
  const [colar, setColar] = useState(false);
  const [colado, setColado] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  const [aba, setAba] = useState<"lancar" | "lotes">("lancar");
  const [lotes, setLotes] = useState<LoteSep[] | null>(null);
  const [toast, avisar] = useToast();
  const [pode, setPode] = useState(true);

  // quem sou eu (solicitante padrão)
  useEffect(() => {
    fetch("/api/estoque/separacao?acao=lotes", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      setPode(!!j.pode);
      if (j.eu?.email && !solic) setSolic(String(j.eu.email).split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()));
      setLotes(((j.dados ?? []) as Record<string, unknown>[]).map(normLote));
    }).catch(() => null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const carregarCands = useCallback(async (p: Projeto | null) => {
    setCands(null); setLinhas([]);
    if (!p) return;
    try {
      const r = (await pegar<Record<string, unknown>[]>(`/api/estoque/separacao?acao=candidatos&projeto=${p.codigo}`)).map(normCand);
      setCands(r);
    } catch (e) { setErro((e as Error).message); setCands([]); }
  }, []);
  useEffect(() => { void carregarCands(projeto); }, [projeto, carregarCands]);
  // linhas a partir dos candidatos, conforme o tipo
  useEffect(() => {
    if (!cands) return;
    const base = tipo === "separar" ? cands.filter((c) => c.no_estoque) : cands.filter((c) => c.separado > 0);
    setLinhas(base.map((c) => ({ ...c, k: SEQ++, qtd: (() => { const s = sugerida(c, tipo); return s > 0 ? String(s).replace(".", ",") : ""; })() })));
  }, [cands, tipo]);

  const set = (k: number, qtd: string) => setLinhas((ls) => ls.map((l) => (l.k === k ? { ...l, qtd } : l)));
  const doItem = (p: ItemEstoque, qtd = ""): Linha => {
    const c = cands?.find((x) => x.n_cod_prod === p.n_cod_prod);
    return { n_cod_prod: p.n_cod_prod, codigo: p.codigo_novo ?? p.codigo, codigo_omie: p.codigo_omie, descricao: p.descricao, unidade: p.unidade,
      saldo: p.saldo, disponivel: c?.disponivel ?? p.saldo - (p.reservado_proj ?? 0), separado: c?.separado ?? 0, necessario: c?.necessario ?? null,
      origem: c?.origem ?? "separado", cmc: p.cmc, local_sugerido: null, no_estoque: true, k: SEQ++, qtd };
  };
  const addItem = (p: ItemEstoque) => {
    if (linhas.some((l) => l.n_cod_prod === p.n_cod_prod)) { setBusca(""); return; }
    setLinhas((ls) => [...ls, doItem(p)]); setBusca("");
  };
  const aplicarColado = () => {
    const nao: string[] = []; const novas: Linha[] = [];
    for (const raw of colado.split(/\r?\n/)) {
      const ps = raw.split(/\t|;/).map((x) => x.trim()).filter(Boolean);
      if (!ps.length) continue;
      const p = porCodigo.get(ps[0].toUpperCase());
      if (!p) { nao.push(ps[0]); continue; }
      const ja = linhas.find((l) => l.n_cod_prod === p.n_cod_prod);
      if (ja) { ja.qtd = ps[1] ?? ja.qtd; continue; }
      novas.push(doItem(p, ps[1] ?? ""));
    }
    setLinhas((ls) => [...ls, ...novas]); setColar(false); setColado("");
    setErro(nao.length ? `Não achei ${nao.length} código(s): ${nao.slice(0, 8).join(", ")}${nao.length > 8 ? "…" : ""}` : null);
  };
  const achados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (t.length < 2) return [];
    return itens.filter((p) => { const s = textoBusca(p).toLowerCase(); return t.split(/\s+/).every((x) => s.includes(x)); }).slice(0, 8);
  }, [busca, itens]);

  const limite = (l: Linha) => (tipo === "separar" ? l.disponivel : l.separado);
  const prontas = linhas.filter((l) => num(l.qtd) > 0);
  const excede = prontas.filter((l) => num(l.qtd) > limite(l) + 1e-9);
  const faltantes = tipo === "separar"
    ? linhas.filter((l) => l.necessario != null && l.necessario - l.separado - Math.max(0, l.disponivel) > 1e-9)
        .map((l) => ({ l, falta: (l.necessario ?? 0) - l.separado - Math.max(0, l.disponivel) }))
    : [];
  const semEstoque = tipo === "separar" ? (cands ?? []).filter((c) => !c.no_estoque) : [];
  const tot = { itens: prontas.length, qtd: prontas.reduce((s, l) => s + num(l.qtd), 0), valor: prontas.reduce((s, l) => s + num(l.qtd) * l.cmc, 0) };

  const copiarFaltantes = async () => {
    const txt = ["código;descrição;falta;unidade", ...faltantes.map(({ l, falta }) => `${l.codigo ?? l.n_cod_prod};${l.descricao ?? ""};${String(falta).replace(".", ",")};${l.unidade ?? ""}`)].join("\n");
    try { await navigator.clipboard.writeText(txt); avisar("Lista de faltantes copiada — cole numa RC em Compras", "ok"); }
    catch { avisar("Não consegui copiar", "crit"); }
  };
  const lancar = async () => {
    setErro(null);
    if (!projeto) return setErro("Escolha o projeto");
    if (!solic.trim()) return setErro("Diga quem pediu (solicitante)");
    if (!prontas.length) return setErro("Nenhuma linha com quantidade");
    if (excede.length) return setErro(`${excede.length} linha(s) acima do ${tipo === "separar" ? "disponível" : "separado"} — ajuste antes de lançar`);
    setIndo(true);
    try {
      const r = await postar<{ lote: Record<string, unknown> }>("/api/estoque/separacao", {
        acao: "lancar", tipo, projeto_codigo: projeto.codigo, solicitante_nome: solic.trim(), motivo: motivo.trim() || null, obs: obs.trim() || null,
        linhas: prontas.map((l) => ({ n_cod_prod: l.n_cod_prod, quantidade: num(l.qtd), ...(l.local_sugerido && tipo === "separar" ? { local: l.local_sugerido } : {}) })),
      });
      const lote = normLote(r.lote);
      invalidarItens();
      avisar(`Lote #${lote.id} lançado — ${lote.n_linhas} item(ns)`, "ok");
      setLotes((ls) => [lote, ...(ls ?? [])]);
      ok?.(lote);
      void carregarCands(projeto);
    } catch (e) { setErro((e as Error).message); } finally { setIndo(false); }
  };
  const desfazer = async (l: LoteSep) => {
    try {
      const r = await postar<{ lote: Record<string, unknown> }>("/api/estoque/separacao", { acao: "desfazer", lote_id: l.id });
      const nl = normLote(r.lote);
      setLotes((ls) => (ls ?? []).map((x) => (x.id === nl.id ? nl : x)));
      invalidarItens(); avisar(`Lote #${l.id} desfeito`, "ok");
      if (projeto && projeto.codigo === l.projeto_codigo) void carregarCands(projeto);
    } catch (e) { avisar((e as Error).message, "crit"); }
  };

  return (
    <div className="est">
      <div className="est-ov mid" onClick={fechar} role="dialog" aria-modal="true" aria-label="Separação para projeto">
        <div className="modal lg sep-proj" onClick={(e) => e.stopPropagation()}>
          <div className="mh"><div><div style={{ fontSize: 16, fontWeight: 700 }}>Separação de material para projeto</div>
            <div className="mini">Em lote, tudo ou nada. O material fica reservado ao projeto — só o painel; o Omie não é alterado.</div></div>
            <button className="x" onClick={fechar} aria-label="Fechar">×</button></div>
          <div className="mb">
            <div className="filtros" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className={`chip ${aba === "lancar" ? "on" : ""}`} onClick={() => setAba("lancar")}>Lançar</button>
              <button className={`chip ${aba === "lotes" ? "on" : ""}`} onClick={() => setAba("lotes")}>Lotes lançados{lotes ? ` · ${lotes.length}` : ""}</button>
            </div>

            {aba === "lancar" && (<>
              {!pode && <div className="aviso t-warn">Você pode consultar, mas não lançar: falta a permissão “Separar material para projeto” (Usuários e acessos).</div>}
              <div className="form-grid">
                <div className="f s6"><span>Projeto *</span><BuscaProjeto valor={projeto} setValor={setProjeto} /></div>
                <label className="f s6">O que fazer
                  <div className="seg" style={{ width: "fit-content" }}>
                    {(["separar", "devolver", "consumir"] as Tipo[]).map((t) => (
                      <button key={t} type="button" className={tipo === t ? "on" : ""} onClick={() => setTipo(t)}>{ROTULO[t]}</button>))}
                  </div>
                  <span className="mini" style={{ fontWeight: 400 }}>{DICA[tipo]}</span>
                </label>
                <label className="f s4">Quem pediu (solicitante) *<input className="inp" value={solic} onChange={(e) => setSolic(e.target.value)} /></label>
                <label className="f s4">Justificativa<input className="inp" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={tipo === "separar" ? "Separação para o projeto" : tipo === "devolver" ? "Devolução do projeto" : "Consumo no projeto"} /></label>
                <label className="f s4">Observação<input className="inp" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="opcional" /></label>
              </div>

              {projeto && cands === null && <div className="mini">Carregando itens do projeto…</div>}
              {projeto && cands && (
                <div className="cartao" style={{ overflow: "hidden" }}>
                  <div className="scroll" style={{ maxHeight: "42vh", overflow: "auto" }}>
                    <table className="tabela">
                      <thead><tr><th>Item</th><th className="r" title="Pela RC (ou PC) do projeto">Necessário</th><th className="r">Já separado</th>
                        <th className="r" title="Saldo menos o que está reservado para qualquer projeto">Disponível</th><th className="r opt">CMC</th><th className="r" style={{ width: 120 }}>{tipo === "separar" ? "Separar" : tipo === "devolver" ? "Devolver" : "Consumir"}</th></tr></thead>
                      <tbody>
                        {linhas.length === 0 && <tr><td colSpan={6} className="mini" style={{ padding: 16 }}>
                          {tipo === "separar" ? "Este projeto não tem RC/PC com itens do estoque. Adicione itens abaixo ou cole uma lista." : "Nada separado para este projeto ainda."}</td></tr>}
                        {linhas.map((l) => {
                          const v = num(l.qtd), lim = limite(l), ruim = v > lim + 1e-9;
                          const falta = tipo === "separar" && l.necessario != null ? (l.necessario ?? 0) - l.separado - Math.max(0, l.disponivel) : 0;
                          return (
                            <tr key={l.k} style={ruim ? { boxShadow: "inset 3px 0 0 var(--ww-crit)" } : undefined}>
                              <td><b>{l.descricao ?? `Item ${l.n_cod_prod}`}</b>
                                <div className="mini">{l.codigo}{l.codigo_omie && l.codigo_omie !== l.codigo ? ` · Omie ${l.codigo_omie}` : ""} · {l.origem === "separado" ? "fora da RC" : `pela ${l.origem}`}{l.local_sugerido ? ` · ${nomeLocal(l.local_sugerido)}` : ""}</div>
                                {falta > 1e-9 && <div className="mini" style={{ color: "var(--ww-warn-text)" }}>falta {q(falta)} — comprar</div>}
                                {ruim && <div className="mini" style={{ color: "var(--ww-crit-text)" }}>acima do {tipo === "separar" ? "disponível" : "separado"} ({q(lim)})</div>}</td>
                              <td className="r">{l.necessario == null ? "—" : q(l.necessario)}</td>
                              <td className="r">{q(l.separado)}</td>
                              <td className="r" style={l.disponivel <= 0 ? { color: "var(--ww-crit-text)" } : undefined}>{q(l.disponivel)}</td>
                              <td className="r opt">{brl(l.cmc)}</td>
                              <td className="r"><input className="inp" style={{ width: 100, textAlign: "right" }} inputMode="decimal" value={l.qtd}
                                onChange={(e) => set(l.k, e.target.value)} aria-label={`Quantidade ${l.descricao ?? ""}`} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="tfoot" style={{ flexWrap: "wrap" }}>
                    <span><b style={{ color: "var(--ww-text)" }}>{tot.itens}</b> item(ns) · {q(tot.qtd)} un · {brl(tot.valor)}</span>
                    {excede.length > 0 && <Pill t={`${excede.length} acima do limite`} tom="crit" />}
                    <span style={{ flex: 1 }} />
                    <button className="btn sm" onClick={() => setLinhas((ls) => ls.map((l) => ({ ...l, qtd: "" })))}>Zerar quantidades</button>
                    <button className="btn sm" onClick={() => setLinhas((ls) => ls.map((l) => { const s = sugerida(l, tipo); return { ...l, qtd: s > 0 ? String(s).replace(".", ",") : "" }; }))}>Sugerir</button>
                  </div>
                </div>
              )}

              {projeto && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div style={{ position: "relative", flex: "1 1 320px" }}>
                    <input className="inp" style={{ width: "100%" }} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="+ item: código ou descrição" />
                    {achados.length > 0 && (
                      <div className="auto-lista">
                        {achados.map((p) => (
                          <button key={p.n_cod_prod} type="button" onClick={() => addItem(p)}>
                            <b>{p.descricao}</b><span className="mini"> {p.codigo_novo ?? p.codigo} · saldo {q(p.saldo)}{p.reservado_proj ? ` · reservado ${q(p.reservado_proj)}` : ""}</span></button>))}
                      </div>
                    )}
                  </div>
                  <button className="btn sm" onClick={() => setColar((v) => !v)}>Colar do Excel</button>
                  {faltantes.length > 0 && <button className="btn sm" onClick={copiarFaltantes}>Copiar {faltantes.length} faltante(s)</button>}
                  {faltantes.length > 0 && <a className="btn sm" href="/erp/compras" target="_blank" rel="noreferrer">Abrir Compras (RC) ↗</a>}
                </div>
              )}
              {colar && (
                <div className="f" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <textarea className="inp" style={{ height: 110, padding: 10 }} value={colado} onChange={(e) => setColado(e.target.value)}
                    placeholder={"código;quantidade — uma linha por item (aceita TAB do Excel)\nC0051;4\nH0012;10"} />
                  <div><button className="btn sm pri" onClick={aplicarColado} disabled={!colado.trim()}>Adicionar à lista</button></div>
                </div>
              )}
              {semEstoque.length > 0 && <div className="mini">{semEstoque.length} item(ns) da RC/PC não estão no estoque (sem saldo cadastrado) e ficaram de fora.</div>}
              {erro && <div className="aviso t-crit">{erro}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn" onClick={fechar}>Fechar</button>
                <button className="btn pri" onClick={lancar} disabled={indo || !pode || !projeto || !prontas.length}>
                  {indo ? "Lançando…" : `${ROTULO[tipo]} · ${tot.itens} item(ns)`}</button>
              </div>
            </>)}

            {aba === "lotes" && <TabelaLotes lotes={lotes} desfazer={pode ? desfazer : undefined} />}
          </div>
        </div>
      </div>
      {toast}
    </div>
  );
}

function TabelaLotes({ lotes, desfazer }: { lotes: LoteSep[] | null; desfazer?: (l: LoteSep) => void }) {
  const [confirma, setConfirma] = useState<number | null>(null);
  if (!lotes) return <div className="mini">Carregando lotes…</div>;
  if (!lotes.length) return <div className="mini">Nenhum lote ainda.</div>;
  return (
    <div className="cartao" style={{ overflow: "hidden" }}><div className="scroll" style={{ maxHeight: "50vh", overflow: "auto" }}>
      <table className="tabela">
        <thead><tr><th>Lote</th><th>Projeto</th><th>O quê</th><th className="r">Itens</th><th className="r">Qtd</th><th className="r opt">Valor</th><th>Quem / quando</th><th /></tr></thead>
        <tbody>
          {lotes.map((l) => (
            <tr key={l.id} style={{ opacity: l.status === "desfeito" ? 0.5 : 1 }}>
              <td>#{l.id}</td>
              <td><b>{l.projeto_nome ?? l.projeto_codigo}</b></td>
              <td>{ROTULO[l.tipo]} {l.status === "desfeito" && <Pill t="desfeito" tom="off" />}<div className="mini">{l.motivo}{l.obs ? ` — ${l.obs}` : ""}</div></td>
              <td className="r">{l.n_linhas}</td><td className="r">{q(l.quantidade)}</td><td className="r opt">{brl(l.valor)}</td>
              <td className="mini">{l.solicitante_nome} · por {l.created_by_email ?? "?"} · {dataHora(l.created_at)}
                {l.desfeito_em && <div>desfeito por {l.desfeito_por_email} · {dataHora(l.desfeito_em)}</div>}</td>
              <td style={{ whiteSpace: "nowrap" }}>{desfazer && l.status === "aplicado" && (confirma === l.id
                ? <><button className="btn sm pri" onClick={() => { setConfirma(null); desfazer(l); }}>Confirmar</button> <button className="btn sm" onClick={() => setConfirma(null)}>Não</button></>
                : <button className="btn sm" onClick={() => setConfirma(l.id)}>Desfazer lote</button>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div></div>
  );
}

// ── Seção "Materiais separados" da tela do projeto ──────────────────────────
type ItemSep = { n_cod_prod: number; local: number; reservado: number; codigo: string | null; descricao: string | null; unidade: string | null; cmc: number; valor: number };
export function SecaoSeparadosProjeto({ codigoProjeto, nomeProjeto }: { codigoProjeto: number; nomeProjeto?: string }) {
  const [d, setD] = useState<{ itens: ItemSep[]; consumido: { quantidade?: number; valor?: number; linhas?: number }; lotes: LoteSep[]; nome: string | null } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pode, setPode] = useState(false);
  const [modal, setModal] = useState<Tipo | null>(null);
  const [qtds, setQtds] = useState<Record<string, string>>({});
  const [toast, avisar] = useToast();
  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/estoque/separacao?acao=projeto&projeto=${codigoProjeto}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setPode(!!j.pode);
      const x = j.dados as Record<string, unknown>;
      setD({
        itens: ((x.itens ?? []) as Record<string, unknown>[]).map((i) => ({ ...(i as unknown as ItemSep), n_cod_prod: n(i.n_cod_prod), local: n(i.local), reservado: n(i.reservado), cmc: n(i.cmc), valor: n(i.valor) })),
        consumido: (x.consumido ?? {}) as { quantidade?: number; valor?: number; linhas?: number },
        lotes: ((x.lotes ?? []) as Record<string, unknown>[]).map(normLote),
        nome: ((x.projeto as Record<string, unknown>)?.nome as string) ?? null,
      });
    } catch (e) { setErro((e as Error).message); }
  }, [codigoProjeto]);
  useEffect(() => { void carregar(); }, [carregar]);
  const umItem = async (i: ItemSep, tipo: Tipo) => {
    const k = `${i.n_cod_prod}:${i.local}`;
    const v = num(qtds[k] ?? "");
    if (!(v > 0)) return avisar("Informe a quantidade na linha", "warn");
    try {
      await postar("/api/estoque/separacao", { acao: "lancar", tipo, projeto_codigo: codigoProjeto, solicitante_nome: "Tela do projeto",
        linhas: [{ n_cod_prod: i.n_cod_prod, quantidade: v, local: i.local }] });
      setQtds((s) => ({ ...s, [k]: "" })); avisar(tipo === "devolver" ? "Devolvido ao estoque" : "Consumido no projeto", "ok"); void carregar();
    } catch (e) { avisar((e as Error).message, "crit"); }
  };
  const desfazer = async (l: LoteSep) => {
    try { await postar("/api/estoque/separacao", { acao: "desfazer", lote_id: l.id }); avisar(`Lote #${l.id} desfeito`, "ok"); void carregar(); }
    catch (e) { avisar((e as Error).message, "crit"); }
  };
  if (erro) return <div className="est"><div className="aviso t-crit">{erro}</div></div>;
  if (!d) return <div className="est"><div className="cartao vazio" style={{ padding: 16 }}>Carregando materiais separados…</div></div>;
  const total = d.itens.reduce((s, i) => s + i.valor, 0);
  const proj = { codigo: codigoProjeto, nome: d.nome ?? nomeProjeto ?? String(codigoProjeto) };
  return (
    <div className="est">
      <div className="cartao" style={{ overflow: "hidden" }}>
        <div className="head" style={{ padding: "12px 16px" }}>
          <div><h3 style={{ margin: 0 }}>Materiais separados</h3>
            <div className="mini">{d.itens.length} item(ns) reservado(s) · {brl(total)} pelo CMC{d.consumido?.valor ? ` · consumido até agora ${brl(d.consumido.valor)}` : ""}</div></div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            {pode && <button className="btn sm pri" onClick={() => setModal("separar")}>+ Separar material</button>}
            {pode && d.itens.length > 0 && <button className="btn sm" onClick={() => setModal("consumir")}>Consumir em lote</button>}
            {pode && d.itens.length > 0 && <button className="btn sm" onClick={() => setModal("devolver")}>Devolver em lote</button>}
          </div>
        </div>
        <div className="scroll">
          <table className="tabela">
            <thead><tr><th>Item</th><th className="opt">Local</th><th className="r">Separado</th><th className="r opt">CMC</th><th className="r">Total</th>{pode && <th style={{ width: 300 }}>Devolver / consumir</th>}</tr></thead>
            <tbody>
              {d.itens.length === 0 && <tr><td colSpan={pode ? 6 : 5} className="mini" style={{ padding: 16 }}>Nada separado para este projeto. Use “+ Separar material” para reservar em lote a partir da RC.</td></tr>}
              {d.itens.map((i) => { const k = `${i.n_cod_prod}:${i.local}`; return (
                <tr key={k}>
                  <td><b>{i.descricao ?? i.n_cod_prod}</b><div className="mini">{i.codigo}</div></td>
                  <td className="opt">{nomeLocal(i.local)}</td>
                  <td className="r">{q(i.reservado)} <span className="mini">{i.unidade ?? ""}</span></td>
                  <td className="r opt">{brl(i.cmc)}</td>
                  <td className="r">{brl(i.valor)}</td>
                  {pode && <td style={{ whiteSpace: "nowrap" }}>
                    <input className="inp" style={{ width: 80, textAlign: "right", height: 28 }} inputMode="decimal" placeholder="qtd" value={qtds[k] ?? ""}
                      onChange={(e) => setQtds((s) => ({ ...s, [k]: e.target.value }))} />{" "}
                    <button className="btn sm" onClick={() => umItem(i, "devolver")}>Devolver</button>{" "}
                    <button className="btn sm" onClick={() => umItem(i, "consumir")}>Consumir</button></td>}
                </tr>); })}
            </tbody>
          </table>
        </div>
      </div>
      {d.lotes.length > 0 && (
        <details className="cartao" style={{ padding: "10px 14px" }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Lotes deste projeto ({d.lotes.length})</summary>
          <div style={{ marginTop: 10 }}><TabelaLotes lotes={d.lotes} desfazer={pode ? desfazer : undefined} /></div>
        </details>
      )}
      {modal && <ModalSeparacao fechar={() => { setModal(null); void carregar(); }} projetoInicial={proj} tipoInicial={modal} ok={() => void carregar()} />}
      {toast}
    </div>
  );
}

// ── Ficha do item: reservado por projeto ────────────────────────────────────
export function ReservasDoItem({ n_cod_prod }: { n_cod_prod: number }) {
  const [r, setR] = useState<{ projeto_codigo: number; projeto: string | null; local: number; reservado: number }[] | null>(null);
  useEffect(() => {
    pegar<Record<string, unknown>[]>(`/api/estoque/separacao?acao=item&n_cod_prod=${n_cod_prod}`)
      .then((x) => setR(x.map((i) => ({ projeto_codigo: n(i.projeto_codigo), projeto: (i.projeto as string) ?? null, local: n(i.local), reservado: n(i.reservado) }))))
      .catch(() => setR([]));
  }, [n_cod_prod]);
  if (!r || !r.length) return null;
  const tot = r.reduce((s, i) => s + i.reservado, 0);
  return (
    <div className="cartao" style={{ padding: "12px 16px" }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Separado para projetos · {q(tot)}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {r.map((i) => (
          <a key={`${i.projeto_codigo}:${i.local}`} href={`/projetos/${i.projeto_codigo}/materiais?aba=separados`} style={{ display: "flex", gap: 8, color: "inherit", textDecoration: "none" }}>
            <span style={{ flex: 1 }}>{i.projeto ?? i.projeto_codigo}</span><span className="mini">{nomeLocal(i.local)}</span><b>{q(i.reservado)}</b></a>))}
      </div>
    </div>
  );
}

// ── Selo na lista de Projetos (uma chamada só para todos) ───────────────────
type Resumo = Record<string, { itens: number; quantidade: number; valor?: number; pct: number | null }>;
let resumoEmCurso: Promise<Resumo> | null = null;
function lerResumo(): Promise<Resumo> {
  if (!resumoEmCurso) {
    resumoEmCurso = pegar<Resumo>("/api/estoque/separacao?acao=resumo").catch(() => ({}));
    setTimeout(() => { resumoEmCurso = null; }, 60_000);
  }
  return resumoEmCurso;
}
export function BadgeSeparadoProjeto({ codProj }: { codProj: number }) {
  const [r, setR] = useState<Resumo[string] | null>(null);
  useEffect(() => { let vivo = true; lerResumo().then((x) => { if (vivo) setR(x[String(codProj)] ?? null); }); return () => { vivo = false; }; }, [codProj]);
  if (!r) return null;
  const txt = [`${r.itens} ${r.itens === 1 ? "item separado" : "itens separados"}`, r.valor != null ? brl(Number(r.valor)) : null, r.pct != null ? `${r.pct}% da lista` : null].filter(Boolean).join(" · ");
  return (
    <a href={`/projetos/${codProj}/materiais?aba=separados`} onClick={(e) => e.stopPropagation()} title="Materiais separados para este projeto"
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 whitespace-nowrap">
      📦 {txt}
    </a>
  );
}
