// GET /api/rc-projetos/modelo?emp=SF&projeto=<codigo_projeto> → modelo Excel da lista de
// materiais (refeito 08/10/26 — sem PROCV: digita na 1ª coluna e escolhe da lista; ver
// lib/modelo-lista). `projeto` é opcional: traz os grupos do projeto/proposta para o menu
// da coluna Grupo; sem ele, só o cadastro de grupos. Só leitura.
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { montarModeloLista } from "@/lib/modelo-lista";
import { gruposDoModelo, itensDoModelo } from "@/lib/modelo-lista-dados";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const emp = (sp.get("emp") || "SF").toUpperCase().slice(0, 4);
  const projeto = Number(sp.get("projeto")) > 0 ? Number(sp.get("projeto")) : null;
  try {
    const [itens, grupos] = await Promise.all([itensDoModelo(emp), gruposDoModelo(emp, projeto)]);
    const wb = montarModeloLista({ itens, grupos, empresa: emp, projeto: projeto ? `projeto ${projeto}` : null });
    const buf = await wb.xlsx.writeBuffer();
    return new NextResponse(Buffer.from(buf as ArrayBuffer), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="lista-materiais-modelo-${emp}${projeto ? `-${projeto}` : ""}.xlsx"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
