"use client";

// Cabeçalho do projeto — painel gráfico (08/10/26, spec B.0 "versão 3").
//
// Antes: cinco números crus em fila (KpisProjeto) e, dentro da aba Lista, outro bloco com
// "Budget de materiais / Lista prevista / Pedidos de compra" — a mesma informação duas vezes.
// Agora são três blocos fixos acima das abas:
//   (a) Valor fechado + resultado planejado %;
//   (b) barra de budget — trilha = max(budget, lista prevista); PCs aprovados (azul) ·
//       aguardando aprovação (âmbar) · ainda a comprar (cinza) · o que estoura (vermelho, à
//       direita da marca "budget"); legenda com os valores; 🔒 editar budget (só o Benny);
//   (c) "Comprar esta semana" (vermelho quando há atrasado) → "ver planejamento →".
//
// Fonte dos números: /api/rc-projetos/plano (vem por props) + rc_projetos_compras.totais e
// as linhas da lista (approval.v_rc_projetos_itens) para o planejamento por item. Com a aba
// Lista aberta, a grade manda os números AO VIVO (`vivo`) — o que se edita aparece aqui antes
// de gravar, igual à etapa Planejamento.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PlanoCompleto } from "./PlanoFechamento";
import { numerosDoPlano } from "./ResumoProjeto";
import type { DadosCompras } from "./ComprasDaLista";
import { supaBrowser } from "@/lib/supabase";
import { planejarItem, type PrazoFornecedor } from "@/lib/planejamento-compras";

/** Números que a grade da lista manda ao vivo (sobrepõem os lidos do banco). */
export type ResumoVivo = { restante: number; semana: number; nAtr: number; nAg: number };

const brl = (v: number | null | undefined) =>
  v == null ? "—" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const pct = (v: number) => `${v.toFixed(1).replace(".", ",")}%`;

type LinhaView = { id: string; qtd: number | null; cat_valor_unit: number | null; data_necessaria: string | null;
  cat_fornecedor: string | null; cat_entrega_dias: number | null; pc_numero: string | null };

export default function PainelProjeto({
  empresa, codigoProjeto, plano, teto, chave, vivo, onVerPlanejamento,
}: {
  empresa: string; codigoProjeto: number; plano: PlanoCompleto | null; teto: number | null;
  /** sobe a cada gravação da lista: relê compras e linhas */
  chave: number;
  vivo: ResumoVivo | null;
  onVerPlanejamento: () => void;
}) {
  const n = numerosDoPlano(plano, teto);
  const [cmp, setCmp] = useState<DadosCompras | null>(null);
  const [linhas, setLinhas] = useState<LinhaView[] | null>(null);
  const [prazos, setPrazos] = useState<Map<string, PrazoFornecedor>>(new Map());
  const [verBudget, setVerBudget] = useState(0);

  useEffect(() => {
    let vivoEf = true;
    (async () => {
      for (let t = 0; t < 3 && vivoEf; t++) {
        try {
          const r = await fetch(`/api/rc-projetos/compras?empresa=${empresa}&codigo=${codigoProjeto}`, { cache: "no-store" });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? r.statusText);
          if (vivoEf) setCmp(j as DadosCompras);
          return;
        } catch { if (t < 2) await new Promise((r) => setTimeout(r, 3000)); }
      }
    })();
    return () => { vivoEf = false; };
  }, [empresa, codigoProjeto, chave, verBudget]);
  useEffect(() => {
    let vivoEf = true;
    (async () => {
      try {
        const { data, error } = await supaBrowser().schema("approval" as never).from("v_rc_projetos_itens")
          .select("id, qtd, cat_valor_unit, data_necessaria, cat_fornecedor, cat_entrega_dias, pc_numero")
          .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto);
        if (!error && vivoEf) setLinhas((data ?? []) as LinhaView[]);
      } catch { /* sem as linhas, o tile mostra traço */ }
    })();
    return () => { vivoEf = false; };
  }, [empresa, codigoProjeto, chave]);
  useEffect(() => {
    fetch(`/api/compras/fornecedor-prazo?emp=${encodeURIComponent(empresa)}`, { cache: "no-store" })
      .then((x) => x.json())
      .then((j: { fornecedores?: { norm: string; nome: string; historico: number | null; manual: number | null }[] }) =>
        setPrazos(new Map((j.fornecedores ?? []).map((f) => [f.norm, { norm: f.norm, nome: f.nome, historico: f.historico, manual: f.manual }]))))
      .catch(() => {});
  }, [empresa, chave]);

  /** Do banco (quando a grade não está aberta): restante e "comprar esta semana". */
  const doBanco = useMemo<ResumoVivo | null>(() => {
    if (!linhas || !cmp) return null;
    const porId = new Map((cmp.itens ?? []).map((l) => [String(l.id), l]));
    let restante = 0, semana = 0, nAtr = 0, nAg = 0;
    for (const l of linhas) {
      const c = porId.get(String(l.id));
      const v = (Number(l.qtd) || 0) * (Number(l.cat_valor_unit) || 0);
      const temPc = !!c?.pcs.length || !!String(l.pc_numero ?? "").trim();
      if (!c?.rc && !c?.pcs.length) restante += v;
      if (temPc || !l.data_necessaria) continue;
      const p = planejarItem({ necessario: l.data_necessaria, temPc, prazoItem: l.cat_entrega_dias, fornecedor: l.cat_fornecedor, prazos });
      if (p.status === "atrasado") { nAtr++; semana += v; } else if (p.status === "agora") { nAg++; semana += v; }
    }
    return { restante, semana, nAtr, nAg };
  }, [linhas, cmp, prazos]);
  const r = vivo ?? doBanco;

  // ── barra de budget ──
  const t = cmp?.totais;
  const budget = t ? (t.budget_lista ?? t.budget_plano) : null;
  const comp = Number(t?.comprometido ?? 0);
  const aprov = t?.pcs_aprovado != null ? Number(t.pcs_aprovado) : comp;
  const pend = t?.pcs_pendente != null ? Number(t.pcs_pendente) : 0;
  const lista = r ? comp + r.restante : null;
  const escala = Math.max(budget ?? 0, lista ?? 0) * 1.02 || 1;
  const w = (v: number) => Math.max(0, Math.min(100, (v / escala) * 100));
  const teto2 = budget ?? Infinity;
  const aindaComprar = lista != null ? Math.max(0, Math.min(lista, teto2) - aprov - pend) : 0;
  const estoura = budget != null && lista != null ? Math.max(0, lista - budget) : 0;

  // 🔒 budget: só o Benny destranca e define (mesma regra do antigo bloco da aba Lista)
  const [podeBudget, setPodeBudget] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [budgetEdit, setBudgetEdit] = useState<string | null>(null);
  const [erroB, setErroB] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => { fetch("/api/rc-projetos/budget", { cache: "no-store" }).then((x) => x.json()).then((j) => setPodeBudget(!!j.pode)).catch(() => {}); }, []);
  const gravarBudget = useCallback(async (valor: number | null) => {
    setOcupado(true); setErroB(null);
    try {
      const x = await fetch("/api/rc-projetos/budget", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ empresa, codigo_projeto: codigoProjeto, valor_budget_materiais: valor }) });
      const j = await x.json();
      if (!x.ok) throw new Error(j.error ?? x.statusText);
      setBudgetEdit(null); setVerBudget((v) => v + 1);
    } catch (e) { setErroB((e as Error).message); } finally { setOcupado(false); }
  }, [empresa, codigoProjeto]);
  const salvarBudget = () => {
    const v = Number(String(budgetEdit ?? "").replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
    if (!Number.isFinite(v) || v < 0) { setErroB("Budget inválido"); return; }
    void gravarBudget(v);
  };

  const alerta = !!r && r.nAtr > 0;
  const BOX = "rounded-xl border border-ww-border bg-ww-rowHover/40 px-3.5 py-3 min-w-0";
  const ROT = "block text-[10.5px] uppercase tracking-[0.06em] text-ww-textFaint mb-1";

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)_220px] gap-3.5 items-stretch" data-painel-projeto>
      {/* (a) Valor fechado + resultado */}
      <div className={BOX}>
        <small className={ROT}>Valor fechado</small>
        <div className="text-[20px] font-bold tracking-tight tabular-nums text-ww-text leading-tight">{n.valor > 0 ? brl(n.valor) : "—"}</div>
        <div className="text-[11.5px] text-ww-textMuted mt-0.5">
          {n.parcelas.length > 0 ? `${n.parcelas.length} parcela${n.parcelas.length === 1 ? "" : "s"}` : "sem plano importado"}
          {n.temPlano && n.margem != null && <> · resultado planejado <b className={n.resultado >= 0 ? "text-emerald-600 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300"}>{pct(n.margem)}</b></>}
        </div>
      </div>

      {/* (b) Barra de budget */}
      <div className={BOX} data-budget>
        <small className={`${ROT} flex items-center gap-1 flex-wrap`}>
          Budget de materiais
          {budgetEdit == null
            ? <b className="normal-case tracking-normal text-ww-text tabular-nums">{brl(budget)}</b>
            : <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                <input autoFocus value={budgetEdit} onChange={(e) => setBudgetEdit(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") salvarBudget(); if (e.key === "Escape") setBudgetEdit(null); }}
                  className="w-28 rounded border border-ww-border bg-transparent px-1 text-[11.5px] text-ww-text" />
                <button type="button" disabled={ocupado} onClick={salvarBudget} className="px-1.5 rounded bg-ww-accent text-white text-[11px]">ok</button>
                <button type="button" onClick={() => setBudgetEdit(null)} className="text-[11px]">×</button>
              </span>}
          <button type="button" disabled={!podeBudget} className="normal-case text-[11px] disabled:opacity-60"
            title={podeBudget ? (aberto ? "Trancar o budget" : "Destrancar para definir o budget") : "🔒 Budget trancado — só o Benny define"}
            onClick={() => { if (podeBudget) { setAberto((v) => !v); setBudgetEdit(null); } }}>{aberto ? "🔓" : "🔒"}</button>
          {podeBudget && aberto && budgetEdit == null && (
            <button type="button" className="normal-case tracking-normal text-[11px] text-ww-accent hover:underline"
              onClick={() => setBudgetEdit(budget != null ? String(budget).replace(".", ",") : "")}>editar</button>)}
          {podeBudget && aberto && t?.budget_lista != null && t?.budget_plano != null && (
            <button type="button" disabled={ocupado} className="normal-case tracking-normal text-[11px] text-ww-accent hover:underline"
              title={`Volta ao total de materiais da RC (${brl(t.budget_plano)})`} onClick={() => void gravarBudget(null)}>usar o da RC</button>)}
          <span className="normal-case tracking-normal">· lista prevista <b className="text-ww-text tabular-nums">{lista != null ? brl(lista) : "—"}</b></span>
        </small>
        <div className="relative h-[18px] rounded-full bg-[rgb(var(--color-ww-panel))] my-2 mt-4" aria-label="Barra de budget">
          {lista != null && <>
            <div className="absolute inset-y-0 left-0 bg-sky-500 rounded-l-full" style={{ width: `${w(aprov)}%` }} title={`PCs aprovados ${brl(aprov)}`} />
            <div className="absolute inset-y-0 bg-amber-500" style={{ left: `${w(aprov)}%`, width: `${w(pend)}%` }} title={`Aguardando aprovação ${brl(pend)}`} />
            <div className="absolute inset-y-0 bg-slate-400/40" style={{ left: `${w(aprov + pend)}%`, width: `${w(aindaComprar)}%` }} title={`Ainda a comprar ${brl(aindaComprar)}`} />
            {estoura > 0 && budget != null && <div className="absolute inset-y-0 bg-rose-500 rounded-r-full" style={{ left: `${w(budget)}%`, width: `${w(estoura)}%` }} title={`Estoura o budget em ${brl(estoura)}`} />}
          </>}
          {budget != null && budget > 0 && (
            <div className="absolute -top-1 -bottom-1 w-0.5 bg-ww-text" style={{ left: `${w(budget)}%` }}>
              <span className="absolute -top-4 -left-5 text-[10px] text-ww-textMuted">budget</span>
            </div>)}
        </div>
        <div className="flex gap-x-3.5 gap-y-1 flex-wrap text-[11.5px] text-ww-textMuted">
          <Leg cor="bg-sky-500">PCs aprovados <b className="text-ww-text tabular-nums">{brl(aprov)}</b></Leg>
          <Leg cor="bg-amber-500">aguardando aprovação <b className="text-ww-text tabular-nums">{brl(pend)}</b></Leg>
          <Leg cor="bg-slate-400/60">ainda a comprar <b className="text-ww-text tabular-nums">{lista != null ? brl(aindaComprar) : "—"}</b></Leg>
          {budget == null ? <span className="text-ww-textFaint">sem budget de materiais{podeBudget ? "" : " (só o Benny define 🔒)"}</span>
            : estoura > 0 ? <Leg cor="bg-rose-500">estoura o budget <b className="text-ww-text tabular-nums">{brl(estoura)}</b></Leg>
            : lista != null ? <Leg cor="bg-emerald-500">sobra <b className="text-ww-text tabular-nums">{brl(budget - lista)}</b></Leg> : null}
        </div>
        {erroB && <div className="mt-1 text-[11px] text-rose-600">{erroB}</div>}
      </div>

      {/* (c) Comprar esta semana */}
      <div className={`${BOX} ${alerta ? "!border-rose-500/50 !bg-rose-500/[0.06]" : ""}`} data-kpi-semana>
        <small className={ROT}>Comprar esta semana</small>
        <div className={`text-[20px] font-bold tracking-tight tabular-nums leading-tight ${alerta ? "text-rose-600 dark:text-rose-400" : "text-ww-text"}`}>{r ? brl(r.semana) : "—"}</div>
        <div className="text-[11.5px] text-ww-textMuted mt-0.5">
          {r ? <>{r.nAtr} atrasado{r.nAtr === 1 ? "" : "s"} · {r.nAg} próximos 7 dias · </> : null}
          <button type="button" className="text-ww-accent hover:underline" onClick={onVerPlanejamento}>ver planejamento →</button>
        </div>
      </div>
    </div>
  );
}

function Leg({ cor, children }: { cor: string; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-1.5"><i className={`inline-block w-[9px] h-[9px] rounded-sm ${cor}`} />{children}</span>;
}
