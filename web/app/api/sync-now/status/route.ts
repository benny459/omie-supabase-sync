// GET /api/sync-now/status — polling do último run do sync_quick.yml.
// Retorna { status: "queued" | "in_progress" | "completed", conclusion?, url? }.
// Consumido pelo SyncNowButton pra fechar a barra em 100% ao terminar.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 15;

const GH_REPO = "benny459/omie-supabase-sync";
const WORKFLOW = "sync_quick.yml";

export async function GET() {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN não configurado" }, { status: 500 });

  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/${WORKFLOW}/runs?per_page=1`,
    {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      cache: "no-store",
    },
  );
  if (!r.ok) return NextResponse.json({ error: `GH ${r.status}` }, { status: 500 });
  const j = await r.json();
  const run = j.workflow_runs?.[0];
  if (!run) return NextResponse.json({ status: "none" });
  return NextResponse.json({
    status: run.status,      // "queued" | "in_progress" | "completed"
    conclusion: run.conclusion, // null | "success" | "failure" | "cancelled"
    url: run.html_url,
    created_at: run.created_at,
  });
}
