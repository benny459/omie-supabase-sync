// POST /api/sync-now — dispara em paralelo os masters diários orders + sales.
// Uso emergencial: user precisa dos dados AGORA, não pode esperar próximo cron.
// Cada master roda em ~5-8min. Feedback: "Rodando em background".

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const GH_REPO = "benny459/omie-supabase-sync";
const WORKFLOWS = [
  "master_orders_diaria.yml",
  "master_sales_diaria.yml",
] as const;

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { empresas?: string } = {};
  try { body = await req.json(); } catch { /* body opcional */ }
  const empresas = String(body.empresas ?? "SF,CD,WW").trim() || "SF,CD,WW";

  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN não configurado" }, { status: 500 });

  const results = await Promise.all(WORKFLOWS.map(async (wf) => {
    const r = await fetch(
      `https://api.github.com/repos/${GH_REPO}/actions/workflows/${wf}/dispatches`,
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
    return { workflow: wf, ok: r.ok, status: r.status, error: r.ok ? undefined : await r.text().catch(() => "") };
  }));

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    return NextResponse.json(
      { error: `Falha ${failed.map((f) => `${f.workflow}(${f.status})`).join(", ")}` },
      { status: 500 },
    );
  }

  console.log(`[sync-now] user=${user.email} workflows=${WORKFLOWS.join(",")}`);

  return NextResponse.json({
    ok: true,
    workflows: WORKFLOWS,
    message: `Sync master disparado — ~5-8 min pra completar. Recarrega o painel depois.`,
  });
}
