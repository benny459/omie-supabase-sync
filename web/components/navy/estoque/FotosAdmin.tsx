"use client";

/**
 * Estoque › Cadastros › Fotos (02/10/26): a busca automática de fotos.
 * "Iniciar busca de fotos" liga o job (o cron roda a cada 10 min; com esta tela aberta, roda também daqui).
 * Ordem: itens de maior valor em estoque e mais usados primeiro. Cota por dia (padrão 100 = faixa grátis
 * do Google). Pausar/retomar a qualquer momento — o job retoma de onde parou (estado por item).
 * Sem IMAGE_SEARCH_PROVIDER + IMAGE_SEARCH_KEY (+ IMAGE_SEARCH_CX no Google) mostra "aguardando chave".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invalidarItens, postar, q } from "./comum";

type Estado = {
  provedor: { provedor: string | null; pronto: boolean; faltando: string[] };
  job: { ativo: boolean; cota_dia: number; usados_hoje: number; ultimo_lote_em: string | null; ultimo_erro: string | null; pausa_motivo: string | null; rodando: boolean; updated_by_email: string | null };
  fotos: { total: number; por_origem: Record<string, number> };
  busca: Record<string, number>;
  admin: boolean;
};
type Avisar = (m: string, t?: "ok" | "crit" | "warn" | "info") => void;
const NOME: Record<string, string> = { google: "Google Custom Search", serpapi: "SerpApi (Google Imagens)", serper: "Serper.dev", brave: "Brave Search" };

export function AbaFotos({ totalItens, avisar }: { totalItens: number; avisar: Avisar }) {
  const [e, setE] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cota, setCota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const rodandoAqui = useRef(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/estoque/fotos", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) { setE(j); setErro(null); } else setErro(j.error ?? r.statusText);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // Com a tela aberta e o job ligado, roda um ciclo por minuto daqui (além do cron de 10 em 10 min).
  useEffect(() => {
    if (!e?.admin || !e.job.ativo || !e.provedor.pronto) return;
    const t = setInterval(async () => {
      if (rodandoAqui.current) return;
      rodandoAqui.current = true;
      try { const r = await postar<Estado & { ciclo: { com_foto: number } }>("/api/estoque/fotos", { acao: "rodar" }); setE((x) => (x ? { ...r, admin: x.admin } : x)); if (r.ciclo?.com_foto) invalidarItens(); }
      catch { /* o próximo ciclo tenta de novo */ } finally { rodandoAqui.current = false; }
    }, 60_000);
    return () => clearInterval(t);
  }, [e?.admin, e?.job.ativo, e?.provedor.pronto]);

  const acao = async (corpo: Record<string, unknown>, ok: string) => {
    setOcupado(true);
    try { const r = await postar<Estado>("/api/estoque/fotos", corpo); setE((x) => (x ? { ...r, admin: x.admin } : x)); avisar(ok, "ok"); }
    catch (x) { avisar((x as Error).message, "crit"); } finally { setOcupado(false); }
  };

  if (erro) return <div className="aviso t-crit">{erro}</div>;
  if (!e) return <div className="cartao vazio">Carregando…</div>;
  const j = e.job, b = e.busca;
  const feitos = (b.ok ?? 0) + (b.sem_resultado ?? 0) + (b.erro ?? 0);
  const semFoto = Math.max(0, totalItens - e.fotos.total);
  const pct = totalItens ? Math.round((e.fotos.total / totalItens) * 100) : 0;
  const diasRestantes = j.cota_dia ? Math.ceil(Math.max(0, semFoto - (b.sem_resultado ?? 0)) / j.cota_dia) : null;

  return (<>
    {!e.provedor.pronto ? (
      <div className="aviso t-warn" style={{ flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
        <b>Busca automática aguardando chave</b>
        <span>Nada é buscado (nem cobrado) até as variáveis existirem na Vercel (projeto “web”, Production). Falta: <b>{e.provedor.faltando.join(", ")}</b>.</span>
        <span className="mini">IMAGE_SEARCH_PROVIDER = google | serpapi | serper | brave · IMAGE_SEARCH_KEY = a chave · IMAGE_SEARCH_CX = só no Google. Depois de criar, faça um novo deploy.</span>
        <span className="mini">Enquanto isso, na ficha de cada item: “Pôr foto” → colar link ou enviar arquivo.</span>
      </div>
    ) : (
      <div className="aviso t-info"><span>Provedor: <b>{NOME[e.provedor.provedor ?? ""] ?? e.provedor.provedor}</b>. A foto escolhida é baixada e guardada no painel (bucket privado), nunca usada como link externo. Os 5 melhores achados ficam guardados para o “Trocar foto”.</span></div>
    )}

    <section className="kpis">
      <div className="kpi hero" style={{ cursor: "default" }}><div className="r">Itens com foto</div><div className="v">{q(e.fotos.total)}</div>
        <div className="s">{pct}% de {q(totalItens)} · {Object.entries(e.fotos.por_origem).map(([k, v]) => `${v} ${k === "web" ? "da web" : k === "upload" ? "enviadas" : "por link"}`).join(" · ") || "nenhuma ainda"}</div></div>
      <div className="kpi" style={{ cursor: "default" }}><div className="r">Buscas hoje</div><div className="v">{q(j.usados_hoje)} / {q(j.cota_dia)}</div><div className="s">cota por dia{diasRestantes != null && semFoto ? ` · ~${diasRestantes} dia(s) para passar por todos` : ""}</div></div>
      <div className="kpi" style={{ cursor: "default" }}><div className="r">Já buscados</div><div className="v">{q(feitos)}</div><div className="s">{b.ok ?? 0} com foto · {b.sem_resultado ?? 0} sem achado · {b.erro ?? 0} com erro</div></div>
      <div className="kpi" style={{ cursor: "default" }}><div className="r">Situação</div><div className="v" style={{ fontSize: 20 }}>{!e.provedor.pronto ? "aguardando chave" : j.ativo ? (j.rodando ? "buscando…" : "ligada") : "pausada"}</div>
        <div className="s">{j.pausa_motivo ?? (j.ultimo_lote_em ? `último ciclo ${new Date(j.ultimo_lote_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : "ainda não rodou")}</div></div>
    </section>

    {j.ultimo_erro && <div className="aviso t-crit"><span><b>Último erro do provedor:</b> {j.ultimo_erro}</span></div>}

    <div className="cartao">
      <div className="head" style={{ padding: "14px 16px", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h3 style={{ margin: 0 }}>Busca automática de fotos</h3>
          <div className="mini">Para cada item sem foto: busca pelo nome (como na ficha), baixa a melhor imagem e guarda. Itens de maior valor em estoque e mais usados primeiro. Roda a cada 10 minutos até bater a cota do dia; pausar e retomar continua de onde parou.</div>
        </div>
        {e.admin && (j.ativo
          ? <button className="btn" disabled={ocupado} onClick={() => acao({ acao: "pausar" }, "Busca pausada")}>Pausar</button>
          : <button className="btn pri" disabled={ocupado || !e.provedor.pronto} title={e.provedor.pronto ? undefined : "Aguardando a chave do provedor"}
              onClick={() => acao({ acao: "iniciar" }, "Busca de fotos ligada — roda a cada 10 min")}>{feitos ? "Retomar busca de fotos" : "Iniciar busca de fotos"}</button>)}
      </div>
      {e.admin && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "0 16px 14px" }}>
          <label className="mini" htmlFor="cota-fotos">Buscas por dia</label>
          <input id="cota-fotos" className="inp" type="number" min={1} max={10000} style={{ width: 110 }} placeholder={String(j.cota_dia)} value={cota} onChange={(x) => setCota(x.target.value)} />
          <button className="btn sm" disabled={ocupado || !cota} onClick={async () => { await acao({ acao: "cota", cota: Number(cota) }, `Cota: ${cota} buscas por dia`); setCota(""); }}>Salvar cota</button>
          <span className="mini">100/dia é a faixa grátis do Google; aumente só se o provedor/plano permitir.</span>
          <span style={{ flex: 1 }} />
          {(b.sem_resultado ?? 0) > 0 && <button className="btn sm" disabled={ocupado} onClick={() => acao({ acao: "refazer_sem_resultado" }, "Itens sem achado voltaram para a fila")}>Buscar de novo os {b.sem_resultado} sem achado</button>}
        </div>
      )}
      {j.ativo && e.provedor.pronto && <div className="tfoot"><span>Com esta tela aberta, roda também daqui a cada minuto.</span></div>}
    </div>
  </>);
}
