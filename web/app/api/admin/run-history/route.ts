// Histórico de execuções dos master_*.yml dos últimos N dias.
// Retorna 1 row por execução com: workflow, evento, status, conclusão, hora BRT,
// duração em segundos, e o slot esperado mais próximo (7/10/13/16/19 BRT pra
// daily; dom 7 BRT pra semanal). Útil pra responder "rodou no slot X?".
import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";
import { ghFetch, WORKFLOWS } from "@/lib/github-admin";

export const runtime = "nodejs";

const REPO = "benny459/omie-supabase-sync";

type RunApi = {
  id: number;
  name: string;
  display_title: string;
  status: string;
  conclusion: string | null;
  run_number: number;
  event: string;
  created_at: string;   // UTC
  updated_at: string;   // UTC
  html_url: string;
  path: string;
};

const DAILY_SLOTS_BRT = [7, 10, 13, 16, 19];

function nearestDailySlot(brtHour: number, brtMinute: number): { slot: number; deltaMin: number } | null {
  // Encontra o slot diário mais próximo (em minutos)
  let best: { slot: number; deltaMin: number } | null = null;
  for (const s of DAILY_SLOTS_BRT) {
    const delta = Math.abs((brtHour - s) * 60 + brtMinute);
    if (!best || delta < best.deltaMin) best = { slot: s, deltaMin: delta };
  }
  return best;
}

export async function GET(req: Request) {
  const { error: guardErr } = await requireAdmin();
  if (guardErr) return guardErr;

  const url = new URL(req.url);
  const days = Math.min(7, Math.max(1, Number(url.searchParams.get("days") ?? "2")));

  const allowed = new Set(WORKFLOWS.map((w) => w.file));
  const sinceMs = Date.now() - days * 86_400_000;

  // Pega 100 runs mais recentes do repo
  const data = await ghFetch<{ workflow_runs: RunApi[] }>(
    `/repos/${REPO}/actions/runs?per_page=100`,
  );

  type Out = {
    workflow: string;
    file: string;
    kind: "diaria" | "semanal" | "?";
    event: string;
    status: string;
    conclusion: string | null;
    started_utc: string;
    started_brt: string;
    finished_brt: string;
    duracao_seg: number;
    slot_brt: string;
    delta_min: number;  // distância do slot esperado mais próximo
    html_url: string;
  };

  const out: Out[] = [];
  for (const r of (data.workflow_runs ?? [])) {
    const file = r.path.replace(".github/workflows/", "");
    if (!allowed.has(file)) continue;
    const startedMs = new Date(r.created_at).getTime();
    if (startedMs < sinceMs) continue;

    const finishedMs = new Date(r.updated_at).getTime();
    const dur = Math.max(0, Math.round((finishedMs - startedMs) / 1000));

    const brt = new Date(startedMs - 3 * 3_600_000);  // UTC-3
    const brtHour = brt.getUTCHours();
    const brtMin = brt.getUTCMinutes();
    const isWeekly = file.includes("semanal");
    const kind = isWeekly ? "semanal" : file.includes("diaria") ? "diaria" : "?";

    let slot_brt = "—";
    let delta_min = -1;
    if (!isWeekly) {
      const ns = nearestDailySlot(brtHour, brtMin);
      if (ns) { slot_brt = `${String(ns.slot).padStart(2, "0")}:00 BRT`; delta_min = ns.deltaMin; }
    } else {
      // semanal: fixed 07:00 BRT, dom (isodow=7)
      slot_brt = "07:00 BRT (dom)";
      delta_min = Math.abs((brtHour - 7) * 60 + brtMin);
    }

    out.push({
      workflow: r.name,
      file,
      kind,
      event: r.event,
      status: r.status,
      conclusion: r.conclusion,
      started_utc: r.created_at,
      started_brt: brt.toISOString().replace("T", " ").slice(0, 19) + " BRT",
      finished_brt: new Date(finishedMs - 3 * 3_600_000).toISOString().replace("T", " ").slice(0, 19) + " BRT",
      duracao_seg: dur,
      slot_brt,
      delta_min,
      html_url: r.html_url,
    });
  }

  // Ordena por started desc
  out.sort((a, b) => b.started_utc.localeCompare(a.started_utc));

  // Agrupa por dia BRT
  const byDay: Record<string, Out[]> = {};
  for (const o of out) {
    const day = o.started_brt.slice(0, 10);
    (byDay[day] ??= []).push(o);
  }

  return NextResponse.json({
    days,
    total: out.length,
    by_day: byDay,
    raw: out,
  });
}
