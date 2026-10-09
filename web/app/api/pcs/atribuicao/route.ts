// Atribuição manual PC → cliente(s) com rateio.
// GET   → { backlog: [PCs standalone SEM atribuição], atribuidos: [PCs COM] }
// POST  → { empresa, pc_numero, atribuicoes: [{codigo_cliente_omie, percentual}] }
//         Soma dos percentuais tem que dar 100. Substitui atribuição anterior (upsert set).
// DELETE?empresa=&pc_numero= → remove todas atribuições de 1 PC

import { NextRequest, NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { validarAtribuicoes, montarMapaAtrib } from "@/lib/pc-atribuicao";

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

function svcFinance() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );
}

async function nomesClientes(codigos: number[]): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  const unicos = Array.from(new Set(codigos.filter((c) => Number.isFinite(c))));
  if (unicos.length === 0) return m;
  const { data } = await svcFinance().from("clientes")
    .select("codigo_cliente_omie, razao_social, nome_fantasia").in("codigo_cliente_omie", unicos);
  for (const c of (data ?? []) as { codigo_cliente_omie: number; razao_social: string; nome_fantasia: string | null }[]) {
    if (!m.has(c.codigo_cliente_omie)) m.set(c.codigo_cliente_omie, c.nome_fantasia || c.razao_social);
  }
  return m;
}

type LinhaAtrib = { empresa: string; pc_numero: string; codigo_cliente_omie: number; percentual: number | string };

/** Lê o que está gravado (todas, ou de 1 PC) e devolve linhas com nome — base do "mapa" das telas. */
async function lerAtribuicoes(filtro?: { empresa: string; pc: string }) {
  let q = admin().schema("platform" as never).from("pc_cliente_atribuicao")
    .select("empresa, pc_numero, codigo_cliente_omie, percentual");
  if (filtro) q = q.eq("empresa", filtro.empresa).eq("pc_numero", filtro.pc);
  const { data, error } = await q;
  if (error) return { error: error.message, linhas: [] as (LinhaAtrib & { nome: string })[] };
  const linhas = (data ?? []) as LinhaAtrib[];
  const nomes = await nomesClientes(linhas.map((l) => Number(l.codigo_cliente_omie)));
  return { error: null, linhas: linhas.map((l) => ({ ...l, percentual: Number(l.percentual), nome: nomes.get(Number(l.codigo_cliente_omie)) ?? `Omie #${l.codigo_cliente_omie}` })) };
}

// ─────────────────────────────────────────────────────────────────
// GET — retorna backlog (PCs standalone sem atribuição) + atribuidos
// ─────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const soBacklog = url.searchParams.get("backlog") === "1";

  // 09/10/26: ?mapa=1 → só o que está gravado (rápido; as telas da Operação usam isto para
  // pintar "Clientes ✓"). Antes elas usavam o GET completo, que varre approval.v_pc_pcs e só
  // devolve PCs que estão nessa view — PC fora dela nunca aparecia como atribuído.
  // ?empresa=&pc_numero= → só 1 PC (confirmação depois de salvar).
  const pcUnico = url.searchParams.get("pc_numero");
  if (url.searchParams.get("mapa") === "1" || pcUnico) {
    const filtro = pcUnico ? { empresa: url.searchParams.get("empresa") || "SF", pc: pcUnico } : undefined;
    const r = await lerAtribuicoes(filtro);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 500 });
    const mapa = montarMapaAtrib(r.linhas);
    const atribuidos = [...mapa.entries()].map(([k, v]) => {
      const [empresa, pc_numero] = k.split("|");
      return { empresa, pc_numero, qtd_clientes: v.qtd, soma_pct: v.soma_pct, clientes: v.clientes };
    });
    return NextResponse.json({ atribuidos }, { headers: { "Cache-Control": "no-store" } });
  }

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
  const atribs = (body.atribuicoes ?? []) as Atrib[];

  if (!empresa || !pc) return NextResponse.json({ error: "PC sem número/empresa — feche o quadro, recarregue a página e tente de novo." }, { status: 400 });
  const invalido = validarAtribuicoes(atribs);
  if (invalido) return NextResponse.json({ error: invalido }, { status: 400 });

  const svc = admin();
  const tabela = () => svc.schema("platform" as never).from("pc_cliente_atribuicao");

  // Guarda o que havia, para devolver se a gravação nova falhar no meio (antes: DELETE ok +
  // INSERT com erro = PC ficava sem atribuição nenhuma).
  const { data: antigas, error: lerErr } = await tabela()
    .select("empresa, pc_numero, codigo_cliente_omie, percentual, criado_por").eq("empresa", empresa).eq("pc_numero", pc);
  if (lerErr) return NextResponse.json({ error: lerErr.message }, { status: 500 });

  // Estratégia: DELETE + INSERT (substitui atribuição anterior)
  const { error: delErr } = await tabela().delete().eq("empresa", empresa).eq("pc_numero", pc);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const rows = atribs.map(a => ({
    empresa, pc_numero: pc,
    codigo_cliente_omie: Number(a.codigo_cliente_omie),
    percentual: Math.round(Number(a.percentual) * 100) / 100,
    criado_por: user.email ?? null,
  }));
  const { error: insErr } = await tabela().insert(rows);
  if (insErr) {
    if ((antigas ?? []).length > 0) await tabela().insert(antigas as never[]);
    return NextResponse.json({ error: `${insErr.message} — a atribuição anterior foi mantida.` }, { status: 500 });
  }

  // Confirmação real: lê de volta do banco o que ficou gravado e devolve para a tela.
  const lido = await lerAtribuicoes({ empresa, pc });
  if (lido.error) return NextResponse.json({ error: `Gravou, mas não consegui conferir: ${lido.error}. Recarregue a página para ver.` }, { status: 500 });
  const info = montarMapaAtrib(lido.linhas).get(`${empresa}|${pc}`);
  return NextResponse.json({ ok: true, empresa, pc_numero: pc, atribuicoes: rows.length, clientes: info?.clientes ?? [], soma_pct: info?.soma_pct ?? 0 });
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
