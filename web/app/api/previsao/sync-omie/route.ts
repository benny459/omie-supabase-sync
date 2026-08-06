// POST /api/previsao/sync-omie   { dry_run?: boolean, only?: number[] }
//
// Envia pro Omie as previsões que foram reagendadas aqui. Portado de
// waterworks-bi, onde rodou em produção (23 envios com sucesso em junho/2026).
//
// Esta é a ÚNICA rota do painel que escreve num sistema externo. O que a torna
// segura de operar:
//
//   • dry_run  — percorre tudo e registra no log sem chamar o Omie. É o "Simular"
//                da tela, e existe pra conferir a lista antes de disparar.
//   • only     — restringe a títulos específicos, em vez de "tudo que está
//                pendente". A tela usa isso pro botão de uma linha só e pro lote
//                selecionado.
//   • log      — toda tentativa entra em finance.omie_sync_log, inclusive as que
//                falharam, com a resposta crua do Omie.
//   • carimbo  — omie_sincronizado_em só é gravado quando o Omie CONFIRMA. Se a
//                chamada falhar, a linha continua pendente e a tela mostra isso,
//                em vez de dizer que gravou.
//
// Sequencial de propósito: são dezenas de títulos, não milhares, e disparar em
// paralelo contra o ERP de produção troca um ganho de segundos por risco de
// throttling no meio de um lote — deixando metade aplicada.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";
import { alterarPrevisao } from "@/lib/omie";

export const runtime = "nodejs";
export const maxDuration = 300;

type Pendente = {
  cod_titulo: number;
  natureza: "R" | "P";
  empresa: string;
  dt_previsao_nova: string;
  num_titulo: string | null;
  contraparte: string;
};

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro")) {
    return NextResponse.json({ error: "Sem acesso a previsão" }, { status: 403 });
  }

  let body: { dry_run?: boolean; only?: unknown } = {};
  try {
    body = await req.json();
  } catch { /* sem body é ok */ }

  const dryRun = Boolean(body.dry_run);
  const only = Array.isArray(body.only)
    ? body.only.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0)
    : null;

  const bi = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );
  const fin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );

  const { data: pend, error: errPend } = await bi.rpc("previsoes_pendentes_omie", {
    p_todos: dryRun,          // no dry run mostra também o que já foi sincronizado
    p_only: only && only.length ? only : null,
  });
  if (errPend) return NextResponse.json({ error: errPend.message }, { status: 500 });

  const pendentes = (pend ?? []) as Pendente[];
  const results: Array<{
    cod_titulo: number; natureza: "R" | "P"; contraparte: string;
    dt_previsao_nova: string; status: "success" | "error" | "dry_run"; erro?: string;
  }> = [];

  for (const p of pendentes) {
    const comum = {
      cod_titulo: p.cod_titulo, natureza: p.natureza,
      contraparte: p.contraparte, dt_previsao_nova: p.dt_previsao_nova,
    };

    if (dryRun) {
      await fin.from("omie_sync_log").insert({
        cod_titulo: p.cod_titulo, natureza: p.natureza,
        dt_previsao_enviada: p.dt_previsao_nova, status: "dry_run",
        resposta_omie: `Simulação: alterar para ${p.dt_previsao_nova}`,
      });
      results.push({ ...comum, status: "dry_run" });
      continue;
    }

    const r = await alterarPrevisao(p.natureza, p.cod_titulo, p.dt_previsao_nova, p.empresa);

    await fin.from("omie_sync_log").insert({
      cod_titulo: p.cod_titulo, natureza: p.natureza,
      dt_previsao_enviada: p.dt_previsao_nova,
      status: r.ok ? "success" : "error",
      http_status: r.http_status, resposta_omie: r.body,
      erro: r.ok ? null : (r.error ?? "erro"),
    });

    if (r.ok) {
      // Só aqui. Carimbar antes faria a tela mentir sobre o que o Omie tem.
      await fin.from("previsao_override")
        .update({ omie_sincronizado_em: new Date().toISOString() })
        .eq("cod_titulo", p.cod_titulo);
      results.push({ ...comum, status: "success" });
    } else {
      results.push({ ...comum, status: "error", erro: r.error });
    }
  }

  const conta = (s: string) => results.filter((r) => r.status === s).length;
  return NextResponse.json({
    ok: conta("error") === 0,
    total: results.length,
    sucessos: conta("success"),
    erros: conta("error"),
    dry_runs: conta("dry_run"),
    dry_run: dryRun,
    results,
  });
}
