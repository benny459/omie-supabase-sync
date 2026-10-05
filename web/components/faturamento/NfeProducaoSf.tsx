"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Aviso, BotaoTela, brl, cartao } from "@/components/navy/tela/KitTela";
import { limpo } from "@/lib/faturamento/montar";

/* NF-e mercantil em produção pelo painel (05/10/2026): prontidão (Focus,
   certificado A1, numeração, Omie desligado) e a fila dos PVs do Omie em
   aberto com Validar (pré-voo), Ensaio (homologação) e Emitir. */

type Pront = {
  empresa: string;
  config: { ambiente: string; producao_liberada: boolean; natureza_operacao: string; nfe_serie_producao: string; nfe_proximo_producao: number | null; omie_nfe_desligado_em: string | null };
  focus: { habilita_nfe?: boolean; certificado_valido_ate?: string; serie_nfe_producao?: string; proximo_numero_nfe_producao?: number; token_producao?: boolean } | null;
  focus_erro: string | null; token_producao_env: boolean;
  ultima_nfe_omie: { numero: string; serie: string; emissao: string } | null;
  conflito_numeracao: string | null; pode_mudar: boolean;
};
type Pv = { codigo_pedido: number; rotulo: string; etapa: string; cliente: string | null; valor_total: number; codigo_parcela: string | null; num_pedido_cliente: string | null };
type Checagem = { item: string; ok: boolean; nivel: "erro" | "aviso"; detalhe: string };
type Prevoo = { checagens: Checagem[]; payload: unknown; total: number; pode_emitir: boolean; ambiente: string; parcelas: { vencimento: string; valor: number }[] };

const ETAPA: Record<string, string> = { "10": "Proposta", "20": "Aprovado", "50": "Faturar" };
const td: CSSProperties = { padding: "9px 12px", verticalAlign: "top", color: "var(--ww-text)", fontSize: 13 };
const lk: CSSProperties = { background: "none", border: 0, color: "var(--ww-accent-text)", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "0 8px 0 0" };

function diasAte(iso?: string) {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function NfeProducaoSf({ empresa = "SF", onEmitido }: { empresa?: string; onEmitido?: () => void }) {
  const [p, setP] = useState<Pront | null>(null);
  const [pvs, setPvs] = useState<Pv[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<number | null>(null);
  const [pre, setPre] = useState<Record<number, Prevoo | { error: string }>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verPayload, setVerPayload] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch(`/api/faturamento/prontidao?empresa=${empresa}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/faturamento/pv-omie?empresa=${empresa}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (a.error) throw new Error(a.error);
      setP(a); setPvs(b.pvs ?? []);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }, [empresa]);
  useEffect(() => { carregar(); }, [carregar]);

  async function acao(pv: Pv, qual: "prevoo" | "ensaio" | "emitir") {
    if (qual === "emitir") {
      const prod = p?.config.ambiente === "producao" && p?.config.producao_liberada;
      const msg = prod
        ? `EMITIR NF-e DE PRODUÇÃO (documento fiscal real) do ${pv.rotulo} — ${limpo(pv.cliente)} — ${brl(pv.valor_total)}?\n\nNúmero: ${p?.config.nfe_proximo_producao} série ${p?.config.nfe_serie_producao}.`
        : `Emitir o ${pv.rotulo} em HOMOLOGAÇÃO (sem valor fiscal)?`;
      if (!window.confirm(msg)) return;
    }
    setOcupado(`${qual}:${pv.codigo_pedido}`);
    const r = await fetch("/api/faturamento/pv-omie", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa, codigo: pv.codigo_pedido, acao: qual }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcupado(null);
    if (qual === "prevoo") { setPre((m) => ({ ...m, [pv.codigo_pedido]: r })); setAberto(pv.codigo_pedido); return; }
    if (r.error) { setErro(`${pv.rotulo}: ${r.error}`); return; }
    const e = r.emissao;
    setErro(`${qual === "ensaio" ? "Ensaio (homologação)" : "Emissão"} #${e.id} do ${pv.rotulo}: ${e.status}${e.numero ? ` nº ${e.numero}` : ""}${e.mensagem ? ` — ${e.mensagem}` : ""}`);
    onEmitido?.();
    carregar();
  }

  async function omieDesligado(v: boolean) {
    const txt = v
      ? "Confirma que a emissão de NF-e da SF FOI DESLIGADA NO OMIE e que ninguém mais vai emitir NF-e da SF por lá?"
      : "Desfazer a confirmação (volta a bloquear a produção)?";
    if (!window.confirm(txt)) return;
    const r = await fetch("/api/faturamento/prontidao", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ empresa, omie_desligado: v }),
    }).then((x) => x.json());
    if (r.error) setErro(r.error); else carregar();
  }

  if (!p) return erro ? <Aviso>{erro}</Aviso> : null;
  const cert = diasAte(p.focus?.certificado_valido_ate);
  const prod = p.config.ambiente === "producao" && p.config.producao_liberada;
  const itens: { rot: string; ok: boolean; det: string }[] = [
    { rot: "Focus: NF-e habilitada", ok: !!p.focus?.habilita_nfe, det: p.focus_erro ?? (p.focus?.habilita_nfe ? "sim" : "não") },
    { rot: "Token de produção", ok: p.token_producao_env, det: p.token_producao_env ? "configurado na Vercel" : "falta FOCUS_TOKEN_" + empresa },
    { rot: "Certificado A1", ok: cert != null && cert > 0, det: p.focus?.certificado_valido_ate ? `vence ${new Date(p.focus.certificado_valido_ate).toLocaleDateString("pt-BR")} (${cert} dias)` : "—" },
    { rot: "Última NF-e no Omie", ok: true, det: p.ultima_nfe_omie ? `nº ${Number(p.ultima_nfe_omie.numero)} série ${Number(p.ultima_nfe_omie.serie)} em ${p.ultima_nfe_omie.emissao}` : "—" },
    { rot: "Próxima NF-e do painel", ok: !p.conflito_numeracao, det: p.conflito_numeracao ?? `nº ${p.config.nfe_proximo_producao} série ${p.config.nfe_serie_producao}` },
    { rot: "Omie desligado para NF-e", ok: !!p.config.omie_nfe_desligado_em, det: p.config.omie_nfe_desligado_em ? `confirmado em ${new Date(p.config.omie_nfe_desligado_em).toLocaleString("pt-BR")}` : "não confirmado" },
    { rot: "Chave de produção", ok: prod, det: prod ? "LIGADA — emite NF-e real" : "desligada (homologação)" },
  ];
  const lista = (pvs ?? []).filter((x) => !busca || `${x.rotulo} ${x.cliente} ${x.num_pedido_cliente}`.toLowerCase().includes(busca.toLowerCase()));

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {cert != null && cert <= 20 && (
        <Aviso tone={cert <= 7 ? "crit" : "warn"}>
          Certificado A1 da {empresa} vence em {cert} dia(s) ({new Date(p.focus!.certificado_valido_ate!).toLocaleDateString("pt-BR")}). Sem ele a Focus não emite: renove e envie o novo .pfx à Focus antes disso.
        </Aviso>
      )}
      {erro && <div onClick={() => setErro(null)}><Aviso tone="info">{erro}</Aviso></div>}
      <div style={{ ...cartao, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <b style={{ fontSize: 15 }}>NF-e mercantil {empresa} — prontidão para produção</b>
          <span style={{ fontSize: 12, fontWeight: 600, color: prod ? "#3FB68B" : "#E0A93B" }}>{prod ? "● PRODUÇÃO" : "● HOMOLOGAÇÃO"}</span>
          <span style={{ flex: 1 }} />
          {p.pode_mudar && (p.config.omie_nfe_desligado_em
            ? <BotaoTela onClick={() => omieDesligado(false)}>Desfazer "Omie desligado"</BotaoTela>
            : <BotaoTela onClick={() => omieDesligado(true)}>Confirmar: Omie desligado para NF-e</BotaoTela>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
          {itens.map((i) => (
            <div key={i.rot} style={{ fontSize: 12.5 }}>
              <span style={{ color: i.ok ? "#3FB68B" : "#E5484D", fontWeight: 700 }}>{i.ok ? "✓" : "✕"}</span>{" "}
              <b>{i.rot}</b><div style={{ color: "var(--ww-text-muted)", marginLeft: 16 }}>{i.det}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)", marginTop: 8 }}>Natureza: {p.config.natureza_operacao}</div>
      </div>

      <div style={{ ...cartao, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px" }}>
          <b style={{ fontSize: 14 }}>PVs do Omie a faturar ({lista.length})</b>
          <span style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>Validar = confere tudo sem enviar · Ensaio = mesma nota na homologação (destinatário = a própria {empresa})</span>
          <span style={{ flex: 1 }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="PV, cliente, OC…" style={{
            height: 30, padding: "0 10px", borderRadius: 8, fontSize: 12.5, border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
          }} />
        </div>
        {!pvs ? <div style={{ padding: 16, fontSize: 13 }}>Carregando…</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ textAlign: "left", color: "var(--ww-text-faint)" }}>
              {["PV", "Etapa", "Cliente", "OC", "Valor", ""].map((h) => <th key={h} style={{ padding: "10px 12px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--ww-border)" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {lista.map((pv) => {
                const r = pre[pv.codigo_pedido];
                return (
                  <FragmentoPv key={pv.codigo_pedido}>
                    <tr style={{ borderBottom: "1px solid var(--ww-border)" }}>
                      <td style={td}><b>{pv.rotulo}</b></td>
                      <td style={td}>{ETAPA[pv.etapa] ?? pv.etapa}</td>
                      <td style={{ ...td, maxWidth: 320 }}>{limpo(pv.cliente)}</td>
                      <td style={td}>{pv.num_pedido_cliente ?? "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(Number(pv.valor_total))}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        <button style={lk} disabled={!!ocupado} onClick={() => acao(pv, "prevoo")}>{ocupado === `prevoo:${pv.codigo_pedido}` ? "…" : "Validar"}</button>
                        <button style={lk} disabled={!!ocupado} onClick={() => acao(pv, "ensaio")}>{ocupado === `ensaio:${pv.codigo_pedido}` ? "…" : "Ensaio"}</button>
                        <button style={{ ...lk, color: prod ? "#E5484D" : "var(--ww-accent-text)" }} disabled={!!ocupado || (r && "pode_emitir" in r && !r.pode_emitir)}
                          onClick={() => acao(pv, "emitir")}>{ocupado === `emitir:${pv.codigo_pedido}` ? "Emitindo…" : prod ? "Emitir NF-e" : "Emitir (homolog.)"}</button>
                      </td>
                    </tr>
                    {aberto === pv.codigo_pedido && r && (
                      <tr><td colSpan={6} style={{ ...td, background: "var(--ww-panel-sunken)" }}>
                        {"error" in r ? <span style={{ color: "#E5484D" }}>{r.error}</span> : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <b style={{ color: r.pode_emitir ? "#3FB68B" : "#E5484D" }}>{r.pode_emitir ? "Pronto para emitir" : "Pendências — não emite"} · total {brl(r.total)}</b>
                            {r.checagens.map((c, k) => (
                              <div key={k} style={{ fontSize: 12.5 }}>
                                <span style={{ color: c.ok ? "#3FB68B" : c.nivel === "erro" ? "#E5484D" : "#E0A93B", fontWeight: 700 }}>{c.ok ? "✓" : c.nivel === "erro" ? "✕" : "!"}</span>{" "}
                                {c.item}: <span style={{ color: "var(--ww-text-muted)" }}>{c.detalhe}</span>
                              </div>
                            ))}
                            <div><button style={lk} onClick={() => setVerPayload(verPayload === pv.codigo_pedido ? null : pv.codigo_pedido)}>{verPayload === pv.codigo_pedido ? "Esconder" : "Ver"} JSON que vai à Focus</button>
                              <button style={lk} onClick={() => setAberto(null)}>Fechar</button></div>
                            {verPayload === pv.codigo_pedido && <pre style={{ fontSize: 11, maxHeight: 360, overflow: "auto", margin: 0 }}>{JSON.stringify(r.payload, null, 1)}</pre>}
                          </div>
                        )}
                      </td></tr>
                    )}
                  </FragmentoPv>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

function FragmentoPv({ children }: { children: React.ReactNode }) { return <>{children}</>; }
