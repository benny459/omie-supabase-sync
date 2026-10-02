"use client";

/**
 * Foto do item na ficha (02/10/26). A foto fica no bucket privado "produtos" (URL assinada) — nunca
 * o link externo. "Trocar foto": candidatos da busca automática (5 guardados), nova busca na web
 * (conta na cota do dia; sem chave do provedor mostra "busca automática aguardando chave"),
 * colar o link de uma imagem, ou enviar arquivo (no celular abre a câmera).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invalidarItens, IconeCaixa } from "./comum";

type Cand = { url: string; thumb: string | null; titulo: string | null; pagina: string | null; largura: number | null; altura: number | null };
type Estado = {
  foto: { url: string | null; origem: string; source_url: string | null; provider: string | null; created_at: string; created_by_email: string | null } | null;
  busca: { status: string; termo: string | null; candidatos: Cand[]; ultimo_erro: string | null; buscado_em: string | null } | null;
  termo: string;
  provedor: { pronto: boolean; nome: string | null; faltando: string[] };
};
const site = (u: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };
const ORIGEM: Record<string, string> = { web: "foto da web", upload: "enviada", url: "link colado" };

export function FotoItem({ n, avisar }: { n: number; avisar: (t: string, tom?: "ok" | "crit") => void }) {
  const [e, setE] = useState<Estado | null>(null);
  const [aberto, setAberto] = useState(false);
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/estoque/foto?n=${n}`, { cache: "no-store" });
    const j = await r.json();
    if (r.ok) setE(j);
  }, [n]);
  useEffect(() => { carregar(); }, [carregar]);

  return (<>
    <div className="foto">
      {e?.foto?.url ? <img src={e.foto.url} alt="" /> : <div className="icone"><IconeCaixa /></div>}
      <span className="src">{e?.foto ? ORIGEM[e.foto.origem] ?? e.foto.origem : e ? "sem foto" : "carregando foto…"}</span>
      {e && <div className="acoes">
        <button className="btn sm" onClick={() => setAberto(true)}>{e.foto ? "Trocar foto" : "Pôr foto"}</button>
      </div>}
    </div>
    {aberto && e && <ModalFoto n={n} e={e} fechar={() => setAberto(false)} mudou={(x) => { setE(x); invalidarItens(); }} avisar={avisar} />}
  </>);
}

/** "Trocar foto" de qualquer item, fora da ficha (página Fotos do Catálogo). */
export function TrocarFoto({ n, fechar, mudou, avisar }: { n: number; fechar: () => void; mudou: () => void; avisar: (t: string, tom?: "ok" | "crit") => void }) {
  const [e, setE] = useState<Estado | null>(null);
  useEffect(() => { fetch(`/api/estoque/foto?n=${n}`, { cache: "no-store" }).then((r) => r.json()).then(setE).catch(() => setE(null)); }, [n]);
  if (!e) return null;
  return <ModalFoto n={n} e={e} fechar={fechar} mudou={() => { invalidarItens(); mudou(); }} avisar={avisar} />;
}

function ModalFoto({ n, e, fechar, mudou, avisar }: {
  n: number; e: Estado; fechar: () => void; mudou: (e: Estado) => void; avisar: (t: string, tom?: "ok" | "crit") => void;
}) {
  const [termo, setTermo] = useState(e.busca?.termo || e.termo);
  const [cands, setCands] = useState<Cand[]>(e.busca?.candidatos ?? []);
  const [sel, setSel] = useState<Cand | null>(null);
  const [url, setUrl] = useState("");
  const [indo, setIndo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const arq = useRef<HTMLInputElement>(null);

  const chamar = async (corpo: Record<string, unknown>, k: string) => {
    setIndo(k); setErro(null);
    try {
      const r = await fetch("/api/estoque/foto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n, ...corpo }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      return j;
    } catch (x) { setErro((x as Error).message); return null; } finally { setIndo(null); }
  };
  const buscar = async () => { const j = await chamar({ acao: "buscar", termo }, "buscar"); if (j) { setCands(j.candidatos ?? []); setSel(null); if (!j.candidatos?.length) setErro("Nada encontrado — tente menos palavras, cole um link ou envie um arquivo."); } };
  const usar = async (u: string, origem: "web" | "url") => { const j = await chamar({ acao: "usar", url: u, origem }, "usar"); if (j) { mudou(j); avisar("Foto salva", "ok"); fechar(); } };
  const remover = async () => { const j = await chamar({ acao: "remover" }, "remover"); if (j) { mudou(j); avisar("Foto removida", "ok"); fechar(); } };
  const enviar = async (f: File | undefined) => {
    if (!f) return;
    setIndo("enviar"); setErro(null);
    try {
      const fd = new FormData(); fd.append("n", String(n)); fd.append("arquivo", f);
      const r = await fetch("/api/estoque/foto", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      mudou(j); avisar("Foto enviada", "ok"); fechar();
    } catch (x) { setErro((x as Error).message); } finally { setIndo(null); }
  };

  return (
    <div className="est-ov" onClick={fechar} role="dialog" aria-modal="true" aria-label="Foto do item">
      <div className="pal" style={{ width: "min(760px, 100%)" }} onClick={(x) => x.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--ww-border)" }}>
          <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 15 }}>Foto do item</div>
            <div className="mini">{e.foto ? `Atual: ${ORIGEM[e.foto.origem] ?? e.foto.origem}${e.foto.created_by_email ? ` · ${e.foto.created_by_email}` : ""}` : "Sem foto"} · guardada no painel, não é link externo</div></div>
          <button className="btn sm" onClick={fechar} aria-label="Fechar">×</button>
        </div>
        <div style={{ padding: 16, display: "grid", gap: 12, maxHeight: "70vh", overflow: "auto" }}>
          {e.provedor.pronto ? (
            <div style={{ display: "flex", gap: 8 }}>
              <input className="inp" value={termo} onChange={(x) => setTermo(x.target.value)} onKeyDown={(x) => x.key === "Enter" && buscar()} style={{ flex: 1 }} aria-label="Termo de busca" />
              <button className="btn" onClick={buscar} disabled={!!indo}>{indo === "buscar" ? "Buscando…" : "Buscar na web"}</button>
            </div>
          ) : (
            <div className="aviso t-info"><span><b>Busca automática aguardando chave.</b> Enquanto isso: cole o link de uma imagem ou envie um arquivo.</span></div>
          )}
          {cands.length > 0 && (<>
            <div className="mini">{e.busca?.buscado_em && cands === e.busca.candidatos ? `Achados guardados da última busca (${new Date(e.busca.buscado_em).toLocaleDateString("pt-BR")})` : "Resultados"} — clique para escolher</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
              {cands.map((c, i) => (
                <button key={i} type="button" onClick={() => setSel(c)} title={c.titulo ?? c.url}
                  style={{ padding: 0, borderRadius: 12, overflow: "hidden", cursor: "pointer", background: "var(--ww-panel-sunken)", textAlign: "left",
                    border: `2px solid ${sel === c ? "var(--ww-accent)" : "var(--ww-border)"}` }}>
                  {/* miniatura servida pelo próprio provedor de busca, só para escolher; a escolhida é baixada para o painel */}
                  <img src={c.thumb ?? c.url} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: "100%", height: 110, objectFit: "cover", display: "block" }} />
                  <small style={{ display: "block", padding: "4px 6px", fontSize: 10.5, color: "var(--ww-text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {c.largura && c.altura ? `${c.largura}×${c.altura} · ` : ""}{site(c.pagina)}</small>
                </button>
              ))}
            </div>
          </>)}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn" href={`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(termo)}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Abrir no Google Imagens ↗</a>
            <input className="inp" value={url} onChange={(x) => setUrl(x.target.value)} placeholder="ou cole o link de uma imagem" style={{ flex: 1, minWidth: 200 }}
              onKeyDown={(x) => x.key === "Enter" && url.trim() && usar(url.trim(), "url")} aria-label="Link da imagem" />
            <button className="btn" disabled={!url.trim() || !!indo} onClick={() => usar(url.trim(), "url")}>Usar o link</button>
          </div>
          {erro && <div className="aviso t-crit">{erro}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--ww-border)", flexWrap: "wrap" }}>
          <input ref={arq} type="file" accept="image/*" capture="environment" hidden onChange={(x) => enviar(x.target.files?.[0])} />
          <button className="btn" onClick={() => arq.current?.click()} disabled={!!indo}>{indo === "enviar" ? "Enviando…" : "Enviar arquivo"}</button>
          {e.foto && <button className="btn" onClick={remover} disabled={!!indo}>Tirar a foto</button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={fechar}>Cancelar</button>
          <button className="btn pri" disabled={!sel || !!indo} onClick={() => sel && usar(sel.url, "web")}>{indo === "usar" ? "Baixando…" : "Usar esta foto"}</button>
        </div>
      </div>
    </div>
  );
}
