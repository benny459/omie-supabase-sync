// POST   /api/previsao   { cod_titulo, dt_previsao_nova: "YYYY-MM-DD", observacao? }
// DELETE /api/previsao?cod_titulo=123
//
// Grava (ou remove) a previsão local de um título em finance.previsao_override.
// Portado de waterworks-bi, com duas coisas que lá não existiam porque o app era
// de usuário único: gate de permissão e registro de QUEM alterou.
//
// Gravar aqui NÃO mexe no Omie. O envio é um segundo passo explícito, em
// /api/previsao/sync-omie — separação de propósito: reagendar na tela para ver
// o efeito no caixa é uma coisa; mandar pro ERP é outra, e só a segunda é
// irreversível pela tela.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );

async function autorizar() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const perms = await loadPerms();
  // Reagendar título é ato financeiro — não basta ver BI.
  if (!canViewArea(perms, "financeiro")) {
    return { erro: NextResponse.json({ error: "Sem acesso a previsão" }, { status: 403 }) };
  }
  return { email: user.email ?? "?" };
}

export async function POST(req: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;

  let body: { cod_titulo?: unknown; dt_previsao_nova?: unknown; observacao?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const cod = Number(body.cod_titulo);
  if (!Number.isSafeInteger(cod) || cod <= 0) {
    return NextResponse.json({ error: "cod_titulo inválido" }, { status: 400 });
  }
  const dt = String(body.dt_previsao_nova ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
    return NextResponse.json({ error: "dt_previsao_nova deve ser YYYY-MM-DD" }, { status: 400 });
  }
  // O formato sozinho não basta: "0002-08-01" passa no regex e é uma data
  // legítima pro Postgres. Foi exatamente o que um <input type="date"> emitiu
  // enquanto o ano era digitado, e o título gravado com ela sumiu de todas as
  // telas — a janela de agendamento filtra por previsão no ano corrente.
  //
  // A validação do formulário já foi corrigida, mas ela é UMA camada. Esta rota
  // aceita qualquer cliente, então a faixa é checada aqui também.
  const hoje = new Date().toISOString().slice(0, 10);
  if (dt < hoje) {
    return NextResponse.json(
      { error: `dt_previsao_nova não pode ser no passado (recebido ${dt})` }, { status: 400 });
  }
  if (dt > "2100-12-31") {
    return NextResponse.json(
      { error: `dt_previsao_nova fora da faixa aceitável (recebido ${dt})` }, { status: 400 });
  }

  // Quem alterou fica na observação: a tabela não tem coluna de autor, e sem
  // isso o reagendamento fica anônimo no histórico.
  const nota = body.observacao ? String(body.observacao).slice(0, 400) : "";
  const obs = `${nota}${nota ? " · " : ""}por ${auth.email}`.slice(0, 500);

  const { error } = await admin()
    .from("previsao_override")
    .upsert(
      { cod_titulo: cod, dt_previsao_nova: dt, observacao: obs, atualizado_em: new Date().toISOString() },
      { onConflict: "cod_titulo" },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;

  const cod = Number(new URL(req.url).searchParams.get("cod_titulo"));
  if (!Number.isSafeInteger(cod) || cod <= 0) {
    return NextResponse.json({ error: "cod_titulo inválido" }, { status: 400 });
  }

  // Remover o override devolve o título à previsão original do Omie. Não desfaz
  // o que já foi ENVIADO pro Omie — para isso, reagende e envie de novo.
  const { error } = await admin().from("previsao_override").delete().eq("cod_titulo", cod);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
