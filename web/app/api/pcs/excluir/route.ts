// POST /api/pcs/excluir — esconde ou traz de volta um pedido de compra.
//
// Apagar um PC não é DELETE: a linha vem de orders.pedidos_compra, o espelho
// do Omie, e o próximo sync repõe o que se apagar. Aqui marca-se em
// platform.excluded_pc e /api/list/rows deixa de o devolver — some da vista,
// sobrevive ao sync, volta a qualquer momento.
//
// Permissão: admin, aprovador e comprador. Deliberadamente NÃO é admin-only —
// quem compra é quem sabe que um PC deixou de fazer parte do projeto, e ter de
// pedir a um admin era o que tornava isto impossível na prática.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type Escondido = {
  empresa: string;
  pc_numero: string;
  motivo: string | null;
  excluded_at: string;
  excluded_by: string | null;
};

type Body = {
  action: "exclude" | "restore";
  empresa: string;
  pcs: string[];
  motivo?: string;
};

const PAPEIS_COM_PERMISSAO = new Set(["admin", "aprovador", "comprador"]);

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!["exclude", "restore"].includes(body.action)) {
    return NextResponse.json({ error: "action deve ser exclude ou restore" }, { status: 400 });
  }
  if (!body.empresa) {
    return NextResponse.json({ error: "empresa obrigatória" }, { status: 400 });
  }
  // Normaliza: o número do PC chega como texto da grade e pode vir com espaços.
  const pcs = Array.from(new Set(
    (Array.isArray(body.pcs) ? body.pcs : [])
      .map((p) => String(p ?? "").trim())
      .filter(Boolean),
  ));
  if (pcs.length === 0) {
    return NextResponse.json({ error: "pcs[] obrigatório" }, { status: 400 });
  }
  if (pcs.length > 200) {
    return NextResponse.json({ error: "máximo 200 PCs por vez" }, { status: 400 });
  }

  const { data: me } = await supa
    .schema("platform" as never).from("user_profiles")
    .select("is_admin, role").eq("id", user.id).maybeSingle();
  const perfil = me as { is_admin?: boolean; role?: string } | null;
  const podeExcluir = perfil?.is_admin === true
    || (perfil?.role != null && PAPEIS_COM_PERMISSAO.has(perfil.role));
  if (!podeExcluir) {
    return NextResponse.json(
      { error: "Sem permissão para excluir pedidos de compra" }, { status: 403 },
    );
  }

  const admin = supaAdmin();

  if (body.action === "exclude") {
    const linhas = pcs.map((pc) => ({
      empresa: body.empresa,
      pc_numero: pc,
      motivo: body.motivo?.trim() || null,
      excluded_by: user.id,
      excluded_at: new Date().toISOString(),
    }));
    const { error } = await admin
      .schema("platform" as never).from("excluded_pc")
      .upsert(linhas, { onConflict: "empresa,pc_numero" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, count: pcs.length, action: "exclude" });
  }

  const { error } = await admin
    .schema("platform" as never).from("excluded_pc")
    .delete().eq("empresa", body.empresa).in("pc_numero", pcs);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, count: pcs.length, action: "restore" });
}

// GET /api/pcs/excluir — lista o que está escondido, para poder trazer de volta.
export async function GET() {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = supaAdmin();
  const { data, error } = await admin
    .schema("platform" as never).from("excluded_pc")
    .select("empresa, pc_numero, motivo, excluded_at, excluded_by")
    .order("excluded_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const linhas = (data ?? []) as Escondido[];
  if (linhas.length === 0) return NextResponse.json({ rows: [] });

  /* A tabela guarda só (empresa, número) — de propósito, para não desatualizar
     quando o PC muda de projeto no Omie. O projeto e o valor vêm da MV na
     hora, que é o que permite contar e restaurar projeto a projeto.
     Se a MV falhar, devolve-se a lista sem projeto: pior é não poder restaurar. */
  const numeros = Array.from(new Set(linhas.map((l) => String(l.pc_numero))));
  const projetosDoPc = new Map<string, Set<string>>();
  const valorDoPc = new Map<string, number | null>();
  try {
    const mv = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false }, db: { schema: "sales" } },
    );
    const { data: ctx } = await mv.from("mv_pc_projetos")
      .select("empresa, pc_numero, projeto_nome, valor_total")
      .in("pc_numero", numeros);
    /* Um PC pode aparecer em MAIS DE UM projeto — é o caso de quem digitou o
       número no PV errado: o PC real fica no projeto dele e a cópia manual
       noutro. Como a exclusão é por número, ele sai dos dois; então os dois
       têm de poder trazê-lo de volta. Guardar só o primeiro escondia a porta
       de volta num deles. */
    for (const c of (ctx ?? []) as {
      empresa: string; pc_numero: string; projeto_nome: string | null; valor_total: number | null;
    }[]) {
      const chave = `${c.empresa}|${String(c.pc_numero).trim()}`;
      if (c.projeto_nome) {
        const set = projetosDoPc.get(chave) ?? new Set<string>();
        set.add(c.projeto_nome);
        projetosDoPc.set(chave, set);
      }
      if (!valorDoPc.has(chave)) valorDoPc.set(chave, c.valor_total);
    }
  } catch { /* sem contexto: a lista global continua a funcionar */ }

  return NextResponse.json({
    rows: linhas.map((l) => {
      const chave = `${l.empresa}|${String(l.pc_numero).trim()}`;
      const projetos = Array.from(projetosDoPc.get(chave) ?? []).sort();
      return { ...l, projetos, valor_total: valorDoPc.get(chave) ?? null };
    }),
  });
}
