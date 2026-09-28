// POST /api/financeiro/titulos/incluir — cadastra um título no OMIE (write-back)
// e espelha imediatamente em finance.contas_pagar/receber pra aparecer na tela
// sem esperar o próximo ciclo de sync. O Omie continua sendo a fonte da verdade
// enquanto a migração não termina — por isso o insert local só acontece DEPOIS
// do Omie confirmar com codigo_lancamento_omie.
//
// Credenciais por empresa: OMIE_APP_KEY_<SIGLA> / OMIE_APP_SECRET_<SIGLA>.
// Hoje só SF está na Vercel — outras empresas retornam erro explicando isso.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  tipo: "pagar" | "receber";
  empresa: string;
  codigo_cliente_fornecedor: number;
  valor_documento: number;
  data_vencimento: string;      // YYYY-MM-DD
  data_previsao?: string;       // YYYY-MM-DD (default = vencimento)
  codigo_categoria: string;
  id_conta_corrente: number;
  codigo_projeto?: number | null;
  numero_documento?: string | null;
  observacao?: string | null;
};

function brDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export async function POST(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "financeiro")) {
    return NextResponse.json({ error: "Sem acesso à área financeiro" }, { status: 403 });
  }

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const tipo = body.tipo === "receber" ? "receber" : "pagar";
  const empresa = (body.empresa ?? "SF").toUpperCase();
  if (!body.codigo_cliente_fornecedor || !body.valor_documento || !body.data_vencimento ||
      !body.codigo_categoria || !body.id_conta_corrente) {
    return NextResponse.json({ error: "Campos obrigatórios: contraparte, valor, vencimento, categoria e conta corrente" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.data_vencimento)) {
    return NextResponse.json({ error: "data_vencimento deve ser YYYY-MM-DD" }, { status: 400 });
  }

  const appKey = process.env[`OMIE_APP_KEY_${empresa}`];
  const appSecret = process.env[`OMIE_APP_SECRET_${empresa}`];
  if (!appKey || !appSecret) {
    return NextResponse.json({
      error: `Credencial Omie da empresa ${empresa} não configurada na Vercel (OMIE_APP_KEY_${empresa}). Por ora só SF cadastra.`,
    }, { status: 422 });
  }

  const previsaoISO = body.data_previsao && /^\d{4}-\d{2}-\d{2}$/.test(body.data_previsao)
    ? body.data_previsao : body.data_vencimento;
  const integrId = `painel-${Date.now()}`;

  const param: Record<string, unknown> = {
    codigo_lancamento_integracao: integrId,
    codigo_cliente_fornecedor: body.codigo_cliente_fornecedor,
    data_vencimento: brDate(body.data_vencimento),
    valor_documento: body.valor_documento,
    codigo_categoria: body.codigo_categoria,
    data_previsao: brDate(previsaoISO),
    id_conta_corrente: body.id_conta_corrente,
  };
  if (body.codigo_projeto) param.codigo_projeto = body.codigo_projeto;
  if (body.numero_documento) param.numero_documento = body.numero_documento;
  if (body.observacao) param.observacao = body.observacao;

  const endpoint = tipo === "pagar"
    ? "https://app.omie.com.br/api/v1/financas/contapagar/"
    : "https://app.omie.com.br/api/v1/financas/contareceber/";
  const call = tipo === "pagar" ? "IncluirContaPagar" : "IncluirContaReceber";

  let omieResp: Record<string, unknown>;
  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call, app_key: appKey.trim(), app_secret: appSecret.trim(), param: [param] }),
    });
    const text = await r.text();
    try { omieResp = JSON.parse(text); } catch { omieResp = { faultstring: text.slice(0, 300) }; }
    if (!r.ok || omieResp.faultstring) {
      return NextResponse.json({ error: `Omie recusou: ${omieResp.faultstring ?? `HTTP ${r.status}`}` }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: `Falha ao falar com o Omie: ${(e as Error).message}` }, { status: 502 });
  }

  const codigoOmie = Number(omieResp.codigo_lancamento_omie ?? 0);
  if (!codigoOmie) {
    return NextResponse.json({ error: `Omie não devolveu codigo_lancamento_omie (${JSON.stringify(omieResp).slice(0, 200)})` }, { status: 502 });
  }

  // Espelho local imediato — o sync posterior faz upsert por codigo_lancamento_omie
  // e sobrescreve com a versão canônica do Omie.
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );
  const table = tipo === "pagar" ? "contas_pagar" : "contas_receber";
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const status = body.data_vencimento < hoje ? "ATRASADO" : body.data_vencimento === hoje ? "VENCE HOJE" : "A VENCER";
  const mirror: Record<string, unknown> = {
    empresa,
    codigo_lancamento_omie: codigoOmie,
    codigo_lancamento_integracao: integrId,
    codigo_cliente_fornecedor: body.codigo_cliente_fornecedor,
    data_vencimento: brDate(body.data_vencimento),
    data_previsao: brDate(previsaoISO),
    valor_documento: body.valor_documento,
    codigo_categoria: body.codigo_categoria,
    id_conta_corrente: body.id_conta_corrente,
    codigo_projeto: body.codigo_projeto ?? null,
    numero_documento: body.numero_documento ?? null,
    observacao: body.observacao ?? null,
    status_titulo: status,
    synced_at: new Date().toISOString(),
  };
  const { error: upErr } = await admin.from(table)
    .upsert(mirror, { onConflict: "empresa,codigo_lancamento_omie" });
  // Se o espelho falhar o título JÁ existe no Omie — informa mas não trata como erro fatal.
  return NextResponse.json({
    ok: true,
    codigo_lancamento_omie: codigoOmie,
    espelho_local: upErr ? `falhou (${upErr.message}) — aparece no próximo sync` : "ok",
  });
}
