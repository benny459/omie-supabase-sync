import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";
import {
  WORKFLOWS, getWorkflowFile, extractCrons, scheduleStatus, cronToBRT,
  dispatchWorkflow, updateWorkflowFile, disableScheduleInYaml, enableScheduleInYaml,
  buildCrons, replaceScheduleInYaml, ghFetch, nextRunBRT, type WindowMode,
} from "@/lib/github-admin";

export const runtime = "nodejs";

type RunApiRow = {
  id: number;
  name: string;
  display_title: string;
  status: string;
  conclusion: string | null;
  run_number: number;
  event: string;
  created_at: string;
  updated_at: string;
  html_url: string;
  path: string;
};

// GET /api/admin/sync → lista workflows com schedule atual
// GET /api/admin/sync?view=runs → últimos 25 runs de todos os workflows
export async function GET(req: Request) {
  const { error: guardErr } = await requireAdmin();
  if (guardErr) return guardErr;
  const url = new URL(req.url);
  const view = url.searchParams.get("view");

  try {
    if (view === "runs") {
      // Pega mais que 25 pq vamos filtrar só pelos workflows relevantes
      // (ignora "pages build and deployment", master_scheduler, master_finance_full, etc).
      const data = await ghFetch<{ workflow_runs: RunApiRow[] }>(
        `/repos/benny459/omie-supabase-sync/actions/runs?per_page=100`,
      );
      const allowed = new Set(WORKFLOWS.map((w) => w.file));
      const runs = (data.workflow_runs ?? [])
        .map((r) => ({ ...r, file: r.path.replace(".github/workflows/", "") }))
        .filter((r) => allowed.has(r.file))
        .slice(0, 25)
        .map((r) => ({
          id: r.id,
          workflow_name: r.name,
          title: r.display_title,
          status: r.status,
          conclusion: r.conclusion,
          run_number: r.run_number,
          event: r.event,
          created_at: r.created_at,
          updated_at: r.updated_at,
          html_url: r.html_url,
          file: r.file,
        }));
      return NextResponse.json({ runs });
    }

    const details = await Promise.all(WORKFLOWS.map(async (wf) => {
      const { yaml, sha } = await getWorkflowFile(wf.file);
      const status = scheduleStatus(yaml);
      const crons = extractCrons(yaml);
      const slots = crons.map((c) => ({ cron: c, ...cronToBRT(c) }));
      const nextRun = status === "ativo" ? nextRunBRT(crons) : null;
      return { ...wf, sha, status, slots, nextRun };
    }));
    return NextResponse.json({
      workflows: details,
      actionsUrl: `https://github.com/benny459/omie-supabase-sync/actions`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/admin/sync — ações: "dispatch" | "toggle-schedule"
export async function POST(req: Request) {
  const { error: guardErr } = await requireAdmin();
  if (guardErr) return guardErr;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String((body as Record<string, unknown>).action ?? "");
  const file = String((body as Record<string, unknown>).file ?? "");
  if (!action || !file) {
    return NextResponse.json({ error: "action e file são obrigatórios" }, { status: 400 });
  }
  const wf = WORKFLOWS.find((w) => w.file === file);
  if (!wf) return NextResponse.json({ error: "workflow desconhecido" }, { status: 400 });

  try {
    if (action === "dispatch") {
      await dispatchWorkflow(file);
      return NextResponse.json({ ok: true });
    }
    if (action === "toggle-schedule") {
      const { yaml, sha } = await getWorkflowFile(file);
      const st = scheduleStatus(yaml);
      let nextYaml = yaml;
      let msg = "";
      if (st === "ativo") {
        nextYaml = disableScheduleInYaml(yaml);
        msg = `chore: desativa schedule de ${wf.name} via painel`;
      } else if (st === "desativado") {
        nextYaml = enableScheduleInYaml(yaml);
        msg = `chore: reativa schedule de ${wf.name} via painel`;
      } else {
        return NextResponse.json({ error: "workflow sem bloco de schedule" }, { status: 400 });
      }
      if (nextYaml === yaml) {
        return NextResponse.json({ error: "nada a alterar no YAML" }, { status: 400 });
      }
      await updateWorkflowFile(file, nextYaml, sha, msg);
      return NextResponse.json({ ok: true });
    }
    if (action === "set-schedule") {
      const b = body as Record<string, unknown>;
      const intervalHours = Number(b.intervalHours);
      const windowMode = String(b.windowMode) as WindowMode;
      if (!intervalHours || !windowMode) {
        return NextResponse.json({ error: "intervalHours e windowMode obrigatórios" }, { status: 400 });
      }
      const newCrons = buildCrons(intervalHours, windowMode);
      const { yaml, sha } = await getWorkflowFile(file);
      const nextYaml = replaceScheduleInYaml(yaml, newCrons);
      if (nextYaml === yaml) {
        return NextResponse.json({ error: "YAML não mudou" }, { status: 400 });
      }
      await updateWorkflowFile(
        file, nextYaml, sha,
        `chore: agenda de ${wf.name} → cada ${intervalHours}h (${windowMode}) via painel`,
      );
      const nextRun = nextRunBRT(newCrons);
      return NextResponse.json({ ok: true, crons: newCrons, nextRun });
    }
    return NextResponse.json({ error: "action inválida" }, { status: 400 });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
