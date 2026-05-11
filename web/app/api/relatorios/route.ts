// API: relatório de aprovações. Filtro por janela de aprovado_em.
// GET /api/relatorios?from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Retorna:
//   kpis:     totalValor, totalAprovacoes, ticketMedio, maiorAprovacao
//   byModulo: [{modulo, valor, count}, ...]
//   rows:     lista de aprovações com PV/OS/PC/fornecedor/projeto
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const APPROVED_STATUSES = ["APROVADO", "APROVADO_FAT_DIRETO"];

export async function GET(req: Request) {
  // Qualquer user autenticado vê (RLS em approval.approvals já restringe se preciso)
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from"); // YYYY-MM-DD ou null
  const to   = url.searchParams.get("to");

  // Default: últimos 30 dias
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const fromIso = (from || new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)) + "T00:00:00";
  // 'to' inclusive até 23:59:59
  const toIso = (to || today.toISOString().slice(0, 10)) + "T23:59:59";

  const admin = supaAdmin();

  // Pega TODAS as aprovações na janela com info enriquecida (via view)
  const { data, error } = await admin
    .schema("approval")
    .from("v_pc_completo_enriched")
    .select(`
      empresa, ncod_ped, modulo,
      pc_numero, pc_numero_manual,
      pv_os_label, pv_os_tipo,
      contato_fornecedor, nome_fornecedor,
      projeto_nome,
      pv_cliente_fantasia,
      valor_aprovado, valor_total, aprovado_em, aprovador_email, status
    `)
    .gte("aprovado_em", fromIso)
    .lte("aprovado_em", toIso)
    .in("status", APPROVED_STATUSES)
    .order("aprovado_em", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // Agregados
  let totalValor = 0, maiorAprovacao = 0;
  const byModulo = new Map<string, { valor: number; count: number }>();
  for (const r of rows) {
    const v = Number(r.valor_aprovado ?? r.valor_total ?? 0);
    totalValor += v;
    if (v > maiorAprovacao) maiorAprovacao = v;
    const m = String(r.modulo ?? "outros");
    const cur = byModulo.get(m) ?? { valor: 0, count: 0 };
    cur.valor += v; cur.count += 1;
    byModulo.set(m, cur);
  }

  return NextResponse.json({
    range: { from: fromIso.slice(0, 10), to: toIso.slice(0, 10) },
    kpis: {
      totalValor,
      totalAprovacoes: rows.length,
      ticketMedio: rows.length > 0 ? totalValor / rows.length : 0,
      maiorAprovacao,
    },
    byModulo: ["avulsos", "projetos", "pcs"].map((m) => ({
      modulo: m,
      valor: byModulo.get(m)?.valor ?? 0,
      count: byModulo.get(m)?.count ?? 0,
    })),
    rows: rows.map((r) => ({
      aprovado_em: r.aprovado_em,
      modulo: r.modulo,
      empresa: r.empresa,
      ncod_ped: r.ncod_ped,
      pc: r.pc_numero ?? r.pc_numero_manual ?? null,
      pv_os: r.pv_os_label ?? null,
      pv_os_tipo: r.pv_os_tipo ?? null,
      fornecedor: r.nome_fornecedor ?? r.contato_fornecedor ?? null,
      projeto: r.projeto_nome ?? null,
      cliente: r.pv_cliente_fantasia ?? null,
      valor: Number(r.valor_aprovado ?? r.valor_total ?? 0),
      aprovador: r.aprovador_email ?? null,
    })),
  });
}
