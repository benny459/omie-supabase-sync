// GET /api/bi/margem-venda?from=&to=&cat=Avulsos&base=emissao|faturamento&tipo=&faixa=
//
// Monitor de margem por venda: cada NF confrontada com o custo de compra ligado
// àquele PV/OS pela cadeia de aprovação.
//
// Faixas: Negativa · Muito baixa (0-15%) · Baixa (15-25%) · Média (25-35%) ·
// Alta (>35%).
//
// A REGRA DE NEGÓCIO QUE COMANDA O ALARME: em avulsos, só se aprova compra do
// que é MIX ou MERCANTIL. Serviço puro não gera pedido de compra, então não ter
// custo nele é o esperado — e vira a faixa neutra "Serviço (não gera compra)".
//
// Sem essa distinção o monitor mentia: das 78 avulsas de 2026, 57 apareciam como
// "sem custo", mas 42 eram Serviço, comportamento normal. O alarme real são as
// 14 Mix + 1 sem tipo, que somam R$ 47.843 e deveriam ter compra.
//
// `base` escolhe o eixo do tempo: emissão do PV/OS (o ciclo comercial) ou
// faturamento da NF. São perguntas diferentes — "o que vendi" e "o que faturei".

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";
import { rpcPaginado } from "@/lib/supabase-paginado";

export const runtime = "nodejs";
export const maxDuration = 60;

type Linha = {
  faixa: string; faixa_ord: number; tipo_omie: string;
  receita: number; custo_compra: number | null;
  margem: number | null; margem_pct: number | null;
  tem_custo: boolean; exige_custo: boolean;
};

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to   = url.searchParams.get("to");
  const catRaw = (url.searchParams.get("cat") ?? "Avulsos").trim();
  const cat = catRaw ? catRaw.split(",").map((s) => s.trim()).filter(Boolean) : null;
  // Whitelist: o valor vai direto pro CASE do SQL.
  const base = url.searchParams.get("base") === "emissao" ? "emissao" : "faturamento";

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  const { data, error } = await rpcPaginado(adm, "monitor_margem_venda", {
    p_from: from, p_to: to, p_cat_venda: cat, p_empresas: null,
    p_base_data: base, p_limit: 5000,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const linhas = (data ?? []) as Linha[];
  const num = (v: unknown) => Number(v) || 0;
  const resumo = (f: string) => {
    const g = linhas.filter((l) => l.faixa === f);
    return {
      faixa: f,
      vendas: g.length,
      receita: g.reduce((s, l) => s + num(l.receita), 0),
      custo: g.reduce((s, l) => s + num(l.custo_compra), 0),
      margem: g.reduce((s, l) => s + num(l.margem), 0),
    };
  };

  const comCusto = linhas.filter((l) => l.tem_custo);

  // Só entra na conta de margem quem PODE ter custo. Serviço puro dilui o
  // indicador com vendas que nunca teriam compra.
  const exigentes = linhas.filter((l) => l.exige_custo);
  const faltando = exigentes.filter((l) => !l.tem_custo);

  return NextResponse.json({
    base,
    total: {
      vendas: linhas.length,
      receita: linhas.reduce((s, l) => s + num(l.receita), 0),
      // A margem média só considera quem TEM custo medido — incluir os sem custo
      // como 100% inflaria o indicador exatamente onde falta informação.
      receita_medida: comCusto.reduce((s, l) => s + num(l.receita), 0),
      custo_medido: comCusto.reduce((s, l) => s + num(l.custo_compra), 0),
      margem_medida: comCusto.reduce((s, l) => s + num(l.margem), 0),
      cobertura_pct: linhas.length ? (comCusto.length / linhas.length) * 100 : 0,
    },
    // O que o alarme aponta: venda que DEVERIA ter custo e não tem.
    falta_custo: {
      vendas: faltando.length,
      receita: faltando.reduce((s, l) => s + num(l.receita), 0),
      de: exigentes.length,
    },
    // Ordem = gravidade. A tela desenha os chips nesta sequência.
    faixas: ["Negativa", "Sem custo — deveria ter", "Muito baixa", "Baixa", "Média",
             "Alta", "Serviço (não gera compra)", "Sem receita"]
      .map(resumo).filter((f) => f.vendas > 0),
    tipos: Array.from(new Set(linhas.map((l) => l.tipo_omie))).sort(),
    linhas,
  });
}
