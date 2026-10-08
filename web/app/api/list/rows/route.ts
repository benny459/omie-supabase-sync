// GET /api/list/rows?view=v_pc_pcs
// Retorna { rows, count, truncated } — usado pelo BoldAvulsosLoader pra fazer
// client-fetch da lista em vez de bloquear o SSR. Autenticação obrigatória.
//
// Views permitidas: v_pc_avulsos, v_pc_pcs, v_pc_projetos.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { createClient } from "@supabase/supabase-js";
import { lerAjustes, devolvidoPorPc, valorLiquido } from "@/lib/pc-ajustes";

export const runtime = "nodejs";
export const maxDuration = 60;

// Views lógicas → materialized views no schema sales (refreshadas a cada 10min via pg_cron).
// A MV lê em <1s vs 10-15s da view crua.
const VIEW_MAP: Record<string, string> = {
  v_pc_avulsos:  "mv_pc_avulsos",
  v_pc_pcs:      "mv_pc_pcs",
  v_pc_projetos: "mv_pc_projetos",
};

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "";
  const mvName = VIEW_MAP[view];
  if (!mvName) return NextResponse.json({ error: "view inválida" }, { status: 400 });
  // PAGE = 1000 é o cap default do PostgREST/Supabase: pedir .limit(2000) volta
  // 1000 silenciosamente. Era esse o bug — /avulsos (1776 rows) recebia só 1000
  // e os alarmes, calculados client-side, subestimavam. Paginamos com .range()
  // até acabar. MAX_ROWS é só safety net contra loop infinito.
  const PAGE = 1000;
  const MAX_ROWS = 20_000;
  const limit = Math.min(MAX_ROWS, Math.max(1, Number(url.searchParams.get("limit") ?? MAX_ROWS)));
  const countMode = url.searchParams.get("count") === "exact" ? "exact" : "estimated";
  /* Carga rápida (01/10/2026): a tela abre em "Em aberto", então a primeira
     leitura traz só os não faturados, direto da MV e sem a consulta da view
     viva (6s por página só ela). O loader busca o resto em segundo plano.
     `aberto=1` filtra; `rapido=1` dispensa a view viva. */
  let soAberto = url.searchParams.get("aberto") === "1" && view !== "v_pc_pcs";
  const rapido = url.searchParams.get("rapido") === "1";

  /* Recarga de UM pedido (01/10/2026): depois de digitar um nº de PC na
     lista, a tela pede só as linhas desse pedido à view VIVA — que já casa o
     PC manual com o Omie (fornecedor, valor, status, NF) — em vez de esperar o
     refresh de 10 min da MV ou recarregar tudo. `pv` = lista de PV/OS,
     `projeto` = código do projeto (linhas direto no projeto, sem PV). */
  const pvs = (url.searchParams.get("pv") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50);
  const projeto = Number(url.searchParams.get("projeto") ?? 0) || null;
  if (pvs.length || projeto) {
    if (pvs.some((x) => !/^[\w .\-\/]+$/.test(x))) return NextResponse.json({ error: "pv inválido" }, { status: 400 });
    const live = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false }, db: { schema: "approval" } },
    );
    const conds = [
      ...(pvs.length ? [`pv_os_label.in.(${pvs.map((x) => `"${x}"`).join(",")})`] : []),
      ...(projeto ? [`codigo_projeto.eq.${projeto}`] : []),
    ];
    const { data, error } = await live.from(view).select("*").or(conds.join(",")).limit(2000);
    if (error) return NextResponse.json({ error: `${view}: ${error.message}` }, { status: 500 });
    let linhas = (data ?? []) as Record<string, unknown>[];
    // Mesmo filtro de PCs escondidos da carga completa (ver abaixo).
    const { data: esc } = await live.schema("platform" as never).from("excluded_pc").select("empresa, pc_numero");
    if (esc?.length) {
      const ch = new Set((esc as { empresa: string; pc_numero: string }[]).map((e) => `${e.empresa}|${String(e.pc_numero).trim()}`));
      linhas = linhas.filter((r) => {
        const pc = String(r.pc_numero ?? r.pc_numero_manual ?? "").trim();
        return !pc || !ch.has(`${String(r.empresa ?? "")}|${pc}`);
      });
    }
    linhas = await comDevolucoes(linhas);
    return NextResponse.json({ rows: linhas, count: linhas.length, parcial: true });
  }

  // MVs vivem em sales.* — cliente service com schema sales
  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "sales" } },
  );

  /* 08/10/26 (desempenho): PCs escondidos e devoluções não dependem da lista — saem já,
     em paralelo com a leitura da MV, em vez de esperar por ela no fim. */
  const escondidosP = (async () => {
    try {
      const { data, error } = await adm.schema("platform" as never).from("excluded_pc").select("empresa, pc_numero");
      return error ? null : (data ?? []) as { empresa: string; pc_numero: string }[];
    } catch { return null; }
  })();
  const ajustesP = lerAjustes({});

  /* "★ Só ativos" no servidor (08/10/26): `ativos=1` (só Projetos) traz apenas os cartões
     dos projetos marcados como ativos (approval.rc_projetos_budget.ativo, sql/130) — ~300
     linhas em vez de ~1,7 mil. O cartão é agrupado por projeto_nome, então vêm TODAS as
     linhas dos nomes que têm alguma linha de projeto ativo (o mesmo grupo que a tela monta
     com a lista inteira; a tela ainda aplica o seu próprio filtro de ativos por cima).
     Nenhum ativo marcado (ou falha) = sem filtro, como a tela já fazia. */
  let nomesAtivos: { nomes: string[]; semNome: boolean } | null = null;
  if (url.searchParams.get("ativos") === "1" && view === "v_pc_projetos") {
    nomesAtivos = await nomesDosAtivos(adm);
    // Com o filtro de ativos vêm os cartões inteiros (abertos e faturados); `aberto=1` só
    // vale quando não há ativos marcados — aí a resposta é a carga rápida de sempre.
    if (nomesAtivos) soAberto = false;
  }

  // Ordenação é a mesma em toda página — as chaves são únicas por MV
  // (pv_os_label+ncod_ped em avulsos/projetos, ncod_ped em pcs), então o
  // .range() não pula nem duplica linhas entre páginas.
  const buildPage = (from: number, to: number, withCount: boolean) => {
    let q = withCount
      ? adm.from(mvName).select("*", { count: countMode as "exact" | "estimated" })
      : adm.from(mvName).select("*");
    if (view === "v_pc_pcs") {
      q = q.order("pc_etapa_code", { ascending: true, nullsFirst: false })
           .order("pc_numero",     { ascending: true, nullsFirst: false })
           .order("ncod_ped",      { ascending: true });
    } else {
      q = q.order("pv_os_label", { ascending: true, nullsFirst: false })
           .order("ncod_ped",    { ascending: true });
    }
    // Mesmo critério do encerrado() do cliente: sem data/NF de faturamento e
    // etapa que não seja Faturado/Cancelado.
    if (soAberto) {
      q = q.is("pv_dt_fat", null).is("pv_num_nfe", null)
           .or("pv_etapa_texto.is.null,pv_etapa_texto.not.in.(Faturado,Cancelado)");
    }
    if (nomesAtivos) {
      const lista = nomesAtivos.nomes.map((n) => `"${n.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",");
      const conds = [...(nomesAtivos.nomes.length ? [`projeto_nome.in.(${lista})`] : []), ...(nomesAtivos.semNome ? ["projeto_nome.is.null"] : [])];
      q = conds.length ? q.or(conds.join(",")) : q.is("projeto_nome", null).not("projeto_nome", "is", null); // nenhum: lista vazia
    }
    return q.range(from, to);
  };

  // Linhas manuais (ncod_ped < 0) só entram na MV no próximo refresh (10min).
  // Busca-as na view VIVA em paralelo e substitui as da MV no merge — senão a
  // linha recém-criada some no reload pós-criação e o usuário acha que falhou.
  // Qualquer falha devolve null → fica a MV.
  // 08/10/26: primeiro tenta approval.pc_lista_manuais (sql/147) — a view montada UMA vez,
  // tudo num json só. Pelo PostgREST eram páginas de 1000 em série, e cada página montava a
  // view inteira de novo (Avulsos: 2 × ~8 s). Sem a função, volta às páginas.
  const liveManualPromise = (async (): Promise<Record<string, unknown>[] | null> => {
    if (rapido || nomesAtivos) return null;
    try {
      const liveClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false }, db: { schema: "approval" } },
      );
      const fn = await liveClient.rpc("pc_lista_manuais", { p_view: view });
      if (!fn.error && Array.isArray(fn.data)) return fn.data as Record<string, unknown>[];
      const live: Record<string, unknown>[] = [];
      for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
        const { data, error } = await liveClient.from(view).select("*").lt("ncod_ped", 0)
          .order("pv_os_label", { ascending: true, nullsFirst: false })
          .order("ncod_ped",    { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) return null;
        const batch = (data ?? []) as Record<string, unknown>[];
        live.push(...batch);
        if (batch.length < PAGE) return live;
      }
      return null;  // bateu MAX_ROWS — incompleto, melhor ficar com a MV
    } catch { return null; }
  })();

  /* Páginas da MV: a primeira (com a contagem) e depois as seguintes de 3 em 3 em paralelo
     (08/10/26 — eram uma a uma). Mesma ordem, mesmas páginas, mesmo resultado. */
  const rows: Record<string, unknown>[] = [];
  let headerCount: number | null = null;
  let truncated = false;
  {
    const first = await buildPage(0, Math.min(PAGE, limit) - 1, true);
    if (first.error) return NextResponse.json({ error: `${mvName}: ${first.error.message}` }, { status: 500 });
    headerCount = first.count ?? null;
    const b0 = (first.data ?? []) as Record<string, unknown>[];
    rows.push(...b0);
    let acabou = b0.length < Math.min(PAGE, limit);
    let offset = PAGE;
    while (!acabou) {
      if (offset >= limit) { truncated = true; break; }
      const lote: { from: number; size: number }[] = [];
      for (let k = 0; k < 3 && offset < limit; k++, offset += PAGE) lote.push({ from: offset, size: Math.min(PAGE, limit - offset) });
      const res = await Promise.all(lote.map((p) => buildPage(p.from, p.from + p.size - 1, false)));
      for (let k = 0; k < res.length; k++) {
        const { data, error } = res[k];
        if (error) return NextResponse.json({ error: `${mvName}: ${error.message}` }, { status: 500 });
        const batch = (data ?? []) as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < lote[k].size) { acabou = true; break; }  // última página
      }
      if (!acabou && offset >= limit) { truncated = true; break; }
    }
  }

  // Merge: linhas manuais frescas da view viva substituem as da MV (stale).
  // Se a view viva falhar (timeout etc), mantém as da MV — nunca pior que antes.
  const liveManual = await liveManualPromise;
  let merged = rows;
  if (liveManual !== null) {
    merged = rows.filter(r => Number(r.ncod_ped) >= 0).concat(liveManual);
  }

  /* PCs escondidos (platform.excluded_pc). Filtra-se aqui, e não na view, por
     dois motivos: a v_pc_completo é grande e não está versionada em lado
     nenhum — mexer nela para isto seria risco desproporcionado; e filtrar
     depois da MV faz o PC sumir no primeiro reload, em vez de esperar pelo
     refresh de 10 minutos.
     Vale para o PC do Omie e para a linha manual que aponte para o mesmo
     número: excluir o 7262 tira o 7262, venha ele de onde vier.
     Se a consulta falhar, não se esconde nada — mostrar a mais é menos grave
     que esconder por engano. */
  const escondidos = await escondidosP;
  if (escondidos && escondidos.length > 0) {
    const chaves = new Set(escondidos.map(e => `${e.empresa}|${String(e.pc_numero).trim()}`));
    merged = merged.filter((r) => {
      const pc = String(r.pc_numero ?? r.pc_numero_manual ?? "").trim();
      if (!pc) return true;
      return !chaves.has(`${String(r.empresa ?? "")}|${pc}`);
    });
  }

  merged = await comDevolucoes(merged, ajustesP);

  // Buscamos a MV inteira, então rows.length É o total — mais confiável que o
  // count "estimated" do planner. Só caímos no header count se batemos MAX_ROWS.
  return NextResponse.json({
    rows: merged,
    count: truncated ? (headerCount ?? merged.length) : merged.length,
    truncated,
    parcial: soAberto || rapido || !!nomesAtivos,
    ...(nomesAtivos ? { ativos: true } : {}),
  });
}

/** Nomes de projeto (projeto_nome da MV) que têm alguma linha de um projeto ativo, ou null
 *  quando não há ativos marcados / a coluna não existe / algo falhou (= sem filtro). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function nomesDosAtivos(adm: any): Promise<{ nomes: string[]; semNome: boolean } | null> {
  try {
    const { data: at, error } = await adm.schema("approval" as never).from("rc_projetos_budget")
      .select("empresa, codigo_projeto").eq("ativo", true);
    if (error || !at?.length) return null;
    const ativos = at as { empresa: string; codigo_projeto: number }[];
    const chaves = new Set(ativos.map((a) => `${String(a.empresa).toUpperCase()}|${Number(a.codigo_projeto)}`));
    const cods = [...new Set(ativos.map((a) => String(Number(a.codigo_projeto))))];
    const { data, error: e2 } = await adm.from("mv_pc_projetos").select("empresa, codigo_projeto, pv_codigo_projeto, projeto_nome")
      .or(`codigo_projeto.in.(${cods.join(",")}),pv_codigo_projeto.in.(${cods.join(",")})`).limit(5000);
    if (e2) return null;
    const nomes = new Set<string>();
    let semNome = false;
    for (const r of (data ?? []) as { empresa: string | null; codigo_projeto: number | null; pv_codigo_projeto: string | null; projeto_nome: string | null }[]) {
      // mesma regra da tela (projDe): codigo_projeto, senão pv_codigo_projeto; empresa SF por padrão
      const cod = Number(r.codigo_projeto ?? r.pv_codigo_projeto ?? 0);
      if (!(cod > 0) || !chaves.has(`${(String(r.empresa ?? "") || "SF").toUpperCase()}|${cod}`)) continue;
      if (r.projeto_nome) nomes.add(r.projeto_nome); else semNome = true;
    }
    return { nomes: [...nomes], semNome };
  } catch { return null; }
}

/* Devolução de material (sql/146): o PC continua na lista, mas o valor devolvido sai
   da conta do projeto — valor_total vira o líquido (o original fica em
   valor_total_original) e pc_devolucao diz total/parcial para a pílula. Assim margem,
   barras e KPIs, que leem valor_total, já contam certo. Falhou a leitura: nada muda. */
async function comDevolucoes(rows: Record<string, unknown>[], ajustes?: ReturnType<typeof lerAjustes>): Promise<Record<string, unknown>[]> {
  const { devolucoes } = await (ajustes ?? lerAjustes({}));
  if (!devolucoes.length) return rows;
  const dev = devolvidoPorPc(devolucoes);
  return rows.map((r) => {
    const pc = String(r.pc_numero ?? r.pc_numero_manual ?? "").trim();
    const d = pc ? dev.get(`${String(r.empresa ?? "")}|${pc}`) : undefined;
    if (!d) return r;
    const v = Number(r.valor_total ?? 0) || 0;
    return { ...r, valor_total_original: r.valor_total, valor_total: r.valor_total == null ? null : valorLiquido(v, d),
      pc_devolucao: { tipo: d.tipo, valor: d.valor } };
  });
}
