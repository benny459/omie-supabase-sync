// /api/pcs/ajuste — cancelar pedido de compra de verdade e devolver material (sql/146).
//
//   GET  ?empresa=SF&codigo=<projeto>        → { cancelados, devolucoes } do projeto
//                                              (seção "Cancelados / devolvidos")
//   GET  ?empresa=SF&numero=<PC>             → o PC (itens, já devolvido por item, cancelamento)
//   POST { acao: "cancelar", empresa, numero, motivo, codigo_projeto?, simular? }
//   POST { acao: "desfazer_cancelamento", empresa, numero }                  (só admin)
//   POST { acao: "devolver", empresa, numero, motivo, itens:[{pc_item_id,qtd}], nf_numero?, nf_data?, codigo_projeto?, simular? }
//   POST { acao: "desfazer_devolucao", id }                                   (só admin)
//
// PC do Omie: NADA vai ao Omie. O cancelamento é só no painel (mesmo mecanismo do
// "Excluir PC") e a resposta traz cancelar_no_omie = true para a tela avisar.
// `simular: true` roda a função no banco e desfaz tudo no fim (dry-run).
// Permissão: admin, aprovador e comprador (a mesma do "Excluir PC"); desfazer, só admin.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { lerAjustes } from "@/lib/pc-ajustes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAPEIS = new Set(["admin", "aprovador", "comprador"]);

async function quem() {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return null;
  const { data: me } = await supaAdmin().schema("platform").from("user_profiles").select("is_admin, role").eq("id", user.id).maybeSingle();
  const p = me as { is_admin?: boolean; role?: string } | null;
  const admin = p?.is_admin === true || p?.role === "admin";
  return { user, admin, pode: admin || (p?.role != null && PAPEIS.has(p.role)) };
}

const orders = () => supaAdmin().schema("orders");
async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await orders().rpc(fn, args);
  if (error) throw new Error(/does not exist|Could not find the function/i.test(error.message)
    ? "Cancelar/devolver ainda não está ligado no banco (migração sql/146 pendente)" : error.message);
  return data;
}

export async function GET(req: Request) {
  const q = await quem();
  if (!q) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const empresa = (sp.get("empresa") ?? "SF").toUpperCase();
  const numero = (sp.get("numero") ?? "").trim();
  try {
    if (numero) {
      const pc = await rpc("compras_pc_por_numero", { p_empresa: empresa, p_numero: numero });
      if (!pc) return NextResponse.json({ error: `PC ${numero} não está no Compras (sem itens para devolver)` }, { status: 404 });
      return NextResponse.json({ pc, pode: q.pode, admin: q.admin });
    }
    const codigo = Number(sp.get("codigo"));
    if (!codigo) return NextResponse.json({ error: "codigo ou numero obrigatório" }, { status: 400 });
    const aj = await lerAjustes({ empresa, projeto: codigo });
    return NextResponse.json({ ...aj, pode: q.pode, admin: q.admin });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  const q = await quem();
  if (!q) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const por = q.user.email ?? q.user.id;
  const empresa = String(b.empresa ?? "SF").toUpperCase();
  const numero = String(b.numero ?? "").trim();
  const simular = b.simular === true;
  const codigo = Number(b.codigo_projeto) || null;
  try {
    switch (b.acao) {
      case "cancelar": {
        if (!q.pode) return NextResponse.json({ error: "Sem permissão para cancelar pedido de compra" }, { status: 403 });
        if (!String(b.motivo ?? "").trim()) return NextResponse.json({ error: "Informe o motivo" }, { status: 400 });
        return NextResponse.json(await rpc("compras_pc_cancelar", {
          p_empresa: empresa, p_numero: numero, p_motivo: String(b.motivo), p_por: por, p_uid: q.user.id,
          p_codigo_projeto: codigo, p_simular: simular }));
      }
      case "desfazer_cancelamento":
        if (!q.admin) return NextResponse.json({ error: "Só administrador desfaz um cancelamento" }, { status: 403 });
        return NextResponse.json(await rpc("compras_pc_cancelar_desfazer", { p_empresa: empresa, p_numero: numero, p_por: por, p_simular: simular }));
      case "devolver": {
        if (!q.pode) return NextResponse.json({ error: "Sem permissão para registrar devolução" }, { status: 403 });
        const itens = (Array.isArray(b.itens) ? b.itens : [])
          .map((i) => ({ pc_item_id: Number((i as { pc_item_id?: unknown }).pc_item_id), qtd: Number((i as { qtd?: unknown }).qtd) }))
          .filter((i) => i.pc_item_id > 0 && i.qtd > 0);
        if (!itens.length) return NextResponse.json({ error: "Informe a quantidade devolvida de pelo menos um item" }, { status: 400 });
        const nfData = String(b.nf_data ?? "").trim();
        if (nfData && !/^\d{4}-\d{2}-\d{2}$/.test(nfData)) return NextResponse.json({ error: "Data da NF inválida" }, { status: 400 });
        return NextResponse.json(await rpc("compras_devolucao_registrar", {
          p: { empresa, numero, motivo: String(b.motivo ?? ""), itens, nf_numero: String(b.nf_numero ?? "").trim() || null,
               nf_data: nfData || null, codigo_projeto: codigo },
          p_por: por, p_uid: q.user.id, p_simular: simular }));
      }
      case "desfazer_devolucao":
        if (!q.admin) return NextResponse.json({ error: "Só administrador desfaz uma devolução" }, { status: 403 });
        return NextResponse.json(await rpc("compras_devolucao_desfazer", { p_id: Number(b.id), p_por: por, p_simular: simular }));
      default:
        return NextResponse.json({ error: "ação inválida" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
