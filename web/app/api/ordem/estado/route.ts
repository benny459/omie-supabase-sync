// GET /api/ordem/estado — leve, para a barra do topo: a Central aparece para esta pessoa?
// Em que módulos (os que ela já vê hoje E que o admin ligou; o admin vê todos em pré-visualização)?
// Sino e diálogo ligados? Sem contagens de módulos sem acesso.
import { NextResponse } from "next/server";
import { lerConfig, quemOrdem } from "@/lib/ordem/servidor";
import { modulosVisiveis, moduloLigado } from "@/lib/ordem/acesso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const q = await quemOrdem();
  if (q instanceof NextResponse) return NextResponse.json({ central: false, modulos: [] });
  const cfg = await lerConfig();
  const central = q.admin || cfg.ativo;
  const modulos = central ? modulosVisiveis(q, cfg).filter((m) => moduloLigado(q, cfg, m).ligado) : [];
  return NextResponse.json({
    central, modulos, admin: q.admin,
    sino: cfg.ativo && cfg.sino, dialogo: cfg.ativo && cfg.dialogo_entrada,
  }, { headers: { "Cache-Control": "no-store" } });
}
