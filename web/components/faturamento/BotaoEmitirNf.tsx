"use client";

import { useState } from "react";
import type { DocFat } from "@/lib/faturamento/montar";

/**
 * Botão "Emitir NF" para uma linha de PV/OS (P1 usa na lista nativa).
 * Monta o documento a partir do PV/OS e chama /api/faturamento/emitir; a
 * empresa decide o ambiente (homologação por padrão) e, para OS, se sai
 * recibo ou NFS-e (fat_config.tipo_os).
 */
export default function BotaoEmitirNf({ origemTipo, origemId, documento, onEmitido, rotulo, gerarReceberHomologacao }: {
  origemTipo: "pv" | "os" | "venda";
  origemId: string;
  documento: DocFat;
  rotulo?: string;
  /** Em homologação o receber só nasce quando pedido (documentos de TESTE). */
  gerarReceberHomologacao?: boolean;
  onEmitido?: (r: { status: string; numero: string | null; mensagem: string | null; pdf_url: string | null }) => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  async function emitir() {
    if (!window.confirm(`Emitir documento fiscal de ${rotulo ?? `${origemTipo.toUpperCase()} ${origemId}`}?`)) return;
    setOcupado(true);
    const r = await fetch("/api/faturamento/emitir", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documento, origem_tipo: origemTipo, origem_id: origemId, gerar_receber_homologacao: !!gerarReceberHomologacao }),
    }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcupado(false);
    if (r.error) { window.alert(r.error); return; }
    onEmitido?.({ status: r.emissao.status, numero: r.emissao.numero, mensagem: r.emissao.mensagem, pdf_url: r.pdf_url });
  }
  return (
    <button type="button" disabled={ocupado} onClick={emitir} style={{
      height: 28, padding: "0 10px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: ocupado ? "default" : "pointer",
      border: "1px solid var(--ww-border-strong)", background: "transparent", color: "var(--ww-accent-text)",
    }}>{ocupado ? "Emitindo…" : "Emitir NF"}</button>
  );
}
