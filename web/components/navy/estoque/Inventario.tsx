"use client";

/**
 * Aba Inventário do Estoque — janelas com senha temporária. Ajustes ficam SÓ no painel.
 *   Todos:  entrar com a senha (vale nesta aba do navegador até a janela vencer).
 *   Admin:  abrir janela (nome, validade, escopo) → senha mostrada UMA vez; revogar;
 *           relatório por janela com conferido/contestado, reverter contestado e CSV.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { baixarCSV, nomeLocal, normAjuste, type AjusteEstoque, type ItemEstoque, type JanelaInventario } from "@/lib/estoque";
import { ModalSenha } from "./Acoes";
import { Pill, brl, escopoTxt, postar, q, useSessaoInv, useToast } from "./comum";

type JanelaLista = JanelaInventario & { totais: { n: number; valor: number; pendentes: number; contestados: number } };
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const estado = (j: JanelaInventario): [string, "ok" | "off" | "crit"] =>
  j.revogada_em ? ["revogada", "crit"] : new Date(j.valida_ate).getTime() <= Date.now() ? ["expirada", "off"] : ["ativa", "ok"];

const PRESETS: [string, number][] = [["24 h", 24], ["3 dias", 72], ["10 dias", 240]];

export default function AbaInventario({ admin, itens, aoMudar }: { admin: boolean; itens: ItemEstoque[]; aoMudar: () => void }) {
  const [sessao, setSessao] = useSessaoInv();
  const [senha, setSenha] = useState(false);
  const [toast, avisar] = useToast();
  const [janelas, setJanelas] = useState<JanelaLista[] | null>(null);
  const [rel, setRel] = useState<number | null>(null);
  const [nova, setNova] = useState<{ janela: JanelaInventario; codigo: string } | null>(null);

  const carregar = useCallback(async () => {
    if (!admin) return;
    const r = await fetch("/api/estoque/janela", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setJanelas(j.janelas); else avisar(j.error ?? "Erro ao carregar janelas", "crit");
  }, [admin]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); }, [carregar]);

  return (<>
    <div className="cartao" style={{ padding: "14px 16px" }}>
      <h3>Sua sessão de inventário</h3>
      {sessao ? (
        <div className="inv-barra t-ok">
          <span>Janela <b>{sessao.janela.nome}</b> · {escopoTxt(sessao.janela.escopo, nomeLocal)} · vale até <b>{dt(sessao.janela.valida_ate)}</b>. Abra um item e use <b>Ajustar saldo</b>.</span>
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => { setSessao(null); avisar("Saiu da janela de inventário", "info"); }}>Sair</button>
        </div>
      ) : (
        <div className="inv-barra t-off">
          <span>Para ajustar saldo é preciso a senha de uma janela de inventário aberta pelo Benny. Os ajustes ficam só no painel — o Omie não é alterado.</span>
          <span style={{ flex: 1 }} />
          <button className="btn sm pri" onClick={() => setSenha(true)}>Tenho a senha</button>
        </div>
      )}
    </div>

    {admin && <NovaJanela itens={itens} criada={(r) => { setNova(r); carregar(); }} avisar={avisar} />}

    {admin && (
      <div className="cartao">
        <div className="head" style={{ padding: "12px 16px" }}><h3 style={{ margin: 0 }}>Janelas de inventário</h3></div>
        <div className="scroll">
          <table className="tabela">
            <thead><tr><th>Janela</th><th>Situação</th><th className="opt">Escopo</th><th>Vale até</th><th className="r">Ajustes</th><th className="r opt">Valor líquido</th><th className="opt">Revisão</th><th /></tr></thead>
            <tbody>
              {(janelas ?? []).map((j) => {
                const [st, tm] = estado(j);
                return (
                  <tr key={j.id}>
                    <td><b>{j.nome}</b><div className="mini">criada {dt(j.created_at)} por {j.created_by_email ?? "—"}</div></td>
                    <td><Pill t={st} tom={tm} />{j.revogada_em && <div className="mini">{dt(j.revogada_em)}</div>}</td>
                    <td className="opt">{escopoTxt(j.escopo, nomeLocal)}</td>
                    <td className="num">{dt(j.valida_ate)}</td>
                    <td className="r num">{q(j.totais.n)}</td>
                    <td className="r num opt">{brl(j.totais.valor)}</td>
                    <td className="opt">{j.totais.pendentes ? <Pill t={`${j.totais.pendentes} a conferir`} tom="warn" /> : null}{j.totais.contestados ? <> <Pill t={`${j.totais.contestados} contestado(s)`} tom="crit" /></> : null}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn sm" onClick={() => setRel(j.id)}>Relatório</button>{" "}
                      {st === "ativa" && <Revogar id={j.id} feito={() => { avisar("Janela revogada — não aceita mais ajustes", "warn"); carregar(); }} avisar={avisar} />}
                    </td>
                  </tr>
                );
              })}
              {janelas && !janelas.length && <tr><td colSpan={8} className="vazio">Nenhuma janela aberta ainda.</td></tr>}
              {!janelas && <tr><td colSpan={8} className="vazio">Carregando…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    )}

    {admin && rel != null && <Relatorio id={rel} fechar={() => setRel(null)} avisar={avisar} aoMudar={() => { carregar(); aoMudar(); }} />}
    {senha && <ModalSenha fechar={() => setSenha(false)} ok={(s) => { setSessao(s); setSenha(false); avisar(`Janela “${s.janela.nome}” liberada nesta aba`, "ok"); }} />}
    {nova && <SenhaGerada r={nova} fechar={() => setNova(null)} />}
    {toast}
  </>);
}

function Revogar({ id, feito, avisar }: { id: number; feito: () => void; avisar: (m: string, t?: "crit") => void }) {
  const [conf, setConf] = useState(false);
  if (!conf) return <button className="btn sm" onClick={() => setConf(true)} style={{ color: "var(--ww-crit-text)" }}>Revogar</button>;
  return (<>
    <button className="btn sm" style={{ color: "var(--ww-crit-text)", borderColor: "var(--ww-crit)" }}
      onClick={async () => { try { await postar(`/api/estoque/janela/${id}`, { acao: "revogar" }); feito(); } catch (e) { avisar((e as Error).message, "crit"); } setConf(false); }}>
      Confirmar revogação</button>{" "}
    <button className="btn sm" onClick={() => setConf(false)}>Não</button>
  </>);
}

function NovaJanela({ itens, criada, avisar }: { itens: ItemEstoque[]; criada: (r: { janela: JanelaInventario; codigo: string }) => void; avisar: (m: string, t?: "crit") => void }) {
  const mes = new Date().toLocaleDateString("pt-BR", { month: "long" });
  const [nome, setNome] = useState(`Inventário ${mes}`);
  const [horas, setHoras] = useState(24);
  const [pers, setPers] = useState(false);
  const [dias, setDias] = useState("5");
  const [tipo, setTipo] = useState<"tudo" | "familia" | "local">("tudo");
  const [fam, setFam] = useState("");
  const [loc, setLoc] = useState("");
  const [indo, setIndo] = useState(false);
  const familias = useMemo(() => [...new Set(itens.map((i) => i.familia).filter(Boolean) as string[])].sort(), [itens]);
  const locais = useMemo(() => [...new Set(itens.flatMap((i) => i.locais.map((l) => l.local)))], [itens]);
  const h = pers ? Math.round(Number(dias.replace(",", ".")) * 24) : horas;
  const valido = nome.trim() && h >= 1 && h <= 720 && (tipo !== "familia" || fam) && (tipo !== "local" || loc);
  const criar = async () => {
    setIndo(true);
    try {
      const escopo = tipo === "familia" ? { familia: fam } : tipo === "local" ? { local: loc } : {};
      criada(await postar("/api/estoque/janela", { nome: nome.trim(), horas: h, escopo }));
    } catch (e) { avisar((e as Error).message, "crit"); } finally { setIndo(false); }
  };
  return (
    <div className="cartao" style={{ padding: "14px 16px" }}>
      <h3>Abrir janela de inventário <span className="mini">— só você (administrador) vê isto</span></h3>
      <div className="filtros" style={{ alignItems: "flex-end" }}>
        <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>Nome
          <input className="inp" value={nome} onChange={(e) => setNome(e.target.value)} style={{ width: 220 }} /></label>
        <div style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>Validade
          <div className="filtros">
            {PRESETS.map(([l, v]) => <button key={l} className={`chip ${!pers && horas === v ? "on" : ""}`} onClick={() => { setPers(false); setHoras(v); }}>{l}</button>)}
            <button className={`chip ${pers ? "on" : ""}`} onClick={() => setPers(true)}>Personalizado</button>
            {pers && <><input className="inp" value={dias} onChange={(e) => setDias(e.target.value)} style={{ width: 70 }} aria-label="Dias" /><span className="mini">dias (máx. 30)</span></>}
          </div>
        </div>
        <div style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600 }}>Escopo
          <div className="filtros">
            <button className={`chip ${tipo === "tudo" ? "on" : ""}`} onClick={() => setTipo("tudo")}>Todos os itens</button>
            <button className={`chip ${tipo === "familia" ? "on" : ""}`} onClick={() => setTipo("familia")} disabled={!familias.length} title={familias.length ? undefined : "Famílias ainda não sincronizadas"}>Uma família</button>
            <button className={`chip ${tipo === "local" ? "on" : ""}`} onClick={() => setTipo("local")}>Um local</button>
            {tipo === "familia" && <select className="inp" value={fam} onChange={(e) => setFam(e.target.value)} style={{ width: 220 }}><option value="">Escolha…</option>{familias.map((f) => <option key={f}>{f}</option>)}</select>}
            {tipo === "local" && <select className="inp" value={loc} onChange={(e) => setLoc(e.target.value)} style={{ width: 160 }}><option value="">Escolha…</option>{locais.map((l) => <option key={l} value={l}>{nomeLocal(l)}</option>)}</select>}
          </div>
        </div>
        <button className="btn pri" disabled={!valido || indo} onClick={criar}>{indo ? "Criando…" : "Gerar senha"}</button>
      </div>
      <div className="nota">A senha aparece uma única vez — o painel guarda só um resumo criptográfico dela. Passe ao time por WhatsApp ou pessoalmente. Você pode revogar a qualquer momento.</div>
    </div>
  );
}

function SenhaGerada({ r, fechar }: { r: { janela: JanelaInventario; codigo: string }; fechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="est-ov mid" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="mh"><div><div style={{ fontSize: 16, fontWeight: 700 }}>Senha da janela “{r.janela.nome}”</div>
          <div className="mini" style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>Vale até {dt(r.janela.valida_ate)} · {escopoTxt(r.janela.escopo, nomeLocal)}</div></div></div>
        <div className="mb">
          <div className="codigo">{r.codigo}</div>
          <div className="aviso t-warn">Anote ou copie agora: esta senha <b>não aparece de novo</b>. Se perder, revogue a janela e abra outra.</div>
        </div>
        <div className="mf">
          <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(r.codigo); setCopiado(true); } catch {} }}>{copiado ? "Copiada ✓" : "Copiar senha"}</button>
          <button className="btn pri" onClick={fechar}>Já anotei</button>
        </div>
      </div>
    </div>
  );
}

type Linha = AjusteEstoque & { item: { codigo: string; descricao: string; unidade: string } | null };

function Relatorio({ id, fechar, avisar, aoMudar }: { id: number; fechar: () => void; avisar: (m: string, t?: "ok" | "crit" | "warn") => void; aoMudar: () => void }) {
  const router = useRouter();
  const [d, setD] = useState<{ janela: JanelaInventario; ajustes: Linha[] } | null>(null);
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/estoque/janela/${id}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { avisar(j.error ?? "Erro", "crit"); return; }
    setD({ janela: j.janela, ajustes: (j.ajustes as Record<string, unknown>[]).map((a) => ({ ...normAjuste(a), item: (a.item as Linha["item"]) ?? null })) });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setD(null); carregar(); }, [carregar]);

  const acao = async (a: Linha, ac: string) => {
    try { await postar(`/api/estoque/ajuste/${a.id}`, { acao: ac }); await carregar(); aoMudar(); avisar(ac === "reverter" ? "Ajuste revertido" : `Marcado como ${ac}`, ac === "contestado" ? "warn" : "ok"); }
    catch (e) { avisar((e as Error).message, "crit"); }
  };
  if (!d) return <div className="cartao vazio">Carregando relatório…</div>;
  const vivos = d.ajustes.filter((a) => a.status === "aplicado");
  const ent = vivos.filter((a) => a.diferenca > 0), sai = vivos.filter((a) => a.diferenca < 0);
  const soma = (l: Linha[], f: (a: Linha) => number) => l.reduce((s, a) => s + f(a), 0);
  const porQuem = new Map<string, Linha[]>();
  vivos.forEach((a) => { const k = a.created_by_email ?? "—"; (porQuem.get(k) ?? porQuem.set(k, []).get(k)!).push(a); });
  const csv = () => baixarCSV(`inventario-${d.janela.id}-${d.janela.nome.replace(/\W+/g, "-")}.csv`, [
    ["Data", "Quem", "Código", "Item", "Local", "Saldo antes", "Contagem", "Diferença", "CMC", "Valor", "Motivo", "Obs", "Situação", "Revisão", "Revisado por"],
    ...d.ajustes.map((a) => [a.created_at, a.created_by_email, a.item?.codigo, a.item?.descricao, nomeLocal(a.codigo_local_estoque), a.saldo_antes, a.contagem,
      a.diferenca, a.cmc, a.valor, a.motivo, a.obs, a.status, a.revisao, a.revisado_por_email]),
  ]);
  const [st, tm] = estado(d.janela);
  return (
    <div className="cartao">
      <div className="head" style={{ padding: "12px 16px" }}>
        <div style={{ flex: 1, minWidth: 200 }}><h3 style={{ margin: 0 }}>Relatório · {d.janela.nome} <Pill t={st} tom={tm} /></h3>
          <div className="mini">{escopoTxt(d.janela.escopo, nomeLocal)} · vale até {dt(d.janela.valida_ate)}</div></div>
        <button className="btn sm" onClick={csv}>CSV</button>
        <button className="btn sm" onClick={fechar}>Fechar</button>
      </div>
      <section className="kpis" style={{ padding: "0 16px 12px" }}>
        <div className="kpi hero" style={{ cursor: "default" }}><div className="r">Ajustes</div><div className="v">{q(vivos.length)}</div><div className="s">{d.ajustes.length - vivos.length} revertido(s)</div></div>
        <div className="kpi" style={{ cursor: "default" }}><div className="r">Entradas</div><div className="v">{brl(soma(ent, (a) => a.valor))}</div><div className="s">{ent.length} ajustes · +{q(soma(ent, (a) => a.diferenca))} un</div></div>
        <div className="kpi" style={{ cursor: "default" }}><div className="r">Saídas</div><div className="v">{brl(soma(sai, (a) => a.valor))}</div><div className="s">{sai.length} ajustes · {q(soma(sai, (a) => a.diferenca))} un</div></div>
        <div className="kpi" style={{ cursor: "default" }}><div className="r">A conferir</div><div className="v">{q(vivos.filter((a) => a.revisao === "pendente").length)}</div>
          <div className="s">{vivos.filter((a) => a.revisao === "contestado").length} contestado(s)</div></div>
      </section>
      {porQuem.size > 0 && (
        <div style={{ padding: "0 16px 10px" }} className="filtros">
          {[...porQuem.entries()].map(([k, l]) => <span key={k} className="chip">{k} <b>{l.length}</b> · {brl(soma(l, (a) => a.valor))}</span>)}
        </div>
      )}
      <div className="scroll">
        <table className="tabela">
          <thead><tr><th>Quando / quem</th><th>Item</th><th className="opt">Local</th><th className="r">Antes</th><th className="r">Contagem</th><th className="r">Dif.</th><th className="r opt">Valor</th><th className="opt">Motivo</th><th>Revisão</th><th /></tr></thead>
          <tbody>
            {d.ajustes.map((a) => (
              <tr key={a.id} style={{ opacity: a.status === "revertido" ? 0.5 : 1 }}>
                <td className="num">{dt(a.created_at)}<div className="mini">{a.created_by_email}</div></td>
                <td style={{ cursor: "pointer" }} onClick={() => a.item && router.push(`/estoque/${encodeURIComponent(a.item.codigo)}`)}>
                  <b>{a.item?.codigo}</b><div className="mini">{a.item?.descricao}</div></td>
                <td className="opt">{nomeLocal(a.codigo_local_estoque)}</td>
                <td className="r num">{q(a.saldo_antes)}</td>
                <td className="r num">{q(a.contagem)}</td>
                <td className="r num" style={{ fontWeight: 600, color: `var(--ww-${a.diferenca < 0 ? "crit" : "ok"}-text)` }}>{a.diferenca > 0 ? "+" : ""}{q(a.diferenca)}</td>
                <td className="r num opt">{brl(a.valor)}</td>
                <td className="opt">{a.motivo}{a.obs && <div className="mini">{a.obs}</div>}</td>
                <td>{a.status === "revertido" ? <Pill t="revertido" tom="off" /> : <Pill t={a.revisao} tom={a.revisao === "conferido" ? "ok" : a.revisao === "contestado" ? "crit" : "warn"} />}
                  {a.revisado_por_email && a.status !== "revertido" && <div className="mini">{a.revisado_por_email}</div>}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {a.status === "aplicado" && (<>
                    <button className="btn sm" title="Conferido" onClick={() => acao(a, "conferido")} disabled={a.revisao === "conferido"}>✓</button>{" "}
                    <button className="btn sm" title="Contestado" onClick={() => acao(a, "contestado")} disabled={a.revisao === "contestado"}>✗</button>
                    {a.revisao === "contestado" && <>{" "}<button className="btn sm" style={{ color: "var(--ww-crit-text)" }} onClick={() => acao(a, "reverter")}>Reverter</button></>}
                  </>)}
                </td>
              </tr>
            ))}
            {!d.ajustes.length && <tr><td colSpan={10} className="vazio">Nenhum ajuste nesta janela ainda.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
