// POST /api/pvs/force-sync — mesma lógica do PC force-sync mas pra PVs.
// Dispatches workflow_dispatch em sync_specific_pvs.yml que roda o script
// Python com PV_NUMEROS_ESPECIFICOS.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const GH_REPO = "benny459/omie-supabase-sync";
const WORKFLOW = "sync_specific_pvs.yml";

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { pv_numeros?: string[]; empresas?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const pvNumeros = Array.isArray(body.pv_numeros)
    ? body.pv_numeros.map((n) => String(n).trim()).filter(Boolean)
    : [];
  if (pvNumeros.length === 0) {
    return NextResponse.json({ error: "pv_numeros vazio" }, { status: 400 });
  }
  if (pvNumeros.length > 500) {
    return NextResponse.json({ error: "Máximo 500 PVs por batch" }, { status: 400 });
  }
  const empresas = String(body.empresas ?? "SF,CD,WW").trim() || "SF,CD,WW";

  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN não configurado" }, { status: 500 });

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { pv_numeros: pvNumeros.join(","), empresas },
      }),
    },
  );

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text().catch(() => "");
    return NextResponse.json(
      { error: `GitHub dispatch ${dispatchRes.status}: ${text.slice(0, 300)}` },
      { status: 500 },
    );
  }

  console.log(`[pvs/force-sync] user=${user.email} batch=${pvNumeros.length}`);

  return NextResponse.json({
    ok: true,
    count: pvNumeros.length,
    run_url: `https://github.com/${GH_REPO}/actions/workflows/${WORKFLOW}`,
    message: `Dispatched — refetch de ${pvNumeros.length} PV(s). Rodando em ~30s no GitHub Actions.`,
  });
}
