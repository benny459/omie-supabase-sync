"use client";
// "Enviar ao cliente" (09/10/26): no molde do envio do pedido de compra (compras/ModalEnviar) —
// Para (e-mails do cadastro do cliente), Cc, Cco, assunto, texto complementar, anexo extra,
// prévia do e-mail, "Visualizar o arquivo" e "Marcar como enviado" por outro caminho.
// Sai pelo e-mail da plataforma. Nada é enviado sozinho.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CampoEmails } from "@/components/compras/ModalEnviar";
import "@/components/compras/compras.css";

type Dados = {
  id: number; doc: string; numero: string; cliente: string; origem: string | null; chave: string | null; valor: number;
  autorizada: boolean; para: string[]; assunto: string; arquivos: string[]; pdf: string | null;
  configurado: boolean; soPara: string[]; eu: string; enviadoEm: string | null; enviadoPara: string[] | null; enviadoPor: string | null;
  remetente: string; ccoFixo: string[]; emitente: string; historico: Envio[];
};
type Envio = {
  id: number; meio: string; para: string[]; cc: string[]; assunto: string | null; anexos: string[];
  enviado_por: string | null; enviado_em: string; status: string; status_em: string | null; detalhe: string | null;
};
// Situação do envio (Resend) → rótulo e cor (classes de pill do Compras).
const SIT: Record<string, [string, string]> = {
  enviado: ["Enviado — aguardando entrega", "p-sky"], entregue: ["✓ Entregue", "p-ok"], aberto: ["✓ Entregue e aberto", "p-ok"],
  clicado: ["✓ Entregue e aberto", "p-ok"], atrasado: ["Entrega atrasada (tentando)", "p-warn"],
  devolvido: ["✕ Devolvido — e-mail não existe ou recusou", "p-crit"], spam: ["✕ Marcado como spam", "p-crit"],
  falhou: ["✕ Falhou", "p-crit"], marcado: ["Registrado (outro caminho)", "p-env"],
};
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function EnviarAoCliente({ id, className = "ne-btn" }: { id: number | null | undefined; className?: string }) {
  const [aberto, setAberto] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  if (!id) return null;
  return (
    <>
      <button className={className} onClick={() => { setOk(null); setAberto(true); }} title="Enviar o PDF (e o XML) ao cliente pelo e-mail da plataforma">✉ Enviar ao cliente</button>
      {ok && <small style={{ color: "var(--ww-text-muted)", alignSelf: "center" }}>{ok}</small>}
      {aberto && createPortal(<ModalEnviarFat id={id} onClose={() => setAberto(false)} onEnviado={(m) => { setOk(m); setAberto(false); }} />, document.body)}
    </>
  );
}

function ModalEnviarFat({ id, onClose, onEnviado }: { id: number; onClose: () => void; onEnviado: (m: string) => void }) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [para, setPara] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [cco, setCco] = useState<string[]>([]);
  const [assunto, setAssunto] = useState("");
  const [texto, setTexto] = useState("");
  const [anexo, setAnexo] = useState<{ nome: string; base64: string } | null>(null);
  const [meio, setMeio] = useState("WhatsApp");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    fetch(`/api/faturamento/enviar?id=${id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (j.error) { setErro(j.error); return; }
      setD(j); setPara(j.para ?? []); setAssunto(j.assunto ?? "");
    }).catch(() => setErro("Falha de rede"));
  }, [id]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  async function post(corpo: Record<string, unknown>) {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/faturamento/enviar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...corpo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error ?? r.statusText);
      return j;
    } catch (e) { setErro((e as Error).message); return null; }
    finally { setOcupado(false); }
  }
  const enviar = async () => {
    const j = await post({ para, cc, cco, assunto, texto, anexo });
    if (j) onEnviado(j.teste ? `✓ Enviado em modo TESTE para ${(j.vaiPara ?? []).join(", ")}` : `✓ ${d?.doc} ${d?.numero} enviado para ${[...para, ...cc].join(", ")}`);
  };
  const marcar = async () => {
    const j = await post({ acao: "marcar", meio, para: para.join(", ") });
    if (j) onEnviado(`✓ Marcado como enviado (${meio})`);
  };

  return (
    <div className="cmp-scrim" style={{ zIndex: 130, justifyContent: "center", alignItems: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmp" style={{ display: "contents" }}>
        <div className="modal" role="dialog" aria-modal="true" aria-label="Enviar documento ao cliente por e-mail">
          <div className="mh">
            <b style={{ fontSize: 15 }}>Enviar ao cliente por e-mail</b>
            {d && <span className="pill p-acc">{d.doc} {d.numero}</span>}
            <span style={{ flex: 1 }} /><button className="btn ghost sm" onClick={onClose}>Fechar ✕</button>
          </div>
          {!d ? <div className="empty">{erro ?? "Carregando…"}</div> : (
            <>
              <div className="mb">
                <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                  {!d.configurado && <div className="aviso p-warn">E-mail da plataforma não configurado — use “Marcar como enviado”.</div>}
                  {d.soPara.length > 0 && <div className="aviso p-sky"><b>Modo teste:</b> só {d.soPara.join(", ")} recebe; o assunto mostra para quem iria.</div>}
                  {!d.autorizada && <div className="aviso p-crit">Documento ainda não autorizado — só documento autorizado vai ao cliente.</div>}
                  <div className="f"><label>De</label><input className="in" value={d.remetente} disabled /></div>
                  <div className="f"><label>Para</label><CampoEmails valor={para} onChange={setPara} placeholder="e-mail do cliente" />
                    {!d.para.length && <span className="hint">Cliente sem e-mail no cadastro — digite aqui (e acerte depois em Cadastros › Clientes).</span>}</div>
                  <div className="f"><label>Cc</label><CampoEmails valor={cc} onChange={setCc} /></div>
                  <div className="f"><label>Cco</label><CampoEmails valor={cco} onChange={setCco} /></div>
                  <span className="hint">Cópia oculta automática, com os anexos, para {[...d.ccoFixo, d.eu].join(" e ")}. A resposta do cliente chega para quem enviou.</span>
                  <div className="f"><label>Assunto</label><input className="in" value={assunto} onChange={(e) => setAssunto(e.target.value)} /></div>
                  <div className="f"><label>Texto complementar</label><textarea className="in" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Opcional — entra no corpo do e-mail (ex.: dados para pagamento, nº da OC)" /></div>
                  <div className="f"><label>Incluir um novo anexo</label>
                    {anexo ? <span className="tags-in"><span className="tg">📎 {anexo.nome}<button type="button" onClick={() => setAnexo(null)}>✕</button></span></span>
                      : <input className="in" type="file" style={{ paddingTop: 6 }} onChange={(e) => {
                          const f = e.target.files?.[0]; if (!f) return;
                          if (f.size > 7_000_000) { setErro("Anexo grande demais (máx. 7 MB)"); return; }
                          const fr = new FileReader();
                          fr.onload = () => setAnexo({ nome: f.name, base64: String(fr.result).split(",")[1] ?? "" });
                          fr.readAsDataURL(f);
                        }} />}</div>
                </div>
                <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                  <div className="secao-t">Prévia do e-mail</div>
                  <div className="email-prev">
                    <div className="faixa" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo-waterworks.png" alt="WaterWorks" width={150} style={{ display: "block", marginBottom: 12 }} />
                    <p style={{ margin: "0 0 8px" }}><b>Assunto:</b> {assunto}</p>
                    <p>Prezados{d.cliente ? ` da ${d.cliente}` : ""},</p>
                    <p>Segue em anexo {d.doc === "Recibo" ? "o recibo" : `a ${d.doc}`} nº <b>{d.numero}</b>{d.origem ? ` referente ao pedido ${d.origem}` : ""}, no valor de <b>{brl(d.valor)}</b>.</p>
                    {d.chave && <p>Chave de acesso: <span style={{ fontFamily: "monospace" }}>{d.chave}</span></p>}
                    {texto && <p style={{ whiteSpace: "pre-wrap" }}>{texto}</p>}
                    <p>Qualquer dúvida, é só responder este e-mail.</p>
                    <p style={{ color: "#6A7B86", fontSize: 12 }}>{d.emitente || "WaterWorks"}</p>
                    <p style={{ color: "#6A7B86", fontSize: 12, marginBottom: 0 }}>📎 {[...d.arquivos, ...(anexo ? [anexo.nome] : [])].join(" · ") || "sem arquivo ainda"}</p>
                  </div>
                  <div className="card2" style={{ display: "grid", gap: 8 }}>
                    <div className="secao-t">Enviou por outro caminho?</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <select className="sel" value={meio} onChange={(e) => setMeio(e.target.value)}>
                        <option>WhatsApp</option><option>Portal do cliente</option><option>Outro</option></select>
                      <button className="btn" disabled={ocupado} onClick={marcar}>✓ Marcar como enviado</button>
                    </div>
                    <span className="hint">Só registra quem, quando e por onde.</span>
                  </div>
                  {erro && <div className="aviso p-crit">{erro}</div>}
                  <div className="secao-t">Histórico de envios</div>
                  {!d.historico.length ? <span className="hint">Ainda não foi enviado.</span> : (
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
                <button className="btn ghost" onClick={onClose}>Cancelar</button>
                <button className="btn pri" disabled={ocupado || !d.configurado || !d.autorizada || !para.length} onClick={enviar}>✉ {ocupado ? "Enviando…" : "Enviar agora"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
