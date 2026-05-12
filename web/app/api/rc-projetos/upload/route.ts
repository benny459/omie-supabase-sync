// POST /api/rc-projetos/upload
// Recebe lista de itens parseados de uma planilha (N abas = equipamentos),
// faz MERGE em approval.rc_projetos_itens preservando pc_numero ja vinculado.
//
// Body: {
//   empresa: string,
//   codigo_projeto: number,
//   items: Array<{ equipamento, item, qtd?, modelo?, observacao? }>
// }
//
// Comportamento:
//   - INSERT pra items novos (natural key inexistente)
//   - UPDATE pra items existentes (sobrescreve qtd/modelo/observacao,
//     preserva pc_numero)
//   - NAO deleta items removidos da planilha (merge aditivo — user deleta
//     manualmente via DELETE /api/rc-projetos/[id] se quiser)
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

type Item = {
  equipamento: string;
  item: string;
  qtd?: number | null;
  modelo?: string | null;
  observacao?: string | null;
};

type Body = {
  empresa: string;
  codigo_projeto: number;
  items: Item[];
};

const HARD_CAP = 2000;

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.empresa || !body.codigo_projeto || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "empresa, codigo_projeto e items[] obrigatórios" }, { status: 400 });
  }
  if (body.items.length === 0) {
    return NextResponse.json({ error: "items vazio" }, { status: 400 });
  }
  if (body.items.length > HARD_CAP) {
    return NextResponse.json({ error: `Máximo ${HARD_CAP} items por upload` }, { status: 400 });
  }

  const userEmail = user.email || user.id;
  const empresa = String(body.empresa);
  const codigoProjeto = Number(body.codigo_projeto);

  // Dedup local pelo natural key antes do upsert (evita "ON CONFLICT can't
  // affect row twice" se a planilha tem duplicatas)
  const dedup = new Map<string, Item & { equipamento: string; item: string }>();
  for (const raw of body.items) {
    const equipamento = String(raw.equipamento ?? "").trim();
    const item = String(raw.item ?? "").trim();
    if (!equipamento || !item) continue;
    const key = `${equipamento}\x01${item.toLowerCase()}`;
    dedup.set(key, { equipamento, item, qtd: raw.qtd ?? null, modelo: raw.modelo ?? null, observacao: raw.observacao ?? null });
  }
  const deduped = [...dedup.values()];
  if (deduped.length === 0) {
    return NextResponse.json({ error: "Nenhum item válido (equipamento e item são obrigatórios)" }, { status: 400 });
  }

  // Upsert por natural key — pc_numero NAO eh atualizado (DEFAULT preserva
  // valor existente no UPDATE porque nao esta no INSERT/UPDATE list).
  const rows = deduped.map((d) => ({
    empresa,
    codigo_projeto: codigoProjeto,
    equipamento: d.equipamento,
    item: d.item,
    qtd: d.qtd,
    modelo: d.modelo,
    observacao: d.observacao,
    criado_por: userEmail,
    atualizado_por: userEmail,
  }));

  const { error, data } = await supa
    .schema("approval" as never)
    .from("rc_projetos_itens")
    .upsert(rows, {
      onConflict: "empresa,codigo_projeto,equipamento,item_norm",
      ignoreDuplicates: false,
    })
    .select("id, equipamento, item, pc_numero");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    total_recebidos: body.items.length,
    total_processados: rows.length,
    rows: data,
  });
}
