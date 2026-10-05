"use client";

/* Conferência do corte financeiro (05/10/26).
   A DRE e o saldo por conta passam a poder sair do razão bancário nativo:
   antes da data de corte = arquivo das movimentações do Omie (copiado para o
   painel); a partir dela = extrato OFX / Omie Cash + baixas feitas no painel.
   Esta tela põe os dois lado a lado para o Benny validar antes de trocar. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Aviso, BotaoTela, CabecalhoTela, Carregando, CampoData, ChipFiltro, GradeKpis, PaginaNavy,
  brl, cartao, ddmmaa, type Kpi,
} from "./KitTela";

type LinhaDre = { mes: string; ord: number; linha: string; omie: number | null; nativo: number | null; dif: number };
type Saldo = {
  empresa: string; cod_conta: number; conta: string; nativo: number | null; omie: number | null; omie_data: string | null;
  abertura: number | null; abertura_fonte: string; movimento: number | null; dif: number;
};
type Pos = { empresa: string; cod_cc: number; omie: number; nativo: number; dif: number };
type Dados = {
  corte: string; ativo: boolean; dre: LinhaDre[]; saldos: Saldo[]; pos_corte: Pos[];
  arquivo: { linhas: number; de: string; ate: string }; pode_editar: boolean;
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeMes = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
const ok = (v: number) => Math.abs(v) < 0.01;

const th: React.CSSProperties = { textAlign: "right", padding: "8px 12px", fontSize: 12, fontWeight: 600, color: "var(--ww-text-muted)", borderBottom: "1px solid var(--ww-border)", whiteSpace: "nowrap" };
const td: React.CSSProperties = { textAlign: "right", padding: "7px 12px", fontSize: 13, color: "var(--ww-text)", borderBottom: "1px solid var(--ww-border)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

function Dif({ v }: { v: number }) {
  return <span style={{ color: ok(v) ? "var(--ww-ok-text)" : "var(--ww-crit-text)", fontWeight: ok(v) ? 500 : 700 }}>{ok(v) ? "✓" : brl(v)}</span>;
}

export default function TelaConferenciaCorte() {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [meses, setMeses] = useState(3);
  const [mesSel, setMesSel] = useState<string>("");
  const [novoCorte, setNovoCorte] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch(`/api/bi/conferencia-corte?meses=${meses}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setD(j as Dados);
      setNovoCorte((j as Dados).corte);
    } catch (e) { setErro((e as Error).message); }
  }, [meses]);
  useEffect(() => { setD(null); carregar(); }, [carregar, refresh]);

  const mesesLista = useMemo(() => [...new Set((d?.dre ?? []).map((l) => l.mes))], [d]);
  const mesAtivo = mesSel && mesesLista.includes(mesSel) ? mesSel : mesesLista[0] ?? "";
  const dreMes = (d?.dre ?? []).filter((l) => l.mes === mesAtivo);

  async function post(corpo: object, msg: string) {
    setOcupado(true); setErro(null); setAviso(null);
    try {
      const r = await fetch("/api/bi/conferencia-corte", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setAviso(msg); setRefresh((n) => n + 1);
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(false); }
  }

  if (!d && !erro) return <PaginaNavy><Carregando texto="Comparando DRE e saldos…" /></PaginaNavy>;

  const difsDre = (d?.dre ?? []).filter((l) => !ok(l.dif)).length;
  const difsSaldo = (d?.saldos ?? []).filter((s) => s.omie !== null && !ok(s.dif)).length;
  const kpis: Kpi[] = d ? [
    { rotulo: "Data de corte", hero: true, valor: ddmmaa(d.corte), sub: d.ativo ? "razão nativo em uso no BI" : "ainda não trocado no BI — só conferência" },
    { rotulo: "Arquivo do Omie", valor: d.arquivo.linhas.toLocaleString("pt-BR"), sub: `movimentos de ${ddmmaa(d.arquivo.de)} a ${ddmmaa(d.arquivo.ate)}` },
    { rotulo: "DRE · linhas diferentes", valor: String(difsDre), sub: `em ${mesesLista.length} meses comparados`, subTom: difsDre ? "crit" : "ok" },
    { rotulo: "Saldos · contas diferentes", valor: String(difsSaldo), sub: `de ${d.saldos.length} contas`, subTom: difsSaldo ? "crit" : "ok" },
  ] : [];

  return (
    <PaginaNavy>
      <CabecalhoTela
        area="BI · Financeiro"
        titulo="Conferência do corte"
        sub={<>DRE e saldo por conta: <b>Omie</b> (extrato do Omie, como hoje) × <b>nativo</b> (arquivo do Omie até o corte + extrato OFX/Omie Cash e baixas do painel depois dele)</>}
        acoes={<BotaoTela onClick={() => setRefresh((n) => n + 1)} disabled={ocupado}>Recarregar</BotaoTela>}
      />
      {erro && <Aviso>{erro}</Aviso>}
      {aviso && <Aviso tone="ok">{aviso}</Aviso>}
      {d && <>
        <GradeKpis kpis={kpis} />

        {d.pode_editar && (
          <div style={{ ...cartao, padding: "12px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "var(--ww-text)", fontWeight: 600 }}>Data de corte</span>
            <CampoData valor={novoCorte} onChange={setNovoCorte} title="Data de corte" />
            <BotaoTela primario disabled={ocupado || !novoCorte || novoCorte === d.corte}
              onClick={() => post({ acao: "corte", data: novoCorte }, `Corte movido para ${ddmmaa(novoCorte)} — o Omie Cash passa a entrar no banco nativo a partir dessa data.`)}>
              Salvar corte
            </BotaoTela>
            <span style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>
              Antes do corte vale o arquivo do Omie; depois dele, só o que entrar no painel (OFX, Omie Cash, baixas). Mudar o corte não mexe nas telas do BI.
            </span>
          </div>
        )}

        <section style={{ ...cartao, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--ww-border)" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ww-text)", marginRight: 8 }}>DRE realizada</span>
            {mesesLista.map((m) => (
              <ChipFiltro key={m} ativo={m === mesAtivo} onClick={() => setMesSel(m)}>
                {nomeMes(m)}{(d.dre.filter((l) => l.mes === m && !ok(l.dif)).length ? " ·  ≠" : " · ✓")}
              </ChipFiltro>
            ))}
            <span style={{ flex: 1 }} />
            {[3, 6, 12].map((n) => <ChipFiltro key={n} ativo={meses === n} onClick={() => setMeses(n)}>{n} meses</ChipFiltro>)}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th style={{ ...th, textAlign: "left" }}>Linha</th><th style={th}>Omie (hoje)</th><th style={th}>Nativo</th><th style={th}>Diferença</th></tr></thead>
              <tbody>
                {dreMes.map((l) => (
                  <tr key={l.ord}>
                    <td style={{ ...td, textAlign: "left", fontWeight: l.linha.startsWith("(") ? 600 : 400 }}>{l.linha.trim()}</td>
                    <td style={td}>{brl(l.omie ?? 0)}</td>
                    <td style={td}>{brl(l.nativo ?? 0)}</td>
                    <td style={td}><Dif v={l.dif} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section style={{ ...cartao, padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--ww-border)" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ww-text)" }}>Saldo por conta</span>
            <span style={{ fontSize: 12, color: "var(--ww-text-muted)", marginLeft: 10 }}>
              nativo = saldo de abertura no corte + movimentos nativos depois dele
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={{ ...th, textAlign: "left" }}>Conta</th><th style={th}>Omie (hoje)</th><th style={th}>Abertura no corte</th>
                <th style={th}>Movimento nativo</th><th style={th}>Nativo</th><th style={th}>Diferença</th>{d.pode_editar && <th style={th} />}
              </tr></thead>
              <tbody>
                {d.saldos.map((s) => (
                  <tr key={`${s.empresa}:${s.cod_conta}`}>
                    <td style={{ ...td, textAlign: "left" }}>{s.empresa} · {s.conta}</td>
                    <td style={td}>{s.omie === null ? "—" : brl(s.omie)}{s.omie_data && <span style={{ display: "block", fontSize: 11, color: "var(--ww-text-faint)" }}>{ddmmaa(s.omie_data)}</span>}</td>
                    <td style={td}>{brl(s.abertura ?? 0)}<span style={{ display: "block", fontSize: 11, color: "var(--ww-text-faint)" }}>{s.abertura_fonte}</span></td>
                    <td style={td}>{brl(s.movimento ?? 0)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{brl(s.nativo ?? 0)}</td>
                    <td style={td}>{s.omie === null ? "—" : <Dif v={s.dif} />}</td>
                    {d.pode_editar && (
                      <td style={td}>
                        <button type="button" disabled={ocupado} style={{ fontSize: 11.5, padding: "3px 10px", borderRadius: 999, border: "1px solid var(--ww-border-strong)", background: "transparent", color: "var(--ww-text-2)", cursor: "pointer" }}
                          onClick={() => {
                            const v = window.prompt(`Saldo de abertura de ${s.conta} (${s.empresa}) no corte. Vazio = voltar ao do Omie.`, String(s.abertura ?? ""));
                            if (v === null) return;
                            const n = v.trim() === "" ? null : Number(v.replace(/\./g, "").replace(",", "."));
                            if (n !== null && !Number.isFinite(n)) { setErro("Valor inválido"); return; }
                            post({ acao: "abertura", empresa: s.empresa, cod_cc: s.cod_conta, saldo: n }, "Saldo de abertura atualizado");
                          }}>abertura</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {!!d.pos_corte.length && (
          <section style={{ ...cartao, padding: "12px 16px" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ww-text)", marginBottom: 6 }}>Depois do corte · o que cada lado registrou</div>
            <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)", marginBottom: 8 }}>
              Diferença aqui = conta sem extrato nativo (importe o OFX) ou movimento só no Omie.
            </div>
            {d.pos_corte.map((p) => {
              const s = d.saldos.find((x) => x.empresa === p.empresa && x.cod_conta === p.cod_cc);
              return (
                <div key={`${p.empresa}:${p.cod_cc}`} style={{ display: "flex", gap: 12, fontSize: 13, padding: "4px 0", color: "var(--ww-text)" }}>
                  <span style={{ flex: 1 }}>{p.empresa} · {s?.conta ?? p.cod_cc}</span>
                  <span>Omie {brl(p.omie)}</span><span>Nativo {brl(p.nativo)}</span><Dif v={p.dif} />
                </div>
              );
            })}
          </section>
        )}
      </>}
    </PaginaNavy>
  );
}
