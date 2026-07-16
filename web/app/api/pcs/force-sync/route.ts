// POST /api/pcs/force-sync — dispara GH Actions workflow_dispatch pra
// refetchar PCs específicos via ConsultarPedCompra. Batch: aceita 1..N
// pc_numeros. Usado no /standby pra atualizar PCs antigos que o sync
// incremental não pega.
//
// Body: { pc_numeros: string[]; empresas?: string }
// Returns: { ok: true, run_url?: string } ou { error: string }

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const GH_REPO = "benny459/omie-supabase-sync";
const WORKFLOW = "sync_specific_pcs.yml";

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { pc_numeros?: string[]; empresas?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const pcNumeros = Array.isArray(body.pc_numeros)
    ? body.pc_numeros.map((n) => String(n).trim()).filter(Boolean)
    : [];
  if (pcNumeros.length === 0) {
    return NextResponse.json({ error: "pc_numeros vazio" }, { status: 400 });
  }
  if (pcNumeros.length > 500) {
    return NextResponse.json({ error: "Máximo 500 PCs por batch" }, { status: 400 });
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
        inputs: {
          pc_numeros: pcNumeros.join(","),
          empresas,
        },
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

  // Log audit
  console.log(`[force-sync] user=${user.email} batch=${pcNumeros.length} pcs=${pcNumeros.slice(0, 5).join(",")}${pcNumeros.length > 5 ? "..." : ""}`);

  return NextResponse.json({
    ok: true,
    count: pcNumeros.length,
    run_url: `https://github.com/${GH_REPO}/actions/workflows/${WORKFLOW}`,
    message: `Dispatched — refetch de ${pcNumeros.length} PC(s). Rodando em ~30s no GitHub Actions.`,
  });
}
