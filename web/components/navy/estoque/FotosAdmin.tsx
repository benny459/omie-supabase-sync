"use client";

/**
 * Estoque › Catálogo › Fotos (02/10/26, simplificada a pedido do Benny).
 * Uma barra de progresso ("N de M itens com foto · termina em ~X"), Pausar/Retomar, as últimas fotos achadas
 * (cada uma com "Trocar") e a lista dos itens sem achado. Provedor, cota e o resto técnico ficam em "Detalhes".
 * O job roda sozinho (cron de 5 em 5 min, 4 buscas em paralelo), mesmo com a tela fechada.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { postar, q } from "./comum";
import { TrocarFoto } from "./FotoItem";

type Estado = {
  provedor: { provedor: string | null; pronto: boolean; faltando: string[] };
  job: { ativo: boolean; cota_dia: number; usados_hoje: number; ultimo_lote_em: string | null; ultimo_erro: string | null; pausa_motivo: string | null; rodando: boolean };
  fotos: { total: number; por_origem: Record<string, number> };
  busca: Record<string, number>;
  recentes: { n_cod_prod: number; url: string | null; origem: string; created_at: string; codigo: string | null; descricao: string | null }[];
  sem_achado: { n_cod_prod: number; termo: string | null; status: string; ultimo_erro: string | null; codigo: string | null; descricao: string | null }[];
  ritmo_por_min: number;
  admin: boolean;
};
type Avisar = (m: string, t?: "ok" | "crit" | "warn" | "info") => void;
const NOME: Record<string, string> = { google: "Google Custom Search", serpapi: "SerpApi", serper: "Serper.dev", brave: "Brave Search" };

export function AbaFotos({ totalItens, avisar }: { totalItens: number; avisar: Avisar }) {
  const router = useRouter();
  const [e, setE] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [cota, setCota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [trocar, setTrocar] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/estoque/fotos", { cache: "no-store" });
    const j = await r.json();
    if (r.ok) { setE(j); setErro(null); } else setErro(j.error ?? r.statusText);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  // atualiza sozinha enquanto busca (o trabalho em si roda no servidor, com ou sem esta tela)
  useEffect(() => {
    if (!e?.job.ativo) return;
    const t = setInterval(carregar, 20_000);
    return () => clearInterval(t);
  }, [e?.job.ativo, carregar]);

  const acao = async (corpo: Record<string, unknown>, ok: string) => {
    setOcupado(true);
    try { await postar("/api/estoque/fotos", corpo); avisar(ok, "ok"); await carregar(); }
    catch (x) { avisar((x as Error).message, "crit"); } finally { setOcupado(false); }
  };

  if (erro) return <div className="aviso t-crit">{erro}</div>;
  if (!e) return <div className="cartao vazio">Carregando…</div>;
  const j = e.job, b = e.busca;
  const pct = totalItens ? Math.min(100, Math.round((e.fotos.total / totalItens) * 100)) : 0;
  const faltam = Math.max(0, totalItens - e.fotos.total - (b.sem_resultado ?? 0));
  const min = e.ritmo_por_min > 0 ? Math.ceil(faltam / e.ritmo_por_min) : null;
  const eta = min == null ? null : min < 60 ? `~${min} min` : `~${Math.round(min / 6) / 10} h`;
  const estadoTxt = !e.provedor.pronto ? "busca automática aguardando chave" : j.ativo ? (faltam ? `buscando · termina em ${eta ?? "…"}` : "concluída") : (j.pausa_motivo ?? "pausada");

  return (<>
    <div className="cartao" style={{ padding: "18px 20px", display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{q(e.fotos.total)} de {q(totalItens)} itens com foto</div>
          <div className="mini">{estadoTxt}</div>
        </div>
        {e.admin && e.provedor.pronto && (j.ativo
          ? <button className="btn" disabled={ocupado} onClick={() => acao({ acao: "pausar" }, "Busca pausada")}>Pausar</button>
          : <button className="btn pri" disabled={ocupado} onClick={() => acao({ acao: "iniciar" }, "Busca retomada")}>{e.fotos.total ? "Retomar" : "Iniciar busca de fotos"}</button>)}
      </div>
      <div className="barra" style={{ height: 10 }}><i style={{ width: `${pct}%`, background: "var(--ww-ok)" }} /></div>
      {j.ultimo_erro && j.ativo && <div className="aviso t-warn"><span>Último aviso da busca: {j.ultimo_erro}</span></div>}
    </div>

    <div className="cartao">
      <div className="head" style={{ padding: "12px 16px" }}><h3 style={{ margin: 0 }}>Últimas fotos achadas</h3><span className="mini">clique em “Trocar” se a foto não for do item</span></div>
      <div className="grade-fotos">
        {e.recentes.map((r) => (
          <div key={r.n_cod_prod} className="foto-mini">
            <button className="link" onClick={() => r.codigo && router.push(`/estoque/${encodeURIComponent(r.codigo)}`)} title={r.descricao ?? ""}>
              {r.url ? <img src={r.url} alt="" loading="lazy" /> : <span className="mini">sem imagem</span>}
            </button>
            <div className="mini nome" title={r.descricao ?? ""}>{r.descricao ?? r.n_cod_prod}</div>
            <button className="btn sm" onClick={() => setTrocar(r.n_cod_prod)}>Trocar</button>
          </div>
        ))}
        {!e.recentes.length && <div className="vazio">Nenhuma foto ainda.</div>}
      </div>
    </div>

    {e.sem_achado.length > 0 && (
      <div className="cartao">
        <div className="head" style={{ padding: "12px 16px" }}><h3 style={{ margin: 0 }}>Sem foto achada ({q(e.sem_achado.length)})</h3><span className="mini">ponha à mão: link ou arquivo</span></div>
        <div className="scroll"><table className="tabela"><tbody>
          {e.sem_achado.map((r) => (
            <tr key={r.n_cod_prod}>
              <td><b>{r.descricao ?? r.n_cod_prod}</b><div className="mini">{r.codigo} · buscado como “{r.termo}”</div></td>
              <td className="opt mini">{r.status === "erro" ? "erro na busca" : "nenhuma imagem baixou"}</td>
              <td style={{ textAlign: "right" }}><button className="btn sm" onClick={() => setTrocar(r.n_cod_prod)}>Pôr foto</button></td>
            </tr>
          ))}
        </tbody></table></div>
      </div>
    )}

    <div className="cartao" style={{ padding: "12px 16px" }}>
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Detalhes</summary>
        <div style={{ display: "grid", gap: 8, marginTop: 10, fontSize: 13, color: "var(--ww-text-2)" }}>
          <span>Busca: {e.provedor.pronto ? NOME[e.provedor.provedor ?? ""] ?? e.provedor.provedor : `aguardando ${e.provedor.faltando.join(", ")} na Vercel`}. A foto escolhida é baixada e guardada no painel (não é link externo). Roda sozinha a cada 5 minutos, mesmo com esta tela fechada; itens de maior valor primeiro.</span>
          <span>Hoje: {q(j.usados_hoje)} de {q(j.cota_dia)} buscas · ritmo {String(e.ritmo_por_min).replace(".", ",")} itens/min · {q(b.ok ?? 0)} com foto, {q(b.sem_resultado ?? 0)} sem achado, {q(b.erro ?? 0)} com erro.</span>
          {e.admin && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label className="mini" htmlFor="cota-fotos">Buscas por dia</label>
              <input id="cota-fotos" className="inp" type="number" min={1} max={10000} style={{ width: 110 }} placeholder={String(j.cota_dia)} value={cota} onChange={(x) => setCota(x.target.value)} />
              <button className="btn sm" disabled={ocupado || !cota} onClick={async () => { await acao({ acao: "cota", cota: Number(cota) }, `Cota: ${cota} buscas por dia`); setCota(""); }}>Salvar</button>
              {(b.sem_resultado ?? 0) > 0 && <button className="btn sm" disabled={ocupado} onClick={() => acao({ acao: "refazer_sem_resultado" }, "Itens sem achado voltaram para a fila")}>Buscar de novo os sem achado</button>}
            </div>
          )}
        </div>
      </details>
    </div>
    {trocar != null && <TrocarFoto n={trocar} fechar={() => setTrocar(null)} mudou={carregar} avisar={(t, tom) => avisar(t, tom)} />}
  </>);
}
