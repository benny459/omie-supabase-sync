#!/usr/bin/env python3
"""
Bootstrap fresh v0.61 Metabase on Hetzner:
  1. /api/setup with admin user (reusing benny@waterworks.com.br)
  2. Recreate DB connections (Omie, Operações) from secrets/hetzner_v062_databases.json
  3. Save the new session token + DB id remap to secrets/hetzner_v061_state.json for import step

Usage:
    HETZNER_MB_URL=https://metabase.waterworks.com.br \
    HETZNER_ADMIN_EMAIL=benny@waterworks.com.br \
    HETZNER_ADMIN_PASS='...' \
    HETZNER_ADMIN_FIRST=Benny HETZNER_ADMIN_LAST=Alcalay \
    python3 bootstrap_hetzner.py
"""

import json
import os
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
SECRETS = HERE / "secrets"


def http(method, url, token=None, body=None, timeout=60, retries=2):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Metabase-Session"] = token
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body_bytes = r.read()
                if not body_bytes:
                    return {}
                return json.loads(body_bytes.decode())
        except urllib.error.HTTPError as e:
            err_body = e.read().decode(errors="replace") if hasattr(e, "read") else ""
            raise RuntimeError(f"HTTP {e.code} on {method} {url}: {err_body[:500]}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout, OSError) as e:
            last = e
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
    raise last


def main():
    base = os.environ["HETZNER_MB_URL"].rstrip("/")
    email = os.environ["HETZNER_ADMIN_EMAIL"]
    password = os.environ["HETZNER_ADMIN_PASS"]
    first = os.environ.get("HETZNER_ADMIN_FIRST", "Admin")
    last = os.environ.get("HETZNER_ADMIN_LAST", "")

    print(f"target: {base}")
    props = http("GET", f"{base}/api/session/properties")
    tok = props.get("setup-token")
    if not tok:
        print("!! no setup-token → probably already set up. Trying to login.")
        s = http("POST", f"{base}/api/session", body={"username": email, "password": password})
        session = s["id"]
    else:
        print(f"setup-token: {tok[:8]}...")
        setup_body = {
            "token": tok,
            "user": {
                "email": email,
                "password": password,
                "password_confirm": password,
                "first_name": first,
                "last_name": last,
                "site_name": "WaterWorks BI",
            },
            "prefs": {
                "site_name": "WaterWorks BI",
                "site_locale": "pt_BR",
                "allow_tracking": "false",
            },
        }
        r = http("POST", f"{base}/api/setup", body=setup_body)
        session = r["id"] if isinstance(r, dict) and "id" in r else None
        if not session:
            print("!! setup did not return session, trying login")
            s = http("POST", f"{base}/api/session", body={"username": email, "password": password})
            session = s["id"]
    print(f"session: {session[:8]}...")

    # Load hetzner v0.62 DB details (we reuse the credentials that already work)
    src = json.loads((SECRETS / "hetzner_v062_databases.json").read_text())

    # Also load Mac Mini DB details to preserve names + SSL settings that match originals
    mm_src = json.loads((SECRETS / "../../../tmp/mb-migration-2026-07-02/raw/database.json").resolve().read_text()) if False else None

    # Actually just load from /tmp export
    mm_path = Path("/tmp/mb-migration-2026-07-02/raw/database.json")
    mm_dbs_by_name = {}
    if mm_path.exists():
        mm_list = json.loads(mm_path.read_text())
        if isinstance(mm_list, dict) and "data" in mm_list:
            mm_list = mm_list["data"]
        for db in mm_list:
            mm_dbs_by_name[db["name"]] = db

    id_remap = {}  # old_mac_mini_db_id -> new_hetzner_db_id

    for db in src:
        det = db["details"] if isinstance(db["details"], dict) else json.loads(db["details"])
        name = db["name"]
        engine = db["engine"]
        payload = {
            "name": name,
            "engine": engine,
            "details": det,
            "is_full_sync": db.get("is_full_sync", True),
            "is_on_demand": db.get("is_on_demand", False),
        }
        print(f"creating DB '{name}' (engine={engine}, host={det.get('host')})...")
        try:
            r = http("POST", f"{base}/api/database", token=session, body=payload)
            new_id = r["id"]
            print(f"  -> id={new_id}")
        except RuntimeError as e:
            print(f"  !! FAILED: {e}")
            continue

        mm = mm_dbs_by_name.get(name)
        if mm:
            id_remap[mm["id"]] = new_id
            print(f"  remap Mac Mini id {mm['id']} -> Hetzner id {new_id}")

    state = {
        "base_url": base,
        "admin_email": email,
        "session_captured_at": time.time(),
        "db_id_remap": id_remap,
    }
    (SECRETS / "hetzner_v061_state.json").write_text(json.dumps(state, indent=2))
    print(f"saved: secrets/hetzner_v061_state.json (id_remap={id_remap})")


if __name__ == "__main__":
    main()
