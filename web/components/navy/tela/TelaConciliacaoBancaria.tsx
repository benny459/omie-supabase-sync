"use client";

/**
 * Conciliação bancária (05/10/26, sql/52) — extrato OFX × títulos do painel.
 *
 * Fluxo: importar o OFX da conta (dedupe por FITID) → cada movimento mostra
 * sugestões (valor igual ao saldo do título — ou à soma de várias parcelas do
 * mesmo documento/contraparte, em grupo —, vencimento a ±3 dias, CNPJ ou nº
 * do documento no histórico) → "aceitar" casa com um clique; "casar à mão"
 * permite escolher 1..n títulos e repartir o valor (split) → casar = baixa do
 * título (pagar/receber). "Desfazer" estorna as baixas; "ignorar" é para
 * tarifas, transferências entre contas e afins (com motivo).
 *
 * Só títulos do painel entram aqui (previsões de PC e contas a receber
 * nascidas no painel); os do Omie continuam a ser baixados no Omie.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aviso, BotaoTela, CabecalhoTela, CampoData, Carregando, ChipFiltro, FaixaFiltros, GradeKpis, PaginaNavy,
  brl, cartao, ddmmaa, hojeISO, somaDias, type Kpi,
} from "./KitTela";
import { StatusPill, type Tom } from "../primitivos";

type Conta = { empresa: string; cod_cc: number; descricao: string; codigo_banco: string | null; numero_conta_corrente: string | null; tipo_conta_corrente: string | null };
type Sug = {
  natureza: "P" | "R"; titulo: string; contraparte: string | null; documento: string | null; vencimento: string | null; saldo: number; fase: string | null; score: number;
  /* Sugestão em grupo (sql/57): várias parcelas do mesmo documento/contraparte cuja soma bate com o movimento. */
  grupo?: boolean; itens?: { titulo: string; saldo: number; documento: string | null; vencimento: string | null; fase: string | null }[];
};
type BaixaMov = { id: number; natureza: string; titulo: string; documento: string | null; contraparte: string | null; valor: number };
type Mov = {
  id: number; data: string; valor: number; tipo: string | null; memo: string | null; nome: string | null; fitid: string;
  checknum: string | null; arquivo: string | null; casado: number; ignorado: boolean; ignorado_motivo: string | null;
  estado: "pendente" | "parcial" | "conciliado" | "ignorado"; baixas: BaixaMov[]; sugestoes: Sug[];
};
type Titulo = { natureza: "P" | "R"; titulo: string; contraparte: string | null; documento: string | null; vencimento: string | null; valor: number; valor_pago: number; saldo: number; fase: string | null };

const ESTADO: Record<Mov["estado"], { label: string; tom: Tom }> = {
  pendente: { label: "Pendente", tom: "warn" },
  parcial: { label: "Parcial", tom: "info" },
  conciliado: { label: "Conciliado", tom: "ok" },
  ignorado: { label: "Ignorado", tom: "off" },
};
const campo: React.CSSProperties = {
  padding: "6px 10px", borderRadius: 10, fontSize: 13, border: "1px solid var(--ww-border-strong)",
  background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
};
const pilula = (cor: string): React.CSSProperties => ({
  fontSize: 11.5, padding: "3px 10px", borderRadius: 999, cursor: "pointer", border: "1px solid var(--ww-border-strong)",
  background: "transparent", color: cor, whiteSpace: "nowrap",
});
const chaveConta = (c: { empresa: string; cod_cc: number }) => `${c.empresa}:${c.cod_cc}`;

export default function TelaConciliacaoBancaria() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [conta, setConta] = useState("");
  const [de, setDe] = useState(() => somaDias(hojeISO(), -30));
  const [ate, setAte] = useState(hojeISO());
  const [movs, setMovs] = useState<Mov[] | null>(null);
  const [titulos, setTitulos] = useState<Titulo[]>([]);
  const [podeBaixar, setPodeBaixar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [estadoSel, setEstadoSel] = useState<Mov["estado"] | "">("pendente");
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [escolherConta, setEscolherConta] = useState<{ arquivo: File; candidatos: Conta[]; banco: string | null; conta: string | null } | null>(null);
  const inputArq = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/financeiro/ofx").then((r) => r.json()).then((j) => {
      if (j.error) { setErro(j.error); return; }
      const cs = (j.contas ?? []) as Conta[];
      setContas(cs);
      try {
        const g = localStorage.getItem("concil-conta");
        if (g && cs.some((c) => chaveConta(c) === g)) { setConta(g); return; }
      } catch { /* sem storage */ }
      const c6 = cs.find((c) => c.tipo_conta_corrente === "CC" && c.codigo_banco === "336") ?? cs.find((c) => c.tipo_conta_corrente === "CC");
      if (c6) setConta(chaveConta(c6));
    }).catch((e) => setErro((e as Error).message));
  }, []);

  const carregar = useCallback(async () => {
    if (!conta) return;
    const [empresa, cod] = conta.split(":");
    setErro(null);
    try {
      const r = await fetch(`/api/financeiro/conciliacao?empresa=${empresa}&cod_cc=${cod}&de=${de}&ate=${ate}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setMovs(j.movimentos ?? []); setTitulos(j.titulos ?? []); setPodeBaixar(!!j.pode_baixar);
    } catch (e) { setErro((e as Error).message); }
  }, [conta, de, ate]);
  useEffect(() => { setMovs(null); carregar(); }, [carregar, refresh]);
  useEffect(() => { try { if (conta) localStorage.setItem("concil-conta", conta); } catch { /* ok */ } }, [conta]);

  async function importar(arquivo: File, escolhida?: Conta) {
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      if (escolhida) { fd.append("empresa", escolhida.empresa); fd.append("cod_cc", String(escolhida.cod_cc)); }
      const r = await fetch("/api/financeiro/ofx", { method: "POST", body: fd });
      const j = await r.json();
      if (r.status === 409 && j.precisa_conta) {
        setEscolherConta({ arquivo, candidatos: (j.candidatos?.length ? j.candidatos : contas) as Conta[], banco: j.banco, conta: j.conta });
        return;
      }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setEscolherConta(null);
      setAviso(`${arquivo.name}: ${j.novos} lançamento(s) novo(s), ${j.duplicados} já existiam · ${j.conta.descricao} (${j.conta.empresa})`);
      const k = chaveConta(j.conta);
      if (j.de && j.de < de) setDe(j.de);
      if (j.ate && j.ate > ate) setAte(j.ate);
      if (k !== conta) setConta(k); else setRefresh((n) => n + 1);
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); if (inputArq.current) inputArq.current.value = ""; }
  }

  async function acao(corpo: object, ok: string) {
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const r = await fetch("/api/financeiro/conciliacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setAviso(ok); setRefresh((n) => n + 1);
      return true;
    } catch (e) { setErro((e as Error).message); return false; }
    finally { setOcupado(false); }
  }

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (movs ?? []).filter((m) => (!estadoSel || m.estado === estadoSel) &&
      (!t || `${m.memo ?? ""} ${m.nome ?? ""} ${m.valor} ${m.checknum ?? ""}`.toLowerCase().includes(t)));
  }, [movs, estadoSel, q]);

  const kpis: Kpi[] = useMemo(() => {
    const ms = movs ?? [];
    const soma = (f: (m: Mov) => boolean) => ms.filter(f).reduce((s, m) => s + Math.abs(m.valor), 0);
    const n = (e: Mov["estado"]) => ms.filter((m) => m.estado === e).length;
    return [
      { rotulo: "Entradas", valor: brl(soma((m) => m.valor > 0)), sub: `${ms.filter((m) => m.valor > 0).length} lançamentos` },
      { rotulo: "Saídas", valor: brl(soma((m) => m.valor < 0)), sub: `${ms.filter((m) => m.valor < 0).length} lançamentos` },
      { rotulo: "Pendentes", hero: true, valor: String(n("pendente") + n("parcial")), sub: brl(ms.filter((m) => m.estado === "pendente" || m.estado === "parcial").reduce((s, m) => s + Math.abs(m.valor) - m.casado, 0)) + " a casar" },
      { rotulo: "Conciliados", valor: String(n("conciliado")), sub: `${n("ignorado")} ignorados` },
    ];
  }, [movs]);

  const contaSel = contas.find((c) => chaveConta(c) === conta);

  return (
    <PaginaNavy>
      <CabecalhoTela
        area="Financeiro"
        titulo="Conciliação bancária"
        sub={<>Extrato OFX × títulos do painel · casar = baixa do título{contaSel ? ` · ${contaSel.descricao} (${contaSel.empresa})` : ""}</>}
        acoes={<>
          <input ref={inputArq} type="file" accept=".ofx,.OFX,application/x-ofx" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); }} />
          <BotaoTela primario disabled={ocupado} onClick={() => inputArq.current?.click()}>{ocupado ? "Aguarde…" : "Importar OFX"}</BotaoTela>
        </>}
      />

      <FaixaFiltros busca={q} onBusca={setQ} placeholder="Histórico, valor, documento…">
        <select value={conta} onChange={(e) => setConta(e.target.value)} style={campo} title="Conta corrente">
          {!conta && <option value="">Escolha a conta…</option>}
          {contas.map((c) => <option key={chaveConta(c)} value={chaveConta(c)}>{c.empresa} · {c.descricao}</option>)}
        </select>
        <CampoData valor={de} onChange={setDe} title="De" />
        <span style={{ color: "var(--ww-text-faint)", fontSize: 12 }}>→</span>
        <CampoData valor={ate} onChange={setAte} title="Até" />
        <ChipFiltro ativo={!estadoSel} onClick={() => setEstadoSel("")}>Todos</ChipFiltro>
        {(Object.keys(ESTADO) as Mov["estado"][]).map((k) => (
          <ChipFiltro key={k} ativo={estadoSel === k} onClick={() => setEstadoSel(estadoSel === k ? "" : k)}>
            {ESTADO[k].label} · {(movs ?? []).filter((m) => m.estado === k).length}
          </ChipFiltro>
        ))}
      </FaixaFiltros>

      {erro && <Aviso>{erro}</Aviso>}
      {aviso && <Aviso tone="ok">{aviso}</Aviso>}

      {escolherConta && (
        <div style={{ ...cartao, padding: 16 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ww-text)" }}>De que conta é este extrato?</div>
          <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)", margin: "4px 0 10px" }}>
            {escolherConta.arquivo.name} · banco {escolherConta.banco ?? "?"} · conta {escolherConta.conta ?? "?"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {escolherConta.candidatos.map((c) => (
              <button key={chaveConta(c)} type="button" disabled={ocupado} onClick={() => importar(escolherConta.arquivo, c)} style={pilula("var(--ww-text)")}>
                {c.empresa} · {c.descricao}
              </button>
            ))}
            <button type="button" onClick={() => setEscolherConta(null)} style={pilula("var(--ww-text-muted)")}>cancelar</button>
          </div>
        </div>
      )}

      {movs && <GradeKpis kpis={kpis} />}
      {!movs && !erro && conta && <Carregando />}
      {movs && !lista.length && (
        <div style={{ ...cartao, padding: 20, fontSize: 13, color: "var(--ww-text-muted)" }}>
          {movs.length ? "Nenhum movimento neste filtro." : "Nenhum movimento desta conta no período — importe o OFX do banco."}
        </div>
      )}

      {!!lista.length && (
        <div style={{ ...cartao, padding: 0, overflow: "hidden" }}>
          {lista.map((m) => (
            <LinhaMov key={m.id} m={m} titulos={titulos} aberto={aberto === m.id} podeBaixar={podeBaixar} ocupado={ocupado}
              onToggle={() => setAberto(aberto === m.id ? null : m.id)} acao={acao} />
          ))}
        </div>
      )}
    </PaginaNavy>
  );
}

function LinhaMov({ m, titulos, aberto, podeBaixar, ocupado, onToggle, acao }: {
  m: Mov; titulos: Titulo[]; aberto: boolean; podeBaixar: boolean; ocupado: boolean;
  onToggle: () => void; acao: (corpo: object, ok: string) => Promise<boolean>;
}) {
  const restante = Math.round((Math.abs(m.valor) - m.casado) * 100) / 100;
  const nat = m.valor < 0 ? "P" : "R";
  const [sel, setSel] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState("");
  const [motivo, setMotivo] = useState("");
  const [forcar, setForcar] = useState(false);
  const cands = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return titulos.filter((x) => x.natureza === nat && (!t || `${x.contraparte ?? ""} ${x.documento ?? ""} ${x.saldo}`.toLowerCase().includes(t))).slice(0, 40);
  }, [titulos, nat, busca]);
  const somaSel = Object.values(sel).reduce((s, v) => s + (Number(v.replace(",", ".")) || 0), 0);
  const selNaoLiberado = nat === "P" && Object.keys(sel).some((k) => titulos.find((x) => x.titulo === k && x.natureza === "P")?.fase !== "liberado");
  const top = m.sugestoes[0];

  return (
    <div style={{ borderBottom: "1px solid var(--ww-border)" }}>
      <div onClick={onToggle} style={{ display: "grid", gridTemplateColumns: "84px 1fr auto auto", gap: 12, alignItems: "center", padding: "10px 16px", cursor: "pointer" }}>
        <span style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>{ddmmaa(m.data)}</span>
        <span style={{ minWidth: 0 }}>
          <span style={{ fontSize: 13, color: "var(--ww-text)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {m.memo || m.nome || m.tipo || "—"}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>
            {m.nome && m.memo ? `${m.nome} · ` : ""}{m.checknum ? `doc ${m.checknum} · ` : ""}
            {m.estado === "ignorado" ? `ignorado: ${m.ignorado_motivo ?? ""}` :
              m.baixas.length ? m.baixas.map((b) => `${b.documento ?? b.titulo} (${brl(b.valor)})`).join(" + ") :
              top ? `sugestão: ${top.contraparte ?? ""} · ${top.documento ?? ""}` : "sem sugestão"}
          </span>
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: m.valor < 0 ? "var(--ww-crit-text)" : "var(--ww-ok-text)", textAlign: "right" }}>
          {m.valor < 0 ? "−" : "+"}{brl(Math.abs(m.valor))}
          {m.estado === "parcial" && <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--ww-text-faint)" }}>falta {brl(restante)}</span>}
        </span>
        <StatusPill tone={ESTADO[m.estado].tom}>{ESTADO[m.estado].label}</StatusPill>
      </div>

      {aberto && (
        <div style={{ padding: "4px 16px 14px 112px", display: "flex", flexDirection: "column", gap: 10 }}>
          {!!m.baixas.length && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>Casado com:</span>
              {m.baixas.map((b) => <span key={b.id} style={{ fontSize: 12, color: "var(--ww-text)" }}>{b.contraparte ?? ""} · {b.documento ?? b.titulo} · {brl(b.valor)}</span>)}
              <button type="button" disabled={ocupado} style={pilula("var(--ww-crit-text)")}
                onClick={() => acao({ acao: "desfazer", movimento_id: m.id, motivo: "Desfeito na tela de conciliação" }, "Conciliação desfeita — baixas estornadas")}>
                desfazer
              </button>
            </div>
          )}

          {m.estado !== "ignorado" && restante > 0.004 && podeBaixar && (<>
            {!!m.sugestoes.length && (
              <div>
                <div style={{ fontSize: 12, color: "var(--ww-text-muted)", marginBottom: 4 }}>Sugestões</div>
                {m.sugestoes.map((s) => {
                  const valor = Math.min(s.saldo, restante);
                  const naoLib = s.natureza === "P" && s.fase !== "liberado";
                  // Grupo: um movimento paga várias parcelas — aceitar já divide pelos saldos.
                  const itens = s.grupo && s.itens?.length
                    ? s.itens.map((i) => ({ titulo: i.titulo, valor: i.saldo }))
                    : [{ titulo: s.titulo, valor }];
                  return (
                    <div key={s.titulo} style={{ display: "flex", gap: 10, alignItems: "center", padding: "4px 0", fontSize: 12.5 }}>
                      <span style={{ color: "var(--ww-text)", flex: 1, minWidth: 0 }}>
                        {s.grupo && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ww-accent-text)" }}>GRUPO · </span>}
                        {s.contraparte ?? "—"} · {s.documento ?? ""} · venc. {ddmmaa(s.vencimento)} · {s.grupo ? "soma" : "saldo"} {brl(s.saldo)}
                        {s.grupo && s.itens && (
                          <span style={{ display: "block", fontSize: 11.5, color: "var(--ww-text-faint)" }}>
                            {s.itens.map((i) => `${i.documento ?? i.titulo} ${brl(i.saldo)}`).join(" + ")}
                          </span>
                        )}
                        {naoLib && <span style={{ color: "var(--ww-warn-text)" }}> · ainda não liberado ({s.fase})</span>}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--ww-text-faint)" }}>{s.score} pts</span>
                      <button type="button" disabled={ocupado || naoLib} title={naoLib ? "Use \"casar à mão\" com forçar + motivo" : undefined}
                        style={pilula("var(--ww-ok-text)")}
                        onClick={() => acao({ acao: "conciliar", movimento_id: m.id, itens },
                                            `Conciliado: ${s.contraparte ?? ""} ${brl(s.grupo ? s.saldo : valor)}${s.grupo ? ` em ${itens.length} títulos` : ""}`)}>
                        aceitar {brl(s.grupo ? s.saldo : valor)}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>Casar à mão ({nat === "P" ? "contas a pagar" : "contas a receber"} do painel)</span>
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="filtrar…" style={{ ...campo, padding: "3px 8px", fontSize: 12 }} />
              </div>
              {!cands.length && <div style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>Nenhum título do painel em aberto deste lado.</div>}
              {cands.map((x) => {
                const marcado = x.titulo in sel;
                return (
                  <label key={x.titulo} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0", fontSize: 12.5, color: "var(--ww-text)" }}>
                    <input type="checkbox" checked={marcado} onChange={(e) => {
                      const n = { ...sel };
                      if (e.target.checked) n[x.titulo] = Math.min(x.saldo, Math.max(restante - somaSel, 0)).toFixed(2); else delete n[x.titulo];
                      setSel(n);
                    }} />
                    <span style={{ flex: 1, minWidth: 0 }}>{x.contraparte ?? "—"} · {x.documento ?? ""} · venc. {ddmmaa(x.vencimento)} · saldo {brl(x.saldo)}{x.natureza === "P" && x.fase !== "liberado" ? ` · ${x.fase}` : ""}</span>
                    {marcado && <input value={sel[x.titulo]} onChange={(e) => setSel({ ...sel, [x.titulo]: e.target.value })} inputMode="decimal"
                      style={{ ...campo, width: 110, padding: "3px 8px", fontSize: 12 }} />}
                  </label>
                );
              })}
              {!!Object.keys(sel).length && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: Math.abs(somaSel - restante) < 0.005 ? "var(--ww-ok-text)" : "var(--ww-text-muted)" }}>
                    {brl(somaSel)} de {brl(restante)}
                  </span>
                  {selNaoLiberado && (<>
                    <label style={{ fontSize: 12, color: "var(--ww-warn-text)", display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={forcar} onChange={(e) => setForcar(e.target.checked)} /> forçar (título não liberado)
                    </label>
                    {forcar && <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="motivo" style={{ ...campo, padding: "3px 8px", fontSize: 12 }} />}
                  </>)}
                  <button type="button" disabled={ocupado || somaSel <= 0 || somaSel > restante + 0.004 || (selNaoLiberado && (!forcar || !motivo.trim()))}
                    style={pilula("var(--ww-ok-text)")}
                    onClick={async () => {
                      const itens = Object.entries(sel).map(([titulo, v]) => ({ titulo, valor: Number(v.replace(",", ".")), forcar: forcar && selNaoLiberado, ...(forcar && motivo.trim() ? { obs: motivo.trim() } : {}) }));
                      if (await acao({ acao: "conciliar", movimento_id: m.id, itens }, `Conciliado em ${itens.length} título(s)`)) { setSel({}); setForcar(false); setMotivo(""); }
                    }}>
                    conciliar selecionados
                  </button>
                </div>
              )}
            </div>
          </>)}
          {!podeBaixar && m.estado !== "conciliado" && <div style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>Sem permissão para baixar títulos — só visualização.</div>}

          {!m.baixas.length && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {m.ignorado ? (
                <button type="button" disabled={ocupado} style={pilula("var(--ww-text-muted)")}
                  onClick={() => acao({ acao: "reativar", movimento_id: m.id }, "Movimento reativado")}>reativar</button>
              ) : (<>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="motivo para ignorar (tarifa, transferência…)"
                  style={{ ...campo, padding: "3px 8px", fontSize: 12, width: 280 }} />
                <button type="button" disabled={ocupado || !motivo.trim()} style={pilula("var(--ww-text-muted)")}
                  onClick={() => acao({ acao: "ignorar", movimento_id: m.id, motivo }, "Movimento ignorado")}>ignorar</button>
              </>)}
            </div>
          )}
          <div style={{ fontSize: 11, color: "var(--ww-text-faint)" }}>FITID {m.fitid}{m.arquivo ? ` · ${m.arquivo}` : ""}</div>
        </div>
      )}
    </div>
  );
}
