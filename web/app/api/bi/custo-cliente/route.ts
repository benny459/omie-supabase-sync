// GET /api/bi/custo-cliente?from=YYYY-MM-DD&to=YYYY-MM-DD&tipo=&cliente=
//
// Custo operacional por cliente, LIDO DIRETO do banco do app de serviços.
//
// Antes isto vinha por um cron das 6h15 no allka-01, que copiava a view do app
// para bi.custo_cliente_snapshot aqui. Aquele caminho tinha três defeitos, todos
// da própria existência da cópia:
//   • trazia só o agregado de despesa, então combustível e pedágio não dava pra
//     separar (33% do custo era deslocamento e ninguém via);
//   • falhava em silêncio — o REFRESH da MV estourava timeout DEPOIS do commit,
//     então o snapshot ficava novo e a receita velha;
//   • defasagem de até 24h.
// Lendo direto, a classe inteira de problema desaparece.
//
// O snapshot continua existindo como rede: se o app estiver fora do ar, a tela
// cai nele em vez de ficar vazia. Ver `fonte` no retorno.
//
// A RECEITA continua vindo do omie-data (sales.v_cliente_receita_compras) — é
// aqui que ela mora. O cruzamento é por (cliente, mês).

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { wwClient } from "@/lib/owner-clients";
import { createClient } from "@supabase/supabase-js";
import { selectPaginado } from "@/lib/supabase-paginado";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Uma linha da view do app: custo de um cliente × técnico × tipo × mês. */
type CustoRow = {
  omie_codigo_cliente: number | null;
  customer_id: string | null;
  customer_nome: string | null;
  technician_id: string | null;
  technician_nome: string | null;
  tipo_venda: string | null;
  periodo_mes: string | null;
  despesas_diretas_alocadas: number | null;
  combustivel_km_alocado: number | null;
  pedagio_km_alocado: number | null;
  despesas_empresa: number | null;
  custo_mao_obra: number | null;
  custo_total: number | null;
  qtd_os: number | null;
};

/** Códigos negativos não são cliente: são baldes de custo que a origem usa
 *  quando a OS não pertence a ninguém em particular. Sem esta tradução eles
 *  apareceriam como "cliente -1", que não diz nada. */
const BUCKETS: Record<number, string> = {
  [-1]: "EMPRESA (overhead)",
  [-2]: "COMERCIAL / relacionamento",
  [-3]: "OUTROS",
  [-4]: "AVULSO não vinculado",
  [-9]: "NÃO ATRIBUÍDO",
};
const ehBucket = (cod: number | null) => cod != null && cod < 0;

const num = (v: unknown) => Number(v) || 0;

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso a custo por cliente" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");   // YYYY-MM-DD
  const to   = url.searchParams.get("to");
  const tipoFiltro = (url.searchParams.get("tipo") ?? "").trim();

  const ww = wwClient();
  if (!ww) {
    return NextResponse.json({
      error: "Banco do app de serviços não configurado",
      hint: "Faltam WW_SUPABASE_URL / WW_SERVICE_ROLE_KEY no ambiente.",
    }, { status: 503 });
  }

  // ── Custo: direto do app, paginado (a view passa de 1000 linhas) ──────────
  const bi = ww.schema("bi" as never);
  const { data: custoRaw, error: errCusto } = await selectPaginado<CustoRow>(() => {
    let q = bi.from("v_custo_por_cliente").select("*").order("periodo_mes", { ascending: true });
    // O filtro de período vai pro banco: puxar 18 anos de histórico pra recortar
    // no cliente seria desperdício de banda a cada troca de data.
    if (from) q = q.gte("periodo_mes", from.slice(0, 8) + "01");
    if (to)   q = q.lte("periodo_mes", to.slice(0, 8) + "01");
    return q as never;
  });
  if (errCusto) {
    return NextResponse.json({ error: `custo (app): ${errCusto.message}` }, { status: 502 });
  }

  const custo = (custoRaw ?? []).filter((r) => !tipoFiltro || r.tipo_venda === tipoFiltro);

  // ── Receita: do painel, onde ela mora ────────────────────────────────────
  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "sales" } },
  );
  const { data: receitaRaw } = await selectPaginado<{
    codigo_cliente: number | null; cliente_nome: string | null;
    periodo_mes: string | null; faturamento: number | null; total_compras: number | null;
  }>(() => {
    let q = adm.from("v_cliente_receita_compras")
      .select("codigo_cliente, cliente_nome, periodo_mes, faturamento, total_compras")
      .order("periodo_mes", { ascending: true });
    if (from) q = q.gte("periodo_mes", from.slice(0, 8) + "01");
    if (to)   q = q.lte("periodo_mes", to.slice(0, 8) + "01");
    return q as never;
  });

  // ── Consolida por cliente ────────────────────────────────────────────────
  type Linha = {
    codigo: number | null; nome: string; is_bucket: boolean; sem_link: boolean;
    diretas: number; combustivel: number; pedagio: number; mao_obra: number;
    custo_total: number; qtd_os: number;
    receita: number; compras: number;
    tecnicos: Set<string>;
    por_tipo: Record<string, number>;
  };
  const mapa = new Map<string, Linha>();
  const chave = (r: CustoRow) =>
    r.omie_codigo_cliente != null ? `o:${r.omie_codigo_cliente}` : `c:${r.customer_id ?? r.customer_nome}`;

  for (const r of custo) {
    const k = chave(r);
    const cod = r.omie_codigo_cliente;
    const linha = mapa.get(k) ?? {
      codigo: cod,
      nome: ehBucket(cod) ? (BUCKETS[cod!] ?? `Bucket ${cod}`) : (r.customer_nome ?? "(sem nome)"),
      is_bucket: ehBucket(cod),
      // Cliente do app que nunca foi vinculado a um código do Omie: tem custo,
      // mas não tem receita pra comparar. Some da rentabilidade se não for
      // sinalizado.
      sem_link: cod == null,
      diretas: 0, combustivel: 0, pedagio: 0, mao_obra: 0, custo_total: 0, qtd_os: 0,
      receita: 0, compras: 0, tecnicos: new Set<string>(), por_tipo: {},
    };
    linha.diretas     += num(r.despesas_diretas_alocadas);
    linha.combustivel += num(r.combustivel_km_alocado);
    linha.pedagio     += num(r.pedagio_km_alocado);
    linha.mao_obra    += num(r.custo_mao_obra);
    linha.custo_total += num(r.custo_total);
    linha.qtd_os      += num(r.qtd_os);
    if (r.technician_nome) linha.tecnicos.add(r.technician_nome);
    const t = r.tipo_venda ?? "(sem tipo)";
    linha.por_tipo[t] = (linha.por_tipo[t] ?? 0) + num(r.custo_total);
    mapa.set(k, linha);
  }

  // Receita entra só onde há código Omie — é a única chave comum entre os dois
  // bancos. Cliente sem link fica com receita zero e é marcado.
  for (const r of receitaRaw ?? []) {
    if (r.codigo_cliente == null) continue;
    const k = `o:${r.codigo_cliente}`;
    const linha = mapa.get(k);
    if (!linha) continue;   // receita sem custo não entra nesta tela
    linha.receita += num(r.faturamento);
    linha.compras += num(r.total_compras);
  }

  const linhas = Array.from(mapa.values())
    .map((l) => ({
      codigo: l.codigo,
      nome: l.nome,
      is_bucket: l.is_bucket,
      sem_link: l.sem_link,
      diretas: l.diretas,
      combustivel: l.combustivel,
      pedagio: l.pedagio,
      mao_obra: l.mao_obra,
      custo_total: l.custo_total,
      qtd_os: l.qtd_os,
      tecnicos: l.tecnicos.size,
      receita: l.receita,
      compras: l.compras,
      // Margem só faz sentido com receita: em bucket de overhead ela seria
      // -100% sempre, o que não informa nada.
      margem: l.receita > 0 ? l.receita - l.compras - l.custo_total : null,
      margem_pct: l.receita > 0
        ? ((l.receita - l.compras - l.custo_total) / l.receita) * 100
        : null,
      por_tipo: l.por_tipo,
    }))
    .sort((a, b) => b.custo_total - a.custo_total);

  const soma = (k: "diretas" | "combustivel" | "pedagio" | "mao_obra" | "custo_total" | "qtd_os" | "receita") =>
    linhas.reduce((a, l) => a + (l[k] as number), 0);

  // Série mensal, pra ver o custo evoluindo
  const porMes = new Map<string, { x: string; diretas: number; combustivel: number; pedagio: number; mao_obra: number }>();
  for (const r of custo) {
    const m = (r.periodo_mes ?? "").slice(0, 7);
    if (!m) continue;
    const linha = porMes.get(m) ?? { x: m, diretas: 0, combustivel: 0, pedagio: 0, mao_obra: 0 };
    linha.diretas     += num(r.despesas_diretas_alocadas);
    linha.combustivel += num(r.combustivel_km_alocado);
    linha.pedagio     += num(r.pedagio_km_alocado);
    linha.mao_obra    += num(r.custo_mao_obra);
    porMes.set(m, linha);
  }

  // Composição por tipo de venda — os chips da tela do app
  const porTipo = new Map<string, number>();
  for (const r of custo) {
    const t = r.tipo_venda ?? "(sem tipo)";
    porTipo.set(t, (porTipo.get(t) ?? 0) + num(r.custo_total));
  }

  return NextResponse.json({
    fonte: "app-direto",   // vs "snapshot", se um dia cair pro fallback
    total: {
      diretas: soma("diretas"),
      combustivel: soma("combustivel"),
      pedagio: soma("pedagio"),
      mao_obra: soma("mao_obra"),
      custo_total: soma("custo_total"),
      qtd_os: soma("qtd_os"),
      receita: soma("receita"),
      clientes: linhas.filter((l) => !l.is_bucket && !l.sem_link).length,
    },
    // Quanto do custo é de cliente de verdade e quanto é overhead/sem vínculo.
    reparticao: {
      cliente_real: linhas.filter((l) => !l.is_bucket && !l.sem_link).reduce((a, l) => a + l.custo_total, 0),
      sem_link:     linhas.filter((l) => l.sem_link).reduce((a, l) => a + l.custo_total, 0),
      buckets:      linhas.filter((l) => l.is_bucket).reduce((a, l) => a + l.custo_total, 0),
    },
    tipos: Array.from(porTipo.entries()).map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value),
    mensal: Array.from(porMes.values()).sort((a, b) => a.x.localeCompare(b.x)),
    linhas,
  });
}
