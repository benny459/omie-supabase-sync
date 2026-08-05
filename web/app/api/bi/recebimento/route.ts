// GET /api/bi/recebimento?from=&to=&empresas=SF&cat=Projetos&abertos=1
//
// "Faturei X no mês. Quando isso entra?" — porte dos cards 142 (coorte) e 130
// (detalhe por título).
//
// Coorte é mês de FATURAMENTO acompanhado no tempo, não mês de caixa. O
// recebido de julho é o que entrou referente a julho, tenha entrado em julho ou
// em setembro. Misturar os dois é o que faz "recebido no mês" parecer
// contradizer "faturado no mês".

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

// Teto de séries da paleta. Origem acima disso vira "Outros" — a paleta lança
// erro se alguém tentar um 9º slot, e ciclar cor seria pior que agrupar.
const MAX_ORIGENS = 6;

type CalRow = {
  vence_em: string | null;
  esta_vencido: boolean;
  origem_mes: string | null;
  titulos: number;
  a_receber: number;
};

const rotuloMes = (iso: string | null) => {
  if (!iso) return "Sem NF";
  const [a, m] = iso.slice(0, 7).split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(m) - 1]}/${a.slice(2)}`;
};

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso a recebimento" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const soAbertos = url.searchParams.get("abertos") === "1";
  const empRaw = (url.searchParams.get("empresas") ?? "").trim();
  const catRaw = (url.searchParams.get("cat") ?? "").trim();
  const empresas = empRaw ? empRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
  const cat      = catRaw ? catRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const [coorte, calendario, detalhe] = await Promise.all([
    adm.rpc("fat_coorte", { p_from: from, p_to: to, p_empresas: empresas, p_cat_venda: cat }),
    // Sem recorte de período: o que está aberto está aberto, tenha nascido neste
    // mês ou em 2020. Filtrar por data aqui esconderia justo o mais velho.
    adm.rpc("fat_calendario", { p_empresas: empresas, p_cat_venda: cat }),
    adm.rpc("fat_titulo_detalhe", {
      p_from: from, p_to: to, p_empresas: empresas, p_cat_venda: cat,
      p_so_abertos: soAbertos, p_limit: 800,
    }),
  ]);

  for (const [nome, r] of [
    ["fat_coorte", coorte], ["fat_calendario", calendario], ["fat_titulo_detalhe", detalhe],
  ] as const) {
    if (r.error) return NextResponse.json({ error: `${nome}: ${r.error.message}` }, { status: 500 });
  }

  const cal = (calendario.data ?? []) as CalRow[];

  // Pivô do calendário: uma linha por mês de vencimento, uma coluna por origem.
  // "Vencido" vai na frente porque é dinheiro que já deveria ter entrado — a
  // ordem cronológica o esconderia no meio do ano passado.
  const totalPorOrigem = new Map<string, number>();
  for (const r of cal) {
    const k = rotuloMes(r.origem_mes);
    totalPorOrigem.set(k, (totalPorOrigem.get(k) ?? 0) + Number(r.a_receber || 0));
  }
  const origensTop = Array.from(totalPorOrigem.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ORIGENS)
    .map(([k]) => k);
  const agrupadas = Array.from(totalPorOrigem.keys()).filter((k) => !origensTop.includes(k));
  const nomeOrigem = (k: string) => (origensTop.includes(k) ? k : "Outros");

  const buckets = new Map<string, { x: string; ord: number; vencido: boolean } & Record<string, unknown>>();
  for (const r of cal) {
    const chave = r.esta_vencido ? "__vencido" : (r.vence_em ?? "__sem");
    const rotulo = r.esta_vencido ? "Vencido" : rotuloMes(r.vence_em);
    // Vencido antes de tudo; o resto em ordem de data.
    const ord = r.esta_vencido ? 0 : Number((r.vence_em ?? "9999-12").slice(0, 7).replace("-", ""));
    const linha = buckets.get(chave) ?? { x: rotulo, ord, vencido: r.esta_vencido };
    const col = nomeOrigem(rotuloMes(r.origem_mes));
    linha[col] = (Number(linha[col]) || 0) + Number(r.a_receber || 0);
    buckets.set(chave, linha);
  }
  const calendarioRows = Array.from(buckets.values()).sort((a, b) => a.ord - b.ord);
  const origens = [...origensTop, ...(agrupadas.length ? ["Outros"] : [])];

  return NextResponse.json({
    coorte: coorte.data ?? [],
    calendario: calendarioRows,
    origens,
    // Honestidade sobre o agrupamento: a tela diz quantas origens viraram
    // "Outros" em vez de deixar parecer que a lista está completa.
    origens_agrupadas: agrupadas.length,
    detalhe: detalhe.data ?? [],
  });
}
