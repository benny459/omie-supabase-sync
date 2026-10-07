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
  venda: number | null; margem_plano: number | null };
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

/** 1. Quanto vou gastar? O estimado e o restante vêm da lista (valor da linha, senão
 *  último preço do catálogo, senão custo da CP) — o banco só conhece o valor gravado. */
export function KpisCompras({ d, estimado, restante, linhas, empresa, codigoProjeto, onRecarregar }: {
  d: DadosCompras; estimado: number; restante: number; linhas: number; empresa: string; codigoProjeto: number; onRecarregar: () => void;
}) {
  const [budgetEdit, setBudgetEdit] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const t = d.totais;
  const budget = t ? (t.budget_lista ?? t.budget_plano) : null;
  const projetado = (t?.comprometido ?? 0) + restante;
  const folga = budget != null ? budget - projetado : null;
  const margemProj = t?.margem_plano != null && folga != null ? Number(t.margem_plano) + folga : null;
  const salvarBudget = async () => {
    const v = Number(String(budgetEdit ?? "").replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(v) || v < 0) { setErro("Budget inválido"); return; }
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/rc-projetos/budget", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, valor_budget: v }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setBudgetEdit(null); onRecarregar();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  };
  return (
    <div className="cdl space-y-1">
      <div className="cdl-kpis">
        <div className="cdl-kpi"><span>Estimado da lista</span><b>{brl(estimado)}</b><small>{linhas} linha(s)</small></div>
        <div className="cdl-kpi">
          <span>Budget de materiais</span>
          {budgetEdit == null
            ? <b>{brl(budget)} <button className="cdl-lk" onClick={() => setBudgetEdit(String(budget ?? ""))}>editar</button></b>
            : <span className="cdl-row"><input className="cdl-in" autoFocus value={budgetEdit} onChange={(e) => setBudgetEdit(e.target.value)} />
                <button className="cdl-btn pri" disabled={ocupado} onClick={() => void salvarBudget()}>ok</button>
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
      {/* Barra do projeto inteiro (07/10/26): budget × projetado × comprometido × pago, numa escala só */}
      {budget != null && budget > 0 && (() => {
        const pago = Number(t?.pago ?? 0), comp = Number(t?.comprometido ?? 0);
        const max = Math.max(budget, projetado, comp, pago) || 1;
        const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
        return (
          <div className="cdl-barra" title={`Budget ${brl(budget)} · Projetado ${brl(projetado)} · Comprometido ${brl(comp)} · Pago ${brl(pago)}`}>
            <div className="cdl-barra-trilho">
              <div className="cdl-barra-proj" style={{ width: pct(projetado) }} />
              <div className="cdl-barra-comp" style={{ width: pct(comp) }} />
              <div className="cdl-barra-pago" style={{ width: pct(pago) }} />
              <div className="cdl-barra-budget" style={{ left: pct(budget) }} />
            </div>
            <div className="cdl-barra-leg">
              <span><i className="pago" /> Pago {brl(pago)}</span>
              <span><i className="comp" /> Comprometido {brl(comp)}</span>
              <span><i className="proj" /> Projetado {brl(projetado)}</span>
              <span><i className="bud" /> Budget {brl(budget)}</span>
            </div>
            {projetado > budget && <div className="cdl-alerta">⚠ O projetado estoura o budget de materiais em <b>{brl(projetado - budget)}</b>.</div>}
          </div>);
      })()}
      <p className="cdl-nota">Projetado = comprometido nos PCs + estimado das linhas que ainda não têm PC. Margem = margem do fechamento ± a diferença entre o budget e o projetado.
        Estimado de cada linha = valor unit. da linha, senão o último preço do catálogo, senão o custo da RC.</p>
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
