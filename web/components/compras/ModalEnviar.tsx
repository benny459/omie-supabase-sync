"use client";

/**
 * "Enviar a impressão do pedido de compra por e-mail" — como o modal do Omie:
 * Para (do cadastro do fornecedor), Cc/Cco, cópia para mim, anexo extra,
 * assunto, texto complementar, prévia do e-mail, variante do PDF (completo /
 * sem valores), "Visualizar o arquivo" e "Enviar agora". Sem e-mail
 * configurado no painel, oferece baixar o PDF e "Marcar como enviado"
 * (WhatsApp, entregue em mãos…), que move o pedido para "Enviado ao fornecedor".
 */

import { useEffect, useState } from "react";

type Dados = {
  configurado: boolean; soPara: string[]; para: string[]; assunto: string; empresa: string; numero: string;
  fornecedor?: string; eu: string; aprovado: boolean; origem: string; enviadoEm?: string | null; enviadoPara?: string | null;
};

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function CampoEmails({ valor, onChange, placeholder }: { valor: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [t, setT] = useState("");
  const add = (txt: string) => {
    const novos = txt.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    if (novos.length) onChange([...new Set([...valor, ...novos])]);
    setT("");
  };
  return (
    <div className="tags-in">
      {valor.map((e) => (
        <span key={e} className="tg" style={emailOk(e) ? undefined : { background: "var(--ww-crit-soft)", color: "var(--ww-crit-text)" }}>
          {e}<button type="button" aria-label={`Remover ${e}`} onClick={() => onChange(valor.filter((x) => x !== e))}>✕</button>
        </span>
      ))}
      <input value={t} placeholder={valor.length ? "" : placeholder} onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (["Enter", ",", ";", "Tab"].includes(e.key) && t.trim()) { e.preventDefault(); add(t); } }}
        onBlur={() => t.trim() && add(t)} />
    </div>
  );
}

export default function ModalEnviar({ id, onClose, onEnviado, toast }: {
  id: number; onClose: () => void; onEnviado: (msg: string) => void; toast: (m: string, erro?: boolean) => void;
}) {
  const [d, setD] = useState<Dados | null>(null);
  const [para, setPara] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [cco, setCco] = useState<string[]>([]);
  const [copia, setCopia] = useState(true);
  const [assunto, setAssunto] = useState("");
  const [texto, setTexto] = useState("");
  const [variante, setVariante] = useState<"completo" | "sem_valores">("completo");
  const [anexo, setAnexo] = useState<{ nome: string; base64: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [meio, setMeio] = useState<"whatsapp" | "outro">("whatsapp");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/compras/email?id=${id}`); const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setD(j); setPara(j.para); setAssunto(j.assunto);
      } catch (e) { toast((e as Error).message, true); onClose(); }
    })();
  }, [id, onClose, toast]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  const ver = () => window.open(`/api/compras/pdf?id=${id}&variante=${variante}`, "_blank", "noopener");
  const baixar = () => window.open(`/api/compras/pdf?id=${id}&variante=${variante}&baixar=1`, "_blank", "noopener");

  const enviar = async () => {
    if (!para.length) { toast("Informe pelo menos um destinatário em “Para”.", true); return; }
    setOcupado(true);
    try {
      const r = await fetch("/api/compras/email", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, para, cc, cco, copia, assunto, texto, variante, anexo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      onEnviado(`Pedido ${d?.numero} enviado para ${para.join(", ")}`);
    } catch (e) { toast((e as Error).message, true); }
    finally { setOcupado(false); }
  };
  const marcar = async () => {
    setOcupado(true);
    try {
      const r = await fetch("/api/compras/email", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, acao: "marcar", meio, para: para.join(", ") }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      onEnviado(`Pedido ${d?.numero} marcado como enviado ao fornecedor`);
    } catch (e) { toast((e as Error).message, true); }
    finally { setOcupado(false); }
  };

  const bloqueio = d && !d.aprovado ? "Pedido ainda não aprovado: dá para visualizar o rascunho (com a marca “AGUARDANDO APROVAÇÃO”), mas só pedido aprovado vai ao fornecedor." : null;

  return (
    <div className="cmp-scrim" style={{ zIndex: 90, justifyContent: "center", alignItems: "center", padding: 16 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cmp" style={{ display: "contents" }}>
        <div className="modal" role="dialog" aria-modal="true" aria-label="Enviar pedido de compra por e-mail">
          <div className="mh">
            <b style={{ fontSize: 15 }}>Enviar a impressão do pedido de compra por e-mail</b>
            {d && <span className="pill p-acc">Pedido {d.numero}</span>}
            <span style={{ flex: 1 }} /><button className="btn ghost sm" onClick={onClose}>Fechar ✕</button>
          </div>
          {!d ? <div className="empty">Carregando…</div> : (
            <>
              <div className="mb">
                <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                  {!d.configurado && (
                    <div className="aviso p-warn">E-mail ainda não configurado no painel — dá para visualizar/baixar o PDF e
                      <b> marcar como enviado</b> (WhatsApp, entregue em mãos). Para enviar daqui falta a conta de envio (Resend) na Vercel.</div>
                  )}
                  {d.soPara.length > 0 && <div className="aviso p-sky">Modo teste: só envia para {d.soPara.join(", ")}.</div>}
                  {bloqueio && <div className="aviso p-crit">{bloqueio}</div>}
                  {d.enviadoEm && <div className="aviso p-env">Já enviado em {new Date(d.enviadoEm).toLocaleString("pt-BR")}{d.enviadoPara ? ` para ${d.enviadoPara}` : ""}.</div>}
                  <div className="f"><label>Para</label><CampoEmails valor={para} onChange={setPara} placeholder="e-mail do fornecedor" />
                    {!d.para.length && <span className="hint">O cadastro do fornecedor não tem e-mail — digite.</span>}</div>
                  <div className="f"><label>Cc</label><CampoEmails valor={cc} onChange={setCc} /></div>
                  <div className="f"><label>Cco</label><CampoEmails valor={cco} onChange={setCco} /></div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
                    <input type="checkbox" checked={copia} onChange={(e) => setCopia(e.target.checked)} /> Quero receber uma cópia deste e-mail ({d.eu})</label>
                  <div className="f"><label>Assunto</label><input className="in" value={assunto} onChange={(e) => setAssunto(e.target.value)} /></div>
                  <div className="f"><label>Texto complementar</label><textarea className="in" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Opcional — entra no corpo do e-mail" /></div>
                  <div className="f"><label>Incluir um novo anexo</label>
                    {anexo ? <span className="tags-in"><span className="tg">📎 {anexo.nome}<button type="button" onClick={() => setAnexo(null)}>✕</button></span></span>
                      : <input className="in" type="file" style={{ paddingTop: 6 }} onChange={(e) => {
                          const f = e.target.files?.[0]; if (!f) return;
                          if (f.size > 7_000_000) { toast("Anexo grande demais (máx. 7 MB)", true); return; }
                          const fr = new FileReader();
                          fr.onload = () => setAnexo({ nome: f.name, base64: String(fr.result).split(",")[1] ?? "" });
                          fr.readAsDataURL(f);
                        }} />}</div>
                  <div className="f"><label>Arquivo PDF</label>
                    <div className="seg2">
                      <label className={variante === "completo" ? "on" : ""}><input type="radio" checked={variante === "completo"} onChange={() => setVariante("completo")} />
                        <span><b>Completo</b><br /><span className="muted">com valores, totais e pagamento</span></span></label>
                      <label className={variante === "sem_valores" ? "on" : ""}><input type="radio" checked={variante === "sem_valores"} onChange={() => setVariante("sem_valores")} />
                        <span><b>Sem valores</b><br /><span className="muted">só itens e quantidades</span></span></label>
                    </div></div>
                </div>
                <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                  <div className="secao-t">Prévia do e-mail</div>
                  <div className="email-prev">
                    <div className="faixa" />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/logo-waterworks.png" alt="WaterWorks" width={150} style={{ display: "block", marginBottom: 12 }} />
                    <p style={{ margin: "0 0 8px" }}><b>Assunto:</b> {assunto}</p>
                    <p>Prezado Fornecedor,</p>
                    <p>Anexo o arquivo PDF com o Pedido de Compra Nº <b>{d.numero}</b>.</p>
                    <p>Por favor, providenciar a entrega conforme as condições do pedido.</p>
                    {texto && <p style={{ whiteSpace: "pre-wrap" }}>{texto}</p>}
                    <p className="nfe">Ao emitir a NF-e, informe o número <b>{d.numero}</b> no campo “Pedido de compra” (xPed) de cada item e o item do pedido em nItemPed.</p>
                    <p style={{ color: "#6A7B86", fontSize: 12 }}>{d.empresa}</p>
                    <p style={{ color: "#6A7B86", fontSize: 12, marginBottom: 0 }}>📎 pedido_de_compra_{d.numero}{variante === "sem_valores" ? "_sem_valores" : ""}.pdf{anexo ? ` · ${anexo.nome}` : ""}</p>
                  </div>
                  <div className="card2" style={{ display: "grid", gap: 8 }}>
                    <div className="secao-t">Enviou por outro caminho?</div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <select className="sel" value={meio} onChange={(e) => setMeio(e.target.value as "whatsapp" | "outro")}>
                        <option value="whatsapp">WhatsApp</option><option value="outro">Outro (em mãos, portal…)</option></select>
                      <button className="btn" disabled={ocupado || !!bloqueio} onClick={marcar}>✓ Marcar como enviado</button>
                    </div>
                    <span className="hint">Move o pedido para “Enviado ao fornecedor” e registra quem, quando e para quem.</span>
                  </div>
                </div>
              </div>
              <div className="mf">
                <button className="btn" onClick={ver}>👁 Visualizar o arquivo</button>
                <button className="btn" onClick={baixar}>⬇ Baixar PDF</button>
                <span style={{ flex: 1 }} />
                <button className="btn ghost" onClick={onClose}>Cancelar</button>
                <button className="btn pri" disabled={ocupado || !d.configurado || !!bloqueio || !para.length} onClick={enviar}
                  title={!d.configurado ? "E-mail não configurado no painel" : undefined}>✉ {ocupado ? "Enviando…" : "Enviar agora"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
