// POST   /api/renegociacao   { cods: number[], motivo?: string }
// DELETE /api/renegociacao   { cods: number[] }
//
// Marca / desmarca títulos como "em renegociação": saem da curva de caixa porque
// a data deles não é confiável — são pagamentos a repactuar com o fornecedor, ou
// a cancelar.
//
// NÃO altera o Omie e NÃO apaga nada. É marcação do painel: o título continua na
// mesa de reagendamento, some do gráfico, e o valor fora do fluxo é declarado na
// tela. Tirar dinheiro da projeção deixa a curva mais bonita — se isso não fica
// visível, vira autoengano.
//
// Aceita LOTE porque a operação é de lote por natureza: renegociar com um
// fornecedor costuma envolver todos os títulos dele de uma vez.

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
  // Mesmo gate do reagendamento: tirar título da projeção é ato financeiro.
  if (!canViewArea(perms, "financeiro")) {
    return { erro: NextResponse.json({ error: "Sem acesso" }, { status: 403 }) };
  }
  return { email: user.email ?? "?" };
}

/** Lista de códigos válida, ou null. Rejeita em vez de ignorar item inválido:
 *  num lote de renegociação, marcar menos do que se pediu passa despercebido. */
function lerCods(body: unknown): number[] | null {
  const brutos = (body as { cods?: unknown })?.cods;
  if (!Array.isArray(brutos) || brutos.length === 0) return null;
  const cods = brutos.map(Number);
  if (cods.some((n) => !Number.isSafeInteger(n) || n <= 0)) return null;
  return Array.from(new Set(cods));
}

export async function POST(req: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const cods = lerCods(body);
  if (!cods) return NextResponse.json({ error: "cods deve ser uma lista de inteiros positivos" }, { status: 400 });

  const motivo = (body as { motivo?: unknown }).motivo
    ? String((body as { motivo: unknown }).motivo).slice(0, 400)
    : null;

  const { error } = await admin()
    .from("titulo_renegociacao")
    .upsert(
      cods.map((cod) => ({
        cod_titulo: cod, motivo, criado_por: auth.email, criado_em: new Date().toISOString(),
      })),
      { onConflict: "cod_titulo" },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, marcados: cods.length });
}

export async function DELETE(req: Request) {
  const auth = await autorizar();
  if (auth.erro) return auth.erro;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const cods = lerCods(body);
  if (!cods) return NextResponse.json({ error: "cods deve ser uma lista de inteiros positivos" }, { status: 400 });

  const { error } = await admin().from("titulo_renegociacao").delete().in("cod_titulo", cods);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, removidos: cods.length });
}
