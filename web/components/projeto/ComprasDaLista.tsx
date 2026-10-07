"use client";

// Compras × lista (06/10/26) — a lista de materiais do projeto ligada aos
// pedidos de compra, ao budget e ao fluxo de caixa.
//
// 07/10/26: a aba "Compras × lista" deixou de existir — o Benny achava confuso ter
// duas telas para a mesma lista. Tudo passou para a "Lista de materiais"
// (MateriaisGrade): os KPIs no topo, as colunas do PC na própria linha, as
// sugestões de vínculo e o "Gerar RC" na barra da lista. Este arquivo ficou com
// as peças que a lista usa:
//   KpisCompras      — quanto vou gastar (estimado × budget × comprometido × pago)
//   SugestoesVinculo — linhas parecidas com itens de PC, para confirmar
//   ForaDaLista      — comprado nos PCs do projeto sem linha na lista
//   FluxoCompras     — mês a mês: planejado × comprometido × pago
//   situacaoPc       — a pílula de situação, com os nomes e cores do Compras

import { useMemo, useState } from "react";
import { estadoPc } from "@/lib/situacao-pc";

export type PcLinha = { pc: string; pedido_id: number; origem: string; fornecedor: string | null; etapa: string | null; aprov: string | null;
  previsao: string | null; nf: string | null; qtd?: number | null; valor_unit?: number | null; valor?: number | null;
  qtd_recebida?: number | null; via: string; dt_rec?: string | null; casado_por?: string | null;
  dt_fat?: string | null; enviado_em?: string | null; aprov_por?: string | null; aprov_em?: string | null; cancelado?: boolean | null };
export type LinhaCompras = { id: string; equipamento: string | null; item: string; modelo: string | null; qtd: number | null; un: string | null;
  codigo: string | null; custo: number | null; fornecedor: string | null; data_necessaria: string | null; estimado: number;
  rc: string | null; vinculo_via: string | null; vinculo_score: number | null; pcs: PcLinha[]; valor_pc: number | null };
type Fora = { pc_item_id: number; pc: string; fornecedor: string | null; descricao: string; codigo: string | null; qtd: number; valor: number; previsao: string | null };
type Totais = { estimado: number; comprometido: number; pago: number; budget_lista: number | null; budget_plano: number | null;
  venda: number | null; margem_plano: number | null; pcs_aprovado?: number; pcs_pendente?: number; pcs_outros?: number };
type Mes = { mes: string | null; planejado: number; comprometido: number; pago: number };
export type DadosCompras = { itens: LinhaCompras[]; fora_da_lista: Fora[]; totais: Totais; fluxo: Mes[] };
export type CasamentoPc = { lista_id: string; item: string; pc: string; pc_item_id: number; desc_pc: string; via: string; score: number; medidas_ok: boolean; auto: boolean };

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

/** Situação do PC — paleta e regra únicas do painel (lib/situacao-pc). */
export function situacaoPc(p: PcLinha | Pick<PcLinha, "etapa" | "aprov" | "nf" | "qtd_recebida">): { t: string; cor: string } {
  const e = estadoPc(p as Parameters<typeof estadoPc>[0]);
  return { t: e.rot, cor: e.cor };
}

/** 1. Resumo da lista (07/10/26, Benny): um bloco só, lido de relance —
 *  X = budget de materiais (da RC) · Y = lista prevista (PCs + estimado das linhas sem PC)
 *  · pedidos de compra aprovados × aguardando · dentro/estoura · uma barra.
 *  Mesmos números do cartão de Projetos e da regra de aprovação (lib/lista-pc-completar). */
export function KpisCompras({ d, restante, empresa, codigoProjeto, onRecarregar }: {
  d: DadosCompras; restante: number; empresa: string; codigoProjeto: number; onRecarregar: () => void;
}) {
  const [budgetEdit, setBudgetEdit] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const t = d.totais;
  const budget = t ? (t.budget_lista ?? t.budget_plano) : null;
  const comp = Number(t?.comprometido ?? 0);
  const aprov = t?.pcs_aprovado != null ? Number(t.pcs_aprovado) : comp;
  const pend = t?.pcs_pendente != null ? Number(t.pcs_pendente) : 0;
  const outros = Number(t?.pcs_outros ?? 0);
  const lista = comp + restante;   // lista prevista: PCs + estimado das linhas ainda sem PC
  const folga = budget != null ? budget - lista : null;
  const pctB = (v: number) => (budget ? `${Math.round((v / budget) * 100)}%` : "");
  const gravar = async (valor: number | null) => {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/rc-projetos/budget", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, valor_budget_materiais: valor }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setBudgetEdit(null); onRecarregar();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  };
  const salvarBudget = () => {
    const v = Number(String(budgetEdit ?? "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    if (!Number.isFinite(v) || v < 0) { setErro("Budget inválido"); return; }
    void gravar(v);
  };
  const max = Math.max(budget ?? 0, lista) || 1;
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className="cdl cdl-res">
      <div className="cdl-res-nums">
        <div>
          <span>Budget de materiais</span>
          {budgetEdit == null
            ? <b>{brl(budget)} <button className="cdl-lk" onClick={() => setBudgetEdit(budget != null ? String(budget).replace(".", ",") : "")}>editar</button></b>
            : <span className="cdl-row"><input className="cdl-in" autoFocus value={budgetEdit} onChange={(e) => setBudgetEdit(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") salvarBudget(); if (e.key === "Escape") setBudgetEdit(null); }} />
                <button className="cdl-btn pri" disabled={ocupado} onClick={salvarBudget}>ok</button>
                <button className="cdl-btn" onClick={() => setBudgetEdit(null)}>×</button></span>}
          <small>{t?.budget_lista != null
            ? <>definido no painel{t?.budget_plano != null && <> · <button className="cdl-lk" disabled={ocupado} onClick={() => void gravar(null)} title={`Volta ao total de materiais da RC (${brl(t.budget_plano)})`}>usar o da RC</button></>}</>
            : t?.budget_plano != null ? "total de materiais da RC" : "sem budget — defina em editar"}</small>
        </div>
        <div>
          <span>Lista prevista</span>
          <b>{brl(lista)}</b>
          <small>{budget ? `${pctB(lista)} do budget` : "PCs + estimado das linhas sem PC"}</small>
        </div>
        <div>
          <span>Pedidos de compra</span>
          <b>{brl(aprov + pend)}</b>
          <small><i className="cdl-dot ap" /> aprovados {brl(aprov)}{budget ? ` (${pctB(aprov)})` : ""} · <i className="cdl-dot pe" /> aguardando {brl(pend)}{budget ? ` (${pctB(pend)})` : ""}
            {t?.pago ? <> · pago {brl(t.pago)}</> : null}</small>
        </div>
      </div>
      {budget != null && budget > 0 && (
        <div className="cdl-res-barra" title={`Aprovados ${brl(aprov)} · Aguardando ${brl(pend)} · Ainda a comprar ${brl(restante)} · Budget ${brl(budget)}`}>
          <div className="cdl-res-trilho">
            <div className="ap" style={{ width: w(aprov) }} />
            <div className="pe" style={{ width: w(pend) }} />
            <div className="rs" style={{ width: w(restante) }} />
            <div className="bud" style={{ left: w(budget) }} />
          </div>
        </div>
      )}
      <div className={`cdl-res-st ${folga != null && folga < 0 ? "neg" : ""}`}>
        {folga == null ? "Sem budget de materiais para comparar."
          : folga >= 0 ? <>Dentro do budget · sobra <b>{brl(folga)}</b></>
          : <>Estoura o budget em <b>{brl(-folga)}</b></>}
        <span className="mut"> · barra: <i className="cdl-dot ap" /> aprovados <i className="cdl-dot pe" /> aguardando <i className="cdl-dot rs" /> ainda a comprar <i className="cdl-dot bud" /> budget</span>
        {outros > 0 && <span className="mut"> · inclui {brl(outros)} de PC reprovado/cancelado</span>}
      </div>
      {erro && <div className="cdl-box cdl-err">{erro}</div>}
    </div>
  );
}

export function SugestoesVinculo({ sugestoes, ocupado, onConfirmar, onFechar }: {
  sugestoes: CasamentoPc[]; ocupado: string | null; onConfirmar: (c: CasamentoPc) => void; onFechar: () => void;
}) {
  return (
    <div className="cdl cdl-box">
      <div className="cdl-row" style={{ justifyContent: "space-between" }}>
        <b>Sugestões de vínculo lista ↔ PC para confirmar ({sugestoes.length})</b>
        <button className="cdl-lk" onClick={onFechar}>fechar</button>
      </div>
      {!sugestoes.length && <p className="mut">Nenhuma sugestão pendente.</p>}
      {sugestoes.length > 0 && (
        <div className="cdl-scroll"><table className="cdl-t"><thead><tr><th>Linha da lista</th><th>Item do PC</th><th>PC</th><th>Confiança</th><th /></tr></thead>
          <tbody>{sugestoes.map((c) => (
            <tr key={c.lista_id}>
              <td>{c.item}</td><td>{c.desc_pc}</td><td>{c.pc}</td>
              <td>{c.via === "codigo" ? "código igual" : `${Math.round(Number(c.score) * 100)}%`}{!c.medidas_ok && c.via !== "codigo" ? <span className="cdl-warn"> · medidas diferentes</span> : null}</td>
              <td><button className="cdl-btn" disabled={ocupado === `v${c.lista_id}`} onClick={() => onConfirmar(c)}>Confirmar</button></td>
            </tr>))}</tbody></table></div>)}
    </div>
  );
}

export function ForaDaLista({ fora, empresa }: { fora: Fora[]; empresa: string }) {
  if (!fora.length) return null;
  return (
    <details className="cdl cdl-box">
      <summary style={{ cursor: "pointer" }}><b>Comprado fora da lista ({fora.length}) · {brl(fora.reduce((a, f) => a + Number(f.valor || 0), 0))}</b></summary>
      <p className="cdl-nota">Itens de pedidos de compra deste projeto que nenhuma linha da lista cobre — escopo extra ou item com outro nome. Use “Ver sugestões de vínculo” para ligar.</p>
      <div className="cdl-scroll"><table className="cdl-t"><thead><tr><th>PC</th><th>Fornecedor</th><th>Item</th><th className="r">Qtd</th><th className="r">Valor</th><th>Previsão</th></tr></thead>
        <tbody>{fora.map((f) => (
          <tr key={f.pc_item_id}><td><a className="cdl-chip-pc" target="_blank" rel="noreferrer" href={`/erp/compras?abrir=${f.pc}&tipo=PC&emp=${empresa}`}>PC {f.pc}</a></td>
            <td className="mut">{f.fornecedor}</td><td>{f.descricao}{f.codigo ? <span className="cdl-cod">{f.codigo}</span> : null}</td>
            <td className="r">{f.qtd}</td><td className="r">{brl(f.valor)}</td><td>{dia(f.previsao)}</td></tr>))}</tbody></table></div>
    </details>
  );
}

export function FluxoCompras({ d }: { d: DadosCompras }) {
  const t = d.totais;
  const budget = t ? (t.budget_lista ?? t.budget_plano) : null;
  const acumula = useMemo(() => {
    let p = 0, c = 0, g = 0;
    return (d.fluxo ?? []).filter((m) => Number(m.planejado) || Number(m.comprometido) || Number(m.pago)).map((m) => { p += Number(m.planejado); c += Number(m.comprometido); g += Number(m.pago); return { ...m, ap: p, ac: c, ag: g }; });
  }, [d]);
  return (
    <details className="cdl cdl-box">
      <summary style={{ cursor: "pointer" }}><b>Fluxo de compras do projeto</b> <span className="mut">— mês a mês</span></summary>
      <p className="cdl-nota">Planejado = linhas ainda sem PC, pela data necessária · Comprometido = parcelas dos pedidos de compra · Pago = saídas realizadas do projeto.</p>
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
    </details>
  );
}

export const CSS_CDL = `
.cdl{font-size:12.5px;color:var(--ww-text)}
.cdl .mut{color:var(--ww-text-muted)}
.cdl-res{border:1px solid var(--ww-border);border-radius:10px;padding:10px 12px;background:var(--ww-panel);display:flex;flex-direction:column;gap:8px}
.cdl-res-nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.cdl-res-nums>div{display:flex;flex-direction:column;gap:2px}
.cdl-res-nums span{font-size:11px;color:var(--ww-text-muted)}
.cdl-res-nums b{font-size:17px;font-weight:650}
.cdl-res-nums small{font-size:11px;color:var(--ww-text-muted)}
.cdl-res-trilho{position:relative;height:12px;border-radius:6px;background:var(--ww-row-hover,rgba(127,127,127,.15));display:flex;overflow:visible}
.cdl-res-trilho>.ap{background:#2563EB;height:100%}
.cdl-res-trilho>.pe{background:#F59E0B;height:100%}
.cdl-res-trilho>.rs{background:repeating-linear-gradient(45deg,rgba(148,163,184,.55) 0 4px,rgba(148,163,184,.3) 4px 8px);height:100%}
.cdl-res-trilho>div:first-child{border-radius:6px 0 0 6px}
.cdl-res-trilho>.bud{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ww-text);transform:translateX(-1px)}
.cdl-res-st{font-size:12px}
.cdl-res-st.neg{color:#e11d48;font-weight:600}
.cdl-res-st .mut{font-weight:400}
.cdl-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin:0 2px 0 4px;vertical-align:middle}
.cdl-dot.ap{background:#2563EB}.cdl-dot.pe{background:#F59E0B}.cdl-dot.rs{background:rgba(148,163,184,.6)}.cdl-dot.bud{background:var(--ww-text);width:2px}
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
.cdl-chip-pc{display:inline-flex;align-items:center;gap:3px;padding:0 6px;border-radius:6px;border:1px solid var(--ww-accent);color:var(--ww-accent);font-weight:600;font-size:11px;text-decoration:none;white-space:nowrap}
.cdl-chip-pc:hover{background:var(--ww-accent);color:#fff}
.cdl-barra{margin:6px 0 2px}
.cdl-barra-trilho{position:relative;height:12px;border-radius:6px;background:var(--ww-border);overflow:visible}
.cdl-barra-trilho > div{position:absolute;top:0;bottom:0;left:0;border-radius:6px}
.cdl-barra-proj{background:repeating-linear-gradient(45deg,#f59e0b55 0 6px,#f59e0b22 6px 12px)}
.cdl-barra-comp{background:#2563eb}
.cdl-barra-pago{background:#16a34a}
.cdl-barra .cdl-barra-budget{left:auto;width:0;border-left:2px solid var(--ww-text);top:-3px;bottom:-3px;border-radius:0}
.cdl-barra-leg{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--ww-text-muted);margin-top:4px}
.cdl-barra-leg i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.cdl-barra-leg i.pago{background:#16a34a}.cdl-barra-leg i.comp{background:#2563eb}.cdl-barra-leg i.proj{background:#f59e0b88}.cdl-barra-leg i.bud{background:var(--ww-text);width:2px}
.cdl-alerta{margin-top:5px;padding:5px 9px;border-radius:8px;background:#e11d4818;color:#e11d48;font-size:12px}
.cdl-neg{color:#e11d48}.cdl-pos{color:#059669}.cdl-warn{color:#b45309}
`;
