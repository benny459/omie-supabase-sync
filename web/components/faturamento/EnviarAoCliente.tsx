"use client";
// "Enviar ao cliente" (09/10/26): no molde do envio do pedido de compra (compras/ModalEnviar) —
// Para (e-mails do cadastro do cliente), Cc, Cco, assunto, texto complementar, anexo extra,
// prévia do e-mail (o mesmo HTML que sai: lib/faturamento/envio-modelo), "Conferir sem enviar"
// (ensaio: monta os anexos de verdade e não envia), "Marcar como enviado" por outro caminho e
// o histórico. Sai pelo e-mail da plataforma. Nada é enviado sozinho.
//
// Fluxo (Benny, 09/10/26): ao emitir, a janela abre sozinha (prop `auto`) — fechar sem enviar
// pede confirmação: o documento fica marcado como NÃO ENVIADO (pill "✉ não enviado" na carteira).
// Lote: <EnvioLote> — um e-mail por documento, cada um pré-preenchido, numa lista de revisão.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CampoEmails } from "@/components/compras/ModalEnviar";
import { corpoEnvio, type ModeloEnvio } from "@/lib/faturamento/envio-modelo";
import "@/components/compras/compras.css";

type Dados = {
  id: number | null; nfse: number | null; doc: string; numero: string; cliente: string; origem: string | null; chave: string | null; valor: number;
  modelo: ModeloEnvio; autorizada: boolean; bloqueio: string | null; para: string[]; assunto: string; arquivos: string[]; pdf: string | null;
  configurado: boolean; soPara: string[]; eu: string; enviadoEm: string | null; enviadoPara: string[] | null; enviadoPor: string | null;
  remetente: string; ccoFixo: string[]; emitente: string; historico: Envio[];
};
type Envio = {
  id: number; meio: string; para: string[]; cc: string[]; assunto: string | null; anexos: string[];
  enviado_por: string | null; enviado_em: string; status: string; status_em: string | null; detalhe: string | null;
};
type Previa = {
  bloqueio: string | null; configurado: boolean; de: string; para: string[]; cc: string[]; cco: string[]; replyTo: string; assunto: string;
  anexos: { nome: string; kb: number }[]; teste: string[] | null; remetente: { dominio: string; status: string };
};
export type AlvoEnvio = { id?: number | null; nfse?: number | null };

// Situação do envio (Resend) → rótulo e cor (classes de pill do Compras).
const SIT: Record<string, [string, string]> = {
  enviado: ["Enviado — aguardando entrega", "p-sky"], entregue: ["✓ Entregue", "p-ok"], aberto: ["✓ Entregue e aberto", "p-ok"],
  clicado: ["✓ Entregue e aberto", "p-ok"], atrasado: ["Entrega atrasada (tentando)", "p-warn"],
  devolvido: ["✕ Devolvido — e-mail não existe ou recusou", "p-crit"], spam: ["✕ Marcado como spam", "p-crit"],
  falhou: ["✕ Falhou", "p-crit"], marcado: ["Registrado (outro caminho)", "p-env"],
};
const qs = (a: AlvoEnvio) => (a.nfse ? `nfse=${a.nfse}` : `id=${a.id}`);
const corpo = (a: AlvoEnvio) => (a.nfse ? { nfse: a.nfse } : { id: a.id });
export const MSG_DEPOIS = "Enviar depois?\n\nO documento ficará marcado como NÃO ENVIADO ao cliente (pill “✉ não enviado” na carteira e lembrete diário) até alguém enviar ou marcar como enviado.";

async function postar(alvo: AlvoEnvio, extra: Record<string, unknown>) {
  const r = await fetch("/api/faturamento/enviar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...corpo(alvo), ...extra }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error ?? r.statusText);
  return j;
}

/** Botão + janela. `auto`: abre sozinha ao montar (logo depois da emissão). */
export default function EnviarAoCliente({ id, nfse, className = "ne-btn", auto = false, rotulo, semBotao = false, onEnviado, onFechado }: AlvoEnvio & {
  className?: string; auto?: boolean; rotulo?: string; /** só a janela (aberta por `auto`). */ semBotao?: boolean;
  /** Envio (ou "marcar como enviado") concluído. */ onEnviado?: (msg: string) => void;
  /** Janela fechada; enviado = houve envio/registro nesta abertura ou antes. */ onFechado?: (enviado: boolean) => void;
}) {
  const [aberto, setAberto] = useState(auto);
  const [ok, setOk] = useState<string | null>(null);
  useEffect(() => { if (auto) setAberto(true); }, [auto, id, nfse]);
  if (!id && !nfse) return null;
  return (
    <>
      {!semBotao && <button className={className} onClick={() => { setOk(null); setAberto(true); }} title="Enviar o documento (PDF/XML) ao cliente pelo e-mail da plataforma">{rotulo ?? "✉ Enviar ao cliente"}</button>}
      {ok && <small style={{ color: "var(--ww-text-muted)", alignSelf: "center" }}>{ok}</small>}
      {aberto && createPortal(<ModalEnviarFat alvo={{ id, nfse }} aviso={auto ? "Documento emitido — para fechar o ciclo, envie ao cliente." : null}
        onClose={(enviado) => { setAberto(false); onFechado?.(enviado); }}
        onEnviado={(m) => { setOk(m); setAberto(false); onEnviado?.(m); onFechado?.(true); }} />, document.body)}
    </>
  );
}

export function ModalEnviarFat({ alvo, aviso, onClose, onEnviado }: {
  alvo: AlvoEnvio; aviso?: string | null; onClose: (enviado: boolean) => void; onEnviado: (m: string) => void;
}) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [para, setPara] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [cco, setCco] = useState<string[]>([]);
  const [assunto, setAssunto] = useState("");
  const [texto, setTexto] = useState("");
  const [anexo, setAnexo] = useState<{ nome: string; base64: string } | null>(null);
  const [meio, setMeio] = useState("WhatsApp");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [prova, setProva] = useState<string | null>(null);
  const jaEnviado = !!d?.enviadoEm;

  useEffect(() => {
    fetch(`/api/faturamento/enviar?${qs(alvo)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j.error) { setErro(j.error); return; }
      setD(j); setPara(j.para ?? []); setAssunto(j.assunto ?? "");
    }).catch(() => setErro("Falha de rede"));
  }, [alvo.id, alvo.nfse]); // eslint-disable-line react-hooks/exhaustive-deps

  const fechar = () => {
    if (d && !jaEnviado && !d.bloqueio && !window.confirm(MSG_DEPOIS)) return;
    onClose(jaEnviado);
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  });

  async function post(qual: string, extra: Record<string, unknown>) {
    setOcupado(qual); setErro(null);
    try { return await postar(alvo, extra); }
    catch (e) { setErro((e as Error).message); return null; }
    finally { setOcupado(null); }
  }
  const campos = () => ({ para, cc, cco, assunto, texto, anexo });
  const enviar = async () => {
    const j = await post("enviar", campos());
    if (j) onEnviado(j.teste ? `✓ Enviado em modo TESTE para ${(j.vaiPara ?? []).join(", ")}` : `✓ ${d?.doc} ${d?.numero} enviado para ${[...para, ...cc].join(", ")}`);
  };
  const conferir = async () => { const j = await post("previa", { acao: "previa", ...campos() }); if (j) setPrevia(j); };
  const mandarProva = async () => {
    if (!window.confirm(`Mandar uma PROVA deste e-mail só para ${d?.eu}? (assunto “[TESTE] …”, sem cópias; o documento continua não enviado)`)) return;
    const j = await post("prova", { acao: "prova", ...campos() });
    if (j) setProva(`✓ Prova enviada para ${(j.para ?? []).join(", ")} — ${j.anexos?.length ?? 0} anexo(s)`);
  };
  const marcar = async () => {
    const j = await post("marcar", { acao: "marcar", meio, para: para.join(", ") });
    if (j) onEnviado(`✓ Marcado como enviado (${meio})`);
  };
  const html = d ? corpoEnvio(d.modelo, texto) : "";

  return (
    <div className="cmp-scrim" style={{ zIndex: 130, justifyContent: "center", alignItems: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
      <div className="cmp" style={{ display: "contents" }}>
        <div className="modal" role="dialog" aria-modal="true" aria-label="Enviar documento ao cliente por e-mail">
          <div className="mh">
            <b style={{ fontSize: 15 }}>Enviar ao cliente por e-mail</b>
            {d && <span className="pill p-acc">{d.doc} {d.numero}</span>}
            {d && (jaEnviado ? <span className="pill p-ok">✉ enviado {new Date(d.enviadoEm!).toLocaleDateString("pt-BR")}</span> : !d.bloqueio && <span className="pill p-warn">✉ não enviado</span>)}
            <span style={{ flex: 1 }} /><button className="btn ghost sm" onClick={fechar}>Fechar ✕</button>
          </div>
          {!d ? <div className="empty">{erro ?? "Carregando…"}</div> : (
            <>
              <div className="mb">
                <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                  {aviso && !jaEnviado && <div className="aviso p-sky"><b>{aviso}</b> Confira os destinatários e clique em “Enviar agora”.</div>}
                  {!d.configurado && <div className="aviso p-warn">E-mail da plataforma não configurado — use “Marcar como enviado”.</div>}
                  {d.soPara.length > 0 && <div className="aviso p-sky"><b>Modo teste:</b> só {d.soPara.join(", ")} recebe; o assunto mostra para quem iria.</div>}
                  {d.bloqueio && <div className="aviso p-crit">{d.bloqueio}</div>}
                  <div className="f"><label>De</label><input className="in" value={d.remetente} disabled /></div>
                  <div className="f"><label>Para</label><CampoEmails valor={para} onChange={setPara} placeholder="e-mail do cliente" />
                    {!d.para.length && <span className="hint">Cliente sem e-mail no cadastro — digite aqui (e acerte depois em Cadastros › Clientes).</span>}</div>
                  <div className="f"><label>Cc</label><CampoEmails valor={cc} onChange={setCc} /></div>
                  <div className="f"><label>Cco</label><CampoEmails valor={cco} onChange={setCco} /></div>
                  <span className="hint">Cópia oculta automática, com os anexos, para {[...d.ccoFixo, d.eu].join(" e ")}. A resposta do cliente chega para quem enviou ({d.eu}).</span>
                  <div className="f"><label>Assunto</label><input className="in" value={assunto} onChange={(e) => setAssunto(e.target.value)} /></div>
                  <div className="f"><label>Texto complementar</label><textarea className="in" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Opcional — entra no corpo do e-mail, depois dos dados de pagamento" /></div>
                  <div className="f"><label>Incluir um novo anexo</label>
                    {anexo ? <span className="tags-in"><span className="tg">📎 {anexo.nome}<button type="button" onClick={() => setAnexo(null)}>✕</button></span></span>
                      : <input className="in" type="file" style={{ paddingTop: 6 }} onChange={(e) => {
                          const f = e.target.files?.[0]; if (!f) return;
                          if (f.size > 7_000_000) { setErro("Anexo grande demais (máx. 7 MB)"); return; }
                          const fr = new FileReader();
                          fr.onload = () => setAnexo({ nome: f.name, base64: String(fr.result).split(",")[1] ?? "" });
                          fr.readAsDataURL(f);
                        }} />}</div>
                  <div className="card2" style={{ display: "grid", gap: 8 }}>
                    <div className="secao-t">Enviou por outro caminho?</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <select className="sel" value={meio} onChange={(e) => setMeio(e.target.value)}>
                        <option>WhatsApp</option><option>Portal do cliente</option><option>Outro</option></select>
                      <button className="btn" disabled={!!ocupado || /migração/i.test(d.bloqueio ?? "")} onClick={marcar}>✓ Marcar como enviado</button>
                    </div>
                    <span className="hint">Só registra quem, quando e por onde — o documento deixa de aparecer como não enviado.</span>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                  <div className="secao-t">Prévia do e-mail</div>
                  <div className="email-prev" style={{ padding: 0, overflow: "hidden" }}>
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid #E3EAEE", fontSize: 12.5 }}><b>Assunto:</b> {assunto}</div>
                    <iframe title="Prévia do e-mail" sandbox="" srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:14px;background:#fff">${html}</body>`}
                      style={{ width: "100%", height: 400, border: 0, display: "block", background: "#fff" }} />
                    <div style={{ padding: "8px 14px", borderTop: "1px solid #E3EAEE", color: "#6A7B86", fontSize: 12 }}>
                      📎 {[...d.arquivos, ...(anexo ? [anexo.nome] : [])].join(" · ") || "sem arquivo ainda"}</div>
                  </div>
                  <div className="card2" style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <div className="secao-t" style={{ flex: 1 }}>Conferir sem enviar</div>
                      <button className="btn sm" disabled={!!ocupado} onClick={conferir} title="Monta o e-mail e os anexos de verdade (PDF/XML), mostra para quem iria — e não envia nada">{ocupado === "previa" ? "Conferindo…" : "🔍 Conferir"}</button>
                    </div>
                    {previa && <div style={{ display: "grid", gap: 3, fontSize: 12.5 }}>
                      <span><b>De:</b> {previa.de} <span className="hint">· domínio {previa.remetente.dominio}: {previa.remetente.status}</span></span>
                      <span><b>Para:</b> {previa.para.join(", ") || "—"}</span>
                      {previa.cc.length > 0 && <span><b>Cc:</b> {previa.cc.join(", ")}</span>}
                      <span><b>Cco:</b> {previa.cco.join(", ") || "—"}</span>
                      <span><b>Responder para:</b> {previa.replyTo}</span>
                      <span><b>Anexos:</b> {previa.anexos.map((a) => `${a.nome} (${a.kb} KB)`).join(" · ")}</span>
                      {previa.teste && <span className="hint">Modo teste: iria só para {previa.teste.join(", ")}.</span>}
                      <span className="hint">{previa.bloqueio ? `Não pode enviar: ${previa.bloqueio}` : "✓ Tudo pronto — nada foi enviado."}</span>
                      {d.configurado && <span><button className="btn ghost sm" disabled={!!ocupado} onClick={mandarProva}>{ocupado === "prova" ? "Mandando…" : `Mandar prova só para mim (${d.eu})`}</button></span>}
                      {prova && <span className="hint">{prova}</span>}
                    </div>}
                  </div>
                  {erro && <div className="aviso p-crit">{erro}</div>}
                  <div className="secao-t">Histórico de envios</div>
                  {!d.historico.length ? <span className="hint">{jaEnviado ? `Registrado em ${new Date(d.enviadoEm!).toLocaleString("pt-BR")} por ${d.enviadoPor ?? "—"}.` : "Ainda não foi enviado."}</span> : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {d.historico.map((h) => {
                        const [rot, cor] = SIT[h.status] ?? [h.status, "p-sky"];
                        return (
                          <div key={h.id} className="card2" style={{ display: "grid", gap: 3, padding: "8px 10px" }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <b style={{ fontSize: 12.5 }}>{new Date(h.enviado_em).toLocaleString("pt-BR")}</b>
                              <span className={`pill ${cor}`}>{rot}</span>
                              <span className="hint">{h.meio === "email" ? "e-mail" : h.meio} · por {h.enviado_por ?? "—"}</span>
                            </div>
                            <span className="hint">Para: {[...h.para, ...h.cc].join(", ") || "—"}</span>
                            {h.anexos?.length > 0 && <span className="hint">📎 {h.anexos.join(" · ")}</span>}
                            {h.detalhe && <span className="hint">{h.detalhe}</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              <div className="mf">
                {d.pdf && <button className="btn" onClick={() => window.open(d.pdf!, "_blank", "noopener")}>👁 Visualizar o arquivo</button>}
                <span style={{ flex: 1 }} />
                <button className="btn ghost" onClick={fechar}>{jaEnviado || d.bloqueio ? "Fechar" : "Enviar depois"}</button>
                <button className="btn pri" disabled={!!ocupado || !d.configurado || !!d.bloqueio || !para.length} onClick={enviar}>
                  ✉ {ocupado === "enviar" ? "Enviando…" : jaEnviado ? "Reenviar" : "Enviar agora"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Lote: "Enviar os N ao cliente" — um e-mail por documento, cada um pré-preenchido ──
type LinhaLote = { id: number; d?: Dados; para: string[]; incluir: boolean; estado: "carregando" | "pronto" | "enviando" | "enviado" | "falhou" | "bloqueado"; msg?: string | null };

export function EnvioLote({ ids, fechar, onMudou }: { ids: number[]; fechar: () => void; onMudou?: () => void }) {
  const [linhas, setLinhas] = useState<LinhaLote[]>(() => ids.map((id) => ({ id, para: [], incluir: true, estado: "carregando" })));
  const [revisar, setRevisar] = useState<number | null>(null);
  const [rodando, setRodando] = useState(false);
  const muda = (id: number, p: Partial<LinhaLote>) => setLinhas((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const carregarUm = (id: number) => fetch(`/api/faturamento/enviar?id=${id}`, { cache: "no-store" }).then((r) => r.json()).then((j: Dados & { error?: string }) => {
    if (j.error) { muda(id, { estado: "bloqueado", msg: j.error, incluir: false }); return; }
    const feito = !!j.enviadoEm;
    muda(id, { d: j, para: j.para ?? [], estado: feito ? "enviado" : j.bloqueio ? "bloqueado" : "pronto", msg: feito ? `já enviado ${new Date(j.enviadoEm!).toLocaleDateString("pt-BR")}` : j.bloqueio,
      incluir: !feito && !j.bloqueio && (j.para ?? []).length > 0 });
  }).catch((e) => muda(id, { estado: "falhou", msg: String(e) }));
  useEffect(() => { ids.forEach((id) => { void carregarUm(id); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const alvo = linhas.filter((l) => l.incluir && l.estado === "pronto" && l.para.length);
  const faltam = linhas.filter((l) => l.estado !== "enviado").length;
  async function enviarTodos() {
    if (!alvo.length) return;
    if (!window.confirm(`Enviar ${alvo.length} e-mail(s) — um por documento, cada um para o seu cliente?\n\n${alvo.map((l) => `${l.d?.doc} ${l.d?.numero} → ${l.para.join(", ")}`).join("\n")}`)) return;
    setRodando(true);
    for (const l of alvo) {
      muda(l.id, { estado: "enviando" });
      try {
        const j = await postar({ id: l.id }, { para: l.para, assunto: l.d?.assunto });
        muda(l.id, { estado: "enviado", msg: j.teste ? `modo teste → ${(j.vaiPara ?? []).join(", ")}` : `→ ${l.para.join(", ")}`, incluir: false });
      } catch (e) { muda(l.id, { estado: "falhou", msg: (e as Error).message }); }
    }
    setRodando(false);
    onMudou?.();
  }
  const sair = () => {
    if (rodando) return;
    if (faltam > 0 && linhas.some((l) => l.estado === "pronto") && !window.confirm(MSG_DEPOIS.replace("O documento ficará marcado", `${faltam} documento(s) ficarão marcados`))) return;
    fechar();
  };
  const selo: Record<LinhaLote["estado"], [string, string]> = {
    carregando: ["montando…", "p-sky"], pronto: ["✉ não enviado", "p-warn"], enviando: ["enviando…", "p-sky"],
    enviado: ["✓ enviado", "p-ok"], falhou: ["✕ falhou", "p-crit"], bloqueado: ["não envia", "p-crit"],
  };

  return createPortal(
    <div className="cmp-scrim" style={{ zIndex: 125, justifyContent: "center", alignItems: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) sair(); }}>
      <div className="cmp" style={{ display: "contents" }}>
        <div className="modal" role="dialog" aria-modal="true" aria-label="Enviar os documentos ao cliente">
          <div className="mh">
            <b style={{ fontSize: 15 }}>Enviar os {ids.length} ao cliente</b>
            <span className="hint">um e-mail por documento, para o cliente de cada um — revise os destinatários</span>
            <span style={{ flex: 1 }} /><button className="btn ghost sm" onClick={sair} disabled={rodando}>Fechar ✕</button>
          </div>
          <div style={{ padding: "12px 18px", display: "grid", gap: 8 }}>
            {linhas.map((l) => {
              const [rot, cor] = selo[l.estado];
              return (
                <div key={l.id} className="card2" style={{ display: "grid", gridTemplateColumns: "22px minmax(150px, 220px) minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: "8px 10px" }}>
                  <input type="checkbox" checked={l.incluir} disabled={l.estado !== "pronto" || rodando} onChange={(e) => muda(l.id, { incluir: e.target.checked })} aria-label="Incluir no envio" />
                  <div style={{ display: "grid", gap: 2, fontSize: 12.5 }}>
                    <b>{l.d ? `${l.d.doc} ${l.d.numero}` : `#${l.id}`}{l.d?.origem ? ` · ${l.d.origem}` : ""}</b>
                    <span className="hint">{l.d?.cliente ?? ""}</span>
                    {l.d && <span className="hint">📎 {l.d.arquivos.join(" · ")}</span>}
                  </div>
                  <div>{l.estado === "pronto" || (l.estado === "falhou" && l.d)
                    ? <CampoEmails valor={l.para} onChange={(v) => muda(l.id, { para: v, incluir: v.length > 0 })} placeholder="e-mail do cliente" />
                    : <span className="hint">{l.msg ?? ""}</span>}
                    {l.estado === "pronto" && !l.para.length && <span className="hint">Cliente sem e-mail no cadastro — digite aqui.</span>}
                    {l.estado === "falhou" && <span className="hint" style={{ color: "var(--ww-crit-text)" }}>{l.msg}</span>}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span className={`pill ${cor}`}>{rot}</span>
                    {l.d && !rodando && l.estado !== "enviando" && <button className="btn ghost sm" onClick={() => setRevisar(l.id)}>Revisar</button>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mf">
            <span className="hint" style={{ alignSelf: "center" }}>Assunto, texto e anexos de cada um como na janela individual — “Revisar” abre a janela completa daquele documento.</span>
            <span style={{ flex: 1 }} />
            <button className="btn ghost" onClick={sair} disabled={rodando}>{faltam ? "Enviar depois" : "Fechar"}</button>
            <button className="btn pri" disabled={rodando || !alvo.length} onClick={enviarTodos}>✉ {rodando ? "Enviando…" : `Enviar ${alvo.length} e-mail${alvo.length === 1 ? "" : "s"}`}</button>
          </div>
        </div>
      </div>
      {revisar != null && <ModalEnviarFat alvo={{ id: revisar }} onClose={() => { setRevisar(null); void carregarUm(revisar); }}
        onEnviado={() => { const r = revisar; setRevisar(null); void carregarUm(r); onMudou?.(); }} />}
    </div>,
    document.body,
  );
}
