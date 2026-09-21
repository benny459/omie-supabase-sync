"use client";

// Simples Nacional — projeção do DAS do mês em andamento.
//
// A pergunta que a tela responde é "quanto vou pagar dia 20?", e ela dá para
// responder cedo porque a alíquota já está definida no dia 1º: depende só do
// RBT12 e do fator r, que são meses fechados. Durante o mês só a base se move.
//
// Por isso o destaque não é só o DAS de hoje — é o CUSTO POR MIL: quanto cada
// R$ 1.000 que você faturar hoje acrescenta ao DAS. Esse número é fixo até o
// dia 30 e é o que serve para decidir na hora.

import { useCallback, useEffect, useMemo, useState } from "react";
import StatTile from "@/components/viz/StatTile";

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl0 = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (v: number, casas = 4) =>
  `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
const dia = (s: string | null) =>
  s ? new Date(s + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—";
const mesLongo = (s: string) =>
  new Date(s + "T00:00:00").toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

type Tributos = Record<string, number>;
type Atividade = {
  anexo: string; rotulo: string; base: number; efetiva: number;
  debito: number; tributos: Tributos; issNoTeto: boolean;
};
type Cenario = { rotulo: string; mercantil: number; receita: number; das: number; efetiva: number };
type Conf = { competencia: string; calculado: number; declarado: number | null; diferenca: number | null; recibo: number };
type Doc = { data: string; tipo: string; documento: string; cliente: string; valor: number; anexo: string; na_base: boolean };

type Dados = {
  competencia: string; rbt12: number; faixa: number; folha12: number;
  fatorR: number | null; mesesSemFolha: number; anexoServico: string;
  efetivas: Record<string, number>; custoPorMil: Record<string, number>;
  folgaFaixa: number | null;
  bases: { mercantil: number; servicoIii: number; servicoV: number; recibo: number };
  contagens: { nfe: number; osNota: number; osRecibo: number };
  sincronizado: { nfe: string | null; os: string | null };
  realizado: { das: number; receitaDoMes: number; efetivaMedia: number; atividades: Atividade[]; tributos: Tributos };
  cenarios: Cenario[];
  conferencia: Conf[];
  documentos: Doc[];
  anexoIiiClientes: { codigo_cliente: string; observacao: string | null }[];
};

const ORDEM_TRIB = ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "ICMS", "ISS"];

export default function SimplesView() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [competencia, setCompetencia] = useState("");
  const [verRecibos, setVerRecibos] = useState(false);

  const load = useCallback(async () => {
    setCarregando(true); setErro("");
    try {
      const qs = competencia ? `?competencia=${competencia}` : "";
      const r = await fetch(`/api/simples${qs}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setD(j);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [competencia]);

  useEffect(() => { void load(); }, [load]);

  const docs = useMemo(() => {
    if (!d) return [];
    return verRecibos ? d.documentos : d.documentos.filter((x) => x.na_base);
  }, [d, verRecibos]);

  const mesesDisponiveis = useMemo(() => {
    if (!d) return [];
    const lista = d.conferencia.map((c) => c.competencia).concat(d.competencia);
    return Array.from(new Set(lista)).sort().reverse().slice(0, 14);
  }, [d]);

  if (erro) {
    return <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[12px]">{erro}</div>;
  }
  if (!d) {
    return <div className="text-[12px] text-ww-textMuted">{carregando ? "Apurando…" : "Sem dados."}</div>;
  }

  const semRecibo = d.bases.recibo;
  const cenarioHoje = d.cenarios[0];
  const cenarioMedia = d.cenarios[1];

  return (
    <div className="space-y-4 min-w-0">
      {/* Seletor de competência + carimbo de sincronização. Sem saber até quando
          o Omie trouxe nota, o número de cima não significa nada. */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={competencia || d.competencia.slice(0, 7)}
          onChange={(e) => setCompetencia(e.target.value)}
          className="text-[12px] bg-ww-panel border border-ww-border rounded-lg px-2.5 py-1.5 text-ww-text"
        >
          {mesesDisponiveis.map((m) => (
            <option key={m} value={m.slice(0, 7)}>{mesLongo(m)}</option>
          ))}
        </select>
        <span className="text-[11px] text-ww-textFaint">
          Omie sincronizado até {dia(d.sincronizado.nfe)} (NF-e) e {dia(d.sincronizado.os)} (OS)
        </span>
        <button onClick={() => void load()} disabled={carregando}
                className="text-[11px] px-2.5 py-1 rounded-lg border border-ww-border hover:bg-ww-rowHover disabled:opacity-50">
          {carregando ? "…" : "Atualizar"}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="DAS com o que já foi faturado" value={brl(d.realizado.das)}
                  hint={`sobre ${brl0(d.realizado.receitaDoMes)} de receita`} />
        <StatTile label="Projeção do fechamento" value={brl0(cenarioMedia.das)}
                  hint="mercantil na média de 6 meses" />
        <StatTile label="Custo de cada R$ 1.000 faturado"
                  value={brl(d.custoPorMil.I)}
                  hint={`mercantil · serviço ${brl(d.custoPorMil[d.anexoServico])}`} />
        <StatTile label="RBT12 — faixa" value={brl0(d.rbt12)}
                  hint={`${d.faixa}ª faixa${d.folgaFaixa !== null ? ` · ${brl0(d.folgaFaixa)} até a seguinte` : ""}`}
                  higherIsBetter={false} />
      </div>

      {/* ===== O que já está travado ===== */}
      <section className="bg-ww-panel border border-ww-border rounded-xl p-4">
        <h2 className="text-[13px] font-bold text-ww-text">O que já está definido para {mesLongo(d.competencia)}</h2>
        <p className="text-[11px] text-ww-textMuted mt-0.5">
          Estes números não mudam mais até o dia 30 — dependem só de meses fechados.
          O que se move é a base faturada.
        </p>
        <div className="mt-3 grid md:grid-cols-2 gap-x-8 gap-y-2 text-[12px]">
          <Linha rotulo="RBT12 (12 meses anteriores)" valor={brl(d.rbt12)} />
          <Linha rotulo={`Fator r (folha ${brl0(d.folha12)} ÷ RBT12)`}
                 valor={d.fatorR === null ? "—" : `${(d.fatorR * 100).toFixed(2)}%`}
                 nota={d.fatorR !== null && d.fatorR < 0.28
                   ? `abaixo de 28% → serviços no Anexo ${d.anexoServico}`
                   : "≥ 28% → serviços no Anexo III"} />
          <Linha rotulo="Alíquota efetiva — Anexo I (mercadorias)" valor={pct(d.efetivas.I)} />
          <Linha rotulo={`Alíquota efetiva — Anexo ${d.anexoServico} (serviços fator r)`}
                 valor={pct(d.efetivas[d.anexoServico])} />
          <Linha rotulo="Alíquota efetiva — Anexo III" valor={pct(d.efetivas.III)} />
          <Linha rotulo="Cada R$ 1.000 de NF-e custa" valor={brl(d.custoPorMil.I)}
                 nota={`cada R$ 1.000 de OS com nota: ${brl(d.custoPorMil[d.anexoServico])}`} />
        </div>
        {d.mesesSemFolha > 0 && (
          <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-400">
            Folha de {d.mesesSemFolha} {d.mesesSemFolha === 1 ? "mês" : "meses"} ainda não lançada —
            completei pela média para estimar o fator r. Não muda o anexo: seria preciso folha quase 3× maior.
          </p>
        )}
      </section>

      {/* ===== Memorial de cálculo ===== */}
      <section className="bg-ww-panel border border-ww-border rounded-xl p-4 overflow-x-auto">
        <h2 className="text-[13px] font-bold text-ww-text">Memorial de cálculo — o que já está faturado</h2>
        <table className="mt-3 w-full text-[12px] border-collapse min-w-[720px]">
          <thead>
            <tr className="text-left text-ww-textMuted border-b border-ww-border">
              <th className="py-1.5 pr-3 font-medium">Atividade</th>
              <th className="py-1.5 px-2 font-medium text-right">Base</th>
              <th className="py-1.5 px-2 font-medium text-right">Alíquota</th>
              <th className="py-1.5 px-2 font-medium text-right">Débito</th>
              {ORDEM_TRIB.map((t) => <th key={t} className="py-1.5 px-2 font-medium text-right">{t}</th>)}
            </tr>
          </thead>
          <tbody>
            {d.realizado.atividades.map((a) => (
              <tr key={a.rotulo} className="border-b border-ww-border/50 hover:bg-ww-rowHover">
                <td className="py-1.5 pr-3">
                  {a.rotulo}
                  {a.issNoTeto && (
                    <span className="ml-1.5 text-[10px] text-amber-700 dark:text-amber-400" title="ISS travado em 5% da base; o excedente foi redistribuído entre os demais tributos">
                      ISS no teto
                    </span>
                  )}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{brl(a.base)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{pct(a.efetiva)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums font-semibold">{brl(a.debito)}</td>
                {ORDEM_TRIB.map((t) => (
                  <td key={t} className="py-1.5 px-2 text-right tabular-nums text-ww-textMuted">
                    {a.tributos[t] ? brl(a.tributos[t]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="font-bold">
              <td className="py-2 pr-3">DAS</td>
              <td className="py-2 px-2 text-right tabular-nums">{brl(d.realizado.receitaDoMes)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{pct(d.realizado.efetivaMedia, 2)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{brl(d.realizado.das)}</td>
              {ORDEM_TRIB.map((t) => (
                <td key={t} className="py-2 px-2 text-right tabular-nums">
                  {d.realizado.tributos[t] ? brl(d.realizado.tributos[t]) : "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </section>

      {/* ===== Cenários ===== */}
      <section className="bg-ww-panel border border-ww-border rounded-xl p-4">
        <h2 className="text-[13px] font-bold text-ww-text">Como o mês pode fechar</h2>
        <p className="text-[11px] text-ww-textMuted mt-0.5">
          As OS de serviço recorrentes já entraram; o que ainda se move é o mercantil.
        </p>
        <div className="mt-3 grid md:grid-cols-3 gap-3">
          {d.cenarios.map((c) => (
            <div key={c.rotulo} className="border border-ww-border rounded-lg p-3">
              <p className="text-[11px] text-ww-textMuted uppercase tracking-wider">{c.rotulo}</p>
              <p className="mt-1 text-[20px] font-bold text-ww-text tabular-nums">{brl0(c.das)}</p>
              <p className="mt-0.5 text-[10.5px] text-ww-textFaint">
                mercantil {brl0(c.mercantil)} · receita {brl0(c.receita)} · {(c.efetiva * 100).toFixed(2)}%
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ===== Notas do mês ===== */}
      <section className="bg-ww-panel border border-ww-border rounded-xl p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-[13px] font-bold text-ww-text">Notas do mês</h2>
            <p className="text-[11px] text-ww-textMuted mt-0.5">
              {d.contagens.nfe} NF-e · {d.contagens.osNota} OS com nota na base ·{" "}
              {d.contagens.osRecibo} OS por recibo fora dela ({brl0(semRecibo)})
            </p>
          </div>
          <label className="text-[11px] text-ww-textMuted flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={verRecibos} onChange={(e) => setVerRecibos(e.target.checked)} />
            mostrar as OS de recibo
          </label>
        </div>
        <div className="mt-3 max-h-[420px] overflow-auto">
          <table className="w-full text-[12px] border-collapse min-w-[620px]">
            <thead className="sticky top-0 bg-ww-panel">
              <tr className="text-left text-ww-textMuted border-b border-ww-border">
                <th className="py-1.5 pr-3 font-medium">Data</th>
                <th className="py-1.5 px-2 font-medium">Tipo</th>
                <th className="py-1.5 px-2 font-medium">Documento</th>
                <th className="py-1.5 px-2 font-medium">Cliente</th>
                <th className="py-1.5 px-2 font-medium text-center">Anexo</th>
                <th className="py-1.5 px-2 font-medium text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((x, i) => (
                <tr key={`${x.tipo}-${x.documento}-${i}`}
                    className={`border-b border-ww-border/40 hover:bg-ww-rowHover ${x.na_base ? "" : "opacity-55"}`}>
                  <td className="py-1.5 pr-3 tabular-nums">{dia(x.data)}</td>
                  <td className="py-1.5 px-2">{x.tipo}</td>
                  <td className="py-1.5 px-2 tabular-nums">{x.documento}</td>
                  <td className="py-1.5 px-2 truncate max-w-[280px]" title={x.cliente}>{x.cliente}</td>
                  <td className="py-1.5 px-2 text-center">{x.anexo}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{brl(x.valor)}</td>
                </tr>
              ))}
              {!docs.length && (
                <tr><td colSpan={6} className="py-4 text-center text-ww-textFaint text-[11px]">Nenhuma nota neste mês ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ===== Conferência histórica ===== */}
      <section className="bg-ww-panel border border-ww-border rounded-xl p-4 overflow-x-auto">
        <h2 className="text-[13px] font-bold text-ww-text">Conferência — Omie × PGDAS</h2>
        <p className="text-[11px] text-ww-textMuted mt-0.5">
          O que a reconstrução do faturamento dá contra o que foi efetivamente declarado.
          Onde diverge, houve decisão do contador sobre alguma OS.
        </p>
        <table className="mt-3 w-full text-[12px] border-collapse min-w-[560px]">
          <thead>
            <tr className="text-left text-ww-textMuted border-b border-ww-border">
              <th className="py-1.5 pr-3 font-medium">Competência</th>
              <th className="py-1.5 px-2 font-medium text-right">Calculado (Omie)</th>
              <th className="py-1.5 px-2 font-medium text-right">Declarado (PGDAS)</th>
              <th className="py-1.5 px-2 font-medium text-right">Diferença</th>
              <th className="py-1.5 px-2 font-medium text-right">OS por recibo (fora)</th>
            </tr>
          </thead>
          <tbody>
            {d.conferencia.map((c) => {
              const ok = c.diferenca !== null && Math.abs(c.diferenca) < 0.01;
              return (
                <tr key={c.competencia} className="border-b border-ww-border/50 hover:bg-ww-rowHover">
                  <td className="py-1.5 pr-3">{mesLongo(c.competencia)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{brl0(c.calculado)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{c.declarado === null ? "—" : brl0(c.declarado)}</td>
                  <td className={`py-1.5 px-2 text-right tabular-nums font-semibold ${
                        c.diferenca === null ? "text-ww-textFaint" : ok ? "text-emerald-600 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
                    {c.diferenca === null ? "—" : ok ? "confere" : brl0(c.diferenca)}
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums text-ww-textMuted">{brl0(c.recibo)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <p className="text-[10.5px] text-ww-textFaint">
        Critério: mercantil = NF-e autorizadas (fora canceladas e devolvidas); serviço = OS faturadas com nota
        (OS de recibo não entra). Anexo III para {d.anexoIiiClientes.length}{" "}
        {d.anexoIiiClientes.length === 1 ? "cliente marcado" : "clientes marcados"} em
        {" "}finance.simples_anexo_iii. Conferido contra os extratos PGDAS de 07 e 08/2026.
      </p>
    </div>
  );
}

function Linha({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-ww-border/40 py-1">
      <span className="text-ww-textMuted">{rotulo}</span>
      <span className="text-right">
        <span className="font-semibold text-ww-text tabular-nums">{valor}</span>
        {nota && <span className="block text-[10.5px] text-ww-textFaint">{nota}</span>}
      </span>
    </div>
  );
}
