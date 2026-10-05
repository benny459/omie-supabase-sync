// GET /api/menu/rh — as telas do RH que a pessoa abre, para a barra (05/10/26).
// Antes o layout perguntava ao portal no render, com 2,5 s de limite: com o
// portal "frio" a resposta passava disso e o RH sumia da barra (e cada página
// esperava). Agora a barra pede depois de montar, sem segurar a página.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { telasRhDoPortal } from "@/lib/rh-menu";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ telas: [] }, { status: 401 });
  const { data: { session } } = await supa.auth.getSession();
  const telas = await telasRhDoPortal(user.id, session?.access_token);
  return NextResponse.json({ telas }, { headers: { "Cache-Control": "private, no-store" } });
}
