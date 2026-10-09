"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { limpo } from "@/lib/faturamento/montar";
import { BuscaPessoa, type PessoaOp } from "@/components/vendas/BuscasCrmCadastro";
import { numBR, validarItensContrato } from "@/lib/faturamento/contrato-valor";

/* Contratos recorrentes (sql/68, 05/10/2026) — aba da tela /faturamento.
   O contrato vive no painel (importado uma vez do Omie). "Faturar competência"
   cria a OS nativa; a OS segue pela carteira: recibo (Emitir) ou NFS-e da
   prefeitura (Registrar NFS-e). Uma competência por contrato — a trava é do banco. */

type Sit = "faturado" | "gerado" | "atrasado" | "a_faturar" | "futuro";
type Comp = { competencia: string; data_prevista: string; situacao: Sit; documento: string | null; venda_id: number | null; comp_id: number | null };
type Ctr = {
  id: number; empresa: string; numero: string; omie_codigo: number | null; cliente_codigo: number | null; cliente: string | null; cliente_doc: string | null;
  projeto: string | null; projeto_nome: string | null; status: "ativo" | "suspenso" | "encerrado" | "rascunho";
  vig_inicio: string | null; vig_fim: string | null; periodicidade: number; dia: number; mes_seguinte: boolean;
  valor: number; mensal: number; condicao: string | null; condicao_desc: string | null; tipo_documento: string | null;
  indice: string | null; data_base_reajuste: string | null; proximo_reajuste: string | null; origem: string; observacoes: string | null;
  reajuste_proximo: boolean; vencendo: boolean; vencido: boolean; competencias: Comp[]; atrasadas: number;
  mes: Sit | null; mes_data: string | null; mes_competencia: string | null; proxima: string | null; ultima_faturada: string | null;
};
type Painel = {
  hoje: string; contratos: Ctr[];
  kpis: { ativos: number; mrr: number; a_faturar_mes_qtd: number; a_faturar_mes_valor: number; atrasados_qtd: number; atrasados_valor: number;
    faturados_mes_qtd: number; reajustes: number; vencendo: number; vencidos: number };
};
type Item = { id?: number; seq?: number; descricao: string; lc116: string | null; cod_serv_munic: string | null; quantidade: number; valor_unitario: number; valor_total?: number; aliq_iss?: number | null; retem_iss?: boolean; servico_codigo?: string | null };
type Detalhe = {
  contrato: Record<string, unknown>; itens: Item[];
  historico_faturas: { id: number; competencia: string; status: string; origem: string; documento: string | null; venda_id: number | null; valor: number; data: string | null; recibo: string | null;
    emissao: { id: number; tipo: string; status: string; numero: string | null; pdf_path: string | null; mensagem: string | null; ambiente: string; em: string } | null;
    nfse: { id: number; numero: string; municipio: string; tem_pdf: boolean; data: string | null } | null }[];
  reajustes: { id: number; vigente_desde: string; valor_anterior: number; valor_novo: number; indice: string | null; percentual: number | null; observacao: string | null; origem: string; por: string | null }[];
  log: { por: string | null; acao: string; detalhe: Record<string, unknown> | null; em: string }[];
};
type Opcoes = { condicoes: { codigo: string; descricao: string }[]; projetos: { codigo: string | number; nome: string }[]; categorias: { codigo: string; descricao: string }[] };

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmt = (v: number) => BRL.format(Number(v) || 0);
const fmtK = (v: number) => (Math.abs(v) >= 1e6 ? `R$ ${(v / 1e6).toFixed(2).replace(".", ",")} mi` : Math.abs(v) >= 1e4 ? `R$ ${Math.round(v / 1e3)} mil` : fmt(v));
const dataBR = (iso: string | null | undefined) => (iso ? new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—");
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const comp = (iso: string | null | undefined) => (iso ? `${MES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}` : "—");
const PER: Record<number, string> = { 1: "Mensal", 2: "Bimestral", 3: "Trimestral", 4: "Quadrimestral", 6: "Semestral", 12: "Anual" };
const SIT: Record<Sit, { l: string; c: string }> = {
  faturado: { l: "Faturado", c: "s-fat" }, gerado: { l: "OS gerada", c: "s-emis" }, atrasado: { l: "Atrasado", c: "s-rej" },
  a_faturar: { l: "A faturar", c: "s-pronto" }, futuro: { l: "Próximo mês", c: "s-pend" },
};
const STC: Record<Ctr["status"], string> = { ativo: "s-fat", suspenso: "s-pend", encerrado: "s-pend", rascunho: "s-pend" };
/** Linha do Registro do contrato em português (09/10/26: "valor: R$ 0,00 → R$ 2.720,64"). */
function textoLog(l: { acao: string; detalhe: Record<string, unknown> | null }) {
  const d = l.detalhe ?? {};
  if (typeof d.texto === "string" && d.texto) return `${({ alteracao: "alterado", os_atualizada: "OS atualizada", recibo_cancelado: "recibo cancelado" } as Record<string, string>)[l.acao] ?? l.acao} · ${d.texto}`;
  if (l.acao === "editado" || l.acao === "criado") return `${l.acao === "criado" ? "criado" : "gravado"} · valor ${fmt(Number(d.valor ?? 0))}${d.itens != null ? ` · ${d.itens} item(ns)` : ""}`;
  if (l.acao === "faturar") return `faturado · ${String(d.documento ?? "")} · competência ${comp(String(d.competencia ?? ""))} · ${fmt(Number(d.valor ?? 0))}`;
  if (l.acao === "desfazer") return `competência ${comp(String(d.competencia ?? ""))} desfeita · ${String(d.motivo ?? "")}`;
  return `${l.acao}${Object.keys(d).length ? ` · ${JSON.stringify(d)}` : ""}`;
}
const devidas = (c: Ctr) => c.competencias.filter((x) => x.situacao === "atrasado" || x.situacao === "a_faturar");

export default function ContratosRecorrentes({ empresa, admin, tipoOs, prod, avisar, registrarNfse }: {
  empresa: string; admin: boolean; tipoOs: "recibo" | "nfse"; prod: boolean;
  avisar: (m: string) => void; registrarNfse: (chaves: string[]) => void;
}) {
  const [p, setP] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<string>("ativo");
  const [fPer, setFPer] = useState<string>("");
  const [kpi, setKpi] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState<number | null>(null);
  const [editar, setEditar] = useState<Ctr | "novo" | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [gerados, setGerados] = useState<{ label: string; id: number; contrato: string }[]>([]);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/faturamento/contratos?empresa=${empresa}`, { cache: "no-store" }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) setErro(r.error); else { setErro(null); setP(r); }
  }, [empresa]);
  useEffect(() => { carregar(); }, [carregar]);

  async function post(body: Record<string, unknown>) {
    return fetch("/api/faturamento/contratos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
  }

  async function faturar(c: Ctr, competencia: string) {
    if (!(Number(c.valor) > 0)) { avisar(`O contrato ${c.numero} está com valor R$ 0,00 — a OS sairia sem preço. Abra o contrato, clique em Editar, informe o valor e grave; depois fature.`); return; }
    if (!window.confirm(`Gerar a OS do contrato ${c.numero} (${limpo(c.cliente ?? "")}) — competência ${comp(competencia)} — ${fmt(c.valor)}?`)) return;
    setOcupado(`f:${c.id}:${competencia}`);
    const r = await post({ acao: "faturar", id: c.id, competencia });
    setOcupado(null);
    if (r.error) { avisar(`${c.numero}: ${r.error}`); return; }
    const d = r.documento;
    setGerados((g) => [{ label: d.label, id: Number(d.id), contrato: c.numero }, ...g].slice(0, 20));
    avisar(`${d.label} gerada para o contrato ${c.numero} (${comp(competencia)}). Agora ${tipoOs === "nfse" ? "registre a NFS-e da prefeitura" : "emita o recibo"}.`);
    carregar();
  }

  async function faturarLote() {
    const itens = [...sel].map((k) => { const [id, competencia] = k.split("|"); return { id: Number(id), competencia }; });
    if (!itens.length) return;
    const tot = itens.reduce((a, x) => a + Number(p?.contratos.find((c) => c.id === x.id)?.valor ?? 0), 0);
    if (!window.confirm(`Gerar ${itens.length} OS de contrato (${fmt(tot)})?`)) return;
    setOcupado("lote");
    const r = await post({ acao: "faturar_lote", itens });
    setOcupado(null);
    if (r.error) { avisar(r.error); return; }
    const feitos = (r.feitos ?? []) as { label: string; id: number; contrato: string }[];
    setGerados((g) => [...feitos.map((d) => ({ label: d.label, id: Number(d.id), contrato: d.contrato })), ...g].slice(0, 40));
    avisar(`${feitos.length} OS gerada(s)${r.erros?.length ? ` · ${r.erros.length} com erro: ${r.erros.map((e: { erro: string }) => e.erro).join(" | ")}` : ""}`);
    setSel(new Set());
    carregar();
  }

  async function emitirRecibo(g: { label: string; id: number }) {
    if (!window.confirm(prod ? `Emitir o RECIBO DE PRODUÇÃO da ${g.label}? (numeração real)` : `Emitir o recibo da ${g.label} em homologação?`)) return;
    setOcupado(`e:${g.id}`);
    const r = await fetch("/api/faturamento/carteira", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresa, chave: `venda:${g.id}`, acao: "emitir" }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcupado(null);
    if (r.error) { avisar(`${g.label}: ${r.error}`); return; }
    avisar(`${g.label}: recibo ${r.emissao.status}${r.emissao.numero ? ` nº ${r.emissao.numero}` : ""}`);
    setGerados((x) => x.filter((y) => y.id !== g.id));
    carregar();
  }

  async function importar() {
    if (!window.confirm("Reler os contratos do espelho do Omie? (só leitura; contratos editados no painel não são sobrescritos)")) return;
    setOcupado("imp");
    const r = await post({ acao: "importar" });
    setOcupado(null);
    if (r.error) avisar(r.error); else { avisar(`Releitura: ${r.contratos} contratos (${r.novos} novos), ${r.competencias} competências do histórico`); carregar(); }
  }

  const lista = useMemo(() => (p?.contratos ?? []).filter((c) => {
    if (fStatus && c.status !== fStatus) return false;
    if (fPer && String(c.periodicidade) !== fPer) return false;
    if (kpi === "afaturar" && !devidas(c).length) return false;
    if (kpi === "atrasado" && !c.atrasadas) return false;
    if (kpi === "faturado" && !(c.mes === "faturado" || c.mes === "gerado")) return false;
    if (kpi === "reajuste" && !c.reajuste_proximo) return false;
    if (kpi === "vencendo" && !(c.vencendo || c.vencido)) return false;
    if (q) {
      const h = `${c.numero} ${c.cliente ?? ""} ${c.cliente_doc ?? ""} ${c.projeto_nome ?? ""}`.toLowerCase();
      if (!h.includes(q.toLowerCase())) return false;
    }
    return true;
  }), [p, fStatus, fPer, kpi, q]);

  if (erro) return <div className="alert bad" onClick={carregar}>{erro} — clique para tentar de novo</div>;
  if (!p) return <div className="empty">Carregando contratos…</div>;
  const k = p.kpis;
  const K = [
    { k: null, lb: "Receita recorrente mensal", v: fmtK(k.mrr), m: <><b>{k.ativos}</b> contratos ativos</>, acc: "var(--f-os)" },
    { k: "afaturar", lb: "A faturar no mês", v: fmtK(k.a_faturar_mes_valor), m: <><b>{k.a_faturar_mes_qtd}</b> competências</>, acc: "var(--f-blue)" },
    { k: "atrasado", lb: "Atrasados", v: fmtK(k.atrasados_valor), m: <><b>{k.atrasados_qtd}</b> competências já deviam ter saído</>, acc: "var(--f-bad)" },
    { k: "faturado", lb: "Já faturados no mês", v: String(k.faturados_mes_qtd), m: <>competências com OS</>, acc: "var(--f-ok)" },
    { k: "reajuste", lb: "Reajustes", v: String(k.reajustes), m: <>vencidos ou nos próximos 30 dias</>, acc: "var(--f-warn)" },
    { k: "vencendo", lb: "Vigência", v: String(k.vencendo + k.vencidos), m: <><b>{k.vencendo}</b> vencem em 60 dias · <b>{k.vencidos}</b> vencidos</>, acc: "var(--f-warn)" },
  ];
  const ctrAberto = aberto ? p.contratos.find((c) => c.id === aberto) ?? null : null;

  return (
    <div className="ctr">
      <section className="kpis">
        {K.map((x) => (
          <button key={x.lb} type="button" className={`kpi ${x.k ? "click" : ""} ${kpi && kpi === x.k ? "active" : ""}`}
            onClick={() => x.k && setKpi(kpi === x.k ? null : x.k)}>
            <span className="accent" style={{ background: x.acc }} />
            <div className="lb">{x.lb}</div><div className="v mono">{x.v}</div><div className="m">{x.m}</div>
          </button>
        ))}
      </section>

      <Calendario p={p} abrir={setAberto} />

      {gerados.length > 0 && (
        <div className="panel" style={{ marginBottom: 14 }}>
          <h3>OS geradas nesta sessão — próximo passo: {tipoOs === "nfse" ? "registrar a NFS-e emitida na prefeitura" : "emitir o recibo"}</h3>
          <div className="ctr-ger">
            {gerados.map((g) => (
              <div key={g.id} className="ctr-g">
                <b>{g.label}</b> <span className="orig">contrato {g.contrato}</span>
                {tipoOs === "nfse"
                  ? <button className="btn sm" onClick={() => registrarNfse([`venda:${g.id}`])}>Registrar NFS-e</button>
                  : <button className="btn sm pri" disabled={ocupado === `e:${g.id}`} onClick={() => emitirRecibo(g)}>{ocupado === `e:${g.id}` ? "Emitindo…" : "Emitir recibo"}</button>}
                <button className="btn sm ghost" onClick={() => setGerados((x) => x.filter((y) => y.id !== g.id))}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="filters">
        <div className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contrato, cliente, CNPJ, projeto…" />
        </div>
        <select className="sel" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Status: todos</option><option value="ativo">Ativos</option><option value="suspenso">Suspensos</option>
          <option value="encerrado">Encerrados</option><option value="rascunho">Rascunho</option>
        </select>
        <select className="sel" value={fPer} onChange={(e) => setFPer(e.target.value)}>
          <option value="">Periodicidade: todas</option>
          {Object.entries(PER).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span style={{ marginLeft: "auto" }} />
        {admin && <button className="btn sm" disabled={ocupado === "imp"} onClick={importar} title="Relê o espelho do Omie (transição) — não escreve no Omie">{ocupado === "imp" ? "Relendo…" : "Reler do Omie"}</button>}
        <button className="btn sm pri" onClick={() => setEditar("novo")}>+ Novo contrato</button>
      </div>

      {sel.size > 0 && (
        <div className="bulk">
          <span><b>{sel.size}</b> competência(s) selecionada(s)</span>
          <span style={{ marginLeft: "auto" }} />
          <button className="btn sm" onClick={() => setSel(new Set())}>Limpar</button>
          <button className="btn sm w" disabled={ocupado === "lote"} onClick={faturarLote}>{ocupado === "lote" ? "Gerando…" : "Faturar em lote"}</button>
        </div>
      )}

      <div className="tablebox">
        {!lista.length ? <div className="empty">Nenhum contrato com esses filtros.</div> : (
          <table className="fl">
            <thead><tr>
              <th style={{ width: 34 }} onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="cb" checked={lista.flatMap(devidas).length > 0 && lista.flatMap((c) => devidas(c).map((x) => `${c.id}|${x.competencia}`)).every((x) => sel.has(x))}
                  onChange={(e) => { const n = new Set(sel); lista.forEach((c) => devidas(c).forEach((x) => (e.target.checked ? n.add(`${c.id}|${x.competencia}`) : n.delete(`${c.id}|${x.competencia}`)))); setSel(n); }} />
              </th>
              <th>Contrato</th><th>Cliente</th><th>Periodicidade</th><th className="r">Valor</th><th>Vigência</th><th>Este mês</th><th>Reajuste</th><th className="r">Ações</th>
            </tr></thead>
            <tbody>
              {lista.map((c) => {
                const dv = devidas(c);
                return (
                  <tr key={c.id} className="row" onClick={() => setAberto(c.id)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      {dv.length > 0 && <input type="checkbox" className="cb" checked={dv.every((x) => sel.has(`${c.id}|${x.competencia}`))}
                        onChange={() => { const n = new Set(sel); const on = dv.every((x) => n.has(`${c.id}|${x.competencia}`)); dv.forEach((x) => (on ? n.delete(`${c.id}|${x.competencia}`) : n.add(`${c.id}|${x.competencia}`))); setSel(n); }} />}
                    </td>
                    <td>
                      <div className="doc"><span className="tag os">CT</span><b>{c.numero}</b></div>
                      <div className="orig">{c.origem === "omie" ? "importado do Omie" : "painel"}{c.status !== "ativo" && <> · <span className={`pill ${STC[c.status]}`} style={{ fontSize: 10.5 }}><i />{c.status}</span></>}</div>
                    </td>
                    <td><div className="cli" title={limpo(c.cliente ?? "")}>{limpo(c.cliente ?? "—")}<small>{c.projeto_nome ?? ""}</small></div></td>
                    <td>{PER[c.periodicidade] ?? `${c.periodicidade} meses`}<div className="orig">dia {c.dia}{c.mes_seguinte ? " · mês seguinte" : ""}</div></td>
                    <td className="r mono">{fmt(c.valor)}{c.periodicidade > 1 && <div className="orig">{fmt(c.mensal)}/mês</div>}</td>
                    <td>{dataBR(c.vig_inicio)} → {dataBR(c.vig_fim)}
                      {c.vencido && <div className="flag bad">vigência vencida</div>}{c.vencendo && <div className="flag">vence em breve</div>}</td>
                    <td>{c.mes ? <><span className={`pill ${SIT[c.mes].c}`}><i />{SIT[c.mes].l}</span><div className="orig">{comp(c.mes_competencia)} · {dataBR(c.mes_data)}</div></>
                      : <span className="orig">{c.status === "ativo" ? `próx. ${dataBR(c.proxima)}` : "—"}</span>}
                      {c.atrasadas > 1 && <div className="flag bad">{c.atrasadas} competências atrasadas</div>}</td>
                    <td>{c.proximo_reajuste ? <span style={{ color: c.reajuste_proximo ? "var(--f-warn)" : "var(--f-tx2)" }}>{dataBR(c.proximo_reajuste)}</span> : <span className="orig">—</span>}
                      {c.indice && <div className="orig">{c.indice}</div>}</td>
                    <td onClick={(e) => e.stopPropagation()}><div className="rowact">
                      {/* OS gerada (07/10/26): as duas saídas sempre à mão — recibo emitido aqui, ou NFS-e emitida na prefeitura e registrada aqui com o PDF */}
                      {c.competencias.filter((x) => x.situacao === "gerado" && x.venda_id).slice(0, 1).map((x) => (
                        <span key={`g${x.competencia}`} style={{ display: "inline-flex", gap: 6 }}>
                          <button className={`btn sm ${(c.tipo_documento ?? tipoOs) === "nfse" ? "" : "pri"}`} disabled={ocupado === `e:${x.venda_id}`}
                            title={`Emite o recibo da ${x.documento ?? "OS"} (${comp(x.competencia)}) — não passa pela SEFAZ`}
                            onClick={() => emitirRecibo({ label: x.documento ?? `OS ${comp(x.competencia)}`, id: Number(x.venda_id) })}>
                            {ocupado === `e:${x.venda_id}` ? "Emitindo…" : "Emitir recibo"}</button>
                          <button className={`btn sm ${(c.tipo_documento ?? tipoOs) === "nfse" ? "pri" : ""}`}
                            title={`NFS-e emitida no portal da prefeitura: registre aqui o número e anexe o PDF/XML (${x.documento ?? ""})`}
                            onClick={() => registrarNfse([`venda:${x.venda_id}`])}>Registrar NFS-e</button>
                        </span>
                      ))}
                      {dv.slice(0, 1).map((x) => (
                        <button key={x.competencia} className={`btn sm ${x.situacao === "atrasado" ? "danger" : "pri"}`} disabled={ocupado === `f:${c.id}:${x.competencia}`}
                          onClick={() => faturar(c, x.competencia)}>{ocupado === `f:${c.id}:${x.competencia}` ? "Gerando…" : `Faturar ${comp(x.competencia)}`}</button>
                      ))}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td /><td colSpan={3}>{lista.length} contratos</td><td className="r mono">{fmt(lista.reduce((a, c) => a + Number(c.mensal), 0))}/mês</td><td colSpan={4} /></tr></tfoot>
          </table>
        )}
      </div>
      <p style={{ color: "var(--f-tx3)", fontSize: 12, marginTop: 10 }}>
        Competência = mês do serviço; a data de faturamento é o dia do contrato (no mês seguinte, quando marcado). Faturar gera a OS nativa com os itens do contrato e “REFERENTE AO MÊS DE …”;
        a OS aparece na carteira (aba PV &amp; OS) para {tipoOs === "nfse" ? "registrar a NFS-e" : "emitir o recibo"}. Uma competência só fatura uma vez.
        Contratos importados do Omie em 05/10/2026 (espelho de 02/10); o Omie não é mais lido de forma contínua — desligue lá a geração automática de OS dos contratos para não duplicar.
      </p>

      {ctrAberto && <Gaveta c={ctrAberto} fechar={() => setAberto(null)} faturar={faturar} ocupado={ocupado} avisar={avisar} post={post}
        emitirRecibo={emitirRecibo} registrarNfse={registrarNfse}
        onMudou={carregar} editar={() => { setEditar(ctrAberto); setAberto(null); }} />}
      {editar && <FormContrato empresa={empresa} c={editar === "novo" ? null : editar} fechar={() => setEditar(null)} post={post} avisar={avisar}
        feito={(id) => { setEditar(null); carregar(); if (id) setAberto(id); }} />}
    </div>
  );
}

// ── Calendário do mês: quem fatura em que dia ───────────────────────────────
function Calendario({ p, abrir }: { p: Painel; abrir: (id: number) => void }) {
  const hoje = new Date(p.hoje + "T12:00:00");
  const y = hoje.getFullYear(), m = hoje.getMonth();
  const ult = new Date(y, m + 1, 0).getDate();
  const por: Record<number, { c: Ctr; x: Comp }[]> = {};
  p.contratos.forEach((c) => c.competencias.forEach((x) => {
    const d = new Date(x.data_prevista + "T12:00:00");
    if (d.getFullYear() === y && d.getMonth() === m) (por[d.getDate()] ||= []).push({ c, x });
  }));
  const dias = Object.keys(por).map(Number).sort((a, b) => a - b);
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <h3>Faturamentos de {["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"][m]} · {dias.reduce((a, d) => a + por[d].length, 0)} competências</h3>
      <div className="ctr-cal">
        {Array.from({ length: ult }, (_, i) => i + 1).map((d) => {
          const l = por[d] ?? [];
          const hojeD = d === hoje.getDate();
          const val = l.reduce((a, z) => a + Number(z.c.valor), 0);
          return (
            <div key={d} className={`ctr-dia ${l.length ? "tem" : ""} ${hojeD ? "hoje" : ""}`}>
              <div className="n">{d}</div>
              {l.length > 0 && <div className="t mono">{fmtK(val)}</div>}
              <div className="ctr-dots">
                {l.slice(0, 8).map((z) => (
                  <i key={`${z.c.id}-${z.x.competencia}`} className={`sd ${z.x.situacao}`} title={`${z.c.numero} · ${limpo(z.c.cliente ?? "")} · ${SIT[z.x.situacao].l}`}
                    onClick={() => abrir(z.c.id)} />
                ))}
                {l.length > 8 && <span className="orig">+{l.length - 8}</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="legend" style={{ marginTop: 8 }}>
        {(["faturado", "gerado", "a_faturar", "atrasado"] as Sit[]).map((s) => <span key={s}><i className={`sd ${s}`} />{SIT[s].l}</span>)}
      </div>
    </div>
  );
}

// ── Gaveta do contrato ──────────────────────────────────────────────────────
function Gaveta({ c, fechar, faturar, ocupado, avisar, post, onMudou, editar, emitirRecibo, registrarNfse }: {
  c: Ctr; fechar: () => void; faturar: (c: Ctr, comp: string) => void; ocupado: string | null; avisar: (m: string) => void;
  emitirRecibo: (g: { label: string; id: number }) => Promise<void>; registrarNfse: (chaves: string[]) => void;
  post: (b: Record<string, unknown>) => Promise<Record<string, unknown> & { error?: string }>; onMudou: () => void; editar: () => void;
}) {
  const [d, setD] = useState<Detalhe | null>(null);
  const [reaj, setReaj] = useState(false);
  const [rj, setRj] = useState({ desde: new Date().toISOString().slice(0, 8) + "01", valor: "", indice: "", obs: "" });
  const carregar = useCallback(() => {
    fetch(`/api/faturamento/contratos?id=${c.id}`, { cache: "no-store" }).then((x) => x.json()).then((j) => (j.error ? avisar(j.error) : setD(j))).catch((e) => avisar(String(e)));
  }, [c.id, avisar]);
  useEffect(() => { carregar(); }, [carregar]);

  async function status(s: string) {
    const motivo = s === "ativo" ? "" : window.prompt(`Motivo para ${s === "suspenso" ? "suspender" : "encerrar"} o contrato ${c.numero}:`) ?? "";
    if (s !== "ativo" && motivo.trim().length < 5) return;
    const r = await post({ acao: "status", id: c.id, status: s, motivo });
    if (r.error) avisar(r.error); else { avisar(`Contrato ${c.numero}: ${s}`); onMudou(); carregar(); }
  }
  async function desfazer(compId: number, rot: string) {
    const motivo = window.prompt(`Desfazer a competência (${rot})? A OS gerada é cancelada se ainda estiver aberta. Motivo:`) ?? "";
    if (motivo.trim().length < 5) return;
    const r = await post({ acao: "desfazer", comp_id: compId, motivo });
    if (r.error) avisar(r.error); else { avisar("Competência desfeita"); onMudou(); carregar(); }
  }
  const [corrigindo, setCorrigindo] = useState<number | null>(null);
  async function atualizarOs(h: Detalhe["historico_faturas"][number]) {
    if (!window.confirm(`Atualizar a ${h.documento} com o valor atual do contrato (${fmt(c.valor)})?\n\nA OS ainda não foi faturada: os itens passam a ser os do contrato e as parcelas são recalculadas. Depois emita o recibo.`)) return;
    setCorrigindo(h.id);
    const r = await post({ acao: "atualizar_os", id: c.id, comp_id: h.id });
    setCorrigindo(null);
    if (r.error) { avisar(r.error); return; }
    avisar(`${r.documento}: ${fmt(Number(r.de))} → ${fmt(Number(r.para))}. Agora clique em “Emitir recibo”.`);
    onMudou(); carregar();
  }
  async function corrigirRecibo(h: Detalhe["historico_faturas"][number]) {
    const num = h.emissao?.numero ?? "";
    if (!window.confirm(`Cancelar o recibo nº ${num} (${fmt(Number(h.valor))}) da ${h.documento} e corrigir a OS para ${fmt(c.valor)}?\n\n` +
      `• O recibo nº ${num} fica CANCELADO (o número não é reaproveitado; o novo recibo sai com o próximo número).\n` +
      `• O título REC ${num} sai do Contas a receber.\n• A ${h.documento} volta a “aberta” com o valor do contrato.\n\n` +
      `Depois é só clicar em “Emitir recibo” e enviar ao cliente.`)) return;
    const motivo = window.prompt("Motivo do cancelamento (fica no histórico):", Number(h.valor) > 0 ? "Recibo com valor errado — reemitido com o valor do contrato" : "Recibo saiu com valor zerado — reemitido com o valor do contrato");
    if (motivo == null) return;
    setCorrigindo(h.id);
    const r = await post({ acao: "corrigir_recibo", id: c.id, comp_id: h.id, motivo });
    setCorrigindo(null);
    if (r.error) { avisar(r.error); onMudou(); carregar(); return; }
    avisar(`${r.recibo_cancelado ? `Recibo nº ${r.recibo_cancelado} cancelado. ` : ""}${r.documento}: ${fmt(Number(r.de))} → ${fmt(Number(r.para))}. Agora clique em “Emitir recibo” para gerar o recibo certo.`);
    onMudou(); carregar();
  }
  async function reajustar() {
    const valor = numBR(rj.valor);
    if (!(valor > 0)) { avisar(`Não entendi o novo valor “${rj.valor}”. Digite só o número, por exemplo 2.720,64 ou 2720,64.`); return; }
    const r = await post({ acao: "reajustar", id: c.id, desde: rj.desde, valor, indice: rj.indice, obs: rj.obs });
    if (r.error) avisar(r.error); else { avisar(`Reajuste registrado: novo valor ${fmt(Number(r.valor))}`); setReaj(false); onMudou(); carregar(); }
  }

  const dv = devidas(c);
  return (
    <>
      <div className="fpv-scrim" onClick={fechar} />
      <aside className="fpv-drawer">
        <div className="dh">
          <button className="x" onClick={fechar}>✕</button>
          <div style={{ fontSize: 12, color: "var(--f-tx3)" }}>Contrato recorrente · {c.empresa} · {c.origem === "omie" ? `importado do Omie${c.omie_codigo ? ` (${c.omie_codigo})` : ""}` : "painel"}</div>
          <h2><span className="tag os">CT</span>{c.numero} <span className={`pill ${STC[c.status]}`} style={{ fontSize: 11.5 }}><i />{c.status}</span></h2>
          <div className="c">{limpo(c.cliente ?? "—")}{c.cliente_doc ? ` · ${c.cliente_doc}` : ""}{c.projeto_nome ? <><br /><span style={{ color: "var(--f-tx3)" }}>{c.projeto_nome}</span></> : null}</div>
          <div className="dgrid">
            <div><span>Valor do período</span><b className="mono">{fmt(c.valor)}</b></div>
            <div><span>{PER[c.periodicidade] ?? "Período"} · dia {c.dia}</span><b>{c.mes_seguinte ? "mês seguinte" : "no mês"}</b></div>
            <div><span>Vigência</span><b style={{ fontSize: 13 }}>{dataBR(c.vig_inicio)} → {dataBR(c.vig_fim)}</b></div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button className="btn sm" onClick={editar}>Editar</button>
            <button className="btn sm" onClick={() => setReaj((v) => !v)}>Registrar reajuste</button>
            {c.status === "ativo"
              ? <><button className="btn sm ghost" onClick={() => status("suspenso")}>Suspender</button><button className="btn sm ghost" onClick={() => status("encerrado")}>Encerrar</button></>
              : <button className="btn sm" onClick={() => status("ativo")}>Reativar</button>}
          </div>
        </div>
        <div className="db">
          {!(c.valor > 0) && <div className="alert bad">Este contrato está com valor <b>R$ 0,00</b> — a OS e o recibo sairiam sem preço. Clique em <b>Editar</b>, informe o valor do serviço (ex.: 2.720,64) e grave.</div>}
          {d && d.historico_faturas.filter((h) => h.origem === "painel" && h.venda_id && !h.nfse && (!(Number(h.valor) > 0) || (h.status === "gerado" && Math.abs(Number(h.valor) - c.valor) > 0.005))).map((h) => (
            <div key={`z${h.id}`} className="alert bad">
              <b>{h.documento}</b> ({comp(h.competencia)}) {h.emissao?.status === "autorizada" ? <>saiu com o recibo nº <b>{h.emissao.numero}</b> de </> : <>está com </>}<b>{fmt(Number(h.valor))}</b>
              {c.valor > 0 ? <> — o contrato hoje vale <b>{fmt(c.valor)}</b>.</> : <> — corrija primeiro o valor do contrato (Editar).</>}
              {c.valor > 0 && <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                {h.emissao?.status === "autorizada" && h.emissao.tipo === "recibo"
                  ? <button className="btn sm pri" disabled={corrigindo === h.id} onClick={() => corrigirRecibo(h)}>{corrigindo === h.id ? "Corrigindo…" : `Cancelar recibo nº ${h.emissao.numero} e corrigir a ${h.documento}`}</button>
                  : h.status === "gerado" && <button className="btn sm pri" disabled={corrigindo === h.id} onClick={() => atualizarOs(h)}>{corrigindo === h.id ? "Atualizando…" : `Atualizar ${h.documento} para ${fmt(c.valor)}`}</button>}
              </div>}
            </div>
          ))}
          {c.vencido && <div className="alert bad">Vigência terminou em {dataBR(c.vig_fim)} — renove (Editar) ou encerre o contrato.</div>}
          {c.reajuste_proximo && <div className="alert">Reajuste {c.proximo_reajuste && c.proximo_reajuste < (new Date().toISOString().slice(0, 10)) ? "vencido desde" : "previsto para"} {dataBR(c.proximo_reajuste)}{c.indice ? ` (${c.indice})` : ""}.</div>}
          {reaj && (
            <div className="panel" style={{ margin: "8px 0" }}>
              <h3>Reajuste</h3>
              <div className="ctr-form">
                <label>Vigente desde (competência)<input type="date" value={rj.desde} onChange={(e) => setRj({ ...rj, desde: e.target.value })} /></label>
                <label>Novo valor do período<input value={rj.valor} placeholder={c.valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} inputMode="decimal" onChange={(e) => setRj({ ...rj, valor: e.target.value })} /></label>
                <label>Índice<input value={rj.indice} placeholder="IPCA, IGP-M, negociado…" onChange={(e) => setRj({ ...rj, indice: e.target.value })} /></label>
                <label className="w">Observação<input value={rj.obs} onChange={(e) => setRj({ ...rj, obs: e.target.value })} /></label>
              </div>
              <div style={{ marginTop: 8 }}><button className="btn sm pri" onClick={reajustar}>Gravar reajuste</button> <span className="orig">Os itens são reajustados na mesma proporção; o histórico fica guardado.</span></div>
            </div>
          )}

          <h4>Competências</h4>
          <table className="it">
            <thead><tr><th>Competência</th><th>Fatura em</th><th>Situação</th><th>Documento</th><th className="r" /></tr></thead>
            <tbody>
              {c.competencias.slice().reverse().map((x) => (
                <tr key={x.competencia}>
                  <td>{comp(x.competencia)}</td><td>{dataBR(x.data_prevista)}</td>
                  <td><span className={`pill ${SIT[x.situacao].c}`}><i />{SIT[x.situacao].l}</span></td>
                  <td>{x.documento ?? "—"}</td>
                  <td className="r">
                    {(x.situacao === "a_faturar" || x.situacao === "atrasado" || x.situacao === "futuro") && c.status === "ativo" &&
                      <button className={`btn sm ${x.situacao === "atrasado" ? "danger" : x.situacao === "futuro" ? "ghost" : "pri"}`} disabled={ocupado === `f:${c.id}:${x.competencia}`}
                        onClick={() => faturar(c, x.competencia)}>Faturar</button>}
                    {x.situacao === "gerado" && x.comp_id && x.venda_id && <button className="btn sm ghost" onClick={() => desfazer(x.comp_id!, `${comp(x.competencia)} · ${x.documento}`)}>Desfazer</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!dv.length && c.status === "ativo" && <div className="orig" style={{ marginTop: 6 }}>Nada pendente. Próximo faturamento: {dataBR(c.proxima)}.</div>}

          <h4>Itens</h4>
          {!d ? <div className="orig">Carregando…</div> : (
            <table className="it">
              <thead><tr><th>Serviço</th><th className="r">Qtd</th><th className="r">Unit.</th><th className="r">Total</th></tr></thead>
              <tbody>{d.itens.map((it) => (
                <tr key={it.id ?? it.seq}><td>{limpo(it.descricao)}<div style={{ fontSize: 11, color: "var(--f-tx3)" }}>{it.lc116 ? `LC116 ${it.lc116}` : ""}{it.cod_serv_munic ? ` · mun. ${it.cod_serv_munic}` : ""}{it.retem_iss ? " · ISS retido" : ""}</div></td>
                  <td className="r mono">{Number(it.quantidade)}</td><td className="r mono">{fmt(Number(it.valor_unitario))}</td><td className="r mono">{fmt(Number(it.valor_total))}</td></tr>
              ))}</tbody>
            </table>
          )}
          <div className="orig" style={{ marginTop: 6 }}>Condição: {c.condicao_desc ?? c.condicao ?? "—"} · Documento: {c.tipo_documento ?? "padrão da empresa"}</div>
          {c.observacoes && <div className="orig">Obs.: {c.observacoes}</div>}

          {d && d.reajustes.length > 0 && (<>
            <h4>Reajustes</h4>
            <table className="it"><tbody>{d.reajustes.map((r) => (
              <tr key={r.id}><td>{comp(r.vigente_desde)}</td><td className="r mono">{fmt(Number(r.valor_anterior))} → {fmt(Number(r.valor_novo))}</td>
                <td className="r mono">{r.percentual != null ? `${Number(r.percentual).toFixed(2).replace(".", ",")}%` : ""}</td>
                <td className="orig">{r.indice ?? (r.origem === "omie" ? "inferido do histórico" : "")}</td></tr>
            ))}</tbody></table>
          </>)}

          {d && (<>
            <h4>Histórico de faturamento ({d.historico_faturas.length})</h4>
            <table className="it"><tbody>{d.historico_faturas.slice(0, 36).map((h) => (
              <tr key={h.id}><td>{comp(h.competencia)}</td>
                <td>{h.documento ?? "—"}{h.recibo ? <span className="orig"> · recibo {h.recibo}</span> : null}
                  {/* documentos (07/10/26): abrir o recibo / a NFS-e; tentativa que falhou aparece com o motivo */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                    {h.emissao?.pdf_path && <a className="btn sm" href={`/api/faturamento/recibo-pdf?p=${encodeURIComponent(h.emissao.pdf_path)}`} target="_blank" rel="noreferrer">
                      Recibo{h.emissao.numero ? ` nº ${h.emissao.numero}` : ""} (PDF){h.emissao.ambiente === "homologacao" ? " · teste" : ""}</a>}
                    {h.nfse && <button className="btn sm" onClick={async () => {
                      const j = await fetch(`/api/faturamento/nfse/${h.nfse!.id}`, { cache: "no-store" }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
                      if (j.error) avisar(j.error); else if (j.pdf_url) window.open(j.pdf_url, "_blank"); else avisar(`NFS-e ${h.nfse!.numero} registrada sem PDF anexado`);
                    }}>NFS-e nº {h.nfse.numero}{h.nfse.tem_pdf ? " (PDF)" : " · sem PDF"}</button>}
                    {h.origem === "painel" && h.venda_id && !h.nfse && h.emissao?.status === "autorizada" && h.emissao.tipo === "recibo" && h.emissao.ambiente === "producao" && Number(h.valor) > 0 &&
                      <button className="btn sm ghost" disabled={corrigindo === h.id} title="Valor errado no recibo? Cancela este recibo (o número não volta), tira o título do Contas a receber e põe na OS o valor atual do contrato — depois emita de novo"
                        onClick={() => corrigirRecibo(h)}>{corrigindo === h.id ? "Corrigindo…" : "Cancelar recibo e corrigir"}</button>}
                    {h.status === "gerado" && h.venda_id && !h.nfse && h.emissao?.status !== "autorizada" && (<>
                      {h.emissao && ["erro", "rejeitada"].includes(h.emissao.status) && <span className="flag bad" title={h.emissao.mensagem ?? ""}>
                        recibo não saiu ({dataBR(h.emissao.em)}): {(h.emissao.mensagem ?? h.emissao.status).slice(0, 80)}</span>}
                      <button className="btn sm pri" disabled={ocupado === `e:${h.venda_id}`} onClick={async () => { await emitirRecibo({ label: h.documento ?? "OS", id: Number(h.venda_id) }); carregar(); }}>
                        {ocupado === `e:${h.venda_id}` ? "Emitindo…" : h.emissao ? "Emitir recibo de novo" : "Emitir recibo"}</button>
                      <button className="btn sm" onClick={() => { registrarNfse([`venda:${h.venda_id}`]); fechar(); }}>Registrar NFS-e (prefeitura)</button>
                    </>)}
                  </div></td>
                <td>{dataBR(h.data)}</td><td className="r mono">{fmt(Number(h.valor))}</td><td className="orig">{h.origem === "omie" ? "Omie" : "painel"}</td></tr>
            ))}</tbody></table>
          </>)}

          {d && d.log.length > 0 && (<>
            <h4>Registro</h4>
            {d.log.slice(0, 20).map((l, i) => <div key={i} className="orig">{new Date(l.em).toLocaleString("pt-BR")} · {l.por ?? "—"} · {textoLog(l)}</div>)}
          </>)}
        </div>
      </aside>
    </>
  );
}

// ── Novo / editar contrato ──────────────────────────────────────────────────
function FormContrato({ empresa, c, fechar, post, avisar, feito }: {
  empresa: string; c: Ctr | null; fechar: () => void; avisar: (m: string) => void; feito: (id: number | null) => void;
  post: (b: Record<string, unknown>) => Promise<Record<string, unknown> & { error?: string }>;
}) {
  const [op, setOp] = useState<Opcoes | null>(null);
  const [cli, setCli] = useState<{ codigo: number; nome: string } | null>(c?.cliente_codigo ? { codigo: c.cliente_codigo, nome: c.cliente ?? "" } : null);
  const [f, setF] = useState({
    numero: c?.numero ?? "", vig_inicio: c?.vig_inicio ?? "", vig_fim: c?.vig_fim ?? "", periodicidade_meses: String(c?.periodicidade ?? 1),
    dia_faturamento: String(c?.dia ?? 1), fatura_mes_seguinte: c?.mes_seguinte ?? true, condicao_codigo: c?.condicao ?? "", projeto_codigo: c?.projeto ?? "",
    categoria_codigo: "", tipo_documento: c?.tipo_documento ?? "", indice_reajuste: c?.indice ?? "", proximo_reajuste: c?.proximo_reajuste ?? "",
    observacoes: c?.observacoes ?? "",
  });
  const [itens, setItens] = useState<Item[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  // OS geradas por este contrato e ainda não faturadas (podem receber o valor novo ao gravar)
  const [abertas, setAbertas] = useState<{ documento: string | null; valor: number }[]>([]);
  const [aplicarOs, setAplicarOs] = useState(true);
  const [gravado, setGravado] = useState<{ id: number; numero: string; valor: number; mudancas: string[]; registro: boolean;
    os_atualizadas: { documento: string; de: number; para: number }[]; os_erros: string[];
    zerados: { comp_id: number; documento: string | null; recibo: string | null }[] } | null>(null);

  useEffect(() => {
    fetch(`/api/vendas/opcoes?emp=${empresa}`, { cache: "no-store" }).then((x) => x.json()).then((j) => setOp(j)).catch(() => null);
    if (c) {
      fetch(`/api/faturamento/contratos?id=${c.id}`, { cache: "no-store" }).then((x) => x.json()).then((j) => {
        if (j.error) return;
        // valor no formato brasileiro (2.720,64) — o campo aceita 2.720,64, 2720,64 ou 2720.64
        setItens(((j.itens ?? []) as Item[]).map((i) => ({ ...i, valor_unitario: Number(i.valor_unitario).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) as unknown as number })));
        setF((s) => ({ ...s, categoria_codigo: String(j.contrato?.categoria_codigo ?? "") }));
        setAbertas(((j.historico_faturas ?? []) as Detalhe["historico_faturas"])
          .filter((h) => h.origem === "painel" && h.status === "gerado" && h.venda_id && !h.nfse && h.emissao?.status !== "autorizada")
          .map((h) => ({ documento: h.documento, valor: Number(h.valor) })));
      }).catch(() => null);
    } else setItens([{ descricao: "VISITA CONTRATUAL PERIÓDICA - TRATAMENTO DE ÁGUA", lc116: "7.15", cod_serv_munic: "", quantidade: 1, valor_unitario: 0 }]);
  }, [empresa, c]);

  const total = itens.reduce((a, i) => a + (numBR(i.quantidade) || 0) * (numBR(i.valor_unitario) || 0), 0);
  const valorRuim = (i: Item) => String(i.valor_unitario ?? "").trim() !== "" && !Number.isFinite(numBR(i.valor_unitario));
  async function salvar() {
    setErroForm(null);
    if (!cli) { setErroForm("Escolha o cliente (campo Cliente, no topo)."); return; }
    // 09/10/26: antes "2.720,64" virava 0 sem aviso (CM180321 · OS4893 · recibo 4657 com R$ 0,00)
    const inval = validarItensContrato(itens);
    if (inval) { setErroForm(inval); return; }
    const muda = c && Math.abs(total - Number(c.valor)) > 0.005;
    if (muda && !window.confirm(`Gravar o contrato ${c!.numero} com o valor ${fmt(total)} (antes ${fmt(Number(c!.valor))})?` +
      (abertas.length ? `\n\n${aplicarOs ? "As OS ainda não faturadas também passam para o valor novo" : "As OS já geradas ficam com o valor antigo"}: ${abertas.map((a) => `${a.documento} (${fmt(a.valor)})`).join(", ")}.` : ""))) return;
    setSalvando(true);
    const r = await post({ acao: "salvar", aplicar_os: aplicarOs, contrato: {
      id: c?.id ?? null, empresa, cliente_codigo: cli.codigo, cliente_nome: cli.nome, ...f,
      itens: itens.map((i) => ({ ...i, quantidade: numBR(i.quantidade), valor_unitario: numBR(i.valor_unitario) })),
    } });
    setSalvando(false);
    if (r.error) { setErroForm(String(r.error)); return; }
    avisar(`Contrato ${r.numero} gravado — ${fmt(Number(r.valor))}`);
    setGravado(r as unknown as NonNullable<typeof gravado>);
  }
  const sair = () => (gravado ? feito(Number(gravado.id) || null) : fechar());
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <div className="fpv-scrim" onClick={sair} />
      <aside className="fpv-drawer">
        <div className="dh">
          <button className="x" onClick={sair}>✕</button>
          <h2>{c ? `Editar contrato ${c.numero}` : "Novo contrato recorrente"}</h2>
          {c && <div className="c">Valor atual: <b className="mono">{fmt(Number(c.valor))}</b> · altere o valor do serviço nos itens abaixo e clique em <b>Gravar contrato</b>.</div>}
          {c?.origem === "omie" && <div className="c">Importado do Omie: depois de editado aqui, a releitura do Omie não o sobrescreve mais.</div>}
        </div>
        <div className="db">
          {gravado && (
            <div className="panel" style={{ margin: "4px 0 12px", borderColor: "var(--f-ok)" }}>
              <h3 style={{ color: "var(--f-ok)" }}>✓ Contrato {gravado.numero} gravado — {fmt(Number(gravado.valor))}</h3>
              {gravado.mudancas.length > 0
                ? <ul style={{ margin: "4px 0 6px 18px", fontSize: 12.5 }}>{gravado.mudancas.map((m, i) => <li key={i}>{m}</li>)}</ul>
                : c && <div className="orig">Nada mudou em relação ao que estava gravado.</div>}
              {!gravado.registro && <div className="orig">O histórico “de → para” passa a ficar guardado no Registro quando o banco for atualizado (sql/160).</div>}
              {gravado.os_atualizadas.map((o) => <div key={o.documento} className="orig">✓ {o.documento}: {fmt(o.de)} → {fmt(o.para)} (ainda não faturada — emita o recibo)</div>)}
              {gravado.os_erros.map((e, i) => <div key={i} className="flag bad">{e}</div>)}
              {gravado.zerados.filter((z) => z.recibo).map((z) => (
                <div key={z.comp_id} className="alert bad" style={{ marginTop: 6 }}>O recibo nº <b>{z.recibo}</b> da <b>{z.documento}</b> já saiu com R$ 0,00. Feche este formulário e, no contrato, clique em <b>Cancelar recibo nº {z.recibo} e corrigir</b>; depois em <b>Emitir recibo</b>.</div>
              ))}
              <div style={{ marginTop: 8 }}><button className="btn sm pri" onClick={() => feito(Number(gravado.id) || null)}>Fechar e abrir o contrato</button></div>
            </div>
          )}
          <div className="ctr-form">
            <label className="w">Cliente
              {cli ? <div className="ctr-cli"><b>{limpo(cli.nome)}</b> <button className="btn sm ghost" onClick={() => setCli(null)}>trocar</button></div>
                : <BuscaPessoa empresa={empresa} valor="" onEscolher={(pp: PessoaOp) => setCli({ codigo: pp.codigo, nome: pp.razao })} placeholder="Nome, fantasia ou CNPJ" />}
            </label>
            <label>Número<input value={f.numero} onChange={set("numero")} placeholder={c ? "" : "vazio = próximo CT"} /></label>
            <label>Periodicidade<select value={f.periodicidade_meses} onChange={set("periodicidade_meses")}>
              {Object.entries(PER).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label>Início da vigência<input type="date" value={f.vig_inicio} onChange={set("vig_inicio")} /></label>
            <label>Fim da vigência<input type="date" value={f.vig_fim} onChange={set("vig_fim")} /></label>
            <label>Dia de faturamento<input type="number" min={1} max={31} value={f.dia_faturamento} onChange={set("dia_faturamento")} /></label>
            <label>Fatura<select value={f.fatura_mes_seguinte ? "1" : "0"} onChange={(e) => setF({ ...f, fatura_mes_seguinte: e.target.value === "1" })}>
              <option value="1">no mês seguinte à competência</option><option value="0">no próprio mês</option></select></label>
            <label>Condição de pagamento<select value={f.condicao_codigo} onChange={set("condicao_codigo")}>
              <option value="">—</option>{(op?.condicoes ?? []).map((x) => <option key={x.codigo} value={x.codigo}>{x.descricao}</option>)}</select></label>
            <label>Documento<select value={f.tipo_documento} onChange={set("tipo_documento")}>
              <option value="">padrão da empresa</option><option value="recibo">Recibo</option><option value="nfse">NFS-e (prefeitura)</option></select></label>
            <label className="w">Projeto<select value={f.projeto_codigo} onChange={set("projeto_codigo")}>
              <option value="">—</option>{(op?.projetos ?? []).map((x) => <option key={String(x.codigo)} value={String(x.codigo)}>{x.nome}</option>)}</select></label>
            <label className="w">Categoria<select value={f.categoria_codigo} onChange={set("categoria_codigo")}>
              <option value="">—</option>{(op?.categorias ?? []).map((x) => <option key={x.codigo} value={x.codigo}>{x.codigo} · {x.descricao}</option>)}</select></label>
            <label>Índice de reajuste<input value={f.indice_reajuste} onChange={set("indice_reajuste")} placeholder="IPCA, IGP-M…" /></label>
            <label>Próximo reajuste<input type="date" value={f.proximo_reajuste} onChange={set("proximo_reajuste")} /></label>
            <label className="w">Observações<input value={f.observacoes} onChange={set("observacoes")} /></label>
          </div>
          <h4>Itens (serviços)</h4>
          {itens.map((it, i) => (
            <div key={i} className="ctr-item">
              <input className="w" value={it.descricao} onChange={(e) => setItens(itens.map((x, k) => (k === i ? { ...x, descricao: e.target.value } : x)))} placeholder="Descrição (o “REFERENTE AO MÊS” é posto a cada fatura)" />
              <input value={it.lc116 ?? ""} onChange={(e) => setItens(itens.map((x, k) => (k === i ? { ...x, lc116: e.target.value } : x)))} placeholder="LC116" />
              <input value={String(it.quantidade)} onChange={(e) => setItens(itens.map((x, k) => (k === i ? { ...x, quantidade: Number(e.target.value) || 0 } : x)))} placeholder="Qtd" />
              <input value={String(it.valor_unitario)} inputMode="decimal" aria-invalid={valorRuim(it)} style={valorRuim(it) ? { borderColor: "var(--f-bad)" } : undefined}
                title={valorRuim(it) ? "Não entendi este valor — digite por exemplo 2.720,64 ou 2720,64" : "Valor do serviço no período (ex.: 2.720,64)"}
                onChange={(e) => setItens(itens.map((x, k) => (k === i ? { ...x, valor_unitario: e.target.value as unknown as number } : x)))} placeholder="Valor (ex.: 2.720,64)" />
              <button className="btn sm ghost" onClick={() => setItens(itens.filter((_, k) => k !== i))}>✕</button>
            </div>
          ))}
          <button className="btn sm" onClick={() => setItens([...itens, { descricao: "", lc116: "7.15", cod_serv_munic: "", quantidade: 1, valor_unitario: 0 }])}>+ item</button>
          {c && abertas.length > 0 && (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 13 }}>
              <input type="checkbox" checked={aplicarOs} onChange={(e) => setAplicarOs(e.target.checked)} style={{ marginTop: 3 }} />
              <span>Aplicar também às OS já geradas e ainda não faturadas: {abertas.map((a) => `${a.documento} (${fmt(a.valor)})`).join(", ")}
                <span className="orig" style={{ display: "block" }}>Recibo já emitido não muda por aqui: no contrato use “Cancelar recibo e corrigir”.</span></span>
            </label>
          )}
          {erroForm && <div className="alert bad" style={{ marginTop: 12 }}>{erroForm}</div>}
          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
            <button className="btn pri" disabled={salvando} onClick={salvar}>{salvando ? "Gravando…" : "Gravar contrato"}</button>
            <span className="mono" style={{ color: total > 0 ? undefined : "var(--f-bad)" }}>Total do período: <b>{fmt(total)}</b>{c && Math.abs(total - Number(c.valor)) > 0.005 ? <span className="orig"> (antes {fmt(Number(c.valor))})</span> : null}</span>
          </div>
        </div>
      </aside>
    </>
  );
}
