import "server-only";

/**
 * Roteamento de canal Webex por tipo de mensagem:
 *   • "approvals" (default) → WEBEX_ROOM_ID
 *   • "report"              → WEBEX_ROOM_ID_REPORT (fallback pra WEBEX_ROOM_ID)
 *
 * Isso permite que aprovações de PC continuem no canal antigo e o report
 * diário vá pra um canal separado. Se WEBEX_ROOM_ID_REPORT não estiver
 * configurado, ambos caem no WEBEX_ROOM_ID (comportamento anterior).
 */
export type WebexTarget = "approvals" | "report";

function resolveRoomId(target: WebexTarget = "approvals"): string | null {
  if (target === "report") {
    return process.env.WEBEX_ROOM_ID_REPORT || process.env.WEBEX_ROOM_ID || null;
  }
  return process.env.WEBEX_ROOM_ID || null;
}

/**
 * Posta mensagem no Webex via Messages API.
 * Docs: https://developer.webex.com/docs/api/v1/messages/create-a-message
 */
export async function postWebexMessage(
  markdown: string,
  opts?: { target?: WebexTarget },
): Promise<{ ok: boolean; error?: string }> {
  const token  = process.env.WEBEX_TOKEN;
  const roomId = resolveRoomId(opts?.target);
  if (!token || !roomId) return { ok: false, error: "WEBEX_TOKEN ou WEBEX_ROOM_ID não configurados" };

  try {
    const res = await fetch("https://webexapis.com/v1/messages", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roomId, markdown }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Webex ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Posta mensagem no Webex com um arquivo anexado (multipart/form-data).
 * Usado pelo report Avulsos pra enviar o markdown + o PNG do gráfico.
 */
export async function postWebexMessageWithFile(args: {
  markdown: string;
  file: Buffer | Uint8Array;
  filename: string;
  contentType: string;
  target?: WebexTarget;
}): Promise<{ ok: boolean; error?: string }> {
  const token  = process.env.WEBEX_TOKEN;
  const roomId = resolveRoomId(args.target);
  if (!token || !roomId) return { ok: false, error: "WEBEX_TOKEN ou WEBEX_ROOM_ID não configurados" };

  try {
    const form = new FormData();
    form.append("roomId", roomId);
    form.append("markdown", args.markdown);
    const blob = new Blob([new Uint8Array(args.file)], { type: args.contentType });
    form.append("files", blob, args.filename);
    const res = await fetch("https://webexapis.com/v1/messages", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` }, // sem Content-Type — FormData define boundary
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Webex ${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Formata dados do PC num card markdown amigável
export function buildApprovalMarkdown(args: {
  pc_numero?: string | null;
  contato_fornecedor?: string | null;
  nome_fornecedor?: string | null;
  pc_forma_pagamento?: string | null;
  valor?: number | null;
  projeto_nome?: string | null;
  pv_os_label?: string | null;
  aprovador_email?: string | null;
  status_label: string;
}): string {
  const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const valorStr = args.valor != null ? fmtBRL(args.valor) : "—";
  // Prioriza nome_fornecedor (razão social/fantasia da finance.clientes)
  // sobre contato_fornecedor (nome do contato/pessoa)
  const fornecedor = args.nome_fornecedor ?? args.contato_fornecedor ?? "—";
  const lines = [
    `### ✅ PC ${args.status_label}`,
    ``,
    `**Número do pedido:** ${args.pc_numero ?? "—"}`,
    `**Fornecedor:** ${fornecedor}`,
    `**Forma de pagamento:** ${args.pc_forma_pagamento ?? "—"}`,
    `**Valor:** ${valorStr}`,
    `**Projeto:** ${args.projeto_nome ?? "—"}`,
  ];
  if (args.pv_os_label) lines.push(`**PV/OS:** ${args.pv_os_label}`);
  if (args.aprovador_email) lines.push(`**Aprovado por:** ${args.aprovador_email}`);
  return lines.join("\n");
}
