"use client";
// "Enviar ao cliente" (09/10/26): mostra para quem vai (e-mails do cadastro do cliente,
// editáveis) e só envia depois do segundo clique. Nada sai sozinho.
import { useState } from "react";

export default function EnviarAoCliente({ id, className = "ne-btn" }: { id: number | null | undefined; className?: string }) {
  const [aberto, setAberto] = useState(false);
  const [para, setPara] = useState("");
  const [info, setInfo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  if (!id) return null;

  async function abrir() {
    setErro(null); setInfo(null); setOcupado(true);
    const r = await fetch(`/api/faturamento/enviar?id=${id}`, { cache: "no-store" }).then((x) => x.json()).catch(() => ({ error: "Falha de rede" }));
    setOcupado(false);
    if (r.error) { setErro(r.error); return; }
    setPara((r.emails ?? []).join(", "));
    if (r.enviado_em) setInfo(`Já enviado em ${new Date(r.enviado_em).toLocaleString("pt-BR")} para ${(r.enviado_para ?? []).join(", ")}`);
    setAberto(true);
  }

  async function enviar() {
    setErro(null); setOcupado(true);
    const r = await fetch("/api/faturamento/enviar", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, para })}).then((x) => x.json()).catch(() => ({ error: "Falha de rede" }));
    setOcupado(false);
    if (r.error) { setErro(r.error); return; }
    setAberto(false);
    setInfo(`✓ Enviado para ${(r.para ?? []).join(", ")}${r.teste ? " (modo teste: foi para a lista de teste)" : ""}`);
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      {!aberto ? (
        <button className={className} disabled={ocupado} onClick={abrir} title="Envia o PDF (e o XML, se houver) para os e-mails do cliente">
          {ocupado ? "…" : "Enviar ao cliente"}
        </button>
      ) : (
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <input value={para} onChange={(e) => setPara(e.target.value)} placeholder="e-mails, separados por vírgula"
            style={{ minWidth: 280, height: 36, padding: "0 10px", borderRadius: 10, border: "1px solid var(--ww-border-strong,#28395a)", background: "var(--ww-panel)", color: "var(--ww-text)" }} />
          <button className={`${className} pri`} disabled={ocupado || !para.trim()} onClick={enviar}>{ocupado ? "Enviando…" : "Enviar"}</button>
          <button className={className} disabled={ocupado} onClick={() => setAberto(false)}>Cancelar</button>
        </span>
      )}
      {info && <small style={{ color: "var(--ww-text-muted)" }}>{info}</small>}
      {erro && <small style={{ color: "var(--ww-crit-text, #e5484d)" }}>{erro}</small>}
    </span>
  );
}
