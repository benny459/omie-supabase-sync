import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { postWebexMessage, buildApprovalMarkdown } from "@/lib/webex";

export const runtime = "nodejs";

type Body = {
  empresa: string;
  ncod_ped: number;
  status: string;
  modulo?: string;
  // snapshot do valor no momento da aprovação (do row na UI)
  valorPc?: number | null;
};

// Status que contam como "aprovado" — precisam notificação Webex
const APPROVED_SET = new Set(["APROVADO", "APROVADO_FAT_DIRETO"]);
// Status sensível — só admin pode aplicar
const ADMIN_ONLY_STATUS = new Set(["CANCELAR_PEDIDO"]);

export async function POST(req: Request) {
  // Valida autenticação
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.empresa || body.ncod_ped == null || !body.status) {
    return NextResponse.json({ error: "empresa, ncod_ped, status obrigatórios" }, { status: 400 });
  }

  // Gate admin-only pra CANCELAR_PEDIDO
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
  const modulo = body.modulo ?? "avulsos";

  // Para aprovações em /pcs, valida alçada individual e teto semanal.
  // Demais módulos só dependem de can_approve (RLS já cobre).
  if (becomingApproved && modulo === "pcs" && body.valorPc != null) {
    const admin = supaAdmin();
    const { data: profileRow } = await admin
      .schema("platform").from("user_profiles")
      .select("is_admin").eq("id", user.id).maybeSingle();
    const isAdmin = (profileRow as { is_admin?: boolean } | null)?.is_admin === true;

    if (!isAdmin) {
      const { data: roleRow } = await admin
        .schema("platform").from("user_module_roles")
        .select("can_approve, approval_ceiling_brl, weekly_budget_brl")
        .eq("user_id", user.id).eq("modulo", "pcs").maybeSingle();
      const r = roleRow as {
        can_approve?: boolean;
        approval_ceiling_brl?: number | null;
        weekly_budget_brl?: number | null;
      } | null;
      if (!r?.can_approve) {
        return NextResponse.json({ error: "Sem permissão pra aprovar PCs Standalone" }, { status: 403 });
      }
      const valor = Number(body.valorPc);
      if (r.approval_ceiling_brl != null && valor > Number(r.approval_ceiling_brl)) {
        return NextResponse.json({
          error: `Acima da sua alçada (R$ ${Number(r.approval_ceiling_brl).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}). Valor: R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
        }, { status: 403 });
      }
      if (r.weekly_budget_brl != null) {
        const { data: spent } = await admin.rpc("user_weekly_approved" as never, {
          p_user_id: user.id, p_modulo: "pcs",
        } as never);
        const already = Number(spent ?? 0);
        const remaining = Number(r.weekly_budget_brl) - already;
        if (valor > remaining) {
          return NextResponse.json({
            error: `Excede teto semanal (resta R$ ${remaining.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} dos R$ ${Number(r.weekly_budget_brl).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}). Valor solicitado: R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
          }, { status: 403 });
        }
      }
    }
  }

  // UPSERT do status (RLS valida: admin ou aprovador do módulo)
  const patch: Record<string, unknown> = { status: body.status };
  if (becomingApproved) {
    patch.aprovador_email = user.email ?? null;
    patch.aprovado_em     = nowIso;
    patch.valor_aprovado  = body.valorPc ?? null;
  } else {
    patch.aprovador_email = null;
    patch.aprovado_em     = null;
    patch.valor_aprovado  = null;
  }

  if (becomingApproved) patch.aprovador_id = user.id;
  const { error: uErr } = await supa.from("approvals").upsert(
    {
      empresa: body.empresa,
      ncod_ped: body.ncod_ped,
      modulo,
      source: "native",
      ...patch,
    },
    { onConflict: "empresa,ncod_ped" },
  );
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  // Se não ficou aprovado, termina aqui (sem notificação)
  if (!becomingApproved) return NextResponse.json({ ok: true });

  // Busca os dados do PC pra montar a mensagem (via service role — bypassa RLS e lê views)
  const admin = supaAdmin();
  const { data: pc } = await admin
    .schema("approval")
    .from("v_pc_completo_enriched")
    .select("pc_numero, contato_fornecedor, nome_fornecedor, pc_forma_pagamento, valor_total, projeto_nome, pv_os_label, status_label")
    .eq("empresa", body.empresa)
    .eq("ncod_ped", body.ncod_ped)
    .limit(1)
    .maybeSingle();

  const row = (pc ?? {}) as {
    pc_numero?: string | null;
    contato_fornecedor?: string | null;
    nome_fornecedor?: string | null;
    pc_forma_pagamento?: string | null;
    valor_total?: number | null;
    projeto_nome?: string | null;
    pv_os_label?: string | null;
    status_label?: string | null;
  };

  const markdown = buildApprovalMarkdown({
    pc_numero: row.pc_numero,
    contato_fornecedor: row.contato_fornecedor,
    nome_fornecedor: row.nome_fornecedor,
    pc_forma_pagamento: row.pc_forma_pagamento,
    valor: body.valorPc ?? row.valor_total ?? null,
    projeto_nome: row.projeto_nome,
    pv_os_label: row.pv_os_label,
    aprovador_email: user.email ?? null,
    status_label: row.status_label ?? body.status,
  });

  const webex = await postWebexMessage(markdown);
  // Não falha a request se o Webex falhar — a aprovação no banco já foi persistida.
  return NextResponse.json({ ok: true, webex });
}
