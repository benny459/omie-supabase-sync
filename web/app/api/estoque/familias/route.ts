// Famílias do Estoque (só no painel — não cria famílias no Omie).
// GET  → famílias com nº de itens e valor, situação da revisão
// POST (admin) { acao: "criar" | "editar" | "inativar" | "reativar" | "mesclar" | "importar_omie" | "concluir_revisao" | "reabrir_revisao", ... }

import { NextResponse } from "next/server";
import { exigirAdminEstoque, msgErro, orders, platform, quemEstoque, todasParalelo } from "@/lib/estoque-server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Fam = { id: number; empresa: string; nome: string; prefixo: string; descricao: string | null; ativo: boolean; sistema: boolean;
  material: boolean; mesclada_em: number | null; omie_codigo_familia: number | null; proximo: number };

export async function GET() {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  try {
    const [fr, itens, cfg, codigos] = await Promise.all([
      platform().from("estoque_familia").select("*").order("nome"),
      todasParalelo<{ familia_id: number | null; saldo: number; cmc: number; mesclado_em: number | null }>((de, ate) =>
        orders().from("v_estoque_item").select("familia_id, saldo, cmc, mesclado_em").range(de, ate)),
      orders().rpc("estoque_revisao_familias_concluida", { p_empresa: "SF" }),
      platform().from("estoque_item_codigo").select("familia_id", { count: "exact", head: true }),
    ]);
    if (fr.error) throw new Error(fr.error.message);
    const cont = new Map<number | null, { n: number; valor: number }>();
    for (const i of itens) {
      if (i.mesclado_em) continue;
      const k = i.familia_id ?? null, t = cont.get(k) ?? { n: 0, valor: 0 };
      t.n++; t.valor += Math.max(Number(i.saldo) || 0, 0) * (Number(i.cmc) || 0); cont.set(k, t);
    }
    const fams = (fr.data as Fam[]).map((f) => {
      const t = f.sistema ? (cont.get(null) ?? { n: 0, valor: 0 }) : (cont.get(f.id) ?? { n: 0, valor: 0 });
      const ts = f.sistema ? cont.get(f.id) : undefined;
      return { ...f, itens: t.n + (ts?.n ?? 0), valor: t.valor + (ts?.valor ?? 0) };
    });
    return NextResponse.json({ familias: fams, revisao_concluida: !!cfg.data, codigos_gerados: codigos.count ?? 0, admin: q.admin });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const PREFIXO = /^[A-Z]{1,3}$/;

export async function POST(req: Request) {
  const q = await exigirAdminEstoque();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const acao = String(b.acao ?? "");
  const db = platform();
  try {
    if (acao === "importar_omie") {
      const r = await orders().rpc("estoque_familias_importar_omie", { p_empresa: "SF", p_email: q.email });
      if (r.error) throw r.error;
      return NextResponse.json({ ok: true, resultado: r.data });
    }
    if (acao === "concluir_revisao" || acao === "reabrir_revisao") {
      const r = await orders().rpc("estoque_revisao_familias_marcar", { p_empresa: "SF", p_concluida: acao === "concluir_revisao", p_email: q.email });
      if (r.error) throw r.error;
      return NextResponse.json({ ok: true, resultado: r.data });
    }
    if (acao === "mesclar") {
      const r = await orders().rpc("estoque_familia_mesclar", { p_de: Number(b.de), p_para: Number(b.para), p_email: q.email });
      if (r.error) throw r.error;
      return NextResponse.json({ ok: true, resultado: r.data });
    }
    const nome = String(b.nome ?? "").trim(), prefixo = String(b.prefixo ?? "").trim().toUpperCase();
    if (acao === "criar") {
      if (!nome) return NextResponse.json({ error: "Dê um nome à família" }, { status: 400 });
      let pref = prefixo;
      if (!pref) { const s = await orders().rpc("estoque_prefixo_sugerido", { p_empresa: "SF", p_nome: nome }); if (s.error) throw s.error; pref = String(s.data); }
      if (!PREFIXO.test(pref)) return NextResponse.json({ error: "Prefixo: 1 a 3 letras (A–Z)" }, { status: 400 });
      const r = await db.from("estoque_familia").insert({ empresa: "SF", nome, prefixo: pref, descricao: b.descricao ?? null,
        material: b.material !== false, created_by_email: q.email, updated_by_email: q.email }).select("*").single();
      if (r.error) throw r.error;
      return NextResponse.json({ ok: true, familia: r.data });
    }
    const id = Number(b.id);
    if (acao === "editar") {
      const patch: Record<string, unknown> = { updated_by_email: q.email, updated_at: new Date().toISOString() };
      if (nome) patch.nome = nome;
      if ("descricao" in b) patch.descricao = b.descricao || null;
      if ("material" in b) patch.material = !!b.material;
      if (prefixo) {
        if (!PREFIXO.test(prefixo)) return NextResponse.json({ error: "Prefixo: 1 a 3 letras (A–Z)" }, { status: 400 });
        const { count } = await db.from("estoque_item_codigo").select("id", { count: "exact", head: true }).eq("familia_id", id);
        const atual = await db.from("estoque_familia").select("prefixo").eq("id", id).single();
        if ((count ?? 0) > 0 && atual.data?.prefixo !== prefixo)
          return NextResponse.json({ error: "Esta família já tem códigos gerados com o prefixo atual — não dá para trocar o prefixo" }, { status: 409 });
        patch.prefixo = prefixo;
      }
      const r = await db.from("estoque_familia").update(patch).eq("id", id).select("*").single();
      if (r.error) throw r.error;
      return NextResponse.json({ ok: true, familia: r.data });
    }
    if (acao === "inativar" || acao === "reativar") {
      const f = await db.from("estoque_familia").select("sistema").eq("id", id).single();
      if (f.data?.sistema) return NextResponse.json({ error: "A família de sistema não pode ser inativada" }, { status: 409 });
      const r = await db.from("estoque_familia").update({ ativo: acao === "reativar", updated_by_email: q.email, updated_at: new Date().toISOString() })
        .eq("id", id).select("*").single();
      if (r.error) throw r.error;
      return NextResponse.json({ ok: true, familia: r.data });
    }
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (e) {
    const m = msgErro(e as { message?: string });
    return NextResponse.json({ error: /duplicate key.*prefixo/.test(m) ? "Esse prefixo já é usado por outra família" : /duplicate key.*nome/.test(m) ? "Já existe uma família com esse nome" : m }, { status: 409 });
  }
}
