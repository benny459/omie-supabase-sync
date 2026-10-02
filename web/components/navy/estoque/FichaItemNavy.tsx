"use client";

/**
 * Ficha do item do estoque (/estoque/[codigo]) — fase 1, só leitura.
 * Porte da ficha do mockup web/docs/mockups/estoque-ficha-item: foto (placeholder até a fase 2),
 * indicadores, saldo por local, abas Onde foi usado · Movimentação · Pedidos de compra ·
 * Fornecedores e preços · Auditoria, e ‹ › para andar pela lista filtrada.
 * Ajustar saldo: só com a senha de uma janela de inventário (fica SÓ no painel, nunca no Omie).
 * Mesclagem: aviso "mesclado em X" no secundário; o principal mostra o histórico dos mesclados.
 * Foto: bucket privado "produtos" (FotoItem). Pedir compra: fase 2 (botão "em breve").
 */

import "./estoque.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  alarme, auditoria, baixarCSV, chaveSaldo, cobertura, consumoDia, dias, hoje, nomeLocal, normAjuste, normItem, normMov, normPc, pcAberto,
  precosPorFornecedor, quebras, situacao, somaDias, valorItem,
  type AbaFicha, type AjusteEstoque, type ItemEstoque, type MovEstoque, type PcItem, type Tom,
} from "@/lib/estoque";
import {
  IconeCaixa, Lupa, PaletaEstoque, Pill, Seta, brl, ddmmaa, escopoTxt, invalidarItens, kbrl, lerNavegacao, marcarRecente, postar, q,
  useAtalhoPaleta, useItensEstoque, useSessaoInv, useToast, type SessaoInv,
} from "./comum";
import { ModalAjuste, ModalMesclar, ModalSenha } from "./Acoes";
import { FotoItem } from "./FotoItem";
import { MovsPainelItem } from "./Movimentacoes";

type Mescla = { id: number; principal: number; secundario: number; grupo_id: number | null; secundario_item: { codigo: string; descricao: string } | null };
type Mesclado = { n_cod_prod: number; codigo: string; descricao: string };
type Ficha = {
  item: ItemEstoque; movs: MovEstoque[]; pcs: PcItem[]; dups: { tipo: string; sim: number; item: ItemEstoque | null }[];
  ajustes: AjusteEstoque[]; mesclas: Mescla[]; mesclados: Mesclado[]; admin: boolean; aliases: Alias[]; de: string | null;
};
const ABAS: AbaFicha[] = ["uso", "mov", "compras", "forn", "auditoria"];
const EM_BREVE = "Em breve — próxima fase do Estoque v2";

export default function FichaItemNavy({ codigo, abaInicial }: { codigo: string; abaInicial?: string }) {
  const router = useRouter();
  const [f, setF] = useState<Ficha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<AbaFicha>(ABAS.includes(abaInicial as AbaFicha) ? (abaInicial as AbaFicha) : "uso");
  const [pal, setPal] = useState(false);
  const [nav, setNav] = useState<string[]>([]);
  const { dados } = useItensEstoque();
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => { invalidarItens(); setVersao((v) => v + 1); }, []);

  useEffect(() => { setNav(lerNavegacao()); }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    setErro(null);
    fetch(`/api/estoque/item/${encodeURIComponent(codigo)}`, { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        const item = normItem(j.item);
        // Código mesclado responde no principal: abre a ficha do principal (?ficar=1 mostra o código antigo).
        const url = new URL(window.location.href);
        if (item.mesclado_em_codigo && !url.searchParams.get("ficar")) {
          router.replace(`/estoque/${encodeURIComponent(item.mesclado_em_codigo)}?de=${encodeURIComponent(codigo)}`);
          return;
        }
        marcarRecente(item.n_cod_prod);
        setF({
          item, movs: (j.movs as Record<string, unknown>[]).map(normMov), pcs: (j.pcs as Record<string, unknown>[]).map(normPc),
          dups: (j.dups as { tipo: string; sim: number; item: Record<string, unknown> | null }[])
            .map((d) => ({ tipo: d.tipo, sim: Number(d.sim), item: d.item ? normItem(d.item) : null })),
          ajustes: ((j.ajustes ?? []) as Record<string, unknown>[]).map(normAjuste),
          mesclas: ((j.mesclas ?? []) as Mescla[]).map((m) => ({ ...m, principal: Number(m.principal), secundario: Number(m.secundario), grupo_id: m.grupo_id == null ? null : Number(m.grupo_id) })),
          mesclados: ((j.mesclados ?? []) as Mesclado[]).map((m) => ({ ...m, n_cod_prod: Number(m.n_cod_prod) })),
          de: url.searchParams.get("de"),
          admin: !!j.admin,
          aliases: ((j.aliases ?? []) as Record<string, unknown>[]).map((x) => normAlias(x, Number(j.item.n_cod_prod))),
        });
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") setErro((e as Error).message); });
    return () => ctrl.abort();
  }, [codigo, versao, router]);
  useEffect(() => { setF(null); }, [codigo]);

  const ir = useCallback((cod: string, a?: string) => router.push(`/estoque/${encodeURIComponent(cod)}${a ? `?aba=${a}` : ""}`), [router]);
  const idx = nav.indexOf(codigo);
  const andar = (d: number) => { if (idx < 0 || !nav.length) return; ir(nav[(idx + d + nav.length) % nav.length], aba); };

  const abrirPal = useCallback(() => setPal(true), []);
  useAtalhoPaleta(abrirPal);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (pal || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA"))) return;
      if (e.key === "ArrowRight" && e.altKey) andar(1);
      if (e.key === "ArrowLeft" && e.altKey) andar(-1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const porId = useMemo(() => new Map((dados?.itens ?? []).map((p) => [p.n_cod_prod, p])), [dados]);

  return (
    <div className="est">
      <div className="crumbs">
        <button className="link" onClick={() => router.push("/estoque")}><Seta dir="esq" />Estoque</button>
        <span>/</span><span>{f?.item.codigo ?? codigo}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {idx >= 0 && nav.length > 1 && <span className="mini">{idx + 1} de {q(nav.length)}</span>}
          <button className="btn sm" onClick={() => andar(-1)} disabled={idx < 0} title="Item anterior da lista (Alt ←)" aria-label="Item anterior"><Seta dir="esq" /></button>
          <button className="btn sm" onClick={() => andar(1)} disabled={idx < 0} title="Próximo item da lista (Alt →)" aria-label="Próximo item"><Seta dir="dir" /></button>

        </span>
      </div>

      {erro && <div className="aviso t-crit">{erro}</div>}
      {!f && !erro && <div className="cartao vazio">Carregando ficha…</div>}
      {f && <Conteudo f={f} aba={aba} setAba={setAba} ir={ir} recarregar={recarregar} itensTodos={dados?.itens ?? []} />}

      {pal && dados && (
        <PaletaEstoque itens={dados.itens} fechar={() => setPal(false)}
          onItem={(p) => ir(p.codigo)}
          onPc={(id) => { const p = porId.get(id); if (p) ir(p.codigo, "compras"); }}
          onCliente={(nome) => { router.push(`/estoque?cliente=${encodeURIComponent(nome)}`); }} />
      )}
    </div>
  );
}

function Conteudo({ f, aba, setAba, ir, recarregar, itensTodos }: {
  f: Ficha; aba: AbaFicha; setAba: (a: AbaFicha) => void; ir: (cod: string, a?: string) => void; recarregar: () => void; itensTodos: ItemEstoque[];
}) {
  const router = useRouter();
  const [sessao, setSessao] = useSessaoInv();
  const [modal, setModal] = useState<null | "senha" | "ajuste" | "recodificar" | { mesclar: ItemEstoque[] }>(null);
  const [toast, avisar] = useToast();
  const [ocupado, setOcupado] = useState(false);
  const [mais, setMais] = useState(false);
  const [novaMov, setNovaMov] = useState(false);
  const mesclado = f.item.mesclado_em != null;
  const pedirAjuste = () => setModal(sessao ? "ajuste" : "senha");
  const naoE = async (outro: ItemEstoque) => {
    setOcupado(true);
    try { await postar("/api/estoque/duplicidade", { acao: "nao_e", empresa: f.item.empresa, a: f.item.n_cod_prod, b: outro.n_cod_prod }); avisar("Par marcado como não duplicidade", "ok"); recarregar(); }
    catch (e) { avisar((e as Error).message, "crit"); } finally { setOcupado(false); }
  };
  const desfazerMescla = async (m: Mescla) => {
    setOcupado(true);
    try {
      await postar("/api/estoque/duplicidade", m.grupo_id != null ? { acao: "desfazer_grupo", id: m.grupo_id } : { acao: "desfazer", id: m.id });
      avisar("Mesclagem desfeita — saldos voltaram", "ok"); recarregar();
    }
    catch (e) { avisar((e as Error).message, "crit"); } finally { setOcupado(false); }
  };
  const trocarPrincipal = async (grupo: number, novo: number, cod: string) => {
    setOcupado(true);
    try { await postar("/api/estoque/duplicidade", { acao: "trocar_principal", id: grupo, principal: novo }); avisar(`Agora o principal é ${cod}`, "ok"); ir(cod); }
    catch (e) { avisar((e as Error).message, "crit"); } finally { setOcupado(false); }
  };
  const aliases: EstadoAliases = { ok: true, lista: f.aliases };
  const nomesSec = new Map<number, string>([
    ...f.mesclas.filter((m) => m.principal === f.item.n_cod_prod).map((m): [number, string] => [m.secundario, m.secundario_item?.codigo ?? String(m.secundario)]),
    ...f.mesclados.map((m): [number, string] => [m.n_cod_prod, m.codigo]),
  ]);
  const diretas = f.mesclas.filter((m) => m.principal === f.item.n_cod_prod);
  const grupos = [...new Set(diretas.map((m) => m.grupo_id).filter((g): g is number => g != null))];
  const avulsas = diretas.filter((m) => m.grupo_id == null);
  const p = f.item, s = p.saldo, cob = cobertura(p), [st, tom] = situacao(p);
  const ano = somaDias(hoje(), -365), dois = somaDias(hoje(), -730);
  const usos = f.movs.filter((m) => m.qtde < 0 && !m.cancelado && m.dt_mov >= ano);
  const pcs24 = f.pcs.filter((x) => (x.emissao ?? "") >= dois);
  const precos = useMemo(() => precosPorFornecedor(f.pcs), [f.pcs]);
  const temDup = f.dups.length > 0;
  const pts = useMemo(() => auditoria(p, f.movs, f.pcs, temDup), [p, f.movs, f.pcs, temDup]);
  const nA = pts.filter((x) => x.tom === "crit" || x.tom === "warn").length;
  const ultPc = f.pcs.filter((x) => x.valor_unit > 0)[0];
  const abertos = pcs24.filter(pcAberto);

  return (<>
    {mesclado && (
      <div className="aviso t-warn">
        <span>Este código foi <b>mesclado em {p.mesclado_em_codigo ?? p.mesclado_em}</b> — o saldo dele passou para o principal e ele saiu da lista.</span>
        <span style={{ flex: 1 }} />
        {p.mesclado_em_codigo && <button className="btn sm" onClick={() => ir(p.mesclado_em_codigo!)}>Abrir o principal</button>}
      </div>
    )}
    {f.de && f.de !== p.codigo && (
      <div className="aviso t-info"><span>Você abriu <b>{f.de}</b>, que foi mesclado neste código — tudo dele responde aqui.</span>
        <span style={{ flex: 1 }} /><button className="btn sm" onClick={() => router.push(`/estoque/${encodeURIComponent(f.de!)}?ficar=1`)}>Ver o código antigo</button></div>
    )}
    {nomesSec.size > 0 && (
      <div className="aviso t-info" style={{ flexWrap: "wrap" }}>
        <span>Este código recebeu a mesclagem de <b>{[...nomesSec.values()].join(", ")}</b>: Kardex, PCs, usos e saldo deles respondem aqui.</span>
        <span style={{ flex: 1 }} />
        {f.admin && avulsas.map((m) => (
          <button key={m.id} className="btn sm" disabled={ocupado} onClick={() => desfazerMescla(m)}>Desfazer mesclagem de {nomesSec.get(m.secundario)}</button>
        ))}
        {f.admin && grupos.map((g) => {
          const doG = diretas.filter((m) => m.grupo_id === g);
          return (
            <span key={g} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <select className="inp" style={{ height: 30 }} disabled={ocupado} value="" aria-label="Trocar o principal"
                onChange={(e) => { const id = Number(e.target.value); if (id) trocarPrincipal(g, id, nomesSec.get(id) ?? String(id)); }}>
                <option value="">Trocar principal…</option>
                {doG.map((m) => <option key={m.secundario} value={m.secundario}>{nomesSec.get(m.secundario)}</option>)}
              </select>
              <button className="btn sm" disabled={ocupado} onClick={() => desfazerMescla(doG[0])}>Desfazer o grupo</button>
            </span>
          );
        })}
      </div>
    )}
    <div className="cartao">
      <div className="ficha-top">
        <FotoItem n={p.n_cod_prod} avisar={avisar} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Pill t={st} tom={tom} />
            <Pill t={alarme(p)[0]} tom={alarme(p)[1]} />
            {temDup && <Pill t="possível duplicidade" tom="violet" />}
            {p.ajuste !== 0 && <Pill t="saldo ajustado no painel" tom="info" />}
            {p.omie_status === "ok" && <Pill t="✓ no Omie" tom="ok" />}
            {p.omie_status === "erro" && <Pill t={`Omie: erro — ${p.omie_erro ?? ""}`} tom="crit" title={p.omie_erro ?? undefined} />}
            {p.n_cod_prod < 0 && p.omie_status !== "erro" && <Pill t="só no painel (ainda sem id do Omie)" tom="warn" />}
            {!p.ativo && <Pill t="inativo" tom="off" />}
          </div>
          <div className="titulo-item">{p.descricao}</div>
          <div className="meta">
            {p.codigo_novo && <span style={{ fontWeight: 700, color: "var(--ww-text)" }}>Código {p.codigo_novo}</span>}
            <span>Código Omie {p.codigo_omie ?? (p.n_cod_prod < 0 ? "—" : p.codigo)}</span>
            {p.familia && <span>Família {p.familia}{p.familia_prefixo ? ` (${p.familia_prefixo})` : ""}</span>}
            {p.codigos_antigos.length > 0 && <span title="Códigos anteriores (apelidos)">antes: {p.codigos_antigos.join(", ")}</span>}
            <span>{p.unidade}</span>{p.ncm && <span>NCM {p.ncm}</span>}{p.n_cod_prod > 0 && <span>id Omie {p.n_cod_prod}</span>}
            {precos[0] && <span>Fornecedor principal: {precos[0].fornecedor}</span>}
          </div>
          <div className="stats">
            <Stat r="Saldo" v={q(s)} s={p.ajuste !== 0 ? `Omie: ${q(p.saldo_omie)}` : `${p.unidade.toLowerCase()} · Omie`} cor={s < 0 ? "var(--ww-crit-text)" : undefined} />
            <Stat r="Pendente" v={q(p.pendente)} s={`${abertos.length} PC${abertos.length === 1 ? "" : "s"} aberto${abertos.length === 1 ? "" : "s"} (24 m)`} />
            <Stat r="Consumo / mês" v={consumoDia(p) ? q(Math.round(consumoDia(p) * 30)) : "—"} s="média de 90 dias" />
            <Stat r="Cobertura" v={cob === null ? "—" : `${cob > 999 ? "999+" : q(cob)} d`}
              s={cob === null ? "sem consumo" : cob === 0 ? "em ruptura" : `até ~${ddmmaa(somaDias(hoje(), Math.min(cob, 3650)))}`} />
            {p.cmc_ponderado
              ? <Stat r="CMC (ponderado após mesclagem) ⓘ" v={brl(p.cmc)} s={`o do Omie era ${brl(p.cmc_proprio)}`}
                  titulo={`Média ponderada pelo estoque positivo de cada código:\n${(p.cmc_partes ?? []).map((x) => `${x.codigo}${x.proprio ? " (este, no Omie)" : " (mesclado)"}: ${q(x.qtd)} × ${brl(x.cmc)}`).join("\n")}`} />
              : <Stat r="CMC" v={brl(p.cmc)} s={ultPc ? `últ. PC ${brl(ultPc.valor_unit)}` : "custo médio"} />}
            <Stat r="Valor" v={kbrl(valorItem(p))} s="saldo × CMC" />
          </div>
          {p.locais.length > 1 && (
            <div className="locais">
              {p.locais.map((l) => (
                <div key={l.local} className="stat"><span className="mini">{nomeLocal(l.local)}</span>{" "}
                  <b className="num" style={{ color: l.saldo < 0 ? "var(--ww-crit-text)" : undefined }}>{q(l.saldo)}</b></div>
              ))}
            </div>
          )}
          <div className="acoes-item">
            <button className="btn pri" onClick={pedirAjuste} disabled={mesclado}
              title={mesclado ? "Código mesclado — ajuste o principal" : sessao ? `Janela “${sessao.janela.nome}” · ${escopoTxt(sessao.janela.escopo, nomeLocal)}` : "Peça a senha de inventário ao Benny"}>
              Ajustar saldo{sessao ? "" : " 🔒"}</button>
            <button className="btn" onClick={() => { setAba("mov"); setNovaMov(true); }} disabled={mesclado}>+ Nova movimentação</button>
            <span style={{ position: "relative" }}>
              <button className="btn" onClick={() => setMais((x) => !x)} aria-expanded={mais}>Mais ações ▾</button>
              {mais && (
                <div className="menu-mais" onMouseLeave={() => setMais(false)}>
                  <button onClick={() => router.push(`/estoque/${encodeURIComponent(p.codigo_novo ?? p.codigo)}/editar`)}>Editar cadastro</button>
                  <button onClick={() => router.push(`/estoque/${encodeURIComponent(p.codigo_novo ?? p.codigo)}/editar`)}>{p.alarme_minimo != null ? "Editar alarme" : "Definir alarme"}</button>
                  {f.admin && p.codigo_novo && <button onClick={() => { setMais(false); setModal("recodificar"); }}>Recodificar…</button>}
                  <button disabled title={EM_BREVE}>Pedir compra (em breve)</button>
                </div>
              )}
            </span>
          </div>
          {!sessao && !mesclado && <div className="mini" style={{ marginTop: 6 }}>Ajustar saldo exige a senha de inventário — peça ao Benny.</div>}
          {sessao && <div className="mini" style={{ marginTop: 6 }}>Janela de inventário <b>{sessao.janela.nome}</b> aberta nesta aba até {new Date(sessao.janela.valida_ate).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}.</div>}
        </div>
      </div>

      <div className="subtabs" role="tablist">
        {([["uso", "Onde foi usado", usos.length], ["mov", "Movimentação", f.movs.length], ["compras", "Pedidos de compra", pcs24.length],
          ["forn", "Fornecedores e preços", precos.length], ["auditoria", "Auditoria", nA]] as [AbaFicha, string, number][]).map(([k, l, nn]) => (
          <button key={k} className={aba === k ? "on" : ""} onClick={() => setAba(k)} role="tab" aria-selected={aba === k}>
            {l}<span className={`cnt ${k === "auditoria" && nn ? "w" : ""}`}>{nn}</span>
          </button>
        ))}
      </div>
      <div className="painel">
        {aba === "uso" && <AbaUso p={p} usos={usos} filtrarCliente={(c) => router.push(`/estoque?cliente=${encodeURIComponent(c)}`)} />}
        {aba === "mov" && <><MovsPainelItem key={novaMov ? "n" : "v"} item={p} itens={itensTodos} abrirNova={novaMov} aoFechar={() => setNovaMov(false)} /><AbaMov p={p} movs={f.movs} nomesSec={nomesSec} /></>}
        {aba === "compras" && <AbaCompras p={p} pcs={pcs24} abertos={abertos} />}
        {aba === "forn" && <><SecaoAliases st={aliases} codigoDe={(id) => nomesSec.get(id) ?? ""} /><AbaForn pcs={f.pcs} precos={precos} /></>}
        {aba === "auditoria" && <AbaAuditoria pts={pts} dups={f.dups} setAba={setAba} ir={ir} ajustes={f.ajustes} aliases={aliases?.lista ?? []} admin={f.admin} ocupado={ocupado}
          pedirAjuste={pedirAjuste} mesclar={(o) => setModal({ mesclar: [p, o] })} naoE={naoE} codigoDe={(id) => (id === p.n_cod_prod ? p.codigo : nomesSec.get(id) ?? String(id))} />}
      </div>
    </div>
    {modal === "senha" && <ModalSenha fechar={() => setModal(null)} ok={(s: SessaoInv) => { setSessao(s); setModal("ajuste"); }} />}
    {modal === "recodificar" && <ModalRecodificar p={p} fechar={() => setModal(null)} ok={(c) => { setModal(null); avisar(`Novo código ${c} — o anterior virou apelido`, "ok"); invalidarItens(); ir(c); }} />}
    {modal === "ajuste" && sessao && <ModalAjuste p={p} sessao={sessao} fechar={() => setModal(null)}
      ok={() => { setModal(null); avisar("Saldo ajustado no painel", "ok"); recarregar(); }} />}
    {modal && typeof modal === "object" && <ModalMesclar itens={modal.mesclar} fechar={() => setModal(null)}
      ok={(pr) => { setModal(null); avisar(`Mesclado em ${pr.codigo}`, "ok"); if (pr.n_cod_prod === p.n_cod_prod) recarregar(); else { invalidarItens(); ir(pr.codigo); } }} />}
    {toast}
  </>);
}

function Stat({ r, v, s, cor, titulo }: { r: string; v: string; s: string; cor?: string; titulo?: string }) {
  return (
    <div className="stat" title={titulo}><div className="r1">{r}</div><div className="v1" style={{ color: cor }} title={titulo ?? v}>{v}</div><div className="s1">{s}</div></div>
  );
}

// ── Onde foi usado ───────────────────────────────────────────────────────────
function AbaUso({ p, usos, filtrarCliente }: { p: ItemEstoque; usos: MovEstoque[]; filtrarCliente: (c: string) => void }) {
  const [por, setPor] = useState<"cliente" | "projeto">("cliente");
  if (!usos.length) return <div className="vazio">Sem saídas nos últimos 12 meses.</div>;
  const u = p.unidade.toLowerCase();
  const m = new Map<string, number>();
  usos.forEach((x) => { const k = (por === "cliente" ? x.cliente : x.projeto) || `Sem ${por} vinculado`; m.set(k, (m.get(k) ?? 0) - x.qtde); });
  const lst = [...m.entries()].sort((a, b) => b[1] - a[1]), mx = lst[0][1], tot = lst.reduce((a, x) => a + x[1], 0);
  return (
    <div className="grid2">
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>Por {por} · 12 meses</h3>
          <div className="seg" style={{ marginLeft: "auto" }}>
            <button className={por === "cliente" ? "on" : ""} onClick={() => setPor("cliente")}>Cliente</button>
            <button className={por === "projeto" ? "on" : ""} onClick={() => setPor("projeto")}>Projeto</button>
          </div>
        </div>
        <div className="lista-barras">
          {lst.slice(0, 15).map(([nome, v]) => {
            const sem = nome.startsWith("Sem "), clicavel = !sem && por === "cliente";
            return (
              <div key={nome} className="l" style={clicavel ? { cursor: "pointer" } : undefined} onClick={clicavel ? () => filtrarCliente(nome) : undefined}
                title={clicavel ? `Ver todos os itens usados por ${nome}` : undefined}>
                <span className="nm" style={sem ? { color: "var(--ww-warn-text)" } : undefined}>{nome}</span>
                <div className="barra"><i style={{ width: `${(v / mx) * 100}%`, background: sem ? "var(--ww-warn)" : "var(--ww-brand-3)" }} /></div>
                <span className="r num">{q(v)} {u}</span>
              </div>
            );
          })}
        </div>
        <div className="nota">{q(tot)} {u} em {usos.length} saídas. Clique num cliente para ver todos os itens que ele usou. Saídas sem cliente são remessas e ajustes: o cliente da remessa entra com o sync de remessas (fase 5).</div>
      </div>
      <div>
        <h3>Saídas</h3>
        <div style={{ maxHeight: 420, overflow: "auto" }}>
          <table className="tabela">
            <thead><tr><th>Data</th><th>Cliente / projeto</th><th>Pedido</th><th className="r">Qtde</th></tr></thead>
            <tbody>
              {usos.slice().reverse().map((x) => (
                <tr key={x.id_mov}>
                  <td className="num">{ddmmaa(x.dt_mov)}</td>
                  <td>{x.cliente ? <><div style={{ fontWeight: 600 }}>{x.cliente}</div><div className="mini">{x.projeto || "sem projeto"}</div></>
                    : <span style={{ color: "var(--ww-warn-text)" }}>{x.des_origem} — sem cliente</span>}</td>
                  <td className="mini">{x.pv_numero ? `PV ${x.pv_numero}` : x.num_pedido || x.doc}</td>
                  <td className="r num" style={{ color: "var(--ww-crit-text)" }}>−{q(-x.qtde)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Movimentação (Kardex) ────────────────────────────────────────────────────
function AbaMov({ p, movs, nomesSec }: { p: ItemEstoque; movs: MovEstoque[]; nomesSec: Map<number, string> }) {
  if (!movs.length) return <div className="vazio">Sem movimentos sincronizados.</div>;
  const qb = quebras(movs);
  const csv = () => baixarCSV(`kardex-${p.codigo}-${hoje()}.csv`, [
    ["Data", "Origem", "Local", "Doc / pedido", "Cliente", "Projeto", "Qtde", "Valor unit.", "Saldo", "Cancelado", "Saldo não fecha"],
    ...movs.map((m, i) => [m.dt_mov, m.des_origem, nomeLocal(m.codigo_local_estoque), m.doc ?? m.num_pedido, m.cliente, m.projeto,
      m.qtde, m.valor, m.saldo, m.cancelado ? "sim" : "", qb.has(i) ? "sim" : ""]),
  ]);
  return (<>
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
      <h3 style={{ margin: 0 }}>Saldo ao longo do tempo · 12 meses</h3>
      <span className="mini">pontos em coral = saldo que não fecha com o movimento anterior</span>
      <button className="btn sm" style={{ marginLeft: "auto" }} onClick={csv}>Exportar Kardex</button>
    </div>
    <GraficoSaldo movs={movs} qb={qb} />
    <div style={{ maxHeight: 460, overflow: "auto", marginTop: 12 }}>
      <table className="tabela">
        <thead><tr><th>Data</th><th>Origem</th><th>Doc / pedido</th><th className="opt">Cliente</th><th className="r">Qtde</th><th className="r opt">Valor unit.</th><th className="r">Saldo</th><th /></tr></thead>
        <tbody>
          {movs.map((m, i) => [m, i] as const).reverse().map(([m, i]) => (
            <tr key={m.id_mov} style={{ opacity: m.cancelado ? 0.45 : 1, textDecoration: m.cancelado ? "line-through" : undefined }}>
              <td className="num">{ddmmaa(m.dt_mov)}</td>
              <td>{m.des_origem}{(p.locais.length > 1 || nomesSec.size > 0) && <div className="mini">{nomeLocal(m.codigo_local_estoque)}{m.id_prod != null && m.id_prod !== p.n_cod_prod ? ` · código ${nomesSec.get(m.id_prod) ?? m.id_prod}` : ""}</div>}</td>
              <td className="mini">{m.doc}{m.pv_numero && <div>PV {m.pv_numero}</div>}</td>
              <td className="opt">{m.cliente ?? ""}</td>
              <td className="r num" style={{ fontWeight: 600, color: `var(--ww-${m.qtde < 0 ? "crit" : "ok"}-text)` }}>{m.qtde > 0 ? "+" : "−"}{q(Math.abs(m.qtde))}</td>
              <td className="r num opt">{brl(m.valor)}</td>
              <td className="r num" style={qb.has(i) ? { color: "var(--ww-crit-text)", fontWeight: 700 } : undefined}>{q(m.saldo)}</td>
              <td>{qb.has(i) ? <Pill t="não fecha" tom="crit" /> : m.cancelado ? <Pill t="cancelado" tom="off" /> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="nota">Kardex completo sincronizado do Omie (orders.estoque_movimentos), com cliente e projeto pelo pedido de venda.</div>
  </>);
}

function GraficoSaldo({ movs, qb }: { movs: MovEstoque[]; qb: Set<number> }) {
  const W = 900, H = 220, P = { l: 52, r: 12, t: 14, b: 24 }, H0 = hoje();
  const x0 = new Date(somaDias(H0, -365) + "T12:00:00Z").getTime(), x1 = new Date(H0 + "T12:00:00Z").getTime();
  const porLoc: Record<string, number> = {};
  const pts: { t: number; v: number; bad: boolean; m: MovEstoque }[] = [];
  movs.forEach((m, i) => {
    if (m.cancelado) return;
    porLoc[chaveSaldo(m)] = m.saldo;
    pts.push({ t: new Date(m.dt_mov + "T12:00:00Z").getTime(), v: Object.values(porLoc).reduce((a, b) => a + b, 0), bad: qb.has(i), m });
  });
  if (!pts.length) return null;
  const ini = [...pts].reverse().find((x) => x.t <= x0);
  const vis = pts.filter((x) => x.t > x0);
  const serie = [...(ini ? [{ ...ini, t: x0 }] : []), ...vis];
  if (!serie.length) return <div className="vazio">Sem movimentos nos últimos 12 meses.</div>;
  const ys = serie.map((x) => x.v), y0 = Math.min(0, ...ys), y1 = Math.max(1, ...ys) * 1.1;
  const X = (t: number) => P.l + ((t - x0) / (x1 - x0)) * (W - P.l - P.r);
  const Y = (v: number) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  let d = "";
  serie.forEach((x, i) => { d += i ? `H${X(x.t).toFixed(1)}V${Y(x.v).toFixed(1)}` : `M${X(Math.max(x.t, x0)).toFixed(1)},${Y(x.v).toFixed(1)}`; });
  d += `H${X(x1)}`;
  const tk = [...new Set([y0, 0, y1 / 2, y1 / 1.1])];
  const meses = [0, 3, 6, 9, 12].map((k) => somaDias(H0, Math.round(-365 + k * 30.4)));
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Saldo ao longo do tempo">
      {tk.map((v) => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} stroke="var(--ww-border)" strokeDasharray={v ? "3 4" : undefined} />
          <text x={P.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="10.5" fill="var(--ww-text-faint)">{q(Math.round(v))}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--ww-brand-2)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" />
      {vis.filter((x) => x.bad).map((x) => (
        <circle key={x.m.id_mov} cx={X(x.t)} cy={Y(x.v)} r="5" fill="var(--ww-crit)">
          <title>{`${ddmmaa(x.m.dt_mov)} · ${x.m.des_origem ?? ""} ${x.m.doc ?? ""} · saldo ${q(x.m.saldo)} não fecha`}</title>
        </circle>
      ))}
      {meses.map((m) => <text key={m} x={X(new Date(m + "T12:00:00Z").getTime())} y={H - 6} fontSize="10.5" textAnchor="middle" fill="var(--ww-text-faint)">{m.slice(5, 7)}/{m.slice(2, 4)}</text>)}
    </svg>
  );
}

// ── Pedidos de compra ────────────────────────────────────────────────────────
function AbaCompras({ p, pcs, abertos }: { p: ItemEstoque; pcs: PcItem[]; abertos: PcItem[] }) {
  if (!pcs.length) return <div className="vazio">Nenhum pedido de compra nos últimos 24 meses.</div>;
  const u = p.unidade.toLowerCase(), qAb = abertos.reduce((a, x) => a + x.qtd - x.qtd_recebida, 0);
  const sit = (x: PcItem): [string, Tom] => {
    if (x.qtd_recebida > x.qtd) return ["recebido a mais", "crit"];
    if (!pcAberto(x)) return [x.etapa === "80" ? "conferido" : "recebido", "ok"];
    if (x.qtd_recebida > 0) return ["parcial", "info"];
    const d = dias(x.emissao) ?? 0;
    return d > 60 ? [`aberto há ${d} d`, "warn"] : ["aberto", "info"];
  };
  return (<>
    {abertos.length > 0 && Math.abs(qAb - p.pendente) > 0.001 && (
      <div className="aviso t-warn" style={{ marginBottom: 12 }}>
        <span>{abertos.length} PC{abertos.length > 1 ? "s" : ""} com saldo a receber ({q(qAb)} {u}), mas o Omie mostra <b>{q(p.pendente)} pendente</b>. Revise os PCs antigos: baixar ou cancelar.</span>
      </div>
    )}
    <div style={{ maxHeight: 480, overflow: "auto" }}>
      <table className="tabela">
        <thead><tr><th>PC</th><th>Inclusão</th><th>Fornecedor</th><th className="opt">Projeto</th><th className="r">Pedido</th><th className="r">Recebido</th><th className="r">Unit.</th><th className="r opt">Total</th><th>Situação</th></tr></thead>
        <tbody>
          {pcs.map((x) => {
            const [t, tm] = sit(x);
            return (
              <tr key={`${x.pedido_id}:${x.numero}:${x.qtd}:${x.valor_unit}`}>
                <td style={{ fontWeight: 600 }}>{x.numero}{x.origem === "painel" && <div className="mini">painel</div>}{x.de_codigo && <div className="mini">código {x.de_codigo}</div>}</td>
                <td className="num">{ddmmaa(x.emissao)}</td>
                <td>{x.fornecedor || "— fornecedor não cadastrado"}</td>
                <td className="opt mini">{x.projeto ?? ""}</td>
                <td className="r num">{q(x.qtd)}</td>
                <td className="r num">{q(x.qtd_recebida)}</td>
                <td className="r num">{brl(x.valor_unit)}</td>
                <td className="r num opt">{brl(x.qtd * x.valor_unit)}</td>
                <td><Pill t={t} tom={tm} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <div className="nota">Últimos 24 meses · pedidos de compra do painel e o histórico do Omie (compras.*). Recebido/conferido = etapa do PC no painel ou NF casada; parcial = quantidade recebida menor que a pedida.</div>
  </>);
}

// ── Fornecedores e preços ────────────────────────────────────────────────────
function AbaForn({ pcs, precos }: { pcs: PcItem[]; precos: ReturnType<typeof precosPorFornecedor> }) {
  if (!precos.length) return <div className="vazio">Sem histórico de compra deste item.</div>;
  const total = precos.reduce((a, x) => a + x.n, 0);
  const mn = Math.min(...precos.map((x) => x.min)), mx = Math.max(...precos.map((x) => x.max));
  const med = precos.reduce((a, x) => a + x.media * x.n, 0) / total;
  const dois = somaDias(hoje(), -730);
  const serie = pcs.filter((x) => x.valor_unit > 0 && (x.emissao ?? "") >= dois).sort((a, b) => ((a.emissao ?? "") > (b.emissao ?? "") ? 1 : -1));
  const ult = pcs.find((x) => x.valor_unit > 0);
  return (
    <div className="grid2">
      <div>
        <h3>Por fornecedor · todo o histórico</h3>
        <table className="tabela">
          <thead><tr><th>Fornecedor</th><th className="r">PCs</th><th className="r">Mín.</th><th className="r">Médio</th><th className="r">Máx.</th><th className="opt">Faixa</th><th>Último</th></tr></thead>
          <tbody>
            {precos.map((x) => (
              <tr key={x.fornecedor}>
                <td style={{ fontWeight: 600 }}>{x.fornecedor}</td><td className="r num">{x.n}</td>
                <td className="r num">{brl(x.min)}</td><td className="r num" style={{ fontWeight: 600 }}>{brl(x.media)}</td><td className="r num">{brl(x.max)}</td>
                <td className="opt" style={{ minWidth: 110 }}>
                  <div className="barra" style={{ position: "relative" }}>
                    <i style={{ position: "absolute", left: `${(x.min / mx) * 100}%`, width: `${Math.max(2, ((x.max - x.min) / mx) * 100)}%`, background: "var(--ww-brand-3)" }} />
                  </div>
                </td>
                <td className="num">{ddmmaa(x.ultima)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h3>Resumo</h3>
        <div className="prev">
          Mínimo <b>{brl(mn)}</b> · médio <b>{brl(med)}</b> · máximo <b>{brl(mx)}</b> · {total} PCs<br />
          {ult && <>Última compra <b>{brl(ult.valor_unit)}</b> em {ddmmaa(ult.emissao)} ({ult.fornecedor || "fornecedor não cadastrado"}) —{" "}
            <span style={{ color: `var(--ww-${ult.valor_unit > med * 1.1 ? "warn" : "ok"}-text)` }}>
              {ult.valor_unit >= med ? `${Math.round((ult.valor_unit / med - 1) * 100)}% acima` : `${Math.round((1 - ult.valor_unit / med) * 100)}% abaixo`} da média
            </span></>}
        </div>
        {serie.length > 1 && (<><h3 style={{ marginTop: 14 }}>Preço unitário por PC · 24 meses</h3><GraficoPreco pcs={serie} med={med} /></>)}
        <div className="nota">Fonte: pedidos de compra (compras.itens.valor_unit). Valores muito baixos costumam ser bonificação ou erro de unidade e puxam a média.</div>
      </div>
    </div>
  );
}

function GraficoPreco({ pcs, med }: { pcs: PcItem[]; med: number }) {
  const W = 560, H = 170, P = { l: 58, r: 10, t: 12, b: 20 };
  const xs = pcs.map((x) => new Date((x.emissao ?? "") + "T12:00:00Z").getTime()), x0 = Math.min(...xs), x1 = Math.max(...xs, x0 + 864e5);
  const y1 = Math.max(...pcs.map((x) => x.valor_unit)) * 1.1;
  const X = (t: number) => P.l + ((t - x0) / (x1 - x0)) * (W - P.l - P.r), Y = (v: number) => P.t + (1 - v / y1) * (H - P.t - P.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Preço por PC">
      <line x1={P.l} x2={W - P.r} y1={Y(med)} y2={Y(med)} stroke="var(--ww-text-faint)" strokeDasharray="4 4" />
      <text x={P.l + 4} y={Y(med) - 4} fontSize="10" fill="var(--ww-text-faint)">média {brl(med)}</text>
      <text x={P.l - 6} y={Y(0) + 3} textAnchor="end" fontSize="10" fill="var(--ww-text-faint)">0</text>
      <text x={P.l - 6} y={Y(y1 / 1.1) + 3} textAnchor="end" fontSize="10" fill="var(--ww-text-faint)">{brl(y1 / 1.1)}</text>
      {pcs.map((x, i) => (
        <circle key={i} cx={X(xs[i])} cy={Y(x.valor_unit)} r="4"
          fill={x.valor_unit < med * 0.6 || x.valor_unit > med * 1.5 ? "var(--ww-warn)" : "var(--ww-brand-3)"}>
          <title>{`PC ${x.numero} · ${ddmmaa(x.emissao)} · ${brl(x.valor_unit)} · ${x.fornecedor ?? ""}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ── Auditoria ────────────────────────────────────────────────────────────────
const ICONES: Record<string, string> = {
  alerta: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  quebra: "M4 12h16M4 7h16M4 17h16M8 3l8 18", soma: "M18 4H6l6 8-6 8h12", preco: "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  pc: "M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6", mais: "M12 5v14M5 12h14",
  semcli: "M4 21v-1a6 6 0 0 1 9-5.2M17 17l4 4M21 17l-4 4M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  dup: "M8 8h13v13H8zM4 16V5a2 2 0 0 1 2-2h11", sino: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0",
  zero: "M5 19L19 5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", parado: "M10 9v6M14 9v6M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", ok: "M20 6L9 17l-5-5",
};

function AbaAuditoria({ pts, dups, setAba, ir, ajustes, aliases, admin, ocupado, pedirAjuste, mesclar, naoE, codigoDe }: {
  pts: ReturnType<typeof auditoria>; dups: Ficha["dups"]; setAba: (a: AbaFicha) => void; ir: (cod: string, a?: string) => void;
  ajustes: AjusteEstoque[]; aliases: Alias[]; admin: boolean; ocupado: boolean; pedirAjuste: () => void;
  mesclar: (outro: ItemEstoque) => void; naoE: (outro: ItemEstoque) => void; codigoDe: (id: number) => string;
}) {
  return (
    <div className="grid2">
      <div>
        <h3>Verificações automáticas</h3>
        {pts.map((x, i) => (
          <div key={i} className="aud">
            <div className={`ic t-${x.tom}`}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={ICONES[x.icone] ?? ""} />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}><div className="tt">{x.titulo}</div><div className="dd">{x.detalhe}</div></div>
            {x.acao && (
              <div className="ac">
                {x.acao.emBreve ? <button className="btn sm" disabled title={EM_BREVE}>{x.acao.rotulo}</button>
                  : x.acao.ajustar ? <button className="btn sm" onClick={pedirAjuste}>{x.acao.rotulo}</button>
                    : <button className="btn sm" onClick={() => x.acao?.aba && setAba(x.acao.aba)}>{x.acao.rotulo}</button>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div>
        <h3>Possíveis duplicidades</h3>
        {dups.length ? dups.map((d, i) => d.item && (
          <div key={i} className="aud">
            <div className="ic t-violet"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d={ICONES.dup} /></svg></div>
            <div style={{ minWidth: 0, cursor: "pointer" }} onClick={() => d.item && ir(d.item.codigo)}>
              <div className="tt">{d.item.codigo} · {d.item.descricao}</div>
              <div className="dd">{d.tipo === "exata" ? "nome igual" : `parecido ${Math.round(d.sim * 100)}%`} · saldo {q(d.item.saldo)} · CMC {brl(d.item.cmc)}</div>
            </div>
            <div className="ac">
              <button className="btn sm" disabled={ocupado} onClick={() => d.item && naoE(d.item)}>Não é</button>
              <button className="btn sm pri" disabled={!admin} title={admin ? undefined : "Só o administrador (Benny) mescla"} onClick={() => d.item && mesclar(d.item)}>Mesclar…</button>
            </div>
          </div>
        )) : <div className="nota">Nenhum outro código com descrição igual ou parecida ainda a decidir.</div>}

        <h3 style={{ marginTop: 16 }}>Histórico de alterações no painel</h3>
        {ajustes.length ? (
          <div style={{ maxHeight: 360, overflow: "auto" }}>
            <table className="tabela">
              <thead><tr><th>Quando / quem</th><th>O quê</th><th className="r">Dif.</th><th>Revisão</th></tr></thead>
              <tbody>
                {ajustes.map((a) => (
                  <tr key={a.id} style={{ opacity: a.status === "revertido" ? 0.5 : 1, textDecoration: a.status === "revertido" ? "line-through" : undefined }}>
                    <td className="num">{new Date(a.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}<div className="mini">{a.created_by_email}</div></td>
                    <td>{a.tipo === "mesclagem" ? "Mesclagem" : "Inventário"} · {nomeLocal(a.codigo_local_estoque)}{a.n_cod_prod !== undefined && codigoDe(a.n_cod_prod) ? <span className="mini"> · {codigoDe(a.n_cod_prod)}</span> : null}
                      <div className="mini">{q(a.saldo_antes)} → {q(a.contagem)} · {a.motivo}{a.obs ? ` · ${a.obs}` : ""}</div></td>
                    <td className="r num" style={{ fontWeight: 600, color: `var(--ww-${a.diferenca < 0 ? "crit" : "ok"}-text)` }}>{a.diferenca > 0 ? "+" : ""}{q(a.diferenca)}<div className="mini">{brl(a.valor)}</div></td>
                    <td>{a.status === "revertido" ? <Pill t="revertido" tom="off" /> : <Pill t={a.revisao} tom={a.revisao === "conferido" ? "ok" : a.revisao === "contestado" ? "crit" : "warn"} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="nota">Nenhum ajuste ou mesclagem feito pelo painel neste item.</div>}
        {aliases.length > 0 && (<>
          <h3 style={{ marginTop: 16 }}>De-para confirmados (Compras)</h3>
          {aliases.slice().sort((a, b) => String(b.confirmado_em ?? "").localeCompare(String(a.confirmado_em ?? ""))).map((a, i) => (
            <div key={i} className="aud">
              <div className="ic t-info"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M4 7h11M11 3l4 4-4 4M20 17H9M13 13l-4 4 4 4" /></svg></div>
              <div style={{ minWidth: 0 }}><div className="tt">{a.fornecedor ?? "Fornecedor"}: {a.codigo ?? "—"} · {a.descricao ?? ""}</div>
                <div className="dd">{a.confirmado_em ? new Date(a.confirmado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""} · {a.confirmado_por ?? "—"}{a.pc ? ` · PC ${a.pc}` : ""}{a.nf ? ` · NF ${a.nf}` : ""}</div></div>
            </div>
          ))}
        </>)}
        <div className="nota">Ajustes e mesclagens ficam só no painel — o saldo mostrado é o do Omie mais esses ajustes.</div>
        <button className="btn sm" style={{ marginTop: 10 }} onClick={() => window.print()}>Imprimir / PDF da auditoria</button>
      </div>
    </div>
  );
}

// ── Como os fornecedores chamam este item (de-para do Compras) ───────────────
// Fonte: orders.compras_aliases (de-para gravado na conferência do recebimento pelo módulo de
// Compras — compras.v_item_aliases), lido pela rota da ficha junto com o resto.
export type Alias = {
  fornecedor: string | null; codigo: string | null; descricao: string | null; ncm: string | null; unidade: string | null;
  fator: number | null; confirmado_por: string | null; confirmado_em: string | null; pc: string | null; nf: string | null; n_cod_prod: number;
  vezes: number | null;
};
const campo = (r: Record<string, unknown>, ...ks: string[]) => { for (const k of ks) if (r[k] != null && r[k] !== "") return r[k]; return null; };
function normAlias(r: Record<string, unknown>, prod: number): Alias {
  const s = (v: unknown) => (v == null ? null : String(v));
  const fator = campo(r, "fator", "fator_conversao");
  return {
    fornecedor: s(campo(r, "fornecedor_nome", "fornecedor", "razao_social")), codigo: s(campo(r, "codigo_fornecedor", "cod_fornecedor", "cprod", "codigo")),
    descricao: s(campo(r, "nome_na_nf", "descricao_fornecedor", "xprod", "descricao")), ncm: s(campo(r, "ncm")), unidade: s(campo(r, "unidade_forn", "unidade_fornecedor", "unidade", "ucom")),
    fator: fator == null ? null : Number(fator), confirmado_por: s(campo(r, "confirmado_por_email", "confirmado_por", "created_by_email")),
    confirmado_em: s(campo(r, "confirmado_em", "created_at")), pc: s(campo(r, "pedido_numero", "pc_numero", "pc", "numero_pc")), nf: s(campo(r, "nf_numero", "nf", "numero_nf")),
    n_cod_prod: Number(campo(r, "ncod_prod", "n_cod_prod") ?? prod), vezes: campo(r, "vezes") == null ? null : Number(campo(r, "vezes")),
  };
}
export type EstadoAliases = { ok: boolean; lista: Alias[] } | null;
function SecaoAliases({ st, codigoDe }: { st: EstadoAliases; codigoDe: (id: number) => string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3>Como os fornecedores chamam este item</h3>
      {!st ? <div className="nota">Carregando…</div> : !st.lista.length ? (
        <div className="nota">Nenhum de-para registrado ainda — ele é gravado na conferência do recebimento em Compras (item da NF → nosso item) e aparece aqui automaticamente.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tabela">
            <thead><tr><th>Fornecedor</th><th>Código / descrição no fornecedor</th><th className="opt">NCM</th><th>Unidade · fator</th><th className="opt">Confirmado</th><th className="opt">Origem</th></tr></thead>
            <tbody>
              {st.lista.map((a, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{a.fornecedor ?? "—"}</td>
                  <td>{a.codigo ?? "—"}<div className="mini">{a.descricao ?? ""}{codigoDe(a.n_cod_prod) ? ` · via código mesclado ${codigoDe(a.n_cod_prod)}` : ""}</div></td>
                  <td className="opt">{a.ncm ?? "—"}</td>
                  <td>{a.unidade ?? "—"}{a.fator != null && a.fator !== 1 ? ` · ×${q(a.fator)}` : ""}</td>
                  <td className="opt">{a.confirmado_por ?? "—"}<div className="mini">{a.confirmado_em ? new Date(a.confirmado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : ""}</div></td>
                  <td className="opt mini">{[a.pc && `PC ${a.pc}`, a.nf && `NF ${a.nf}`, a.vezes && a.vezes > 1 ? `${a.vezes}×` : null].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Recodificar (admin): novo código da família escolhida; o anterior vira apelido ──
function ModalRecodificar({ p, fechar, ok }: { p: ItemEstoque; fechar: () => void; ok: (codigo: string) => void }) {
  const [fams, setFams] = useState<{ id: number; nome: string; prefixo: string; proximo: number; ativo: boolean; sistema: boolean }[]>([]);
  const [fam, setFam] = useState(p.familia_id != null ? String(p.familia_id) : "");
  const [erro, setErro] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  useEffect(() => { fetch("/api/estoque/cadastro").then((r) => r.json()).then((j) => setFams((j.familias ?? []).filter((x: { ativo: boolean }) => x.ativo))).catch(() => {}); }, []);
  const f = fams.find((x) => String(x.id) === fam);
  return (
    <div className="est-ov mid" onClick={fechar} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh"><div><div style={{ fontSize: 16, fontWeight: 700 }}>Recodificar {p.codigo_novo}</div>
          <div className="mini" style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>{p.descricao}</div></div><button className="x" onClick={fechar}>×</button></div>
        <div className="mb">
          <label className="f">Família do novo código
            <select className="inp" value={fam} onChange={(e) => setFam(e.target.value)}>
              <option value="">Escolha…</option>{fams.map((x) => <option key={x.id} value={x.id}>{x.nome} ({x.prefixo})</option>)}
            </select></label>
          {f && <div className="prev">Novo código: <b className="mono">{f.prefixo}{String(f.proximo).padStart(4, "0")}</b> · {p.codigo_novo} continua achando o item (apelido). O código do Omie não muda.</div>}
          {erro && <div className="aviso t-crit">{erro}</div>}
        </div>
        <div className="mf"><button className="btn" onClick={fechar}>Cancelar</button>
          <button className="btn pri" disabled={!fam || indo} onClick={async () => {
            setIndo(true); setErro(null);
            try { const r = await postar<{ resultado: { codigo: string } }>("/api/estoque/codigos", { acao: "recodificar", n_cod_prod: p.n_cod_prod, familia_id: Number(fam) }); ok(r.resultado.codigo); }
            catch (e) { setErro((e as Error).message); } finally { setIndo(false); }
          }}>Recodificar</button></div>
      </div>
    </div>
  );
}
