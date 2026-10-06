"use client";

// Compras × lista (06/10/26) — a lista de materiais do projeto ligada aos
// pedidos de compra, ao budget e ao fluxo de caixa.
//
// Uma pergunta por bloco:
//   1. Quanto vou gastar? — estimado da lista × budget × comprometido (PCs) × pago,
//      e o efeito disso na margem do fechamento.
//   2. O que já foi comprado? — cada linha da lista com a RC e o(s) PC(s) dela
//      (fornecedor, valor, aprovação, recebido, NF). O vínculo é automático:
//      RC gerada daqui leva a linha junto; PC feito direto no projeto é casado
//      pelo código ou pela descrição com as mesmas medidas. O que ficou em
//      dúvida aparece para confirmar; o que não está na lista, em "fora da lista".
//   3. Quando sai o dinheiro? — mês a mês: planejado (linhas ainda sem PC, pela
//      data necessária) × comprometido (parcelas dos PCs) × pago.

import { useCallback, useEffect, useMemo, useState } from "react";

type PcLinha = { pc: string; pedido_id: number; origem: string; fornecedor: string | null; etapa: string | null; aprov: string | null;
  previsao: string | null; nf: string | null; qtd?: number | null; valor_unit?: number | null; valor?: number | null;
  qtd_recebida?: number | null; via: string };
type Linha = { id: string; equipamento: string | null; item: string; modelo: string | null; qtd: number | null; un: string | null;
  codigo: string | null; custo: number | null; fornecedor: string | null; data_necessaria: string | null; estimado: number;
  rc: string | null; vinculo_via: string | null; vinculo_score: number | null; pcs: PcLinha[]; valor_pc: number | null };
type Fora = { pc_item_id: number; pc: string; fornecedor: string | null; descricao: string; codigo: string | null; qtd: number; valor: number; previsao: string | null };
type Totais = { estimado: number; comprometido: number; pago: number; budget_lista: number | null; budget_plano: number | null;
  venda: number | null; margem_plano: number | null };
type Mes = { mes: string | null; planejado: number; comprometido: number; pago: number };
type Dados = { itens: Linha[]; fora_da_lista: Fora[]; totais: Totais; fluxo: Mes[] };
type Casamento = { lista_id: string; item: string; pc: string; pc_item_id: number; desc_pc: string; via: string; score: number; medidas_ok: boolean; auto: boolean };

const brl = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const dia = (s: string | null | undefined) => {
  const m = s ? String(s).match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : "—";
};
const mesRot = (s: string | null) => {
  if (!s) return "sem data";
  const [a, m] = s.split("-");
  return `${["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(m) - 1]}/${a.slice(2)}`;
};
const ETAPA: Record<string, string> = { "10": "Pedido", "15": "Pedido", "20": "Faturado", "40": "Faturado", "60": "Recebido", "80": "Conferido" };

function situacao(p: PcLinha) {
  if (p.etapa === "60" || p.etapa === "80" || (p.qtd_recebida ?? 0) > 0) return { t: "Recebido", c: "pill-ok" };
  if (p.nf) return { t: "Faturado", c: "pill-info" };
  if (p.aprov === "aprovado") return { t: "Aprovado", c: "pill-info" };
  if (p.aprov === "nao_aprovado") return { t: "Não aprovado", c: "pill-err" };
  return { t: ETAPA[p.etapa ?? ""] ?? "Pedido", c: "pill-warn" };
}

export default function ComprasDaLista({ empresa, codigoProjeto }: { empresa: string; codigoProjeto: number }) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [sugestoes, setSugestoes] = useState<Casamento[] | null>(null);
  const [filtro, setFiltro] = useState<"todas" | "sem_pc" | "com_pc">("todas");
  const [budgetEdit, setBudgetEdit] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch(`/api/rc-projetos/compras?empresa=${empresa}&codigo=${codigoProjeto}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setD(j as Dados);
    } catch (e) { setErro((e as Error).message); }
  }, [empresa, codigoProjeto]);
  useEffect(() => { void carregar(); }, [carregar]);

  const post = useCallback(async (corpo: Record<string, unknown>) => {
    const r = await fetch("/api/rc-projetos/compras", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa, codigo: codigoProjeto, ...corpo }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return j;
  }, [empresa, codigoProjeto]);

  const vincularAuto = async () => {
    setOcupado("auto"); setErro(null); setAviso(null);
    try {
      const j = await post({ acao: "autolink", aplicar: true }) as { aplicados: number; casamentos: Casamento[] };
      const duv = (j.casamentos ?? []).filter((c) => !c.auto);
      setSugestoes(duv);
      setAviso(`${j.aplicados} linha(s) ligadas aos pedidos de compra do projeto` + (duv.length ? ` · ${duv.length} parecida(s) para você confirmar abaixo` : ""));
      await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  };
  const verSugestoes = async () => {
    setOcupado("sug"); setErro(null);
    try {
      const j = await post({ acao: "autolink", aplicar: false }) as { casamentos: Casamento[] };
      setSugestoes(j.casamentos ?? []);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  };
  const confirmar = async (c: Casamento) => {
    setOcupado(`v${c.lista_id}`);
    try { await post({ acao: "vincular", lista_id: c.lista_id, pc_item_id: c.pc_item_id });
      setSugestoes((s) => (s ?? []).filter((x) => x.lista_id !== c.lista_id)); await carregar(); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  };
  const desvincular = async (id: string) => {
    setOcupado(`d${id}`);
    try { await post({ acao: "desvincular", lista_id: id }); await carregar(); }
    catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  };
  const gerarRc = async () => {
    const ids = [...marcadas];
    if (!ids.length) return;
    if (!window.confirm(`Gerar uma requisição de compra (RC) com ${ids.length} linha(s) da lista?\n\nA RC entra em Compras com o número sequencial e cada linha fica ligada à lista — os pedidos de compra feitos a partir dela aparecem aqui sozinhos.`)) return;
    setOcupado("rc"); setErro(null); setAviso(null);
    try {
      const j = await post({ acao: "gerar_rc", ids }) as { rc: string; linhas: number };
      setAviso(`RC ${j.rc} criada com ${j.linhas} linha(s). Abra em Compras para gerar o pedido de compra.`);
      setMarcadas(new Set());
      await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  };
  const salvarBudget = async () => {
    const v = Number(String(budgetEdit ?? "").replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(v) || v < 0) { setErro("Budget inválido"); return; }
    setOcupado("budget");
    try {
      const r = await fetch("/api/rc-projetos/budget", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, valor_budget: v }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setBudgetEdit(null); await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  };

  const linhas = useMemo(() => (d?.itens ?? []).filter((l) =>
    filtro === "todas" ? true : filtro === "com_pc" ? l.pcs.length > 0 : l.pcs.length === 0), [d, filtro]);
  const t = d?.totais;
  const budget = t ? (t.budget_lista ?? t.budget_plano) : null;
  const restante = useMemo(() => (d?.itens ?? []).filter((l) => !l.pcs.length && !l.rc).reduce((a, l) => a + Number(l.estimado || 0), 0), [d]);
  const projetado = (t?.comprometido ?? 0) + restante;
  const folga = budget != null ? budget - projetado : null;
  const margemProj = t?.margem_plano != null && folga != null ? Number(t.margem_plano) + folga : null;
  const semVinculo = (d?.itens ?? []).filter((l) => !l.pcs.length).length;
  const podeRc = (l: Linha) => !l.rc && !l.pcs.length;
  const acumula = useMemo(() => {
    let p = 0, c = 0, g = 0;
    return (d?.fluxo ?? []).filter((m) => Number(m.planejado) || Number(m.comprometido) || Number(m.pago)).map((m) => { p += Number(m.planejado); c += Number(m.comprometido); g += Number(m.pago); return { ...m, ap: p, ac: c, ag: g }; });
  }, [d]);

  if (erro && !d) return <div className="cdl-box cdl-err">{erro} <button className="cdl-btn" onClick={() => void carregar()}>Tentar de novo</button></div>;
  if (!d) return <div className="cdl-box text-ww-textMuted">Carregando compras do projeto…</div>;

  return (
    <div className="cdl space-y-3">
      <style>{CSS}</style>

      {/* 1. Quanto vou gastar */}
      <div className="cdl-kpis">
        <div className="cdl-kpi"><span>Estimado da lista</span><b>{brl(t?.estimado)}</b><small>{d.itens.length} linha(s)</small></div>
        <div className="cdl-kpi">
          <span>Budget de materiais</span>
          {budgetEdit == null
            ? <b>{brl(budget)} <button className="cdl-lk" onClick={() => setBudgetEdit(String(budget ?? ""))}>editar</button></b>
            : <span className="cdl-row"><input className="cdl-in" autoFocus value={budgetEdit} onChange={(e) => setBudgetEdit(e.target.value)} />
                <button className="cdl-btn pri" disabled={ocupado === "budget"} onClick={() => void salvarBudget()}>ok</button>
                <button className="cdl-btn" onClick={() => setBudgetEdit(null)}>×</button></span>}
          <small>{t?.budget_lista != null ? "definido no painel" : t?.budget_plano != null ? "do CP/MC do CRM" : "sem budget"}</small>
        </div>
        <div className="cdl-kpi"><span>Comprometido (PCs)</span><b>{brl(t?.comprometido)}</b><small>pedidos de compra do projeto</small></div>
        <div className="cdl-kpi"><span>Pago</span><b>{brl(t?.pago)}</b><small>saídas realizadas do projeto</small></div>
        <div className={`cdl-kpi ${folga != null && folga < 0 ? "neg" : ""}`}>
          <span>Projetado × budget</span><b>{brl(projetado)}</b>
          <small>{folga == null ? "sem budget para comparar" : folga >= 0 ? `sobra ${brl(folga)}` : `estoura ${brl(-folga)}`}</small>
        </div>
        <div className={`cdl-kpi ${margemProj != null && t?.margem_plano != null && margemProj < Number(t.margem_plano) ? "neg" : ""}`}>
          <span>Margem</span><b>{brl(margemProj)}</b>
          <small>{t?.margem_plano != null ? `no fechamento: ${brl(t.margem_plano)}` : "sem fechamento do CRM"}</small>
        </div>
      </div>
      <p className="cdl-nota">Projetado = comprometido nos PCs + estimado das linhas que ainda não têm RC/PC. Margem = margem do fechamento ± a diferença entre o budget e o projetado.</p>

      {(erro || aviso) && <div className={`cdl-box ${erro ? "cdl-err" : "cdl-ok"}`}>{erro ?? aviso}</div>}

      {/* 2. O que já foi comprado */}
      <div className="cdl-bar">
        <b>Linhas da lista × pedidos de compra</b>
        <span className="cdl-chips">
          {(["todas", "sem_pc", "com_pc"] as const).map((k) => (
            <button key={k} className={`cdl-chip ${filtro === k ? "on" : ""}`} onClick={() => setFiltro(k)}>
              {k === "todas" ? `Todas ${d.itens.length}` : k === "sem_pc" ? `Sem PC ${semVinculo}` : `Com PC ${d.itens.length - semVinculo}`}
            </button>))}
        </span>
        <span style={{ flex: 1 }} />
        <button className="cdl-btn" disabled={!!ocupado} onClick={() => void verSugestoes()}>{ocupado === "sug" ? "…" : "Ver sugestões de vínculo"}</button>
        <button className="cdl-btn" disabled={!!ocupado} onClick={() => void vincularAuto()}>{ocupado === "auto" ? "Vinculando…" : "↻ Vincular automaticamente"}</button>
        <button className="cdl-btn pri" disabled={!!ocupado || !marcadas.size} onClick={() => void gerarRc()}
          title="Cria a requisição de compra (RC) em Compras com as linhas marcadas">
          {ocupado === "rc" ? "Gerando…" : `Gerar RC (${marcadas.size})`}</button>
      </div>

      {sugestoes && (
        <div className="cdl-box">
          <div className="cdl-row" style={{ justifyContent: "space-between" }}>
            <b>Sugestões para confirmar ({sugestoes.length})</b>
            <button className="cdl-lk" onClick={() => setSugestoes(null)}>fechar</button>
          </div>
          {!sugestoes.length && <p className="text-ww-textMuted">Nenhuma sugestão pendente.</p>}
          {sugestoes.length > 0 && (
            <table className="cdl-t"><thead><tr><th>Linha da lista</th><th>Item do PC</th><th>PC</th><th>Confiança</th><th /></tr></thead>
              <tbody>{sugestoes.map((c) => (
                <tr key={c.lista_id}>
                  <td>{c.item}</td><td>{c.desc_pc}</td><td>{c.pc}</td>
                  <td>{c.via === "codigo" ? "código igual" : `${Math.round(Number(c.score) * 100)}%`}{!c.medidas_ok && c.via !== "codigo" ? <span className="cdl-warn"> · medidas diferentes</span> : null}</td>
                  <td><button className="cdl-btn" disabled={ocupado === `v${c.lista_id}`} onClick={() => void confirmar(c)}>Confirmar</button></td>
                </tr>))}</tbody></table>)}
        </div>
      )}

      <div className="cdl-scroll">
        <table className="cdl-t">
          <thead><tr>
            <th style={{ width: 28 }}>
              <input type="checkbox" checked={linhas.filter(podeRc).length > 0 && linhas.filter(podeRc).every((l) => marcadas.has(l.id))}
                onChange={(e) => setMarcadas(e.target.checked ? new Set(linhas.filter(podeRc).map((l) => l.id)) : new Set())}
                title="Marcar todas as linhas sem RC/PC" />
            </th>
            <th>Equip.</th><th>Item</th><th className="r">Qtd</th><th>Necessário</th><th className="r">Estimado</th>
            <th>RC</th><th>Pedido de compra</th><th className="r">Comprado</th><th>Situação</th><th>Vínculo</th>
          </tr></thead>
          <tbody>
            {linhas.map((l) => {
              const dif = l.valor_pc != null && l.estimado ? Number(l.valor_pc) - Number(l.estimado) : null;
              return (
                <tr key={l.id}>
                  <td><input type="checkbox" disabled={!podeRc(l)} checked={marcadas.has(l.id)}
                    onChange={() => setMarcadas((m) => { const n = new Set(m); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} /></td>
                  <td className="mut">{l.equipamento}</td>
                  <td>{l.item}{l.modelo ? <span className="mut"> · {l.modelo}</span> : null}{l.codigo ? <span className="cdl-cod">{l.codigo}</span> : null}</td>
                  <td className="r">{l.qtd ?? "—"} {l.un ?? ""}</td>
                  <td>{dia(l.data_necessaria)}</td>
                  <td className="r">{l.estimado ? brl(l.estimado) : <span className="mut">sem custo</span>}</td>
                  <td>{l.rc ? <a className="cdl-lk" href={`/erp/compras?abrir=${l.rc}&tipo=RC&emp=${empresa}`}>RC {l.rc}</a> : <span className="mut">—</span>}</td>
                  <td>{l.pcs.length ? l.pcs.map((p) => (
                    <div key={`${p.pc}-${p.pedido_id}`}><a className="cdl-lk" href={`/erp/compras?abrir=${p.pc}&tipo=PC&emp=${empresa}`}>PC {p.pc}</a>
                      <span className="mut"> · {p.fornecedor ?? "—"}</span></div>)) : <span className="mut">sem PC</span>}</td>
                  <td className="r">{l.valor_pc != null ? <>{brl(l.valor_pc)}{dif != null && Math.abs(dif) >= 0.01
                    ? <small className={dif > 0 ? "cdl-neg" : "cdl-pos"}> {dif > 0 ? "▲" : "▼"} {brl(Math.abs(dif))}</small> : null}</> : <span className="mut">—</span>}</td>
                  <td>{l.pcs.map((p) => { const s = situacao(p); return <span key={p.pc} className={`cdl-pill ${s.c}`}>{s.t}{p.nf ? ` · NF ${p.nf}` : ""}</span>; })}</td>
                  <td className="mut">{l.vinculo_via === "rc" ? "pela RC" : l.vinculo_via === "codigo" ? "código" : l.vinculo_via === "descricao" ? `descrição ${Math.round(Number(l.vinculo_score ?? 0) * 100)}%` : l.vinculo_via === "manual" ? "manual" : l.pcs.length ? "nº do PC" : ""}
                    {(l.vinculo_via === "codigo" || l.vinculo_via === "descricao" || l.vinculo_via === "manual") &&
                      <button className="cdl-lk" style={{ marginLeft: 6 }} disabled={ocupado === `d${l.id}`} onClick={() => void desvincular(l.id)}>desfazer</button>}</td>
                </tr>);
            })}
            {!linhas.length && <tr><td colSpan={11} className="mut" style={{ padding: 14 }}>Nenhuma linha {filtro === "sem_pc" ? "sem PC" : filtro === "com_pc" ? "com PC" : "na lista"}. Monte a lista na aba “Lista de materiais”.</td></tr>}
          </tbody>
        </table>
      </div>

      {d.fora_da_lista.length > 0 && (
        <div className="cdl-box">
          <b>Comprado fora da lista ({d.fora_da_lista.length}) · {brl(d.fora_da_lista.reduce((a, f) => a + Number(f.valor || 0), 0))}</b>
          <p className="cdl-nota">Itens de pedidos de compra deste projeto que nenhuma linha da lista cobre — escopo extra ou item com outro nome. Use “Ver sugestões de vínculo” para ligar.</p>
          <div className="cdl-scroll"><table className="cdl-t"><thead><tr><th>PC</th><th>Fornecedor</th><th>Item</th><th className="r">Qtd</th><th className="r">Valor</th><th>Previsão</th></tr></thead>
            <tbody>{d.fora_da_lista.map((f) => (
              <tr key={f.pc_item_id}><td><a className="cdl-lk" href={`/erp/compras?abrir=${f.pc}&tipo=PC&emp=${empresa}`}>PC {f.pc}</a></td>
                <td className="mut">{f.fornecedor}</td><td>{f.descricao}{f.codigo ? <span className="cdl-cod">{f.codigo}</span> : null}</td>
                <td className="r">{f.qtd}</td><td className="r">{brl(f.valor)}</td><td>{dia(f.previsao)}</td></tr>))}</tbody></table></div>
        </div>
      )}

      {/* 3. Quando sai o dinheiro */}
      <div className="cdl-box">
        <b>Fluxo de compras do projeto</b>
        <p className="cdl-nota">Planejado = linhas ainda sem RC/PC, pela data necessária · Comprometido = parcelas dos pedidos de compra · Pago = saídas realizadas do projeto.</p>
        <div className="cdl-scroll"><table className="cdl-t"><thead><tr><th>Mês</th><th className="r">Planejado</th><th className="r">Comprometido</th><th className="r">Pago</th>
          <th className="r">Acum. planejado + comprometido</th><th className="r">Acum. pago</th><th className="r">vs budget</th></tr></thead>
          <tbody>{acumula.map((m) => {
            const acum = m.ap + m.ac;
            return (
              <tr key={m.mes ?? "sem"}><td>{mesRot(m.mes)}</td><td className="r">{brl(m.planejado)}</td><td className="r">{brl(m.comprometido)}</td>
                <td className="r">{brl(m.pago)}</td><td className="r">{brl(acum)}</td><td className="r">{brl(m.ag)}</td>
                <td className="r">{budget != null ? <span className={acum > budget ? "cdl-neg" : "mut"}>{Math.round((acum / (budget || 1)) * 100)}%</span> : "—"}</td></tr>);
          })}
            {!acumula.length && <tr><td colSpan={7} className="mut" style={{ padding: 12 }}>Sem valores ainda — preencha custo e data necessária na lista.</td></tr>}</tbody></table></div>
      </div>
    </div>
  );
}

const CSS = `
.cdl{font-size:12.5px;color:var(--ww-text)}
.cdl .mut{color:var(--ww-text-muted)}
.cdl-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}
.cdl-kpi{border:1px solid var(--ww-border);border-radius:10px;padding:9px 11px;background:var(--ww-panel);display:flex;flex-direction:column;gap:2px}
.cdl-kpi span{font-size:11px;color:var(--ww-text-muted)}
.cdl-kpi b{font-size:16px;font-weight:650}
.cdl-kpi small{font-size:11px;color:var(--ww-text-muted)}
.cdl-kpi.neg b{color:#e11d48}
.cdl-nota{font-size:11.5px;color:var(--ww-text-muted);margin:2px 0 6px}
.cdl-box{border:1px solid var(--ww-border);border-radius:10px;padding:10px 12px;background:var(--ww-panel)}
.cdl-err{border-color:#e11d48;color:#e11d48}
.cdl-ok{border-color:#10b981}
.cdl-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cdl-row{display:flex;align-items:center;gap:6px}
.cdl-chips{display:flex;gap:4px}
.cdl-chip{border:1px solid var(--ww-border);border-radius:999px;padding:3px 10px;font-size:11.5px;background:transparent;color:var(--ww-text-muted);cursor:pointer}
.cdl-chip.on{background:var(--ww-accent);border-color:var(--ww-accent);color:#fff}
.cdl-btn{border:1px solid var(--ww-border-strong,var(--ww-border));border-radius:8px;padding:5px 11px;background:var(--ww-panel);color:var(--ww-text);font-size:12px;cursor:pointer;white-space:nowrap}
.cdl-btn.pri{background:var(--ww-accent);border-color:var(--ww-accent);color:#fff}
.cdl-btn:disabled{opacity:.5;cursor:default}
.cdl-lk{background:none;border:0;padding:0;color:var(--ww-accent);cursor:pointer;font-size:inherit;text-decoration:underline;text-underline-offset:2px}
.cdl-in{width:120px;border:1px solid var(--ww-border);border-radius:6px;padding:3px 6px;background:transparent;color:inherit}
.cdl-scroll{overflow-x:auto;border:1px solid var(--ww-border);border-radius:10px}
.cdl-box .cdl-scroll{margin-top:6px}
.cdl-t{width:100%;border-collapse:collapse}
.cdl-t th{font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--ww-text-muted);text-align:left;padding:7px 8px;border-bottom:1px solid var(--ww-border);white-space:nowrap}
.cdl-t td{padding:6px 8px;border-bottom:1px solid var(--ww-border);vertical-align:top}
.cdl-t .r{text-align:right;white-space:nowrap}
.cdl-cod{margin-left:6px;font-size:10.5px;border:1px solid var(--ww-border);border-radius:5px;padding:0 4px;color:var(--ww-text-muted)}
.cdl-pill{display:inline-block;margin:0 4px 2px 0;padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:600}
.pill-ok{background:#047857;color:#fff}.pill-info{background:#0e7490;color:#fff}.pill-warn{background:#b45309;color:#fff}.pill-err{background:#be123c;color:#fff}
.cdl-neg{color:#e11d48}.cdl-pos{color:#059669}.cdl-warn{color:#b45309}
`;
