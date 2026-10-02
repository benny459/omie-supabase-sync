"use client";

/**
 * "Nova movimentação" em LOTE (02/10/26, pedido do Benny).
 * Cabeçalho uma vez só (tipo, solicitante, PV/OS, cliente, projeto, PC, locais, justificativa, observação) e, embaixo,
 * uma grade de linhas: item (busca por código/nome/código novo, com foto e saldo), quantidade, local e obs.
 * "+ linha", Enter na quantidade abre a próxima, "Colar do Excel" (código; quantidade), totais ao vivo e avisos
 * por linha (saldo insuficiente, item inativo). "Lançar movimentação" grava tudo de uma vez (lote atômico).
 * Cliente / Projeto / PV-OS / PC são autocompletar dos nossos cadastros; texto livre só como último recurso.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { LOCAIS, nomeLocal, textoBusca, type ItemEstoque } from "@/lib/estoque";
import { Thumb, brl, postar, q } from "./comum";
import type { ApoioMov } from "./Movimentacoes";

type Sugestao = Record<string, unknown>;
type Linha = { k: number; item: ItemEstoque | null; busca: string; qtd: string; local: string; obs: string };
let SEQ = 1;
const novaLinha = (item: ItemEstoque | null = null, qtd = ""): Linha => ({ k: SEQ++, item, busca: "", qtd, local: "", obs: "" });
const numero = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".")) || 0;

/** Campo com autocompletar dos nossos cadastros; "usar texto livre" só como último recurso. */
function Auto({ tipo, valor, setValor, placeholder, rotulo, onEscolher }: {
  tipo: "cliente" | "projeto" | "pvos" | "pc"; valor: string; setValor: (v: string) => void; placeholder: string;
  rotulo: (s: Sugestao) => [string, string]; onEscolher?: (s: Sugestao) => void;
}) {
  const [txt, setTxt] = useState(valor);
  const [lista, setLista] = useState<Sugestao[] | null>(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => { setTxt(valor); }, [valor]);
  useEffect(() => {
    if (!aberto) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/estoque/autocompletar?tipo=${tipo}&q=${encodeURIComponent(txt.trim())}`, { signal: ctrl.signal })
        .then((r) => r.json()).then((j) => setLista(j.itens ?? [])).catch(() => null);
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [txt, aberto, tipo]);
  return (
    <div style={{ position: "relative" }}>
      <input className="inp" value={txt} placeholder={placeholder} style={{ width: "100%" }}
        onChange={(e) => { setTxt(e.target.value); setAberto(true); if (!e.target.value) setValor(""); }}
        onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 180)} />
      {aberto && (
        <div className="auto-lista">
          {lista === null && <div className="mini" style={{ padding: 8 }}>Buscando…</div>}
          {lista?.map((s, i) => { const [a, b] = rotulo(s); return (
            <button key={i} type="button" onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setValor(a); setTxt(a); setAberto(false); onEscolher?.(s); }}>
              <b>{a}</b>{b && <span className="mini"> {b}</span>}</button>); })}
          {lista && !lista.length && <div className="mini" style={{ padding: 8 }}>Nada nos cadastros com “{txt}”.</div>}
          {txt.trim() && txt.trim() !== valor && (
            <button type="button" className="livre" onMouseDown={(e) => e.preventDefault()} onClick={() => { setValor(txt.trim()); setAberto(false); }}>
              Usar “{txt.trim()}” (texto livre)</button>
          )}
        </div>
      )}
    </div>
  );
}

export function ModalNovaMov({ itens, itemFixo, apoio, fechar, ok }: {
  itens: ItemEstoque[]; itemFixo?: ItemEstoque; apoio: ApoioMov; fechar: () => void; ok: (lote: { id: number; status: string; n_linhas: number }) => void;
}) {
  const manuais = apoio.tipos.filter((t) => t.ativo && t.origem === "manual");
  const [tipoId, setTipoId] = useState<number>(manuais[0]?.id ?? 0);
  const tipo = manuais.find((t) => t.id === tipoId);
  const locais = Object.keys(LOCAIS);
  const [orig, setOrig] = useState(locais[0]);
  const [dest, setDest] = useState(locais[1] ?? locais[0]);
  const eu = apoio.usuarios.find((u) => u.id === apoio.eu.id || u.email === apoio.eu.email);
  const [solUser, setSolUser] = useState<string>(eu?.id ?? "");
  const [solNome, setSolNome] = useState("");
  const [cliente, setCliente] = useState("");
  const [projeto, setProjeto] = useState("");
  const [pvos, setPvos] = useState("");
  const [pc, setPc] = useState("");
  const [motivoId, setMotivoId] = useState("");
  const [motivoTxt, setMotivoTxt] = useState("");
  const [obs, setObs] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>(() => [novaLinha(itemFixo ?? null)]);
  const [colar, setColar] = useState(false);
  const [colado, setColado] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  const focos = useRef(new Map<number, HTMLInputElement | null>());
  const [focoItem, setFocoItem] = useState<number | null>(itemFixo ? null : linhas[0]?.k ?? null);

  useEffect(() => { if (tipo?.sentido === "entra") setDest(locais[0]); else if (tipo?.sentido === "transfere") { setOrig(locais[0]); setDest(locais[1] ?? locais[0]); } setMotivoId(""); }, [tipoId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focoItem != null) setTimeout(() => focos.current.get(focoItem)?.focus(), 20); }, [focoItem]);

  const motivos = apoio.motivos.filter((m) => m.tipo_id === tipoId && m.ativo);
  const vivos = useMemo(() => itens.filter((p) => !p.mesclado_em), [itens]);
  const porCodigo = useMemo(() => {
    const m = new Map<string, ItemEstoque>();
    for (const p of vivos) for (const c of [p.codigo, p.codigo_novo, p.codigo_omie, ...(p.codigos_antigos ?? [])]) if (c) m.set(String(c).toUpperCase(), p);
    return m;
  }, [vivos]);
  const sai = tipo?.sentido !== "entra";
  const localLinha = (l: Linha) => l.local || (sai ? orig : dest);
  const saldoLocal = (p: ItemEstoque, loc: string) => p.locais.find((x) => x.local === loc)?.saldo ?? 0;
  const solicitante = solUser === "__outro" ? solNome.trim() : apoio.usuarios.find((u) => u.id === solUser)?.nome ?? "";

  const set = (k: number, c: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.k === k ? { ...l, ...c } : l)));
  const addLinha = () => { const n = novaLinha(); setLinhas((ls) => [...ls, n]); setFocoItem(n.k); };
  const avisos = (l: Linha): string[] => {
    const a: string[] = [];
    if (!l.item) return a;
    if (l.item.ativo === false) a.push("item inativo");
    const n = numero(l.qtd);
    if (sai && n > 0) {
      // soma o que já sai deste item/local nas outras linhas
      const tot = linhas.filter((x) => x.item?.n_cod_prod === l.item!.n_cod_prod && localLinha(x) === localLinha(l)).reduce((s, x) => s + numero(x.qtd), 0);
      const sal = saldoLocal(l.item, localLinha(l));
      if (sal - tot < 0) a.push(`saldo insuficiente em ${nomeLocal(localLinha(l))} (${q(sal)})`);
    }
    return a;
  };
  const prontas = linhas.filter((l) => l.item && numero(l.qtd) > 0);
  const tot = { itens: new Set(prontas.map((l) => l.item!.n_cod_prod)).size, qtd: prontas.reduce((s, l) => s + numero(l.qtd), 0), valor: prontas.reduce((s, l) => s + numero(l.qtd) * l.item!.cmc, 0) };
  const nAvisos = prontas.filter((l) => avisos(l).length).length;

  const aplicarColado = () => {
    const nao: string[] = [], novas: Linha[] = [];
    for (const raw of colado.split(/\r?\n/)) {
      const ps = raw.split(/\t|;/).map((x) => x.trim()).filter(Boolean);
      if (!ps.length) continue;
      const p = porCodigo.get(ps[0].toUpperCase());
      if (!p) { nao.push(ps[0]); continue; }
      novas.push(novaLinha(p, ps[1] ?? ""));
    }
    setLinhas((ls) => [...ls.filter((l) => l.item || l.qtd), ...novas, novaLinha()]);
    setColar(false); setColado("");
    setErro(nao.length ? `Não achei ${nao.length} código(s): ${nao.slice(0, 8).join(", ")}${nao.length > 8 ? "…" : ""}` : null);
  };

  const salvar = async () => {
    setErro(null);
    if (!tipo) return setErro("Escolha o tipo");
    if (!solicitante) return setErro("Diga quem pediu o material (solicitante)");
    if (tipo.exige_cliente_ou_projeto && !cliente.trim() && !projeto.trim()) return setErro(`"${tipo.nome}" exige cliente ou projeto`);
    if (tipo.exige_pc && !pc.trim()) return setErro("Informe o PC");
    if (!motivoId && !motivoTxt.trim()) return setErro("Escolha ou escreva a justificativa");
    const semQtd = linhas.filter((l) => l.item && !(numero(l.qtd) > 0));
    if (semQtd.length) return setErro(`Falta a quantidade de ${semQtd.length} linha(s)`);
    if (!prontas.length) return setErro("Adicione pelo menos um item com quantidade");
    setIndo(true);
    try {
      const r = await postar<{ lote: { id: number; status: string; n_linhas: number } }>("/api/estoque/movimentacao", {
        acao: "registrar_lote", tipo_id: tipo.id, solicitante_user: solUser && solUser !== "__outro" ? solUser : null, solicitante_nome: solicitante,
        cliente, projeto, pv_os: pvos, pc_numero: pc, motivo_id: motivoId || null, motivo: motivoTxt, obs,
        local_origem: sai ? orig : null, local_destino: tipo.sentido !== "sai" ? dest : null,
        linhas: prontas.map((l) => ({ n_cod_prod: l.item!.n_cod_prod, quantidade: numero(l.qtd), obs: l.obs || null,
          ...(l.local ? (sai ? { local_origem: l.local } : { local_destino: l.local }) : {}) })),
      });
      ok(r.lote);
    } catch (e) { setErro((e as Error).message); } finally { setIndo(false); }
  };

  return (
    <div className="est-ov mid" onClick={fechar} role="dialog" aria-modal="true" aria-label="Nova movimentação">
      <div className="modal lg nova-mov" onClick={(e) => e.stopPropagation()}>
        <div className="mh"><div><div style={{ fontSize: 16, fontWeight: 700 }}>Nova movimentação</div>
          <div className="mini">Vários itens de uma vez. Fica só no painel — o Omie não é alterado. Entradas e saídas por NF vêm sozinhas do Omie.</div></div>
          <button className="x" onClick={fechar} aria-label="Fechar">×</button></div>
        <div className="mb">
          <div className="form-grid">
            <label className="f s6">Tipo
              <select className="inp" value={tipoId} onChange={(e) => setTipoId(Number(e.target.value))}>
                {manuais.map((t) => <option key={t.id} value={t.id}>{t.nome}{t.exige_aprovacao ? " (precisa de aprovação)" : ""}</option>)}
              </select>
              {tipo?.descricao && <span className="mini" style={{ fontWeight: 400 }}>{tipo.descricao}</span>}
            </label>
            <label className="f s6">Quem pediu o material (solicitante)
              <select className="inp" value={solUser} onChange={(e) => setSolUser(e.target.value)}>
                <option value="">— escolha —</option>
                {apoio.usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                <option value="__outro">Outra pessoa (digitar o nome)</option>
              </select>
              {solUser === "__outro" && <input className="inp" value={solNome} onChange={(e) => setSolNome(e.target.value)} placeholder="Nome de quem pediu" />}
            </label>
            <div className="f s4"><span>PV / OS <span className="mini">(preenche cliente e projeto)</span></span>
              <Auto tipo="pvos" valor={pvos} setValor={setPvos} placeholder="nº ou cliente" rotulo={(s) => [String(s.rotulo), `${s.cliente ?? ""}${s.projeto ? ` · ${s.projeto}` : ""}`]}
                onEscolher={(s) => { if (s.cliente) setCliente(String(s.cliente)); if (s.projeto) setProjeto(String(s.projeto)); }} /></div>
            <div className="f s4"><span>Cliente{tipo?.exige_cliente_ou_projeto ? " (ou projeto) *" : ""}</span>
              <Auto tipo="cliente" valor={cliente} setValor={setCliente} placeholder="digite: hosp, einstein, CNPJ…"
                rotulo={(s) => [String(s.nome_fantasia || s.razao_social), [s.nome_fantasia && s.razao_social !== s.nome_fantasia ? s.razao_social : null, s.cnpj_cpf, s.cidade].filter(Boolean).join(" · ")]} /></div>
            <div className="f s4"><span>Projeto</span>
              <Auto tipo="projeto" valor={projeto} setValor={setProjeto} placeholder="código ou nome" rotulo={(s) => [String(s.nome), s.cliente ? `cliente: ${s.cliente}` : ""]}
                onEscolher={(s) => { if (!cliente && s.cliente) setCliente(String(s.cliente)); }} /></div>
            <div className="f s4"><span>PC{tipo?.exige_pc ? " *" : " (opcional)"}</span>
              <Auto tipo="pc" valor={pc} setValor={setPc} placeholder="nº ou fornecedor" rotulo={(s) => [String(s.numero), `${s.fornecedor ?? ""}${s.emissao ? ` · ${String(s.emissao).split("-").reverse().join("/")}` : ""}`]} /></div>
            {sai && <label className="f s4">Sai de<select className="inp" value={orig} onChange={(e) => setOrig(e.target.value)}>{locais.map((l) => <option key={l} value={l}>{nomeLocal(l)}</option>)}</select></label>}
            {tipo?.sentido !== "sai" && <label className="f s4">Entra em<select className="inp" value={dest} onChange={(e) => setDest(e.target.value)}>{locais.map((l) => <option key={l} value={l}>{nomeLocal(l)}</option>)}</select></label>}
            <label className="f s6">Justificativa *
              <select className="inp" value={motivoId} onChange={(e) => setMotivoId(e.target.value)}>
                <option value="">{motivos.length ? "— escolha —" : "— sem lista: escreva ao lado —"}</option>
                {motivos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select></label>
            {!motivoId && <label className="f s6">ou escreva<input className="inp" value={motivoTxt} onChange={(e) => setMotivoTxt(e.target.value)} placeholder="justificativa" /></label>}
            <label className="f s12">Observação<input className="inp" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="opcional — vale para todas as linhas" /></label>
          </div>

          <div className="grade-linhas">
            <div className="gl-cab"><span>Item</span><span className="r">Quantidade</span><span>{sai ? "Sai de" : "Entra em"}</span><span>Obs. da linha</span><span /></div>
            {linhas.map((l, i) => {
              const av = avisos(l);
              const achados = !l.item && l.busca.trim().length >= 2
                ? vivos.filter((p) => { const t = textoBusca(p).toLowerCase(); return l.busca.toLowerCase().split(/\s+/).every((x) => t.includes(x)); }).slice(0, 8) : [];
              return (
                <div key={l.k} className={`gl-linha ${av.length ? "aviso-l" : ""}`}>
                  <div style={{ position: "relative", minWidth: 0 }}>
                    {l.item ? (
                      <div className="prod" style={{ minWidth: 0 }}><Thumb src={l.item.foto} />
                        <div style={{ minWidth: 0 }}><div className="n" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.item.descricao}</div>
                          <div className="c">{l.item.codigo_novo ?? l.item.codigo} · saldo {q(saldoLocal(l.item, localLinha(l)))} em {nomeLocal(localLinha(l))}{av.length ? <b style={{ color: "var(--ww-warn-text)" }}> · {av.join(" · ")}</b> : null}</div></div>
                        {!itemFixo || i > 0 ? <button className="link mini" onClick={() => { set(l.k, { item: null, busca: "" }); setFocoItem(l.k); }}>trocar</button> : null}
                      </div>
                    ) : (<>
                      <input className="inp" ref={(el) => { focos.current.set(l.k, el); }} value={l.busca} placeholder="código ou nome do item"
                        onChange={(e) => set(l.k, { busca: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Enter" && achados[0]) { set(l.k, { item: achados[0], busca: "" }); e.preventDefault(); setTimeout(() => (document.getElementById(`qtd-${l.k}`) as HTMLInputElement | null)?.focus(), 20); } }} style={{ width: "100%" }} />
                      {achados.length > 0 && <div className="auto-lista">{achados.map((p) => (
                        <button key={p.n_cod_prod} type="button" onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { set(l.k, { item: p, busca: "" }); setTimeout(() => (document.getElementById(`qtd-${l.k}`) as HTMLInputElement | null)?.focus(), 20); }}>
                          <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Thumb src={p.foto} /><span><b>{p.descricao}</b><span className="mini"> · {p.codigo_novo ?? p.codigo} · saldo {q(p.saldo)}</span></span></span>
                        </button>))}</div>}
                    </>)}
                  </div>
                  <input id={`qtd-${l.k}`} className="inp r" inputMode="decimal" value={l.qtd} placeholder="0" onChange={(e) => set(l.k, { qtd: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (i === linhas.length - 1) addLinha(); else setFocoItem(linhas[i + 1].k); } }} />
                  <select className="inp" value={l.local} onChange={(e) => set(l.k, { local: e.target.value })} aria-label="Local da linha">
                    <option value="">{nomeLocal(sai ? orig : dest)} (padrão)</option>
                    {locais.map((x) => <option key={x} value={x}>{nomeLocal(x)}</option>)}
                  </select>
                  <input className="inp" value={l.obs} onChange={(e) => set(l.k, { obs: e.target.value })} placeholder="opcional" />
                  <button className="link" aria-label="Remover linha" title="Remover linha" onClick={() => setLinhas((ls) => (ls.length > 1 ? ls.filter((x) => x.k !== l.k) : [novaLinha()]))}>×</button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingTop: 6 }}>
              <button className="btn sm" onClick={addLinha}>+ linha</button>
              <button className="btn sm" onClick={() => setColar((x) => !x)}>Colar do Excel</button>
              <span className="mini">Enter na quantidade abre a próxima linha.</span>
              <span style={{ flex: 1 }} />
              <span className="mini"><b>{q(tot.itens)}</b> itens · <b>{q(tot.qtd)}</b> unidades · <b>{brl(tot.valor)}</b> ao CMC{nAvisos ? <b style={{ color: "var(--ww-warn-text)" }}> · {nAvisos} linha(s) com aviso</b> : null}</span>
            </div>
            {colar && (
              <div style={{ display: "grid", gap: 6 }}>
                <textarea className="inp" style={{ height: 110, padding: 10, fontFamily: "ui-monospace, Menlo, monospace" }} value={colado} onChange={(e) => setColado(e.target.value)}
                  placeholder={"Cole duas colunas do Excel: código e quantidade\n3014120\t2\nH0012\t5"} />
                <div><button className="btn sm pri" disabled={!colado.trim()} onClick={aplicarColado}>Adicionar as linhas</button></div>
              </div>
            )}
          </div>
          {erro && <div className="aviso t-crit">{erro}</div>}
        </div>
        <div className="mf"><span className="sp">{tipo?.exige_aprovacao ? (apoio.admin ? "Você é administrador: o lote já entra aprovado." : "O lote inteiro aguarda a aprovação do administrador.") : "O saldo muda na hora, para todas as linhas de uma vez."}</span>
          <button className="btn" onClick={fechar}>Cancelar</button>
          <button className="btn pri" onClick={salvar} disabled={indo}>{indo ? "Lançando…" : `Lançar movimentação${prontas.length > 1 ? ` (${prontas.length} linhas)` : ""}`}</button></div>
      </div>
    </div>
  );
}
