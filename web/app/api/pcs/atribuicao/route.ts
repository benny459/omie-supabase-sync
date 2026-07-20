// Atribuição manual PC → cliente(s) com rateio.
// GET   → { backlog: [PCs standalone SEM atribuição], atribuidos: [PCs COM] }
// POST  → { empresa, pc_numero, atribuicoes: [{codigo_cliente_omie, percentual}] }
//         Soma dos percentuais tem que dar 100. Substitui atribuição anterior (upsert set).
// DELETE?empresa=&pc_numero= → remove todas atribuições de 1 PC

import { NextRequest, NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "platform" } },
  );
}

async function requireUser() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  return user;
}

type Atrib = { codigo_cliente_omie: number; percentual: number };

// ─────────────────────────────────────────────────────────────────
// GET — retorna backlog (PCs standalone sem atribuição) + atribuidos
// ─────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const soBacklog = url.searchParams.get("backlog") === "1";

  const svc = admin();

  // Backlog: PCs aprovados sem PV origem AND sem atribuição
  // Uso query direta via SQL RPC? Não — vou fazer via 2 queries e cruzar.
  // 1. Todas atribuições vigentes (empresa+pc_numero → array de clientes)
  const { data: atribsData, error: atribErr } = await svc
    .schema("platform" as never).from("pc_cliente_atribuicao")
    .select("empresa, pc_numero, codigo_cliente_omie, percentual, criado_por, atualizado_em");
  if (atribErr) return NextResponse.json({ error: atribErr.message }, { status: 500 });

  // Nomes dos clientes atribuídos (batch em finance.clientes)
  const codigosAtrib = Array.from(new Set((atribsData ?? []).map(a => a.codigo_cliente_omie)));
  const nomeMap = new Map<number, string>();
  if (codigosAtrib.length > 0) {
    const svcFin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false }, db: { schema: "finance" } },
    );
    const { data: cliData } = await svcFin.from("clientes")
      .select("codigo_cliente_omie, razao_social, nome_fantasia")
      .in("codigo_cliente_omie", codigosAtrib);
    for (const c of (cliData ?? []) as { codigo_cliente_omie: number; razao_social: string; nome_fantasia: string | null }[]) {
      nomeMap.set(c.codigo_cliente_omie, c.nome_fantasia || c.razao_social);
    }
  }

  const atribsByPc = new Map<string, { codigo_cliente_omie: number; nome: string; percentual: number; criado_por: string | null; atualizado_em: string }[]>();
  for (const a of (atribsData ?? [])) {
    const k = `${a.empresa}::${a.pc_numero}`;
    const arr = atribsByPc.get(k) ?? [];
    arr.push({ codigo_cliente_omie: a.codigo_cliente_omie, nome: nomeMap.get(a.codigo_cliente_omie) ?? `Omie #${a.codigo_cliente_omie}`, percentual: Number(a.percentual), criado_por: a.criado_por, atualizado_em: a.atualizado_em });
    atribsByPc.set(k, arr);
  }

  // 2. PCs aprovados standalone (sem pv_cliente_codigo) — em approval schema
  const svcApproval = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "approval" } },
  );
  const PAGE = 1000;
  type PcRow = { empresa: string; pc_numero: string; valor_total: string; projeto_nome: string | null; codigo_projeto: number | null; _dt_inclusao_d: string; pv_cliente_codigo: number | null };
  const standalone: PcRow[] = [];
  // TODOS os standalones (aprovados + pendentes), pra permitir pré-atribuição
  // antes de aprovar. Guard de aprovação segue exigindo atribuição em set-status.
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await svcApproval.from("v_pc_pcs")
      .select("empresa, pc_numero, valor_total, projeto_nome, codigo_projeto, _dt_inclusao_d, pv_cliente_codigo")
      .is("pv_cliente_codigo", null)
      .not("_dt_inclusao_d", "is", null)
      .order("_dt_inclusao_d", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as PcRow[];
    standalone.push(...batch);
    if (batch.length < PAGE) break;
    if (offset > 20_000) break;
  }

  // Classifica: backlog (sem atrib) vs atribuidos
  const backlog: (PcRow & { qtd_clientes: 0 })[] = [];
  const atribuidos: (PcRow & { qtd_clientes: number; clientes: { codigo_cliente_omie: number; nome: string; percentual: number }[]; soma_pct: number })[] = [];
  for (const p of standalone) {
    const k = `${p.empresa}::${p.pc_numero}`;
    const atribs = atribsByPc.get(k);
    if (!atribs || atribs.length === 0) {
      backlog.push({ ...p, qtd_clientes: 0 });
    } else {
      atribuidos.push({ ...p, qtd_clientes: atribs.length, clientes: atribs.map(a => ({ codigo_cliente_omie: a.codigo_cliente_omie, nome: a.nome, percentual: a.percentual })), soma_pct: atribs.reduce((a, x) => a + x.percentual, 0) });
    }
  }

  return NextResponse.json({
    resumo: {
      total_standalone: standalone.length,
      backlog: backlog.length,
      atribuidos: atribuidos.length,
      valor_backlog: backlog.reduce((a, p) => a + (Number(p.valor_total) || 0), 0),
    },
    backlog: soBacklog ? backlog : backlog.slice(0, 500),
    atribuidos: soBacklog ? [] : atribuidos.slice(0, 500),
  });
}

// ─────────────────────────────────────────────────────────────────
// POST — cria/substitui atribuição de 1 PC
// ─────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { empresa?: string; pc_numero?: string; atribuicoes?: Atrib[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }

  const empresa = String(body.empresa ?? "").trim();
  const pc = String(body.pc_numero ?? "").trim();
  const atribs = body.atribuicoes ?? [];

  if (!empresa || !pc) return NextResponse.json({ error: "empresa e pc_numero obrigatórios" }, { status: 400 });
  if (!Array.isArray(atribs) || atribs.length === 0) {
    return NextResponse.json({ error: "atribuicoes precisa ter pelo menos 1 cliente" }, { status: 400 });
  }
  const soma = atribs.reduce((a, x) => a + (Number(x.percentual) || 0), 0);
  if (Math.abs(soma - 100) > 0.01) {
    return NextResponse.json({ error: `Soma dos percentuais precisa ser 100.00 (recebido: ${soma.toFixed(2)})` }, { status: 400 });
  }
  const dedupClientes = new Set(atribs.map(a => a.codigo_cliente_omie));
  if (dedupClientes.size !== atribs.length) {
    return NextResponse.json({ error: "Cliente duplicado na lista" }, { status: 400 });
  }
  for (const a of atribs) {
    if (!Number.isFinite(a.codigo_cliente_omie) || a.codigo_cliente_omie <= 0) {
      return NextResponse.json({ error: "codigo_cliente_omie inválido" }, { status: 400 });
    }
    if (!(a.percentual > 0 && a.percentual <= 100)) {
      return NextResponse.json({ error: "percentual precisa ser > 0 e ≤ 100" }, { status: 400 });
    }
  }

  const svc = admin();
  // Estratégia: DELETE + INSERT (substitui atribuição anterior)
  const { error: delErr } = await svc.schema("platform" as never)
    .from("pc_cliente_atribuicao")
    .delete().eq("empresa", empresa).eq("pc_numero", pc);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const rows = atribs.map(a => ({
    empresa, pc_numero: pc,
    codigo_cliente_omie: a.codigo_cliente_omie,
    percentual: a.percentual,
    criado_por: user.email ?? null,
  }));
  const { error: insErr } = await svc.schema("platform" as never)
    .from("pc_cliente_atribuicao").insert(rows);
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, pc_numero: pc, atribuicoes: rows.length });
}

// ─────────────────────────────────────────────────────────────────
// DELETE — remove todas atribuições de 1 PC (volta pro backlog)
// ─────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const empresa = url.searchParams.get("empresa") ?? "";
  const pc = url.searchParams.get("pc_numero") ?? "";
  if (!empresa || !pc) return NextResponse.json({ error: "empresa e pc_numero obrigatórios" }, { status: 400 });

  const svc = admin();
  const { error } = await svc.schema("platform" as never)
    .from("pc_cliente_atribuicao")
    .delete().eq("empresa", empresa).eq("pc_numero", pc);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
