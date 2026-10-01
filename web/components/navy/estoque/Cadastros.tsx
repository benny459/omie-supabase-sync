"use client";

/**
 * Estoque › Cadastros (/estoque/cadastros) — tudo só no painel:
 *   Famílias            — criar, renomear, prefixo, "é material?", inativar, mesclar (move os itens)
 *   Revisão de famílias — sugestão automática para itens sem família / em família que não é material,
 *                         com confiança e motivo; aceitar/rejeitar em lote, trocar um a um; "Concluir revisão"
 *   Códigos novos       — prévia prefixo + sequência (código Omie → código novo); aplicar só depois da revisão
 */

import "./estoque.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { baixarCSV } from "@/lib/estoque";
import { Pill, Seta, brl, invalidarItens, postar, q, useToast } from "./comum";

type Familia = { id: number; nome: string; prefixo: string; descricao: string | null; ativo: boolean; sistema: boolean; material: boolean;
  mesclada_em: number | null; omie_codigo_familia: number | null; proximo: number; itens: number; valor: number };
type Sug = { n_cod_prod: number; familia_atual_id: number | null; familia_sugerida_id: number | null; confianca: number; motivo: string | null;
  status: "pendente" | "aceita" | "rejeitada" | "alterada"; familia_escolhida_id: number | null; decidido_por_email: string | null;
  item: { codigo: string; codigo_novo: string | null; descricao: string; ncm: string | null; saldo: number; cmc: number; familia: string | null } };
type Previa = { n_cod_prod: number; codigo_omie: string; descricao: string; familia_id: number; familia: string; codigo_novo: string };
type Aba = "familias" | "revisao" | "codigos";

const banda = (c: number): ["alta" | "média" | "baixa" | "nenhuma", "ok" | "info" | "warn" | "off"] =>
  c >= 0.8 ? ["alta", "ok"] : c >= 0.6 ? ["média", "info"] : c > 0 ? ["baixa", "warn"] : ["nenhuma", "off"];

export default function CadastrosEstoque({ abaInicial }: { abaInicial?: string }) {
  const router = useRouter();
  const [aba, setAba] = useState<Aba>((["familias", "revisao", "codigos"] as Aba[]).includes(abaInicial as Aba) ? (abaInicial as Aba) : "familias");
  const [d, setD] = useState<{ familias: Familia[]; revisao_concluida: boolean; codigos_gerados: number; admin: boolean } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [toast, avisar] = useToast();
  const carregar = useCallback(async () => {
    const r = await fetch("/api/estoque/familias", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setD(j); else setErro(j.error ?? r.statusText);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const mudou = useCallback(() => { invalidarItens(); carregar(); }, [carregar]);
  const ir = (a: Aba) => { setAba(a); try { window.history.replaceState(null, "", `/estoque/cadastros?aba=${a}`); } catch {} };

  return (
    <div className="est">
      <div className="crumbs"><button className="link" onClick={() => router.push("/estoque")}><Seta dir="esq" />Estoque</button><span>/</span><span>Cadastros</span></div>
      <header className="cartao head">
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="area">Estoque</div><h1>Cadastros</h1>
          <div className="sub">Famílias com prefixo, revisão das famílias e código novo por família. Tudo fica no painel — o código do Omie continua ao lado.</div>
        </div>
        <div className="seg">
          <button className={aba === "familias" ? "on" : ""} onClick={() => ir("familias")}>Famílias</button>
          <button className={aba === "revisao" ? "on" : ""} onClick={() => ir("revisao")}>Revisão de famílias{d && !d.revisao_concluida ? <span className="b">aberta</span> : null}</button>
          <button className={aba === "codigos" ? "on" : ""} onClick={() => ir("codigos")}>Códigos novos</button>
        </div>
      </header>
      {erro && <div className="aviso t-crit">{erro}</div>}
      {!d && !erro && <div className="cartao vazio">Carregando…</div>}
      {d && !d.admin && <div className="aviso t-info">Só o administrador (Benny) altera famílias e códigos. Você pode consultar.</div>}
      {d && aba === "familias" && <AbaFamilias d={d} mudou={mudou} avisar={avisar} />}
      {d && aba === "revisao" && <AbaRevisao d={d} mudou={mudou} avisar={avisar} />}
      {d && aba === "codigos" && <AbaCodigos d={d} mudou={mudou} avisar={avisar} irRevisao={() => ir("revisao")} />}
      {toast}
    </div>
  );
}

type Avisar = (m: string, t?: "ok" | "crit" | "warn" | "info") => void;

// ── Famílias ─────────────────────────────────────────────────────────────────
function AbaFamilias({ d, mudou, avisar }: { d: { familias: Familia[]; admin: boolean; codigos_gerados: number }; mudou: () => void; avisar: Avisar }) {
  const [edit, setEdit] = useState<Partial<Familia> & { id?: number } | null>(null);
  const [mesclar, setMesclar] = useState<{ de: Familia; para: string } | null>(null);
  const [verInativas, setVerInativas] = useState(false);
  const ativas = d.familias.filter((f) => f.ativo), inativas = d.familias.filter((f) => !f.ativo);
  const nomeDe = (id: number | null) => d.familias.find((f) => f.id === id)?.nome ?? "—";
  const acao = async (body: Record<string, unknown>, ok: string) => {
    try { await postar("/api/estoque/familias", body); avisar(ok, "ok"); mudou(); return true; } catch (e) { avisar((e as Error).message, "crit"); return false; }
  };
  const linhas = verInativas ? [...ativas, ...inativas] : ativas;
  return (<>
    <div className="cartao">
      <div className="head" style={{ padding: "12px 16px" }}>
        <h3 style={{ margin: 0, flex: 1 }}>Famílias <span className="mini">· {ativas.length} ativas{inativas.length ? ` · ${inativas.length} inativas/mescladas` : ""}</span></h3>
        {inativas.length > 0 && <button className={`chip ${verInativas ? "on" : ""}`} onClick={() => setVerInativas(!verInativas)}>Mostrar inativas</button>}
        {d.admin && <button className="btn sm" onClick={() => acao({ acao: "importar_omie" }, "Famílias do Omie conferidas")}>Importar famílias novas do Omie</button>}
        {d.admin && <button className="btn sm pri" onClick={() => setEdit({ nome: "", prefixo: "", material: true })}>+ Nova família</button>}
      </div>
      <div className="scroll">
        <table className="tabela">
          <thead><tr><th>Família</th><th>Prefixo</th><th className="r">Itens</th><th className="r opt">Valor</th><th className="opt">Tipo</th><th className="opt">Próximo código</th><th /></tr></thead>
          <tbody>
            {linhas.map((f) => (
              <tr key={f.id} style={{ opacity: f.ativo ? 1 : 0.55 }}>
                <td><b>{f.nome}</b>{f.descricao && <div className="mini">{f.descricao}</div>}
                  {f.mesclada_em && <div className="mini">mesclada em {nomeDe(f.mesclada_em)}</div>}
                  {!f.ativo && !f.mesclada_em && <div className="mini">inativa</div>}</td>
                <td><span className="pill t-info" style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{f.prefixo}</span></td>
                <td className="r num">{q(f.itens)}</td>
                <td className="r num opt">{brl(f.valor)}</td>
                <td className="opt">{f.sistema ? <Pill t="sistema" tom="off" /> : f.material ? <Pill t="material" tom="ok" /> : <Pill t="não é material" tom="warn" />}</td>
                <td className="opt mono num">{f.prefixo}{String(f.proximo).padStart(4, "0")}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {d.admin && f.ativo && <><button className="btn sm" onClick={() => setEdit(f)}>Editar</button>{" "}</>}
                  {d.admin && f.ativo && !f.sistema && <><button className="btn sm" onClick={() => setMesclar({ de: f, para: "" })}>Mesclar…</button>{" "}</>}
                  {d.admin && !f.sistema && (f.ativo
                    ? <button className="btn sm" onClick={() => acao({ acao: "inativar", id: f.id }, `${f.nome} inativada`)}>Inativar</button>
                    : !f.mesclada_em && <button className="btn sm" onClick={() => acao({ acao: "reativar", id: f.id }, `${f.nome} reativada`)}>Reativar</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tfoot"><span>“Não é material” = a família não diz o tipo da peça (Ativo, Orçamentos…): os itens dela entram na revisão para ganhar uma família de material.</span></div>
    </div>

    {edit && (
      <div className="est-ov mid" onClick={() => setEdit(null)} role="dialog" aria-modal="true">
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="mh"><div style={{ fontSize: 16, fontWeight: 700 }}>{edit.id ? `Editar ${edit.nome}` : "Nova família"}</div><button className="x" onClick={() => setEdit(null)}>×</button></div>
          <div className="mb">
            <div className="row2">
              <label className="f">Nome<input className="inp" value={edit.nome ?? ""} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></label>
              <label className="f">Prefixo (1–3 letras){edit.id ? "" : " — vazio = sugerido"}
                <input className="inp" value={edit.prefixo ?? ""} maxLength={3} onChange={(e) => setEdit({ ...edit, prefixo: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })}
                  style={{ fontFamily: "ui-monospace, Menlo, monospace", letterSpacing: ".15em" }} /></label>
            </div>
            <label className="f">Descrição (opcional)<input className="inp" value={edit.descricao ?? ""} onChange={(e) => setEdit({ ...edit, descricao: e.target.value })} /></label>
            {!edit.sistema && <label className="opcao" style={{ alignItems: "center" }}><input type="checkbox" checked={edit.material !== false} onChange={(e) => setEdit({ ...edit, material: e.target.checked })} /> É tipo de material (itens desta família não entram na revisão)</label>}
            {edit.id && d.codigos_gerados > 0 && <div className="aviso t-warn">Se já houver códigos gerados com este prefixo, ele não pode mais mudar.</div>}
          </div>
          <div className="mf"><button className="btn" onClick={() => setEdit(null)}>Cancelar</button>
            <button className="btn pri" onClick={async () => {
              const ok = await acao(edit.id ? { acao: "editar", id: edit.id, nome: edit.nome, prefixo: edit.prefixo, descricao: edit.descricao ?? "", material: edit.material }
                : { acao: "criar", nome: edit.nome, prefixo: edit.prefixo, descricao: edit.descricao ?? "", material: edit.material !== false }, edit.id ? "Família salva" : "Família criada");
              if (ok) setEdit(null);
            }}>Salvar</button></div>
        </div>
      </div>
    )}

    {mesclar && (
      <div className="est-ov mid" onClick={() => setMesclar(null)} role="dialog" aria-modal="true">
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="mh"><div style={{ fontSize: 16, fontWeight: 700 }}>Mesclar “{mesclar.de.nome}”</div><button className="x" onClick={() => setMesclar(null)}>×</button></div>
          <div className="mb">
            <div className="prev">Os {q(mesclar.de.itens)} itens de <b>{mesclar.de.nome}</b> passam para a família escolhida, e “{mesclar.de.nome}” fica inativa (mesclada). Códigos já gerados não mudam.</div>
            <label className="f">Mesclar em
              <select className="inp" value={mesclar.para} onChange={(e) => setMesclar({ ...mesclar, para: e.target.value })}>
                <option value="">Escolha…</option>
                {ativas.filter((f) => f.id !== mesclar.de.id).map((f) => <option key={f.id} value={f.id}>{f.nome} ({f.prefixo}) · {f.itens} itens</option>)}
              </select>
            </label>
          </div>
          <div className="mf"><button className="btn" onClick={() => setMesclar(null)}>Cancelar</button>
            <button className="btn pri" disabled={!mesclar.para} onClick={async () => { if (await acao({ acao: "mesclar", de: mesclar.de.id, para: Number(mesclar.para) }, "Famílias mescladas")) setMesclar(null); }}>Mesclar</button></div>
        </div>
      </div>
    )}
  </>);
}

// ── Revisão de famílias ──────────────────────────────────────────────────────
function AbaRevisao({ d, mudou, avisar }: { d: { familias: Familia[]; revisao_concluida: boolean; admin: boolean }; mudou: () => void; avisar: Avisar }) {
  const [sug, setSug] = useState<Sug[] | null>(null);
  const [fBanda, setFBanda] = useState<"todas" | "alta" | "média" | "baixa" | "nenhuma">("todas");
  const [fStatus, setFStatus] = useState<"pendente" | "decididas" | "todas">("pendente");
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [indo, setIndo] = useState(false);
  const [paraFam, setParaFam] = useState("");
  const fams = d.familias.filter((f) => f.ativo && !f.sistema && f.material);
  const nome = (id: number | null) => (id == null ? "Sem família" : d.familias.find((f) => f.id === id)?.nome ?? "—");

  const carregar = useCallback(async () => {
    const r = await fetch("/api/estoque/familias/sugestoes", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setSug(j.sugestoes.map((s: Sug) => ({ ...s, confianca: Number(s.confianca), n_cod_prod: Number(s.n_cod_prod) })));
    else avisar(j.error ?? "Erro", "crit");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); }, [carregar]);

  const lista = useMemo(() => (sug ?? []).filter((s) =>
    (fStatus === "todas" || (fStatus === "pendente" ? s.status === "pendente" : s.status !== "pendente"))
    && (fBanda === "todas" || banda(s.confianca)[0] === fBanda)
    && (!busca.trim() || `${s.item.descricao} ${s.item.codigo} ${s.motivo ?? ""}`.toLowerCase().includes(busca.trim().toLowerCase()))), [sug, fStatus, fBanda, busca]);
  const grupos = useMemo(() => {
    const m = new Map<string, Sug[]>();
    for (const s of lista) { const k = s.status === "pendente" ? (s.familia_sugerida_id ? nome(s.familia_sugerida_id) : "Sem sugestão") : `${s.status}: ${nome(s.familia_escolhida_id ?? s.familia_atual_id)}`;
      (m.get(k) ?? m.set(k, []).get(k)!).push(s); }
    return [...m.entries()].sort((a, b) => (a[0] === "Sem sugestão" ? 1 : b[0] === "Sem sugestão" ? -1 : b[1].length - a[1].length));
  }, [lista]); // eslint-disable-line react-hooks/exhaustive-deps
  const contaB = (b: string) => (sug ?? []).filter((s) => s.status === "pendente" && banda(s.confianca)[0] === b).length;

  const decidir = async (itens: number[], acao: string, familia_id?: number) => {
    if (!itens.length) return;
    setIndo(true);
    try { const r = await postar<{ resultado: number }>("/api/estoque/familias/sugestoes", { acao, itens, familia_id }); avisar(`${r.resultado} item(ns): ${acao}`, "ok"); setSel(new Set()); await carregar(); mudou(); }
    catch (e) { avisar((e as Error).message, "crit"); } finally { setIndo(false); }
  };
  const alterna = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const marcarGrupo = (l: Sug[], on: boolean) => setSel((s) => { const n = new Set(s); l.forEach((x) => (on ? n.add(x.n_cod_prod) : n.delete(x.n_cod_prod))); return n; });

  return (<>
    <div className={`aviso ${d.revisao_concluida ? "t-ok" : "t-warn"}`}>
      <span>{d.revisao_concluida
        ? "Revisão de famílias concluída — os códigos novos já podem ser gerados (aba Códigos novos)."
        : "Revisão aberta: os códigos novos ficam bloqueados até você concluir a revisão. Nada muda de família sem a sua confirmação."}</span>
      <span style={{ flex: 1 }} />
      {d.admin && (d.revisao_concluida
        ? <button className="btn sm" onClick={async () => { try { await postar("/api/estoque/familias", { acao: "reabrir_revisao" }); mudou(); } catch (e) { avisar((e as Error).message, "crit"); } }}>Reabrir revisão</button>
        : <button className="btn sm pri" onClick={async () => { try { await postar("/api/estoque/familias", { acao: "concluir_revisao" }); avisar("Revisão concluída", "ok"); mudou(); } catch (e) { avisar((e as Error).message, "crit"); } }}>Concluir revisão de famílias</button>)}
    </div>
    <section className="kpis">
      <div className="kpi hero" style={{ cursor: "default" }}><div className="r">Itens para revisar</div><div className="v">{q((sug ?? []).filter((s) => s.status === "pendente").length)}</div><div className="s">sem família, em família que não é material, ou fora do lugar</div></div>
      {(["alta", "média", "baixa", "nenhuma"] as const).map((b) => (
        <button key={b} className="kpi" onClick={() => { setFBanda(b); setFStatus("pendente"); }}>
          <div className="r">Confiança {b === "nenhuma" ? "— sem sugestão" : b}</div><div className="v">{q(contaB(b))}</div>
          <div className="s">{b === "alta" ? "≥ 80%" : b === "média" ? "60–79%" : b === "baixa" ? "< 60%" : "escolher à mão"}</div>
        </button>
      ))}
      <div className="kpi" style={{ cursor: "default" }}><div className="r">Já decididos</div><div className="v">{q((sug ?? []).filter((s) => s.status !== "pendente").length)}</div><div className="s">aceitos, alterados ou rejeitados</div></div>
    </section>
    <div className="cartao">
      <div className="head" style={{ padding: "12px 16px", gap: 8 }}>
        <div className="filtros" style={{ flex: 1 }}>
          {(["todas", "alta", "média", "baixa", "nenhuma"] as const).map((b) => <button key={b} className={`chip ${fBanda === b ? "on" : ""}`} onClick={() => setFBanda(b)}>{b === "todas" ? "Toda confiança" : b === "nenhuma" ? "Sem sugestão" : `Confiança ${b}`}</button>)}
          <span className="mini">·</span>
          {(["pendente", "decididas", "todas"] as const).map((s) => <button key={s} className={`chip ${fStatus === s ? "on" : ""}`} onClick={() => setFStatus(s)}>{s === "pendente" ? "A decidir" : s === "decididas" ? "Decididas" : "Todas"}</button>)}
        </div>
        <input className="inp" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar item…" style={{ width: 180 }} />
        {d.admin && <button className="btn sm" disabled={indo} onClick={async () => { setIndo(true); try { const r = await postar<{ resultado: Record<string, number> }>("/api/estoque/familias/sugestoes", { acao: "gerar" }); avisar(`Sugestões recalculadas: ${r.resultado.alta} alta · ${r.resultado.media} média · ${r.resultado.baixa} baixa`, "ok"); await carregar(); } catch (e) { avisar((e as Error).message, "crit"); } finally { setIndo(false); } }}>Recalcular sugestões</button>}
      </div>
      {d.admin && sel.size > 0 && (
        <div className="inv-barra t-info" style={{ margin: "0 16px 10px" }}>
          <b>{sel.size} selecionado(s)</b>
          <button className="btn sm pri" disabled={indo} onClick={() => decidir([...sel], "aceita")}>✓ Aceitar sugestão</button>
          <button className="btn sm" disabled={indo} onClick={() => decidir([...sel], "rejeitada")}>✗ Rejeitar</button>
          <select className="inp" value={paraFam} onChange={(e) => setParaFam(e.target.value)} style={{ width: 200, height: 30 }}>
            <option value="">Mover para família…</option>{fams.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          <button className="btn sm" disabled={indo || !paraFam} onClick={() => decidir([...sel], "alterada", Number(paraFam))}>Mover</button>
          <button className="btn sm" disabled={indo} onClick={() => decidir([...sel], "pendente")}>Desfazer decisão</button>
          <button className="btn sm" onClick={() => setSel(new Set())}>Limpar seleção</button>
        </div>
      )}
      {!sug && <div className="vazio">Carregando sugestões…</div>}
      {sug && !lista.length && <div className="vazio">Nada nesse filtro.</div>}
      {grupos.map(([g, l]) => {
        const ab = abertas.has(g), todosSel = l.every((x) => sel.has(x.n_cod_prod));
        return (
          <div key={g} style={{ borderBottom: "1px solid var(--ww-border)" }}>
            <div className="mov-dia" onClick={() => setAbertas((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; })}>
              <span style={{ display: "inline-flex", transform: `rotate(${ab ? 90 : 0}deg)`, transition: ".15s" }}>›</span>
              <b>{g}</b><span className="mini">{l.length} itens · {brl(l.reduce((s, x) => s + Math.max(x.item.saldo, 0) * x.item.cmc, 0))}</span>
              <span style={{ flex: 1 }} />
              {d.admin && <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
                <button className="btn sm" onClick={() => marcarGrupo(l, !todosSel)}>{todosSel ? "Desmarcar grupo" : "Marcar grupo"}</button>
                {l.some((x) => x.status === "pendente" && x.familia_sugerida_id) && <button className="btn sm pri" disabled={indo}
                  onClick={() => decidir(l.filter((x) => x.status === "pendente" && x.familia_sugerida_id).map((x) => x.n_cod_prod), "aceita")}>Aceitar o grupo</button>}
              </span>}
            </div>
            {ab && (
              <div className="scroll"><table className="tabela"><tbody>
                {l.map((s) => {
                  const [bd, tm] = banda(s.confianca);
                  return (
                    <tr key={s.n_cod_prod}>
                      {d.admin && <td style={{ width: 30 }}><input type="checkbox" checked={sel.has(s.n_cod_prod)} onChange={() => alterna(s.n_cod_prod)} aria-label="Selecionar" /></td>}
                      <td><b>{s.item.descricao}</b><div className="mini">{s.item.codigo_novo ? `${s.item.codigo_novo} · ` : ""}{s.item.codigo}{s.item.ncm ? ` · NCM ${s.item.ncm}` : ""} · hoje: {nome(s.familia_atual_id)}</div></td>
                      <td style={{ maxWidth: 360, minWidth: 160 }}><span className="mini">{s.motivo ?? "sem sinal suficiente"}</span></td>
                      <td>{s.familia_sugerida_id ? <Pill t={`${bd} ${Math.round(s.confianca * 100)}%`} tom={tm} /> : <Pill t="sem sugestão" tom="off" />}
                        {s.status !== "pendente" && <div className="mini">{s.status} · {s.decidido_por_email}</div>}</td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {d.admin && <select className="inp" style={{ width: 170, height: 30 }} value=""
                          onChange={(e) => e.target.value && decidir([s.n_cod_prod], "alterada", Number(e.target.value))}>
                          <option value="">{s.status === "pendente" ? "Escolher outra…" : nome(s.familia_escolhida_id ?? s.familia_atual_id)}</option>
                          {fams.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                        </select>}
                      </td>
                    </tr>
                  );
                })}
              </tbody></table></div>
            )}
          </div>
        );
      })}
    </div>
  </>);
}

// ── Códigos novos ────────────────────────────────────────────────────────────
function AbaCodigos({ d, mudou, avisar, irRevisao }: { d: { revisao_concluida: boolean; admin: boolean; codigos_gerados: number }; mudou: () => void; avisar: Avisar; irRevisao: () => void }) {
  const [p, setP] = useState<Previa[] | null>(null);
  const [busca, setBusca] = useState("");
  const [lim, setLim] = useState(200);
  const [conf, setConf] = useState(false);
  const [indo, setIndo] = useState(false);
  const carregar = useCallback(async () => {
    const r = await fetch("/api/estoque/codigos", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setP(j.previa); else avisar(j.error ?? "Erro", "crit");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); }, [carregar]);
  const lista = (p ?? []).filter((x) => !busca.trim() || `${x.descricao} ${x.codigo_omie} ${x.codigo_novo} ${x.familia}`.toLowerCase().includes(busca.trim().toLowerCase()));
  const porFam = useMemo(() => { const m = new Map<string, number>(); (p ?? []).forEach((x) => m.set(x.familia, (m.get(x.familia) ?? 0) + 1)); return [...m.entries()].sort((a, b) => b[1] - a[1]); }, [p]);
  return (<>
    {!d.revisao_concluida && (
      <div className="aviso t-warn"><span>Prévia provisória: os códigos só podem ser gerados depois que a <b>revisão de famílias</b> for concluída — a família de cada item define o prefixo.</span>
        <span style={{ flex: 1 }} /><button className="btn sm" onClick={irRevisao}>Ir para a revisão</button></div>
    )}
    <div className="cartao">
      <div className="head" style={{ padding: "12px 16px", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 200 }}><h3 style={{ margin: 0 }}>Prévia da codificação</h3>
          <div className="mini">{p ? `${q(p.length)} itens sem código novo · ${q(d.codigos_gerados)} já codificados · ordem: família, depois descrição` : "Carregando…"}</div></div>
        <input className="inp" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Filtrar…" style={{ width: 180 }} />
        <button className="btn sm" disabled={!p} onClick={() => p && baixarCSV("previa-codigos-estoque.csv", [["Família", "Código Omie", "Código novo", "Descrição"], ...p.map((x) => [x.familia, x.codigo_omie, x.codigo_novo, x.descricao])])}>CSV</button>
        {d.admin && <button className="btn sm pri" disabled={!d.revisao_concluida || !p?.length} title={d.revisao_concluida ? undefined : "Conclua a revisão de famílias primeiro"} onClick={() => setConf(true)}>Aplicar códigos…</button>}
      </div>
      {porFam.length > 0 && <div className="filtros" style={{ padding: "0 16px 10px" }}>{porFam.map(([f, nn]) => <span key={f} className="chip">{f} <b>{q(nn)}</b></span>)}</div>}
      <div className="scroll">
        <table className="tabela">
          <thead><tr><th>Família</th><th>Código Omie</th><th>→ Código novo</th><th>Descrição</th></tr></thead>
          <tbody>
            {lista.slice(0, lim).map((x) => (
              <tr key={x.n_cod_prod}><td>{x.familia}</td><td className="mono">{x.codigo_omie}</td><td className="mono"><b>{x.codigo_novo}</b></td><td>{x.descricao}</td></tr>
            ))}
            {p && !lista.length && <tr><td colSpan={4} className="vazio">Nada a codificar.</td></tr>}
          </tbody>
        </table>
        {lista.length > lim && <div className="mais"><button className="btn sm" onClick={() => setLim(lim + 500)}>Mostrar mais ({q(lista.length - lim)} restantes)</button></div>}
      </div>
    </div>
    {conf && (
      <div className="est-ov mid" onClick={() => setConf(false)} role="dialog" aria-modal="true">
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="mh"><div style={{ fontSize: 16, fontWeight: 700 }}>Gerar {q(p?.length ?? 0)} códigos novos?</div><button className="x" onClick={() => setConf(false)}>×</button></div>
          <div className="mb"><div className="prev">Cada item recebe o código da prévia (prefixo da família + 4 dígitos). O código do Omie continua ao lado e as buscas acham os dois. Nada muda no Omie. Depois, mudar a família de um item não troca o código — para isso use “Recodificar” na ficha (o código anterior vira apelido).</div></div>
          <div className="mf"><button className="btn" onClick={() => setConf(false)}>Cancelar</button>
            <button className="btn pri" disabled={indo} onClick={async () => {
              setIndo(true);
              try { const r = await postar<{ resultado: { codificados: number } }>("/api/estoque/codigos", { acao: "aplicar" }); avisar(`${q(r.resultado.codificados)} itens codificados`, "ok"); setConf(false); mudou(); await carregar(); }
              catch (e) { avisar((e as Error).message, "crit"); } finally { setIndo(false); }
            }}>{indo ? "Gerando…" : "Gerar códigos"}</button></div>
        </div>
      </div>
    )}
  </>);
}
