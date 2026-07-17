// PV/OS "Aguardando Liberação" — cliente pediu a venda mas ainda não enviou
// pedido de compra formal. Estado transitório que bloqueia faturamento e
// vira alarme dedicado. Só quem tem can_release_pv=true (ou is_admin) pode
// mutar — RLS na tabela platform.pv_liberacao_status enforce isso.
//
// GET  → { map: { [pv_os_label]: true } } — todos ativos
// POST { pv_os_label, empresa, aguardando } → upsert / toggle

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supa
    .schema("platform" as never)
    .from("pv_liberacao_status")
    .select("pv_os_label")
    .eq("aguardando_liberacao", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const map: Record<string, true> = {};
  for (const r of (data ?? []) as Array<{ pv_os_label: string }>) map[r.pv_os_label] = true;
  return NextResponse.json({ map });
}

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { pv_os_label?: string; empresa?: string; aguardando?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }

  const pv = String(body.pv_os_label ?? "").trim();
  const empresa = String(body.empresa ?? "").trim();
  const aguardando = !!body.aguardando;
  if (!pv || !empresa) return NextResponse.json({ error: "pv_os_label e empresa obrigatórios" }, { status: 400 });

  const email = user.email ?? null;
  const now = new Date().toISOString();

  // Upsert: se aguardando=true, cria/atualiza pra ativo. Se false, mantém a
  // linha mas seta aguardando_liberacao=false + audit fields de desmarcação.
  // Manter histórico ajuda a debugar quem marcou/desmarcou.
  const payload = aguardando
    ? { pv_os_label: pv, empresa, aguardando_liberacao: true, marcado_por: email, marcado_em: now,
        desmarcado_por: null, desmarcado_em: null }
    : { pv_os_label: pv, empresa, aguardando_liberacao: false,
        desmarcado_por: email, desmarcado_em: now };

  const { error } = await supa
    .schema("platform" as never)
    .from("pv_liberacao_status")
    .upsert(payload, { onConflict: "pv_os_label" });

  if (error) {
    // RLS bloqueou = user sem can_release_pv nem is_admin. Fica explícito na resposta.
    const msg = error.code === "42501" || /policy/i.test(error.message)
      ? "Sem permissão pra marcar Aguardando Liberação"
      : error.message;
    return NextResponse.json({ error: msg }, { status: 403 });
  }
  return NextResponse.json({ ok: true, pv_os_label: pv, aguardando });
}
