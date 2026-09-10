// GET /api/cesar/conversas            → lista as conversas do usuário
// GET /api/cesar/conversas?id=<uuid>  → as mensagens de uma delas
// DELETE /api/cesar/conversas?id=<uuid>
//
// Tudo pelo cliente do USUÁRIO, não pelo service_role: a RLS de
// public.cesar_conversa é quem garante que ninguém lê a conversa do outro. Usar
// service_role aqui exigiria repetir esse filtro à mão em cada consulta, e é
// exatamente esse tipo de checagem duplicada que um dia sai de sincronia.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supa = await supaServer("public");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    const { data, error } = await supa
      .from("cesar_mensagem")
      .select("papel, conteudo, passos, criada_em")
      .eq("conversa_id", id)
      .order("id", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ mensagens: data ?? [] });
  }

  // Teto de 60: a lista é para reencontrar algo recente, não para arquivo
  // morto. Passando disso, buscar por texto seria a ferramenta certa — e aí
  // seria outro recurso, não uma lista maior.
  const { data, error } = await supa
    .from("cesar_conversa")
    .select("id, titulo, origem, criada_em, atualizada_em")
    .order("atualizada_em", { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversas: data ?? [] });
}

export async function DELETE(req: Request) {
  const supa = await supaServer("public");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "sem id" }, { status: 400 });

  // As mensagens caem junto por ON DELETE CASCADE.
  const { error } = await supa.from("cesar_conversa").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
