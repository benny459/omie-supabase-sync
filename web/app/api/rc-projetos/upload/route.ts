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
import { dataDoGrupo, normGrupo } from "@/lib/grupos-equipamento-puro";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

type Item = {
  /** 08/10/26 (spec C.9): linha que já existe no banco vem com o id — grava POR ID, então
   *  editar o texto do item ou renomear o grupo não vira linha nova (e não perde
   *  rc_item_id, pc_item_id e os comentários). Sem id, vale a chave natural. */
  id?: string | null;
  /** Identificador da linha na tela (ex.: "l4x9a2"): volta em `refs` com o id gravado. */
  ref?: string | null;
  equipamento: string;
  item: string;
  qtd?: number | null;
  modelo?: string | null;
  observacao?: string | null;
  pc_numero?: string | null;
  /** Vindos do catálogo do Omie (autocompletar ou casamento). Ausentes = a
   *  origem não sabe deles (planilha pelo botão Lista RC) e o que já estava
   *  gravado é preservado. */
  cat_ncod_prod?: number | null;
  cat_codigo?: string | null;
  cat_valor_unit?: number | null;
  cat_fornecedor?: string | null;
  cat_entrega_dias?: number | null;
  cat_fat_dias?: number | null;
  /** 06/10/26: unidade e data em que o item é necessário (lista → compras/fluxo).
   *  Ausentes = preserva o que estava gravado. */
  un?: string | null;
  data_necessaria?: string | null;
  /** Sugestão de código do catálogo (sql/127). Ausentes = preserva o gravado. */
  sug_ncod_prod?: number | null;
  sug_codigo?: string | null;
  sug_descricao?: string | null;
  sug_fornecedor?: string | null;
  sug_score?: number | null;
  sug_status?: "pendente" | "aceita" | "recusada" | null;
};

const SUG_KEYS = ["sug_ncod_prod", "sug_codigo", "sug_descricao", "sug_fornecedor", "sug_score", "sug_status"] as const;
type Sug = { [K in (typeof SUG_KEYS)[number]]: string | number | null };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CAT_KEYS = ["cat_ncod_prod", "cat_codigo", "cat_valor_unit", "cat_fornecedor",
                  "cat_entrega_dias", "cat_fat_dias"] as const;
type Cat = { [K in (typeof CAT_KEYS)[number]]: string | number | null };

type Body = {
  empresa: string;
  codigo_projeto: number;
  items: Item[];
  /** Autoriza uma remoção em massa (metade ou mais da lista). Sem isto a rota
   *  devolve 409 e não apaga nada — ver a trava, mais abaixo. */
  confirmar_remocao?: boolean;
  /** Lista inteira excluída pela grade (🗑 em todas as linhas, 07/10/26): items vazio vale,
   *  e tudo vai para a lixeira. Só com confirmar_remocao. Planilha vazia continua recusada. */
  esvaziar?: boolean;
  /** Quando a grade carregou a lista (ISO). Linha que a ponte PC → lista (sql/156) criou
   *  DEPOIS disso a grade nem conhecia: não sai por não vir no corpo (09/10/26). */
  carregado_em?: string;
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
  const esvaziar = body.items.length === 0 && body.esvaziar === true && body.confirmar_remocao === true;
  if (body.items.length === 0 && !esvaziar) {
    return NextResponse.json({ error: "items vazio" }, { status: 400 });
  }
  if (body.items.length > HARD_CAP) {
    return NextResponse.json({ error: `Máximo ${HARD_CAP} items por upload` }, { status: 400 });
  }

  const userEmail = user.email || user.id;
  const empresa = String(body.empresa);
  const codigoProjeto = Number(body.codigo_projeto);
  const approval = supa.schema("approval" as never);

  // O que o banco tem hoje — a linha INTEIRA: o que sair vai para a lixeira, e o que
  // não vier no corpo é preservado. As colunas de sugestão (sql/127) são lidas à parte
  // da lista: sem a migração, a rota grava como antes.
  const BASE_COLS = "id, equipamento, item, item_norm, qtd, modelo, observacao, pc_numero, criado_em, criado_por, cat_ncod_prod, cat_codigo, cat_valor_unit, cat_fornecedor, cat_entrega_dias, cat_fat_dias, un, data_necessaria";
  let comSug = true;
  const ler = (cols: string) => approval.from("rc_projetos_itens").select(cols as "*")
    .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto) as unknown as Promise<{ data: unknown[] | null; error: { message: string } | null }>;
  let ex = await ler(`${BASE_COLS}, ${SUG_KEYS.join(", ")}`);
  if (ex.error && /sug_/.test(ex.error.message)) { comSug = false; ex = await ler(BASE_COLS); }
  if (ex.error) return NextResponse.json({ error: ex.error.message }, { status: 500 });

  type ExistingRow = {
    id: string; equipamento: string; item: string | null; item_norm: string;
    qtd: number | null; modelo: string | null; observacao: string | null;
    pc_numero: string | null; criado_em: string | null; criado_por: string | null;
    un: string | null; data_necessaria: string | null;
  } & Cat & Partial<Sug>;
  const existingRows = (ex.data ?? []) as unknown as ExistingRow[];
  const existingById = new Map(existingRows.map((r) => [r.id, r]));
  const existingByKey = new Map(existingRows.map((r) => [`${r.equipamento}\x01${r.item_norm}`, r]));

  type Entrada = {
    id: string | null; ref: string | null; key: string;
    equipamento: string; item: string; qtd: number | null; modelo: string | null;
    observacao: string | null; temObs: boolean; pc_numero: string | null;
    cat: Cat | null; sug: Sug | null; un?: string | null; data_necessaria?: string | null;
  };
  const numOuNull = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const entradas: Entrada[] = [];
  for (const raw of body.items) {
    const equipamento = String(raw.equipamento ?? "").trim();
    const item = String(raw.item ?? "").trim();
    if (!equipamento || !item) continue;
    const pcRaw = raw.pc_numero != null ? String(raw.pc_numero).trim() : "";
    const e: Entrada = {
      id: raw.id && UUID.test(String(raw.id)) && existingById.has(String(raw.id)) ? String(raw.id) : null,
      ref: raw.ref ? String(raw.ref).slice(0, 80) : null,
      key: `${equipamento}\x01${itemNorm(item)}`,
      equipamento, item, qtd: raw.qtd ?? null, modelo: raw.modelo ?? null,
      observacao: raw.observacao ?? null, temObs: "observacao" in raw, pc_numero: pcRaw || null,
      cat: null, sug: null,
    };
    if ("un" in raw) e.un = raw.un ? String(raw.un).trim().slice(0, 10).toUpperCase() : null;
    if ("data_necessaria" in raw) {
      const d = raw.data_necessaria ? String(raw.data_necessaria).slice(0, 10) : "";
      e.data_necessaria = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
    }
    if (CAT_KEYS.some((k) => k in raw)) {
      // Só as colunas que a origem trouxe: a planilha com "Código" e "Custo"
      // não apaga o casamento com o catálogo (cat_ncod_prod) feito na grade.
      const tudo: Cat = {
        cat_ncod_prod: numOuNull(raw.cat_ncod_prod),
        cat_codigo: raw.cat_codigo ? String(raw.cat_codigo).slice(0, 60) : null,
        cat_valor_unit: numOuNull(raw.cat_valor_unit),
        cat_fornecedor: raw.cat_fornecedor ? String(raw.cat_fornecedor).slice(0, 200) : null,
        cat_entrega_dias: numOuNull(raw.cat_entrega_dias),
        cat_fat_dias: numOuNull(raw.cat_fat_dias),
      };
      e.cat = Object.fromEntries(CAT_KEYS.filter((k) => k in raw).map((k) => [k, tudo[k]])) as Cat;
    }
    if ("sug_status" in raw) {
      const st = raw.sug_status === "pendente" || raw.sug_status === "aceita" || raw.sug_status === "recusada" ? raw.sug_status : null;
      e.sug = {
        sug_ncod_prod: st ? numOuNull(raw.sug_ncod_prod) : null,
        sug_codigo: st && raw.sug_codigo ? String(raw.sug_codigo).slice(0, 60) : null,
        sug_descricao: st && raw.sug_descricao ? String(raw.sug_descricao).slice(0, 300) : null,
        sug_fornecedor: st && raw.sug_fornecedor ? String(raw.sug_fornecedor).slice(0, 200) : null,
        sug_score: st ? numOuNull(raw.sug_score) : null,
        sug_status: st,
      };
    }
    entradas.push(e);
  }
  if (entradas.length === 0 && !esvaziar) {
    return NextResponse.json({ error: "Nenhum item válido (equipamento e item são obrigatórios)" }, { status: 400 });
  }

  /* Cada entrada vira UMA linha do banco: 1º as que vieram com id (por id), depois as
     sem id pela chave natural (se essa linha ainda não foi tomada), senão é nova.
     Duas entradas para a mesma linha: vale a última (como o dedup de sempre). */
  const porId = new Map<string, Entrada>();
  const novas = new Map<string, Entrada>();
  for (const e of entradas) if (e.id) porId.set(e.id, e);
  for (const e of entradas) {
    if (e.id) continue;
    const prior = existingByKey.get(e.key);
    if (prior && (!porId.has(prior.id) || porId.get(prior.id)!.id == null)) { e.id = prior.id; porId.set(prior.id, e); }
    else novas.set(e.key, e);
  }
  // A chave natural continua única no banco: duas linhas finais com o mesmo
  // equipamento + item ficam numa só (a última) — a outra sai (vai para a lixeira).
  // Duas linhas que JÁ existem não podem acabar iguais (renomeou uma para o texto da
  // outra): recusa em vez de apagar uma delas em silêncio.
  const finalPorChave = new Map<string, { e: Entrada; id: string | null }>();
  for (const [id, e] of porId) {
    if (finalPorChave.has(e.key)) {
      return NextResponse.json({ error: `Dois itens ficariam iguais no grupo "${e.equipamento}": "${e.item}" — mude o texto de um deles.` }, { status: 400 });
    }
    finalPorChave.set(e.key, { e, id });
  }
  for (const [k, e] of novas) {
    if (finalPorChave.get(k)?.id) {
      return NextResponse.json({ error: `O item "${e.item}" já está no grupo "${e.equipamento}" — mude o texto ou some a quantidade na linha que já existe.` }, { status: 400 });
    }
    finalPorChave.set(k, { e, id: null });
  }
  const mantidos = new Set([...finalPorChave.values()].filter((x) => x.id).map((x) => x.id!));

  const montar = (e: Entrada, prior: ExistingRow | undefined) => {
    const pcFinal = e.pc_numero ?? (prior?.pc_numero ?? null);
    return {
      empresa, codigo_projeto: codigoProjeto,
      equipamento: e.equipamento, item: e.item, qtd: e.qtd, modelo: e.modelo,
      observacao: e.temObs ? e.observacao : (prior?.observacao ?? null),
      pc_numero: pcFinal,
      ...(Object.fromEntries(CAT_KEYS.map((k) => [k, e.cat && k in e.cat ? e.cat[k] : (prior?.[k] ?? null)])) as Cat),
      ...(comSug ? Object.fromEntries(SUG_KEYS.map((k) => [k, e.sug ? e.sug[k] : (prior?.[k] ?? null)])) as Sug : {}),
      un: e.un !== undefined ? e.un : (prior?.un ?? null),
      data_necessaria: e.data_necessaria !== undefined ? e.data_necessaria : (prior?.data_necessaria ?? null),
      atualizado_por: userEmail,
    } as Record<string, unknown> & { equipamento: string; data_necessaria: string | null };
  };
  const finais = [...finalPorChave.values()].map(({ e, id }) => ({ e, id, row: montar(e, id ? existingById.get(id) : undefined) }));
  /* "Necessário em" por grupo (07/10/26): linha sem data herda a data do grupo de
     equipamento (a mais comum entre as linhas do grupo) — vale também para a
     planilha subida, não só para a grade. */
  const porGrupo = new Map<string, (string | null | undefined)[]>();
  for (const { row } of finais) porGrupo.set(normGrupo(row.equipamento), [...(porGrupo.get(normGrupo(row.equipamento)) ?? []), row.data_necessaria]);
  for (const { row } of finais) {
    if (row.data_necessaria) continue;
    const d = dataDoGrupo(porGrupo.get(normGrupo(row.equipamento)) ?? []);
    if (d) row.data_necessaria = d;
  }

  // ── Sync destrutivo, agora com lixeira ───────────────────────────────────
  //
  // Item que não vem na planilha nova sai — a planilha define o que existe, e
  // foi pedido assim. O que mudou é que ele passa a ser ARQUIVADO antes.
  //
  // Em 31/07/2026 o PJ358_Brasterapica perdeu equipamentos inteiros porque
  // alguém subiu uma planilha só com a aba "Eletrica". Restaram 36 itens de
  // painel num projeto de tratamento de água. Não havia rastro, e 48 dias
  // depois já estava fora de qualquer janela de recuperação do banco.
  /* Ponte PC → lista (09/10/26): a linha de compra direta que entrou enquanto a grade estava
     aberta não estava na tela — o "não veio no corpo" dela não é uma exclusão. */
  const novasDaPonte = new Set<string>();
  if (body.carregado_em && !Number.isNaN(Date.parse(body.carregado_em))) {
    const desde = new Date(Date.parse(body.carregado_em)).toISOString();
    const { data: pcs } = await approval.from("rc_projetos_itens").select("id")
      .eq("empresa", empresa).eq("codigo_projeto", codigoProjeto).eq("origem", "pc").gt("criado_em", desde) as unknown as { data: { id: string }[] | null };
    for (const r of pcs ?? []) novasDaPonte.add(r.id);
  }
  const aRemover = existingRows.filter((r) => !mantidos.has(r.id) && !novasDaPonte.has(r.id));

  /** Trava contra o apagão.
   *
   *  A grade salva por esta mesma rota. Quando a carga dela falha — a view de
   *  itens é pesada e essa tela já demora — ela fica com UMA linha vazia e o
   *  contador de "quantos existem" em zero. A guarda da tela compara o que vai
   *  salvar com esse zero, não dispara, e salvar 3 itens digitados apaga os
   *  478 que estavam no banco.
   *
   *  Aqui a conta é feita contra o que o BANCO tem, que é o número que não
   *  mente. Some quase tudo? Pára e exige confirmação explícita. Não é
   *  paranoia: já aconteceu, e a única cópia do trabalho de outra pessoa foi
   *  embora sem ninguém notar.
   *
   *  O piso de 5 evita atrapalhar projeto pequeno, onde trocar a lista
   *  inteira é uso normal. */
  const existiam = existingRows.length;
  const apagaQuase = existiam >= 5 && aRemover.length >= existiam * 0.5;
  if (apagaQuase && body.confirmar_remocao !== true) {
    return NextResponse.json({
      error: "remocao_em_massa",
      mensagem:
        `Esta planilha tem ${finais.length} item(ns) e o projeto tem ${existiam}. `
        + `Gravar assim REMOVE ${aRemover.length} item(ns)`
        + (aRemover.length === existiam ? " — a lista inteira" : "")
        + `. Se a intenção é substituir a lista, confirme; se a tela abriu vazia `
        + `por erro de carga, recarregue antes de salvar.`,
      existiam,
      entrando: finais.length,
      seriam_removidos: aRemover.length,
      equipamentos_afetados: Array.from(new Set(aRemover.map((r) => r.equipamento))),
    }, { status: 409 });
  }

  /* A lixeira vem ANTES de gravar (08/10/26): com a gravação por id, uma linha
     renomeada pode tomar a chave natural de uma que está saindo — apagar depois
     esbarraria na chave única. O que sai fica arquivado (recuperável), então a
     ordem não arrisca o dado. */
  let deleted = 0;
  const equipamentosPerdidos: string[] = [];
  if (aRemover.length > 0) {
    // Equipamento que desapareceu INTEIRO é o caso grave: não é a planilha
    // corrigindo um item, é uma aba que ficou de fora do arquivo.
    const equipEntrando = new Set(finais.map((f) => f.e.equipamento));
    const equipSaindo = new Set(aRemover.map((r) => r.equipamento));
    for (const e of equipSaindo) if (!equipEntrando.has(e)) equipamentosPerdidos.push(e);

    // Arquiva ANTES de apagar. Se o insert falhar, nada é removido.
    const { error: arqErr } = await approval
      .from("rc_projetos_itens_lixeira")
      .insert(aRemover.map((r) => ({
        item_id: r.id, empresa, codigo_projeto: codigoProjeto,
        equipamento: r.equipamento, item: r.item, item_norm: r.item_norm,
        qtd: r.qtd, modelo: r.modelo, observacao: r.observacao,
        pc_numero: r.pc_numero, criado_em: r.criado_em, criado_por: r.criado_por,
        ...Object.fromEntries(CAT_KEYS.map((k) => [k, r[k] ?? null])),
        apagado_por: userEmail,
        apagado_por_upload: `${finais.length} item(ns) de ${equipEntrando.size} equipamento(s)`,
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

  // Existentes: por id (todas as colunas vão no corpo — o que não veio já foi
  // completado com o gravado, então nada é zerado sem querer).
  const atualizar = finais.filter((f) => f.id).map((f) => ({ id: f.id!, ...f.row, atualizado_em: new Date().toISOString() }));
  if (atualizar.length) {
    const { error: upErr } = await approval.from("rc_projetos_itens").upsert(atualizar, { onConflict: "id", ignoreDuplicates: false });
    if (upErr) {
      const dup = /duplicate key|unique/i.test(upErr.message);
      return NextResponse.json({ error: dup
        ? `Dois itens ficariam iguais no mesmo grupo (mesmo equipamento e mesmo texto) — mude um deles. (${upErr.message})`
        : upErr.message }, { status: 500 });
    }
  }
  // Novas: insert, devolvendo o id de cada uma (a tela troca o id provisório).
  const inserir = finais.filter((f) => !f.id).map((f) => ({ ...f.row, criado_por: userEmail }));
  const idsNovos = new Map<string, string>();
  if (inserir.length) {
    const { data: ins, error: insErr } = await approval.from("rc_projetos_itens").insert(inserir).select("id, equipamento, item_norm");
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    for (const r of (ins ?? []) as { id: string; equipamento: string; item_norm: string }[]) idsNovos.set(`${r.equipamento}\x01${r.item_norm}`, r.id);
  }

  // { chave natural → id } e { ref da tela → id } (spec C.5)
  const ids: Record<string, string> = {};
  const refs: Record<string, string> = {};
  for (const f of finais) {
    const id = f.id ?? idsNovos.get(f.e.key);
    if (!id) continue;
    ids[`${f.e.equipamento}|${itemNorm(f.e.item)}`] = id;
    if (f.e.ref) refs[f.e.ref] = id;
  }
  for (const e of entradas) if (e.ref && !refs[e.ref]) { const f = finalPorChave.get(e.key); const id = f ? (f.id ?? idsNovos.get(e.key)) : null; if (id) refs[e.ref] = id; }

  return NextResponse.json({
    ok: true,
    total_recebidos: body.items.length,
    total_processados: finais.length,
    total_deletados: deleted,
    total_no_projeto: finais.length,
    // A tela precisa PODER avisar. "total_deletados: 412" passou despercebido
    // uma vez; o nome do equipamento que sumiu não passa.
    equipamentos_removidos: equipamentosPerdidos,
    recuperavel: deleted > 0,
    ids, refs,
    /** false = sql/127 ainda não aplicada: a sugestão não foi gravada. */
    sugestao_gravada: comSug,
  });
}
