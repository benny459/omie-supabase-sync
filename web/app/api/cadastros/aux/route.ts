// Cadastros auxiliares (sql/63): projetos, contas, categorias, centros de custo,
// condições de pagamento, tipos de documento, vendedores, serviços, unidades, empresas.
//
// GET  /api/cadastros/aux?reg=projetos&emp=SF&q=&todos=1&off=0   → lista
// GET  /api/cadastros/aux?reg=projetos&emp=SF&opcoes=1             → lista curta para seletores
// GET  /api/cadastros/aux?resumo=1                                 → contagens por cadastro
// GET  /api/cadastros/aux?reg=projetos&emp=SF&sugestao=1&superior= → próximo PJ/CT, próximo código de categoria
// GET  /api/cadastros/aux?bancos=1&q=                              → instituições (código FEBRABAN)
// POST /api/cadastros/aux  { registro, empresa, nome, codigo?, dados, forcar?, forcarMotivo? } → cria
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirCadastros, rpcCad, erroCad } from "@/lib/cadastros-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REGISTROS = new Set(["projetos", "contas", "categorias", "centros_custo", "condicoes", "tipos_documento",
  "vendedores", "servicos", "unidades", "empresas"]);

export async function GET(req: Request) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  try {
    if (sp.get("resumo") === "1") return NextResponse.json(await rpcCad("cad_aux_resumo"));
    if (sp.get("bancos") === "1") {
      const termo = (sp.get("q") ?? "").trim();
      let qb = supaAdmin().schema("finance").from("bancos").select("codigo, nome").order("codigo").limit(30);
      if (termo) qb = /^\d+$/.test(termo) ? qb.ilike("codigo", `${termo}%`) : qb.ilike("nome", `%${termo}%`);
      const { data, error } = await qb;
      if (error) throw error;
      return NextResponse.json({ bancos: data ?? [] });
    }
    const reg = sp.get("reg") ?? "";
    if (!REGISTROS.has(reg)) return NextResponse.json({ error: "Cadastro desconhecido" }, { status: 400 });
    const emp = (sp.get("emp") ?? "SF").toUpperCase();
    if (sp.get("opcoes") === "1") return NextResponse.json({ opcoes: await rpcCad("cad_aux_opcoes", { p_registro: reg, p_empresa: emp }) });
    if (sp.get("sugestao") === "1") {
      return NextResponse.json(await rpcCad("cad_aux_sugestao", {
        p_registro: reg, p_empresa: emp, p_extra: sp.get("superior") ? { superior: sp.get("superior") } : {},
      }));
    }
    const r = await rpcCad("cad_aux_listar", {
      p_registro: reg, p_empresa: emp, p_q: (sp.get("q") ?? "").trim() || null, p_inativos: sp.get("todos") === "1",
      p_lim: 100, p_off: Math.max(0, Number(sp.get("off")) || 0),
    });
    return NextResponse.json({ ...(r as object), podeEditar: q.editar, admin: !!q.perms.is_admin });
  } catch (e) { return erroCad(e); }
}

export async function POST(req: Request) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  if (!q.editar) return NextResponse.json({ error: "Sem permissão para cadastrar" }, { status: 403 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    delete body.id;
    if (!REGISTROS.has(String(body.registro ?? ""))) return NextResponse.json({ error: "Cadastro desconhecido" }, { status: 400 });
    // Criar mesmo havendo um parecido: só administrador, com motivo (fica no histórico).
    if (!q.perms.is_admin) { delete body.forcar; delete body.forcarMotivo; }
    const salvo = await rpcCad<Record<string, unknown>>("cad_aux_salvar", { p: body, p_por: q.email });
    // Serviço novo/editado: garante o item nativo da família SV (código SV00xx), como o CRM já fazia (08/10/26).
    if (body.registro === "servicos" && salvo?.codigo) {
      const nat = await supaAdmin().schema("orders").rpc("servico_nativo_garantir", {
        p_empresa: String(body.empresa ?? salvo.empresa ?? "SF"), p_codigo: String(salvo.codigo), p_por: q.email });
      if (!nat.error && nat.data) return NextResponse.json({ ...salvo, item_nativo: nat.data });
    }
    return NextResponse.json(salvo);
  } catch (e) { return erroCad(e); }
}
