#!/usr/bin/env python3
"""
Lê platform.workflow_schedule no Supabase e decide quais workflows disparar
agora considerando hora atual em BRT (America/Sao_Paulo).

Usage: scheduler_decide.py [--dry-run]

Env vars:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  GH_REPO              (ex: benny459/omie-supabase-sync)
  GITHUB_TOKEN         (com escopo workflow:write)

Saída: imprime decisões. Se --dry-run, não dispara nada (só loga).
"""
import os
import sys
import json
import datetime as dt
from urllib.request import Request, urlopen
from urllib.error import HTTPError

DRY = "--dry-run" in sys.argv

# ─── Config ─────────────────────────────────────────────────────────────
SUP_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUP_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
GH_REPO = os.environ.get("GH_REPO", "benny459/omie-supabase-sync")
GH_TOKEN = os.environ.get("GITHUB_TOKEN", "")

# ─── Helpers ────────────────────────────────────────────────────────────
def now_brt() -> dt.datetime:
    """Converte UTC -> BRT (UTC-3, sem DST desde 2019)."""
    return dt.datetime.utcnow() - dt.timedelta(hours=3)

def supa_get(path: str) -> list:
    req = Request(
        f"{SUP_URL}/rest/v1/{path}",
        headers={"apikey": SUP_KEY, "Authorization": f"Bearer {SUP_KEY}",
                 "Accept-Profile": "platform"},
    )
    with urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def supa_patch(path: str, payload: dict) -> None:
    body = json.dumps(payload).encode()
    req = Request(
        f"{SUP_URL}/rest/v1/{path}",
        method="PATCH",
        data=body,
        headers={"apikey": SUP_KEY, "Authorization": f"Bearer {SUP_KEY}",
                 "Content-Profile": "platform", "Content-Type": "application/json",
                 "Prefer": "return=minimal"},
    )
    urlopen(req, timeout=10).read()

def gh_dispatch(workflow_file: str, ref: str = "main") -> None:
    if DRY:
        print(f"   DRY-RUN: would dispatch {workflow_file} @ {ref}")
        return
    body = json.dumps({"ref": ref}).encode()
    url = f"https://api.github.com/repos/{GH_REPO}/actions/workflows/{workflow_file}/dispatches"
    req = Request(url, method="POST", data=body, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {GH_TOKEN}",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
    })
    try:
        urlopen(req, timeout=15).read()
        print(f"   ✓ Dispatched {workflow_file}")
    except HTTPError as e:
        print(f"   ✗ ERROR {workflow_file}: HTTP {e.code} {e.read()[:200]}")

# ─── Lógica ─────────────────────────────────────────────────────────────
def should_fire_daily(s: dict, now: dt.datetime) -> bool:
    if not s.get("enabled"): return False
    if (now.isoweekday()) not in (s.get("days_of_week") or []): return False
    h = now.hour
    ws, we, iv = s.get("window_start_hour"), s.get("window_end_hour"), s.get("interval_hours")
    if ws is None or we is None or iv is None: return False
    if h < ws or h > we: return False
    if (h - ws) % iv != 0: return False
    # Minute window: só dispara nos primeiros 15 min da hora-alvo
    if now.minute >= 15: return False
    return True

def should_fire_weekly(s: dict, now: dt.datetime) -> bool:
    if not s.get("enabled"): return False
    if (now.isoweekday()) not in (s.get("days_of_week") or []): return False
    fh, fm = s.get("fixed_hour"), s.get("fixed_minute")
    if fh is None or fm is None: return False
    if now.hour != fh: return False
    if abs(now.minute - fm) > 7: return False
    return True

def already_fired_recently(s: dict, now: dt.datetime, kind: str) -> bool:
    """Evita disparar 2x na mesma janela (controller roda */15)."""
    last = s.get("last_fired_at")
    if not last: return False
    last_dt = dt.datetime.fromisoformat(last.replace("Z", "+00:00")).replace(tzinfo=None) - dt.timedelta(hours=3)
    threshold_min = 30 if kind == "daily" else 30
    return (now - last_dt).total_seconds() < threshold_min * 60

def log_decision(now_brt_dt: dt.datetime, kind: str, decision: str, targets: list, reason: str = ""):
    """Insere uma linha em platform.scheduler_log com a decisão tomada nesta execução."""
    payload = {
        "brt_label": now_brt_dt.strftime("%Y-%m-%d %H:%M BRT"),
        "kind": kind,
        "decision": decision,
        "targets": targets or [],
        "dry_run": DRY,
        "reason": reason or None,
    }
    body = json.dumps(payload).encode()
    req = Request(
        f"{SUP_URL}/rest/v1/scheduler_log",
        method="POST",
        data=body,
        headers={"apikey": SUP_KEY, "Authorization": f"Bearer {SUP_KEY}",
                 "Content-Profile": "platform", "Content-Type": "application/json",
                 "Prefer": "return=minimal"},
    )
    try: urlopen(req, timeout=8).read()
    except Exception as e: print(f"   ⚠ falha ao logar decisão: {e}")

# ─── Main ───────────────────────────────────────────────────────────────
def main():
    now = now_brt()
    print(f"=== scheduler_decide @ {now.isoformat()} BRT ({'DRY-RUN' if DRY else 'LIVE'}) ===")

    schedules = supa_get("workflow_schedule?select=*")
    by_kind = {s["kind"]: s for s in schedules}

    fired = []
    for kind, sch in by_kind.items():
        if not sch.get("enabled"):
            print(f"  [{kind}] disabled — skip")
            log_decision(now, kind, "skip_disabled", [])
            continue
        check = should_fire_daily if kind == "daily" else should_fire_weekly
        if not check(sch, now):
            print(f"  [{kind}] not in window — skip")
            log_decision(now, kind, "skip_window", [], reason=f"now={now.strftime('%H:%M')} weekday={now.isoweekday()}")
            continue
        if already_fired_recently(sch, now, kind):
            print(f"  [{kind}] já disparou recentemente — skip (last_fired_at={sch.get('last_fired_at')})")
            log_decision(now, kind, "skip_recent", [], reason=f"last_fired_at={sch.get('last_fired_at')}")
            continue
        targets = sch.get("targets") or []
        suffix = "diaria" if kind == "daily" else "semanal"
        print(f"  [{kind}] FIRE — targets: {targets}")
        for t in targets:
            gh_dispatch(f"master_{t}_{suffix}.yml")
        log_decision(now, kind, "fired", targets)
        fired.append(kind)

    # Atualiza last_fired_at (mesmo em dry-run? não — só real)
    if not DRY and fired:
        ts = dt.datetime.utcnow().isoformat() + "Z"
        for k in fired:
            supa_patch(f"workflow_schedule?kind=eq.{k}", {"last_fired_at": ts})
            print(f"  [{k}] last_fired_at = {ts}")

    print(f"=== done. fired: {fired} ===")

if __name__ == "__main__":
    main()
