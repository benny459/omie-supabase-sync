// /api/catalogo/projeto — catálogo da lista de materiais do projeto (07/10/26).
// Itens NOSSOS primeiro, com o código novo (mesma fonte do Faturamento).
//   GET  ?op=buscar&q=bomba            → { itens: ItemLista[] (nossos), compra: ItemLista[] (só no Omie) }
//   GET  ?op=sugerir&q=…&custo=&un=    → { itens: [{ id, cod, desc, un, score, motivo }] }  (3 mais parecidos)
//   GET  ?op=preparar&descricao=…      → { parecidos, familias, familia_sugerida }           (para "Criar item nosso")
//   POST { acao: "casar", textos[], custos?[] }  → { casamentos: CasamentoLista[] }
//   POST { acao: "resolver", ids[] }             → { itens: { [ncod]: ItemLista } }  (código do Omie → item nosso)
//   POST { acao: "vincular", texto, ncod_prod }  → grava o de-para texto → item nosso e devolve o item
// Qualquer usuário logado (a lista de materiais é de todos que veem o projeto).
// Criar item no estoque continua em /api/estoque/vinculos (permissão de Estoque/Faturamento).
// Nada vai ao Omie.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { buscarItensProjeto, casarItensProjeto, prepararCadastroItem, resolverItensProjeto } from "@/lib/catalogo-projeto";
import { casarTopCrm, vincularCrm } from "@/lib/catalogo-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function usuario() {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  return user;
}
const erro = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function GET(req: Request) {
  if (!(await usuario())) return erro("Sessão expirada — entre de novo", 401);
  const sp = new URL(req.url).searchParams;
  const emp = (sp.get("emp") ?? "SF").toUpperCase();
  const op = sp.get("op") ?? "buscar";
  try {
    if (op === "buscar") return NextResponse.json(await buscarItensProjeto(emp, (sp.get("q") ?? "").slice(0, 120), Number(sp.get("lim") ?? 12)));
    if (op === "sugerir") {
      const q = (sp.get("q") ?? "").trim();
      if (q.length < 2) return NextResponse.json({ itens: [] });
      const [lista] = await casarTopCrm([q], [Number(sp.get("custo")) || null], [sp.get("un")], 3, emp);
      return NextResponse.json({ itens: lista ?? [] });
    }
    if (op === "preparar") return NextResponse.json(await prepararCadastroItem(emp, sp.get("descricao") ?? "", Number(sp.get("origem") ?? 0)));
    return erro("op inválida");
  } catch (e) { return erro(e instanceof Error ? e.message : String(e), 500); }
}

export async function POST(req: Request) {
  const user = await usuario();
  if (!user) return erro("Sessão expirada — entre de novo", 401);
  const b = (await req.json().catch(() => ({}))) as { acao?: string; emp?: string; textos?: unknown[]; custos?: unknown[];
    ids?: unknown[]; texto?: string; ncod_prod?: number };
  const emp = String(b.emp ?? "SF").toUpperCase();
  try {
    if (b.acao === "casar") {
      if (!Array.isArray(b.textos)) return erro("textos[] obrigatório");
      if (b.textos.length > 1000) return erro("Máximo de 1000 linhas por vez");
      const custos = Array.isArray(b.custos) ? b.custos.map((c) => (c == null ? null : Number(c) || null)) : [];
      return NextResponse.json({ casamentos: await casarItensProjeto(emp, b.textos.map((t) => String(t ?? "").slice(0, 300)), custos) });
    }
    if (b.acao === "resolver") {
      const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter((x) => x > 0) : [];
      return NextResponse.json({ itens: await resolverItensProjeto(emp, ids) });
    }
    if (b.acao === "vincular") {
      const texto = String(b.texto ?? "").trim();
      const id = Number(b.ncod_prod);
      if (!texto || !id) return erro("texto e ncod_prod obrigatórios");
      await vincularCrm({ descricao_compra: texto, ncod_prod: id, por: `painel:${user.email ?? user.id}`, empresa: emp });
      const r = await resolverItensProjeto(emp, [id]);
      return NextResponse.json({ ok: true, item: r[String(id)] ?? null });
    }
    return erro("acao inválida (casar | resolver | vincular)");
  } catch (e) { return erro(e instanceof Error ? e.message : String(e), 500); }
}
