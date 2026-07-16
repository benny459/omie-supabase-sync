#!/usr/bin/env python3
"""
Fix cards whose queries reference invalid field IDs after migration.

Bug: import_to_hetzner.py's remap only handled MBQL v1 shape ['field', <int_id>, <opts>].
     MBQL 2.0 (used by v0.61 card_schema >= 22) uses ['field', <opts_dict>, <int_id>].
     Template-tag dimensions in native queries use MBQL 2.0 form.

Fix: walk each card's dataset_query and remap field ids in BOTH positions.
Then PUT /api/card/{id} on Hetzner to replace the definition.

Usage:
    HETZNER_MB_URL=... HETZNER_SESSION=... MAC_SESSION=... MAC_URL=... python3 fix_broken_cards.py <hetz_id> [hetz_id...]
"""

import copy
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SECRETS = Path(__file__).parent / "secrets"
RAW = Path("/tmp/mb-migration-2026-07-02/raw")


def http(method, url, session, body=None, timeout=60, retries=2):
    headers = {"Content-Type": "application/json", "X-Metabase-Session": session}
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
                return json.loads(b.decode()) if b else {}, None
        except urllib.error.HTTPError as e:
            return None, f"HTTP {e.code}: {e.read().decode(errors='replace')[:400]}"
        except (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout, OSError) as e:
            last = str(e)
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
    return None, last


def remap_in_place(obj, field_map, card_remap):
    """Handles BOTH MBQL v1 ['field', <id>, opts] AND MBQL 2.0 ['field', opts, <id>]."""
    if isinstance(obj, list):
        # MBQL v1: ['field', int, dict|None]
        if len(obj) >= 2 and obj[0] == "field" and isinstance(obj[1], int):
            if obj[1] in field_map:
                obj[1] = field_map[obj[1]]
        # MBQL v2: ['field', dict, int]  — used in card_schema >= 22
        elif len(obj) >= 3 and obj[0] == "field" and isinstance(obj[1], dict) and isinstance(obj[2], int):
            if obj[2] in field_map:
                obj[2] = field_map[obj[2]]
        for it in obj:
            remap_in_place(it, field_map, card_remap)
    elif isinstance(obj, dict):
        for k, v in list(obj.items()):
            if k == "source-table" and isinstance(v, str) and v.startswith("card__"):
                try:
                    old_id = int(v.split("__", 1)[1])
                    if old_id in card_remap:
                        obj[k] = f"card__{card_remap[old_id]}"
                except ValueError:
                    pass
            elif k in ("card_id", "source_card_id") and isinstance(v, int) and v in card_remap:
                obj[k] = card_remap[v]
            elif k == "field_id" and isinstance(v, int) and v in field_map:
                obj[k] = field_map[v]
            else:
                remap_in_place(v, field_map, card_remap)


def build_field_map(hetz_base, hetz_sess, mac_url, mac_sess, db_remap):
    """Refetch Mac Mini + Hetzner metadata and build field_id remap by (schema, table, name)."""
    field_map = {}
    for mac_db_id, hetz_db_id in db_remap.items():
        mac_meta_file = RAW / "database_full" / f"{mac_db_id}.json"
        if mac_meta_file.exists():
            mac_meta = json.loads(mac_meta_file.read_text())
        else:
            mac_meta, err = http("GET", f"{mac_url}/api/database/{mac_db_id}/metadata", mac_sess)
            if err: continue
        hetz_meta, err = http("GET", f"{hetz_base}/api/database/{hetz_db_id}/metadata", hetz_sess)
        if err: continue
        lookup = {(t.get("schema") or "", t.get("name"), f.get("name")): f["id"]
                  for t in hetz_meta.get("tables", []) for f in t.get("fields", [])}
        for t in mac_meta.get("tables", []):
            for f in t.get("fields", []):
                k = (t.get("schema") or "", t.get("name"), f.get("name"))
                if k in lookup:
                    field_map[f["id"]] = lookup[k]
    return field_map


def main():
    hetz_base = os.environ["HETZNER_MB_URL"].rstrip("/")
    hetz_sess = os.environ["HETZNER_SESSION"]
    mac_url = os.environ.get("MAC_URL", "http://100.64.8.120:3000").rstrip("/")
    mac_sess = os.environ["MAC_SESSION"]

    hetz_ids = [int(x) for x in sys.argv[1:]]
    if not hetz_ids:
        print("usage: fix_broken_cards.py <hetz_id> [hetz_id...]"); sys.exit(1)

    state = json.loads((SECRETS / "hetzner_v061_state.json").read_text())
    db_remap = {int(k): int(v) for k, v in state["db_id_remap"].items()}
    card_remap = {int(k): int(v) for k, v in state.get("card_id_remap", {}).items()}
    hetz_to_mac = {v: k for k, v in card_remap.items()}

    print(f"building field_map (this queries live metadata) ...")
    field_map = build_field_map(hetz_base, hetz_sess, mac_url, mac_sess, db_remap)
    print(f"  {len(field_map)} fields mapped")

    for hetz_id in hetz_ids:
        mac_id = hetz_to_mac.get(hetz_id)
        if not mac_id:
            print(f"skip {hetz_id}: no mac mapping"); continue

        # 1. Fetch fresh from Mac Mini with ignore_view=true (gets full dataset_query)
        mac_c, err = http("GET", f"{mac_url}/api/card/{mac_id}?ignore_view=true", mac_sess)
        if err:
            print(f"skip {hetz_id}: fetch mac {mac_id} failed: {err}"); continue

        # 2. Fetch current Hetzner state (so we PATCH not create)
        hetz_c, err = http("GET", f"{hetz_base}/api/card/{hetz_id}?ignore_view=true", hetz_sess)
        if err:
            print(f"skip {hetz_id}: fetch hetz failed: {err}"); continue

        # 3. Take the Mac Mini's fresh dataset_query and remap it
        dq = copy.deepcopy(mac_c.get("dataset_query") or {})
        if dq.get("database") in db_remap:
            dq["database"] = db_remap[dq["database"]]
        remap_in_place(dq, field_map, card_remap)

        # Also remap parameters (which reference field ids in target)
        params = copy.deepcopy(mac_c.get("parameters") or [])
        remap_in_place(params, field_map, card_remap)

        viz = copy.deepcopy(mac_c.get("visualization_settings") or {})
        remap_in_place(viz, field_map, card_remap)

        # 4. PUT back — minimal payload with just what changed
        body = {
            "dataset_query": dq,
            "parameters": params,
            "visualization_settings": viz,
            "display": hetz_c.get("display"),
        }
        r, err = http("PUT", f"{hetz_base}/api/card/{hetz_id}", hetz_sess, body=body)
        if err:
            print(f"  hetz {hetz_id} '{mac_c.get('name','?')[:40]}' PUT FAIL: {err}")
        else:
            print(f"  hetz {hetz_id} '{mac_c.get('name','?')[:40]}' PATCHED ok")


if __name__ == "__main__":
    main()
