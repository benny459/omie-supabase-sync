// Movimentações do PAINEL (nunca vão ao Omie; o saldo = Omie + painel, em orders.v_estoque_saldo_local).
// GET  ?de=YYYY-MM-DD&ate=YYYY-MM-DD   → movimentos do painel no período + tipos, justificativas, usuários, pendentes
// GET  ?n_cod_prod=…                    → movimentos do painel de um item (ficha) + tipos/justificativas/usuários
// POST { acao: "registrar", tipo_id, n_cod_prod, quantidade, local_origem, local_destino, solicitante_user, solicitante_nome,
//        cliente, projeto, pv_os, pc_numero, motivo_id | motivo, obs }  → qualquer usuário do ERP (perda/avaria fica pendente)
// POST { acao: "registrar_lote", ...cabeçalho, linhas: [{ n_cod_prod, quantidade, local_origem?, local_destino?, obs? }] } → lote atômico
// POST { acao: "aprovar" | "rejeitar" | "cancelar", id | lote_id, obs }  → administrador
// POST { acao: "tipo_salvar", tipo: {...} } / { acao: "motivo_salvar", motivo: {...} } → administrador (Configurar)

import { NextResponse } from "next/server";
import { msgErro, orders, platform, quemEstoque, todas } from "@/lib/estoque-server";

export const runtime = "nodejs";
export const maxDuration = 60;

async function apoio() {
  const [t, m, u, p] = await Promise.all([
    platform().from("estoque_mov_tipo").select("*").eq("empresa", "SF").order("ordem"),
    platform().from("estoque_mov_motivo").select("*").order("ordem").order("nome"),
    platform().from("user_profiles").select("id, email, nome, ativo").order("nome"),
    platform().from("estoque_movimento").select("id", { count: "exact", head: true }).eq("status", "pendente"),
  ]);
  const e = t.error ?? m.error ?? u.error;
  if (e) throw new Error(e.message);
  return {
    tipos: t.data ?? [], motivos: m.data ?? [], pendentes: p.count ?? 0,
    usuarios: ((u.data ?? []) as { id: string; email: string; nome: string | null; ativo: boolean | null }[])
      .filter((x) => x.ativo !== false).map((x) => ({ id: x.id, nome: x.nome || x.email.split("@")[0], email: x.email })),
  };
}

export async function GET(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const u = new URL(req.url);
  try {
    const n = u.searchParams.get("n_cod_prod");
    let movs: unknown[];
    if (n) {
      const r = await platform().from("estoque_movimento").select("*").eq("n_cod_prod", Number(n)).order("created_at", { ascending: false }).limit(500);
      if (r.error) throw new Error(r.error.message);
      movs = r.data ?? [];
    } else {
      const de = u.searchParams.get("de") ?? "2000-01-01", ate = u.searchParams.get("ate") ?? "2999-12-31";
      // período no fuso de São Paulo; pendentes aparecem sempre (fila de aprovação)
      const [r, pend] = await Promise.all([
        todas((a, b) => platform().from("estoque_movimento").select("*").gte("created_at", `${de}T00:00:00-03:00`).lte("created_at", `${ate}T23:59:59-03:00`)
          .order("created_at", { ascending: false }).range(a, b)),
        platform().from("estoque_movimento").select("*").eq("status", "pendente").order("created_at"),
      ]);
      if (pend.error) throw new Error(pend.error.message);
      const ids = new Set((r as { id: number }[]).map((x) => x.id));
      movs = [...r, ...((pend.data ?? []) as { id: number }[]).filter((x) => !ids.has(x.id))];
    }
    // cabeçalho dos lotes que aparecem (para agrupar na lista)
    const ids = [...new Set((movs as { lote_id: number | null }[]).map((m) => m.lote_id).filter(Boolean))] as number[];
    let lotes: unknown[] = [];
    if (ids.length) {
      const lr = await platform().from("estoque_mov_lote").select("*").in("id", ids);
      if (lr.error) throw new Error(lr.error.message);
      lotes = lr.data ?? [];
    }
    return NextResponse.json({ movs, lotes, ...(await apoio()), admin: q.pode["estoque.config_mov"] || q.pode["estoque.aprovar_perdas"], pode: q.pode, eu: { id: q.id, email: q.email } });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export async function POST(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const soAdmin = () => NextResponse.json({ error: "Sem permissão para isso — peça ao administrador em Usuários e acessos" }, { status: 403 });
  try {
    if (b.acao === "registrar") {
      const r = await orders().rpc("estoque_movimentar", { p: { ...b, empresa: "SF" }, p_user: q.id || null, p_email: q.email, p_admin: q.pode["estoque.aprovar_perdas"] });
      if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
      return NextResponse.json({ ok: true, mov: r.data });
    }
    if (b.acao === "registrar_lote") {
      const r = await orders().rpc("estoque_movimentar_lote", { p: { ...b, empresa: "SF" }, p_user: q.id || null, p_email: q.email, p_admin: q.pode["estoque.aprovar_perdas"] });
      if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
      return NextResponse.json({ ok: true, lote: r.data });
    }
    if ((b.acao === "aprovar" || b.acao === "rejeitar" || b.acao === "cancelar") && b.lote_id) {
      if (!q.pode["estoque.aprovar_perdas"]) return soAdmin();
      const r = await orders().rpc("estoque_mov_decidir_lote", { p_lote: Number(b.lote_id), p_acao: b.acao, p_obs: (b.obs as string) ?? null, p_email: q.email });
      if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
      return NextResponse.json({ ok: true, lote: r.data });
    }
    if (b.acao === "aprovar" || b.acao === "rejeitar" || b.acao === "cancelar") {
      if (!q.pode["estoque.aprovar_perdas"]) return soAdmin();
      const r = await orders().rpc("estoque_mov_decidir", { p_id: Number(b.id), p_acao: b.acao, p_obs: (b.obs as string) ?? null, p_email: q.email });
      if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
      return NextResponse.json({ ok: true, mov: r.data });
    }
    if (b.acao === "tipo_salvar") {
      if (!q.pode["estoque.config_mov"]) return soAdmin();
      const t = (b.tipo ?? {}) as Record<string, unknown>;
      const nome = String(t.nome ?? "").trim();
      if (!nome) return NextResponse.json({ error: "Dê um nome ao tipo" }, { status: 400 });
      const sentido = String(t.sentido ?? "");
      if (!["entra", "sai", "transfere"].includes(sentido)) return NextResponse.json({ error: "Escolha se o tipo entra, sai ou transfere" }, { status: 400 });
      const campos = { nome, sentido, exige_aprovacao: !!t.exige_aprovacao, exige_cliente_ou_projeto: !!t.exige_cliente_ou_projeto, exige_pc: !!t.exige_pc,
        ativo: t.ativo !== false, descricao: (t.descricao as string) || null, updated_by_email: q.email, updated_at: new Date().toISOString() };
      if (t.id) {
        const atual = await platform().from("estoque_mov_tipo").select("origem").eq("id", Number(t.id)).single();
        if (atual.error) throw new Error(atual.error.message);
        // tipos automáticos (Omie) e o de inventário: só nome/descrição/ativo mudam
        const upd = atual.data.origem === "manual" ? campos : { nome, descricao: campos.descricao, ativo: campos.ativo, updated_by_email: q.email, updated_at: campos.updated_at };
        const r = await platform().from("estoque_mov_tipo").update(upd).eq("id", Number(t.id));
        if (r.error) throw new Error(r.error.message);
      } else {
        const codigo = nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "tipo";
        const r = await platform().from("estoque_mov_tipo").insert({ ...campos, empresa: "SF", codigo: `${codigo}_${Date.now() % 100000}`, origem: "manual", ordem: 85 });
        if (r.error) throw new Error(r.error.message);
      }
      return NextResponse.json({ ok: true, ...(await apoio()) });
    }
    if (b.acao === "motivo_salvar") {
      if (!q.pode["estoque.config_mov"]) return soAdmin();
      const m = (b.motivo ?? {}) as Record<string, unknown>;
      const nome = String(m.nome ?? "").trim();
      if (!nome) return NextResponse.json({ error: "Escreva a justificativa" }, { status: 400 });
      const r = m.id
        ? await platform().from("estoque_mov_motivo").update({ nome, ativo: m.ativo !== false }).eq("id", Number(m.id))
        : await platform().from("estoque_mov_motivo").insert({ tipo_id: Number(m.tipo_id), nome, ordem: 50 });
      if (r.error) return NextResponse.json({ error: /duplicate/.test(r.error.message) ? "Essa justificativa já existe neste tipo" : r.error.message }, { status: 409 });
      return NextResponse.json({ ok: true, ...(await apoio()) });
    }
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
