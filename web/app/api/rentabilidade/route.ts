// Rentabilidade da cadeia de venda (P6, 05/10/2026) — lê sales.mv_rentab_pvos
// (sql/54): PV/OS × RC × PC × NF de entrada × pago × faturado × recebido.
//
//   GET  ?modo=lista&de=&ate=&empresa=&projeto=   → PV/OS do período (BI/Financeiro)
//   GET  ?modo=cadeia&empresa=SF&pedido=PV1827     → a cadeia de um pedido (BI/Financeiro)
//   POST { chaves: ["SF|PV1827", …] }              → selos Pago/Receb. da Avulsos (Operação),
//                                                    sem valores em R$
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { selectPaginado } from "@/lib/supabase-paginado";
import type { RentabPvos, RentabResumo } from "@/lib/rentabilidade";

export const runtime = "nodejs";
export const maxDuration = 60;

const adm = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false }, db: { schema: "sales" } },
);

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ROTULO = /^(PV|OS)\d+$/;

async function quem() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  return loadPerms();
}

export async function GET(req: Request) {
  const perms = await quem();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "bi") && !canViewArea(perms, "financeiro")) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }
  const url = new URL(req.url);
  const modo = url.searchParams.get("modo") ?? "lista";
  const empresa = (url.searchParams.get("empresa") ?? "").toUpperCase();

  if (modo === "cadeia") {
    const pedido = (url.searchParams.get("pedido") ?? "").toUpperCase().replace(/\s/g, "");
    if (!empresa || !ROTULO.test(pedido)) return NextResponse.json({ error: "empresa e pedido (PV/OS) obrigatórios" }, { status: 400 });
    const { data, error } = await adm().rpc("rentab_cadeia", { p_empresa: empresa, p_label: pedido });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const de = url.searchParams.get("de");
  const ate = url.searchParams.get("ate");
  const projeto = (url.searchParams.get("projeto") ?? "").trim();
  const { data, error } = await selectPaginado<RentabPvos>(() => {
    let q = adm().from("mv_rentab_pvos").select("*").order("emissao", { ascending: false }).order("label");
    if (de && DATA.test(de)) q = q.gte("emissao", de);
    if (ate && DATA.test(ate)) q = q.lte("emissao", ate);
    if (empresa && /^[A-Z]{2,4}$/.test(empresa)) q = q.eq("empresa", empresa);
    if (projeto) q = q.eq("projeto", projeto);
    return q;
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ linhas: data ?? [] });
}

export async function POST(req: Request) {
  const perms = await quem();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "operacao")) return NextResponse.json({ error: "Sem acesso" }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { chaves?: unknown };
  const chaves = Array.isArray(body.chaves) ? body.chaves.filter((c): c is string => typeof c === "string") : [];
  const porEmpresa = new Map<string, Set<string>>();
  for (const c of chaves.slice(0, 5000)) {
    const [emp, rot] = c.split("|");
    if (!emp || !rot || !ROTULO.test(rot)) continue;
    porEmpresa.set(emp, (porEmpresa.get(emp) ?? new Set()).add(rot));
  }

  const resumo: Record<string, RentabResumo> = {};
  for (const [emp, rots] of porEmpresa) {
    const lista = [...rots];
    for (let i = 0; i < lista.length; i += 300) {
      const { data, error } = await adm().from("mv_rentab_pvos")
        .select("empresa,label,n_pc,n_pago,pago_ok,faturado,recebido_ok,titulos_receber,recebido")
        .eq("empresa", emp).in("label", lista.slice(i, i + 300));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const r of (data ?? []) as (RentabPvos & { empresa: string })[]) {
        resumo[`${r.empresa}|${r.label}`] = {
          n_pc: r.n_pc, n_pago: r.n_pago, pago_ok: r.pago_ok,
          faturado: r.faturado, recebido_ok: r.recebido_ok,
          pct_recebido: Number(r.titulos_receber) > 0 ? Math.min(1, Number(r.recebido) / Number(r.titulos_receber)) : null,
        };
      }
    }
  }
  return NextResponse.json({ resumo });
}
