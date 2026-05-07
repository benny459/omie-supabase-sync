import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { postWebexMessage, buildApprovalMarkdown } from "@/lib/webex";

export const runtime = "nodejs";

type Row = { empresa: string; ncod_ped: number; modulo?: string; valorPc?: number | null };
type Body = { rows: Row[]; status: string };

const APPROVED_SET = new Set(["APROVADO", "APROVADO_FAT_DIRETO"]);
const ADMIN_ONLY_STATUS = new Set(["CANCELAR_PEDIDO"]);

/**
 * Atualiza status de várias approvals de uma vez. Se o status final é
 * aprovado, posta 1 mensagem consolidada no Webex com a lista de PCs.
 */
export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.status || !Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "rows[] e status obrigatórios" }, { status: 400 });
  }
  if (body.rows.length > 200) {
    return NextResponse.json({ error: "máximo 200 itens por lote" }, { status: 400 });
  }

  if (ADMIN_ONLY_STATUS.has(body.status)) {
    const { data: me } = await supa
      .schema("platform" as never).from("user_profiles")
      .select("is_admin, role").eq("id", user.id).maybeSingle();
    const row = me as { is_admin?: boolean; role?: string } | null;
    const isAdmin = row?.is_admin === true || row?.role === "admin";
    if (!isAdmin) {
      return NextResponse.json({ error: "Somente admin pode aplicar este status" }, { status: 403 });
    }
  }

  const becomingApproved = APPROVED_SET.has(body.status);
  const nowIso = new Date().toISOString();
  const patchBase: Record<string, unknown> = { status: body.status };
  if (becomingApproved) {
    patchBase.aprovador_email = user.email ?? null;
    patchBase.aprovado_em     = nowIso;
  } else {
    patchBase.aprovador_email = null;
    patchBase.aprovado_em     = null;
    patchBase.valor_aprovado  = null;
  }

  // Upserts em paralelo (RLS valida cada um — admin/aprovador)
  const results = await Promise.all(body.rows.map(async (r) => {
    const patch = becomingApproved
      ? { ...patchBase, valor_aprovado: r.valorPc ?? null }
      : patchBase;
    const { error } = await supa.from("approvals").upsert(
      { empresa: r.empresa, ncod_ped: r.ncod_ped, modulo: r.modulo ?? "avulsos", source: "native", ...patch },
      { onConflict: "empresa,ncod_ped" },
    );
    return { empresa: r.empresa, ncod_ped: r.ncod_ped, ok: !error, error: error?.message };
  }));
  const failed = results.filter(x => !x.ok);
  const ok = results.filter(x => x.ok);

  // Notifica Webex com um card consolidado
  let webex: { ok: boolean; error?: string } | null = null;
  if (becomingApproved && ok.length > 0) {
    const admin = supaAdmin();
    const { data: pcs } = await admin
      .schema("approval")
      .from("v_pc_completo_enriched")
      .select("pc_numero, contato_fornecedor, nome_fornecedor, pc_forma_pagamento, valor_total, projeto_nome, pv_os_label, status_label, empresa, ncod_ped")
      .in("empresa", ok.map(o => o.empresa))
      .in("ncod_ped", ok.map(o => o.ncod_ped));

    const list = (pcs ?? []) as Array<{
      pc_numero?: string | null;
      contato_fornecedor?: string | null;
      nome_fornecedor?: string | null;
      pc_forma_pagamento?: string | null;
      valor_total?: number | null;
      projeto_nome?: string | null;
      pv_os_label?: string | null;
      status_label?: string | null;
    }>;

    if (list.length === 1) {
      const p = list[0];
      webex = await postWebexMessage(buildApprovalMarkdown({
        pc_numero: p.pc_numero, contato_fornecedor: p.contato_fornecedor,
        nome_fornecedor: p.nome_fornecedor, pc_forma_pagamento: p.pc_forma_pagamento,
        valor: p.valor_total ?? null, projeto_nome: p.projeto_nome,
        pv_os_label: p.pv_os_label, aprovador_email: user.email ?? null,
        status_label: p.status_label ?? body.status,
      }));
    } else {
      const total = list.reduce((s, p) => s + (Number(p.valor_total) || 0), 0);
      const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
      const lines = [
        `### ✅ ${list.length} PCs aprovados em lote`,
        ``,
        `**Aprovado por:** ${user.email ?? "—"}`,
        `**Total:** ${fmtBRL(total)}`,
        ``,
        ...list.map(p => {
          const forn = p.nome_fornecedor ?? p.contato_fornecedor ?? "—";
          const pgto = p.pc_forma_pagamento ? ` · pgto: ${p.pc_forma_pagamento}` : "";
          const proj = p.projeto_nome ? ` · ${p.projeto_nome}` : "";
          return `- **${p.pc_numero ?? "—"}** · ${forn} · ${fmtBRL(Number(p.valor_total) || 0)}${pgto}${proj}`;
        }),
      ];
      webex = await postWebexMessage(lines.join("\n"));
    }
  }

  return NextResponse.json({ ok: failed.length === 0, count: ok.length, failed, webex });
}
