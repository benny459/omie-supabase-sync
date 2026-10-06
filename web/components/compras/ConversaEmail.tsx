"use client";
/**
 * Aba "E-mails" do pedido de compra (06/10/26): a conversa com o fornecedor —
 * o envio do PDF, as respostas dele (Resend → /api/compras/email/entrada) e as
 * nossas respostas, escritas aqui. Cada mensagem enviada leva cópia oculta para
 * o compras@ e para quem escreveu, por isso a conversa fica também no Gmail.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Msg = {
  id: number; direcao: "saida" | "entrada"; de: string | null; para: string[]; cc: string[]; cco: string[];
  assunto: string | null; texto: string | null; html: string | null; por: string | null; status: string; em: string;
  anexos: { nome: string; tipo?: string; tamanho?: number; caminho?: string }[];
};

const quando = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const kb = (n?: number) => (n ? (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`) : "");

export default function ConversaEmail({ id, podeEscrever, aoLer }: { id: number; podeEscrever: boolean; aoLer?: () => void }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [soPara, setSoPara] = useState<string[]>([]);
  const [configurado, setConfigurado] = useState(true);
  const [texto, setTexto] = useState("");
  const [para, setPara] = useState("");
  const [anexo, setAnexo] = useState<{ nome: string; base64: string } | null>(null);
  const [aberta, setAberta] = useState<number | null>(null);
  const [envio, setEnvio] = useState<{ ocupado?: boolean; erro?: string; ok?: boolean }>({});

  const aoLerRef = useRef(aoLer);
  useEffect(() => { aoLerRef.current = aoLer; }, [aoLer]);
  const carregar = useCallback(async () => {
    const r = await fetch(`/api/compras/email/conversa?id=${id}`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setEnvio({ erro: j.error ?? "Falha ao carregar" }); setMsgs([]); return; }
    setMsgs(j.mensagens ?? []); setSoPara(j.soPara ?? []); setConfigurado(!!j.configurado);
    const m = (j.mensagens ?? []) as Msg[];
    setAberta(m.length ? m[m.length - 1].id : null);
    aoLerRef.current?.();
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function escolherAnexo(f: File | undefined) {
    if (!f) { setAnexo(null); return; }
    if (f.size > 7_000_000) { setEnvio({ erro: "Anexo grande demais (máx. 7 MB)" }); return; }
    const b = await f.arrayBuffer();
    let bin = ""; const u8 = new Uint8Array(b);
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    setAnexo({ nome: f.name, base64: btoa(bin) });
  }

  async function enviar() {
    if (!texto.trim()) return;
    setEnvio({ ocupado: true });
    const r = await fetch("/api/compras/email/conversa", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, texto, para: para.trim() || undefined, anexo }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setEnvio({ erro: j.error ?? "Falha no envio" }); return; }
    setTexto(""); setAnexo(null); setEnvio({ ok: true }); await carregar();
  }

  if (!msgs) return <div className="muted" style={{ padding: 12 }}>Carregando a conversa…</div>;
  return (
    <div className="conv-email" style={{ display: "grid", gap: 10 }}>
      {soPara.length > 0 && <div className="aviso p-sky">Modo teste: e-mails só saem para {soPara.join(", ")} (e a cópia do compras@).</div>}
      {!msgs.length && <div className="muted" style={{ padding: "8px 2px" }}>Nenhum e-mail ainda. Envie o pedido ao fornecedor (Imprimir / PDF / enviar) — a conversa começa aí.</div>}
      {msgs.map((m) => {
        const deFora = m.direcao === "entrada";
        const ab = aberta === m.id;
        return (
          <div key={m.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "9px 11px",
            background: deFora ? "var(--accent-soft)" : "transparent", marginLeft: deFora ? 0 : 28, marginRight: deFora ? 28 : 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", cursor: "pointer", flexWrap: "wrap" }} onClick={() => setAberta(ab ? null : m.id)}>
              <b style={{ fontSize: 12.5 }}>{deFora ? `↙ ${m.de ?? "Fornecedor"}` : `↗ ${m.por ?? "Compras"}${m.status === "gmail" ? " (pelo Gmail)" : ""}`}</b>
              <span className="muted" style={{ fontSize: 11.5 }}>{quando(m.em)}</span>
              {!deFora && m.para?.length > 0 && <span className="muted" style={{ fontSize: 11.5 }}>para {m.para.join(", ")}</span>}
              {m.status === "teste" && <span className="pill">teste</span>}
              {m.anexos?.length > 0 && <span className="muted" style={{ fontSize: 11.5 }}>📎 {m.anexos.length}</span>}
            </div>
            {!ab && <div className="muted" style={{ fontSize: 12, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{(m.texto ?? "").slice(0, 160)}</div>}
            {ab && (
              <div style={{ marginTop: 6 }}>
                {m.assunto && <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{m.assunto}</div>}
                {deFora && m.html
                  // HTML do fornecedor: isolado num iframe sem scripts.
                  ? <iframe title={`e-mail ${m.id}`} sandbox="" srcDoc={m.html} style={{ width: "100%", minHeight: 260, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
                  : <div style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{m.texto}</div>}
                {m.anexos?.length > 0 && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {m.anexos.map((a, i) => a.caminho
                      ? <a key={i} className="pill" href={`/api/compras/email/anexo?p=${encodeURIComponent(a.caminho)}`} target="_blank" rel="noreferrer">📎 {a.nome} {kb(a.tamanho)}</a>
                      : <span key={i} className="pill">📎 {a.nome}</span>)}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {podeEscrever && msgs.length > 0 && (
        <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
          <b style={{ fontSize: 12.5 }}>Responder ao fornecedor</b>
          <input className="in" placeholder="Para (vazio = quem escreveu por último)" value={para} onChange={(e) => setPara(e.target.value)} />
          <textarea className="in" rows={4} placeholder="Escreva a mensagem…" value={texto} onChange={(e) => setTexto(e.target.value)} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label className="btn sm" style={{ cursor: "pointer" }}>📎 {anexo ? anexo.nome : "Anexar"}
              <input type="file" hidden onChange={(e) => void escolherAnexo(e.target.files?.[0])} /></label>
            {anexo && <button className="linkbtn" onClick={() => setAnexo(null)}>tirar anexo</button>}
            <span style={{ flex: 1 }} />
            <span className="hint">Cópia oculta para o compras@ e para você (fica no seu Gmail).</span>
            <button className="btn sm pri" disabled={!configurado || envio.ocupado || !texto.trim()} onClick={() => void enviar()}>
              {envio.ocupado ? "Enviando…" : "Enviar"}</button>
          </div>
          {envio.erro && <div className="aviso p-red">{envio.erro}</div>}
          {envio.ok && <div className="aviso p-green">Enviado.</div>}
          {!configurado && <div className="aviso">E-mail não configurado no painel.</div>}
        </div>
      )}
    </div>
  );
}
