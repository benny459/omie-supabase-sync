// POST /api/rc-projetos/upload
// Recebe lista de itens parseados de uma planilha (N abas = equipamentos),
// faz sync DESTRUTIVO em approval.rc_projetos_itens:
//   - INSERT pra items novos
//   - UPDATE pra items existentes (sobrescreve qtd/modelo/observacao/pc_numero
//     se veio pc na planilha; caso contrário PRESERVA o pc já vinculado)
//   - DELETE pra items que estavam no DB mas SUMIRAM da planilha (nova versão
//     define o que existe — user pediu explicitamente esse comportamento pra
//     acompanhar a evolução da lista mestre).
//
// Body: {
//   empresa: string,
//   codigo_projeto: number,
//   items: Array<{ equipamento, item, qtd?, modelo?, observacao?, pc_numero? }>
// }

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

type Item = {
  equipamento: string;
  item: string;
  qtd?: number | null;
  modelo?: string | null;
  observacao?: string | null;
  pc_numero?: string | null;
};

type Body = {
  empresa: string;
  codigo_projeto: number;
  items: Item[];
};

const HARD_CAP = 2000;

// item_norm (natural key) tem que bater EXATAMENTE com a coluna generated no
// DB: `lower(btrim(item))` — só lower + trim (NÃO colapsa espaços internos).
// Se divergir, o sync-destrutivo acha que nenhum item existe e apaga tudo.
function itemNorm(s: string): string {
  return s.toLowerCase().trim();
}

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

  // Dedup local pelo natural key antes do upsert
  const dedup = new Map<string, Required<Omit<Item, "pc_numero">> & { pc_numero: string | null }>();
  for (const raw of body.items) {
    const equipamento = String(raw.equipamento ?? "").trim();
    const item = String(raw.item ?? "").trim();
    if (!equipamento || !item) continue;
    const key = `${equipamento}\x01${itemNorm(item)}`;
    const pcRaw = raw.pc_numero != null ? String(raw.pc_numero).trim() : "";
    dedup.set(key, {
      equipamento,
      item,
      qtd: raw.qtd ?? null,
      modelo: raw.modelo ?? null,
      observacao: raw.observacao ?? null,
      pc_numero: pcRaw || null,
    });
  }
  const deduped = [...dedup.values()];
  if (deduped.length === 0) {
    return NextResponse.json({ error: "Nenhum item válido (equipamento e item são obrigatórios)" }, { status: 400 });
  }

  const approval = supa.schema("approval" as never);

  // Descobre pc_numero existente por natural key antes do upsert — pra preservar
  // vínculo quando a planilha nova não trouxe PC (fetch em batch pra evitar N+1).
  //
  // Traz a linha INTEIRA, não só a chave: o que for apagado vai para a
  // lixeira, e arquivar exige o valor. Buscar de novo depois seria uma
  // segunda ida ao banco para ler o que já esteve na mão.
  const { data: existing, error: fetchErr } = await approval
    .from("rc_projetos_itens")
    .select("id, equipamento, item, item_norm, qtd, modelo, observacao, pc_numero, criado_em, criado_por")
    .eq("empresa", empresa)
    .eq("codigo_projeto", codigoProjeto);
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });

  type ExistingRow = {
    id: string; equipamento: string; item: string | null; item_norm: string;
    qtd: number | null; modelo: string | null; observacao: string | null;
    pc_numero: string | null; criado_em: string | null; criado_por: string | null;
  };
  const existingByKey = new Map<string, ExistingRow>();
  for (const r of (existing ?? []) as ExistingRow[]) {
    existingByKey.set(`${r.equipamento}\x01${r.item_norm}`, r);
  }

  // Upsert: se planilha trouxe pc_numero, usa; senão preserva o existente
  const rows = deduped.map((d) => {
    const key = `${d.equipamento}\x01${itemNorm(d.item)}`;
    const prior = existingByKey.get(key);
    const pcFinal = d.pc_numero != null && d.pc_numero !== ""
      ? d.pc_numero
      : (prior?.pc_numero ?? null);
    return {
      empresa,
      codigo_projeto: codigoProjeto,
      equipamento: d.equipamento,
      item: d.item,
      qtd: d.qtd,
      modelo: d.modelo,
      observacao: d.observacao,
      pc_numero: pcFinal,
      criado_por: userEmail,
      atualizado_por: userEmail,
    };
  });

  const { error: upErr } = await approval
    .from("rc_projetos_itens")
    .upsert(rows, {
      onConflict: "empresa,codigo_projeto,equipamento,item_norm",
      ignoreDuplicates: false,
    });
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // ── Sync destrutivo, agora com lixeira ───────────────────────────────────
  //
  // Item que não vem na planilha nova sai — a planilha define o que existe, e
  // foi pedido assim. O que mudou é que ele passa a ser ARQUIVADO antes.
  //
  // Em 31/07/2026 o PJ358_Brasterapica perdeu equipamentos inteiros porque
  // alguém subiu uma planilha só com a aba "Eletrica". Restaram 36 itens de
  // painel num projeto de tratamento de água. Não havia rastro, e 48 dias
  // depois já estava fora de qualquer janela de recuperação do banco.
  const incomingKeys = new Set(deduped.map((d) => `${d.equipamento}\x01${itemNorm(d.item)}`));
  const aRemover: ExistingRow[] = [];
  for (const [key, row] of existingByKey) {
    if (!incomingKeys.has(key)) aRemover.push(row);
  }

  let deleted = 0;
  const equipamentosPerdidos: string[] = [];
  if (aRemover.length > 0) {
    // Equipamento que desapareceu INTEIRO é o caso grave: não é a planilha
    // corrigindo um item, é uma aba que ficou de fora do arquivo.
    const equipEntrando = new Set(deduped.map((d) => d.equipamento));
    const equipSaindo = new Set(aRemover.map((r) => r.equipamento));
    for (const e of equipSaindo) if (!equipEntrando.has(e)) equipamentosPerdidos.push(e);

    // Arquiva ANTES de apagar. Se o insert falhar, nada é removido — perder o
    // dado de novo por causa da proteção seria o pior desfecho possível.
    const { error: arqErr } = await approval
      .from("rc_projetos_itens_lixeira")
      .insert(aRemover.map((r) => ({
        item_id: r.id, empresa, codigo_projeto: codigoProjeto,
        equipamento: r.equipamento, item: r.item, item_norm: r.item_norm,
        qtd: r.qtd, modelo: r.modelo, observacao: r.observacao,
        pc_numero: r.pc_numero, criado_em: r.criado_em, criado_por: r.criado_por,
        apagado_por: userEmail,
        apagado_por_upload: `${rows.length} item(ns) de ${equipEntrando.size} equipamento(s)`,
      })));
    if (arqErr) {
      return NextResponse.json(
        { error: `não consegui arquivar os ${aRemover.length} item(ns) que sairiam — nada foi apagado: ${arqErr.message}` },
        { status: 500 });
    }

    const { error: delErr, count } = await approval
      .from("rc_projetos_itens")
      .delete({ count: "exact" })
      .in("id", aRemover.map((r) => r.id));
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    deleted = count ?? aRemover.length;
  }

  return NextResponse.json({
    ok: true,
    total_recebidos: body.items.length,
    total_processados: rows.length,
    total_deletados: deleted,
    total_no_projeto: rows.length,
    // A tela precisa PODER avisar. "total_deletados: 412" passou despercebido
    // uma vez; o nome do equipamento que sumiu não passa.
    equipamentos_removidos: equipamentosPerdidos,
    recuperavel: deleted > 0,
  });
}
