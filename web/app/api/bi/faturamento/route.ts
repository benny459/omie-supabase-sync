// GET /api/bi/faturamento?from=&to=&empresas=&cat=&situacao=
//
// Porte do domínio "Faturamento" (dashboard 3 + aba da Visão Geral) FUNDIDO com
// o ciclo de recebimento (cards 142 e 130).
//
// Eram duas telas: uma respondia "quanto faturei e em quanto tempo recebo" e a
// outra "do que faturei, quanto já entrou". Como é o mesmo dinheiro visto em
// dois momentos, ficaram juntas — e a tabela de detalhe passou a trazer a NF e o
// título que ela gerou na MESMA linha, filtrável por situação.
//
// NÃO confundir com /api/relatorios/faturamento, que é o faturamento DIÁRIO
// operacional. Este é o analítico.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";
import { rpcPaginado } from "@/lib/rpc-paginado";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso a Faturamento" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const dim  = url.searchParams.get("dim") === "cliente" ? "cliente" : "projeto";
  const list = (k: string) => {
    const raw = (url.searchParams.get(k) ?? "").trim();
    return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : null;
  };
  const empresas = list("empresas");
  const cat = list("cat");
  const situacoes = list("situacao");
  // Grão da tabela: nota (padrão) ou parcela. Uma nota de 12x vira 12 linhas.
  const porParcela = url.searchParams.get("parcela") === "1";

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const args = { p_from: from, p_to: to, p_empresas: empresas, p_cat_venda: cat };
  const [resumo, mensal, prazos, top, detalhe, coorte, calendario] = await Promise.all([
    adm.rpc("fat_resumo", args),
    adm.rpc("fat_mensal_categoria", args),
    adm.rpc("fat_prazos", args),
    adm.rpc("fat_top", { ...args, p_dim: dim, p_limit: 20 }),
    // Detalhe fundido: a NF e o título que ela gerou na mesma linha.
    // Paginado: no grão parcela a lista passa de 1000 linhas com facilidade, e o
    // PostgREST corta aí sem avisar. Ver lib/rpc-paginado.ts.
    rpcPaginado(adm, "faturamento_com_titulo",
                { ...args, p_situacoes: situacoes, p_por_parcela: porParcela, p_limit: 6000 }),
    adm.rpc("fat_coorte", args),
    // Sem recorte de período: o que está aberto está aberto, tenha nascido neste
    // mês ou em 2020 — filtrar por data aqui esconderia o mais velho.
    adm.rpc("fat_calendario", { p_empresas: empresas, p_cat_venda: cat }),
  ]);

  for (const [n, r] of [["fat_resumo", resumo], ["fat_mensal_categoria", mensal],
                        ["fat_prazos", prazos], ["fat_top", top],
                        ["faturamento_com_titulo", detalhe],
                        ["fat_coorte", coorte], ["fat_calendario", calendario]] as const) {
    if (r.error) return NextResponse.json({ error: `${n}: ${r.error.message}` }, { status: 500 });
  }

  const head = (Array.isArray(resumo.data) ? resumo.data[0] : resumo.data) as Record<string, unknown> | null;
  const num = (k: string) => Number(head?.[k]) || 0;

  // Pivota o mensal por categoria — o gráfico quer uma coluna por série.
  type M = { mes: string; categoria: string; valor: number; qtd: number };
  const porMes = new Map<string, Record<string, number>>();
  const cats = new Set<string>();
  for (const r of (mensal.data ?? []) as M[]) {
    cats.add(r.categoria);
    const linha = porMes.get(r.mes) ?? {};
    linha[r.categoria] = (linha[r.categoria] ?? 0) + (Number(r.valor) || 0);
    porMes.set(r.mes, linha);
  }

  type P = { tipo: string; faixa: string; ord: number; qtd: number; media_dias: number };
  const prazoRows = (prazos.data ?? []) as P[];
  const mediaPonderada = (tipo: string) => {
    const rows = prazoRows.filter((r) => r.tipo === tipo);
    const n = rows.reduce((a, r) => a + (Number(r.qtd) || 0), 0);
    if (!n) return null;
    return rows.reduce((a, r) => a + (Number(r.media_dias) || 0) * (Number(r.qtd) || 0), 0) / n;
  };

  return NextResponse.json({
    total_periodo: num("total_periodo"),
    total_ytd:     num("total_ytd"),
    total_mes:     num("total_mes"),
    qtd_notas:     num("qtd_notas"),
    qtd_notas_ytd: num("qtd_notas_ytd"),
    mensal: Array.from(porMes.entries()).sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({ x: mes, ...v })),
    categorias: Array.from(cats).sort(),
    dso: {
      media: mediaPonderada("DSO (efetivo)"),
      faixas: prazoRows.filter((r) => r.tipo === "DSO (efetivo)")
        .map((r) => ({ label: r.faixa, value: Number(r.qtd) || 0 })),
    },
    concedido: {
      media: mediaPonderada("Concedido"),
      faixas: prazoRows.filter((r) => r.tipo === "Concedido")
        .map((r) => ({ label: r.faixa, value: Number(r.qtd) || 0 })),
    },
    top: ((top.data ?? []) as Array<{ chave: string; valor: number; qtd: number }>)
      .map((t) => ({ chave: t.chave, valor: Number(t.valor) || 0, qtd: Number(t.qtd) || 0 })),
    dim,
    por_parcela: porParcela,
    detalhe: detalhe.data ?? [],
    coorte: coorte.data ?? [],
    calendario: pivotarCalendario((calendario.data ?? []) as CalRow[]),
  });
}

type CalRow = {
  vence_em: string | null; esta_vencido: boolean; origem_mes: string | null;
  titulos: number; a_receber: number;
};

/** Calendário pivotado: uma linha por mês de vencimento, uma coluna por mês de
 *  faturamento de origem. "Vencido" vai na frente porque é dinheiro que já
 *  deveria ter entrado — em ordem cronológica ele se esconderia no meio. */
function pivotarCalendario(cal: CalRow[]) {
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const rotulo = (iso: string | null) => {
    if (!iso) return "Sem NF";
    const [a, m] = iso.slice(0, 7).split("-");
    return `${MESES[Number(m) - 1]}/${a.slice(2)}`;
  };

  // Teto de 6 origens: a paleta tem 8 slots e lança erro no 9º, e agrupar é
  // melhor que ciclar cor (duas séries com a mesma cor é pior que erro).
  const total = new Map<string, number>();
  for (const r of cal) {
    const k = rotulo(r.origem_mes);
    total.set(k, (total.get(k) ?? 0) + Number(r.a_receber || 0));
  }
  const top = Array.from(total.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  const agrupadas = Array.from(total.keys()).filter((k) => !top.includes(k));

  const buckets = new Map<string, Record<string, unknown> & { ord: number }>();
  for (const r of cal) {
    const chave = r.esta_vencido ? "__venc" : (r.vence_em ?? "__sem");
    const ord = r.esta_vencido ? 0 : Number((r.vence_em ?? "9999-12").slice(0, 7).replace("-", ""));
    const linha = buckets.get(chave) ?? { x: r.esta_vencido ? "Vencido" : rotulo(r.vence_em), ord };
    const col = top.includes(rotulo(r.origem_mes)) ? rotulo(r.origem_mes) : "Outros";
    linha[col] = (Number(linha[col]) || 0) + Number(r.a_receber || 0);
    buckets.set(chave, linha);
  }

  return {
    rows: Array.from(buckets.values()).sort((a, b) => a.ord - b.ord),
    origens: [...top, ...(agrupadas.length ? ["Outros"] : [])],
    agrupadas: agrupadas.length,
  };
}
