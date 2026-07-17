// POST /api/sync-now — dispara sync_quick.yml (janela ~últimos 3 dias, ~1-2 min).
// Uso emergencial: user precisa dos dados AGORA, não pode esperar próximo cron.
// Puxa novidades de PVs (incremental via last_dalt), PCs (5 pgs recentes) e
// etapas (dt_fat/num_nfe). OS não tem janela — usar botão inline por bucket.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const GH_REPO = "benny459/omie-supabase-sync";
const WORKFLOW = "sync_quick.yml";

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { empresas?: string } = {};
  try { body = await req.json(); } catch { /* body opcional */ }
  const empresas = String(body.empresas ?? "SF,CD,WW").trim() || "SF,CD,WW";

  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN não configurado" }, { status: 500 });

  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { empresas } }),
    },
  );

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return NextResponse.json(
      { error: `GitHub dispatch ${r.status}: ${text.slice(0, 300)}` },
      { status: 500 },
    );
  }

  console.log(`[sync-now] user=${user.email} workflow=${WORKFLOW}`);

  return NextResponse.json({
    ok: true,
    workflow: WORKFLOW,
    message: `Sync leve disparado — ~1-2 min. Puxa novidades recentes de PVs/PCs/etapas.`,
  });
}
