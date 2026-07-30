// POST /api/admin/webex-resend
// Reenvia notificações Webex de PCs já aprovados (sem alterar status).
// Usado pra backfill quando a rota /approvals/set-status falhou silenciosamente
// (ex: WEBEX_ROOM_ID errado, bot fora do canal, etc).
//
// Body:
//   { scope: "today" | "date" | "specific", date?: "YYYY-MM-DD",
//     empresa?: string, ncod_ped?: number, dryRun?: boolean }
//
// Retorna:
//   { scope, dryRun, sent, failed, items: [{ pc_numero, ok, error? }, ...] }

import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { postWebexMessage, buildApprovalMarkdown } from "@/lib/webex";
import { requireAdmin } from "../_guard";

export const runtime = "nodejs";

type Body = {
  scope?: "today" | "date" | "specific";
  date?: string;
  empresa?: string;
  ncod_ped?: number;
  dryRun?: boolean;
};

type ApprovalRow = {
  empresa: string;
  ncod_ped: number;
  status: string;
  aprovador_email: string | null;
  valor_aprovado: number | string | null;
  aprovado_em: string;
  pc_numero: string | null;
  contato_fornecedor: string | null;
  nome_fornecedor: string | null;
  pc_forma_pagamento: string | null;
  valor_total: number | string | null;
  projeto_nome: string | null;
  pv_os_label: string | null;
  status_label: string | null;
};

export async function POST(req: Request) {
  const { error: guardErr } = await requireAdmin();
  if (guardErr) return guardErr;

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const scope = body.scope ?? "today";
  const dryRun = body.dryRun === true;

  const admin = supaAdmin();

  // 1) Busca aprovações no escopo pedido, com dados enriquecidos
  //    (via 2 queries: approvals filtradas + join manual com v_pc_completo_enriched)
  let approvalsQuery = admin
    .schema("approval").from("approvals")
    .select("empresa, ncod_ped, status, aprovador_email, valor_aprovado, aprovado_em")
    .in("status", ["APROVADO", "APROVADO_FAT_DIRETO"]);

  if (scope === "specific") {
    if (!body.empresa || body.ncod_ped == null) {
      return NextResponse.json({ error: "scope=specific requer empresa e ncod_ped" }, { status: 400 });
    }
    approvalsQuery = approvalsQuery.eq("empresa", body.empresa).eq("ncod_ped", body.ncod_ped);
  } else {
    // today | date — filtra por aprovado_em no intervalo do dia (UTC)
    const targetDate = scope === "today"
      ? new Date().toISOString().slice(0, 10)
      : (body.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return NextResponse.json({ error: "date inválida (YYYY-MM-DD)" }, { status: 400 });
    }
    approvalsQuery = approvalsQuery
      .gte("aprovado_em", `${targetDate}T00:00:00Z`)
      .lt("aprovado_em", `${targetDate}T24:00:00Z`);
  }
  approvalsQuery = approvalsQuery.order("aprovado_em", { ascending: true });

  const { data: approvals, error: aErr } = await approvalsQuery;
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!approvals || approvals.length === 0) {
    return NextResponse.json({ scope, dryRun, sent: 0, failed: 0, items: [] });
  }

  // 2) Enriquece com dados do PC (batch)
  type Key = string;
  const keyOf = (e: string, n: number): Key => `${e}::${n}`;
  const keys = (approvals as { empresa: string; ncod_ped: number }[]).map(a => keyOf(a.empresa, a.ncod_ped));
  const { data: pcs } = await admin
    .schema("approval").from("v_pc_completo_enriched")
    .select("empresa, ncod_ped, pc_numero, contato_fornecedor, nome_fornecedor, pc_forma_pagamento, valor_total, projeto_nome, pv_os_label, status_label")
    .in("empresa", Array.from(new Set((approvals as { empresa: string }[]).map(a => a.empresa))))
    .in("ncod_ped", Array.from(new Set((approvals as { ncod_ped: number }[]).map(a => a.ncod_ped))));

  const pcMap = new Map<Key, Partial<ApprovalRow>>();
  for (const pc of (pcs ?? []) as { empresa: string; ncod_ped: number }[] & Partial<ApprovalRow>[]) {
    pcMap.set(keyOf(pc.empresa, pc.ncod_ped), pc);
  }

  // 3) Monta rows enriquecidas + filtra só as que estão no scope
  const enriched: ApprovalRow[] = (approvals as {
    empresa: string; ncod_ped: number; status: string; aprovador_email: string | null;
    valor_aprovado: number | string | null; aprovado_em: string;
  }[]).map(a => {
    const pc = pcMap.get(keyOf(a.empresa, a.ncod_ped)) ?? {};
    return {
      empresa: a.empresa,
      ncod_ped: a.ncod_ped,
      status: a.status,
      aprovador_email: a.aprovador_email,
      valor_aprovado: a.valor_aprovado,
      aprovado_em: a.aprovado_em,
      pc_numero: pc.pc_numero ?? null,
      contato_fornecedor: pc.contato_fornecedor ?? null,
      nome_fornecedor: pc.nome_fornecedor ?? null,
      pc_forma_pagamento: pc.pc_forma_pagamento ?? null,
      valor_total: pc.valor_total ?? null,
      projeto_nome: pc.projeto_nome ?? null,
      pv_os_label: pc.pv_os_label ?? null,
      status_label: pc.status_label ?? null,
    };
  });

  // Se scope=specific, filtro extra ficou implícito na query acima
  const rows = scope === "specific"
    ? enriched.filter(r => r.empresa === body.empresa && r.ncod_ped === body.ncod_ped)
    : enriched;

  // 4) Envia (ou preview em dryRun)
  const items: { pc_numero: string | null; empresa: string; ncod_ped: number; ok: boolean; error?: string; preview?: string }[] = [];
  let sent = 0, failed = 0;

  for (const r of rows) {
    const markdown = buildApprovalMarkdown({
      pc_numero: r.pc_numero,
      contato_fornecedor: r.contato_fornecedor,
      nome_fornecedor: r.nome_fornecedor,
      pc_forma_pagamento: r.pc_forma_pagamento,
      valor: r.valor_aprovado != null ? Number(r.valor_aprovado) : (r.valor_total != null ? Number(r.valor_total) : null),
      projeto_nome: r.projeto_nome,
      pv_os_label: r.pv_os_label,
      aprovador_email: r.aprovador_email,
      status_label: r.status_label ?? "Aprovado!",
    });

    if (dryRun) {
      items.push({ pc_numero: r.pc_numero, empresa: r.empresa, ncod_ped: r.ncod_ped, ok: true, preview: markdown });
      continue;
    }

    const res = await postWebexMessage(markdown);
    if (res.ok) {
      sent++;
      items.push({ pc_numero: r.pc_numero, empresa: r.empresa, ncod_ped: r.ncod_ped, ok: true });
    } else {
      failed++;
      items.push({ pc_numero: r.pc_numero, empresa: r.empresa, ncod_ped: r.ncod_ped, ok: false, error: res.error });
    }
    // Rate-limit friendly: 250ms entre posts (Webex tolera muito mais, mas conservador)
    await new Promise(r => setTimeout(r, 250));
  }

  return NextResponse.json({ scope, dryRun, sent, failed, total: rows.length, items });
}
