#!/usr/bin/env python3
"""
Fix dashboards whose tabs failed on initial import.

v0.61 API: tabs must be sent via PUT /api/dashboard/{id}/cards along with dashcards.
New tabs use negative IDs; dashcards reference tabs by those negative IDs.

Usage: HETZNER_MB_URL=... HETZNER_SESSION=... MAC_DASH_IDS="2" python3 fix_dashboard_tabs.py
"""

import copy
import json
import os
import socket
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
SECRETS = HERE / "secrets"
RAW = Path("/tmp/mb-migration-2026-07-02/raw")


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
                b = r.read()
                return json.loads(b.decode()) if b else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode(errors="replace") if hasattr(e, "read") else ""
            raise RuntimeError(f"HTTP {e.code} on {method} {url}: {err_body[:400]}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout, OSError) as e:
            last = e
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
    raise last


def remap_in_place(obj, field_map, card_remap):
    if isinstance(obj, list):
        # MBQL v1
        if len(obj) >= 2 and obj[0] == "field" and isinstance(obj[1], int) and obj[1] in field_map:
            obj[1] = field_map[obj[1]]
        # MBQL 2.0 (card_schema >= 22)
        elif len(obj) >= 3 and obj[0] == "field" and isinstance(obj[1], dict) and isinstance(obj[2], int) and obj[2] in field_map:
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


def main():
    base = os.environ["HETZNER_MB_URL"].rstrip("/")
    session = os.environ["HETZNER_SESSION"]
    mac_ids = [int(x) for x in os.environ.get("MAC_DASH_IDS", "2").split(",")]

    state = json.loads((SECRETS / "hetzner_v061_state.json").read_text())
    card_remap = {int(k): int(v) for k, v in state.get("card_id_remap", {}).items()}
    dash_remap = {int(k): int(v) for k, v in state.get("dashboard_id_remap", {}).items()}
    # rebuild field_map from live Hetzner (matches import script)
    db_remap = {int(k): int(v) for k, v in state["db_id_remap"].items()}
    field_map = {}
    for mac_db_id, hetz_db_id in db_remap.items():
        mm = RAW / "database_full" / f"{mac_db_id}.json"
        if not mm.exists():
            continue
        mac_meta = json.loads(mm.read_text())
        hetz_meta = http("GET", f"{base}/api/database/{hetz_db_id}/metadata", session)
        lookup = {(t.get('schema') or '', t.get('name'), f.get('name')): f['id']
                  for t in hetz_meta.get('tables', []) for f in t.get('fields', [])}
        for t in mac_meta.get("tables", []):
            for f in t.get("fields", []):
                key = (t.get('schema') or '', t.get('name'), f.get('name'))
                if key in lookup:
                    field_map[f['id']] = lookup[key]
    print(f"field_map size: {len(field_map)}")

    for mac_id in mac_ids:
        if mac_id not in dash_remap:
            print(f"skip mac {mac_id}: not in dash_remap")
            continue
        new_id = dash_remap[mac_id]
        src = json.loads((RAW / "dashboard_full" / f"{mac_id}.json").read_text())
        print(f"\n=== fixing mac {mac_id} → hetzner {new_id} '{src['name']}' ===")

        # First, delete existing dashcards so we start clean
        existing = http("GET", f"{base}/api/dashboard/{new_id}", session)
        existing_dcs = existing.get("dashcards") or existing.get("ordered_cards") or []
        if existing_dcs:
            wipe = [{"id": dc["id"], "toRemove": True} for dc in existing_dcs]
            # v0.61 uses cards + tabs; deletion via PUT with empty cards list
            http("PUT", f"{base}/api/dashboard/{new_id}/cards", session, body={"cards": [], "tabs": []})
            print(f"  wiped {len(existing_dcs)} existing dashcards")

        # Build tabs with negative ids (new)
        src_tabs = src.get("tabs") or []
        tab_neg_by_mac = {}
        new_tabs = []
        for i, t in enumerate(src_tabs):
            neg = -(i + 1)
            tab_neg_by_mac[t["id"]] = neg
            new_tabs.append({"id": neg, "name": t["name"], "position": t.get("position", i)})
        print(f"  prepared {len(new_tabs)} tabs")

        # Build dashcards with negative ids and tab references
        src_dcs = src.get("dashcards") or src.get("ordered_cards") or []
        new_dcs = []
        skipped_cards = 0
        for i, dc in enumerate(src_dcs):
            mac_card_id = dc.get("card_id")
            new_card_id = card_remap.get(mac_card_id) if mac_card_id else None
            if mac_card_id and not new_card_id:
                skipped_cards += 1
                continue
            neg_dc = -(i + 1)
            item = {
                "id": neg_dc,
                "card_id": new_card_id,
                "row": dc.get("row", 0),
                "col": dc.get("col", 0),
                "size_x": dc.get("size_x", 4),
                "size_y": dc.get("size_y", 4),
                "series": [{"id": card_remap[s["id"]]} for s in (dc.get("series") or []) if s.get("id") in card_remap],
                "visualization_settings": copy.deepcopy(dc.get("visualization_settings") or {}),
                "parameter_mappings": copy.deepcopy(dc.get("parameter_mappings") or []),
            }
            if dc.get("dashboard_tab_id") in tab_neg_by_mac:
                item["dashboard_tab_id"] = tab_neg_by_mac[dc["dashboard_tab_id"]]
            remap_in_place(item["parameter_mappings"], field_map, card_remap)
            remap_in_place(item["visualization_settings"], field_map, card_remap)
            new_dcs.append(item)

        print(f"  sending {len(new_dcs)} dashcards + {len(new_tabs)} tabs (skipped {skipped_cards} orphans)")

        # First set parameters via main PUT
        params = copy.deepcopy(src.get("parameters") or [])
        remap_in_place(params, field_map, card_remap)
        if params:
            try:
                http("PUT", f"{base}/api/dashboard/{new_id}", session, body={"parameters": params})
                print(f"  parameters set: {len(params)}")
            except RuntimeError as e:
                print(f"  parameters PUT failed: {e}")

        # Then send cards + tabs together
        try:
            r = http("PUT", f"{base}/api/dashboard/{new_id}/cards", session,
                     body={"cards": new_dcs, "tabs": new_tabs})
            returned_tabs = r.get("tabs") or []
            returned_cards = r.get("cards") or []
            print(f"  ok: {len(returned_cards)} cards + {len(returned_tabs)} tabs created")
        except RuntimeError as e:
            print(f"  cards+tabs PUT failed: {e}")


if __name__ == "__main__":
    main()
