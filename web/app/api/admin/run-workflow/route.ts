// API: dispara um workflow do GitHub Actions via workflow_dispatch.
// Body: { tool: 'sales'|'orders'|'finance', kind: 'diaria'|'semanal' }
// Só admin.
import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";

export const runtime = "nodejs";

const REPO_OWNER = "benny459";
const REPO_NAME  = "omie-supabase-sync";
const REF        = "main";

const VALID_TOOLS = new Set(["sales", "orders", "finance"]);
const VALID_KINDS = new Set(["diaria", "semanal"]);

export async function POST(req: Request) {
  const { error: g } = await requireAdmin();
  if (g) return g;

  let body: { tool: string; kind: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!VALID_TOOLS.has(body.tool)) return NextResponse.json({ error: "tool inválido" }, { status: 400 });
  if (!VALID_KINDS.has(body.kind)) return NextResponse.json({ error: "kind inválido" }, { status: 400 });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN ausente" }, { status: 500 });

  const workflow = `master_${body.tool}_${body.kind}.yml`;
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${workflow}/dispatches`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: REF }),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return NextResponse.json({ error: `GitHub API ${r.status}: ${text.slice(0, 300)}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true, workflow, ref: REF });
}
