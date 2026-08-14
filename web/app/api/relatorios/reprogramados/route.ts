// GET /api/relatorios/reprogramados?cods=1,2,3
//
// Títulos cuja previsão foi reprogramada no painel, com o antes e o depois.
//
// A tela e o relatório leem a MESMA função (bi.titulos_reprogramados), então o
// PDF, o Excel e o que está na tela não podem divergir. Foi divergência entre
// duas fontes que produziu quase todos os defeitos que consertamos neste
// projeto.
//
// `cods` recorta pela seleção da tela. Sem ele, vêm todos os reprogramados —
// e "todos" ignora o teto de linhas do desenho, porque o relatório existe
// justamente pra cobrir o que não caberia na tela.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";
import { rpcPaginado } from "@/lib/supabase-paginado";

export const runtime = "nodejs";
export const maxDuration = 60;

export type LinhaReprog = {
  cod_titulo: number; empresa: string; natureza: "R" | "P"; tipo: string;
  contraparte: string; categoria: string; num_titulo: string; documento: string;
  vencimento: string | null; previsao_original: string | null; previsao_nova: string;
  dias_movidos: number | null; valor: number;
  esta_vencido: boolean; dias_atraso: number | null;
  enviado_omie: boolean; reprogramado_em: string | null; observacao: string | null;
};

/** Lista de códigos da query string. Ignora o que não for inteiro em vez de
 *  falhar: um código quebrado não deve derrubar o relatório inteiro. */
export function parseCods(raw: string | null): number[] | null {
  if (!raw) return null;
  const cods = raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  return cods.length ? cods : null;
}

export async function carregar(cods: number[] | null) {
  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );
  return rpcPaginado(adm, "titulos_reprogramados", { p_cods: cods });
}

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }

  const cods = parseCods(new URL(req.url).searchParams.get("cods"));
  const { data, error } = await carregar(cods);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const linhas = (data ?? []) as LinhaReprog[];
  const num = (v: unknown) => Number(v) || 0;
  const soma = (n: "R" | "P") =>
    linhas.filter((l) => l.natureza === n).reduce((a, l) => a + num(l.valor), 0);

  return NextResponse.json({
    total: {
      titulos: linhas.length,
      entradas: soma("R"),
      saidas: soma("P"),
      enviados_omie: linhas.filter((l) => l.enviado_omie).length,
      // Média dos dias movidos: mede se o reagendamento é ajuste fino ou
      // empurrão longo. Só sobre quem tem os dois lados da data.
      dias_medio: (() => {
        const d = linhas.map((l) => l.dias_movidos).filter((x): x is number => x != null);
        return d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
      })(),
    },
    linhas,
  });
}
